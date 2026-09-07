import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '../utils/supabase';
import { SETTLED_PAYMENT_STATUSES } from '../types/db';
import type { PaymentStatus, FulfillmentStatus } from '../types/db';

/**
 * Read models for the four admin management screens.
 *
 * All of them lean on the admin SELECT policies added by
 * bookshops_admin.sql (orders_select_admin, quotes_select_admin,
 * book_requests_select_admin and friends). None of them write; the
 * writes on these screens go through the audited RPCs.
 *
 * Everything is aggregated in JS rather than in SQL views on purpose:
 * this marketplace has hundreds of rows, not millions, and a view is a
 * migration the user has to run for every tweak to a metric.
 */

function err(...results: { error: { message: string } | null }[]): Error | null {
  const first = results.find((r) => r.error)?.error;
  return first ? new Error(first.message) : null;
}

// ============================================================
// 1. Platform analytics
// ============================================================

export interface RegionStat { name: string; orders: number; value: number }
export interface SchoolStat { name: string; requests: number }

export interface AnalyticsData {
  grossVolume: number;
  netRevenue: number;
  commissionRate: number;
  totalOrders: number;
  activeVendors: number;
  /** Booklists that received at least one quote, over all booklists. */
  conversionRate: number | null;
  quotedRequests: number;
  totalRequests: number;
  regions: RegionStat[];
  schools: SchoolStat[];
  classLevels: SchoolStat[];
}

export function useAdminAnalytics() {
  const [data, setData] = useState<AnalyticsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);

    const [orderRes, vendorRes, requestRes, quoteRes, settingsRes] = await Promise.all([
      supabase.from('orders').select('amount, payment_status, delivery_city, created_at'),
      supabase.from('vendors').select('id, approval_status'),
      supabase.from('book_requests').select('id, school_name, class_level, status'),
      supabase.from('quotes').select('request_id, status'),
      supabase.from('payout_settings').select('commission_rate').maybeSingle(),
    ]);

    const problem = err(orderRes, vendorRes, requestRes, quoteRes);
    if (problem) {
      setError(problem);
      setData(null);
      setLoading(false);
      return;
    }

    const orders = (orderRes.data ?? []) as { amount: number | null; payment_status: string; delivery_city: string | null }[];
    // Escrowed money has left the buyer's account, so it counts as
    // taken. Whether it has reached the vendor is a payout question,
    // which is what escrow_released is for.
    const paid = orders.filter((o) =>
      (SETTLED_PAYMENT_STATUSES as string[]).includes(o.payment_status)
    );
    const gross = paid.reduce((s, o) => s + Number(o.amount ?? 0), 0);
    // payout_settings only exists after bookshops_payouts.sql; absent
    // means no commission has been configured, which is 0.
    const rate = Number(settingsRes.data?.commission_rate ?? 0);

    const byCity = new Map<string, { orders: number; value: number }>();
    for (const o of paid) {
      const city = (o.delivery_city ?? '').trim() || 'Unspecified';
      const cur = byCity.get(city) ?? { orders: 0, value: 0 };
      byCity.set(city, { orders: cur.orders + 1, value: cur.value + Number(o.amount ?? 0) });
    }

    const requests = (requestRes.data ?? []) as { id: string; school_name: string; class_level: string }[];
    // Drafts are a vendor's private working copy, never sent. Counting
    // them would inflate the conversion rate, and would disagree with
    // the Booklist Hub, which excludes them.
    const quotedIds = new Set(
      ((quoteRes.data ?? []) as { request_id: string; status: string }[])
        .filter((q) => q.status !== 'draft')
        .map((q) => q.request_id)
    );

    const tally = (key: 'school_name' | 'class_level') => {
      const m = new Map<string, number>();
      for (const r of requests) {
        const k = (r[key] ?? '').trim() || 'Unspecified';
        m.set(k, (m.get(k) ?? 0) + 1);
      }
      return [...m.entries()]
        .map(([name, count]) => ({ name, requests: count }))
        .sort((a, b) => b.requests - a.requests)
        .slice(0, 6);
    };

    const quotedCount = requests.filter((r) => quotedIds.has(r.id)).length;

    setData({
      grossVolume: gross,
      netRevenue: Math.round(gross * rate * 100) / 100,
      commissionRate: rate,
      totalOrders: orders.length,
      activeVendors: ((vendorRes.data ?? []) as { approval_status: string }[])
        .filter((v) => v.approval_status === 'approved').length,
      // Null, not zero: with no booklists at all there is no rate to
      // report, and 0% would read as "nobody ever quotes".
      conversionRate: requests.length === 0 ? null : (quotedCount / requests.length) * 100,
      quotedRequests: quotedCount,
      totalRequests: requests.length,
      regions: [...byCity.entries()]
        .map(([name, v]) => ({ name, ...v }))
        .sort((a, b) => b.value - a.value)
        .slice(0, 6),
      schools: tally('school_name'),
      classLevels: tally('class_level'),
    });
    setLoading(false);
  }, []);

  useEffect(() => {
    load().catch((e) => { setError(e instanceof Error ? e : new Error(String(e))); setLoading(false); });
  }, [load]);

  return { data, loading, error, refresh: load };
}

