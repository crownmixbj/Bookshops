import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../utils/supabase';
import type { EditableProfile, EditableVendor, Profile, Vendor } from '../types/db';

const PROFILE_COLUMNS =
  'id, full_name, phone_number, role, default_delivery_address, default_delivery_city, default_delivery_phone, notify_email_orders, notify_email_quotes, notify_push_orders, notify_push_quotes, notify_sms_orders, notify_sms_quotes, theme_preference, preferred_currency, created_at, updated_at';

const VENDOR_COLUMNS =
  'id, profile_id, store_name, address, city, is_active, phone, email, verified_at, rating, review_count, completed_orders, created_at, updated_at';

export type SaveState = 'idle' | 'saving' | 'saved' | 'error';

/**
 * Reads and writes the signed-in person's own settings.
 *
 * Security notes worth keeping in mind when extending this:
 *  - Every write is `.eq('id', user.id)`, and `profiles_update_own`
 *    enforces the same server-side. The client filter is belt and braces.
 *  - `role` is deliberately absent from EditableProfile. The policy's
 *    WITH CHECK pins it to its current value, so including it would just
 *    produce a rejected update — better not to offer the control.
 *  - Email changes go through supabase.auth, not this table, because
 *    they need a confirmation round-trip.
 */
export function useSettings() {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [vendor, setVendor] = useState<Vendor | null>(null);
  const [email, setEmail] = useState<string>('');
  const [emailVerified, setEmailVerified] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

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
        setProfile(null);
        setVendor(null);
        return;
      }

      setEmail(user.email ?? '');
      setEmailVerified(Boolean(user.email_confirmed_at ?? user.confirmed_at));

      const { data, error: e } = await supabase
        .from('profiles')
        .select(PROFILE_COLUMNS)
        .eq('id', user.id)
        .maybeSingle();
      if (e) throw e;
      setProfile((data ?? null) as Profile | null);

      if (data?.role === 'vendor') {
        const { data: v, error: ve } = await supabase
          .from('vendors')
          .select(VENDOR_COLUMNS)
          .eq('profile_id', user.id)
          .maybeSingle();
        if (ve) throw ve;
        setVendor((v ?? null) as Vendor | null);
      } else {
        setVendor(null);
      }
    } catch (e) {
      setError(e as Error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  /**
   * Writes a partial profile update.
   *
   * Applies the change locally first so a toggle responds at once, and
   * rolls back on failure — a switch that silently springs back with no
   * explanation is worse than one that never moved.
   */
  const updateProfile = useCallback(
    async (patch: Partial<EditableProfile>): Promise<boolean> => {
      if (!profile) return false;
      const previous = profile;
      setProfile({ ...profile, ...patch } as Profile);
      setError(null);

      const { error: e } = await supabase
        .from('profiles')
        .update({ ...patch, updated_at: new Date().toISOString() })
        .eq('id', profile.id);

      if (e) {
        setProfile(previous);
        setError(e as unknown as Error);
        return false;
      }
      return true;
    },
    [profile]
  );

  /** Upsert, so a vendor registering a shop for the first time works too. */
  const updateVendor = useCallback(
    async (patch: Partial<EditableVendor>): Promise<boolean> => {
      if (!profile || profile.role !== 'vendor') return false;
      setError(null);

      const { error: e } = await supabase.from('vendors').upsert(
        {
          profile_id: profile.id,
          store_name: patch.store_name ?? vendor?.store_name ?? '',
          address: patch.address ?? vendor?.address ?? '',
          city: patch.city ?? vendor?.city ?? '',
          phone: patch.phone ?? vendor?.phone ?? null,
          email: patch.email ?? vendor?.email ?? null,
          busy_mode: patch.busy_mode ?? vendor?.busy_mode ?? false,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'profile_id' }
      );

      if (e) {
        setError(e as unknown as Error);
        return false;
      }
      await load();
      return true;
    },
    [profile, vendor, load]
  );

  /**
   * Changes the account password.
   *
   * Supabase does not ask for the current password here — the session
   * token is the proof of identity. That means a walked-away, unlocked
   * device could change it, which is exactly why the UI should warn
   * rather than pretend a current-password box adds security it does not.
   */
  const changePassword = useCallback(
    async (newPassword: string): Promise<{ ok: boolean; message?: string }> => {
      const { error: e } = await supabase.auth.updateUser({ password: newPassword });
      if (e) return { ok: false, message: e.message };
      return { ok: true };
    },
    []
  );

  const signOut = useCallback(async () => {
    // app/_layout.js watches onAuthStateChange and redirects to login.
    await supabase.auth.signOut();
  }, []);

  return {
    profile,
    vendor,
    email,
    emailVerified,
    isVendor: profile?.role === 'vendor',
    isAdmin: profile?.role === 'admin',
    loading,
    error,
    reload: load,
    updateProfile,
    updateVendor,
    changePassword,
    signOut,
  };
}
