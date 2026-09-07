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
import { CreateBooklistModal } from '../../components/CreateBooklistModal';
import { BooklistReviewModal } from '../../components/booklists/BooklistReviewModal';
import { CreateBooklist } from '../../components/dashboard/CreateBooklist';
import { PendingQuotes } from '../../components/dashboard/PendingQuotes';
import { FeaturedShops } from '../../components/dashboard/FeaturedShops';
import { OrderSummary } from '../../components/dashboard/OrderSummary';

import { useLayout } from '../../hooks/useLayout';
import { useDashboardData } from '../../hooks/useDashboardData';
import { useCreateBooklist } from '../../hooks/useCreateBooklist';
import { useAuthGate } from '../../hooks/useAuthGate';
import { SignInPrompt } from '../../components/auth/SignInPrompt';
import { getSessionUserId, subscribeToAuthReloads } from '../../lib/loadState';
import { loadGuestDraft, draftHasContent } from '../../lib/guestDraft';
import { MANUAL_BOOKLIST_ROUTE } from '../../hooks/useCreateBooklist';
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

  /**
   * Per-item checkbox state, keyed by item id. Absent = checked, so a
   * newly loaded booklist arrives fully selected without seeding state.
   */
  const [selection, setSelection] = useState({});

  /**
   * The create flow. Shared with My Booklists so both screens offer the
   * same three choices and land in the same place.
   */
  const create = useCreateBooklist();
  const gate = useAuthGate();
  const [created, setCreated] = useState(null);
  const [userId, setUserId] = useState(null);
  /** A guest's unfinished list, read back from device storage. */
  const [guestDraft, setGuestDraft] = useState(null);

  // The modal writes book_requests.buyer_id itself, so it needs the id
  // rather than the display name the dashboard hook returns.
  //
  // getSessionUserId(), not supabase.auth.getUser(): getUser() is a
  // network round trip with no timeout, and this component fed its
  // result straight into BooklistReviewModal as `userId`. A hung
  // getUser() therefore looked exactly like being signed out — the
  // photo modal opened with userId still null and sat on its spinner.
  // getSessionUserId reads the cached session and gives up after 8s.
  //
  // Re-read on sign-in and sign-out too, so a guest who signs in from
  // the prompt gets a real id without a reload.
  useEffect(() => {
    let alive = true;
    const read = () => {
      getSessionUserId()
        .then((id) => alive && setUserId(id))
        .catch(() => alive && setUserId(null));
    };
    read();
    return subscribeToAuthReloads(read);
  }, []);

  // Only when signed out. A signed-in buyer's lists come from the
  // database, and showing a leftover device draft beside them would be
  // two competing copies of the same work.
  useEffect(() => {
    let alive = true;
    if (userId) {
      setGuestDraft(null);
      return () => {
        alive = false;
      };
    }
    loadGuestDraft()
      .then((draft) => alive && setGuestDraft(draftHasContent(draft) ? draft : null))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [userId, created]);
  const toggleItem = (id) =>
    setSelection((prev) => ({ ...prev, [id]: prev[id] === false ? true : false }));

  const {
    displayName,
    activeRequests,
    draftCount,
    orderedCount,
    pendingQuotes,
    featuredShop,
    loading,
    refreshing,
    refresh,
    revalidate,
    error,
    diagnostics,
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

  // The navy hero tile is the only way to start a booklist from this
  // screen, and it opens the same CreateBooklistModal My Booklists
  // opens. Nothing is written to book_requests until the buyer has
  // actually got a list — no more named-but-empty drafts.
  // Open to everyone. A guest builds the list locally and is asked to
  // sign in at the moment it would be dispatched — not before they know
  // whether the app is any use to them.
  const handleCreateNew = create.open;

  // `orders` does have an insert policy, an amount column and the
  // delivery fields — what is missing is the payment provider and a
  // quote to charge against. /checkout says exactly that instead of
  // pretending to collect card details.
  const handleCheckout = () =>
    gate.requireAuth(
      () => router.push('/checkout'),
      'Log in to check out and pay for this order.'
    );

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
        // An ordered list is an order now, and this is where it went.
        orderedCount={orderedCount}
        onOpenOrders={() => router.push('/orders')}
        // A guest's own list, kept on the device. Rendered instead of
        // the empty state, because "no active booklists" over a list
        // they typed ten minutes ago is simply wrong.
        guestDraft={guestDraft}
        onOpenGuestDraft={() => router.push(MANUAL_BOOKLIST_ROUTE)}
      />
      <PendingQuotes
        quotes={pendingQuotes}
        loading={loading}
        onSelectQuote={(q) => router.push(`/quotes/${q.id}`)}
      />
    </View>
  );

  const sideColumn = (
    <View style={styles.colGap}>
      <CreateBooklist onCapture={handleCreateNew} />
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

          {!!create.error && (
            <Banner
              tone="error"
              icon="alert-circle"
              text={`Could not open your photos: ${create.error}`}
              action={{ label: 'Dismiss', onPress: create.clearError }}
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
          <OrderSummary total={total} itemCount={itemCount} onCheckout={handleCheckout} loading={loading} />
        )}
      </View>

      {!isDesktop && (
        <OrderSummary total={total} itemCount={itemCount} onCheckout={handleCheckout} loading={loading} />
      )}

      <SignInPrompt
        visible={gate.promptVisible}
        reason={gate.promptReason}
        onClose={gate.closePrompt}
        // Signs in inside the sheet, then runs whatever was
        // blocked. Nothing navigates, so this screen keeps its
        // state — including any photo held in memory.
        onAuthenticated={gate.onAuthenticated}
      />

      <CreateBooklistModal
        visible={create.choosing}
        onClose={create.close}
        onPick={create.onPick}
        onDismissed={create.onDismissed}
        title={create.title}
        onTitleChange={create.setTitle}
      />

      {/* Camera and gallery both land here: the photo is uploaded and
          read, and nothing is written to book_requests until the buyer
          confirms the lines. OCR gets titles wrong, and a wrong title
          is a wrong quote. */}
      <BooklistReviewModal
        visible={create.image !== null}
        userId={userId}
        image={create.image}
        initialSchool={create.title}
        onClose={create.clearImage}
        // Steps aside while the sign-in sheet is up.
        //
        // SignInPrompt is written ABOVE this in the tree, and two
        // sibling RN Modals paint in tree order on web — so the sheet
        // opened behind this card and the guest saw nothing happen.
        // This does not unmount anything: the review modal keeps its
        // photo, its parsed lines and every edit, and comes straight
        // back when the sheet closes.
        suppressed={gate.promptVisible}
        // A guest reaches the end of the review screen and is asked
        // here, at the send, rather than at the camera button.
        onRequireAuth={() =>
          gate.requireAuth(
            () => {},
            'Create an account or log in to dispatch your booklist and receive quotes from local bookshops.'
          )
        }
        onSubmitted={async (message) => {
          setCreated(message);
          // Background re-read, not a refresh: the cards already on
          // screen have nothing wrong with them, and sending them back
          // to a skeleton because a NEW booklist was created is the
          // whole complaint. The new row appears in place.
          await revalidate();
        }}
      />

    </>
  );
}

/** Tailwind's max-w-7xl. Past this the dashboard centres instead of stretching. */
const CONTENT_MAX_WIDTH = 1280;

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
  /**
   * Content stops widening past CONTENT_MAX_WIDTH and centres itself.
   *
   * Below that this is inert; above it — an ultra-wide monitor — the
   * dashboard used to keep stretching, so two columns of cards sat on a
   * 2000px band with the text lines too long to scan comfortably. This
   * is the equivalent of Tailwind's `max-w-7xl mx-auto w-full`.
   */
  scrollContent: {
    paddingBottom: spacing.xxl,
    width: '100%',
    maxWidth: CONTENT_MAX_WIDTH,
    alignSelf: 'center',
  },

  heading: { marginBottom: spacing.lg },
  h1: { fontSize: 22, fontWeight: '800', color: colors.text },
  h2: { fontSize: font.md, color: colors.textMuted, marginTop: 2 },

  columns: { flexDirection: 'row', gap: spacing.lg, alignItems: 'flex-start', width: '100%' },
  mainCol: { flex: 1.55, minWidth: 300 },
  sideCol: { flex: 1, minWidth: 260 },
  colGap: { gap: spacing.lg, width: '100%' },

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
