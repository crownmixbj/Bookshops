import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '../utils/supabase';

/**
 * The two records behind a "vendor status".
 *
 * APPROVAL lives on vendors.approval_status and is about the SHOP:
 * pending / approved / rejected. There is no 'suspended' value — the
 * column has a CHECK constraint that does not allow one.
 *
 * SUSPENSION lives on profiles.suspended_at and is about the OWNER'S
 * ACCOUNT. Suspending someone stops them signing in and writing
 * anywhere, not just in their shop.
 *
 * The screen shows one status column because that is what an admin
 * thinks in, but the two are written through different RPCs and a
 * suspended owner outranks an approved shop.
 */
export type VendorStatus = 'pending' | 'approved' | 'rejected' | 'suspended';

export interface AdminVendorRow {
  id: string;
  profile_id: string;
  store_name: string;
  city: string | null;
  address: string | null;
  rating: number | null;
  review_count: number;
  completed_orders: number;
  phone: string | null;
  email: string | null;
  approval_status: 'pending' | 'approved' | 'rejected';
  featured: boolean;
  verified_at: string | null;
  created_at: string;
  review_note: string | null;
  owner_name: string | null;
  owner_phone: string | null;
  suspended_at: string | null;
  suspension_reason: string | null;
  /** approval and suspension collapsed into the one the admin acts on. */
  status: VendorStatus;
}

interface OwnerRow {
  id: string;
  full_name: string | null;
  phone_number: string | null;
  suspended_at: string | null;
  suspension_reason: string | null;
}

export interface VendorStats {
  total: number;
  pending: number;
  approved: number;
  suspended: number;
}

const MISSING = new Set(['42P01', '42883', 'PGRST202', 'PGRST205']);

export function useAdminVendors() {
  const [rows, setRows] = useState<AdminVendorRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [schemaMissing, setSchemaMissing] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);

    // Two queries rather than an embedded select: the profiles embed
    // depends on the FK name staying put, and admins read profiles
    // through their own policy anyway. Joining in JS is cheap at this
    // scale and does not break if a constraint is renamed.
    const [vendorRes, ownerRes] = await Promise.all([
      supabase.from('vendors').select('*').order('created_at', { ascending: false }),
      supabase.from('profiles').select('id, full_name, phone_number, suspended_at, suspension_reason'),
    ]);

    if ([vendorRes, ownerRes].some((r) => r.error && MISSING.has(r.error.code ?? ''))) {
      setSchemaMissing(true);
      setRows([]);
      setLoading(false);
      return;
    }

    const firstError = [vendorRes, ownerRes].find((r) => r.error)?.error;
    if (firstError) {
      setError(new Error(firstError.message));
      setRows([]);
      setLoading(false);
      return;
    }

    const owners = new Map<string, OwnerRow>();
    for (const o of (ownerRes.data ?? []) as OwnerRow[]) owners.set(o.id, o);

    setRows(
      ((vendorRes.data ?? []) as Record<string, unknown>[]).map((v) => {
        const owner = owners.get(v.profile_id as string);
        const approval = (v.approval_status as AdminVendorRow['approval_status']) ?? 'pending';
        return {
          id: v.id as string,
          profile_id: v.profile_id as string,
          store_name: (v.store_name as string) ?? 'Unnamed shop',
          city: (v.city as string) ?? null,
          address: (v.address as string) ?? null,
          rating: v.rating == null ? null : Number(v.rating),
          review_count: Number(v.review_count ?? 0),
          completed_orders: Number(v.completed_orders ?? 0),
          phone: (v.phone as string) ?? null,
          email: (v.email as string) ?? null,
          approval_status: approval,
          featured: !!v.featured,
          verified_at: (v.verified_at as string) ?? null,
          created_at: v.created_at as string,
          review_note: (v.review_note as string) ?? null,
          owner_name: owner?.full_name ?? null,
          owner_phone: owner?.phone_number ?? null,
          suspended_at: owner?.suspended_at ?? null,
          suspension_reason: owner?.suspension_reason ?? null,
          // A suspended owner outranks an approved shop: the shop
          // cannot trade while its owner cannot sign in.
          status: owner?.suspended_at ? 'suspended' : approval,
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

  const stats: VendorStats = useMemo(
    () => ({
      total: rows.length,
      pending: rows.filter((r) => r.status === 'pending').length,
      approved: rows.filter((r) => r.status === 'approved').length,
      suspended: rows.filter((r) => r.status === 'suspended').length,
    }),
    [rows]
  );

  /** Approve or reject the SHOP. Audited server-side. */
  const reviewVendor = useCallback(
    async (vendorId: string, approve: boolean, note?: string) => {
      const { error: e } = await supabase.rpc('admin_review_vendor', {
        p_vendor: vendorId,
        p_approve: approve,
        p_note: note ?? null,
      });
      if (e) return { ok: false, message: e.message };
      await load();
      return { ok: true };
    },
    [load]
  );

  /**
   * Suspend or restore the OWNER'S ACCOUNT. Note the target is the
   * profile id, not the vendor id — passing the wrong one silently
   * suspends nobody.
   */
  const setSuspended = useCallback(
    async (profileId: string, suspended: boolean, reason?: string) => {
      const { error: e } = await supabase.rpc('admin_set_suspended', {
        p_target: profileId,
        p_suspended: suspended,
        p_reason: reason ?? null,
      });
      if (e) return { ok: false, message: e.message };
      await load();
      return { ok: true };
    },
    [load]
  );

  const setFeatured = useCallback(
    async (vendorId: string, featured: boolean) => {
      const { error: e } = await supabase.rpc('admin_set_featured', {
        p_vendor: vendorId,
        p_featured: featured,
      });
      if (e) return { ok: false, message: e.message };
      await load();
      return { ok: true };
    },
    [load]
  );

  return { rows, stats, loading, error, schemaMissing, refresh: load, reviewVendor, setSuspended, setFeatured };
}
