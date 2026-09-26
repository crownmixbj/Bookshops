import { ReactNode, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  Pressable,
  Switch,
  Modal,
  StyleSheet,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing, radius, font, shadow } from '../../theme';
import { useLayout } from '../../hooks/useLayout';

/**
 * Where a vendor nav item goes. A union rather than `string`, so a link
 * to a screen that does not exist fails to compile instead of landing on
 * Expo Router's "Unmatched Route".
 *
 * Dashboard is `/vendor`, the vendor's role root, not `/vendor/dashboard`.
 * ProfileMenu and every role gate send a vendor to `/vendor`, and the
 * buyer dashboard is `/` for the same reason: each role lands on its own
 * root rather than one segment inside it.
 *
 * `/vendor/settings` is a redirect into the shared `/settings`, which
 * already branches on role and holds the store fields. The specced URL
 * works; there is still only one screen editing store details.
 */
export type VendorRoute =
  | '/vendor'
  | '/vendor/quotes'
  | '/vendor/orders'
  | '/vendor/payouts'
  | '/vendor/messages'
  | '/vendor/analytics'
  | '/vendor/promotions'
  | '/vendor/support'
  | '/vendor/settings';

export interface VendorNavItem {
  key: string;
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  /** null for Logout, which is an action rather than a destination. */
  route: VendorRoute | null;
  badge?: number;
}

/**
 * The shop's day, in order: what is happening, work to answer, orders to
 * pack, money, then the occasional things.
 *
 * Customers is deliberately gone. It was a placeholder, and a shop's
 * customers are reached through the quote or order that involves them —
 * a separate list of people with no action attached to them is a menu
 * entry that never gets pressed twice.
 *
 * Inventory is gone for a different reason: LOCI is a request-for-quote
 * marketplace, not a catalogue. A shop does not pre-load what it stocks
 * and wait to be found — it receives a buyer's booklist and prices that
 * list. A shelf of products with no request attached to it answers a
 * question nobody here asks, and maintaining one is work the model does
 * not pay a shop back for.
 */
/**
 * Sidebar width, shared with the orange brand block in the top bar so
 * their right edges line up.
 *
 * 208, up from 180. At 180 the label column is only ~114px once the
 * padding, active border, icon and gap are taken out, and the bold
 * "Requests & Quotes" on the active row needs ~125px, so it clipped to
 * "Requests & Q...". 208 leaves ~142px.
 */
export const VENDOR_SIDEBAR_WIDTH = 208;

export const VENDOR_NAV: VendorNavItem[] = [
  { key: 'dashboard', label: 'Dashboard', icon: 'home-outline', route: '/vendor' },
  // 'quotes' rather than 'booklists': what a shop does here is answer
  // requests and track the answers, not keep lists of books.
  { key: 'quotes', label: 'Requests & Quotes', icon: 'pricetags-outline', route: '/vendor/quotes' },
  { key: 'orders', label: 'Orders', icon: 'cube-outline', route: '/vendor/orders' },
  { key: 'payouts', label: 'Payouts', icon: 'wallet-outline', route: '/vendor/payouts' },
  { key: 'messages', label: 'Messaging', icon: 'chatbubble-outline', route: '/vendor/messages' },
  { key: 'analytics', label: 'Analytics', icon: 'bar-chart-outline', route: '/vendor/analytics' },
  // Self-serve sponsored deals in the buyer dashboard's promo slot.
  { key: 'promotions', label: 'Promotions', icon: 'megaphone-outline', route: '/vendor/promotions' },
  { key: 'support', label: 'Support', icon: 'help-buoy-outline', route: '/vendor/support' },
  { key: 'settings', label: 'Settings', icon: 'settings-outline', route: '/vendor/settings' },
  { key: 'logout', label: 'Logout', icon: 'log-out-outline', route: null },
];

/**
 * Vendor top bar. Orange brand block, global search, the peak-season
 * switch, and the shop identity.
 *
 * The busy switch writes straight through to vendors.busy_mode rather
 * than holding local state — it is a signal to buyers, so it should not
 * be possible for the UI to show ON while the database says otherwise.
 */
