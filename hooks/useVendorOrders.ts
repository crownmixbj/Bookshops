import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '../utils/supabase';
import { SETTLED_PAYMENT_STATUSES } from '../types/db';
import type { FulfillmentStatus, PaymentStatus } from '../types/db';

/**
 * The orders a shop has won, and what still has to happen to them.
 *
 * Two things worth knowing before changing this.
 *
 * First: there is no join to `profiles` here, and there must not be. A
 * vendor cannot read a buyer's profile row — profiles_select_own and
 * profiles_select_admin are the only SELECT policies — and that is
 * right: a shop has no business reading a customer's account. It does
 * not need to. orders.delivery_* holds the name, phone and address the
 * buyer typed at checkout, which is what the courier needs and a more
 * honest record than a profile that may have been edited since.
 *
 * Second: the line items come from a function, not a select. quote_items
 * is readable by the owning vendor, but pulling them per card would be a
 * query per order; vendor_order_items() takes the whole page of ids and
 * applies the ownership check once.
 */

export interface VendorOrderItem {
  id: string;
  title: string;
  quantity: number;
  unit_price: number | null;
  is_available: boolean;
}

export interface VendorOrder {
  id: string;
  /** LOCI-3F9A2C — short enough to read down a phone line. */
  reference: string;
  placed_at: string;
  amount: number;
  delivery_fee: number;
  payment_status: PaymentStatus;
  fulfillment_status: FulfillmentStatus;

  delivery_name: string | null;
  delivery_phone: string | null;
  delivery_address: string | null;
  delivery_city: string | null;
  delivery_state: string | null;
  delivery_notes: string | null;

  tracking_carrier: string | null;
  tracking_number: string | null;
  tracking_url: string | null;

  school_name: string | null;
  class_level: string | null;

  items: VendorOrderItem[];
  /** Total copies to pack, counting quantities. */
  unitCount: number;
  /** True while the money is ours to hold rather than the shop's. */
  inEscrow: boolean;
}

export type VendorOrderTab = 'all' | 'to_pack' | 'in_transit' | 'completed';

export const VENDOR_ORDER_TABS: { key: VendorOrderTab; label: string }[] = [
  { key: 'all', label: 'All Orders' },
  { key: 'to_pack', label: 'To Pack & Dispatch' },
  { key: 'in_transit', label: 'In Transit' },
  { key: 'completed', label: 'Completed' },
];

function referenceFor(id: string): string {
  return `LOCI-${id.replace(/-/g, '').slice(0, 6).toUpperCase()}`;
}

/**
 * Which tab an order belongs in.
 *
 * "To pack" is payment settled AND not yet gone. An order that is
 * processing but unpaid is deliberately in neither queue: showing it as
 * work would have a shop packing books nobody has paid for.
 */
export function tabFor(order: VendorOrder): VendorOrderTab | null {
  if (order.fulfillment_status === 'delivered') return 'completed';
  if (order.fulfillment_status === 'dispatched') return 'in_transit';
  if (order.fulfillment_status === 'cancelled') return null;
  return (SETTLED_PAYMENT_STATUSES as string[]).includes(order.payment_status) ? 'to_pack' : null;
}

