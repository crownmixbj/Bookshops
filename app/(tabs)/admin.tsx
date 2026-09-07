import { AdminRedirect } from '../admin/_redirect';

/**
 * The admin console moved to /admin/dashboard.
 *
 * This file is what gave the console its old `/admin` URL, so it stays
 * as a redirect: the landing route, saved bookmarks and any link out
 * there still arrive somewhere real.
 */
export default function AdminIndexRedirect() {
  return <AdminRedirect to="/admin/dashboard" label="the admin dashboard" />;
}
