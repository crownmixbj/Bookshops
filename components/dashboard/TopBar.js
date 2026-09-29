import { useState } from 'react';
import { View, Text, TextInput, Pressable, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing, radius, font, shadow, typography } from '../../theme';
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
  // A dot on the hamburger when something inside the drawer needs
  // attention (unread messages) — on a phone the sidebar badge is
  // hidden until the drawer opens.
  menuBadge = false,
  onProfilePress,
  onSupportPress,
  onBrandPress,
  onNotificationsPress,
  // Was a hard-coded 3 — a dot that never went away because nothing
  // behind it could ever be read. Now the real unread count, or 0.
  unreadCount = 0,
  onSearchFocus,
  onSearchBlur,
  onSearchSubmit,
  // The results panel. Rendered by the shell, positioned here, because
  // only the bar knows where the search box actually sits.
  // No default: a `= null` default would make TypeScript infer the
  // prop as null-only in the .tsx callers.
  searchOverlay,
}) {
  const { isMobile } = useLayout();
  const [barHeight, setBarHeight] = useState(0);
  const [searchBox, setSearchBox] = useState({ x: 0, width: 0 });

  return (
    <View style={styles.wrap}>
      <View style={styles.bar} onLayout={(e) => setBarHeight(e.nativeEvent.layout.height)}>
        {isMobile && (
          <Pressable
            onPress={onMenuPress}
            style={styles.iconBtn}
            accessibilityRole="button"
            accessibilityLabel={menuBadge ? 'Open navigation menu, unread messages' : 'Open navigation menu'}
            hitSlop={8}
          >
            <Ionicons name="menu" size={22} color={colors.navy} />
            {menuBadge && <View style={styles.menuDot} />}
          </Pressable>
        )}

        {/* The logo is the universal way home: every marketplace teaches
            people to click it, and on a phone it is the only dashboard
            link that does not need the drawer. */}
        <Pressable
          onPress={onBrandPress}
          style={({ pressed }) => [styles.brand, pressed && styles.brandPressed]}
          accessibilityRole="link"
          accessibilityLabel="LOCI-BOOK home — go to your dashboard"
          hitSlop={6}
        >
          <View style={styles.brandMark}>
            <Text style={styles.brandMarkText}>L</Text>
          </View>
          {!isMobile && <Text style={styles.brandText}>LOCI-BOOK</Text>}
        </Pressable>

        <View
          style={styles.searchWrap}
          onLayout={(e) => setSearchBox({ x: e.nativeEvent.layout.x, width: e.nativeEvent.layout.width })}
        >
          <Ionicons name="search" size={16} color={colors.textFaint} style={styles.searchIcon} />
          <TextInput
            value={query}
            onChangeText={onQueryChange}
            placeholder={isMobile ? 'Search' : 'Search booklists, books or shops'}
            placeholderTextColor={colors.textFaint}
            style={styles.searchInput}
            returnKeyType="search"
            accessibilityLabel="Search booklists, books and shops"
            onFocus={onSearchFocus}
            onBlur={onSearchBlur}
            onSubmitEditing={onSearchSubmit}
          />
          {!!query && (
            <Pressable
              onPress={() => onQueryChange?.('')}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel="Clear search"
            >
              <Ionicons name="close-circle" size={16} color={colors.textFaint} />
            </Pressable>
          )}
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
          onPress={onNotificationsPress}
          style={styles.iconBtn}
          accessibilityRole="button"
          accessibilityLabel={
            unreadCount > 0 ? `Notifications, ${unreadCount} unread` : 'Notifications'
          }
          hitSlop={8}
        >
          <Ionicons name="notifications-outline" size={22} color={colors.navy} />
          {unreadCount > 0 && (
            <View style={styles.badge}>
              <Text style={styles.badgeText}>{unreadCount > 9 ? '9+' : unreadCount}</Text>
            </View>
          )}
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

      {!!searchOverlay && barHeight > 0 && (
        <View
          style={[
            styles.overlay,
            { top: barHeight - 4 },
            isMobile
              ? { left: spacing.md, right: spacing.md }
              : { left: searchBox.x, width: Math.max(searchBox.width, 420) },
          ]}
        >
          {searchOverlay}
        </View>
      )}

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
  brand: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, borderRadius: radius.sm },
  brandPressed: { opacity: 0.75 },
  overlay: { position: 'absolute', zIndex: 50, elevation: 12 },
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
    top: 2,
    right: 0,
    minWidth: 17,
    height: 17,
    borderRadius: 9,
    paddingHorizontal: 4,
    backgroundColor: colors.orange,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: colors.surface,
  },
  badgeText: { color: colors.onNavy, fontSize: 9, fontWeight: '800' },
  menuDot: {
    position: 'absolute',
    top: 5,
    right: 4,
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: colors.orange,
    borderWidth: 2,
    borderColor: colors.surface,
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
    // spacing.lg, up from md and originally sm. This is the full-bleed
    // navy band under the top bar and the first thing on the page, so
    // it sets the tone for everything below it; at 8px it read as a
    // system notification strip rather than a masthead. The minHeight
    // is what actually gives it presence — padding alone still collapses
    // to the height of one 13px line.
    paddingVertical: spacing.lg,
    paddingHorizontal: spacing.lg,
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // 13px / 500 / +0.3 tracking. The tracking is doing real work here:
  // this is a single wide line of near-white on navy, and letterforms
  // set tight on a dark ground read as heavier than they are.
  ribbonText: { ...typography.micro, color: colors.onNavy },
});
