import { useState } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, router } from 'expo-router';
import { BuyerPage, Panel, Skeleton, ErrorPanel } from '../../components/buyer/BuyerPage';
import { useQuoteDetail } from '../../hooks/useBuyerDetail';
import { QuoteResponseGallery } from '../../components/booklists/QuoteResponseGallery';
import { DeclineQuoteSheet } from '../../components/booklists/DeclineQuoteSheet';
import { parseResponseFiles } from '../../lib/quoteFiles';
import { declineQuote } from '../../lib/quoteActions';
import { colors, spacing, radius, font, formatNaira } from '../../theme';

/**
 * One shop's quote, line by line.
 *
 * The comparison this screen supports is the honest one: what the shop
 * will supply, what it costs, and what it cannot get. An item marked
 * unavailable is shown rather than dropped — a cheaper quote that is
 * missing two titles is not actually cheaper.
 */
export default function QuoteDetailScreen() {
  const params = useLocalSearchParams<{ id?: string | string[] }>();
  const id = Array.isArray(params.id) ? params.id[0] : params.id ?? null;
  const { quote, lines, loading, error, refresh } = useQuoteDetail(id);

  const [declining, setDeclining] = useState(false);
  const [declineBusy, setDeclineBusy] = useState(false);
  const [declineError, setDeclineError] = useState<string | null>(null);

  async function confirmDecline(reason: string | null) {
    if (!id) return;
    setDeclineBusy(true);
    setDeclineError(null);
    try {
      await declineQuote(id, reason);
      setDeclining(false);
      // Back to the dashboard with the news, rather than leaving them on
      // a quote they just killed. `replace`, not `push`: the quote page
      // is no longer a place Back should return to.
      router.replace({ pathname: '/', params: { notice: 'Quote declined. The shop has been told.' } });
    } catch (e) {
      setDeclineError((e as Error).message);
    } finally {
      setDeclineBusy(false);
    }
  }

  if (loading) {
    return (
      <BuyerPage eyebrow="Quote" title="Loading…">
        <Panel>
          <View style={{ gap: spacing.sm }}>
            <Skeleton height={18} width="50%" />
            <Skeleton height={80} />
          </View>
        </Panel>
      </BuyerPage>
    );
  }

  if (error || !quote) {
    return (
      <BuyerPage eyebrow="Quote" title="Quote unavailable">
        <ErrorPanel message={error ?? 'That quote is not available.'} onRetry={refresh} />
      </BuyerPage>
    );
  }

  const shop = quote.vendors;
  const unavailable = lines.filter((l) => !l.is_available);
  // A photo-only booklist quoted with one total and the shop's own priced
  // sheet. The sheet is the breakdown; the total is what checkout charges.
  const lumpSum = quote.pricing_mode === 'lump_sum';
  const responseFiles = parseResponseFiles(quote.response_files);

  return (
    <BuyerPage
      eyebrow="Quote"
      title={shop?.store_name ?? 'Quote'}
      subtitle={[
        quote.book_requests?.school_name,
        `Quoted ${new Date(quote.created_at).toLocaleDateString('en-NG')}`,
      ]
        .filter(Boolean)
        .join(' · ')}
      right={<Text style={styles.total}>{formatNaira(quote.total_price)}</Text>}
    >
      {unavailable.length > 0 && (
        <View style={styles.warn}>
          <Ionicons name="alert-circle-outline" size={16} color={colors.warning} />
          <Text style={styles.warnText}>
            {unavailable.length} item{unavailable.length > 1 ? 's are' : ' is'} not available from
            this shop. Compare on what you actually get, not only on the total.
          </Text>
        </View>
      )}

      {lumpSum ? (
        <Panel title="The shop's priced booklist">
          <View style={{ gap: spacing.md }}>
            <Text style={styles.muted}>
              You sent a photo, so this shop priced your list on its own sheet and quoted one
              total. Look through every page to check what is included before you pay.
            </Text>
            {responseFiles.length ? (
              <QuoteResponseGallery files={responseFiles} />
            ) : (
              <Text style={styles.muted}>The shop did not attach a sheet to this quote.</Text>
            )}
            {!!quote.vendor_note && (
              <View style={styles.note}>
                <Text style={styles.noteLabel}>Note from {shop?.store_name ?? 'the shop'}</Text>
                <Text style={styles.noteText}>{quote.vendor_note}</Text>
              </View>
            )}
          </View>
        </Panel>
      ) : (
        <Panel title={`What this shop is offering (${lines.length})`}>
          {lines.length === 0 ? (
            <Text style={styles.muted}>
              This quote carries a total but no line breakdown, so there is nothing to itemise.
            </Text>
          ) : (
            <View>
              {lines.map((line, i) => (
                <View key={line.id} style={[styles.row, i > 0 && styles.rowDivider]}>
                  <View style={styles.rowText}>
                    <Text
                      style={[styles.itemTitle, !line.is_available && styles.itemTitleOff]}
                      numberOfLines={2}
                    >
                      {line.title}
                    </Text>
                    <Text style={styles.itemMeta}>
                      {line.quantity > 1 ? `×${line.quantity}` : 'Qty 1'}
                      {line.is_available ? '' : ' · not available'}
                    </Text>
                  </View>
                  <Text style={[styles.itemPrice, !line.is_available && styles.itemTitleOff]}>
                    {!line.is_available || line.unit_price == null
                      ? '—'
                      : formatNaira(Number(line.unit_price) * line.quantity)}
                  </Text>
                </View>
              ))}
            </View>
          )}
        </Panel>
      )}

      <View style={styles.actions}>
        {!!quote.request_id && (
          <Pressable
            onPress={() => router.push(`/booklists/${quote.request_id}`)}
            style={({ pressed }) => [styles.secondary, pressed && styles.secondaryPressed]}
            accessibilityRole="button"
          >
            <Text style={styles.secondaryText}>All Quotes On This Booklist</Text>
          </Pressable>
        )}
        {!!shop?.id && (
          <Pressable
            onPress={() => router.push(`/shops/${shop.id}`)}
            style={({ pressed }) => [styles.secondary, pressed && styles.secondaryPressed]}
            accessibilityRole="button"
          >
            <Text style={styles.secondaryText}>View Shop Details</Text>
          </Pressable>
        )}
        {/* Every non-draft quote is a thread (bookshops_messaging.sql),
            so a question about an edition or a delivery day goes to the
            shop against this exact quote. */}
        <Pressable
          onPress={() => router.push({ pathname: '/messages', params: { quote: quote.id } })}
          style={({ pressed }) => [styles.secondary, pressed && styles.secondaryPressed]}
          accessibilityRole="button"
        >
          <Text style={styles.secondaryText}>Message Shop</Text>
        </Pressable>
        {/* The quote id is the whole point of this button: checkout
            prices the charge from the quote, so without it there is
            nothing to pay for. A quote that is no longer 'sent' has
            been accepted, withdrawn or has expired — offering to pay
            for it would fail at the server, so say so here instead. */}
        <Pressable
          onPress={() => router.push({ pathname: '/checkout', params: { quote: quote.id } })}
          disabled={quote.status !== 'sent'}
          style={({ pressed }) => [
            styles.cta,
            pressed && styles.ctaPressed,
            quote.status !== 'sent' && styles.ctaDisabled,
          ]}
          accessibilityRole="button"
          accessibilityLabel={`Accept this quote and pay ${formatNaira(quote.total_price)}`}
        >
          <Ionicons name="lock-closed" size={15} color={colors.onNavy} />
          <Text style={styles.ctaText}>
            {quote.status === 'accepted'
              ? 'Already accepted'
              : quote.status === 'sent'
                ? `Accept and pay ${formatNaira(quote.total_price)}`
                : quote.status === 'rejected'
                  ? 'You declined this quote'
                  : `Quote ${quote.status}`}
          </Text>
        </Pressable>

        {/* Only while the offer is live. Once a quote is accepted,
            withdrawn or already declined there is nothing to decline,
            and buyer_decline_quote would refuse it anyway — a button
            whose only outcome is an error message is worse than none.

            Deliberately quiet: a bordered neutral button, not a red
            one. Declining is a normal thing to do with a quote you do
            not want, and dressing it as a destructive action next to
            the payment button makes the page feel like a trap. The red
            appears in the confirmation, where it is about to matter. */}
        {quote.status === 'sent' && (
          <Pressable
            onPress={() => {
              setDeclineError(null);
              setDeclining(true);
            }}
            style={({ pressed }) => [styles.decline, pressed && styles.declinePressed]}
            accessibilityRole="button"
            accessibilityLabel="Decline this quote"
            accessibilityHint="Tells the shop you are not taking their offer. Your booklist stays open."
          >
            <Text style={styles.declineText}>Decline Quote</Text>
          </Pressable>
        )}
      </View>

      {/* The buyer's own words, read back. A decline they explained is
          worth showing them afterwards — it is the record of what the
          shop was told. */}
      {quote.status === 'rejected' && !!quote.decline_reason && (
        <Panel title="Why You Declined">
          <Text style={styles.muted}>{quote.decline_reason}</Text>
        </Panel>
      )}

      <DeclineQuoteSheet
        visible={declining}
        shopName={shop?.store_name ?? 'The shop'}
        total={quote.total_price}
        busy={declineBusy}
        error={declineError}
        onCancel={() => setDeclining(false)}
        onConfirm={confirmDecline}
      />
    </BuyerPage>
  );
}

