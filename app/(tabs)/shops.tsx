import { useMemo, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  ScrollView,
  RefreshControl,
  Pressable,
  ActivityIndicator,
  StyleSheet,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';

import { ShopCard } from '../../components/shops/ShopCard';
import { Footer } from '../../components/layout/Footer';
import { useShell } from '../../components/layout/ShellContext';

import { useLayout } from '../../hooks/useLayout';
import { useVendorDirectory } from '../../hooks/useVendorDirectory';
import { useAuthGate } from '../../hooks/useAuthGate';
import { SignInPrompt } from '../../components/auth/SignInPrompt';
import { colors, spacing, radius, font, shadow } from '../../theme';
import type { ShopView } from '../../types/db';

/**
 * Explore Bookshops — the directory of every shop that can quote a
 * booklist.
 *
 * Distinct from Saved Shops, which is the buyer's own shortlist. This is
 * the whole approved marketplace, and it is where a buyer goes to send a
 * list to one shop rather than to everybody.
 */
export default function BookshopsScreen() {
  const { isMobile, isDesktop, contentPadding } = useLayout();
  // The shell's top-bar search follows the buyer between screens; this
  // page has its own box as well because a directory is the one place
  // you search by name without having navigated here to do it.
  const { search: shellSearch } = useShell();
  const [localSearch, setLocalSearch] = useState('');
  const [city, setCity] = useState<string | null>(null);
  // Saved Shops is a tab here rather than a screen of its own: a
  // shortlist of shops is a filter over the directory, not a different
  // place to be. /saved redirects in for anyone with the old bookmark.
  const [tab, setTab] = useState<'all' | 'saved'>('all');
  const [gridWidth, setGridWidth] = useState<number | null>(null);

  const {
    userId,
    shops,
    cities,
    recentlyViewed,
    savedCount,
    recordView,
    loading,
    refreshing,
    error,
    pending,
    toggleSaved,
    refresh,
  } = useVendorDirectory();

  // Browsing is open to everyone; saving a shop is personal, so a guest
  // is asked to sign in at that moment — and the save goes through once
  // they have, without losing their place in the list.
  const gate = useAuthGate();
  const saveShop = (shop: ShopView) =>
    gate.requireAuth(() => toggleSaved(shop), 'Log in to save shops to your shortlist.');

  const q = (localSearch || shellSearch).trim().toLowerCase();

  const visible = useMemo(
    () =>
      shops.filter((s) => {
        if (tab === 'saved' && !s.isSaved) return false;
        if (city && (s.city ?? '') !== city) return false;
        if (!q) return true;
        return (
          s.store_name.toLowerCase().includes(q) ||
          (s.city ?? '').toLowerCase().includes(q) ||
          (s.address ?? '').toLowerCase().includes(q)
        );
      }),
    [shops, tab, city, q]
  );

  function handleView(shop: ShopView) {
    recordView(shop.id);
    router.push(`/shops/${shop.id}`);
  }

  const columns = isDesktop ? 3 : isMobile ? 1 : 2;
  const gap = spacing.md;
  const cardWidth =
    gridWidth && columns > 1 ? (gridWidth - gap * (columns - 1)) / columns : undefined;

  return (
    <>
    <ScrollView
      style={styles.scroll}
      contentContainerStyle={[styles.scrollContent, { padding: contentPadding }]}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} />}
      showsVerticalScrollIndicator={false}
    >
      <View style={styles.heading}>
        <Text style={styles.h1}>Explore Bookshops</Text>
        <Text style={styles.h2}>
          {loading
            ? 'Finding shops near you…'
            : tab === 'saved'
            ? `${savedCount} shop${savedCount === 1 ? '' : 's'} you have saved`
            : `${shops.length} verified shop${shops.length === 1 ? '' : 's'} can quote your booklists`}
        </Text>
      </View>

      <View style={styles.tabs}>
        <Tab
          label="All Shops"
          count={shops.length}
          active={tab === 'all'}
          onPress={() => setTab('all')}
        />
        <Tab
          label="Saved Shops"
          count={savedCount}
          active={tab === 'saved'}
          onPress={() =>
            gate.requireAuth(() => setTab('saved'), 'Log in to see the shops you have saved.')
          }
        />
      </View>

      <View style={styles.searchBox}>
        <Ionicons name="search" size={17} color={colors.textFaint} />
        <TextInput
          value={localSearch}
          onChangeText={setLocalSearch}
          placeholder="Search shops by name, city or address"
          placeholderTextColor={colors.textFaint}
          style={styles.searchInput}
          accessibilityLabel="Search bookshops"
          returnKeyType="search"
        />
        {localSearch.length > 0 && (
          <Pressable onPress={() => setLocalSearch('')} hitSlop={8} accessibilityLabel="Clear search">
            <Ionicons name="close-circle" size={17} color={colors.textFaint} />
          </Pressable>
        )}
      </View>

      {/* Cities come from the rows on screen, so this row never offers a
          filter that would return nothing. */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.chips}
      >
        <Chip label="All cities" active={!city} onPress={() => setCity(null)} />
        {cities.map((c) => (
          <Chip key={c} label={c} icon="location-outline" active={city === c} onPress={() => setCity(city === c ? null : c)} />
        ))}
      </ScrollView>

      {error && (
        <View style={styles.errorBox}>
          <Ionicons name="alert-circle" size={16} color={colors.danger} />
          <Text style={styles.errorText}>{error.message}</Text>
          <Pressable onPress={refresh} hitSlop={6}>
            <Text style={styles.retry}>Retry</Text>
          </Pressable>
        </View>
      )}

      {loading ? (
        <View style={styles.loading}>
          <ActivityIndicator color={colors.navy} />
        </View>
      ) : visible.length === 0 ? (
        <View style={styles.empty}>
          <Ionicons
            name={tab === 'saved' ? 'bookmark-outline' : 'storefront-outline'}
            size={26}
            color={colors.textFaint}
          />
          <Text style={styles.emptyText}>
            {tab === 'saved' && savedCount === 0
              ? 'You have not saved any shops yet. Tap the bookmark on a shop to keep it here.'
              : shops.length === 0
              ? 'No shops have been approved yet. Send your booklist to the open marketplace and it will reach them as they join.'
              : 'No shops match that. Try a different name, or clear the filters.'}
          </Text>
        </View>
      ) : (
        <View
          style={[styles.grid, { gap }]}
          onLayout={(e) => setGridWidth(e.nativeEvent.layout.width)}
        >
          {visible.map((shop) => (
            <ShopCard
              key={shop.id}
              shop={shop}
              width={cardWidth}
              saving={pending[shop.id]}
              onView={handleView}
              onToggleSaved={saveShop}
            />
          ))}
        </View>
      )}

      {/* Kept from the old Saved Shops screen. It earns its place on the
          Saved tab, where a buyer with no bookmarks yet has somewhere to
          start; on All Shops it would just repeat the grid above it. */}
      {tab === 'saved' && !loading && recentlyViewed.length > 0 && (
        <View style={styles.recent}>
          <Text style={styles.recentTitle}>Recently viewed</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.recentRow}>
            {recentlyViewed.map((shop) => (
              <Pressable
                key={shop.id}
                onPress={() => handleView(shop)}
                style={({ pressed }) => [styles.recentCard, pressed && styles.pressed]}
                accessibilityRole="button"
                accessibilityLabel={`Open ${shop.store_name}`}
              >
                <View style={styles.recentLogo}>
                  <Text style={styles.recentLogoText}>
                    {(shop.store_name || '?').slice(0, 1).toUpperCase()}
                  </Text>
                </View>
                <Text style={styles.recentName} numberOfLines={1}>
                  {shop.store_name}
                </Text>
                <Text style={styles.recentCity} numberOfLines={1}>
                  {shop.city || 'Location not set'}
                </Text>
              </Pressable>
            ))}
          </ScrollView>
        </View>
      )}

      <Footer />

    </ScrollView>

    <SignInPrompt
      visible={gate.promptVisible}
      reason={gate.promptReason}
      onClose={gate.closePrompt}
      onAuthenticated={gate.onAuthenticated}
    />
    </>
  );
}

