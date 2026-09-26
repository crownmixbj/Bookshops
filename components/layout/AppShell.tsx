import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { View, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, usePathname } from 'expo-router';

import { TopBar } from '../dashboard/TopBar';
import { Sidebar, NAV_ITEMS } from '../dashboard/Sidebar';
import { SignInPrompt } from '../auth/SignInPrompt';
import { useAuthGate } from '../../hooks/useAuthGate';

/**
 * Buyer nav keys a guest cannot open.
 *
 * Keyed off the nav item, not the path, so it stays readable next to
 * NAV_ITEMS; lib/authGate is still the authority for the routes
 * themselves, and the two agree — these are exactly the buyer-data
 * entries in that deny-list. Dashboard, Bookshops and Help stay open.
 */
const GUEST_BLOCKED_NAV = new Set(['booklists', 'orders', 'messages', 'settings']);
import { ProfileMenu } from '../profile/ProfileMenu';
import { SupportMenu } from '../support/SupportMenu';
import { SupportDrawer } from '../support/SupportDrawer';
import { VendorTopBar, VendorSidebar, type VendorNavItem } from '../vendor/VendorShell';
import { VendorProfileMenu } from '../vendor/VendorProfileMenu';
import { AdminTopBar, AdminSidebar, type AdminNavItem } from '../admin/AdminShell';
import { AdminProfileMenu } from '../admin/AdminProfileMenu';

import { ShellProvider } from './ShellContext';
import { useVendorIdentity } from '../../hooks/useVendorIdentity';
import { useAdminAlerts } from '../../hooks/useAdminAlerts';
import { useVendorBadges } from '../../hooks/useVendorBadges';
import { useProfileIdentity } from '../../hooks/useProfileIdentity';
import { supabase } from '../../utils/supabase';
import { useBuyerAlerts } from '../../hooks/useBuyerAlerts';
import { useGlobalSearch, type SearchHit } from '../../hooks/useGlobalSearch';
import { SearchDropdown } from '../dashboard/SearchDropdown';
import { NotificationsPanel } from '../dashboard/NotificationsPanel';
import type { AppNotification } from '../../types/db';
import { colors } from '../../theme';

export type ShellRole = 'buyer' | 'vendor' | 'admin';

/**
 * Which sidebar entry is highlighted, worked out from the URL rather
 * than passed down. A screen should not have to declare where it sits in
 * the navigation — the router already knows.
 */
function activeKeyFor(pathname: string, role: ShellRole): string {
  if (role === 'vendor') {
    if (pathname === '/vendor') return 'dashboard';
    if (pathname === '/settings') return 'settings';
    // '/vendor/orders' -> 'orders'. The nav key IS the last URL segment,
    // so a new vendor screen highlights itself with no extra wiring.
    const m = pathname.match(/^\/vendor\/([\w-]+)/);
    return m ? m[1] : '';
  }
  if (role === 'admin') {
    // '/admin' is now a redirect to '/admin/dashboard'; both should
    // light up Dashboard, and so should the brief moment on the old URL.
    if (pathname === '/admin' || pathname === '/admin/dashboard') return 'dashboard';
    // An admin who reaches the shared /settings (rather than
    // /admin/settings) is still in the Settings section.
    if (pathname === '/settings') return 'settings';
    // The two renamed sections, while an old link is redirecting.
    if (pathname === '/admin/payments') return 'financials';
    if (pathname === '/admin/support') return 'disputes';
    if (pathname === '/settings') return 'settings';
    // '/admin/vendors' -> 'vendors'. The nav key is the last URL
    // segment, so a new admin screen highlights itself with no wiring.
    const m = pathname.match(/^\/admin\/([\w-]+)/);
    return m ? m[1] : '';
  }
  if (pathname === '/') return 'dashboard';
  if (pathname.startsWith('/booklists')) return 'booklists';
  if (pathname.startsWith('/orders')) return 'orders';
  if (pathname.startsWith('/messages')) return 'messages';
  // Covers /shops and /shops/[id] alike, so a shop detail page keeps
  // the directory highlighted rather than nothing.
  if (pathname.startsWith('/shops')) return 'shops';
  // /saved is now a redirect into /shops. It highlights Bookshops for
  // the instant before the redirect lands, rather than flashing nothing.
  if (pathname.startsWith('/saved')) return 'shops';
  if (pathname.startsWith('/support')) return 'support';
  if (pathname.startsWith('/settings')) return 'settings';
  // An info or legal page: nothing in the sidebar is current, and
  // highlighting Dashboard would be a lie about where you are.
  return '';
}

