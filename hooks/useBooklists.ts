import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '../utils/supabase';
import type {
  Booklist,
  BooklistBucket,
  BooklistItemGroup,
  BookRequest,
  BookRequestItem,
  ItemCategory,
  Order,
  Quote,
} from '../types/db';

/**
 * Loads every booklist belonging to the signed-in buyer, with its items,
 * quotes and order, and sorts them into the page's three sections.
 *
 * Security: every query filters on the authenticated user's id, and RLS
 * enforces the same thing server-side — `requests_select_visible` scopes
 * book_requests, `items_select_via_request` scopes the line items, and
 * `orders_select_own` scopes orders. The client filter is for efficiency;
 * the policy is what actually protects the data.
 */

export const CATEGORY_ORDER: ItemCategory[] = ['textbook', 'stationery', 'uniform', 'other'];

export const CATEGORY_LABEL: Record<ItemCategory, string> = {
  textbook: 'Textbooks',
  stationery: 'Stationery',
  uniform: 'Uniforms',
  other: 'Other items',
};

interface RawState {
  requests: BookRequest[];
  items: BookRequestItem[];
  quotes: Quote[];
  orders: Order[];
}

const EMPTY: RawState = { requests: [], items: [], quotes: [], orders: [] };

/**
 * Which section a request belongs in.
 *   archived  finished or abandoned — nothing left to do
 *   draft     still being edited, or published with no quote back yet
 *   active    quoted or ordered — awaiting a decision or a delivery
 */
function bucketFor(request: BookRequest, quotes: Quote[], order: Order | null): BooklistBucket {
  if (request.status === 'cancelled') return 'archived';
  // Explicit rather than falling through to the no-live-quotes branch
  // below: a draft has no quotes by construction, and saying so here is
  // what makes "Drafts & pending" mean something.
  if (request.status === 'draft') return 'draft';
  if (order && (order.fulfillment_status === 'delivered' || order.fulfillment_status === 'cancelled')) {
    return 'archived';
  }
  if (request.status === 'ordered') return 'active';
  const liveQuotes = quotes.filter((q) => q.status === 'sent' || q.status === 'accepted');
  return liveQuotes.length > 0 ? 'active' : 'draft';
}

function groupItems(items: BookRequestItem[]): BooklistItemGroup[] {
  return CATEGORY_ORDER.map((category) => {
    const inGroup = items.filter((i) => i.category === category);
    return {
      category,
      items: inGroup,
      subtotal: inGroup.reduce(
        (sum, i) => sum + (i.unit_price ?? 0) * i.quantity,
        0
      ),
      unpricedCount: inGroup.filter((i) => i.unit_price == null).length,
    };
  }).filter((g) => g.items.length > 0);
}

export function useBooklists() {
  const [raw, setRaw] = useState<RawState>(EMPTY);
  const [userId, setUserId] = useState<string | null>(null);
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
        setUserId(null);
        setRaw(EMPTY);
        return;
      }
      setUserId(user.id);

      const { data: requests, error: requestsError } = await supabase
        .from('book_requests')
        .select('id, buyer_id, school_name, class_level, image_url, image_path, status, created_at, updated_at')
        .eq('buyer_id', user.id)
        .order('created_at', { ascending: false });
      if (requestsError) throw requestsError;

      const ids = (requests ?? []).map((r) => r.id);
      if (ids.length === 0) {
        setRaw({ ...EMPTY, requests: [] });
        return;
      }

      // Three scoped reads rather than one deep embed: a failure in any
      // one of them then names the table it came from.
      const [itemsRes, quotesRes, ordersRes] = await Promise.all([
        supabase
          .from('book_request_items')
          // TODO: add `author` here once bookshops_booklist_author.sql has
          // been run. Naming a column that does not exist fails the whole
          // select, which would blank the page rather than hide one field.
          .select('id, request_id, title, category, quantity, unit_price, parsed, position, created_at, updated_at')
          .in('request_id', ids)
          .order('position', { ascending: true }),
        supabase
          .from('quotes')
          .select('id, request_id, vendor_id, total_price, item_breakdown, status, created_at, updated_at, vendors ( id, store_name, city, is_active )')
          .in('request_id', ids)
          .order('total_price', { ascending: true }),
        supabase
          .from('orders')
          .select('id, quote_id, buyer_id, payment_status, fulfillment_status, created_at, updated_at')
          .eq('buyer_id', user.id),
      ]);

      if (itemsRes.error) throw itemsRes.error;
      if (quotesRes.error) throw quotesRes.error;
      if (ordersRes.error) throw ordersRes.error;

      setRaw({
        requests: (requests ?? []) as BookRequest[],
        items: (itemsRes.data ?? []) as BookRequestItem[],
        quotes: (quotesRes.data ?? []) as unknown as Quote[],
        orders: (ordersRes.data ?? []) as Order[],
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

  const booklists: Booklist[] = useMemo(() => {
    const { requests, items, quotes, orders } = raw;

    return requests.map((request) => {
      const myItems = items
        .filter((i) => i.request_id === request.id)
        .sort((a, b) => a.position - b.position);
      const myQuotes = quotes.filter((q) => q.request_id === request.id);
      const quoteIds = new Set(myQuotes.map((q) => q.id));
      const order = orders.find((o) => quoteIds.has(o.quote_id)) ?? null;

      const accepted = myQuotes.find((q) => q.status === 'accepted');
      const cheapest = myQuotes
        .filter((q) => q.status === 'sent')
        .sort((a, b) => Number(a.total_price) - Number(b.total_price))[0];
      const itemsTotal = myItems.reduce(
        (sum, i) => sum + (i.unit_price ?? 0) * i.quantity,
        0
      );

      let estimatedTotal = 0;
      let totalSource: Booklist['totalSource'] = 'none';
      if (order && accepted) {
        estimatedTotal = Number(accepted.total_price);
        totalSource = 'order';
      } else if (accepted) {
        estimatedTotal = Number(accepted.total_price);
        totalSource = 'quote';
      } else if (cheapest) {
        estimatedTotal = Number(cheapest.total_price);
        totalSource = 'quote';
      } else if (itemsTotal > 0) {
        estimatedTotal = itemsTotal;
        totalSource = 'items';
      }

      return {
        ...request,
        items: myItems,
        groups: groupItems(myItems),
        quotes: myQuotes,
        order,
        bucket: bucketFor(request, myQuotes, order),
        itemCount: myItems.reduce((n, i) => n + i.quantity, 0),
        lineCount: myItems.length,
        estimatedTotal,
        totalSource,
        hasUnpricedItems: myItems.some((i) => i.unit_price == null),
      };
    });
  }, [raw]);

  const sections = useMemo(
    () => ({
      active: booklists.filter((b) => b.bucket === 'active'),
      draft: booklists.filter((b) => b.bucket === 'draft'),
      archived: booklists.filter((b) => b.bucket === 'archived'),
    }),
    [booklists]
  );

  return {
    userId,
    booklists,
    sections,
    loading,
    refreshing,
    error,
    refresh: () => load({ isRefresh: true }),
    reload: load,
  };
}
