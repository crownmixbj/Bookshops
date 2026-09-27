import type { RealtimeChannel } from '@supabase/supabase-js';
import { supabase } from '../utils/supabase';

/**
 * A fresh Realtime channel, never a reused one.
 *
 * WHY THIS EXISTS
 *
 * `supabase.channel(name)` does not always create a channel. If a channel
 * with that topic is still registered on the client, it hands back THAT
 * one — and if it has already joined, the next `.on('postgres_changes')`
 * throws:
 *
 *   cannot add `postgres_changes` callbacks for realtime:buyer-quote-messages
 *   after `subscribe()`.
 *
 * Our code always chains every `.on()` before `.subscribe()`, so the order
 * was never the bug. The bug is that `removeChannel()` in an effect's
 * cleanup is asynchronous (it unsubscribes, then removes), so when the
 * effect runs again straight away — its dependencies changed, React
 * StrictMode's double mount in development, or leaving and re-entering a
 * screen quickly — the new `channel('same-name')` call gets the old,
 * already-joined channel back, and the first `.on()` on it throws.
 *
 * A random suffix gives every effect run its own topic, so that can never
 * happen. The topic name is only a client-side label for postgres_changes:
 * which rows arrive is decided by the `.on()` filters and RLS, so a
 * unique name changes nothing about what is received.
 *
 * Usage — build the whole chain, THEN subscribe, and remove it on cleanup:
 *
 *   const channel = freshChannel('buyer-alerts')
 *     .on('postgres_changes', {...}, handler)
 *     .on('postgres_changes', {...}, handler)
 *     .subscribe();
 *   return () => { supabase.removeChannel(channel); };
 */
export function freshChannel(prefix: string): RealtimeChannel {
  const suffix = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  return supabase.channel(`${prefix}:${suffix}`);
}
