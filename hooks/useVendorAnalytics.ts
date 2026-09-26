import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '../utils/supabase';

/**
 * The shop's performance for a period, from vendor_analytics().
 *
 * Every number is computed in the database — see the definitions at the
 * top of bookshops_vendor_analytics.sql. In particular, conversion is a
 * cohort (of the quotes sent in the period, how many became paid orders),
 * and revenue is the value of the books excluding the delivery fee.
 */

export type AnalyticsRange = 7 | 30 | 90 | 365;

export const ANALYTICS_RANGES: { key: AnalyticsRange; label: string }[] = [
  { key: 7, label: '7 days' },
  { key: 30, label: '30 days' },
  { key: 90, label: '90 days' },
  { key: 365, label: '12 months' },
];

export interface AnalyticsTotals {
  quotes_sent: number;
  orders_won: number;
  revenue: number;
  avg_order_value?: number;
  /** 0–1, or null when no quotes were sent (not 0%: there is nothing to divide). */
  conversion_rate: number | null;
}

export interface AnalyticsDay {
  day: string;
  quotes: number;
  orders: number;
  revenue: number;
}

export interface VendorAnalytics {
  period_days: number;
  from: string;
  to: string;
  totals: AnalyticsTotals;
  previous: AnalyticsTotals;
  outcomes: { won: number; awaiting: number; declined: number };
  series: AnalyticsDay[];
  top_schools: { school_name: string; orders: number; revenue: number }[];
  fulfillment: { to_pack: number; in_transit: number; delivered: number };
}

/** A chart point after bucketing days into weeks or months. */
export interface AnalyticsBucket {
  key: string;
  /** Short axis label: "12", "8 Sep", "Sep". */
  label: string;
  /** Full label for a tooltip: "Week of 8 Sep", "September 2026". */
  title: string;
  quotes: number;
  orders: number;
  revenue: number;
}

const MISSING = new Set(['42883', 'PGRST202']);

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function totalsFrom(raw: Record<string, any> | null | undefined): AnalyticsTotals {
  return {
    quotes_sent: num(raw?.quotes_sent),
    orders_won: num(raw?.orders_won),
    revenue: num(raw?.revenue),
    avg_order_value: num(raw?.avg_order_value),
    conversion_rate: raw?.conversion_rate == null ? null : num(raw.conversion_rate),
  };
}

function normalise(raw: Record<string, any>): VendorAnalytics {
  return {
    period_days: num(raw.period_days),
    from: raw.from,
    to: raw.to,
    totals: totalsFrom(raw.totals),
    previous: totalsFrom(raw.previous),
    outcomes: {
      won: num(raw.outcomes?.won),
      awaiting: num(raw.outcomes?.awaiting),
      declined: num(raw.outcomes?.declined),
    },
    series: ((raw.series ?? []) as Record<string, any>[]).map((d) => ({
      day: String(d.day),
      quotes: num(d.quotes),
      orders: num(d.orders),
      revenue: num(d.revenue),
    })),
    top_schools: ((raw.top_schools ?? []) as Record<string, any>[]).map((s) => ({
      school_name: String(s.school_name ?? ''),
      orders: num(s.orders),
      revenue: num(s.revenue),
    })),
    fulfillment: {
      to_pack: num(raw.fulfillment?.to_pack),
      in_transit: num(raw.fulfillment?.in_transit),
      delivered: num(raw.fulfillment?.delivered),
    },
  };
}

/** "2026-09-08" as a local date, without the UTC shift `new Date(str)` applies. */
function parseDay(day: string): Date {
  const [y, m, d] = day.slice(0, 10).split('-').map(Number);
  return new Date(y, (m ?? 1) - 1, d ?? 1);
}

/**
 * Daily for a week or a month, weekly for a quarter, monthly for a year.
 * Thirty bars is about as many as a phone can draw legibly; 365 is not.
 */
export function bucketSeries(series: AnalyticsDay[], range: AnalyticsRange): AnalyticsBucket[] {
  if (range <= 30) {
    return series.map((d) => {
      const date = parseDay(d.day);
      return {
        key: d.day,
        label: range === 7 ? date.toLocaleDateString('en-GB', { weekday: 'short' }) : String(date.getDate()),
        title: date.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' }),
        quotes: d.quotes,
        orders: d.orders,
        revenue: d.revenue,
      };
    });
  }

  const buckets = new Map<string, AnalyticsBucket>();
  for (const d of series) {
    const date = parseDay(d.day);
    let key: string;
    let label: string;
    let title: string;
    if (range === 90) {
      // Weeks starting Monday.
      const start = new Date(date);
      start.setDate(date.getDate() - ((date.getDay() + 6) % 7));
      key = start.toISOString().slice(0, 10);
      label = start.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
      title = `Week of ${label}`;
    } else {
      key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
      label = date.toLocaleDateString('en-GB', { month: 'short' });
      title = date.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
    }
    const b = buckets.get(key) ?? { key, label, title, quotes: 0, orders: 0, revenue: 0 };
    b.quotes += d.quotes;
    b.orders += d.orders;
    b.revenue += d.revenue;
    buckets.set(key, b);
  }
  return [...buckets.values()];
}

export function useVendorAnalytics(range: AnalyticsRange) {
  const [data, setData] = useState<VendorAnalytics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [migration, setMigration] = useState<'unknown' | 'ok' | 'missing'>('unknown');

  // Switching ranges quickly must not let a slow earlier answer win.
  const latest = useRef(0);

  const load = useCallback(async () => {
    const ticket = ++latest.current;
    setLoading(true);
    setError(null);
    const { data: raw, error: rpcError } = await supabase.rpc('vendor_analytics', { p_days: range });
    if (ticket !== latest.current) return;

    if (rpcError) {
      if (MISSING.has(rpcError.code ?? '')) setMigration('missing');
      else setError(rpcError.message);
      setLoading(false);
      return;
    }
    setMigration('ok');
    setData(raw ? normalise(raw as Record<string, any>) : null);
    setLoading(false);
  }, [range]);

  useEffect(() => {
    load();
  }, [load]);

  return { data, loading, error, migration, refresh: load };
}
