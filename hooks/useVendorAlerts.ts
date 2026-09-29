import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '../utils/supabase';
import { freshChannel } from '../lib/realtime';
import { onMessagesRead } from '../lib/unreadSignal';
import { getSessionUserId, subscribeToAuthReloads } from '../lib/loadState';
import { MISSING_CODES, type MigrationState } from './useChildren';
import { SETTLED_PAYMENT_STATUSES, type AppNotification } from '../types/db';

/**
 * The vendor's half of useBuyerAlerts: the alert inbox behind the bell,
 * the unread-message count behind "Messaging", and the orders-to-pack
 * count behind "Orders".
 *
 * Same shape and the same behaviour as the buyer's, on purpose:
 *   - mounted once, in AppShell;
 *   - live over Supabase Realtime (notifications + quote_messages), with
 *     no filters because RLS already limits what arrives to this shop's
 *     own rows;
 *   - refreshed on navigation, so opening a thread (which marks it read
 *     server-side) clears the badge on the next screen.
 *
 * Alerts are written by database triggers (bookshops_vendor_alerts.sql),
 * so they are right whoever made the change — the buyer's app, the
 * payment webhook, or an admin.
 *
 * `orders` is not in the realtime publication, so the to-pack count is
 * refreshed with everything else and on a one-minute timer. A new paid
 * order still lights the bell instantly: it arrives as an order_placed
 * alert, and that reload recounts the orders too.
 */

const LIMIT = 40;
const COLUMNS = 'id, kind, title, body, link, quote_id, order_id, request_id, created_at, read_at';

export function useVendorAlerts(enabled: boolean, pathname: string) {
  const [items, setItems] = useState<AppNotification[]>([]);
  const [unreadMessages, setUnreadMessages] = useState(0);
  const [ordersToPack, setOrdersToPack] = useState(0);
  const [loading, setLoading] = useState(true);
  const [migration, setMigration] = useState<MigrationState>('unknown');
  const [signedIn, setSignedIn] = useState(false);
  const alive = useRef(true);

  const load = useCallback(async () => {
    const uid = await getSessionUserId();
    if (!alive.current) return;
    setSignedIn(!!uid);
    if (!uid) {
      setItems([]);
      setUnreadMessages(0);
      setOrdersToPack(0);
      setLoading(false);
      return;
    }

    const [alertsRes, unreadRes, ordersRes] = await Promise.all([
      supabase
        .from('notifications')
        .select(COLUMNS)
        .eq('recipient_id', uid)
        .order('created_at', { ascending: false })
        .limit(LIMIT),
      supabase.rpc('vendor_unread_message_count'),
      // orders_select_own scopes this to the shop's own orders.
      supabase
        .from('orders')
        .select('id', { count: 'exact', head: true })
        .in('fulfillment_status', ['processing', 'ready'])
        .in('payment_status', SETTLED_PAYMENT_STATUSES),
    ]);
    if (!alive.current) return;

    if (alertsRes.error) {
      setMigration(MISSING_CODES.has(alertsRes.error.code ?? '') ? 'missing' : 'ok');
      setItems([]);
    } else {
      setMigration('ok');
      setItems((alertsRes.data ?? []) as AppNotification[]);
    }
    // A failed count costs a badge, never the shell.
    if (!unreadRes.error) setUnreadMessages(Number(unreadRes.data ?? 0));
    if (!ordersRes.error) setOrdersToPack(ordersRes.count ?? 0);
    setLoading(false);
  }, []);

  // Coalesce a burst: one payment fires an order alert, a quote update
  // and sibling declines within the same second.
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scheduleReload = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(load, 350);
  }, [load]);

  useEffect(() => {
    alive.current = true;
    if (!enabled) return;
    load();
    const unsubscribe = subscribeToAuthReloads(load);
    const poll = setInterval(load, 60_000);
    return () => {
      alive.current = false;
      unsubscribe();
      clearInterval(poll);
      if (timer.current) clearTimeout(timer.current);
    };
  }, [enabled, load]);

  // Reading a thread on /vendor/messages drops the badge at once, the
  // same way the buyer's does: the inbox announces how many it cleared,
  // the count comes down, and a re-count follows (which also picks up the
  // thread's message alert, cleared server-side by mark_quote_thread_read).
  useEffect(() => {
    if (!enabled) return;
    return onMessagesRead((cleared) => {
      setUnreadMessages((n) => Math.max(0, n - cleared));
      scheduleReload();
    });
  }, [enabled, scheduleReload]);

  // Backstop: re-count on navigation. Skips the first path it sees — the
  // initial load has just covered it.
  const lastPath = useRef<string | null>(null);
  useEffect(() => {
    if (!enabled || !signedIn) return;
    if (lastPath.current !== null && lastPath.current !== pathname) scheduleReload();
    lastPath.current = pathname;
  }, [pathname, enabled, signedIn, scheduleReload]);

  useEffect(() => {
    if (!enabled || !signedIn || migration !== 'ok') return;
    // A fresh topic per effect run (see lib/realtime.ts).
    const channel = freshChannel('vendor-alerts')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'notifications' }, scheduleReload)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'quote_messages' }, scheduleReload)
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [enabled, signedIn, migration, scheduleReload]);

  const markRead = useCallback(async (ids: string[] | null) => {
    const now = new Date().toISOString();
    // Optimistic: the badge should drop the moment the panel is used.
    setItems((prev) =>
      prev.map((n) => (!n.read_at && (ids == null || ids.includes(n.id)) ? { ...n, read_at: now } : n))
    );
    await supabase.rpc('mark_notifications_read', { p_ids: ids });
  }, []);

  const unread = useMemo(() => items.filter((n) => !n.read_at).length, [items]);

  /** Keyed by sidebar nav key — what VendorSidebar's `badges` expects. */
  const badges = useMemo(
    () => ({ orders: ordersToPack, messages: unreadMessages }),
    [ordersToPack, unreadMessages]
  );

  return {
    items,
    unread,
    unreadMessages,
    ordersToPack,
    badges,
    loading,
    migration,
    signedIn,
    refresh: load,
    markRead,
    markAllRead: () => markRead(null),
  };
}
