import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '../utils/supabase';
import type { RecentlyViewedShop, SavedShop, ShopView, Vendor } from '../types/db';

const VENDOR_COLUMNS =
  'id, profile_id, store_name, address, city, is_active, phone, email, verified_at, rating, review_count, completed_orders, created_at, updated_at';

/**
 * The buyer's saved shops and browsing history.
 *
 * Security: `saved_shops` and `recently_viewed_shops` are filtered on the
 * authenticated user's id, and their RLS policies enforce the same thing
 * server-side — neither table is readable by anyone else, including the
 * vendors themselves (which buyers bookmarked a shop is the buyer's
 * business, not the shop's).
 *
 * Vendor rows come through `vendors_select_active`. The rating and
 * completed_orders figures on them are maintained by database triggers,
 * not written by this client.
 */
export function useSavedShops() {
  const [userId, setUserId] = useState<string | null>(null);
  const [saved, setSaved] = useState<ShopView[]>([]);
  const [recent, setRecent] = useState<ShopView[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  /** Vendor ids with an in-flight save/unsave, so buttons can disable. */
  const [pending, setPending] = useState<Record<string, boolean>>({});

  const load = useCallback(async ({ isRefresh = false } = {}) => {
    isRefresh ? setRefreshing(true) : setLoading(true);
    setError(null);
    try {
      const {
        data: { user },
        error: userError,
      } = await supabase.auth.getUser();
      if (userError) throw userError;
      if (!user) {
        setUserId(null);
        setSaved([]);
        setRecent([]);
        return;
      }
      setUserId(user.id);

      const [savedRes, recentRes] = await Promise.all([
        supabase
          .from('saved_shops')
          .select(`profile_id, vendor_id, created_at, vendors ( ${VENDOR_COLUMNS} )`)
          .eq('profile_id', user.id)
          .order('created_at', { ascending: false }),
        supabase
          .from('recently_viewed_shops')
          .select(`profile_id, vendor_id, viewed_at, vendors ( ${VENDOR_COLUMNS} )`)
          .eq('profile_id', user.id)
          .order('viewed_at', { ascending: false })
          .limit(8),
      ]);

      if (savedRes.error) throw savedRes.error;
      if (recentRes.error) throw recentRes.error;

      type SavedRow = SavedShop & { vendors: Vendor | null };
      type RecentRow = RecentlyViewedShop & { vendors: Vendor | null };

      const savedRows = (savedRes.data ?? []) as unknown as SavedRow[];
      const recentRows = (recentRes.data ?? []) as unknown as RecentRow[];
      const savedIds = new Set(savedRows.map((r) => r.vendor_id));

      // A vendor row can come back null if it was deactivated after being
      // saved — vendors_select_active hides inactive shops the buyer does
      // not own. Drop those rather than rendering a blank card.
      setSaved(
        savedRows
          .filter((r) => r.vendors)
          .map((r) => ({
            ...(r.vendors as Vendor),
            isSaved: true,
            savedAt: r.created_at,
            viewedAt: null,
            isVerified: Boolean(r.vendors?.verified_at),
          }))
      );

      setRecent(
        recentRows
          .filter((r) => r.vendors)
          .map((r) => ({
            ...(r.vendors as Vendor),
            isSaved: savedIds.has(r.vendor_id),
            savedAt: null,
            viewedAt: r.viewed_at,
            isVerified: Boolean(r.vendors?.verified_at),
          }))
      );
    } catch (e) {
      setError(e as Error);
      setSaved([]);
      setRecent([]);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    load();
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(() => load());
    return () => subscription.unsubscribe();
  }, [load]);

  /**
   * Save or unsave, applied to local state first so the star responds
   * immediately, and rolled back if the write fails.
   */
  const toggleSaved = useCallback(
    async (vendor: ShopView) => {
      if (!userId) return;
      const willSave = !vendor.isSaved;

      setPending((p) => ({ ...p, [vendor.id]: true }));
      const previousSaved = saved;
      const previousRecent = recent;

      setSaved((list) =>
        willSave
          ? [{ ...vendor, isSaved: true, savedAt: new Date().toISOString() }, ...list]
          : list.filter((v) => v.id !== vendor.id)
      );
      setRecent((list) =>
        list.map((v) => (v.id === vendor.id ? { ...v, isSaved: willSave } : v))
      );

      try {
        if (willSave) {
          const { error: e } = await supabase
            .from('saved_shops')
            .upsert(
              { profile_id: userId, vendor_id: vendor.id },
              { onConflict: 'profile_id,vendor_id' }
            );
          if (e) throw e;
        } else {
          const { error: e } = await supabase
            .from('saved_shops')
            .delete()
            .eq('profile_id', userId)
            .eq('vendor_id', vendor.id);
          if (e) throw e;
        }
      } catch (e) {
        setSaved(previousSaved);
        setRecent(previousRecent);
        setError(e as Error);
      } finally {
        setPending((p) => {
          const next = { ...p };
          delete next[vendor.id];
          return next;
        });
      }
    },
    [userId, saved, recent]
  );

  /**
   * Records a visit. Upsert on the composite key so revisiting a shop
   * moves it up the list rather than adding a row each time.
   * Fire-and-forget: a failed history write should never block browsing.
   */
  const recordView = useCallback(
    async (vendorId: string) => {
      if (!userId) return;
      const { error: e } = await supabase.from('recently_viewed_shops').upsert(
        { profile_id: userId, vendor_id: vendorId, viewed_at: new Date().toISOString() },
        { onConflict: 'profile_id,vendor_id' }
      );
      if (e) console.warn('[shops] could not record view:', e.message);
    },
    [userId]
  );

  /** Recently viewed, minus anything already in the saved grid. */
  const recentUnsaved = useMemo(() => {
    const savedIds = new Set(saved.map((v) => v.id));
    return recent.filter((v) => !savedIds.has(v.id));
  }, [saved, recent]);

  return {
    userId,
    saved,
    recent: recentUnsaved,
    loading,
    refreshing,
    error,
    pending,
    toggleSaved,
    recordView,
    refresh: () => load({ isRefresh: true }),
    reload: load,
  };
}
