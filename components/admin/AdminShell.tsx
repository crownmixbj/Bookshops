import { ReactNode } from 'react';
import { View, Text, TextInput, Pressable, Modal, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing, radius, font, shadow } from '../../theme';
import { useLayout } from '../../hooks/useLayout';

/**
 * Where an admin nav item goes. A union, so a link to a screen that does
 * not exist is a compile error rather than an "Unmatched Route" tap.
 *
 * Dashboard points at `/admin` — the control centre that is actually
 * built — not an empty `/admin/dashboard`. Settings points at the shared
 * `/settings`, which already branches on role; a second admin-only
 * settings screen would be two places to change one preference.
 */
export type AdminRoute =
  | '/admin'
  | '/admin/analytics'
  | '/admin/vendors'
  | '/admin/users'
  | '/admin/booklists'
  | '/admin/orders'
  | '/admin/payments'
  | '/admin/support'
  | '/settings';

export interface AdminNavItem {
  key: string;
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  /** null for Logout, which is an action rather than a destination. */
  route: AdminRoute | null;
  badge?: number;
}

export const ADMIN_NAV: AdminNavItem[] = [
  { key: 'dashboard', label: 'Dashboard', icon: 'home-outline', route: '/admin' },
  { key: 'analytics', label: 'Platform Analytics', icon: 'bar-chart-outline', route: '/admin/analytics' },
  { key: 'vendors', label: 'Vendor Management', icon: 'storefront-outline', route: '/admin/vendors' },
  { key: 'users', label: 'User Management', icon: 'people-outline', route: '/admin/users' },
  { key: 'booklists', label: 'Booklist Hub', icon: 'bookmark-outline', route: '/admin/booklists' },
  { key: 'orders', label: 'Orders Overview', icon: 'receipt-outline', route: '/admin/orders' },
  { key: 'payments', label: 'Financials & Payments', icon: 'wallet-outline', route: '/admin/payments' },
  { key: 'support', label: 'Customer Support', icon: 'chatbubble-outline', route: '/admin/support' },
  { key: 'settings', label: 'Settings', icon: 'settings-outline', route: '/settings' },
  { key: 'logout', label: 'Logout', icon: 'log-out-outline', route: null },
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
