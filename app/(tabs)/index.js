import { useMemo, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  RefreshControl,
  Pressable,
  StyleSheet,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';

import { TopBar } from '../../components/dashboard/TopBar';
import { Sidebar } from '../../components/dashboard/Sidebar';
import { ActiveBooklists } from '../../components/dashboard/ActiveBooklists';
import { CreateBooklist } from '../../components/dashboard/CreateBooklist';
import { PendingQuotes } from '../../components/dashboard/PendingQuotes';
import { FeaturedShops } from '../../components/dashboard/FeaturedShops';
import { OrderSummary } from '../../components/dashboard/OrderSummary';
import { ProfileMenu } from '../../components/profile/ProfileMenu';
import { SupportMenu } from '../../components/support/SupportMenu';
import { SupportDrawer } from '../../components/support/SupportDrawer';

import { useLayout } from '../../hooks/useLayout';
import { useDashboardData } from '../../hooks/useDashboardData';
import { supabase } from '../../utils/supabase';
import { colors, spacing, radius, font } from '../../theme';

/**
 * Booklist Hub — the buyer's dashboard.
 *
 * Layout, by width:
 *   desktop (1180+)  sidebar | [ main column | right column ] | order summary
 *   tablet  (768+)   icon rail | two content columns, summary docked at foot
 *   mobile  (<768)   drawer + single column, summary docked at foot
 */
export default function DashboardScreen() {
  const { isDesktop, isMobile, contentPadding } = useLayout();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [supportOpen, setSupportOpen] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [newTitle, setNewTitle] = useState('');
  const [submitting, setSubmitting] = useState(false);

  /**
   * Per-item checkbox state, keyed by item id. Absent = checked, so a
   * newly loaded booklist arrives fully selected without seeding state.
   */
  const [selection, setSelection] = useState({});
  const toggleItem = (id) =>
    setSelection((prev) => ({ ...prev, [id]: prev[id] === false ? true : false }));

  const {
    displayName,
    activeRequests,
    pendingQuotes,
    featuredShop,
    loading,
    refreshing,
    refresh,
    error,
    diagnostics,
    usingDemoData,
    isEmptyProject,
  } = useDashboardData();

  // Order total recomputed from the visible checkboxes, so unticking a
  // book updates the summary immediately.
  const { total, itemCount } = useMemo(() => {
    const items = activeRequests?.[0]?.items ?? [];
    const chosen = items.filter((i) => selection[i.id] !== false);
    return {
      itemCount: chosen.length,
      total: chosen.reduce(
        (sum, i) => sum + (Number(i.unit_price) || 0) * (Number(i.quantity) || 1),
        0
      ),
    };
  }, [activeRequests, selection]);

  const handleNavigate = async (item) => {
    if (item.key === 'logout') {
      await supabase.auth.signOut(); // app/_layout.js redirects to /auth/login
      return;
    }
    // Only these routes exist as files; the rest of the sidebar is inert
    // until those screens are built.
    const implemented = { booklists: '/booklists', orders: '/orders', saved: '/saved', settings: '/settings' };
    const target = implemented[item.key];
    if (target) router.push(target);
  };

  const handleCreate = async () => {
    setSubmitting(true);
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return router.push('/auth/login');

      // NOTE: book_requests has no `title` column — the mockup's title
      // field maps onto school_name until the schema grows a real one.
      const { error: insertError } = await supabase.from('book_requests').insert({
        buyer_id: user.id,
        school_name: newTitle.trim(),
        class_level: '',
        status: 'pending_quote',
      });
      if (insertError) throw insertError;

      setNewTitle('');
      refresh();
    } catch (e) {
      console.warn('[dashboard] could not create booklist:', e.message);
    } finally {
      setSubmitting(false);
    }
  };

  // TODO: wire to expo-image-picker + Supabase Storage ('booklists' bucket).
  // The bucket exists but has no storage policies, so uploads are denied
  // for every signed-in user today.
  const handleCapture = () => console.log('[dashboard] capture booklist photo');

  const handleCheckout = () => {
    console.log('[dashboard] checkout', { total, itemCount });
    // TODO: create an `orders` row, then hand off to the payment provider.
    // Blocked today: `orders` has RLS enabled with no policies, so the
    // insert silently fails, and there is no amount column to record this
    // total against.
  };

  const mainColumn = (
    <View style={styles.colGap}>
      <ActiveBooklists
        requests={activeRequests}
        selection={selection}
        onToggleItem={toggleItem}
        loading={loading}
      />
      <PendingQuotes
        quotes={pendingQuotes}
        loading={loading}
        onCreatePress={handleCapture}
        onSelectQuote={(q) => console.log('[dashboard] open quote', q.id)}
      />
    </View>
  );

  const sideColumn = (
    <View style={styles.colGap}>
      <CreateBooklist
        title={newTitle}
        onTitleChange={setNewTitle}
        onCapture={handleCapture}
        onSubmit={handleCreate}
        submitting={submitting}
      />
      <FeaturedShops
        shop={featuredShop}
        onViewShop={(s) => console.log('[dashboard] view shop', s?.id)}
        onSelectCategory={(c) => console.log('[dashboard] category', c.id)}
      />
    </View>
  );

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

      <View style={styles.body}>
        <Sidebar
          activeKey="dashboard"
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
            <Text style={styles.h1}>Booklist Hub</Text>
            <Text style={styles.h2}>Welcome back, {displayName}</Text>
          </View>

          {error && (
            <Banner
              tone="error"
              icon="alert-circle"
              text={`Could not load your dashboard: ${error.message}`}
              action={{ label: 'Retry', onPress: refresh }}
            />
          )}

          {!error && usingDemoData && (
            <Banner
              tone="info"
              icon="information-circle"
              text={
                isEmptyProject
                  ? 'Your account is set up. Nothing has been added to the marketplace yet, so the cards below show example data.'
                  : 'Some panels are showing example data because there are no rows for them yet.'
              }
            />
          )}

          {diagnostics.map((d, i) => (
            <Banner
              key={i}
              tone={d.level === 'error' ? 'error' : 'warning'}
              icon="warning"
              text={d.message}
            />
          ))}

          {isMobile ? (
            <View style={styles.colGap}>
              {sideColumn}
              {mainColumn}
            </View>
          ) : (
            <View style={styles.columns}>
              <View style={styles.mainCol}>{mainColumn}</View>
              <View style={styles.sideCol}>{sideColumn}</View>
            </View>
          )}

          <View style={{ height: isDesktop ? 0 : 24 }} />
        </ScrollView>

        {isDesktop && (
          <OrderSummary total={total} itemCount={itemCount} onCheckout={handleCheckout} />
        )}
      </View>

      {!isDesktop && (
        <OrderSummary total={total} itemCount={itemCount} onCheckout={handleCheckout} />
      )}
    </SafeAreaView>
  );
}

