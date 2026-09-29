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
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';

import { Panel } from '../../components/vendor/VendorShell';
import { QuoteEditor } from '../../components/vendor/QuoteEditor';
import { RequestQueue } from '../../components/vendor/RequestQueue';
import { SentQuoteModal } from '../../components/vendor/SentQuoteModal';
import { WorkspaceFooter } from '../../components/layout/WorkspaceFooter';
import { useShell } from '../../components/layout/ShellContext';

import { useLayout } from '../../hooks/useLayout';
import { useVendorQuotes, stateFor, isEditable, declinedBy } from '../../hooks/useVendorQuotes';
import { useVendorDashboard } from '../../hooks/useVendorDashboard';
import { colors, spacing, radius, font, shadow, formatNaira } from '../../theme';
import type { VendorQuoteRow, VendorQuoteState, VendorQuoteTab } from '../../types/db';

const TABS: { key: VendorQuoteTab; label: string }[] = [
  { key: 'all', label: 'All Quotes' },
  { key: 'pending', label: 'Pending Buyer Review' },
  { key: 'accepted', label: 'Accepted / Orders' },
  { key: 'declined', label: 'Declined' },
  // Drafts are unsent work. They are not in your spec, but a vendor who
  // saved one and closed the tab has no other way back to it.
  { key: 'draft', label: 'Drafts' },
];

const STATE_COPY: Record<
  VendorQuoteState,
  { label: string; bg: string; fg: string; icon: keyof typeof Ionicons.glyphMap }
> = {
  draft: { label: 'Draft', bg: colors.surfaceMuted, fg: colors.textMuted, icon: 'create-outline' },
  sent: { label: 'Quote Sent', bg: colors.warningBg, fg: colors.warning, icon: 'paper-plane-outline' },
  accepted: { label: 'Accepted', bg: '#E4F2E8', fg: colors.success, icon: 'checkmark-circle-outline' },
  ordered: { label: 'Ordered', bg: '#E4F2E8', fg: colors.success, icon: 'cube-outline' },
  declined: { label: 'Declined', bg: '#FCEAE8', fg: colors.danger, icon: 'close-circle-outline' },
};

/** The two halves of a shop's quoting work. */
type Section = 'incoming' | 'sent';

/**
 * Requests & Quotes — both sides of answering a booklist.
 *
 *   Incoming Queue   requests nobody at this shop has answered yet
 *   Sent Quotes      the record of what was answered, and what came of it
 *
 * One screen rather than two because they are one job: a vendor works
 * down the queue, then checks what came back. They were split across the
 * dashboard and a second page, which meant the answer to "did they take
 * my price?" lived somewhere other than the price.
 *
 * Both sections share one useVendorDashboard, so the QuoteEditor below
 * is the same editor with the same save path whichever tab opened it.
 * Pricing rules, availability switches and the unpriced-line guard all
 * live in saveQuote; a second editor would drift from them silently.
 */
