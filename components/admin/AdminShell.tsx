import { ReactNode } from 'react';
import { View, Text, TextInput, Pressable, Modal, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing, radius, font, shadow } from '../../theme';
import { useLayout } from '../../hooks/useLayout';

/**
 * Where an admin nav item goes. A union, so a link to a screen that does
 * not exist is a compile error rather than an "Unmatched Route" tap.
 *
 * These are the canonical paths. `/admin`, `/admin/payments` and
 * `/admin/support` still resolve — they are kept as redirect screens so
 * that bookmarks, the admin landing route and anything already linking
 * to them keep working — but nothing new should point at them.
 */
export type AdminRoute =
  | '/admin/dashboard'
  | '/admin/booklists'
  | '/admin/orders'
  | '/admin/disputes'
  | '/admin/vendors'
  | '/admin/users'
  | '/admin/catalog'
  | '/admin/financials'
  | '/admin/cms'
  | '/admin/analytics'
  | '/admin/settings';

export interface AdminNavItem {
  key: string;
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  /** null for Logout, which is an action rather than a destination. */
  route: AdminRoute | null;
  /** One line on what the section covers; announced as the a11y hint. */
  hint?: string;
  badge?: number;
}

/**
 * The admin menu, in operational order: what you check daily first,
 * then the people and money behind it, then the things you set once.
 *
 * `hint` is the one-line description of the section. It is not
 * decoration — it becomes the accessibility hint on the row, so a
 * screen reader announces what "Booklist Engine" actually covers.
 *
 * Icons are Ionicons, not Lucide: this project ships @expo/vector-icons
 * and nothing else, and adding a second icon set for three glyphs would
 * grow the bundle for no visible gain. The three that were named map
 * across as BookOpen -> book-outline, AlertTriangle -> warning-outline,
 * Image -> image-outline.
 */
export const ADMIN_NAV: AdminNavItem[] = [
  { key: 'dashboard', label: 'Dashboard', icon: 'home-outline', route: '/admin/dashboard',
    hint: 'Platform overview and today\u2019s activity' },
  { key: 'booklists', label: 'Booklist Engine', icon: 'documents-outline', route: '/admin/booklists',
    hint: 'Incoming customer lists, OCR outputs and request volume' },
  { key: 'orders', label: 'Orders Overview', icon: 'receipt-outline', route: '/admin/orders',
    hint: 'Platform-wide order activity' },
  { key: 'disputes', label: 'Disputes & Support', icon: 'warning-outline', route: '/admin/disputes',
    hint: 'Escrow holds, refund claims and support tickets' },
  { key: 'vendors', label: 'Vendor Management', icon: 'storefront-outline', route: '/admin/vendors',
    hint: 'Shop verifications, document review and vendor status' },
  { key: 'users', label: 'User Management', icon: 'people-outline', route: '/admin/users',
    hint: 'Buyer profiles and admin role assignments' },
  { key: 'catalog', label: 'Master Catalog', icon: 'book-outline', route: '/admin/catalog',
    hint: 'Master book database, curriculum lists and school directories' },
  { key: 'financials', label: 'Financials & Payouts', icon: 'wallet-outline', route: '/admin/financials',
    hint: 'Commission rates, payment gate logs and vendor payout approvals' },
  { key: 'cms', label: 'Banners & Marketing', icon: 'image-outline', route: '/admin/cms',
    hint: 'Homepage banners, promos and featured vendors' },
  { key: 'analytics', label: 'Platform Analytics', icon: 'bar-chart-outline', route: '/admin/analytics',
    hint: 'Marketplace performance metrics and reporting' },
  { key: 'settings', label: 'Settings', icon: 'settings-outline', route: '/admin/settings',
    hint: 'Your admin account and preferences' },
  { key: 'logout', label: 'Logout', icon: 'log-out-outline', route: null,
    hint: 'Sign out of the admin console' },
];