export function VendorTopBar({
  storeName,
  query,
  onQueryChange,
  busyMode,
  onBusyModeChange,
  onMenuPress,
  onProfilePress,
}: {
  storeName: string;
  query: string;
  onQueryChange: (v: string) => void;
  busyMode: boolean;
  onBusyModeChange: (v: boolean) => void;
  onMenuPress: () => void;
  onProfilePress: () => void;
}) {
  const { isMobile } = useLayout();

  return (
    <View>
      <View style={styles.bar}>
        <View style={[styles.brand, !isMobile && styles.brandWide]}>
          {isMobile ? (
            <Pressable onPress={onMenuPress} hitSlop={8} accessibilityLabel="Open menu">
              <Ionicons name="menu" size={22} color={colors.onNavy} />
            </Pressable>
          ) : (
            <Text style={styles.brandText}>LOCI</Text>
          )}
        </View>

        <View style={styles.barMain}>
          <View style={styles.search}>
            <Ionicons name="search" size={15} color={colors.textFaint} />
            <TextInput
              value={query}
              onChangeText={onQueryChange}
              placeholder={isMobile ? 'Search' : 'Find customer orders or books...'}
              placeholderTextColor={colors.textFaint}
              style={styles.searchInput}
              accessibilityLabel="Find customer orders or books"
            />
          </View>

          <View style={styles.spacer} />

          <Pressable
            onPress={onProfilePress}
            style={styles.vendorChip}
            accessibilityRole="button"
            accessibilityLabel={`Vendor account, ${storeName}`}
          >
            <View style={styles.vendorAvatar}>
              <Ionicons name="person" size={15} color={colors.navy} />
            </View>
            {!isMobile && (
              <View>
                <Text style={styles.vendorLabel}>VENDOR:</Text>
                <Text style={styles.vendorName} numberOfLines={1}>
                  {storeName}
                </Text>
              </View>
            )}
            <Ionicons name="chevron-down" size={14} color={colors.onNavy} />
          </Pressable>

          <Pressable style={styles.bell} accessibilityRole="button" accessibilityLabel="Notifications">
            <Ionicons name="notifications-outline" size={20} color={colors.onNavy} />
          </Pressable>
        </View>
      </View>

      {/* Busy-mode strip. Its own row so it never squeezes the search box. */}
      <View style={[styles.busyStrip, busyMode && styles.busyStripOn]}>
        <Text style={styles.busyContext} numberOfLines={1}>
          Incoming booklist requests
        </Text>
        <View style={styles.busyControl}>
          <Text style={styles.busyLabel}>PEAK SEASON{'\n'}BUSY MODE</Text>
          <Switch
            value={busyMode}
            onValueChange={onBusyModeChange}
            trackColor={{ false: colors.borderStrong, true: colors.orange }}
            thumbColor={colors.surface}
            accessibilityLabel="Peak season busy mode"
          />
        </View>
        <Text style={styles.busyState} numberOfLines={2}>
          {busyMode
            ? 'ON — customers are told to expect slower replies'
            : 'OFF — you are quoting at normal speed'}
        </Text>
      </View>
    </View>
  );
}

/** Vendor sidebar: a column on wide screens, a drawer on mobile. */
export function VendorSidebar({
  activeKey,
  badges,
  onNavigate,
  drawerOpen,
  onCloseDrawer,
}: {
  activeKey: string;
  badges?: Record<string, number>;
  onNavigate: (item: VendorNavItem) => void;
  drawerOpen: boolean;
  onCloseDrawer: () => void;
}) {
  const { isMobile } = useLayout();

  const body = (
    <View style={styles.sidebar}>
      {VENDOR_NAV.map((item) => {
        const active = item.key === activeKey;
        const badge = badges?.[item.key];
        return (
          <Pressable
            key={item.key}
            onPress={() => onNavigate(item)}
            style={({ pressed }) => [
              styles.navRow,
              active && styles.navRowActive,
              pressed && !active && styles.navRowPressed,
            ]}
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
          >
            <Ionicons
              name={item.icon}
              size={18}
              color={active ? colors.orange : colors.textMuted}
            />
            {/* Two lines, not one: if a label ever outgrows the column
                (larger system font, a longer name) it wraps instead of
                being cut to "…". */}
            <Text style={[styles.navLabel, active && styles.navLabelActive]} numberOfLines={2}>
              {item.label}
            </Text>
            {!!badge && badge > 0 && (
              <View style={styles.badge}>
                <Text style={styles.badgeText}>{badge}</Text>
              </View>
            )}
          </Pressable>
        );
      })}
    </View>
  );

  if (!isMobile) return body;

  return (
    <Modal visible={drawerOpen} transparent animationType="fade" onRequestClose={onCloseDrawer}>
      <Pressable style={styles.scrim} onPress={onCloseDrawer} accessibilityLabel="Close menu" />
      <View style={styles.drawer}>{body}</View>
    </Modal>
  );
}

