import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '../utils/supabase';
import { getSessionUser, subscribeToAuthReloads } from '../lib/loadState';

/**
 * Everything the profile dropdown shows, for either role.
 *
 * Every value here is read from Supabase. There is no placeholder
 * section any more:
 *   full_name, phone_number, role      profiles
 *   email, email verification          auth.users (email_confirmed_at)
 *   active booklists, pending quotes   book_requests / quotes  (buyer)
 *   delivery address                   profiles.default_delivery_*
 *   saved shops count                  saved_shops
 *   shop name, address, city, active   vendors                 (vendor)
 *   rating and review count            vendors.rating / review_count
 *   completed orders                   orders via quotes       (vendor)
 *
 * The three fixtures that used to live here — two invented Lagos
 * addresses, a saved-shops count of 4, and a 4.8-star rating with 132
 * reviews — were shown on real people's profiles and on real
 * businesses. Each of them had a real source in the database the whole
 * time; the tables simply landed after the fixtures did. A rating in
 * particular is not decoration: it is the number a parent uses to pick
 * who to buy from.
 *
 * Counts use { count: 'exact', head: true } so Postgres returns a count
 * without shipping any rows.
 */

/**
 * The buyer's delivery address, in the shape the menu renders.
 *
 * A LIST with one entry at most, not because there is a list in the
 * database but because the menu already renders a list and the schema
 * may grow one later — `profiles` holds exactly one default address
 * today (address, city, state, phone), so a buyer has one or none.
 *
 * Returns [] rather than a placeholder row when nothing is set. An
 * address the buyer has not given is not an address, and a greyed
 * example in its place is the thing this replaced: two invented Lagos
 * streets that a parent could mistake for their own saved details.
 */
export function deliveryAddressesFrom(profile) {
  const line1 = (profile?.default_delivery_address ?? '').trim();
  const city = (profile?.default_delivery_city ?? '').trim();
  const state = (profile?.default_delivery_state ?? '').trim();
  // The street is what makes it an address. A city on its own cannot be
  // delivered to, so it is not worth a row.
  if (!line1) return [];
  return [
    {
      id: 'default',
      label: 'Default delivery address',
      line1,
      // "Ikeja, Lagos" when both are set; whichever exists otherwise.
      city: [city, state].filter(Boolean).join(', '),
      phone: (profile?.default_delivery_phone ?? '').trim() || null,
      is_default: true,
    },
  ];
}

/**
 * A shop's rating, or null when nobody has rated it.
 *
 * vendors.rating is nullable and review_count defaults to 0, so a new
 * shop reads as (null, 0). Rendering that as "0 ★" would say the shop
 * was rated badly rather than not yet rated — the opposite of true, and
 * on a marketplace that is somebody's livelihood.
 */
export function vendorRatingFrom(vendor) {
  const count = Number(vendor?.review_count ?? 0);
  const rating = vendor?.rating == null ? null : Number(vendor.rating);
  if (rating == null || !Number.isFinite(rating) || count < 1) return null;
  return { rating, review_count: count };
}

const EMPTY = {
  user: null,
  profile: null,
  vendor: null,
  addresses: [],
  savedShopsCount: 0,
  counts: { activeBooklists: 0, pendingQuotes: 0, completedOrders: 0 },
};

