import { useCallback, useMemo, useState, type ReactNode } from 'react';
import { View, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, usePathname } from 'expo-router';

import { TopBar } from '../dashboard/TopBar';
import { Sidebar, NAV_ITEMS } from '../dashboard/Sidebar';
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
import { useProfileIdentity } from '../../hooks/useProfileIdentity';
import { supabase } from '../../utils/supabase';
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
    if (pathname === '/admin') return 'dashboard';
    if (pathname === '/settings') return 'settings';
    // '/admin/vendors' -> 'vendors'. The nav key is the last URL
    // segment, so a new admin screen highlights itself with no wiring.
    const m = pathname.match(/^\/admin\/([\w-]+)/);
    return m ? m[1] : '';
  }
  if (pathname === '/') return 'dashboard';
  if (pathname.startsWith('/booklists')) return 'booklists';
  if (pathname.startsWith('/orders')) return 'orders';
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

  const activeKey = activeKeyFor(pathname, role);

  const openSupportChat = useCallback((initialMessage = '') => {
    setChatMessage(initialMessage);
    setChatOpen(true);
  }, []);

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
      | '/shops'
      | '/support'
      | '/settings'
      | null;
    if (route) router.push(route);
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

  const topBar =
    role === 'vendor' ? (
      <VendorTopBar
        storeName={vendor?.store_name ?? 'Your shop'}
        query={search}
        onQueryChange={setSearch}
        busyMode={vendor?.busy_mode ?? false}
        onBusyModeChange={setBusyMode}
        onMenuPress={() => setDrawerOpen(true)}
        onProfilePress={() => setProfileOpen(true)}
      />
    ) : role === 'admin' ? (
      <AdminTopBar
        // Falls back inside the hook, so this is never blank; the ??
        // only covers the instant before the first lookup returns.
        adminName={displayName ?? 'User'}
        query={search}
        onQueryChange={setSearch}
        onMenuPress={() => setDrawerOpen(true)}
        onProfilePress={() => setProfileOpen(true)}
        alerts={alerts.total}
      />
    ) : (
      <TopBar
        query={search}
        onQueryChange={setSearch}
        onMenuPress={() => setDrawerOpen(true)}
        onProfilePress={() => setProfileOpen(true)}
        onSupportPress={() => setSupportOpen(true)}
      />
    );

  const sidebar =
    role === 'vendor' ? (
      <VendorSidebar
        activeKey={activeKey}
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
        onNavigate={navigateBuyer}
        drawerOpen={drawerOpen}
        onCloseDrawer={() => setDrawerOpen(false)}
      />
    );

  const accountMenu =
    role === 'vendor' ? (
      <VendorProfileMenu
        visible={profileOpen}
        vendor={vendor}
        onClose={() => setProfileOpen(false)}
      />
    ) : role === 'admin' ? (
      <AdminProfileMenu visible={profileOpen} onClose={() => setProfileOpen(false)} />
    ) : (
      <ProfileMenu visible={profileOpen} onClose={() => setProfileOpen(false)} />
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