export default function VendorQuotesScreen() {
  const { isMobile, contentPadding } = useLayout();
  const { search } = useShell();
  const [section, setSection] = useState<Section>('incoming');
  const [tab, setTab] = useState<VendorQuoteTab>('all');
  const [viewing, setViewing] = useState<VendorQuoteRow | null>(null);

  const { counts, filter, pendingValue, loading, refreshing, error, refresh } = useVendorQuotes();

  // The dashboard hook owns the editor. It loads the request queue, so
  // openRequest needs the queue row for a request — which exists for
  // exactly the quotes that are still editable, because
  // vendor_request_queue() only returns pending_quote and quoted
  // requests. An accepted quote is not in the queue and is not editable
  // either; the two rules agree by construction.
  const {
    vendor,
    isVendor,
    queue,
    selected,
    lines,
    imagePath,
    delivery,
    totals,
    loading: queueLoading,
    loadingDetail,
    busySaving,
    notice: editorNotice,
    error: editorError,
    openRequest,
    acceptRequest,
    claimingId,
    queueMessage,
    dismissQueueMessage,
    closeRequest,
    setLinePrice,
    setLineAvailable,
    deliveryText,
    setDeliveryText,
    saveQuote,
    declineRequest,
    refresh: refreshQueue,
  } = useVendorDashboard();

  function edit(row: VendorQuoteRow) {
    const queueRow = queue.find((qq) => qq.request_id === row.request_id);
    if (queueRow) openRequest(queueRow);
  }

  const query = search.trim().toLowerCase();

  /** The incoming queue, filtered by the shell's search box. */
  const incoming = query
    ? queue.filter(
        (r) =>
          (r.customer_name ?? '').toLowerCase().includes(query) ||
          r.reference.toLowerCase().includes(query) ||
          r.school_name.toLowerCase().includes(query) ||
          r.class_level.toLowerCase().includes(query)
      )
    : queue;

  /** Requests this shop has not quoted at all — the real "new" count. */
  const unanswered = queue.filter((r) => !r.my_quote_id).length;

  const visible = filter(tab).filter((row) =>
    query
      ? row.school_name.toLowerCase().includes(query) ||
        row.class_level.toLowerCase().includes(query) ||
        (row.customer_name ?? '').toLowerCase().includes(query) ||
        row.reference.toLowerCase().includes(query)
      : true
  );

  return (
    <ScrollView
      style={styles.scroll}
      contentContainerStyle={[styles.scrollContent, { padding: contentPadding }]}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} />}
      showsVerticalScrollIndicator={false}
    >
      <View style={[styles.heading, isMobile && styles.headingMobile]}>
        <View style={{ flex: 1 }}>
          <Text style={styles.h1}>Requests &amp; Quotes</Text>
          <Text style={styles.h2}>
            {section === 'incoming'
              ? queueLoading
                ? 'Loading the queue…'
                : `${unanswered} request${unanswered === 1 ? '' : 's'} waiting on you`
              : loading
              ? 'Loading your quotes…'
              : counts.all === 0
              ? 'Quotes you send will appear here'
              : `${counts.all} quote${counts.all === 1 ? '' : 's'} sent from this shop`}
          </Text>
        </View>

        {/* The number a shop owner actually wants on this page: what is
            out there unanswered. Hidden when it is zero rather than
            shown as ₦0, which reads as a bad month. */}
        {section === 'sent' && !loading && pendingValue > 0 && (
          <View style={styles.pendingValue}>
            <Text style={styles.pendingLabel}>Awaiting a decision</Text>
            <Text style={styles.pendingAmount}>{formatNaira(pendingValue)}</Text>
          </View>
        )}
      </View>

      {/* Two tabs, one job. Incoming is first because unanswered work
          decays — a request nobody quotes for two days is a customer
          who bought elsewhere. */}
      <View style={styles.sections}>
        <SectionTab
          label="Incoming Queue"
          count={unanswered}
          active={section === 'incoming'}
          onPress={() => setSection('incoming')}
        />
        <SectionTab
          label="Sent Quotes"
          count={counts.all}
          active={section === 'sent'}
          onPress={() => setSection('sent')}
        />
      </View>

      {!vendor && isVendor !== false && (
        <View style={styles.noticeBox}>
          <Ionicons name="information-circle" size={16} color={colors.warning} />
          <Text style={styles.noticeText}>
            Your shop isn't set up yet. Add your business details in Settings and requests
            will start appearing here.
          </Text>
        </View>
      )}

      {section === 'incoming' ? (
        queueLoading ? (
          <View style={styles.loading}>
            <ActivityIndicator color={colors.navy} />
          </View>
        ) : (
          <Panel
            title="New Booklist Requests"
            right={
              <Text style={styles.count}>
                {incoming.length} open{query ? ` of ${queue.length}` : ''}
              </Text>
            }
          >
            {!!queueMessage && (
              <View style={styles.claimNotice} accessibilityLiveRegion="polite">
                <Ionicons name="information-circle" size={16} color={colors.navy} />
                <Text style={styles.claimNoticeText}>{queueMessage}</Text>
                <Pressable onPress={dismissQueueMessage} hitSlop={8} accessibilityLabel="Dismiss">
                  <Ionicons name="close" size={16} color={colors.textMuted} />
                </Pressable>
              </View>
            )}
            <RequestQueue
              rows={incoming}
              selectedId={selected?.request_id ?? null}
              claimingId={claimingId}
              onView={acceptRequest}
              onDecline={(row) => declineRequest(row)}
            />
          </Panel>
        )
      ) : (
        <SentQuotes />
      )}

      <SentQuoteModal quote={viewing} onClose={() => setViewing(null)} />

      {/* Below both tabs, because a quote opened from either side is the
          same quote. Same component, same save path. */}
      {selected && (
        <View style={styles.editorLayer}>
          <Panel title={`Editing quote · ${selected.school_name}`}>
            <QuoteEditor
              request={selected}
              lines={lines}
              imagePath={imagePath}
              delivery={delivery}
              vendorId={vendor?.id ?? null}
              onLumpSumSaved={(status) => {
                refresh();
                refreshQueue();
                if (status === 'sent') closeRequest();
              }}
              totals={totals}
              deliveryText={deliveryText}
              onDeliveryChange={setDeliveryText}
              loading={loadingDetail}
              saving={busySaving}
              notice={editorNotice}
              error={editorError}
              onPriceChange={setLinePrice}
              onAvailabilityChange={setLineAvailable}
              onSaveDraft={async () => {
                if (await saveQuote('draft')) refresh();
              }}
              onSubmit={async () => {
                if (await saveQuote('sent')) {
                  refresh();
                  refreshQueue();
                  closeRequest();
                }
              }}
              onClose={closeRequest}
            />
          </Panel>
        </View>
      )}

      {/* Last, always. It used to sit above this editor, which put a
          footer in the middle of the page whenever a quote was open —
          the editor is conditional, so the bug only appeared once you
          were actually working. */}
      <WorkspaceFooter />
    </ScrollView>
  );

  function SentQuotes() {
    return (
      <>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tabs}>
        {TABS.map((t) => (
          <Pressable
            key={t.key}
            onPress={() => setTab(t.key)}
            style={({ pressed }) => [styles.tab, tab === t.key && styles.tabOn, pressed && styles.pressed]}
            accessibilityRole="tab"
            accessibilityState={{ selected: tab === t.key }}
            accessibilityLabel={`${t.label}, ${counts[t.key]}`}
          >
            <Text style={[styles.tabText, tab === t.key && styles.tabTextOn]}>{t.label}</Text>
            <View style={[styles.tabCount, tab === t.key && styles.tabCountOn]}>
              <Text style={[styles.tabCountText, tab === t.key && styles.tabCountTextOn]}>
                {counts[t.key]}
              </Text>
            </View>
          </Pressable>
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
        <EmptyState hasAny={counts.all > 0} tab={tab} />
      ) : (
        visible.map((row) => (
          <QuoteCard
            key={row.quote_id}
            row={row}
            compact={isMobile}
            onView={() => setViewing(row)}
            onEdit={() => edit(row)}
            canEdit={isEditable(row) && queue.some((qq) => qq.request_id === row.request_id)}
          />
        ))
      )}

      </>
    );
  }
}

