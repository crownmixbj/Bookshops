import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../utils/supabase';

export interface FinanceSummary {
  gmv: number;
  platform_revenue: number;
  escrow: number;
  pending_payouts: number;
  commission_rate: number;
}

export type PayoutStatus = 'pending' | 'processing' | 'completed' | 'failed';

export interface PayoutQueueRow {
  id: string;
  reference: string;
  vendor_id: string;
  store_name: string;
  amount: number;
  status: PayoutStatus;
  bank_name: string | null;
  account_name: string | null;
  account_number: string | null;
  requested_at: string;
  processed_at: string | null;
  failure_reason: string | null;
}

export type MigrationState = 'unknown' | 'present' | 'missing';

/** PostgREST's codes for "that table or function isn't there". */
const MISSING = new Set(['42P01', '42883', 'PGRST202', 'PGRST205']);

export function useAdminFinance() {
  const [summary, setSummary] = useState<FinanceSummary | null>(null);
  const [queue, setQueue] = useState<PayoutQueueRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [migration, setMigration] = useState<MigrationState>('unknown');
  const [error, setError] = useState<Error | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);

    const [summaryRes, queueRes] = await Promise.all([
      supabase.rpc('admin_finance_summary'),
      supabase.rpc('admin_payout_queue'),
    ]);

    // Not the same thing as "no money yet". If the functions do not
    // exist, showing ₦0 across four cards would be a fabrication.
    if ([summaryRes, queueRes].some((r) => r.error && MISSING.has(r.error.code ?? ''))) {
      setMigration('missing');
      setSummary(null);
      setQueue([]);
      setLoading(false);
      return;
    }
    setMigration('present');

    const firstError = [summaryRes, queueRes].find((r) => r.error)?.error;
    if (firstError) setError(new Error(firstError.message));

    const rows = (summaryRes.data ?? []) as FinanceSummary[];
    setSummary(rows.length ? rows[0] : null);
    setQueue((queueRes.data ?? []) as PayoutQueueRow[]);
    setLoading(false);
  }, []);

  useEffect(() => {
    load().catch((e) => {
      setError(e instanceof Error ? e : new Error(String(e)));
      setLoading(false);
    });
  }, [load]);

  /**
   * Approve / hold / settle. The server re-checks that the caller is an
   * admin and writes an admin_actions row in the same transaction, so
   * the button cannot move money without leaving a trace.
   */
  const setStatus = useCallback(
    async (id: string, next: PayoutStatus, note?: string) => {
      const { error: rpcError } = await supabase.rpc('admin_set_payout_status', {
        payout_id: id,
        next_status: next,
        note: note ?? null,
      });
      if (rpcError) return { ok: false, message: rpcError.message };
      await load();
      return { ok: true };
    },
    [load]
  );

  return { summary, queue, loading, migration, error, refresh: load, setStatus };
}

/** 10-digit NUBAN, grouped for reading: 0123 456 789. */
export function formatNuban(accountNumber: string | null): string {
  if (!accountNumber) return '—';
  const d = accountNumber.replace(/\D/g, '');
  if (d.length !== 10) return accountNumber;
  return `${d.slice(0, 4)} ${d.slice(4, 7)} ${d.slice(7)}`;
}
