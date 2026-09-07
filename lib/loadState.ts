import type { User } from '@supabase/supabase-js';
import { supabase } from '../utils/supabase';

/**
 * Shared plumbing for the buyer's data hooks.
 *
 * Three things here, and each one fixes a way the dashboard could sit on
 * a skeleton forever after a booklist was created.
 */

/** Rejects rather than hanging. A spinner with no timeout is a spinner forever. */
export async function withTimeout<T>(
  promise: PromiseLike<T>,
  ms: number,
  label: string
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms / 1000}s`)), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * The signed-in user's id, read from the locally cached session.
 *
 * Deliberately getSession() and not getUser(): getUser() makes a network
 * round trip to /auth/v1/user on EVERY call, so it sat at the head of
 * every refetch with no timeout. Right after an upload — when the
 * connection is still busy and a token refresh may be in flight — that
 * request is exactly the one that hangs, and a hang there means the
 * `finally` that clears `loading` never runs.
 *
 * Safe to trust for a client-side filter: it only narrows what we ask
 * for. RLS on the server is what actually enforces ownership, and it
 * does not take our word for who we are.
 */
export async function getSessionUserId(): Promise<string | null> {
  return (await getSessionUser())?.id ?? null;
}

/**
 * The whole cached user, for screens that need more than the id.
 *
 * Same reasoning as getSessionUserId, plus one more that matters for
 * anything rendered to a signed-out visitor: supabase-js's getUser()
 * does not return `{ user: null }` when nobody is signed in — it
 * returns an AuthSessionMissingError, whose message is the bare string
 * "Auth session missing!". Any caller that treats an error as a failure
 * shows that sentence to a guest as though something had broken.
 *
 * getSession() has no such behaviour: no session is `null`, which is
 * what being signed out actually is.
 */
export async function getSessionUser(): Promise<User | null> {
  const { data, error } = await withTimeout(
    supabase.auth.getSession(),
    8000,
    'Checking your sign-in'
  );
  if (error) throw error;
  return data.session?.user ?? null;
}

/**
 * Auth events that mean "different person, refetch everything".
 *
 * TOKEN_REFRESHED is the one deliberately missing. It fires on a timer
 * and during long uploads, and refetching on it meant a booklist upload
 * could kick every card on the dashboard back to a skeleton for reasons
 * that had nothing to do with the upload.
 */
const RELOAD_EVENTS = new Set(['SIGNED_IN', 'SIGNED_OUT', 'USER_UPDATED']);

/**
 * Subscribe to auth changes without re-entering the auth client.
 *
 * The callback runs inside supabase-js's own notification pass, so
 * calling back into supabase from it is a documented way to deadlock.
 * setTimeout(0) lets that pass finish first; the reload then runs on a
 * clean stack.
 */
export function subscribeToAuthReloads(reload: () => void): () => void {
  const {
    data: { subscription },
  } = supabase.auth.onAuthStateChange((event) => {
    if (!RELOAD_EVENTS.has(event)) return;
    setTimeout(reload, 0);
  });
  return () => subscription.unsubscribe();
}