function SectionTab({
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
      style={({ pressed }) => [styles.section, active && styles.sectionOn, pressed && styles.pressed]}
      accessibilityRole="tab"
      accessibilityState={{ selected: active }}
      accessibilityLabel={`${label}, ${count}`}
    >
      <Text style={[styles.sectionText, active && styles.sectionTextOn]}>{label}</Text>
      <View style={[styles.sectionCount, active && styles.sectionCountOn]}>
        <Text style={[styles.sectionCountText, active && styles.sectionCountTextOn]}>{count}</Text>
      </View>
    </Pressable>
  );
}

function QuoteCard({
  row,
  compact,
  canEdit,
  onView,
  onEdit,
}: {
  row: VendorQuoteRow;
  compact: boolean;
  canEdit: boolean;
  onView: () => void;
  onEdit: () => void;
}) {
  const state = stateFor(row);
  const copy = STATE_COPY[state];
  const short = row.quoted_item_count !== row.requested_item_count;
  const endedBy = declinedBy(row);

  return (
    <View style={styles.card}>
      <View style={[styles.cardHead, compact && styles.cardHeadMobile]}>
        <View style={{ flex: 1 }}>
          {/* Customer first. A shop owner recognises the parent before
              they recognise the school. */}
          <Text style={styles.customer} numberOfLines={1}>
            {row.customer_name || 'Customer name unavailable'}
            <Text style={styles.school}>
              {'  —  '}
              {[row.school_name, row.class_level].filter(Boolean).join(' ')}
            </Text>
          </Text>

          <View style={styles.chipRow}>
            <View style={[styles.chip, { backgroundColor: copy.bg }]}>
              <Ionicons name={copy.icon} size={11} color={copy.fg} />
              <Text style={[styles.chipText, { color: copy.fg }]}>{copy.label}</Text>
            </View>
            {/* "Declined" alone does not say by whom, and the three
                endings are not the same news: a buyer saying no is a
                lost job worth reading about, a withdrawal is the shop's
                own doing, and an expiry is a job they were too slow to
                answer. */}
            {endedBy === 'buyer' && (
              <View style={[styles.chip, { backgroundColor: '#FCEAE8' }]}>
                <Text style={[styles.chipText, { color: colors.danger }]}>By the customer</Text>
              </View>
            )}
            {endedBy === 'shop' && (
              <View style={[styles.chip, { backgroundColor: colors.surfaceMuted }]}>
                <Text style={[styles.chipText, { color: colors.textMuted }]}>You withdrew it</Text>
              </View>
            )}
            {endedBy === 'expired' && (
              <View style={[styles.chip, { backgroundColor: colors.warningBg }]}>
                <Text style={[styles.chipText, { color: colors.warning }]}>Expired unanswered</Text>
              </View>
            )}
            {row.is_targeted && (
              <View style={[styles.chip, { backgroundColor: '#E4EAF5' }]}>
                <Ionicons name="storefront-outline" size={11} color={colors.navy} />
                <Text style={[styles.chipText, { color: colors.navy }]}>Sent to you only</Text>
              </View>
            )}
            {row.order_fulfillment_status && (
              <View style={[styles.chip, { backgroundColor: colors.surfaceMuted }]}>
                <Text style={[styles.chipText, { color: colors.textMuted }]}>
                  {row.order_fulfillment_status}
                </Text>
              </View>
            )}
            <Text style={styles.reference}>{row.reference}</Text>
          </View>

          <Text style={styles.items}>
            {/* A photo-only booklist has no lines to count; it was quoted
                with one total and the shop's priced sheet. */}
            {row.requested_item_count === 0
              ? 'Photo booklist · quoted as one total'
              : `${row.quoted_item_count} of ${row.requested_item_count} item${
                  row.requested_item_count === 1 ? '' : 's'
                } quoted`}
            {/* Spelt out because it is the usual reason a buyer picks
                someone else, and the shop should see it here. */}
            {short && row.unavailable_count > 0
              ? ` · ${row.unavailable_count} marked out of stock`
              : ''}
          </Text>

          {/* Why the customer said no, on the card itself rather than
              only inside View Sent Quote: it is the one thing on a
              declined quote worth reading. */}
          {endedBy === 'buyer' && (
            <View style={styles.declineBox}>
              <Text style={styles.declineLabel}>Customer's reason</Text>
              <Text style={row.decline_reason ? styles.declineReason : styles.declineNone}>
                {row.decline_reason ? `“${row.decline_reason}”` : 'They did not say why.'}
              </Text>
            </View>
          )}
        </View>

        <View style={compact ? styles.totalMobile : styles.total}>
          <Text style={styles.totalLabel}>Quoted</Text>
          <Text style={styles.totalValue}>{formatNaira(row.total_price)}</Text>
        </View>
      </View>

      <View style={styles.actions}>
        <Pressable
          onPress={onView}
          style={({ pressed }) => [styles.btn, styles.btnGhost, pressed && styles.pressed]}
          accessibilityRole="button"
          accessibilityLabel={`View the quote you sent for ${row.school_name}`}
        >
          <Ionicons name="receipt-outline" size={15} color={colors.navy} />
          <Text style={styles.btnGhostText}>View Sent Quote</Text>
        </Pressable>

        {canEdit ? (
          <Pressable
            onPress={onEdit}
            style={({ pressed }) => [styles.btn, styles.btnPrimary, pressed && styles.pressed]}
            accessibilityRole="button"
            accessibilityLabel={`Edit your quote for ${row.school_name}`}
          >
            <Ionicons name="create-outline" size={15} color={colors.onNavy} />
            <Text style={styles.btnPrimaryText}>Edit Quote</Text>
          </Pressable>
        ) : (
          // Says why rather than hiding the button entirely: a vendor
          // looking for Edit should learn it is gone because the
          // customer accepted, not wonder if the page is broken.
          <Text style={styles.locked}>
            {state === 'ordered' || state === 'accepted'
              ? 'Accepted — no longer editable'
              : state === 'declined'
              ? 'Closed'
              : 'Not editable'}
          </Text>
        )}
      </View>
    </View>
  );
}

