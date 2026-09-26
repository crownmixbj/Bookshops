import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../utils/supabase';
import type { Vendor } from '../types/db';

/**
 * Just enough of the vendor's shop row to draw the persistent top bar:
 * the shop name and the peak-season busy flag.
 *
 * Deliberately separate from useVendorDashboard. The shell renders on
 * every page a vendor opens, including the Privacy Policy, and running
 * the full request-queue query there would be wasteful. This is one row.
 *
 * It is also the ONLY writer of busy_mode now that the strip lives in
 * the shell, so there is a single source of truth for a flag buyers can
 * see.
 */
export function useVendorIdentity(enabled: boolean) {
  const [vendor, setVendor] = useState<Vendor | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    if (!enabled) {
      setVendor(null);
      return;
    }
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return;

    const { data } = await supabase
      .from('vendors')
      .select('*')
      // profile_id, not owner_id: vendors has no owner_id column, so the
      // old filter errored and every vendor saw "Your shop" with busy
      // mode stuck off.
      .eq('profile_id', user.id)
      .maybeSingle();
    setVendor((data as Vendor) ?? null);
  }, [enabled]);

  useEffect(() => {
    let active = true;
    load().catch(() => {
      // A vendor with no shop row yet is a normal state, not an error;
      // the top bar falls back to "Your shop".
      if (active) setVendor(null);
    });
    return () => {
      active = false;
    };
  }, [load]);

  /** Writes through immediately — the UI must never show ON while the
   *  database says OFF, because buyers are shown this. */
  const setBusyMode = useCallback(
    async (next: boolean) => {
      if (!vendor) return;
      setSaving(true);
      const { error } = await supabase
        .from('vendors')
        .update({ busy_mode: next })
        .eq('id', vendor.id);
      setSaving(false);
      if (!error) setVendor((prev) => (prev ? { ...prev, busy_mode: next } : prev));
    },
    [vendor]
  );

  return { vendor, setBusyMode, saving, refresh: load };
}