export function AdminTopBar({
  adminName,
  query,
  onQueryChange,
  onMenuPress,
  onProfilePress,
  alerts = 0,
}: {
  adminName: string;
  query: string;
  onQueryChange: (v: string) => void;
  onMenuPress: () => void;
  onProfilePress: () => void;
  alerts?: number;
}) {
  const { isMobile } = useLayout();

  return (
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
            placeholder={isMobile ? 'Search' : 'Find customer orders, books, or shops'}
            placeholderTextColor={colors.textFaint}
            style={styles.searchInput}
            accessibilityLabel="Search the platform"
          />
        </View>

        <View style={styles.spacer} />

        <Pressable
          onPress={onProfilePress}
          style={styles.adminChip}
          accessibilityRole="button"
          accessibilityLabel={`Admin account, ${adminName}`}
        >
          <View style={styles.avatar}>
            <Ionicons name="shield-checkmark" size={15} color={colors.navy} />
          </View>
          {!isMobile && (
            <Text style={styles.adminName} numberOfLines={1}>
              Admin: {adminName}
            </Text>
          )}
          <Ionicons name="chevron-down" size={14} color={colors.onNavy} />
        </Pressable>

        <Pressable style={styles.bell} accessibilityRole="button" accessibilityLabel={`${alerts} items need attention`}>
          <Ionicons name="notifications-outline" size={20} color={colors.onNavy} />
          {alerts > 0 && <View style={styles.bellDot} />}
        </Pressable>
      </View>
    </View>
  );
}

export function AdminSidebar({
  activeKey,
  badges,
  onNavigate,
  drawerOpen,
  onCloseDrawer,
}: {
  activeKey: string;
  badges?: Record<string, number>;
  onNavigate: (item: AdminNavItem) => void;
  drawerOpen: boolean;
  onCloseDrawer: () => void;
}) {
  const { isMobile } = useLayout();

  const body = (
    <View style={styles.sidebar}>
      {ADMIN_NAV.map((item) => {
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
            accessibilityLabel={item.label}
            // Announced by VoiceOver and TalkBack. It does NOT reach the
            // browser: react-native-web filters Pressable's props to a
            // whitelist, and accessibilityHint is not on it — nor are
            // aria-description or title, both of which were tried and
            // stripped. So on web the hint text is documentation for
            // whoever edits ADMIN_NAV, not something a screen reader
            // reads. Surfacing it in a browser would mean rendering it
            // as visible secondary text under each label.
            accessibilityHint={item.hint}
          >
            <Ionicons
              name={item.icon}
              size={17}
              color={active ? colors.navy : colors.textMuted}
            />
            <Text style={[styles.navLabel, active && styles.navLabelActive]} numberOfLines={1}>
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

export function Panel({
  title,
  right,
  children,
  style,
}: {
  title: string;
  right?: ReactNode;
  children: ReactNode;
  style?: object;
}) {
  return (
    <View style={[styles.panel, style]}>
      <View style={styles.panelHead}>
        <Text style={styles.panelTitle} numberOfLines={1}>
          {title}
        </Text>
        {right}
      </View>
      {children}
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
    minHeight: 54,
  },
  brandWide: { width: 200 },
  brandText: { color: colors.onNavy, fontSize: 22, fontWeight: '800', letterSpacing: 1 },

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
    height: 32,
  },
  searchInput: { flex: 1, minWidth: 0, fontSize: font.sm, color: colors.text },
  spacer: { flex: 1, minWidth: spacing.sm },

  adminChip: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  avatar: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  adminName: { color: colors.onNavy, fontSize: font.sm, fontWeight: '700', maxWidth: 160 },
  bell: { padding: spacing.sm },
  bellDot: {
    position: 'absolute',
    top: 6,
    right: 6,
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.orange,
  },

  sidebar: {
    width: 200,
    backgroundColor: colors.surface,
    borderRightWidth: 1,
    borderRightColor: colors.border,
    paddingVertical: spacing.md,
  },
  navRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: 10,
    paddingHorizontal: spacing.lg,
  },
  navRowActive: { backgroundColor: '#E9EFFA' },
  navRowPressed: { backgroundColor: colors.surfaceMuted },
  navLabel: { flex: 1, fontSize: font.sm, color: colors.textMuted, fontWeight: '500' },
  navLabelActive: { color: colors.navy, fontWeight: '700' },
  badge: {
    minWidth: 19,
    height: 19,
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
    overflow: 'hidden',
    ...shadow.card,
  },
  panelHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  panelTitle: { flex: 1, fontSize: font.md, fontWeight: '700', color: colors.text },
});
