/**
 * Admin settings.
 *
 * Deliberately the SAME screen as /settings rather than a copy. The
 * settings screen already branches on role, and two files would mean
 * two places to change one preference — the kind of split where one
 * side quietly stops matching the other. This gives the admin console
 * its own path in the sidebar without forking the implementation.
 */
export { default } from '../(tabs)/settings';