/** Shared card wrapper for the queue and the quote editor. */
export function Panel({
  title,
  right,
  children,
  collapsible,
}: {
  title: string;
  right?: ReactNode;
  children: ReactNode;
  collapsible?: boolean;
}) {
  const [open, setOpen] = useState(true);
  return (
    <View style={styles.panel}>
      <Pressable
        onPress={collapsible ? () => setOpen((v) => !v) : undefined}
        style={styles.panelHead}
        accessibilityRole={collapsible ? 'button' : undefined}
      >
        <Text style={styles.panelTitle} numberOfLines={1}>
          {title}
        </Text>
        {right}
        {collapsible && (
          <Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={18} color={colors.textMuted} />
        )}
      </Pressable>
      {open && <View>{children}</View>}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: { flexDirection: 'row', backgroundColor: colors.navy, alignItems: 'stretch' },
  brand: {
    backgroundColor: colors.orange,
    paddingHorizontal: spacing.lg,
    justifyContent: 'center',
    alignItems: 'center',
    minHeight: 56,
  },
  brandWide: { width: VENDOR_SIDEBAR_WIDTH },
  brandText: { color: colors.onNavy, fontSize: 24, fontWeight: '800', letterSpacing: 1 },

  barMain: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
  },
  search: {
    flex: 1,
    minWidth: 0,
    maxWidth: 420,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    height: 34,
  },
  searchInput: { flex: 1, minWidth: 0, fontSize: font.sm, color: colors.text },
  spacer: { flex: 1, minWidth: spacing.sm },

  vendorChip: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  vendorAvatar: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  vendorLabel: { color: 'rgba(255,255,255,0.65)', fontSize: 9, fontWeight: '700', letterSpacing: 0.5 },
  vendorName: { color: colors.onNavy, fontSize: font.sm, fontWeight: '700', maxWidth: 140 },
  bell: { padding: spacing.sm },

  busyStrip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    flexWrap: 'wrap',
    backgroundColor: colors.surfaceMuted,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  busyStripOn: { backgroundColor: '#FDF1E6' },
  busyContext: { flexShrink: 1, fontSize: font.sm, fontWeight: '700', color: colors.text },
  busyControl: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  busyLabel: {
    fontSize: 9,
    fontWeight: '800',
    color: colors.textMuted,
    letterSpacing: 0.4,
    textAlign: 'right',
  },
  busyState: { flexShrink: 1, fontSize: font.xs, color: colors.textMuted },

  sidebar: {
    width: VENDOR_SIDEBAR_WIDTH,
    backgroundColor: colors.surface,
    borderRightWidth: 1,
    borderRightColor: colors.border,
    paddingVertical: spacing.md,
  },
  navRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: 11,
    paddingHorizontal: spacing.lg,
    borderLeftWidth: 3,
    borderLeftColor: 'transparent',
  },
  navRowActive: { borderLeftColor: colors.orange, backgroundColor: colors.surfaceMuted },
  navRowPressed: { backgroundColor: colors.surfaceMuted },
  navLabel: { flex: 1, minWidth: 0, fontSize: font.md, lineHeight: 18, color: colors.textMuted, fontWeight: '500' },
  navLabelActive: { color: colors.text, fontWeight: '700' },
  badge: {
    minWidth: 20,
    height: 20,
    borderRadius: 10,
    paddingHorizontal: 5,
    backgroundColor: colors.orange,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: { color: colors.onNavy, fontSize: font.xs, fontWeight: '800' },

  scrim: { ...StyleSheet.absoluteFill, backgroundColor: 'rgba(15,30,61,0.45)' },
  drawer: { position: 'absolute', top: 0, bottom: 0, left: 0, ...shadow.raised },

  panel: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: spacing.lg,
    overflow: 'hidden',
    ...shadow.card,
  },
  panelHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.lg,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  panelTitle: { flex: 1, fontSize: font.lg, fontWeight: '700', color: colors.text },
});
