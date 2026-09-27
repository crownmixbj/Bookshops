import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '../utils/supabase';
import { freshChannel } from '../lib/realtime';
import { MISSING_CODES, type MigrationState } from './useChildren';
import { MESSAGE_MAX, type ThreadMessage } from './useVendorMessages';
import type { FulfillmentStatus, QuoteStatus } from '../types/db';

/**
 * The buyer's inbox: one thread per quote, the buyer's half of
 * bookshops_messaging.sql.
 *
 * Mirrors useVendorMessages deliberately — same table, same send and
 * read-marking functions, same realtime channel shape — with the two
 * things that differ between the sides: the list comes from
 * buyer_message_threads(), and "mine" is sender_role = 'buyer'. The
 * database decides which side a sender is on (send_quote_message), so
 * nothing here could post as the shop even if it tried.
 */

export { MESSAGE_MAX };
export type { ThreadMessage };

export interface BuyerThread {
  quote_id: string;
  request_id: string;
  reference: string;
  quote_status: QuoteStatus;
  school_name: string;
  class_level: string;
  child_name: string | null;
  store_name: string;
  vendor_id: string;
  total_price: number;
  order_id: string | null;
  order_reference: string | null;
  order_fulfillment_status: FulfillmentStatus | null;
  last_message: string | null;
  last_message_at: string | null;
  last_sender_role: 'buyer' | 'vendor' | null;
  message_count: number;
  unread_count: number;
  activity_at: string;
}

function toThread(r: Record<string, any>): BuyerThread {
  return {
    quote_id: r.quote_id,
    request_id: r.request_id,
    reference: r.reference,
    quote_status: r.quote_status,
    school_name: r.school_name ?? '',
    class_level: r.class_level ?? '',
    child_name: r.child_name ?? null,
    store_name: r.store_name ?? 'Bookshop',
    vendor_id: r.vendor_id,
    total_price: Number(r.total_price ?? 0),
    order_id: r.order_id ?? null,
    order_reference: r.order_reference ?? null,
    order_fulfillment_status: r.order_fulfillment_status ?? null,
    last_message: r.last_message ?? null,
    last_message_at: r.last_message_at ?? null,
    last_sender_role: r.last_sender_role ?? null,
    message_count: Number(r.message_count ?? 0),
    unread_count: Number(r.unread_count ?? 0),
    activity_at: r.activity_at,
  };
}

function toMessage(r: Record<string, any>): ThreadMessage {
  return {
    id: r.id,
    quote_id: r.quote_id,
    order_id: r.order_id ?? null,
    sender_role: r.sender_role,
    body: r.body,
    created_at: r.created_at,
    read_at: r.read_at ?? null,
  };
}

