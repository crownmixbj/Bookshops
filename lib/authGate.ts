/**
 * Which routes a guest may open, and which ones need an account.
 *
 * The app used to run an allow-list: everything bounced to /auth/login
 * except a handful of legal pages. That is the wrong default for a
 * marketplace — a parent who has been sent a link to a bookshop should
 * be able to look at it before deciding whether LOCI is worth an
 * account, and shops want to be findable by people who have not signed
 * up yet.
 *
 * So this is a DENY-list, and the burden is the other way round: a route
 * is public unless it is named here. Every entry is either about the
 * buyer's own data or spends their money — nothing on the list is
 * browsing.
 */

/** Top-level segments that need an account, whatever sits under them. */
const PROTECTED_ROOTS = new Set(['checkout', 'quotes', 'booklists', 'admin', 'vendor']);

/**
 * Exceptions under a protected root, by full path.
 *
 * Building a booklist is not reading a buyer's data — it is typing into
 * a form, and a guest is welcome to. What needs an account is DISPATCH:
 * the moment the list is sent to shops and becomes a request somebody
 * has to answer. Gating the composer instead meant a parent had to open
 * an account before they knew whether the app could even help them.
 *
 * /booklists/[id] stays protected: that is a saved list, which by
 * definition belongs to someone.
 */
const GUEST_ALLOWED_PATHS = new Set(['booklists/new-manual']);

/** Tabs that need one. The rest of the tab group is browsable. */
const PROTECTED_TABS = new Set(['orders', 'booklists', 'messages', 'saved', 'settings', 'admin', 'vendor']);

/**
 * Does this route require a signed-in user?
 *
 * `segments` is expo-router's useSegments(). An empty array is a real
 * state — one tick while a browser Back/Forward resolves — and must not
 * be read as a route, or a guest gets bounced mid-navigation.
 */
export function routeRequiresAuth(segments: string[]): boolean {
  if (!segments || segments.length === 0) return false;

  const [root, second] = segments;
  if (root === '(tabs)') return second != null && PROTECTED_TABS.has(second);
  if (GUEST_ALLOWED_PATHS.has(segments.join('/'))) return false;
  return PROTECTED_ROOTS.has(root);
}

/** True for the sign-in screens themselves, which are never gated. */
export function isAuthRoute(segments: string[]): boolean {
  return segments?.[0] === 'auth';
}
