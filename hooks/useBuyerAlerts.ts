import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '../utils/supabase';
import { getSessionUserId, subscribeToAuthReloads } from '../lib/loadState';
import { MISSING_CODES, type MigrationState } from './useChildren';
import type { AppNotification } from '../types/db';

/**
 * Everything the buyer's header badges need: the alert inbox behind the
 * bell, and the unread-message count behind "Messages" in the sidebar.
 *
 * Mounted once, in AppShell, and live over Supabase Realtime. Both
 * subscriptions are unfiltered on purpose — RLS (notifications_select_own,
 * quote_messages_select_participant) already limits what arrives to this
 * buyer's own rows, so a filter would add nothing but a second place to
 * get the scoping wrong.
 *
 * Alerts are written by database triggers (bookshops_buyer_portal.sql),
 * so they are right whoever made the change: a vendor sending a quote, a
 * courier webhook, an admin cancelling an order.
 */

const LIMIT = 40;
const COLUMNS = 'id, kind, title, body, link, quote_id, order_id, request_id, created_at, read_at';

export function useBuyerAlerts(enabled: boolean, pathname: string) {
  const [items, setItems] = useState<AppNotification[]>([]);
  const [unreadMessages, setUnreadMessages] = useState(0);
  const [loading, setLoading] = useState(true);
  const [migration, setMigration] = useState<MigrationState>('unknown');
  const [signedIn, setSignedIn] = useState(false);
  const alive = useRef(true);

  const loadAlerts = useCallback(async () => {
    const uid = await getSessionUserId();
    if (!alive.current) return;
    setSignedIn(!!uid);
    if (!uid) {
      setItems([]);
      setUnreadMessages(0);
      setLoading(false);
      return;
    }

    const [alertsRes, unreadRes] = await Promise.all([
      supabase
        .from('notifications')
        .select(COLUMNS)
        .eq('recipient_id', uid)
        .order('created_at', { ascending: false })
        .limit(LIMIT),
      supabase.rpc('buyer_unread_message_count'),
    ]);
    if (!alive.current) return;

    if (alertsRes.error) {
      setMigration(MISSING_CODES.has(alertsRes.error.code ?? '') ? 'missing' : 'ok');
      setItems([]);
    } else {
      setMigration('ok');
      setItems((alertsRes.data ?? []) as AppNotification[]);
    }
    if (!unreadRes.error) setUnreadMessages(Number(unreadRes.data ?? 0));
    setLoading(false);
  }, []);

  // Coalesce a burst (a bundle checkout settles several orders at once).
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scheduleReload = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(loadAlerts, 350);
  }, [loadAlerts]);

  useEffect(() => {
    alive.current = true;
    if (!enabled) return;
    loadAlerts();
    const unsubscribe = subscribeToAuthReloads(loadAlerts);
    return () => {
      alive.current = false;
      unsubscribe();
      if (timer.current) clearTimeout(timer.current);
    };
  }, [enabled, loadAlerts]);

  // Reading a thread marks it read server-side; the badge catches up on
  // the next navigation without waiting for a realtime event. Skips the
  // first path it sees — the initial load above has just covered it.
  const lastPath = useRef<string | null>(null);
  useEffect(() => {
    if (!enabled || !signedIn) return;
    if (lastPath.current !== null && lastPath.current !== pathname) scheduleReload();
    lastPath.current = pathname;
  }, [pathname, enabled, signedIn, scheduleReload]);

  useEffect(() => {
    if (!enabled || !signedIn || migration !== 'ok') return;
    const channel = supabase
      .channel('buyer-alerts')
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

  return {
    items,
    unread,
    unreadMessages,
    loading,
    migration,
    signedIn,
    refresh: loadAlerts,
    markRead,
    markAllRead: () => markRead(null),
  };
}