export function useBuyerMessages(initialQuoteId?: string | null) {
  const [threads, setThreads] = useState<BuyerThread[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [migration, setMigration] = useState<MigrationState>('unknown');

  const [activeId, setActiveId] = useState<string | null>(initialQuoteId ?? null);
  const [messages, setMessages] = useState<ThreadMessage[]>([]);
  const [loadingThread, setLoadingThread] = useState(false);
  const [threadError, setThreadError] = useState<string | null>(null);

  const activeRef = useRef<string | null>(activeId);
  activeRef.current = activeId;

  // ---- the list --------------------------------------------------
  const loadThreads = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    setError(null);
    const { data, error: rpcError } = await supabase.rpc('buyer_message_threads');
    if (rpcError) {
      if (MISSING_CODES.has(rpcError.code ?? '')) setMigration('missing');
      else setError(rpcError.message);
      setLoading(false);
      return;
    }
    setMigration('ok');
    setThreads(((data ?? []) as Record<string, any>[]).map(toThread));
    setLoading(false);
  }, []);

  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scheduleRefresh = useCallback(() => {
    if (refreshTimer.current) clearTimeout(refreshTimer.current);
    refreshTimer.current = setTimeout(() => loadThreads(true), 400);
  }, [loadThreads]);

  useEffect(() => {
    loadThreads();
    return () => {
      if (refreshTimer.current) clearTimeout(refreshTimer.current);
    };
  }, [loadThreads]);

  // ---- read state ------------------------------------------------
  const markRead = useCallback(async (quoteId: string) => {
    const { data, error: rpcError } = await supabase.rpc('mark_quote_thread_read', { p_quote_id: quoteId });
    if (rpcError) return;
    if (Number(data) > 0) {
      setThreads((prev) => prev.map((t) => (t.quote_id === quoteId ? { ...t, unread_count: 0 } : t)));
    }
  }, []);

  // ---- the open thread -------------------------------------------
  const loadThread = useCallback(
    async (quoteId: string) => {
      setLoadingThread(true);
      setThreadError(null);
      const { data, error: qError } = await supabase
        .from('quote_messages')
        .select('id, quote_id, order_id, sender_role, body, created_at, read_at')
        .eq('quote_id', quoteId)
        .order('created_at', { ascending: true })
        .limit(500);

      if (activeRef.current !== quoteId) return;

      if (qError) {
        setThreadError(qError.message);
        setMessages([]);
      } else {
        setMessages(((data ?? []) as Record<string, any>[]).map(toMessage));
        markRead(quoteId);
      }
      setLoadingThread(false);
    },
    [markRead]
  );

  useEffect(() => {
    if (!activeId || migration === 'missing') {
      setMessages([]);
      return;
    }
    loadThread(activeId);
  }, [activeId, loadThread, migration]);

  // ---- realtime --------------------------------------------------
  useEffect(() => {
    if (migration !== 'ok') return;

    // A fresh topic per effect run (see lib/realtime.ts): every .on()
    // is chained on a channel that has not joined yet, then subscribed.
    const channel = freshChannel('buyer-quote-messages')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'quote_messages' }, (payload) => {
        const row = toMessage(payload.new as Record<string, any>);
        if (row.quote_id === activeRef.current) {
          setMessages((prev) => (prev.some((m) => m.id === row.id) ? prev : [...prev, row]));
          if (row.sender_role === 'vendor') markRead(row.quote_id);
        }
        scheduleRefresh();
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'quote_messages' }, (payload) => {
        const row = toMessage(payload.new as Record<string, any>);
        if (row.quote_id === activeRef.current) {
          setMessages((prev) => prev.map((m) => (m.id === row.id ? { ...m, read_at: row.read_at } : m)));
        }
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [migration, markRead, scheduleRefresh]);

  // ---- sending ---------------------------------------------------
  const send = useCallback(
    async (body: string): Promise<{ ok: true } | { ok: false; message: string }> => {
      const quoteId = activeRef.current;
      const text = body.trim();
      if (!quoteId) return { ok: false, message: 'Choose a conversation first.' };
      if (!text) return { ok: false, message: 'Type a message first.' };
      if (text.length > MESSAGE_MAX) return { ok: false, message: 'Keep a message under 2,000 characters.' };

      const tempId = `pending-${Date.now()}`;
      setMessages((prev) => [
        ...prev,
        {
          id: tempId,
          quote_id: quoteId,
          order_id: null,
          sender_role: 'buyer',
          body: text,
          created_at: new Date().toISOString(),
          read_at: null,
          pending: true,
        },
      ]);

      const { data, error: rpcError } = await supabase.rpc('send_quote_message', {
        p_quote_id: quoteId,
        p_body: text,
      });

      if (rpcError) {
        setMessages((prev) => prev.filter((m) => m.id !== tempId));
        return { ok: false, message: rpcError.message };
      }

      const saved = toMessage(data as Record<string, any>);
      setMessages((prev) => {
        const withoutTemp = prev.filter((m) => m.id !== tempId);
        return withoutTemp.some((m) => m.id === saved.id) ? withoutTemp : [...withoutTemp, saved];
      });
      setThreads((prev) =>
        prev
          .map((t) =>
            t.quote_id === quoteId
              ? {
                  ...t,
                  last_message: saved.body,
                  last_message_at: saved.created_at,
                  last_sender_role: 'buyer' as const,
                  message_count: t.message_count + 1,
                  activity_at: saved.created_at,
                }
              : t
          )
          .sort((a, b) => (a.activity_at < b.activity_at ? 1 : -1))
      );
      return { ok: true };
    },
    []
  );

  const active = useMemo(() => threads.find((t) => t.quote_id === activeId) ?? null, [threads, activeId]);
  const unreadTotal = useMemo(() => threads.reduce((n, t) => n + t.unread_count, 0), [threads]);

  return {
    threads,
    loading,
    error,
    migration,
    refresh: () => loadThreads(),
    activeId,
    active,
    open: setActiveId,
    messages,
    loadingThread,
    threadError,
    send,
    unreadTotal,
  };
}
