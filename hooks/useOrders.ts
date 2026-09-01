import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '../utils/supabase';
import type {
  BookRequest,
  BookRequestItem,
  Order,
  OrderView,
  Quote,
  TrackerStage,
  Vendor,
} from '../types/db';

/**
 * Loads the signed-in buyer's orders with everything the page renders:
 * the quote behind each one, the vendor who is fulfilling it, the
 * original request, and its line items.
 *
 * Security: the orders query filters on the authenticated user's id, and
 * `orders_select_own` enforces the same server-side. Nothing here can
 * reach another buyer's order even if the client filter were removed.
 * Vendor rows come through `vendors_select_active`, which is why only
 * the shop's published phone/email are readable and not the owner's
 * personal profile.
 */

const STEP_LABEL: Record<TrackerStage['step'], string> = {
  placed: 'Order placed',
  processing: 'Vendor processing',
  dispatched: 'Dispatched',
  delivered: 'Delivered',
};

/** Rank of the current status along the four visible steps. */
function reachedIndex(order: Order): number {
  switch (order.fulfillment_status) {
    case 'delivered':
      return 3;
    case 'dispatched':
      return 2;
    // 'ready' is a vendor-side nuance; to a buyer it still reads as
    // "being prepared", so it maps onto the processing step.
    case 'ready':
    case 'processing':
      return 1;
    default:
      return 0;
  }
}

function buildStages(order: Order): TrackerStage[] {
  const reached = reachedIndex(order);
  const at: Record<TrackerStage['step'], string | null> = {
    placed: order.placed_at ?? order.created_at,
    processing: order.processing_at ?? order.ready_at,
    dispatched: order.dispatched_at,
    delivered: order.delivered_at,
  };

  return (['placed', 'processing', 'dispatched', 'delivered'] as const).map((step, i) => ({
    step,
    label: STEP_LABEL[step],
    at: at[step],
    state: i < reached ? 'done' : i === reached ? 'current' : 'upcoming',
  }));
}

/** LOCI-3F9A2C — short enough to read down a phone line. */
function referenceFor(id: string): string {
  return `LOCI-${id.replace(/-/g, '').slice(0, 6).toUpperCase()}`;
}

interface RawState {
  orders: Order[];
  quotes: Quote[];
  vendors: Vendor[];
  requests: BookRequest[];
  items: BookRequestItem[];
}

const EMPTY: RawState = { orders: [], quotes: [], vendors: [], requests: [], items: [] };

export function useOrders() {
  const [raw, setRaw] = useState<RawState>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const load = useCallback(async ({ isRefresh = false } = {}) => {
    isRefresh ? setRefreshing(true) : setLoading(true);
    setError(null);
    try {
      const {
        data: { user },
        error: userError,
      } = await supabase.auth.getUser();
      if (userError) throw userError;
      if (!user) {
        setRaw(EMPTY);
        return;
      }

      const { data: orders, error: ordersError } = await supabase
        .from('orders')
        .select('*')
        .eq('buyer_id', user.id)
        .order('created_at', { ascending: false });
      if (ordersError) throw ordersError;

      const quoteIds = [...new Set((orders ?? []).map((o) => o.quote_id))];
      if (quoteIds.length === 0) {
        setRaw({ ...EMPTY, orders: (orders ?? []) as Order[] });
        return;
      }

      const { data: quotes, error: quotesError } = await supabase
        .from('quotes')
        .select('id, request_id, vendor_id, total_price, item_breakdown, status, created_at, updated_at')
        .in('id', quoteIds);
      if (quotesError) throw quotesError;

      const vendorIds = [...new Set((quotes ?? []).map((q) => q.vendor_id))];
      const requestIds = [...new Set((quotes ?? []).map((q) => q.request_id))];

      const [vendorsRes, requestsRes, itemsRes] = await Promise.all([
        vendorIds.length
          ? supabase
              .from('vendors')
              .select('id, profile_id, store_name, address, city, is_active, phone, email, created_at, updated_at')
              .in('id', vendorIds)
          : Promise.resolve({ data: [], error: null }),
        requestIds.length
          ? supabase
              .from('book_requests')
              .select('id, buyer_id, school_name, class_level, image_url, image_path, status, created_at, updated_at')
              .in('id', requestIds)
          : Promise.resolve({ data: [], error: null }),
        requestIds.length
          ? supabase
              .from('book_request_items')
              .select('id, request_id, title, category, quantity, unit_price, parsed, position, created_at, updated_at')
              .in('request_id', requestIds)
              .order('position', { ascending: true })
          : Promise.resolve({ data: [], error: null }),
      ]);

      if (vendorsRes.error) throw vendorsRes.error;
      if (requestsRes.error) throw requestsRes.error;
      if (itemsRes.error) throw itemsRes.error;

      setRaw({
        orders: (orders ?? []) as Order[],
        quotes: (quotes ?? []) as Quote[],
        vendors: (vendorsRes.data ?? []) as Vendor[],
        requests: (requestsRes.data ?? []) as BookRequest[],
        items: (itemsRes.data ?? []) as BookRequestItem[],
      });
    } catch (e) {
      setError(e as Error);
      setRaw(EMPTY);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    load();
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(() => load());
    return () => subscription.unsubscribe();
  }, [load]);

  const orders: OrderView[] = useMemo(() => {
    const { orders: rows, quotes, vendors, requests, items } = raw;

    return rows.map((order) => {
      const quote = quotes.find((q) => q.id === order.quote_id) ?? null;
      const vendor = quote ? vendors.find((v) => v.id === quote.vendor_id) ?? null : null;
      const request = quote ? requests.find((r) => r.id === quote.request_id) ?? null : null;
      const myItems = request ? items.filter((i) => i.request_id === request.id) : [];

      return {
        ...order,
        quote,
        vendor,
        request,
        items: myItems,
        itemsTotal: myItems.reduce((sum, i) => sum + (i.unit_price ?? 0) * i.quantity, 0),
        itemCount: myItems.reduce((n, i) => n + i.quantity, 0),
        stages: buildStages(order),
        isComplete: order.fulfillment_status === 'delivered',
        isCancelled: order.fulfillment_status === 'cancelled',
        reference: referenceFor(order.id),
      };
    });
  }, [raw]);

  const sections = useMemo(
    () => ({
      active: orders.filter((o) => !o.isComplete && !o.isCancelled),
      completed: orders.filter((o) => o.isComplete),
      cancelled: orders.filter((o) => o.isCancelled),
    }),
    [orders]
  );

  return {
    orders,
    sections,
    loading,
    refreshing,
    error,
    refresh: () => load({ isRefresh: true }),
    reload: load,
  };
}
