/**
 * A snapshot of the auth parameters Supabase put in the URL, taken
 * before anything can clear them.
 *
 * Why a module-level snapshot rather than reading window.location in a
 * component: with detectSessionInUrl on, supabase-js consumes the hash
 * and rewrites the URL as soon as it starts up. By the time a React
 * screen mounts, `#access_token=…&type=signup` is usually gone. This
 * module is imported at the top of utils/supabase.js, so it runs before
 * createClient is ever called — deterministically, not by luck of
 * bundler ordering.
 *
 * Supabase uses two shapes:
 *   implicit flow  #access_token=…&type=signup
 *   PKCE / errors  ?code=…   or   ?error=access_denied&error_code=otp_expired
 */

export interface AuthCallback {
  /** 'signup' | 'recovery' | 'magiclink' | 'invite' | 'email_change' | null */
  type: string | null;
  /** The link carried a session or an exchangeable code. */
  hasTokens: boolean;
  error: string | null;
  errorCode: string | null;
  errorDescription: string | null;
}

const EMPTY: AuthCallback = {
  type: null,
  hasTokens: false,
  error: null,
  errorCode: null,
  errorDescription: null,
};

function read(): AuthCallback {
  // Native, or a static render with no DOM.
  if (typeof window === 'undefined' || !window.location) return EMPTY;

  try {
    const hash = new URLSearchParams(window.location.hash.replace(/^#/, ''));
    const query = new URLSearchParams(window.location.search.replace(/^\?/, ''));
    // URLSearchParams already percent-decodes and turns '+' into a space.
    const get = (key: string) => hash.get(key) ?? query.get(key);

    return {
      type: get('type'),
      hasTokens: !!(get('access_token') || get('code')),
      error: get('error'),
      errorCode: get('error_code'),
      errorDescription: get('error_description'),
    };
  } catch {
    return EMPTY;
  }
}

export const authCallback: AuthCallback = read();

/** True when this page load came from an emailed link of any kind. */
export const arrivedFromEmailLink =
  !!authCallback.type || authCallback.hasTokens || !!authCallback.error;
