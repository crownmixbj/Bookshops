import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '../utils/supabase';
import type {
  ActivityEntry,
  AdminAction,
  ContentReport,
  Order,
  PlatformStats,
  Profile,
  Vendor,
} from '../types/db';

/**
 * Everything the admin console reads and does.
 *
 * The security posture, so it survives future edits:
 *
 *  - Reads work because of admin SELECT policies gated on `is_admin()`,
 *    a SECURITY DEFINER function. A non-admin running this exact code
 *    gets empty arrays, not an error — RLS filters rows, it does not
 *    complain.
 *
 *  - WRITES DO NOT GO THROUGH TABLES. Every mutation is an RPC that
 *    re-checks is_admin() server-side, enforces its own invariants and
 *    writes an audit row. Do not "simplify" any of these into a
 *    supabase.from(...).update(...) — there is no admin UPDATE policy,
 *    so it would fail, and if you added one you would lose both the
 *    invariants and the audit trail.
 *
 *  - Notably an admin cannot promote anyone to admin, demote another
 *    admin, or suspend themselves. Those are refused in the database,
 *    not merely hidden in this UI.
 */

export interface AdminUserRow extends Profile {
  vendor: Vendor | null;
}

export function useAdminDashboard() {
  const [stats, setStats] = useState<PlatformStats | null>(null);
  const [users, setUsers] = useState<AdminUserRow[]>([]);
  const [pendingVendors, setPendingVendors] = useState<Vendor[]>([]);
  const [reports, setReports] = useState<ContentReport[]>([]);
  const [featured, setFeatured] = useState<Vendor[]>([]);
  const [activity, setActivity] = useState<ActivityEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState<Record<string, boolean>>({});
  const [error, setError] = useState<Error | null>(null);
  /** Null until known; false means signed in but not an admin. */
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null);

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
        setIsAdmin(false);
        return;
      }

      const { data: me, error: meError } = await supabase
        .from('profiles')
        .select('role')
        .eq('id', user.id)
        .maybeSingle();
      if (meError) throw meError;

      const admin = me?.role === 'admin';
      setIsAdmin(admin);
      if (!admin) return;

      // One RPC for the headline numbers rather than counting rows in
      // the client — the client would have to fetch every row to do it.
      const { data: statsData, error: statsError } = await supabase.rpc('admin_platform_stats');
      if (statsError) throw statsError;
      setStats(statsData as PlatformStats);

      const [profilesRes, vendorsRes, reportsRes, actionsRes, ordersRes] = await Promise.all([
        supabase
          .from('profiles')
          .select('*')
          .order('created_at', { ascending: false })
          .limit(200),
        supabase.from('vendors').select('*').order('created_at', { ascending: false }),
        supabase
          .from('content_reports')
          .select('*')
          .eq('status', 'open')
          .order('created_at', { ascending: false })
          .limit(20),
        supabase
          .from('admin_actions')
          .select('*')
          .order('created_at', { ascending: false })
          .limit(15),
        supabase
          .from('orders')
          .select('id, buyer_id, amount, payment_status, created_at')
          .order('created_at', { ascending: false })
          .limit(15),
      ]);

      for (const r of [profilesRes, vendorsRes, reportsRes, actionsRes, ordersRes]) {
        if (r.error) throw r.error;
      }

      const allProfiles = (profilesRes.data ?? []) as Profile[];
      const allVendors = (vendorsRes.data ?? []) as Vendor[];
      const vendorByProfile = new Map(allVendors.map((v) => [v.profile_id, v]));

      setUsers(allProfiles.map((p) => ({ ...p, vendor: vendorByProfile.get(p.id) ?? null })));
      setPendingVendors(allVendors.filter((v) => v.approval_status === 'pending'));
      setFeatured(allVendors.filter((v) => v.featured));
      setReports((reportsRes.data ?? []) as ContentReport[]);

      setActivity(
        buildActivity(
          (actionsRes.data ?? []) as AdminAction[],
          (ordersRes.data ?? []) as Order[],
          allProfiles,
          allVendors
        )
      );
    } catch (e) {
      setError(e as Error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  /** Runs one RPC, keyed so the pressed row can show a spinner. */
  const run = useCallback(
    async (key: string, fn: string, args: Record<string, unknown>) => {
      setWorking((w) => ({ ...w, [key]: true }));
      setError(null);
      const { error: rpcError } = await supabase.rpc(fn, args);
      if (rpcError) {
        // The database refuses forbidden actions (promoting to admin,
        // suspending yourself). Surface the message it gives rather than
        // inventing one — it is the authoritative reason.
        setError(new Error(rpcError.message));
      } else {
        await load();
      }
      setWorking((w) => {
        const next = { ...w };
        delete next[key];
        return next;
      });
    },
    [load]
  );

  return {
    isAdmin,
    stats,
    users,
    pendingVendors,
    reports,
    featured,
    activity,
    loading,
    working,
    error,
    refresh: load,

    setRole: (target: string, role: 'buyer' | 'vendor') =>
      run(`role:${target}`, 'admin_set_role', { p_target: target, p_role: role }),
    setSuspended: (target: string, suspended: boolean, reason?: string) =>
      run(`susp:${target}`, 'admin_set_suspended', {
        p_target: target,
        p_suspended: suspended,
        p_reason: reason ?? null,
      }),
    reviewVendor: (vendorId: string, approve: boolean, note?: string) =>
      run(`review:${vendorId}`, 'admin_review_vendor', {
        p_vendor: vendorId,
        p_approve: approve,
        p_note: note ?? null,
      }),
    setFeatured: (vendorId: string, isFeatured: boolean) =>
      run(`feat:${vendorId}`, 'admin_set_featured', {
        p_vendor: vendorId,
        p_featured: isFeatured,
      }),
    resolveReport: (reportId: string, status: 'actioned' | 'dismissed', note?: string) =>
      run(`rep:${reportId}`, 'admin_resolve_report', {
        p_report: reportId,
        p_status: status,
        p_note: note ?? null,
      }),
  };
}

/**
 * Merges admin actions, orders and signups into one timeline.
 *
 * Derived rather than logged: it reflects the current state of those
 * tables, so an edited or deleted row changes history. Good enough for
 * an at-a-glance feed; if you need a real audit timeline, `admin_actions`
 * already is one and should be the thing you extend.
 */
function buildActivity(
  actions: AdminAction[],
  orders: Order[],
  profiles: Profile[],
  vendors: Vendor[]
): ActivityEntry[] {
  const nameOf = (id: string | null) =>
    profiles.find((p) => p.id === id)?.full_name?.trim() || 'a user';
  const vendorName = (id: string) =>
    vendors.find((v) => v.id === id)?.store_name ?? 'a shop';

  const fromActions: ActivityEntry[] = actions.map((a) => {
    const who = nameOf(a.actor_id);
    const text =
      a.action === 'approve_vendor'
        ? `${who} approved vendor "${vendorName(a.subject_id)}"`
        : a.action === 'reject_vendor'
        ? `${who} rejected vendor "${vendorName(a.subject_id)}"`
        : a.action === 'suspend_user'
        ? `${who} suspended ${nameOf(a.subject_id)}`
        : a.action === 'unsuspend_user'
        ? `${who} lifted the suspension on ${nameOf(a.subject_id)}`
        : a.action === 'set_role'
        ? `${who} changed ${nameOf(a.subject_id)}'s role to ${String(a.detail?.role ?? '')}`
        : a.action === 'feature_vendor'
        ? `${who} featured "${vendorName(a.subject_id)}"`
        : a.action === 'unfeature_vendor'
        ? `${who} removed "${vendorName(a.subject_id)}" from featured`
        : `${who} resolved a report`;
    return { id: `a-${a.id}`, kind: 'admin', icon: 'shield-checkmark-outline', text, at: a.created_at };
  });

  const fromOrders: ActivityEntry[] = orders.map((o) => ({
    id: `o-${o.id}`,
    kind: 'order',
    icon: 'cube-outline',
    text: `New order by ${nameOf(o.buyer_id)}${
      o.amount != null ? ` — ₦${Math.round(Number(o.amount)).toLocaleString('en-NG')}` : ''
    }`,
    at: o.created_at,
  }));

  const fromSignups: ActivityEntry[] = profiles.slice(0, 10).map((p) => ({
    id: `p-${p.id}`,
    kind: 'signup',
    icon: 'person-add-outline',
    text: `${p.full_name?.trim() || 'A new user'} joined as ${p.role}`,
    at: p.created_at,
  }));

  return [...fromActions, ...fromOrders, ...fromSignups]
    .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())
    .slice(0, 25);
}

