import { useState } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, router } from 'expo-router';
import { BuyerPage, Panel, Skeleton, ErrorPanel } from '../../components/buyer/BuyerPage';
import { useShopDetail } from '../../hooks/useBuyerDetail';
import {
  useShopQuotes,
  type ShopQuote,
  type ShopQuoteStatus,
  type SendableBooklist,
} from '../../hooks/useShopQuotes';
import { SendBooklistSheet } from '../../components/shops/SendBooklistSheet';
import { SignInPrompt } from '../../components/auth/SignInPrompt';
import { useAuthGate } from '../../hooks/useAuthGate';
import { describeBooklistError } from '../../lib/booklistUpload';
import { colors, spacing, radius, font, formatNaira } from '../../theme';

/**
 * A shop, opened from "View Shop Details" on the Booklist Hub.
 *
 * Addressed by the vendor's uuid rather than a slug: `vendors` has no
 * slug column, and inventing one in the URL would mean a lookup that
 * cannot resolve. If a slug column is added later this route keeps
 * working — expo-router hands over whatever is in [id].
 */
export default function ShopDetailScreen() {
  const params = useLocalSearchParams<{ id?: string | string[] }>();
  const id = Array.isArray(params.id) ? params.id[0] : params.id ?? null;
  const { shop, reviews, saved, loading, error, refresh, toggleSaved } = useShopDetail(id);
  const {
    quotes,
    sendable,
    loading: quotesLoading,
    error: quotesError,
    userId,
    refresh: refreshQuotes,
    sendBooklist,
  } = useShopQuotes(id);

  const gate = useAuthGate();
  const [picking, setPicking] = useState(false);
  const [sending, setSending] = useState<string | null>(null);
  const [sendError, setSendError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);

  async function handleSend(booklist: SendableBooklist) {
    setSending(booklist.id);
    setSendError(null);
    try {
      await sendBooklist(booklist);
      setPicking(false);
      setFlash(`${booklist.title} was sent to ${shop?.store_name ?? 'this shop'}.`);
    } catch (e) {
      setSendError(describeBooklistError(e));
    } finally {
      // Unconditional: a refusal must not leave the row spinning.
      setSending(null);
    }
  }

  if (loading) {
    return (
      <BuyerPage eyebrow="Shop" title="Loading…">
        <Panel>
          <View style={{ gap: spacing.sm }}>
            <Skeleton height={22} width="55%" />
            <Skeleton height={14} width="35%" />
            <Skeleton height={64} />
          </View>
        </Panel>
      </BuyerPage>
    );
  }

  if (error || !shop) {
    return (
      <BuyerPage eyebrow="Shop" title="Shop unavailable">
        <ErrorPanel message={error ?? 'That shop is not available.'} onRetry={refresh} />
      </BuyerPage>
    );
  }

  return (
    <BuyerPage
      eyebrow="Shop"
      title={shop.store_name}
      subtitle={[shop.city, shop.address].filter(Boolean).join(' · ') || undefined}
      right={
        <Pressable
          onPress={toggleSaved}
          style={({ pressed }) => [styles.save, saved && styles.saveOn, pressed && styles.pressed]}
          accessibilityRole="button"
          accessibilityLabel={saved ? `Remove ${shop.store_name} from saved shops` : `Save ${shop.store_name}`}
        >
          <Ionicons
            name={saved ? 'bookmark' : 'bookmark-outline'}
            size={15}
            color={saved ? colors.onNavy : colors.navy}
          />
          <Text style={[styles.saveText, saved && styles.saveTextOn]}>{saved ? 'Saved' : 'Save shop'}</Text>
        </Pressable>
      }
    >
      {shop.busy_mode && (
        <View style={styles.busy}>
          <Ionicons name="time-outline" size={16} color={colors.warning} />
          <Text style={styles.busyText}>
            {shop.busy_note?.trim() || 'This shop is busy right now and may take longer to quote.'}
          </Text>
        </View>
      )}

      <Panel title="About This Shop">
        <View style={styles.stats}>
          <Stat
            label="Rating"
            value={shop.rating == null ? '—' : Number(shop.rating).toFixed(1)}
            hint={shop.review_count ? `${shop.review_count} review${shop.review_count > 1 ? 's' : ''}` : 'No reviews yet'}
          />
          <Stat label="Orders completed" value={String(shop.completed_orders)} hint="All time" />
          <Stat
            label="Verified"
            value={shop.verified_at ? 'Yes' : 'Not yet'}
            hint={shop.verified_at ? new Date(shop.verified_at).toLocaleDateString('en-NG') : 'Pending review'}
          />
        </View>

        {!!shop.phone && (
          <View style={styles.contact}>
            <Ionicons name="call-outline" size={14} color={colors.textMuted} />
            <Text style={styles.contactText}>{shop.phone}</Text>
          </View>
        )}
      </Panel>

      {!!flash && (
        <View style={styles.flash}>
          <Ionicons name="checkmark-circle" size={16} color={colors.success} />
          <Text style={styles.flashText}>{flash}</Text>
          <Pressable onPress={() => setFlash(null)} hitSlop={6} accessibilityLabel="Dismiss">
            <Ionicons name="close" size={15} color={colors.success} />
          </Pressable>
        </View>
      )}

      {/* Buyer-only. A signed-out visitor browsing a shop has no quotes
          and nothing to send, so the section is absent rather than an
          empty state inviting them to do something they cannot. */}
      {!!userId && (
        <Panel
          title="Quotes from This Shop"
          right={
            quotes.length > 0 ? (
              <Text style={styles.count}>
                {quotes.length} booklist{quotes.length === 1 ? '' : 's'}
              </Text>
            ) : null
          }
        >
          {quotesLoading ? (
            <View style={{ gap: spacing.sm }}>
              <Skeleton height={58} />
              <Skeleton height={58} />
            </View>
          ) : quotesError ? (
            <ErrorPanel message={quotesError.message} onRetry={refreshQuotes} />
          ) : quotes.length === 0 ? (
            <View style={styles.emptyQuotes}>
              <View style={styles.emptyIcon}>
                <Ionicons name="document-text-outline" size={22} color={colors.textMuted} />
              </View>
              <Text style={styles.emptyText}>
                You haven't requested a quote from {shop.store_name} yet. Send your school booklist
                to receive itemised pricing.
              </Text>
            </View>
          ) : (
            <View style={{ gap: spacing.sm }}>
              {quotes.map((q) => (
                <QuoteCard key={q.requestId} quote={q} />
              ))}
            </View>
          )}
        </Panel>
      )}

      <Panel title="Reviews">
        {reviews.length === 0 ? (
          <Text style={styles.muted}>
            No reviews yet. A buyer can review a shop once an order has been delivered.
          </Text>
        ) : (
          <View style={{ gap: spacing.md }}>
            {reviews.map((r) => (
              <View key={r.id} style={styles.review}>
                <View style={styles.reviewHead}>
                  <View style={styles.starRow}>
                    {[1, 2, 3, 4, 5].map((n) => (
                      <Ionicons
                        key={n}
                        name={n <= r.rating ? 'star' : 'star-outline'}
                        size={12}
                        color={colors.star}
                      />
                    ))}
                  </View>
                  <Text style={styles.reviewDate}>
                    {new Date(r.created_at).toLocaleDateString('en-NG')}
                  </Text>
                </View>
                {!!r.comment && <Text style={styles.reviewBody}>{r.comment}</Text>}
              </View>
            ))}
          </View>
        )}
      </Panel>

      <Pressable
        onPress={() => {
          setSendError(null);
          // A guest has no saved lists to pick from, so the picker would
          // be empty — send them to the composer instead, pre-addressed
          // to this shop. The sign-in prompt comes when they dispatch.
          if (!gate.signedIn || sendable.length === 0) {
            router.push({
              pathname: '/booklists/new-manual',
              params: { vendor: shop.id, shop: shop.store_name },
            });
            return;
          }
          setPicking(true);
        }}
        style={({ pressed }) => [styles.cta, pressed && styles.ctaPressed]}
        accessibilityRole="button"
        accessibilityLabel={
          quotes.length > 0
            ? `Send ${shop.store_name} another booklist`
            : `Send ${shop.store_name} a booklist`
        }
      >
        <Ionicons name="add" size={16} color={colors.onNavy} />
        <Text style={styles.ctaText}>
          {quotes.length > 0 ? 'Send another booklist' : 'Send this shop a booklist'}
        </Text>
      </Pressable>

      <SignInPrompt
        visible={gate.promptVisible}
        reason={gate.promptReason}
        onClose={gate.closePrompt}
        // Signs in inside the sheet, then runs whatever was
        // blocked. Nothing navigates, so this screen keeps its
        // state — including any photo held in memory.
        onAuthenticated={gate.onAuthenticated}
      />

      <SendBooklistSheet
        visible={picking}
        shopName={shop.store_name}
        booklists={sendable}
        sendingId={sending}
        error={sendError}
        onSend={handleSend}
        onCreateNew={() => {
          setPicking(false);
          router.push({
            pathname: '/booklists/new-manual',
            params: { vendor: shop.id, shop: shop.store_name },
          });
        }}
        onClose={() => {
          if (sending) return;
          setPicking(false);
          setSendError(null);
        }}
      />

    </BuyerPage>
  );
}

