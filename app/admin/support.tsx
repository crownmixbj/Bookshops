import { AdminRedirect } from './_redirect';

/** Renamed to /admin/disputes. Kept so existing links still work. */
export default function AdminSupportRedirect() {
  return <AdminRedirect to="/admin/disputes" label="Disputes & Support" />;
}