function Tab({
  label,
  count,
  active,
  onPress,
}: {
  label: string;
  count: number;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.tab, active && styles.tabOn, pressed && styles.pressed]}
      accessibilityRole="tab"
      accessibilityState={{ selected: active }}
      accessibilityLabel={`${label}, ${count}`}
    >
      <Text style={[styles.tabText, active && styles.tabTextOn]}>{label}</Text>
      <View style={[styles.tabCount, active && styles.tabCountOn]}>
        <Text style={[styles.tabCountText, active && styles.tabCountTextOn]}>{count}</Text>
      </View>
    </Pressable>
  );
}

function Chip({
  label,
  icon,
  active,
  onPress,
}: {
  label: string;
  icon?: keyof typeof Ionicons.glyphMap;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.chip, active && styles.chipOn, pressed && styles.pressed]}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      accessibilityLabel={label}
    >
      {icon && <Ionicons name={icon} size={13} color={active ? colors.onNavy : colors.textMuted} />}
      <Text style={[styles.chipText, active && styles.chipTextOn]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1 },
  scrollContent: { paddingBottom: spacing.xxl },

  heading: { marginBottom: spacing.lg },
  h1: { fontSize: 22, fontWeight: '800', color: colors.text },
  h2: { fontSize: font.md, color: colors.textMuted, marginTop: 2 },

  searchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    minHeight: 44,
    marginBottom: spacing.md,
  },
  searchInput: { flex: 1, fontSize: font.md, color: colors.text, paddingVertical: 10 },

  tabs: {
    flexDirection: 'row',
    gap: spacing.xs,
    backgroundColor: colors.surfaceMuted,
    borderRadius: radius.md,
    padding: 4,
    marginBottom: spacing.md,
    alignSelf: 'flex-start',
  },
  tab: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: spacing.md,
    paddingVertical: 9,
    borderRadius: radius.sm,
    minHeight: 40,
  },
  tabOn: { backgroundColor: colors.surface, ...shadow.card },
  tabText: { fontSize: font.md, fontWeight: '700', color: colors.textMuted },
  tabTextOn: { color: colors.text },
  tabCount: {
    backgroundColor: colors.border,
    borderRadius: radius.pill,
    minWidth: 20,
    paddingHorizontal: 5,
    paddingVertical: 1,
    alignItems: 'center',
  },
  tabCountOn: { backgroundColor: colors.navy },
  tabCountText: { fontSize: font.xs, fontWeight: '800', color: colors.textMuted },
  tabCountTextOn: { color: colors.onNavy },

  recent: { marginTop: spacing.xl },
  recentTitle: { fontSize: font.md, fontWeight: '700', color: colors.text, marginBottom: spacing.md },
  recentRow: { gap: spacing.md, paddingRight: spacing.lg },
  recentCard: {
    width: 132,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: spacing.md,
    gap: 4,
  },
  recentLogo: {
    width: 32,
    height: 32,
    borderRadius: radius.sm,
    backgroundColor: colors.navy,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
  },
  recentLogoText: { color: colors.onNavy, fontWeight: '800', fontSize: font.md },
  recentName: { fontSize: font.sm, fontWeight: '700', color: colors.text },
  recentCity: { fontSize: font.xs, color: colors.textMuted },

  chips: { gap: spacing.sm, paddingBottom: spacing.lg, paddingRight: spacing.lg },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: 7,
  },
  chipOn: { backgroundColor: colors.navy, borderColor: colors.navy },
  chipText: { fontSize: font.sm, fontWeight: '700', color: colors.textMuted },
  chipTextOn: { color: colors.onNavy },

  grid: { flexDirection: 'row', flexWrap: 'wrap' },

  loading: { paddingVertical: spacing.xxl, alignItems: 'center' },
  empty: {
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.xxl,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: colors.borderStrong,
  },
  emptyText: {
    fontSize: font.md,
    color: colors.textMuted,
    textAlign: 'center',
    maxWidth: 340,
    lineHeight: 20,
  },

  errorBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: '#FCEAE8',
    borderColor: '#F0C4BF',
    borderWidth: 1,
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.lg,
  },
  errorText: { flex: 1, fontSize: font.sm, color: colors.danger },
  retry: { fontSize: font.sm, fontWeight: '800', color: colors.navy },
  pressed: { opacity: 0.85 },
});