const BANNER_TONES = {
  error: { bg: '#FCEAE8', border: '#F0C4BF', fg: colors.danger },
  warning: { bg: colors.warningBg, border: '#F0DDBB', fg: colors.warning },
  info: { bg: '#EAF1FB', border: '#CFDDF2', fg: colors.navy },
};

function Banner({ tone = 'info', icon, text, action }) {
  const t = BANNER_TONES[tone] ?? BANNER_TONES.info;
  return (
    <View style={[styles.banner, { backgroundColor: t.bg, borderColor: t.border }]}>
      <Ionicons name={icon} size={16} color={t.fg} />
      <Text style={[styles.bannerText, { color: t.fg }]}>{text}</Text>
      {action && (
        <Pressable onPress={action.onPress} hitSlop={6}>
          <Text style={styles.bannerAction}>{action.label}</Text>
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.page },
  body: { flex: 1, flexDirection: 'row' },
  scroll: { flex: 1 },
  scrollContent: { paddingBottom: spacing.xxl },

  heading: { marginBottom: spacing.lg },
  h1: { fontSize: 22, fontWeight: '800', color: colors.text },
  h2: { fontSize: font.md, color: colors.textMuted, marginTop: 2 },

  columns: { flexDirection: 'row', gap: spacing.lg, alignItems: 'flex-start' },
  mainCol: { flex: 1.55, minWidth: 300 },
  sideCol: { flex: 1, minWidth: 260 },
  colGap: { gap: spacing.lg },

  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    borderWidth: 1,
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  bannerText: { flex: 1, fontSize: font.sm, lineHeight: 18 },
  bannerAction: { fontSize: font.sm, fontWeight: '800', color: colors.navy },
});
