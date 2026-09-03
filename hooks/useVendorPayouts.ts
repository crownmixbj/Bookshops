import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../utils/supabase';

export interface PayoutSummary {
  vendor_id: string;
  total_revenue: number;
  commission: number;
  net_earned: number;
  paid_out: number;
  pending_payouts: number;
  available_balance: number;
  minimum_amount: number;
  has_bank_account: boolean;
  can_request: boolean;
}

export type PayoutStatus = 'pending' | 'processing' | 'completed' | 'failed';

export interface PayoutRequest {
  id: string;
  reference: string;
  amount: number;
  currency: string;
  status: PayoutStatus;
  bank_name: string | null;
  account_name: string | null;
  account_last4: string | null;
  requested_at: string;
  processed_at: string | null;
  failure_reason: string | null;
}

export interface BankAccount {
  vendor_id: string;
  account_name: string;
  bank_name: string;
  bank_code: string | null;
  account_number: string;
  verified_at: string | null;
}

/**
 * `false` until we know. The page must not decide whether to show the
 * "run the migration" panel while the query is still in flight.
 */
export type MigrationState = 'unknown' | 'present' | 'missing';

/** PostgREST codes for "you are asking for something that isn't there". */
const MISSING = new Set(['42P01', '42883', 'PGRST202', 'PGRST205']);

export function useVendorPayouts() {
  const [summary, setSummary] = useState<PayoutSummary | null>(null);
  const [history, setHistory] = useState<PayoutRequest[]>([]);
  const [bank, setBank] = useState<BankAccount | null>(null);
  const [loading, setLoading] = useState(true);
  const [migration, setMigration] = useState<MigrationState>('unknown');
  const [error, setError] = useState<Error | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);

    const [summaryRes, historyRes, bankRes] = await Promise.all([
      supabase.rpc('vendor_payout_summary'),
      supabase
        .from('payout_requests')
        .select('*')
        .order('requested_at', { ascending: false })
        .limit(50),
      supabase.from('vendor_bank_accounts').select('*').maybeSingle(),
    ]);

    // The tables not existing is a different thing from a query failing,
    // and the page says something different for each. Guessing wrong
    // here is how you end up showing "₦0 available" to a vendor whose
    // balance was simply never queryable.
    const missing = [summaryRes, historyRes, bankRes].some(
      (r) => r.error && MISSING.has(r.error.code ?? '')
    );
    if (missing) {
      setMigration('missing');
      setSummary(null);
      setHistory([]);
      setBank(null);
      setLoading(false);
      return;
    }
    setMigration('present');

    const realError = [summaryRes, historyRes, bankRes].find((r) => r.error)?.error;
    if (realError) setError(new Error(realError.message));

    // The RPC returns a set: no row means this account is not a vendor.
    const rows = (summaryRes.data ?? []) as PayoutSummary[];
    setSummary(rows.length ? rows[0] : null);
    setHistory((historyRes.data ?? []) as PayoutRequest[]);
    setBank((bankRes.data as BankAccount) ?? null);
    setLoading(false);
  }, []);

  useEffect(() => {
    load().catch((e) => {
      setError(e instanceof Error ? e : new Error(String(e)));
      setLoading(false);
    });
  }, [load]);

  /**
   * Saves bank details after re-checking the password.
   *
   * signInWithPassword against the signed-in email is the check: it
   * fails on a wrong password without touching the row. Changing where
   * money is sent should cost more than a stolen unlocked laptop.
   */
  const saveBankAccount = useCallback(
    async (
      input: { account_name: string; bank_name: string; account_number: string; bank_code?: string },
      password: string
    ): Promise<{ ok: boolean; message?: string }> => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user?.email) return { ok: false, message: 'You are not signed in.' };
      if (!summary?.vendor_id) return { ok: false, message: 'This account has no shop registered.' };

      const { error: reauth } = await supabase.auth.signInWithPassword({
        email: user.email,
        password,
      });
      if (reauth) return { ok: false, message: 'That password is not correct.' };

      const { error: writeError } = await supabase.from('vendor_bank_accounts').upsert(
        {
          vendor_id: summary.vendor_id,
          account_name: input.account_name.trim(),
          bank_name: input.bank_name.trim(),
          bank_code: input.bank_code?.trim() || null,
          account_number: input.account_number.trim(),
          // Editing the details invalidates any previous name check.
          verified_at: null,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'vendor_id' }
      );
      if (writeError) return { ok: false, message: writeError.message };

      await load();
      return { ok: true };
    },
    [summary?.vendor_id, load]
  );

  /** The server re-checks the balance and the threshold; this just asks. */
  const requestPayout = useCallback(async (): Promise<{ ok: boolean; message?: string }> => {
    const { error: rpcError } = await supabase.rpc('request_payout');
    if (rpcError) return { ok: false, message: rpcError.message };
    await load();
    return { ok: true };
  }, [load]);

  return { summary, history, bank, loading, migration, error, refresh: load, saveBankAccount, requestPayout };
}

/** `•••• •••• •• 1234` — never the full number, once it is saved. */
export function maskAccountNumber(accountNumber: string): string {
  const last4 = accountNumber.slice(-4);
  return `•••• •••• •• ${last4}`;
}