// ============================================================
// 2. Booklist hub
// ============================================================

export type RequestStatus = 'draft' | 'pending_quote' | 'quoted' | 'ordered' | 'cancelled';

export interface BooklistRow {
  id: string;
  reference: string;
  school_name: string;
  class_level: string;
  status: RequestStatus;
  created_at: string;
  buyer_name: string | null;
  itemCount: number;
  quoteCount: number;
}

export function useAdminBooklists() {
  const [rows, setRows] = useState<BooklistRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);

    const [reqRes, itemRes, quoteRes, profileRes] = await Promise.all([
      supabase.from('book_requests').select('*').order('created_at', { ascending: false }),
      supabase.from('book_request_items').select('request_id'),
      supabase.from('quotes').select('request_id, status'),
      supabase.from('profiles').select('id, full_name'),
    ]);

    const problem = err(reqRes, itemRes, quoteRes);
    if (problem) { setError(problem); setRows([]); setLoading(false); return; }

    const items = new Map<string, number>();
    for (const i of (itemRes.data ?? []) as { request_id: string }[]) {
      items.set(i.request_id, (items.get(i.request_id) ?? 0) + 1);
    }
    const quotes = new Map<string, number>();
    // Drafts are not offers: a vendor who has started typing has not
    // quoted, and counting them would overstate competition.
    for (const q of (quoteRes.data ?? []) as { request_id: string; status: string }[]) {
      if (q.status === 'draft') continue;
      quotes.set(q.request_id, (quotes.get(q.request_id) ?? 0) + 1);
    }
    const names = new Map<string, string>();
    for (const p of (profileRes.data ?? []) as { id: string; full_name: string }[]) names.set(p.id, p.full_name);

    setRows(((reqRes.data ?? []) as Record<string, unknown>[]).map((r) => {
      const id = r.id as string;
      return {
        id,
        reference: id.slice(0, 8).toUpperCase(),
        school_name: (r.school_name as string) ?? '—',
        class_level: (r.class_level as string) ?? '—',
        status: (r.status as RequestStatus) ?? 'pending_quote',
        created_at: r.created_at as string,
        buyer_name: names.get(r.buyer_id as string) ?? null,
        itemCount: items.get(id) ?? 0,
        quoteCount: quotes.get(id) ?? 0,
      };
    }));
    setLoading(false);
  }, []);

  useEffect(() => {
    load().catch((e) => { setError(e instanceof Error ? e : new Error(String(e))); setLoading(false); });
  }, [load]);

  const stats = useMemo(() => ({
    total: rows.length,
    open: rows.filter((r) => r.status === 'pending_quote').length,
    quoted: rows.filter((r) => r.status === 'quoted').length,
    ordered: rows.filter((r) => r.status === 'ordered').length,
    cancelled: rows.filter((r) => r.status === 'cancelled').length,
  }), [rows]);

  return { rows, stats, loading, error, refresh: load };
}

/** Items and quotes for one booklist, fetched when its modal opens. */
export function useBooklistDetail(requestId: string | null) {
  const [items, setItems] = useState<{ id: string; title: string; quantity: number; category: string }[]>([]);
  const [quotes, setQuotes] = useState<{ id: string; vendor: string; total: number; status: string }[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!requestId) { setItems([]); setQuotes([]); return; }
    let active = true;
    setLoading(true);

    (async () => {
      const [itemRes, quoteRes, vendorRes] = await Promise.all([
        supabase.from('book_request_items').select('id, title, quantity, category').eq('request_id', requestId).order('position'),
        supabase.from('quotes').select('id, vendor_id, total_price, status').eq('request_id', requestId),
        supabase.from('vendors').select('id, store_name'),
      ]);
      if (!active) return;
      const shops = new Map<string, string>();
      for (const v of (vendorRes.data ?? []) as { id: string; store_name: string }[]) shops.set(v.id, v.store_name);
      setItems((itemRes.data ?? []) as typeof items);
      setQuotes(((quoteRes.data ?? []) as { id: string; vendor_id: string; total_price: number; status: string }[])
        // A draft is the vendor's private working copy; buyers never see
        // one, and an admin reading "3 quotes" should mean 3 real offers.
        .filter((q) => q.status !== 'draft')
        .map((q) => ({ id: q.id, vendor: shops.get(q.vendor_id) ?? 'Unknown shop', total: Number(q.total_price ?? 0), status: q.status })));
      setLoading(false);
    })().catch(() => { if (active) setLoading(false); });

    return () => { active = false; };
  }, [requestId]);

  return { items, quotes, loading };
}