/** Percent change of the last 7 days against the 7 before, for a sparkline. */
export function trendFor(series: number[] | undefined): number | null {
  if (!series || series.length < 14) return null;
  const prev = series.slice(0, 7).reduce((a, b) => a + Number(b), 0);
  const curr = series.slice(7).reduce((a, b) => a + Number(b), 0);
  if (prev === 0) return curr === 0 ? 0 : null; // no baseline: show nothing, not "+∞%"
  return ((curr - prev) / prev) * 100;
}

export function useAdminMetrics(stats: PlatformStats | null) {
  return useMemo(
    () => [
      { key: 'users', label: 'Total Users', value: stats?.totals.users ?? 0, series: stats?.series.users },
      { key: 'vendors', label: 'Total Vendors', value: stats?.totals.vendors ?? 0, series: stats?.series.vendors },
      { key: 'orders', label: 'Total Orders', value: stats?.totals.orders ?? 0, series: stats?.series.orders },
      { key: 'booklists', label: 'Total Booklists', value: stats?.totals.booklists ?? 0, series: stats?.series.booklists },
      {
        key: 'revenue',
        label: 'Platform Revenue',
        value: stats?.totals.revenue ?? 0,
        series: stats?.series.revenue,
        isMoney: true,
      },
    ],
    [stats]
  );
}
