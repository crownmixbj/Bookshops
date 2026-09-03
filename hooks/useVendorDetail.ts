import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../utils/supabase';

export interface VendorBank {
  bank_name: string;
  account_name: string;
  account_number: string;
  bank_code: string | null;
  verified_at: string | null;
}

export interface VendorPerformance {
  ordersCompleted: number;
  revenue: number;
  /** Paid but not yet delivered — money the shop cannot draw on. */
  inFlight: number;
}

/**
 * The extra records behind one shop, fetched only when its panel opens.
 *
 * Kept out of the list query on purpose: two more round trips per row
 * would make the table crawl, and nobody reads bank details for forty
 * shops at once.
 *
 * Both reads depend on admin-only RLS policies (vba_select_admin,
 * orders_select_admin, quotes_select_admin). A non-admin gets empty
 * results rather than an error, which is what those policies are for.
 */
export function useVendorDetail(vendorId: string | null) {
  const [bank, setBank] = useState<VendorBank | null>(null);
  const [performance, setPerformance] = useState<VendorPerformance | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  /** vendor_bank_accounts only exists after bookshops_payouts.sql. */
  const [bankTableMissing, setBankTableMissing] = useState(false);

  const load = useCallback(async () => {
    if (!vendorId) return;
    setLoading(true);
    setError(null);
    setBankTableMissing(false);

    const [bankRes, orderRes] = await Promise.all([
      supabase
        .from('vendor_bank_accounts')
        .select('bank_name, account_name, account_number, bank_code, verified_at')
        .eq('vendor_id', vendorId)
        .maybeSingle(),
      // Orders reach a vendor through quotes; !inner makes the embedded
      // filter a join rather than a nullable side-load.
      supabase
        .from('orders')
        .select('amount, payment_status, fulfillment_status, quotes!inner(vendor_id)')
        .eq('quotes.vendor_id', vendorId),
    ]);

    const missingCode = new Set(['42P01', 'PGRST205']);
    if (bankRes.error && missingCode.has(bankRes.error.code ?? '')) {
      setBankTableMissing(true);
      setBank(null);
    } else if (bankRes.error) {
      setError(new Error(bankRes.error.message));
    } else {
      setBank((bankRes.data as VendorBank) ?? null);
    }

    if (orderRes.error) {
      setError((prev) => prev ?? new Error(orderRes.error!.message));
      setPerformance(null);
    } else {
      const orders = (orderRes.data ?? []) as { amount: number | null; payment_status: string; fulfillment_status: string }[];
      const paid = orders.filter((o) => o.payment_status === 'paid');
      setPerformance({
        ordersCompleted: paid.filter((o) => o.fulfillment_status === 'delivered').length,
        revenue: paid
          .filter((o) => o.fulfillment_status === 'delivered')
          .reduce((sum, o) => sum + Number(o.amount ?? 0), 0),
        inFlight: paid
          .filter((o) => !['delivered', 'cancelled'].includes(o.fulfillment_status))
          .reduce((sum, o) => sum + Number(o.amount ?? 0), 0),
      });
    }

    setLoading(false);
  }, [vendorId]);

  useEffect(() => {
    if (!vendorId) {
      setBank(null);
      setPerformance(null);
      setError(null);
      return;
    }
    load().catch((e) => {
      setError(e instanceof Error ? e : new Error(String(e)));
      setLoading(false);
    });
  }, [vendorId, load]);

  return { bank, performance, loading, error, bankTableMissing, refresh: load };
}