// ============================================================
// 3. Orders overview
// ============================================================

// Re-exported rather than redeclared. These were duplicated here, and a
// duplicate union is a union that will disagree with the database the
// first time someone adds a status to only one of them — which is
// exactly what happened when escrow was added.
export type { PaymentStatus, FulfillmentStatus } from '../types/db';

export interface AdminOrderRow {
  id: string;
  reference: string;
  amount: number;
  payment_status: PaymentStatus;
  fulfillment_status: FulfillmentStatus;
  created_at: string;
  delivered_at: string | null;
  buyer_name: string | null;
  buyer_phone: string | null;
  vendor_name: string | null;
  vendor_phone: string | null;
  vendor_email: string | null;
  itemCount: number;
  delivery_address: string | null;
  delivery_city: string | null;
  delivery_name: string | null;
  delivery_phone: string | null;
  quote_id: string;
  /**
   * Paid but not yet delivered. Not a payment status the database
   * stores — the marketplace has no escrow account — so it is labelled
   * as "held" rather than presented as a settled fact.
   */
  held: boolean;
}

export function useAdminOrders() {
  const [rows, setRows] = useState<AdminOrderRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);

    const [orderRes, quoteRes, vendorRes, profileRes, itemRes] = await Promise.all([
      supabase.from('orders').select('*').order('created_at', { ascending: false }),
      supabase.from('quotes').select('id, vendor_id'),
      supabase.from('vendors').select('id, store_name, phone, email'),
      supabase.from('profiles').select('id, full_name, phone_number'),
      supabase.from('quote_items').select('quote_id'),
    ]);

    const problem = err(orderRes, quoteRes);
    if (problem) { setError(problem); setRows([]); setLoading(false); return; }

    const quoteVendor = new Map<string, string>();
    for (const q of (quoteRes.data ?? []) as { id: string; vendor_id: string }[]) quoteVendor.set(q.id, q.vendor_id);
    const shops = new Map<string, { store_name: string; phone: string | null; email: string | null }>();
    for (const v of (vendorRes.data ?? []) as { id: string; store_name: string; phone: string | null; email: string | null }[]) shops.set(v.id, v);
    const buyers = new Map<string, { full_name: string | null; phone_number: string | null }>();
    for (const p of (profileRes.data ?? []) as { id: string; full_name: string | null; phone_number: string | null }[]) buyers.set(p.id, p);
    const itemCounts = new Map<string, number>();
    for (const i of (itemRes.data ?? []) as { quote_id: string }[]) itemCounts.set(i.quote_id, (itemCounts.get(i.quote_id) ?? 0) + 1);

    setRows(((orderRes.data ?? []) as Record<string, unknown>[]).map((o) => {
      const quoteId = o.quote_id as string;
      const shop = shops.get(quoteVendor.get(quoteId) ?? '');
      const buyer = buyers.get(o.buyer_id as string);
      const payment = (o.payment_status as PaymentStatus) ?? 'pending';
      const fulfil = (o.fulfillment_status as FulfillmentStatus) ?? 'processing';
      return {
        id: o.id as string,
        reference: (o.id as string).slice(0, 8).toUpperCase(),
        amount: Number(o.amount ?? 0),
        payment_status: payment,
        fulfillment_status: fulfil,
        created_at: o.created_at as string,
        delivered_at: (o.delivered_at as string) ?? null,
        buyer_name: buyer?.full_name ?? null,
        buyer_phone: buyer?.phone_number ?? null,
        vendor_name: shop?.store_name ?? null,
        vendor_phone: shop?.phone ?? null,
        vendor_email: shop?.email ?? null,
        itemCount: itemCounts.get(quoteId) ?? 0,
        delivery_address: (o.delivery_address as string) ?? null,
        delivery_city: (o.delivery_city as string) ?? null,
        delivery_name: (o.delivery_name as string) ?? null,
        delivery_phone: (o.delivery_phone as string) ?? null,
        quote_id: quoteId,
        held:
          (SETTLED_PAYMENT_STATUSES as string[]).includes(payment) &&
          !['delivered', 'cancelled'].includes(fulfil),
      };
    }));
    setLoading(false);
  }, []);

  useEffect(() => {
    load().catch((e) => { setError(e instanceof Error ? e : new Error(String(e))); setLoading(false); });
  }, [load]);

  const stats = useMemo(() => ({
    pendingPayment: rows.filter((r) => r.payment_status === 'pending').length,
    held: rows.filter((r) => r.held).length,
    inTransit: rows.filter((r) => r.fulfillment_status === 'dispatched').length,
    delivered: rows.filter((r) => r.fulfillment_status === 'delivered').length,
    cancelled: rows.filter((r) => r.fulfillment_status === 'cancelled' || r.payment_status === 'refunded').length,
  }), [rows]);

  return { rows, stats, loading, error, refresh: load };
}

