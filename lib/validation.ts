import { projectRef } from '../utils/supabase';

/**
 * Form validation and error wording for the auth screens.
 *
 * Kept out of the components so both screens apply the same rules and so
 * the wording can be read (and corrected) in one place. Nothing here
 * touches React or react-native, so it runs identically on iOS, Android
 * and in a static web export.
 */

/** Per-field messages, keyed by field name. `undefined` means valid. */
export type FieldErrors<K extends string = string> = Partial<Record<K, string>>;

/**
 * Deliberately loose. The only address that truly validates an email is
 * the one that receives a message, so this catches typos ("bola@gmail")
 * without rejecting addresses that are legal but unusual.
 */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/** Supabase's own default minimum. Raising it here would let the client
 *  accept a password the server then rejects. */
export const MIN_PASSWORD_LENGTH = 6;

export function validateEmail(value: string): string | undefined {
  const email = value.trim();
  if (!email) return 'Enter your email address.';
  if (!EMAIL_RE.test(email)) return "That doesn't look like an email address.";
  return undefined;
}

/**
 * `requireStrong` is for sign-up, where we are creating the password.
 * On sign-in we only check that something was typed: judging the length
 * of an existing password would tell the wrong story when the real
 * problem is that it is simply wrong.
 */
export function validatePassword(
  value: string,
  options: { requireStrong?: boolean } = {}
): string | undefined {
  if (!value) return 'Enter your password.';
  if (options.requireStrong && value.length < MIN_PASSWORD_LENGTH) {
    return `Use at least ${MIN_PASSWORD_LENGTH} characters.`;
  }
  return undefined;
}

export function validateFullName(value: string): string | undefined {
  const name = value.trim();
  if (!name) return 'Enter your name.';
  if (name.length < 2) return 'That name looks too short.';
  return undefined;
}

export function hasErrors(errors: FieldErrors): boolean {
  return Object.values(errors).some(Boolean);
}

/**
 * Turns a Supabase auth error into something a person can act on.
 *
 * Anything unrecognised is passed through unchanged — inventing a
 * friendlier sentence for an error we have not seen would hide the only
 * clue there is.
 */
export function describeAuthError(message: string): string {
  // A URL and a key from two different projects produce this, and the
  // raw text says nothing about WHICH project was called. Naming the ref
  // turns a dead end into an obvious fix — this is exactly the failure
  // that took the deployed site down.
  if (/api key/i.test(message)) {
    return projectRef
      ? `${message} — this build is calling project "${projectRef}". ` +
          'Check that EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY ' +
          'are from the same Supabase project.'
      : message;
  }
  if (/invalid login credentials/i.test(message)) {
    return "That email and password don't match an account. Check both and try again.";
  }
  if (/email not confirmed/i.test(message)) {
    return "Your email address hasn't been confirmed yet. Open the link we sent you, then sign in.";
  }
  if (/already registered|already been registered|already exists/i.test(message)) {
    return 'An account already exists with that email. Sign in instead.';
  }
  if (/password should be at least/i.test(message)) {
    return `Your password is too short — use at least ${MIN_PASSWORD_LENGTH} characters.`;
  }
  if (/rate limit|too many requests/i.test(message)) {
    return 'Too many attempts. Wait a minute, then try again.';
  }
  if (/failed to fetch|network ?request ?failed|networkerror/i.test(message)) {
    return 'Could not reach the server. Check your connection and try again.';
  }
  return message;
}

/** What to tell someone who arrived from an emailed link. */
export interface CallbackNotice {
  tone: 'success' | 'error' | 'info';
  message: string;
  detail?: string;
}

/**
 * Turns the URL parameters from a confirmation / recovery link into
 * something worth showing.
 *
 * Returns null when the link carried a working session — in that case
 * app/_layout.js is already routing the person to their dashboard, and
 * flashing "Email confirmed!" on a screen that is about to disappear is
 * just noise.
 */
export function describeAuthCallback(cb: {
  type: string | null;
  hasTokens: boolean;
  error: string | null;
  errorCode: string | null;
  errorDescription: string | null;
}): CallbackNotice | null {
  if (cb.error) {
    // The single most common one, and the raw text ("Email link is
    // invalid or has expired") does not say what to do next.
    if (cb.errorCode === 'otp_expired' || /expired/i.test(cb.errorDescription ?? '')) {
      return {
        tone: 'error',
        message: 'That link has expired.',
        detail:
          'Confirmation links last 24 hours and work once. Sign up again with the same email, or ask us to resend it.',
      };
    }
    if (cb.error === 'access_denied') {
      return {
        tone: 'error',
        message: 'That link could not be used.',
        detail: cb.errorDescription ?? 'It may already have been opened. Try signing in below.',
      };
    }
    return { tone: 'error', message: cb.errorDescription ?? cb.error };
  }

  // A session came back with the link; the layout is mid-redirect.
  if (cb.hasTokens) return null;

  if (cb.type === 'signup' || cb.type === 'email_change') {
    return {
      tone: 'success',
      message: 'Email confirmed. Sign in to continue.',
    };
  }
  if (cb.type === 'recovery') {
    return {
      tone: 'info',
      message: 'Reset link opened.',
      detail: 'Password reset is not built yet — sign in with your existing password, or contact support.',
    };
  }
  return null;
}