function EmptyState({ hasAny, tab }: { hasAny: boolean; tab: VendorQuoteTab }) {
  const perTab: Partial<Record<VendorQuoteTab, string>> = {
    pending: 'No quotes are waiting on a customer right now.',
    accepted: 'No quotes have been accepted yet.',
    declined: 'Nothing declined. That is a good sign.',
    draft: 'No unsent drafts.',
  };

  return (
    <View style={styles.empty}>
      <Ionicons name="documents-outline" size={28} color={colors.textFaint} />
      <Text style={styles.emptyText}>
        {hasAny
          ? perTab[tab] ?? 'Nothing here.'
          : "You haven't submitted any quotes yet. Check the New Requests Queue to respond to open booklists."}
      </Text>
      {!hasAny && (
        <Pressable
          onPress={() => router.push('/vendor')}
          style={({ pressed }) => [styles.emptyBtn, pressed && styles.pressed]}
          accessibilityRole="button"
          accessibilityLabel="Open the new requests queue"
        >
          <Text style={styles.emptyBtnText}>Open New Requests Queue</Text>
          <Ionicons name="arrow-forward" size={15} color={colors.onNavy} />
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  declineBox: {
    marginTop: spacing.sm,
    padding: spacing.sm,
    borderRadius: radius.sm,
    backgroundColor: '#FCEAE8',
  },
  declineLabel: { fontSize: font.xs, fontWeight: '800', color: colors.danger },
  declineReason: { fontSize: font.sm, color: colors.text, marginTop: 2, lineHeight: 18 },
  declineNone: { fontSize: font.sm, color: colors.textMuted, marginTop: 2 },
  scroll: { flex: 1 },
  scrollContent: { paddingBottom: spacing.xxl },

  heading: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md,
    marginBottom: spacing.lg,
  },
  headingMobile: { flexDirection: 'column' },
  h1: { fontSize: 22, fontWeight: '800', color: colors.text },
  h2: { fontSize: font.md, color: colors.textMuted, marginTop: 2 },
  pendingValue: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    alignItems: 'flex-end',
    ...shadow.card,
  },
  pendingLabel: { fontSize: font.xs, color: colors.textMuted },
  pendingAmount: { fontSize: font.xl, fontWeight: '800', color: colors.navy, marginTop: 1 },

  sections: {
    flexDirection: 'row',
    gap: spacing.xs,
    backgroundColor: colors.surfaceMuted,
    borderRadius: radius.md,
    padding: 4,
    marginBottom: spacing.lg,
    alignSelf: 'flex-start',
  },
  section: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: spacing.md,
    paddingVertical: 9,
    borderRadius: radius.sm,
    minHeight: 40,
  },
  sectionOn: { backgroundColor: colors.surface, ...shadow.card },
  sectionText: { fontSize: font.md, fontWeight: '700', color: colors.textMuted },
  sectionTextOn: { color: colors.text },
  sectionCount: {
    backgroundColor: colors.border,
    borderRadius: radius.pill,
    minWidth: 20,
    paddingHorizontal: 5,
    alignItems: 'center',
  },
  sectionCountOn: { backgroundColor: colors.navy },
  sectionCountText: { fontSize: font.xs, fontWeight: '800', color: colors.textMuted },
  sectionCountTextOn: { color: colors.onNavy },

  count: { fontSize: font.sm, color: colors.textMuted, fontWeight: '600' },
  noticeBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.warningBg,
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.lg,
  },
  noticeText: { flex: 1, fontSize: font.sm, color: colors.warning, lineHeight: 18 },
  claimNotice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: '#E8EEF8',
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  claimNoticeText: { flex: 1, fontSize: font.sm, color: colors.navy, lineHeight: 18, fontWeight: '600' },

  tabs: { gap: spacing.sm, paddingBottom: spacing.lg, paddingRight: spacing.lg },
  tab: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: 8,
    minHeight: 40,
  },
  tabOn: { backgroundColor: colors.navy, borderColor: colors.navy },
  tabText: { fontSize: font.sm, fontWeight: '700', color: colors.textMuted },
  tabTextOn: { color: colors.onNavy },
  tabCount: {
    backgroundColor: colors.border,
    borderRadius: radius.pill,
    minWidth: 20,
    paddingHorizontal: 5,
    alignItems: 'center',
  },
  tabCountOn: { backgroundColor: colors.navyLight },
  tabCountText: { fontSize: font.xs, fontWeight: '800', color: colors.textMuted },
  tabCountTextOn: { color: colors.onNavy },

  card: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    padding: spacing.lg,
    marginBottom: spacing.md,
    ...shadow.card,
  },
  cardHead: { flexDirection: 'row', gap: spacing.md, alignItems: 'flex-start' },
  cardHeadMobile: { flexDirection: 'column' },
  customer: { fontSize: font.md, fontWeight: '700', color: colors.text },
  school: { fontWeight: '500', color: colors.textMuted },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 5, marginTop: spacing.sm },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
    borderRadius: radius.sm,
  },
  chipText: { fontSize: font.xs, fontWeight: '700', textTransform: 'capitalize' },
  reference: { fontSize: font.xs, color: colors.textFaint, fontWeight: '600' },
  items: { fontSize: font.sm, color: colors.textMuted, marginTop: spacing.sm },

  total: { alignItems: 'flex-end', minWidth: 104 },
  totalMobile: { alignItems: 'flex-start', marginTop: spacing.md },
  totalLabel: { fontSize: font.xs, color: colors.textFaint },
  totalValue: { fontSize: font.lg, fontWeight: '800', color: colors.navy },

  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginTop: spacing.md,
    paddingTop: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  btn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    minHeight: 44,
  },
  btnGhost: { borderWidth: 1, borderColor: colors.border },
  btnGhostText: { fontSize: font.sm, fontWeight: '700', color: colors.navy },
  btnPrimary: { backgroundColor: colors.navy },
  btnPrimaryText: { fontSize: font.sm, fontWeight: '700', color: colors.onNavy },
  locked: { fontSize: font.sm, color: colors.textFaint, fontStyle: 'italic' },

  loading: { paddingVertical: spacing.xxl, alignItems: 'center' },
  empty: {
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.xxl,
    paddingHorizontal: spacing.lg,
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
    maxWidth: 380,
    lineHeight: 21,
  },
  emptyBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.navy,
    borderRadius: radius.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: 11,
    minHeight: 44,
  },
  emptyBtnText: { color: colors.onNavy, fontWeight: '700', fontSize: font.md },

  editorLayer: { marginTop: spacing.lg },

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
