import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '../utils/supabase';

export type UserRole = 'buyer' | 'vendor' | 'admin';

export interface AdminUserRow {
  id: string;
  full_name: string | null;
  phone_number: string | null;
  role: UserRole;
  created_at: string;
  suspended_at: string | null;
  suspension_reason: string | null;
  /** From auth.users via admin_user_directory(); null if that RPC is absent. */
  email: string | null;
  email_confirmed_at: string | null;
  last_sign_in_at: string | null;
  /** This account owns a shop. */
  store_name: string | null;
}

export interface UserStats {
  total: number;
  buyers: number;
  vendors: number;
  suspended: number;
}

const MISSING = new Set(['42P01', '42883', 'PGRST202', 'PGRST205']);

export function useAdminUsers(currentUserId: string | null) {
  const [rows, setRows] = useState<AdminUserRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  /** admin_user_directory() has not been installed; emails are absent. */
  const [directoryMissing, setDirectoryMissing] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    setDirectoryMissing(false);

    const [profileRes, dirRes, vendorRes] = await Promise.all([
      supabase
        .from('profiles')
        .select('id, full_name, phone_number, role, created_at, suspended_at, suspension_reason')
        .order('created_at', { ascending: false }),
      supabase.rpc('admin_user_directory'),
      supabase.from('vendors').select('profile_id, store_name'),
    ]);

    if (profileRes.error) {
      setError(new Error(profileRes.error.message));
      setRows([]);
      setLoading(false);
      return;
    }

    // Emails are a bonus, not a prerequisite: without the RPC the screen
    // still works, it just cannot search by address and says so.
    const emails = new Map<string, { email: string; email_confirmed_at: string | null; last_sign_in_at: string | null }>();
    if (dirRes.error) {
      if (MISSING.has(dirRes.error.code ?? '')) setDirectoryMissing(true);
      else setError(new Error(dirRes.error.message));
    } else {
      for (const u of (dirRes.data ?? []) as { id: string; email: string; email_confirmed_at: string | null; last_sign_in_at: string | null }[]) {
        emails.set(u.id, { email: u.email, email_confirmed_at: u.email_confirmed_at, last_sign_in_at: u.last_sign_in_at });
      }
    }

    const shops = new Map<string, string>();
    for (const v of (vendorRes.data ?? []) as { profile_id: string; store_name: string }[]) {
      shops.set(v.profile_id, v.store_name);
    }

    setRows(
      ((profileRes.data ?? []) as Record<string, unknown>[]).map((p) => {
        const id = p.id as string;
        const auth = emails.get(id);
        return {
          id,
          full_name: (p.full_name as string) ?? null,
          phone_number: (p.phone_number as string) ?? null,
          role: (p.role as UserRole) ?? 'buyer',
          created_at: p.created_at as string,
          suspended_at: (p.suspended_at as string) ?? null,
          suspension_reason: (p.suspension_reason as string) ?? null,
          email: auth?.email ?? null,
          email_confirmed_at: auth?.email_confirmed_at ?? null,
          last_sign_in_at: auth?.last_sign_in_at ?? null,
          store_name: shops.get(id) ?? null,
        };
      })
    );
    setLoading(false);
  }, []);

  useEffect(() => {
    load().catch((e) => {
      setError(e instanceof Error ? e : new Error(String(e)));
      setLoading(false);
    });
  }, [load]);

  const stats: UserStats = useMemo(
    () => ({
      total: rows.length,
      buyers: rows.filter((r) => r.role === 'buyer' && !r.suspended_at).length,
      vendors: rows.filter((r) => r.role === 'vendor').length,
      suspended: rows.filter((r) => !!r.suspended_at).length,
    }),
    [rows]
  );

  const setSuspended = useCallback(
    async (targetId: string, suspended: boolean, reason?: string) => {
      const { error: e } = await supabase.rpc('admin_set_suspended', {
        p_target: targetId,
        p_suspended: suspended,
        p_reason: reason ?? null,
      });
      if (e) return { ok: false, message: e.message };
      await load();
      return { ok: true };
    },
    [load]
  );

  const setRole = useCallback(
    async (targetId: string, role: 'buyer' | 'vendor') => {
      const { error: e } = await supabase.rpc('admin_set_role', { p_target: targetId, p_role: role });
      if (e) return { ok: false, message: e.message };
      await load();
      return { ok: true };
    },
    [load]
  );

  return { rows, stats, loading, error, directoryMissing, currentUserId, refresh: load, setSuspended, setRole };
}

/**
 * Whether an admin may act on this row, and why not.
 *
 * These mirror the checks inside admin_set_role / admin_set_suspended —
 * the server is what enforces them. Repeating them here is only so the
 * UI does not offer a button that is guaranteed to raise.
 */
export function actionability(row: AdminUserRow, currentUserId: string | null) {
  if (row.id === currentUserId) return { allowed: false, reason: 'This is your own account.' };
  if (row.role === 'admin') return { allowed: false, reason: 'Administrators can only be changed with the service key.' };
  return { allowed: true, reason: null as string | null };
}
