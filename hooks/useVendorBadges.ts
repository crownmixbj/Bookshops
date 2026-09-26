import { useEffect, useState } from 'react';
import { supabase } from '../utils/supabase';
import { SETTLED_PAYMENT_STATUSES } from '../types/db';

/**
 * The two numbers on the vendor sidebar: orders waiting to be packed,
 * and buyer messages not yet read.
 *
 * Refetched on every navigation (the `trigger` argument is the pathname)
 * and once a minute, which is enough for a badge — the screens
 * themselves are the live views. Failures are swallowed on purpose: a
 * missing migration or a dropped connection should cost a badge, never
 * the sidebar.
 */
export function useVendorBadges(enabled: boolean, trigger: string) {
  const [badges, setBadges] = useState<Record<string, number>>({});

  useEffect(() => {
    if (!enabled) {
      setBadges({});
      return;
    }
    let cancelled = false;

    async function load() {
      const [orders, unread] = await Promise.all([
        // orders_select_own scopes this to the shop's own orders.
        supabase
          .from('orders')
          .select('id', { count: 'exact', head: true })
          .in('fulfillment_status', ['processing', 'ready'])
          .in('payment_status', SETTLED_PAYMENT_STATUSES),
        supabase.rpc('vendor_unread_message_count'),
      ]);
      if (cancelled) return;
      setBadges({
        orders: orders.error ? 0 : orders.count ?? 0,
        messages: unread.error ? 0 : Number(unread.data ?? 0),
      });
    }

    load();
    const timer = setInterval(load, 60_000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [enabled, trigger]);

  return badges;
}
