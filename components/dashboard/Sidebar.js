import { View, Text, Pressable, StyleSheet, Modal } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing, radius, shadow, typography } from '../../theme';
import { useLayout } from '../../hooks/useLayout';

/**
 * The buyer's navigation, in the order a booklist actually travels:
 * see what is happening, work on your lists, track what you ordered,
 * find a shop — then help, then settings.
 *
 * Dashboard is the index route `/`, not `/dashboard`. It is referenced
 * as `/` in about eighteen places (every admin and vendor gate button,
 * checkout, the back arrow on info pages), and moving it would leave `/`
 * unmatched for the sake of a tidier string.
 *
 * Saved Shops is deliberately absent: it is a tab inside Bookshops now,
 * because a shortlist of shops is a filter over the directory rather
 * than a different place to be.
 */
export const NAV_ITEMS = [
  { key: 'dashboard', label: 'Dashboard', icon: 'home-outline', route: '/' },
  { key: 'booklists', label: 'My Booklists', icon: 'list-outline', route: '/booklists' },
  { key: 'orders', label: 'My Orders', icon: 'cart-outline', route: '/orders' },
  { key: 'shops', label: 'Bookshops', icon: 'storefront-outline', route: '/shops' },
  { key: 'support', label: 'Help & Support', icon: 'help-buoy-outline', route: '/support' },
  { key: 'settings', label: 'Settings', icon: 'settings-outline', route: '/settings' },
  { key: 'logout', label: 'Logout', icon: 'log-out-outline', route: null, danger: true },
];

function NavRow({ item, active, collapsed, onPress }) {
  return (
    <Pressable
      onPress={() => onPress(item)}
      style={({ pressed }) => [
        styles.navRow,
        collapsed && styles.navRowCollapsed,
        active && styles.navRowActive,
        pressed && !active && styles.navRowPressed,
      ]}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      accessibilityLabel={item.label}
    >
      <Ionicons
        name={item.icon}
        size={19}
        color={active ? colors.onNavy : item.danger ? colors.textMuted : colors.navy}
      />
      {!collapsed && (
        <Text
          style={[styles.navLabel, active && styles.navLabelActive]}
          numberOfLines={1}
        >
          {item.label}
        </Text>
      )}
    </Pressable>
  );
}

function SidebarBody({ activeKey, onNavigate, collapsed, onClose }) {
  return (
    <View style={[styles.panel, collapsed && styles.panelCollapsed]}>
      <View style={styles.header}>
        {!collapsed && <Text style={styles.headerText}>My Dashboard</Text>}
        {onClose && (
          <Pressable onPress={onClose} hitSlop={8} accessibilityLabel="Close menu">
            <Ionicons name="close" size={20} color={colors.textMuted} />
          </Pressable>
        )}
      </View>

      <View style={styles.navList}>
        {NAV_ITEMS.map((item) => (
          <NavRow
            key={item.key}
            item={item}
            active={item.key === activeKey}
            collapsed={collapsed}
            onPress={onNavigate}
          />
        ))}
      </View>
    </View>
  );
}

/**
 * Renders as a permanent column on desktop, a narrow icon rail on tablet,
 * and a slide-over Modal drawer on mobile. The Modal keeps the drawer
 * above everything without a gesture library.
 */
export function Sidebar({ activeKey = 'dashboard', onNavigate, drawerOpen, onCloseDrawer }) {
  const { sidebarMode } = useLayout();

  if (sidebarMode === 'drawer') {
    return (
      <Modal
        visible={drawerOpen}
        transparent
        animationType="fade"
        onRequestClose={onCloseDrawer}
      >
        <Pressable style={styles.scrim} onPress={onCloseDrawer} accessibilityLabel="Close menu" />
        <View style={styles.drawer}>
          <SidebarBody
            activeKey={activeKey}
            collapsed={false}
            onClose={onCloseDrawer}
            onNavigate={(item) => {
              onCloseDrawer?.();
              onNavigate?.(item);
            }}
          />
        </View>
      </Modal>
    );
  }

  return (
    <SidebarBody
      activeKey={activeKey}
      collapsed={sidebarMode === 'rail'}
      onNavigate={onNavigate}
    />
  );
}

const styles = StyleSheet.create({
  panel: {
    width: 208,
    backgroundColor: colors.sidebar,
    borderRightWidth: 1,
    borderRightColor: colors.border,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.lg,
  },
  panelCollapsed: { width: 64, paddingHorizontal: spacing.sm },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.sm,
    marginBottom: spacing.lg,
    minHeight: 24,
  },
  headerText: { ...typography.cardTitle },

  navList: { gap: 4 },
  navRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: 11,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
  },
  navRowCollapsed: { justifyContent: 'center', paddingHorizontal: 0 },
  navRowActive: { backgroundColor: colors.navy },
  navRowPressed: { backgroundColor: colors.surfaceMuted },
  navLabel: { ...typography.heading, color: colors.text },
  navLabelActive: { color: colors.onNavy, fontWeight: '700' },

  scrim: { ...StyleSheet.absoluteFill, backgroundColor: 'rgba(15,30,61,0.45)' },
  drawer: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: 0,
    width: 240,
    backgroundColor: colors.sidebar,
    ...shadow.raised,
  },
});