const styles = StyleSheet.create({
  total: { fontSize: font.xxl, fontWeight: '800', color: colors.text },
  muted: { fontSize: font.md, color: colors.textMuted, lineHeight: 20 },
  note: { backgroundColor: colors.surfaceMuted, borderRadius: radius.md, padding: spacing.md, gap: 4 },
  noteLabel: { fontSize: font.sm, fontWeight: '700', color: colors.textMuted },
  noteText: { fontSize: font.md, color: colors.text, lineHeight: 20 },

  warn: {
    flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm,
    backgroundColor: colors.warningBg, borderRadius: radius.md, padding: spacing.md,
  },
  warnText: { flex: 1, fontSize: font.sm, color: colors.text, lineHeight: 18 },

  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.md },
  rowDivider: { borderTopWidth: 1, borderTopColor: colors.border },
  rowText: { flex: 1, minWidth: 0 },
  itemTitle: { fontSize: font.md, fontWeight: '600', color: colors.text },
  itemTitleOff: { color: colors.textFaint, textDecorationLine: 'line-through' },
  itemMeta: { fontSize: font.sm, color: colors.textMuted, marginTop: 1 },
  itemPrice: { fontSize: font.md, fontWeight: '700', color: colors.text },

  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  // Neutral, not red, and visually lighter than "Compare all quotes" so
  // it never competes with the payment CTA beside it.
  decline: {
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.lg,
    paddingVertical: 12,
    minHeight: 44,
    justifyContent: 'center',
  },
  declinePressed: { backgroundColor: colors.surfaceMuted, borderColor: colors.borderStrong },
  declineText: { fontSize: font.md, fontWeight: '600', color: colors.textMuted },
  secondary: {
    borderRadius: radius.md, borderWidth: 1, borderColor: colors.borderStrong,
    backgroundColor: colors.surface, paddingHorizontal: spacing.lg, paddingVertical: 12,
  },
  secondaryPressed: { backgroundColor: colors.surfaceMuted },
  secondaryText: { fontSize: font.md, fontWeight: '700', color: colors.navy },
  cta: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm,
    backgroundColor: colors.orange, borderRadius: radius.md,
    paddingHorizontal: spacing.xl, paddingVertical: 12, flexGrow: 1,
  },
  ctaPressed: { backgroundColor: colors.orangeDark },
  ctaDisabled: { backgroundColor: colors.borderStrong },
  ctaText: { fontSize: font.md, fontWeight: '800', color: colors.onNavy },
});
