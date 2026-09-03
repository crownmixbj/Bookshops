import { useEffect, useMemo, useState } from 'react';
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

import { ActiveBooklists } from '../../components/dashboard/ActiveBooklists';
import { CreateBooklistSheet } from '../../components/dashboard/CreateBooklistSheet';
import { CreateBooklistModal } from '../../components/booklists/CreateBooklistModal';
import { pickBooklistImage, DRAFT_STATUS } from '../../lib/booklistUpload';
import { CreateBooklist } from '../../components/dashboard/CreateBooklist';
import { PendingQuotes } from '../../components/dashboard/PendingQuotes';
import { FeaturedShops } from '../../components/dashboard/FeaturedShops';
import { OrderSummary } from '../../components/dashboard/OrderSummary';

import { useLayout } from '../../hooks/useLayout';
import { useDashboardData } from '../../hooks/useDashboardData';
import { supabase } from '../../utils/supabase';
import { colors, spacing, radius, font } from '../../theme';
import { Footer } from '../../components/layout/Footer';

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
  const [newTitle, setNewTitle] = useState('');
  const [submitting, setSubmitting] = useState(false);

  /**
   * Per-item checkbox state, keyed by item id. Absent = checked, so a
   * newly loaded booklist arrives fully selected without seeding state.
   */
  const [selection, setSelection] = useState({});

  /** The create flow: pick a source, then name it and submit. */
  const [sheetOpen, setSheetOpen] = useState(false);
  const [pickedImage, setPickedImage] = useState(null);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [pickError, setPickError] = useState(null);
  const [created, setCreated] = useState(null);
  const [userId, setUserId] = useState(null);

  // The modal writes book_requests.buyer_id itself, so it needs the id
  // rather than the display name the dashboard hook returns.
  useEffect(() => {
    let alive = true;
    supabase.auth
      .getUser()
      .then(({ data }) => alive && setUserId(data.user?.id ?? null))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);
  const toggleItem = (id) =>
    setSelection((prev) => ({ ...prev, [id]: prev[id] === false ? true : false }));

  const {
    displayName,
    activeRequests,
    draftCount,
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
        // A draft. This box creates a list with no items in it, and a
        // published request with nothing to price reaches every vendor's
        // queue as a row they can only decline.
        status: DRAFT_STATUS,
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

  // Both "Create New Booklist" buttons — the navy tile here and the
  // orange one under My Pending Quotes — open the same sheet. The
  // inline title box below still creates in place for the quick path.
  const handleCreateNew = () => {
    setPickError(null);
    setSheetOpen(true);
  };

  /**
   * Turn a choice from the sheet into the next screen.
   *
   * Typing goes to its own route so it is linkable. Camera and library
   * both end at the same details modal — the only difference is where
   * the image came from — and the picker is opened BEFORE the modal so
   * a cancelled pick leaves nothing on screen to dismiss.
   */
  async function handleCreateSource(source) {
    setSheetOpen(false);
    if (source === 'manual') {
      router.push('/booklists/new-manual');
      return;
    }
    try {
      const picked = await pickBooklistImage(source);
      // Null means cancelled, or the permission was declined. Neither is
      // an error and neither should open anything.
      if (!picked) return;
      setPickedImage(picked);
      setDetailsOpen(true);
    } catch (e) {
      setPickError(e?.message ?? String(e));
    }
  }

  // `orders` does have an insert policy, an amount column and the
  // delivery fields — what is missing is the payment provider and a
  // quote to charge against. /checkout says exactly that instead of
  // pretending to collect card details.
  const handleCheckout = () => router.push('/checkout');

  const mainColumn = (
    <View style={styles.colGap}>
      <ActiveBooklists
        requests={activeRequests}
        selection={selection}
        onToggleItem={toggleItem}
        loading={loading}
        // The row still expands in place; this opens the full
        // breakdown with the quotes, which the hub card has no room
        // for. Demo rows carry made-up ids that no query can resolve,
        // so they get no link.
        onOpenRequest={(r) => !r.demo && router.push(`/booklists/${r.id}`)}
        // Drafts are filtered out of this card on purpose; the count is
        // only so the empty state can point at where they actually live.
        draftCount={draftCount}
        onOpenDrafts={() => router.push('/booklists')}
      />
      <PendingQuotes
        quotes={pendingQuotes}
        loading={loading}
        onCreatePress={handleCreateNew}
        onSelectQuote={(q) => router.push(`/quotes/${q.id}`)}
      />
    </View>
  );

  const sideColumn = (
    <View style={styles.colGap}>
      <CreateBooklist
        title={newTitle}
        onTitleChange={setNewTitle}
        onCapture={handleCreateNew}
        onSubmit={handleCreate}
        submitting={submitting}
      />
      <FeaturedShops
        shop={featuredShop}
        // No id means there is no shop to open — the card is showing
        // the "No shops yet" placeholder.
        onViewShop={(s) => s?.id && router.push(`/shops/${s.id}`)}
        onSelectCategory={(c) => router.push(`/categories/${c.slug}`)}
      />
    </View>
  );

  return (
    <>
      {/* The top bar and sidebar come from AppShell now. What is
          left here is the scrolling content and, on a wide screen,
          the order summary sitting beside it. */}
      <View style={styles.body}>
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

          {!!created && (
            <Banner
              tone="success"
              icon="checkmark-circle"
              text={created}
              action={{ label: 'Dismiss', onPress: () => setCreated(null) }}
            />
          )}

          {!!pickError && (
            <Banner
              tone="error"
              icon="alert-circle"
              text={`Could not open your photos: ${pickError}`}
              action={{ label: 'Dismiss', onPress: () => setPickError(null) }}
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
          <Footer />
        </ScrollView>

        {isDesktop && (
          <OrderSummary total={total} itemCount={itemCount} onCheckout={handleCheckout} />
        )}
      </View>

      {!isDesktop && (
        <OrderSummary total={total} itemCount={itemCount} onCheckout={handleCheckout} />
      )}

      <CreateBooklistSheet
        visible={sheetOpen}
        onSelect={handleCreateSource}
        onClose={() => setSheetOpen(false)}
      />

      <CreateBooklistModal
        visible={detailsOpen}
        userId={userId}
        initialImage={pickedImage}
        onClose={() => {
          setDetailsOpen(false);
          setPickedImage(null);
        }}
        onCreated={async (note) => {
          setCreated(
            note
              ? `Booklist sent. ${note}`
              : 'Booklist sent. Shops near you can now quote on it.'
          );
          // Pull the new row into Active Booklist Requests rather than
          // waiting for the next pull-to-refresh.
          await refresh();
        }}
      />
    </>
  );
}

const BANNER_TONES = {
  error: { bg: '#FCEAE8', border: '#F0C4BF', fg: colors.danger },
  success: { bg: '#E4F2E8', border: '#BFDFCB', fg: colors.success },
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
