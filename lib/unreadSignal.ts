/**
 * An in-app nudge for the buyer's Messages badge.
 *
 * The sidebar badge (useBuyerAlerts, mounted in AppShell) and the inbox
 * (useBuyerMessages, mounted on /messages) are separate hooks. Reading a
 * thread already reaches the badge over Realtime — mark_quote_thread_read
 * updates quote_messages.read_at — but that is a network round trip, and
 * a project where Realtime is off would leave the badge stale until the
 * next navigation. This makes the drop immediate: the inbox announces
 * how many messages it just marked read, and the badge subtracts them
 * at once, then re-counts from the server to stay exact.
 */

import { AppState, Platform } from 'react-native';

/**
 * Is the person actually looking at the app right now? Neither inbox may
 * mark messages read while this is false.
 *
 * On the web that means the tab is visible AND its window has focus.
 * Visible alone was not enough: two browser windows side by side are
 * both "visible", so a buyer typing in one window made the shop's window
 * next to it mark every message read on arrival (seen in the API logs as
 * a mark-read call ~0.5s after each send), and no badge ever showed.
 * A window you have not clicked into is not being read.
 */
export function pageVisible(): boolean {
  if (Platform.OS === 'web') {
    if (typeof document === 'undefined') return true;
    return document.visibilityState === 'visible' && document.hasFocus();
  }
  return AppState.currentState === 'active';
}

/** Calls `fn` whenever the page or app comes back into view or focus. */
export function onPageVisible(fn: () => void): () => void {
  const handler = () => {
    if (pageVisible()) fn();
  };
  if (Platform.OS === 'web') {
    if (typeof document === 'undefined' || typeof window === 'undefined') return () => {};
    document.addEventListener('visibilitychange', handler);
    window.addEventListener('focus', handler);
    return () => {
      document.removeEventListener('visibilitychange', handler);
      window.removeEventListener('focus', handler);
    };
  }
  const sub = AppState.addEventListener('change', handler);
  return () => sub.remove();
}

type Listener = (cleared: number) => void;

const listeners = new Set<Listener>();

export function onMessagesRead(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function announceMessagesRead(cleared: number): void {
  for (const listener of listeners) listener(cleared);
}
