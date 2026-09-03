import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '../utils/supabase';
import type { ShopView, Vendor } from '../types/db';

const VENDOR_COLUMNS =
  'id, profile_id, store_name, address, city, is_active, phone, email, verified_at, rating, review_count, completed_orders, approval_status, featured, busy_mode, busy_note, created_at, updated_at';

/**
 * Every shop a buyer may send a booklist to.
 *
 * Two filters, for two different reasons: `is_active` is the shop's own
 * switch (trading or not), `approval_status = 'approved'` is the
 * administrator's (identity and address checked). A buyer should never
 * be offered a shop failing either — vendors_select_active enforces the
 * first server-side, and this adds the second.
 *
 * Cities come from the rows themselves rather than a fixed list: this
 * marketplace is Nigerian and its coverage grows city by city, so a
 * hardcoded dropdown would be wrong within a month.
 */
export function useVendorDirectory() {
  const [userId, setUserId] = useState<string | null>(null);
  const [shops, setShops] = useState<ShopView[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [pending, setPending] = useState<Record<string, boolean>>({});

  const load = useCallback(async ({ isRefresh = false } = {}) => {
    isRefresh ? setRefreshing(true) : setLoading(true);
    setError(null);
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      setUserId(user?.id ?? null);

      const vendorQuery = supabase
        .from('vendors')
        .select(VENDOR_COLUMNS)
        .eq('is_active', true)
        .eq('approval_status', 'approved')
        // Featured first, then best rated, then the ones with a track
        // record. A brand-new shop with no rating sorts last rather than
        // above everything, which is what `nullsFirst: false` buys.
        .order('featured', { ascending: false })
        .order('rating', { ascending: false, nullsFirst: false })
        .order('completed_orders', { ascending: false });

      // Which of these the buyer has bookmarked, and which they have
      // looked at. Both used to live on the Saved Shops screen; the
      // directory absorbed it, so it has to carry them.
      const savedQuery = user
        ? supabase
            .from('saved_shops')
            .select('vendor_id, created_at')
            .eq('profile_id', user.id)
        : Promise.resolve({ data: [], error: null });

      const viewedQuery = user
        ? supabase
            .from('recently_viewed_shops')
            .select('vendor_id, viewed_at')
            .eq('profile_id', user.id)
            .order('viewed_at', { ascending: false })
            .limit(8)
        : Promise.resolve({ data: [], error: null });

      const [vendorRes, savedRes, viewedRes] = await Promise.all([
        vendorQuery,
        savedQuery,
        viewedQuery,
      ]);
      if (vendorRes.error) throw vendorRes.error;
      if (savedRes.error) throw savedRes.error;
      if (viewedRes.error) throw viewedRes.error;

      const savedAt = new Map(
        ((savedRes.data ?? []) as { vendor_id: string; created_at: string }[]).map((r) => [
          r.vendor_id,
          r.created_at,
        ])
      );
      const viewedAt = new Map(
        ((viewedRes.data ?? []) as { vendor_id: string; viewed_at: string }[]).map((r) => [
          r.vendor_id,
          r.viewed_at,
        ])
      );

      setShops(
        ((vendorRes.data ?? []) as Vendor[]).map((v) => ({
          ...v,
          isSaved: savedAt.has(v.id),
          savedAt: savedAt.get(v.id) ?? null,
          viewedAt: viewedAt.get(v.id) ?? null,
          isVerified: v.verified_at != null,
        }))
      );
    } catch (e) {
      setError(e as Error);
      setShops([]);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  /**
   * Shops this buyer has opened, most recent first.
   *
   * Derived from the same rows the grid renders, so a shop that has
   * since been deactivated or unapproved simply drops out — which is
   * what the old Saved Shops screen had to filter for by hand.
   */
  const recentlyViewed = useMemo(
    () =>
      shops
        .filter((s) => s.viewedAt)
        .sort((a, b) => (b.viewedAt ?? '').localeCompare(a.viewedAt ?? ''))
        .slice(0, 8),
    [shops]
  );

  const savedCount = useMemo(() => shops.filter((s) => s.isSaved).length, [shops]);

  /**
   * Records that the buyer opened a shop. Fire and forget: a failed
   * history write must never stop the shop opening.
   */
  const recordView = useCallback(
    (vendorId: string) => {
      if (!userId) return;
      supabase
        .from('recently_viewed_shops')
        .upsert(
          { profile_id: userId, vendor_id: vendorId, viewed_at: new Date().toISOString() },
          { onConflict: 'profile_id,vendor_id' }
        )
        .then(undefined, () => {});
    },
    [userId]
  );

  /** Distinct cities present in the results, for the filter row. */
  const cities = useMemo(() => {
    const seen = new Set<string>();
    for (const shop of shops) {
      const city = (shop.city ?? '').trim();
      if (city) seen.add(city);
    }
    return [...seen].sort((a, b) => a.localeCompare(b));
  }, [shops]);

  /** Optimistic bookmark toggle; reverts if the write is refused. */
  const toggleSaved = useCallback(
    async (shop: ShopView) => {
      if (!userId) return;
      const nextSaved = !shop.isSaved;

      setPending((p) => ({ ...p, [shop.id]: true }));
      setShops((current) =>
        current.map((s) => (s.id === shop.id ? { ...s, isSaved: nextSaved } : s))
      );

      const { error: e } = nextSaved
        ? await supabase.from('saved_shops').insert({ profile_id: userId, vendor_id: shop.id })
        : await supabase
            .from('saved_shops')
            .delete()
            .eq('profile_id', userId)
            .eq('vendor_id', shop.id);

      if (e) {
        setShops((current) =>
          current.map((s) => (s.id === shop.id ? { ...s, isSaved: !nextSaved } : s))
        );
        setError(e as Error);
      }
      setPending((p) => ({ ...p, [shop.id]: false }));
    },
    [userId]
  );

  return {
    userId,
    shops,
    cities,
    recentlyViewed,
    savedCount,
    recordView,
    loading,
    refreshing,
    error,
    pending,
    toggleSaved,
    refresh: () => load({ isRefresh: true }),
    reload: load,
  };
}
