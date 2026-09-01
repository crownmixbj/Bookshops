import { useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  RefreshControl,
  Pressable,
  ActivityIndicator,
  StyleSheet,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';

import { TopBar } from '../../components/dashboard/TopBar';
import { Sidebar, NAV_ITEMS } from '../../components/dashboard/Sidebar';
import { ProfileMenu } from '../../components/profile/ProfileMenu';
import { SupportMenu } from '../../components/support/SupportMenu';
import { SupportDrawer } from '../../components/support/SupportDrawer';
import { ShopCard } from '../../components/shops/ShopCard';
import { SendBooklistModal } from '../../components/shops/SendBooklistModal';

import { useLayout } from '../../hooks/useLayout';
import { useSavedShops } from '../../hooks/useSavedShops';
import { supabase } from '../../utils/supabase';
import { colors, spacing, radius, font } from '../../theme';
import type { ShopView } from '../../types/db';

const IMPLEMENTED = {
  dashboard: '/',
  booklists: '/booklists',
  orders: '/orders',
  saved: '/saved',
  settings: '/settings',
} as const;

export default function SavedShopsScreen() {
  const { isMobile, isDesktop, contentPadding } = useLayout();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [supportOpen, setSupportOpen] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [quoteTarget, setQuoteTarget] = useState<ShopView | null>(null);
  const [gridWidth, setGridWidth] = useState<number | null>(null);

  const {
    userId,
    saved,
    recent,
    loading,
    refreshing,
    error,
    pending,
    toggleSaved,
    recordView,
    refresh,
  } = useSavedShops();

  async function handleNavigate(item: (typeof NAV_ITEMS)[number]) {
    if (item.key === 'logout') {
      await supabase.auth.signOut();
      return;
    }
    const target = IMPLEMENTED[item.key as keyof typeof IMPLEMENTED];
    if (target && target !== '/saved') router.push(target);
  }

  // Opening a shop records the visit, which is what populates the
  // recently-viewed section. Fire-and-forget by design.
  function handleView(shop: ShopView) {
    recordView(shop.id);
    console.log('[shops] view shop', shop.id); // TODO: a /shops/[id] route
  }

  const q = search.trim().toLowerCase();
  const filter = (list: ShopView[]) =>
    q
      ? list.filter(
          (s) =>
            s.store_name.toLowerCase().includes(q) ||
            (s.city ?? '').toLowerCase().includes(q) ||
            (s.address ?? '').toLowerCase().includes(q)
        )
      : list;

  const visibleSaved = filter(saved);
  const visibleRecent = filter(recent);

  // Two columns from tablet up, measured from the container rather than
  // the window so the sidebar's width is accounted for.
  const columns = isDesktop ? 2 : isMobile ? 1 : 2;
  const gap = spacing.md;
  // Also applies at one column: without an explicit width the card sizes
  // to its content inside the wrapping row, which left mobile cards
  // ragged and narrower than the screen. gap * 0 is 0, so the single
  // column simply gets the full container width.
  const cardWidth = gridWidth ? (gridWidth - gap * (columns - 1)) / columns : undefined;

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'left', 'right']}>
      <TopBar
        query={search}
        onQueryChange={setSearch}
        onMenuPress={() => setDrawerOpen(true)}
        onProfilePress={() => setProfileOpen(true)}
        onSupportPress={() => setSupportOpen(true)}
      />

      <ProfileMenu visible={profileOpen} onClose={() => setProfileOpen(false)} />
      <SupportMenu
        visible={supportOpen}
        onClose={() => setSupportOpen(false)}
        onOpenChat={() => setChatOpen(true)}
      />
      <SupportDrawer visible={chatOpen} onClose={() => setChatOpen(false)} />
      <SendBooklistModal
        visible={quoteTarget !== null}
        shop={quoteTarget}
        userId={userId}
        onClose={() => setQuoteTarget(null)}
        onSent={refresh}
        onCreateNew={() => router.push('/booklists')}
      />

      <View style={styles.body}>
        <Sidebar
          activeKey="saved"
          onNavigate={handleNavigate}
          drawerOpen={drawerOpen}
          onCloseDrawer={() => setDrawerOpen(false)}
        />

        <ScrollView
          style={styles.scroll}
          contentContainerStyle={[styles.scrollContent, { padding: contentPadding }]}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} />}
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.heading}>
            <Text style={styles.h1}>Saved Shops</Text>
            <Text style={styles.h2}>
              {saved.length === 0
                ? 'Bookmark the shops you buy from most'
                : `${saved.length} shop${saved.length === 1 ? '' : 's'} saved`}
            </Text>
          </View>

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
          ) : saved.length === 0 ? (
            /* Empty state — the whole page, not a small note, because
               with nothing saved there is nothing else worth showing. */
            <View style={styles.emptyState}>
              <View style={styles.emptyIcon}>
                <Ionicons name="bookmark-outline" size={30} color={colors.navy} />
              </View>
              <Text style={styles.emptyTitle}>No saved shops yet</Text>
              <Text style={styles.emptyBody}>
                Save the bookshops you buy from and they'll be one tap away — with their
                ratings, contact details and a shortcut to send them your next booklist.
              </Text>
              <Pressable
                onPress={() => router.push('/')}
                style={({ pressed }) => [styles.emptyCta, pressed && styles.pressed]}
                accessibilityRole="button"
              >
                <Ionicons name="compass-outline" size={16} color={colors.onNavy} />
                <Text style={styles.emptyCtaText}>Explore the marketplace</Text>
              </Pressable>
            </View>
          ) : (
            <View
              style={[styles.grid, { gap }]}
              onLayout={(e) => setGridWidth(e.nativeEvent.layout.width)}
            >
              {visibleSaved.map((shop) => (
                <ShopCard
                  key={shop.id}
                  shop={shop}
                  width={cardWidth}
                  saving={pending[shop.id]}
                  onView={handleView}
                  onRequestQuote={setQuoteTarget}
                  onToggleSaved={toggleSaved}
                />
              ))}
              {visibleSaved.length === 0 && (
                <Text style={styles.noMatch}>No saved shops match “{search.trim()}”.</Text>
              )}
            </View>
          )}

          {visibleRecent.length > 0 && (
            <View style={styles.section}>
              <View style={styles.sectionHead}>
                <Ionicons name="time-outline" size={17} color={colors.navy} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.sectionTitle}>Recently viewed</Text>
                  <Text style={styles.sectionCaption}>Shops you looked at but haven't saved</Text>
                </View>
              </View>
              <View style={[styles.grid, { gap }]}>
                {visibleRecent.map((shop) => (
                  <ShopCard
                    key={shop.id}
                    shop={shop}
                    width={cardWidth}
                    saving={pending[shop.id]}
                    onView={handleView}
                    onRequestQuote={setQuoteTarget}
                    onToggleSaved={toggleSaved}
                  />
                ))}
              </View>
            </View>
          )}
        </ScrollView>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.page },
  body: { flex: 1, flexDirection: 'row' },
  scroll: { flex: 1 },
  scrollContent: { paddingBottom: spacing.xxl },

  heading: { marginBottom: spacing.xl },
  h1: { fontSize: 22, fontWeight: '800', color: colors.text },
  h2: { fontSize: font.md, color: colors.textMuted, marginTop: 2 },

  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  noMatch: { fontSize: font.md, color: colors.textMuted, paddingVertical: spacing.lg },

  section: { marginTop: spacing.xxl },
  sectionHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    marginBottom: spacing.md,
  },
  sectionTitle: { fontSize: font.lg, fontWeight: '700', color: colors.text },
  sectionCaption: { fontSize: font.sm, color: colors.textMuted, marginTop: 1 },

  emptyState: {
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: colors.borderStrong,
    paddingVertical: 52,
    paddingHorizontal: spacing.xl,
  },
  emptyIcon: {
    width: 62,
    height: 62,
    borderRadius: 31,
    backgroundColor: colors.surfaceMuted,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyTitle: { fontSize: font.xl, fontWeight: '800', color: colors.text },
  emptyBody: {
    fontSize: font.md,
    color: colors.textMuted,
    textAlign: 'center',
    lineHeight: 21,
    maxWidth: 380,
  },
  emptyCta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.orange,
    borderRadius: radius.md,
    paddingHorizontal: spacing.xl,
    paddingVertical: 12,
    marginTop: spacing.sm,
  },
  emptyCtaText: { color: colors.onNavy, fontWeight: '700', fontSize: font.md },

  loading: { paddingVertical: spacing.xxl, alignItems: 'center' },

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