export function useVendorOrders() {
  const [orders, setOrders] = useState<VendorOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (isRefresh = false) => {
    isRefresh ? setRefreshing(true) : setLoading(true);
    setError(null);

    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        setOrders([]);
        return;
      }

      // orders_select_own already scopes this to orders whose quote
      // belongs to this vendor, so there is no vendor_id filter to add —
      // and no way to widen it from the client if there were.
      const { data, error: queryError } = await supabase
        .from('orders')
        .select(
          'id, quote_id, amount, delivery_fee, payment_status, fulfillment_status, placed_at, created_at, ' +
            'delivery_name, delivery_phone, delivery_address, delivery_city, delivery_state, delivery_notes, ' +
            'tracking_carrier, tracking_number, tracking_url, ' +
            'quotes!inner ( id, vendor_id, request_id, book_requests ( school_name, class_level ) )'
        )
        .order('placed_at', { ascending: false });

      if (queryError) throw new Error(queryError.message);

      const rows = (data ?? []) as Record<string, any>[];
      if (rows.length === 0) {
        setOrders([]);
        return;
      }

      // One call for every card's lines rather than one per card.
      const { data: itemRows, error: itemError } = await supabase.rpc('vendor_order_items', {
        p_order_ids: rows.map((r) => r.id as string),
      });
      if (itemError) throw new Error(itemError.message);

      const byOrder = new Map<string, VendorOrderItem[]>();
      for (const raw of (itemRows ?? []) as Record<string, any>[]) {
        const list = byOrder.get(raw.order_id) ?? [];
        list.push({
          id: raw.item_id as string,
          title: raw.title as string,
          quantity: Number(raw.quantity ?? 1),
          unit_price: raw.unit_price == null ? null : Number(raw.unit_price),
          is_available: raw.is_available !== false,
        });
        byOrder.set(raw.order_id as string, list);
      }

      setOrders(
        rows.map((o) => {
          const request = o.quotes?.book_requests ?? null;
          // A shop packs what it agreed to supply. An item it marked
          // unavailable when quoting is not on the picking list.
          const items = (byOrder.get(o.id) ?? []).filter((i) => i.is_available);
          return {
            id: o.id,
            reference: referenceFor(o.id),
            placed_at: (o.placed_at as string) ?? (o.created_at as string),
            amount: Number(o.amount ?? 0),
            delivery_fee: Number(o.delivery_fee ?? 0),
            payment_status: (o.payment_status ?? 'pending') as PaymentStatus,
            fulfillment_status: (o.fulfillment_status ?? 'processing') as FulfillmentStatus,
            delivery_name: o.delivery_name ?? null,
            delivery_phone: o.delivery_phone ?? null,
            delivery_address: o.delivery_address ?? null,
            delivery_city: o.delivery_city ?? null,
            delivery_state: o.delivery_state ?? null,
            delivery_notes: o.delivery_notes ?? null,
            tracking_carrier: o.tracking_carrier ?? null,
            tracking_number: o.tracking_number ?? null,
            tracking_url: o.tracking_url ?? null,
            school_name: request?.school_name ?? null,
            class_level: request?.class_level ?? null,
            items,
            unitCount: items.reduce((sum, i) => sum + i.quantity, 0),
            inEscrow: o.payment_status === 'escrow_held',
          };
        })
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const counts = useMemo(() => {
    const base: Record<VendorOrderTab, number> = { all: 0, to_pack: 0, in_transit: 0, completed: 0 };
    for (const o of orders) {
      base.all += 1;
      const t = tabFor(o);
      if (t) base[t] += 1;
    }
    return base;
  }, [orders]);

  const byTab = useCallback(
    (tab: VendorOrderTab) => (tab === 'all' ? orders : orders.filter((o) => tabFor(o) === tab)),
    [orders]
  );

  /**
   * Move an order forward.
   *
   * Goes through vendor_advance_fulfillment rather than an update:
   * `orders` has no UPDATE policy for anyone, so a direct update would
   * match zero rows and report success. The function also refuses to
   * dispatch an order that has not been paid for, and refuses to move
   * one backwards out of delivered.
   */
  const advance = useCallback(
    async (
      orderId: string,
      next: 'ready' | 'dispatched',
      tracking?: { carrier?: string; number?: string; url?: string }
    ): Promise<{ ok: true } | { ok: false; message: string }> => {
      const { error: rpcError } = await supabase.rpc('vendor_advance_fulfillment', {
        p_order_id: orderId,
        p_next: next,
        p_tracking_carrier: tracking?.carrier?.trim() || null,
        p_tracking_number: tracking?.number?.trim() || null,
        p_tracking_url: tracking?.url?.trim() || null,
      });

      if (rpcError) {
        // The function raises with a hint on the case a shop can act on
        // (waiting for payment to clear), so keep it.
        const hint = (rpcError as { hint?: string | null }).hint;
        return { ok: false, message: [rpcError.message, hint].filter(Boolean).join(' — ') };
      }

      await load(true);
      return { ok: true };
    },
    [load]
  );

  return { orders, counts, byTab, loading, refreshing, error, refresh: () => load(true), advance };
}
