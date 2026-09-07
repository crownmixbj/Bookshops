import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '../utils/supabase';
import type {
  VendorQuoteRow,
  VendorQuoteState,
  VendorQuoteTab,
} from '../types/db';

/**
 * Every quote this vendor has written.
 *
 * Read through the `vendor_quote_list()` RPC rather than a client-side
 * join. The reason is not convenience: `profiles` has no vendor-facing
 * SELECT policy, so `quotes -> book_requests -> profiles` returns null
 * for every customer name. The function is SECURITY DEFINER and filters
 * on the caller's own vendor id.
 */

/**
 * What a row reads as, which is not quotes.status.
 *
 * Order matters. An accepted quote with an order row is 'ordered' —
 * money has changed hands and the shop's next action is to fulfil it,
 * not to wait. Checking accepted first would hide that.
 */
export function stateFor(row: VendorQuoteRow): VendorQuoteState {
  if (row.order_id) return 'ordered';
  switch (row.quote_status) {
    case 'accepted':
      return 'accepted';
    case 'draft':
      return 'draft';
    case 'sent':
      return 'sent';
    // rejected, withdrawn and expired all mean the same thing to a shop:
    // finished, nothing further to do.
    default:
      return 'declined';
  }
}

/** Only an unaccepted quote is still the vendor's to change. */
export function isEditable(row: VendorQuoteRow): boolean {
  const state = stateFor(row);
  return state === 'draft' || state === 'sent';
}

function tabFor(state: VendorQuoteState): Exclude<VendorQuoteTab, 'all'> {
  if (state === 'draft') return 'draft';
  if (state === 'sent') return 'pending';
  if (state === 'declined') return 'declined';
  return 'accepted'; // accepted and ordered share a tab
}

export function useVendorQuotes(enabled = true) {
  const [rows, setRows] = useState<VendorQuoteRow[]>([]);
  const [loading, setLoading] = useState(enabled);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const load = useCallback(
    async ({ isRefresh = false } = {}) => {
      if (!enabled) {
        setLoading(false);
        return;
      }
      isRefresh ? setRefreshing(true) : setLoading(true);
      setError(null);
      try {
        const { data, error: e } = await supabase.rpc('vendor_quote_list');

        // PGRST202 = no such function. It means bookshops_vendor_quotes.sql
        // has not been run on this project, which is a deployment step
        // rather than something a shop owner can act on — so say that
        // instead of showing them a Postgres error code.
        if (e?.code === 'PGRST202') {
          throw new Error(
            'The quote list is not available on this database yet. Run bookshops_vendor_quotes.sql in the Supabase SQL editor.'
          );
        }
        if (e) throw e;

        setRows((data ?? []) as VendorQuoteRow[]);
      } catch (e) {
        setError(e as Error);
        setRows([]);
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [enabled]
  );

  useEffect(() => {
    load();
  }, [load]);

  /** Counts for the tab labels, computed once over every row. */
  const counts = useMemo(() => {
    const tally = { all: rows.length, pending: 0, accepted: 0, declined: 0, draft: 0 };
    for (const row of rows) tally[tabFor(stateFor(row))] += 1;
    return tally;
  }, [rows]);

  const filter = useCallback(
    (tab: VendorQuoteTab) => (tab === 'all' ? rows : rows.filter((r) => tabFor(stateFor(r)) === tab)),
    [rows]
  );

  /** Money out on quotes nobody has answered yet — the useful headline. */
  const pendingValue = useMemo(
    () =>
      rows
        .filter((r) => stateFor(r) === 'sent')
        .reduce((sum, r) => sum + Number(r.total_price ?? 0), 0),
    [rows]
  );

  return {
    rows,
    counts,
    filter,
    pendingValue,
    loading,
    refreshing,
    error,
    refresh: () => load({ isRefresh: true }),
    reload: load,
  };
}
