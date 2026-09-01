import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../utils/supabase';

/**
 * Everything the profile dropdown shows, for either role.
 *
 * What is REAL (read from Supabase):
 *   full_name, phone_number, role      profiles
 *   email, email verification          auth.users (email_confirmed_at)
 *   active booklists, pending quotes   book_requests / quotes  (buyer)
 *   shop name, address, city, active   vendors                 (vendor)
 *   completed orders                   orders via quotes       (vendor)
 *
 * What is PLACEHOLDER (no schema for it — each is flagged `demo: true`
 * so the UI can label it rather than quietly inventing a number):
 *   saved delivery addresses   needs an `addresses` table
 *   saved shops count          needs a `saved_shops` join table
 *   vendor average rating      needs vendors.rating / a reviews table
 *
 * Counts use { count: 'exact', head: true } so Postgres returns a count
 * without shipping any rows.
 */

/** TODO(db): needs an `addresses` table (id, profile_id, label, line1, city, is_default). */
export const MOCK_ADDRESSES = [
  { id: 'a1', demo: true, label: 'Home', line1: '14 Adeniyi Jones Ave', city: 'Ikeja, Lagos', is_default: true },
  { id: 'a2', demo: true, label: 'Office', line1: '3 Ozumba Mbadiwe Rd', city: 'Victoria Island, Lagos', is_default: false },
];

/** TODO(db): needs a `saved_shops` table (profile_id, vendor_id). */
export const MOCK_SAVED_SHOPS_COUNT = 4;

/** TODO(db): needs vendors.rating + vendors.review_count, or a reviews table. */
export const MOCK_VENDOR_RATING = { rating: 4.8, review_count: 132 };

const EMPTY = {
  user: null,
  profile: null,
  vendor: null,
  counts: { activeBooklists: 0, pendingQuotes: 0, completedOrders: 0 },
};

export function useProfileDetails({ enabled = true } = {}) {
  const [state, setState] = useState(EMPTY);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const {
        data: { user },
        error: userError,
      } = await supabase.auth.getUser();
      if (userError) throw userError;
      if (!user) {
        setState(EMPTY);
        return;
      }

      const { data: profile, error: profileError } = await supabase
        .from('profiles')
        .select('id, full_name, phone_number, role, created_at')
        .eq('id', user.id)
        .maybeSingle();
      if (profileError) throw profileError;

      const role = profile?.role ?? 'buyer';
      let vendor = null;
      const counts = { activeBooklists: 0, pendingQuotes: 0, completedOrders: 0 };

      if (role === 'vendor') {
        const { data: v, error: vendorError } = await supabase
          .from('vendors')
          .select('id, store_name, address, city, is_active, created_at')
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
      }

      setState({ user, profile: profile ?? null, vendor, counts });
    } catch (e) {
      setError(e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (enabled) load();
  }, [enabled, load]);

  const { user, profile, vendor, counts } = state;
  const role = profile?.role ?? 'buyer';

  return {
    loading,
    error,
    refresh: load,
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
    // Placeholders — see the TODOs above.
    addresses: MOCK_ADDRESSES,
    savedShopsCount: MOCK_SAVED_SHOPS_COUNT,
    vendorRating: MOCK_VENDOR_RATING,
  };
}