/**
 * The application chrome: top bar, sidebar, account menu.
 *
 * It is mounted once by app/_layout.js and stays mounted while screens
 * swap underneath it. That is the whole point — previously every screen
 * drew its own copy, so the header was torn down and rebuilt on each
 * navigation, the search box cleared, and any page without a shell of
 * its own (the info and legal pages) had no header at all.
 *
 * Because it never unmounts, the chrome's state can simply live here:
 * `search`, the open/closed menus, the vendor's busy flag. Screens read
 * what they need through ShellContext.
 */
export function AppShell({ role, children }: { role: ShellRole; children: ReactNode }) {
  const pathname = usePathname();

  const [search, setSearch] = useState('');
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [supportOpen, setSupportOpen] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const [chatMessage, setChatMessage] = useState('');

  const { vendor, setBusyMode } = useVendorIdentity(role === 'vendor');
  const { name: displayName, refresh: refreshProfile } = useProfileIdentity();
  const alerts = useAdminAlerts(role === 'admin');
  const vendorBadges = useVendorBadges(role === 'vendor', pathname);
  const buyerAlerts = useBuyerAlerts(role === 'buyer', pathname);

  // ---- header search -------------------------------------------
  // The panel shows while the box has focus and at least two letters.
  // Blur is delayed a beat so a press on a result (which blurs the
  // input first on web) still lands.
  const [searchFocused, setSearchFocused] = useState(false);
  const blurTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const globalSearch = useGlobalSearch(role === 'buyer' ? search : '');
  const [notificationsOpen, setNotificationsOpen] = useState(false);

  useEffect(() => () => {
    if (blurTimer.current) clearTimeout(blurTimer.current);
  }, []);

  // A new page is a fresh start for the panel, but not for the text:
  // the screens that filter in place (booklists, orders, shops) still
  // read it.
  useEffect(() => {
    setSearchFocused(false);
    setNotificationsOpen(false);
  }, [pathname]);

  function onSearchFocus() {
    if (blurTimer.current) clearTimeout(blurTimer.current);
    setSearchFocused(true);
  }
  function onSearchBlur() {
    blurTimer.current = setTimeout(() => setSearchFocused(false), 180);
  }
  function openSearchHit(hit: SearchHit) {
    setSearchFocused(false);
    // Booklists and items are a buyer's own data; a guest never gets
    // those hits, but the gate is cheap and keeps the rule in one place.
    if (hit.kind === 'shop') {
      router.push(hit.route as any);
      return;
    }
    gate.requireAuth(() => router.push(hit.route as any), 'Log in to open your booklists.');
  }
  /** Enter: go where the text can be used in full. */
  function submitSearch() {
    setSearchFocused(false);
    if (globalSearch.total === 0 || globalSearch.results.shops.length >= globalSearch.total) {
      router.push('/shops');
      return;
    }
    gate.requireAuth(() => router.push('/booklists'), 'Log in to search your booklists.');
  }

  function openNotification(n: AppNotification) {
    setNotificationsOpen(false);
    if (!n.read_at) void buyerAlerts.markRead([n.id]);
    // The database CHECK keeps link relative, so this cannot leave the app.
    if (n.link && n.link.startsWith('/')) router.push(n.link as any);
  }

  const activeKey = activeKeyFor(pathname, role);

  const openSupportChat = useCallback((initialMessage = '') => {
    setChatMessage(initialMessage);
    setChatOpen(true);
  }, []);

  const gate = useAuthGate();

  const shellValue = useMemo(
    () => ({ search, setSearch, vendor, openSupportChat, role, displayName, refreshProfile, insideShell: true }),
    [search, vendor, openSupportChat, role, displayName, refreshProfile]
  );

  async function signOut() {
    await supabase.auth.signOut(); // app/_layout.js routes to login
  }

  async function navigateBuyer(item: (typeof NAV_ITEMS)[number]) {
    setDrawerOpen(false);
    if (item.key === 'logout') return signOut();
    // NAV_ITEMS lives in a .js file, so `route` widens to string. The
    // union below is the set of routes it actually holds, and keeping it
    // written out means adding a nav entry for a screen that does not
    // exist still fails to compile.
    const route = item.route as
      | '/'
      | '/booklists'
      | '/orders'
      | '/messages'
      | '/shops'
      | '/support'
      | '/settings'
      | null;
    if (!route) return;

    // Caught here rather than at the destination. The router guard would
    // also stop a guest, but only by replacing the screen with a login
    // form — so a tap on "My Orders" threw away the page they were
    // reading. Asking before the transition leaves them where they are.
    if (GUEST_BLOCKED_NAV.has(item.key)) {
      gate.requireAuth(
        () => router.push(route),
        'Log in or create an account to manage your booklists and track orders.'
      );
      return;
    }

    router.push(route);
  }

  async function navigateVendor(item: VendorNavItem) {
    setDrawerOpen(false);
    if (item.key === 'logout') return signOut();
    if (item.route) router.push(item.route);
  }

  async function navigateAdmin(item: AdminNavItem) {
    setDrawerOpen(false);
    if (item.key === 'logout') return signOut();
    if (item.route) router.push(item.route);
  }

  /**
   * The avatar.
   *
   * A guest pressing it used to open the profile dropdown, which asked
   * Supabase who they were, got told "Auth session missing!", and
   * rendered that sentence as a red error with a Retry that could never
   * succeed — see the note in hooks/useProfileDetails.js. The menu is an
   * authenticated surface and has nothing to show without a session, so
   * a guest is offered the sign-in sheet instead.
   *
   * requireAuth returns false while the session is still resolving, and
   * that is the right answer: nothing opens for the one frame of a cold
   * start, rather than the menu flashing an error and closing itself.
   */
  const openProfile = () =>
    gate.requireAuth(
      () => setProfileOpen(true),
      'Log in to see your profile, booklists and orders.'
    );

  const topBar =
    role === 'vendor' ? (
      <VendorTopBar
        storeName={vendor?.store_name ?? 'Your shop'}
        query={search}
        onQueryChange={setSearch}
        busyMode={vendor?.busy_mode ?? false}
        onBusyModeChange={setBusyMode}
        onMenuPress={() => setDrawerOpen(true)}
        onProfilePress={openProfile}
      />
    ) : role === 'admin' ? (
      <AdminTopBar
        // Falls back inside the hook, so this is never blank; the ??
        // only covers the instant before the first lookup returns.
        adminName={displayName ?? 'User'}
        query={search}
        onQueryChange={setSearch}
        onMenuPress={() => setDrawerOpen(true)}
        onProfilePress={openProfile}
        alerts={alerts.total}
      />
    ) : (
      <TopBar
        query={search}
        onQueryChange={setSearch}
        onMenuPress={() => setDrawerOpen(true)}
        onProfilePress={openProfile}
        onSupportPress={() => setSupportOpen(true)}
        // Home is the buyer dashboard. replace-less push keeps Back
        // working: the logo is a link, not a reset.
        onBrandPress={() => {
          setDrawerOpen(false);
          if (pathname !== '/') router.push('/');
        }}
        onNotificationsPress={() =>
          gate.requireAuth(
            () => {
              setNotificationsOpen(true);
              void buyerAlerts.refresh();
            },
            'Log in to see quote updates, messages and delivery alerts.'
          )
        }
        unreadCount={buyerAlerts.unread}
        onSearchFocus={onSearchFocus}
        onSearchBlur={onSearchBlur}
        onSearchSubmit={submitSearch}
        searchOverlay={
          searchFocused && globalSearch.active ? (
            <SearchDropdown
              query={search}
              results={globalSearch.results}
              loading={globalSearch.loading}
              signedIn={gate.signedIn}
              onSelect={openSearchHit}
              onSeeAllShops={() => {
                setSearchFocused(false);
                router.push('/shops');
              }}
              onSeeAllBooklists={() => {
                setSearchFocused(false);
                router.push('/booklists');
              }}
            />
          ) : null
        }
      />
    );

  const sidebar =
    role === 'vendor' ? (
      <VendorSidebar
        activeKey={activeKey}
        badges={vendorBadges}
        onNavigate={navigateVendor}
        drawerOpen={drawerOpen}
        onCloseDrawer={() => setDrawerOpen(false)}
      />
    ) : role === 'admin' ? (
      <AdminSidebar
        activeKey={activeKey}
        badges={{ vendors: alerts.vendors, support: alerts.support }}
        onNavigate={navigateAdmin}
        drawerOpen={drawerOpen}
        onCloseDrawer={() => setDrawerOpen(false)}
      />
    ) : (
      <Sidebar
        activeKey={activeKey}
        badges={{ messages: buyerAlerts.unreadMessages }}
        onNavigate={navigateBuyer}
        drawerOpen={drawerOpen}
        onCloseDrawer={() => setDrawerOpen(false)}
      />
    );

  /**
   * Never mounted without a session.
   *
   * openProfile already gates the press, but `profileOpen` can outlive
   * the session — a token expiring, or a sign-out in another tab, while
   * the menu is up. Tying visibility to the session as well means the
   * menu closes itself in that moment rather than staying open over data
   * that no longer belongs to anyone.
   */
  const accountMenuVisible = profileOpen && gate.signedIn;

  const accountMenu =
    role === 'vendor' ? (
      <VendorProfileMenu
        visible={accountMenuVisible}
        vendor={vendor}
        onClose={() => setProfileOpen(false)}
      />
    ) : role === 'admin' ? (
      <AdminProfileMenu visible={accountMenuVisible} onClose={() => setProfileOpen(false)} />
    ) : (
      <ProfileMenu visible={accountMenuVisible} onClose={() => setProfileOpen(false)} />
    );

  return (
    <ShellProvider value={shellValue}>
      <SafeAreaView style={styles.safe} edges={['top', 'left', 'right']}>
        {topBar}
        {accountMenu}

        {/* Support is a buyer affordance; vendors and admins reach the
            same team through their own account menus. */}
        {role === 'buyer' && (
          <>
            <SupportMenu
              visible={supportOpen}
              onClose={() => setSupportOpen(false)}
              onOpenChat={() => openSupportChat()}
            />
            <NotificationsPanel
              visible={notificationsOpen && gate.signedIn}
              items={buyerAlerts.items}
              unread={buyerAlerts.unread}
              loading={buyerAlerts.loading}
              migrationMissing={buyerAlerts.migration === 'missing'}
              onClose={() => setNotificationsOpen(false)}
              onOpen={openNotification}
              onMarkAllRead={buyerAlerts.markAllRead}
            />
            <SupportDrawer
              visible={chatOpen}
              initialMessage={chatMessage || undefined}
              onClose={() => {
                setChatOpen(false);
                setChatMessage('');
              }}
            />
          </>
        )}

        <View style={styles.body}>
          {sidebar}
          <View style={styles.content}>{children}</View>
        </View>

        {/* Mounted at the shell, not per screen: the nav is here, so the
            prompt it raises has to outlive whichever screen is showing. */}
        <SignInPrompt
          visible={gate.promptVisible}
          reason={gate.promptReason}
          onClose={gate.closePrompt}
          // The nav intercepts (My Booklists, My Orders, Settings) put
          // their navigation in the pending action, so signing in here
          // takes the guest where they were trying to go.
          onAuthenticated={gate.onAuthenticated}
        />
      </SafeAreaView>
    </ShellProvider>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.page },
  body: { flex: 1, flexDirection: 'row' },
  // minWidth:0 so a wide child (a table, a long unbroken string) shrinks
  // instead of pushing the sidebar off screen.
  content: { flex: 1, minWidth: 0 },
});
