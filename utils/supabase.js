import { AppState, Platform } from 'react-native';
// FIRST, deliberately: this module snapshots the auth parameters in the
// URL at import time. createClient below is what clears them, so the
// snapshot has to happen before it runs.
import '../lib/authCallback';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

/**
 * Which required variables are missing, if any.
 *
 * These are inlined by Expo at BUILD time, not read at runtime — so a
 * build machine without them (a fresh CI runner, Cloudflare Pages, a
 * teammate's clone) bakes `undefined` into the bundle. createClient then
 * throws "supabaseUrl is required" while the module is still loading,
 * which React cannot catch, so the app renders as a white page with only
 * a cryptic console line to go on.
 *
 * `.env` is gitignored on purpose, so this WILL happen on any new build
 * host until its variables are set there.
 */
export const missingEnv = [
  !supabaseUrl && 'EXPO_PUBLIC_SUPABASE_URL',
  !supabaseAnonKey && 'EXPO_PUBLIC_SUPABASE_ANON_KEY',
].filter(Boolean);

export const isConfigured = missingEnv.length === 0;

/**
 * The project ref this build points at, e.g. "stychjbzqqfbzmwrdhnf".
 *
 * Worth surfacing because the failure it catches is silent: a URL and a
 * key from two different Supabase projects are each individually valid,
 * so the only symptom is "Invalid API key" with nothing naming which
 * project was actually called. This has now caused two debugging
 * sessions on this app.
 */
export const projectRef =
  (supabaseUrl || '').match(/https:\/\/([a-z0-9]+)\.supabase\./)?.[1] ?? null;

if (!isConfigured) {
  console.error(
    `[supabase] Missing ${missingEnv.join(' and ')}. ` +
      'These are inlined at build time, so set them on the build host ' +
      '(Cloudflare Pages → Settings → Variables and Secrets, for both ' +
      'Production and Preview) and redeploy. A local .env only fixes local builds.'
  );
}

/**
 * Placeholders keep createClient from throwing during module load, which
 * is the whole point: a thrown error here is uncatchable and costs you
 * the entire UI. app/_layout.js checks `isConfigured` and renders an
 * explanation instead, so this client is never actually used — and the
 * host is deliberately unresolvable so a stray call fails loudly rather
 * than reaching something real.
 *
 * Substituting a working client shape here was tempting and wrong: it
 * changed the exported type and broke inference in every hook.
 */
export const supabase = createClient(
  supabaseUrl || 'https://unconfigured.invalid',
  supabaseAnonKey || 'unconfigured-anon-key',
  {
    auth: {
      storage: AsyncStorage,
      autoRefreshToken: true,
      persistSession: true,
      // On web this MUST be on, or an emailed confirmation link does
      // nothing: the tokens sit in the URL fragment and are never
      // exchanged for a session, so the person lands back on the login
      // form with no idea their address was confirmed.
      //
      // Off on native, where the tokens arrive through a deep link and
      // are handled by the linking layer instead of window.location.
      detectSessionInUrl: Platform.OS === 'web',
    },
  }
);

if (isConfigured) {
  AppState.addEventListener('change', (state) => {
    if (state === 'active') {
      supabase.auth.startAutoRefresh();
    } else {
      supabase.auth.stopAutoRefresh();
    }
  });
}