/** The line items behind one order, from the quote it was placed against. */
export function useOrderItems(quoteId: string | null) {
  const [items, setItems] = useState<{ id: string; title: string; quantity: number; unit_price: number | null }[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!quoteId) { setItems([]); return; }
    let active = true;
    setLoading(true);
    supabase
      .from('quote_items')
      .select('id, title, quantity, unit_price')
      .eq('quote_id', quoteId)
      .order('position')
      .then(({ data }) => {
        if (!active) return;
        setItems((data ?? []) as typeof items);
        setLoading(false);
      });
    return () => { active = false; };
  }, [quoteId]);

  return { items, loading };
}

// ============================================================
// 4. Customer support
// ============================================================

export type ReportStatus = 'open' | 'actioned' | 'dismissed';

export interface SupportRow {
  id: string;
  reference: string;
  subject_type: string;
  subject_id: string;
  reason: string;
  status: ReportStatus;
  created_at: string;
  resolved_at: string | null;
  resolution_note: string | null;
  reporter_name: string | null;
  reporter_role: 'buyer' | 'vendor' | 'admin' | null;
}

export function useAdminSupport() {
  const [rows, setRows] = useState<SupportRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);

    const [reportRes, profileRes] = await Promise.all([
      supabase.from('content_reports').select('*').order('created_at', { ascending: false }),
      supabase.from('profiles').select('id, full_name, role'),
    ]);

    if (reportRes.error) { setError(new Error(reportRes.error.message)); setRows([]); setLoading(false); return; }

    const people = new Map<string, { full_name: string | null; role: 'buyer' | 'vendor' | 'admin' }>();
    for (const p of (profileRes.data ?? []) as { id: string; full_name: string | null; role: 'buyer' | 'vendor' | 'admin' }[]) people.set(p.id, p);

    setRows(((reportRes.data ?? []) as Record<string, unknown>[]).map((r) => {
      const who = people.get(r.reporter_id as string);
      return {
        id: r.id as string,
        reference: (r.id as string).slice(0, 8).toUpperCase(),
        subject_type: (r.subject_type as string) ?? '—',
        subject_id: (r.subject_id as string) ?? '',
        reason: (r.reason as string) ?? '',
        status: (r.status as ReportStatus) ?? 'open',
        created_at: r.created_at as string,
        resolved_at: (r.resolved_at as string) ?? null,
        resolution_note: (r.resolution_note as string) ?? null,
        reporter_name: who?.full_name ?? null,
        reporter_role: who?.role ?? null,
      };
    }));
    setLoading(false);
  }, []);

  useEffect(() => {
    load().catch((e) => { setError(e instanceof Error ? e : new Error(String(e))); setLoading(false); });
  }, [load]);

  const stats = useMemo(() => {
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    return {
      open: rows.filter((r) => r.status === 'open').length,
      actioned: rows.filter((r) => r.status === 'actioned').length,
      dismissed: rows.filter((r) => r.status === 'dismissed').length,
      resolvedToday: rows.filter(
        (r) => r.resolved_at && new Date(r.resolved_at) >= startOfToday
      ).length,
    };
  }, [rows]);

  /** Audited: admin_resolve_report writes an admin_actions row too. */
  const resolve = useCallback(
    async (reportId: string, status: 'actioned' | 'dismissed', note?: string) => {
      const { error: e } = await supabase.rpc('admin_resolve_report', {
        p_report: reportId,
        p_status: status,
        p_note: note ?? null,
      });
      if (e) return { ok: false, message: e.message };
      await load();
      return { ok: true };
    },
    [load]
  );

  return { rows, stats, loading, error, refresh: load, resolve };
}
