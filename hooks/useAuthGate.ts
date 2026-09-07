import { useCallback, useRef, useState } from 'react';
import { useAuthSession } from './useAuthSession';

export interface AuthGate {
  /** True once a real session exists. */
  signedIn: boolean;
  /** Still working out whether there is one. */
  resolving: boolean;
  /**
   * Run `action` if signed in; otherwise raise the sign-in sheet with a
   * sentence explaining what was being attempted.
   *
   * Returns true when the action ran, so a caller that needs to know —
   * one that would otherwise close a modal behind the prompt — can.
   */
  requireAuth: (action: () => void, reason?: string) => boolean;
  /** Bind to <SignInPrompt />. */
  promptVisible: boolean;
  promptReason: string | undefined;
  closePrompt: () => void;
  /**
   * Pass to <SignInPrompt onAuthenticated={...} />.
   *
   * Runs the action that was blocked, now that there is a session. The
   * sheet signs in without navigating, so by the time this fires the
   * screen that called requireAuth is still mounted with all of its
   * state — which is the entire point: a guest gets on with what they
   * were doing rather than starting it again.
   */
  onAuthenticated: () => void;
}

/**
 * Lazy auth, at the point of intent.
 *
 * Browsing needs no account; acting does. Rather than a wall at the door
 * this wraps the individual act — send a booklist, check out — so a
 * guest gets as far as the moment their identity actually matters, and
 * is told what they were stopped for rather than just "log in".
 */
export function useAuthGate(): AuthGate {
  const { session, initialized } = useAuthSession();
  const [promptReason, setPromptReason] = useState<string | undefined>(undefined);
  const [promptVisible, setPromptVisible] = useState(false);
  /**
   * What they were trying to do when they were stopped.
   *
   * A ref, not state: it is read once by onAuthenticated and must not
   * cause a render on the way in. Cleared as it is read, so a second
   * sign-in in the same session cannot replay a stale action.
   */
  const pending = useRef<(() => void) | null>(null);

  const requireAuth = useCallback(
    (action: () => void, reason?: string) => {
      // Never gate on a session that has not resolved yet: on a cold
      // start that would prompt a signed-in user for the first frame.
      if (!initialized) return false;
      if (session) {
        action();
        return true;
      }
      pending.current = action;
      setPromptReason(reason);
      setPromptVisible(true);
      return false;
    },
    [session, initialized]
  );

  return {
    signedIn: Boolean(session),
    resolving: !initialized,
    requireAuth,
    promptVisible,
    promptReason,
    closePrompt: useCallback(() => {
      // Dismissing is a decision not to act. Dropping the pending action
      // here is what stops it firing later, out of context, on some
      // unrelated sign-in.
      pending.current = null;
      setPromptVisible(false);
    }, []),
    onAuthenticated: useCallback(() => {
      const action = pending.current;
      pending.current = null;
      action?.();
    }, []),
  };
}
