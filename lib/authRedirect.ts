import { Platform } from 'react-native';

/**
 * Where Supabase should send someone after they click a confirmation or
 * password-reset link.
 *
 * Without this, Supabase falls back to the project's Site URL, which is
 * a single fixed value — so a link clicked from a preview deployment, or
 * from localhost during development, would bounce the person to
 * production. Deriving it from the current origin keeps each environment
 * self-contained.
 *
 * Every URL used here must also be listed under Authentication →
 * URL Configuration → Redirect URLs in the Supabase dashboard, or
 * Supabase refuses the redirect.
 */
export function emailRedirectTo(): string | undefined {
  if (Platform.OS === 'web') {
    if (typeof window === 'undefined') return undefined;
    return `${window.location.origin}/auth/login`;
  }
  // app.json sets "scheme": "bookshops", so this opens the installed app.
  return 'bookshops://auth/login';
}
