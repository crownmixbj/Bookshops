import { AdminRedirect } from './_redirect';

/** Renamed to /admin/financials. Kept so existing links still work. */
export default function AdminPaymentsRedirect() {
  return <AdminRedirect to="/admin/financials" label="Financials & Payouts" />;
}