export function useProfileDetails({ enabled = true } = {}) {
  const [state, setState] = useState(EMPTY);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  /**
   * Generation guard. Opening the menu, signing out and signing back in
   * can leave two loads in flight; without this the slower one wins and
   * writes the wrong person's details into the card.
   */
  const runId = useRef(0);
  const alive = useRef(true);

  const load = useCallback(async () => {
    const run = ++runId.current;
    const current = () => alive.current && runId.current === run;

    setLoading(true);
    setError(null);
    try {
      // getSessionUser(), NOT supabase.auth.getUser().
      //
      // This one line was the "Auth session missing!" badge in the
      // profile menu. getUser() does not answer "nobody is signed in"
      // with { user: null } — it answers with an AuthSessionMissingError
      // whose message is exactly that string. The `if (!user)` branch
      // below was therefore unreachable: every signed-out open of this
      // menu went through `throw userError` into setError, and the card
      // rendered the raw message with a Retry button that could only
      // ever produce the same error again.
      //
      // Nobody saw it while the app bounced guests to /auth/login. Guest
      // browsing is what made a signed-out header reachable, and this
      // was waiting behind it.
      //
      // getSession() reads the cached session and reports no session as
      // null, which is what being signed out actually is.
      const user = await getSessionUser();
      if (!current()) return;
      if (!user) {
        // A clean signed-out state, not a failure. No error is set, so
        // the menu has nothing to show and the caller renders the guest
        // path instead.
        setState(EMPTY);
        return;
      }

      const { data: profile, error: profileError } = await supabase
        .from('profiles')
        .select(
          'id, full_name, phone_number, role, created_at, ' +
            'default_delivery_address, default_delivery_city, ' +
            'default_delivery_state, default_delivery_phone'
        )
        .eq('id', user.id)
        .maybeSingle();
      if (profileError) throw profileError;

      const role = profile?.role ?? 'buyer';
      let vendor = null;
      let savedShopsCount = 0;
      const counts = { activeBooklists: 0, pendingQuotes: 0, completedOrders: 0 };

      if (role === 'vendor') {
        const { data: v, error: vendorError } = await supabase
          .from('vendors')
          .select('id, store_name, address, city, is_active, created_at, rating, review_count')
          .eq('profile_id', user.id)
          .maybeSingle();
        if (vendorError) throw vendorError;
        vendor = v ?? null;

        if (vendor) {
          // Orders belonging to this vendor's quotes. !inner makes the
          // embedded filter a join condition rather than a null column.
          const { count, error: ordersError } = await supabase
            .from('orders')
            .select('id, quotes!inner(vendor_id)', { count: 'exact', head: true })
            .eq('quotes.vendor_id', vendor.id)
            .eq('fulfillment_status', 'delivered');
          if (ordersError) throw ordersError;
          counts.completedOrders = count ?? 0;
        }
      } else {
        const { count: booklists, error: brError } = await supabase
          .from('book_requests')
          .select('id', { count: 'exact', head: true })
          .eq('buyer_id', user.id)
          .in('status', ['pending_quote', 'quoted']);
        if (brError) throw brError;
        counts.activeBooklists = booklists ?? 0;

        // quotes_select_own_side already scopes this to the buyer's own
        // requests, so no extra filter on request ownership is needed.
        const { count: quotes, error: qError } = await supabase
          .from('quotes')
          .select('id', { count: 'exact', head: true })
          .eq('status', 'sent');
        if (qError) throw qError;
        counts.pendingQuotes = quotes ?? 0;

        // saved_shops_select_own already scopes this to the signed-in
        // buyer, so the count needs no filter of its own. Not fatal:
        // a shop-count query that fails should cost the number, not the
        // whole profile card.
        const { count: saved, error: savedError } = await supabase
          .from('saved_shops')
          .select('vendor_id', { count: 'exact', head: true });
        if (savedError) console.warn('[profile] saved shops count failed:', savedError.message);
        savedShopsCount = saved ?? 0;
      }

      if (!current()) return;
      setState({
        user,
        profile: profile ?? null,
        vendor,
        counts,
        savedShopsCount,
        addresses: deliveryAddressesFrom(profile),
      });
    } catch (e) {
      if (!current()) return;
      // The profile is gone with the session; leaving the last person's
      // name and counts on screen under an error is worse than an empty
      // card, and on a shared device it is a leak.
      setState(EMPTY);
      setError(e);
    } finally {
      if (current()) setLoading(false);
    }
  }, []);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  useEffect(() => {
    if (enabled) load();
  }, [enabled, load]);

  /**
   * Wipe on sign-out, immediately and without a query.
   *
   * A signed-out session leaves nothing to show, and waiting for the
   * next load() to discover that means a frame — or a whole closed
   * menu's worth of time — where the previous user's name, email and
   * counts are still mounted. Cheap to do, and the only thing that makes
   * "session null ⇒ user and profile null" true rather than eventual.
   */
  useEffect(() => {
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event) => {
      if (event !== 'SIGNED_OUT') return;
      // Invalidates any load still in flight, so a response that arrives
      // after the sign-out cannot repopulate the card.
      runId.current++;
      setState(EMPTY);
      setError(null);
      setLoading(false);
    });
    return () => subscription.unsubscribe();
  }, []);

  // Anything other than a sign-out that changes who is signed in — a
  // sign-in from the inline sheet, a profile update — refetches.
  useEffect(() => {
    if (!enabled) return;
    return subscribeToAuthReloads(() => {
      void load();
    });
  }, [enabled, load]);

  const { user, profile, vendor, counts, savedShopsCount, addresses } = state;
  const role = profile?.role ?? 'buyer';

  return {
    loading,
    error,
    refresh: load,
    /**
     * No session. Distinct from `error`: nothing went wrong, there is
     * simply nobody to show. The caller renders a sign-in path rather
     * than a broken profile card.
     */
    signedOut: !loading && !error && user === null,
    user,
    profile,
    vendor,
    counts,
    role,
    isVendor: role === 'vendor',
    email: user?.email ?? '',
    // Real: Supabase stamps this when the confirmation link is followed.
    emailVerified: Boolean(user?.email_confirmed_at ?? user?.confirmed_at),
    displayName:
      profile?.full_name?.trim() || user?.email?.split('@')[0] || 'Your account',
    /** Real: the buyer's own default address, or [] when unset. */
    addresses,
    /** Real: rows in saved_shops belonging to this buyer. */
    savedShopsCount,
    /** Real: null until the shop has at least one review. */
    vendorRating: vendorRatingFrom(vendor),
  };
}
