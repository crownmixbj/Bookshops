import { View, Text, TextInput, Pressable, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing, radius, font, shadow } from '../../theme';
import { useLayout } from '../../hooks/useLayout';

/**
 * Top chrome: brand, global search, support, notifications, profile.
 * On mobile the brand collapses to the mark and a hamburger appears to
 * open the sidebar drawer.
 *
 * Layout note: the search box is flex:1 with a max width, so on wide
 * screens it stops growing and used to leave the action icons stranded
 * mid-bar with dead space to their right. `styles.spacer` absorbs that
 * slack instead, pinning the actions to the right edge at every width
 * while the search box keeps its cap.
 */
export function TopBar({
  query,
  onQueryChange,
  onMenuPress,
  onProfilePress,
  onSupportPress,
  unreadCount = 3,
}) {
  const { isMobile } = useLayout();

  return (
    <View style={styles.wrap}>
      <View style={styles.bar}>
        {isMobile && (
          <Pressable
            onPress={onMenuPress}
            style={styles.iconBtn}
            accessibilityRole="button"
            accessibilityLabel="Open navigation menu"
            hitSlop={8}
          >
            <Ionicons name="menu" size={22} color={colors.navy} />
          </Pressable>
        )}

        <View style={styles.brand}>
          <View style={styles.brandMark}>
            <Text style={styles.brandMarkText}>L</Text>
          </View>
          {!isMobile && <Text style={styles.brandText}>LOCI-BOOK</Text>}
        </View>

        <View style={styles.searchWrap}>
          <Ionicons name="search" size={16} color={colors.textFaint} style={styles.searchIcon} />
          <TextInput
            value={query}
            onChangeText={onQueryChange}
            placeholder={isMobile ? 'Search' : 'Find your bookshop or supplies'}
            placeholderTextColor={colors.textFaint}
            style={styles.searchInput}
            returnKeyType="search"
            accessibilityLabel="Find your bookshop or supplies"
          />
        </View>

        {/* Only grows where there is slack to absorb. On a phone the bar
            is already full, so a growing spacer would just steal width
            from the search box. */}
        <View style={isMobile ? styles.spacerMobile : styles.spacer} />

        <View style={styles.actions}>
        <Pressable
          onPress={onSupportPress}
          style={({ pressed }) => [styles.supportBtn, pressed && styles.supportBtnPressed]}
          accessibilityRole="button"
          accessibilityLabel="Contact support"
          hitSlop={8}
        >
          <Ionicons name="headset-outline" size={18} color={colors.navy} />
          {/* The word is dropped below tablet so the row never crowds
              the search box or the avatar. */}
          {!isMobile && <Text style={styles.supportText}>Support</Text>}
        </Pressable>

        <Pressable
          style={styles.iconBtn}
          accessibilityRole="button"
          accessibilityLabel={`Notifications, ${unreadCount} unread`}
          hitSlop={8}
        >
          <Ionicons name="notifications-outline" size={22} color={colors.navy} />
          {unreadCount > 0 && <View style={styles.badge} />}
        </Pressable>

        <Pressable
          onPress={onProfilePress}
          style={styles.avatar}
          accessibilityRole="button"
          accessibilityLabel="Your profile"
          hitSlop={8}
        >
          <Ionicons name="person" size={17} color={colors.onNavy} />
        </Pressable>
        </View>
      </View>

      <View style={styles.ribbon}>
        <Text style={styles.ribbonText} numberOfLines={1}>
          Welcome to LOCI — Your Nationwide School Supply & Book Marketplace.
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    backgroundColor: colors.surface,
    zIndex: 20,
    ...shadow.card,
  },
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  brand: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  brandMark: {
    width: 30,
    height: 30,
    borderRadius: radius.sm,
    backgroundColor: colors.orange,
    alignItems: 'center',
    justifyContent: 'center',
  },
  brandMarkText: { color: colors.onNavy, fontWeight: '800', fontSize: font.lg },
  brandText: {
    color: colors.navy,
    fontWeight: '800',
    fontSize: font.xl,
    letterSpacing: 0.5,
  },

  searchWrap: {
    flex: 1,
    flexShrink: 1,
    // A flex item's default min-width is `auto`, so on a narrow screen
    // the box refuses to shrink below its placeholder text and overflows
    // under the action icons. minWidth 0 lets it actually shrink.
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surfaceMuted,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
    height: 38,
    maxWidth: 560,
  },
  spacer: { flex: 1, minWidth: spacing.sm },
  spacerMobile: { width: spacing.xs },
  actions: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  supportBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: spacing.md,
    paddingVertical: 7,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceMuted,
  },
  supportBtnPressed: { backgroundColor: colors.border },
  supportText: { fontSize: font.sm, fontWeight: '700', color: colors.navy },

  searchIcon: { marginRight: spacing.sm },
  searchInput: {
    flex: 1,
    minWidth: 0,
    fontSize: font.md,
    color: colors.text,
    // RN-Web draws a focus ring on TextInput; remove it, the border is enough.
    outlineStyle: 'none',
  },

  iconBtn: { padding: spacing.sm },
  badge: {
    position: 'absolute',
    top: 6,
    right: 6,
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.orange,
  },
  avatar: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.navy,
    alignItems: 'center',
    justifyContent: 'center',
  },

  ribbon: {
    backgroundColor: colors.navy,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.lg,
    alignItems: 'center',
  },
  ribbonText: { color: colors.onNavy, fontSize: font.sm, fontWeight: '600' },
});