/**
 * The five states a buyer can actually be in with one shop.
 *
 * There is no "under negotiation": quotes.status is
 * draft | sent | accepted | rejected | withdrawn | expired, and nothing
 * in the schema records a counter-offer or a message on a quote. A badge
 * for a state the database cannot hold would never appear, so it is not
 * here — see the note on the revision button below.
 */
const QUOTE_STATUS: Record<
  ShopQuoteStatus,
  { label: string; bg: string; fg: string; icon: keyof typeof Ionicons.glyphMap }
> = {
  awaiting: { label: 'Pending vendor response', bg: colors.surfaceMuted, fg: colors.textMuted, icon: 'time-outline' },
  received: { label: 'Quote received', bg: '#E4EAF5', fg: colors.navy, icon: 'pricetag-outline' },
  accepted: { label: 'Accepted', bg: '#E4F2E8', fg: colors.success, icon: 'checkmark-circle-outline' },
  declined: { label: 'Declined', bg: '#FDECEA', fg: colors.danger, icon: 'close-circle-outline' },
  expired: { label: 'Expired', bg: colors.warningBg, fg: colors.warning, icon: 'hourglass-outline' },
};

function QuoteCard({ quote }: { quote: ShopQuote }) {
  const status = QUOTE_STATUS[quote.status];
  const priced = quote.status === 'received' || quote.status === 'accepted';

  return (
    <View style={styles.quote}>
      <View style={styles.quoteHead}>
        <View style={styles.quoteText}>
          <Text style={styles.quoteTitle} numberOfLines={1}>
            {quote.title}
          </Text>
          <Text style={styles.quoteMeta} numberOfLines={1}>
            {[
              quote.classLevel,
              `Sent ${new Date(quote.submittedAt).toLocaleDateString('en-NG')}`,
            ]
              .filter(Boolean)
              .join(' · ')}
          </Text>
        </View>
        <View style={[styles.badge, { backgroundColor: status.bg }]}>
          <Ionicons name={status.icon} size={11} color={status.fg} />
          <Text style={[styles.badgeText, { color: status.fg }]}>{status.label}</Text>
        </View>
      </View>

      {priced && quote.total != null && (
        <Text style={styles.quoteTotal}>
          {formatNaira(quote.total)}
          {/* Only when the two differ. "8 of 8 items" on every card is
              noise; "8 of 10" is the number that matters, because two
              lines are not being supplied. */}
          {quote.requestedItems > 0 && quote.quotedItems !== quote.requestedItems && (
            <Text style={styles.quotePartial}>
              {'  '}for {quote.quotedItems} of {quote.requestedItems} items
            </Text>
          )}
        </Text>
      )}

      <View style={styles.quoteActions}>
        {quote.status === 'received' && quote.quoteId && (
          <Pressable
            onPress={() => router.push(`/quotes/${quote.quoteId}`)}
            style={({ pressed }) => [styles.action, styles.actionPrimary, pressed && styles.pressed]}
            accessibilityRole="button"
            accessibilityLabel={`View and check out the quote for ${quote.title}`}
          >
            <Text style={styles.actionPrimaryText}>View &amp; Checkout Quote</Text>
            <Ionicons name="arrow-forward" size={14} color={colors.onNavy} />
          </Pressable>
        )}

        {/*
          "Request a revision" routes to the booklist rather than opening
          a negotiation screen, because there is no negotiation to open:
          no counter-offer table, no thread on a quote, no revision
          status. What a buyer CAN do is change the list — quantities,
          substitutions, dropping a line — and the shop re-quotes against
          it. That is the real mechanism, so the button goes there and
          says so, instead of promising a haggle the backend cannot hold.
        */}
        <Pressable
          onPress={() => router.push(`/booklists/${quote.requestId}`)}
          style={({ pressed }) => [styles.action, pressed && styles.pressed]}
          accessibilityRole="button"
          accessibilityLabel={`Change the booklist behind ${quote.title}`}
        >
          <Ionicons name="create-outline" size={14} color={colors.navy} />
          <Text style={styles.actionText}>
            {quote.status === 'received' ? 'Change list & re-quote' : 'View booklist'}
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statLabel}>{label}</Text>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statHint}>{hint}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  save: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.xs,
    borderRadius: radius.pill, borderWidth: 1, borderColor: colors.navy,
    paddingHorizontal: spacing.md, paddingVertical: 7,
  },
  saveOn: { backgroundColor: colors.navy },
  pressed: { opacity: 0.75 },
  saveText: { fontSize: font.sm, fontWeight: '700', color: colors.navy },
  saveTextOn: { color: colors.onNavy },

  busy: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    backgroundColor: colors.warningBg, borderRadius: radius.md, padding: spacing.md,
  },
  busyText: { flex: 1, fontSize: font.sm, color: colors.text, lineHeight: 18 },

  stats: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.lg },
  stat: { flexBasis: 150, flexGrow: 1 },
  statLabel: { fontSize: font.xs, fontWeight: '700', color: colors.textFaint, letterSpacing: 0.4 },
  statValue: { fontSize: font.xl, fontWeight: '800', color: colors.text, marginTop: 2 },
  statHint: { fontSize: font.sm, color: colors.textMuted },

  contact: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, marginTop: spacing.lg },
  contactText: { fontSize: font.md, color: colors.text },

  muted: { fontSize: font.md, color: colors.textMuted, lineHeight: 20 },
  review: { borderTopWidth: 1, borderTopColor: colors.border, paddingTop: spacing.md },
  reviewHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  starRow: { flexDirection: 'row', gap: 1 },
  reviewDate: { fontSize: font.xs, color: colors.textFaint },
  reviewBody: { fontSize: font.md, color: colors.text, lineHeight: 20, marginTop: spacing.xs },

  flash: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: '#E4F2E8',
    borderRadius: radius.md,
    padding: spacing.md,
  },
  flashText: { flex: 1, fontSize: font.sm, color: colors.success, lineHeight: 18 },

  count: { fontSize: font.sm, fontWeight: '700', color: colors.textMuted },

  emptyQuotes: { alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.md },
  emptyIcon: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surfaceMuted,
    borderWidth: 1,
    borderColor: colors.border,
  },
  emptyText: {
    fontSize: font.sm,
    color: colors.textMuted,
    textAlign: 'center',
    lineHeight: 19,
    maxWidth: 360,
  },

  quote: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: spacing.md,
    gap: spacing.sm,
  },
  quoteHead: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm },
  quoteText: { flex: 1, minWidth: 0 },
  quoteTitle: { fontSize: font.md, fontWeight: '700', color: colors.text },
  quoteMeta: { fontSize: font.xs, color: colors.textMuted, marginTop: 1 },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderRadius: radius.sm,
    paddingHorizontal: 7,
    paddingVertical: 3,
  },
  badgeText: { fontSize: font.xs, fontWeight: '700' },
  quoteTotal: { fontSize: font.lg, fontWeight: '800', color: colors.text },
  quotePartial: { fontSize: font.xs, fontWeight: '600', color: colors.textMuted },

  quoteActions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  action: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingVertical: 9,
    paddingHorizontal: spacing.md,
    minHeight: 40,
    flexGrow: 1,
  },
  actionText: { fontSize: font.sm, fontWeight: '700', color: colors.navy },
  actionPrimary: { backgroundColor: colors.navy, borderColor: colors.navy },
  actionPrimaryText: { fontSize: font.sm, fontWeight: '800', color: colors.onNavy },

  cta: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm,
    backgroundColor: colors.orange, borderRadius: radius.md, paddingVertical: 13,
  },
  ctaPressed: { backgroundColor: colors.orangeDark },
  ctaText: { fontSize: font.md, fontWeight: '800', color: colors.onNavy },
});
