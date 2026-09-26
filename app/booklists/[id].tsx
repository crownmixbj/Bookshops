import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, router } from 'expo-router';
import { BuyerPage, Panel, Skeleton, ErrorPanel } from '../../components/buyer/BuyerPage';
import { useBooklistDetail } from '../../hooks/useBuyerDetail';
import { sumLineTotals } from '../../lib/booklistPricing';
import { colors, spacing, radius, font, formatNaira } from '../../theme';

/**
 * How a quote that is no longer live reads on the comparison list.
 *
 * 'rejected' is shown as "You declined" rather than "Declined": on the
 * buyer's own screen the passive voice hides who did it, and the buyer
 * is the only one who can set this status.
 */
const QUOTE_STATE: Record<string, string> = {
  accepted: 'Accepted',
  rejected: 'You declined',
  withdrawn: 'Shop withdrew it',
  expired: 'Expired',
};

/** A small inline label. Sits beside a shop name, so it stays quiet. */
function Tag({ label, tone = 'neutral' }: { label: string; tone?: 'neutral' | 'info' }) {
  const t =
    tone === 'info'
      ? { bg: '#E4EAF5', fg: colors.navy }
      : { bg: colors.surfaceMuted, fg: colors.textMuted };
  return (
    <View style={[styles.tag, { backgroundColor: t.bg }]}>
      <Text style={[styles.tagText, { color: t.fg }]}>{label}</Text>
    </View>
  );
}

const STATUS_LABEL: Record<string, string> = {
  draft: 'Draft — not sent to vendors yet',
  pending_quote: 'Waiting for quotes',
  quoted: 'Quotes received',
  ordered: 'Ordered',
  cancelled: 'Cancelled',
};

/**
 * One booklist request and everything hanging off it: the lines that
 * were asked for, and the quotes shops have sent back.
 *
 * Opened by tapping a row in "Active Booklist Requests". The row still
 * expands in place on the hub — this is the full breakdown, with the
 * quotes the hub has no room for.
 */
export default function BooklistDetailScreen() {
  const params = useLocalSearchParams<{ id?: string | string[] }>();
  const id = Array.isArray(params.id) ? params.id[0] : params.id ?? null;
  const { request, items, quotes, loading, error, refresh } = useBooklistDetail(id);

  if (loading) {
    return (
      <BuyerPage eyebrow="Booklist" title="Loading…">
        <Panel>
          <View style={{ gap: spacing.sm }}>
            <Skeleton height={18} width="60%" />
            <Skeleton height={14} width="40%" />
            <Skeleton height={80} />
          </View>
        </Panel>
      </BuyerPage>
    );
  }

  if (error || !request) {
    return (
      <BuyerPage eyebrow="Booklist" title="Booklist unavailable">
        <ErrorPanel message={error ?? 'That booklist is not available.'} onRetry={refresh} />
      </BuyerPage>
    );
  }

  // Only priced, in-stock lines contribute; an unpriced line is not zero
  // naira, it is unknown, and adding it as zero would understate the
  // total. Prices come from the pricing quote's quote_items — the
  // request rows themselves carry none.
  const priced = items.filter((i) => i.lineTotal != null);
  const awaiting = items.filter((i) => i.isAvailable && i.lineTotal == null).length;
  const outOfStock = items.filter((i) => !i.isAvailable).length;
  const estimate = sumLineTotals(items);

  // Offers still open, and the cheapest of them. Matched by id rather
  // than by taking the first row: the list is sorted live-first, so
  // index 0 is only the cheapest overall when something live exists.
  const live = quotes.filter((q) => q.isLive);
  const liveCount = live.length;
  const cheapestLive = live.length
    ? live.reduce((a, b) => (Number(b.total_price) < Number(a.total_price) ? b : a))
    : null;
  const closedCount = quotes.length - liveCount;

  return (
    <BuyerPage
      eyebrow="Booklist"
      title={request.school_name || 'Untitled booklist'}
      subtitle={[
        request.class_level,
        STATUS_LABEL[request.status] ?? request.status,
        `Sent ${new Date(request.created_at).toLocaleDateString('en-NG')}`,
      ]
        .filter(Boolean)
        .join(' · ')}
    >
      <Panel
        title={`Items (${items.length})`}
        right={
          priced.length ? (
            <Text style={styles.estimate}>
              {formatNaira(estimate)}
              {awaiting > 0 ? ` · ${awaiting} unpriced` : ''}
              {outOfStock > 0 ? ` · ${outOfStock} out of stock` : ''}
            </Text>
          ) : null
        }
      >
        {items.length === 0 ? (
          <Text style={styles.muted}>
            No lines on this booklist yet. Items appear here once the photo has been read or you
            have typed them in.
          </Text>
        ) : (
          <View>
            {items.map((item, i) => (
              <View key={item.id} style={[styles.row, i > 0 && styles.rowDivider]}>
                <View style={styles.rowText}>
                  <Text style={styles.itemTitle} numberOfLines={2}>
                    {item.title}
                  </Text>
                  <Text style={styles.itemMeta}>
                    {item.category}
                    {item.quantity > 1 ? ` · ×${item.quantity}` : ''}
                    {item.parsed ? ' · read from photo' : ''}
                  </Text>
                </View>
                <Text
                  style={[
                    styles.itemPrice,
                    item.lineTotal == null && styles.itemPriceMuted,
                  ]}
                >
                  {!item.isAvailable
                    ? 'Out of stock'
                    : item.lineTotal == null
                    ? 'Awaiting quote'
                    : formatNaira(item.lineTotal)}
                </Text>
              </View>
            ))}
          </View>
        )}
      </Panel>

      {/*
        The comparison view.

        This is where "Compare N quotes" lands, so it has to answer the
        question the button asks — which of these should I take — rather
        than just listing totals. Each row carries the two things that
        change the answer: how many of the buyer's lines the shop can
        actually supply, and whether the breakdown is an attachment
        rather than itemised lines. Opening a row is the accept-or-
        decline screen.
      */}
      <Panel
        // Both numbers when both exist. "Quotes (2)" above five rows is
        // the kind of small dishonesty that makes a buyer stop trusting
        // the rest of the page.
        title={
          liveCount && closedCount
            ? `Quotes (${liveCount} Open · ${closedCount} Closed)`
            : `Quotes (${quotes.length})`
        }
        right={
          cheapestLive ? (
            <Text style={styles.estimate}>From {formatNaira(cheapestLive.total_price)}</Text>
          ) : null
        }
      >
        {quotes.length === 0 ? (
          <Text style={styles.muted}>
            No shop has quoted on this booklist yet. Vendors usually respond within a few hours.
          </Text>
        ) : (
          <View>
            {liveCount > 1 && (
              <Text style={[styles.muted, styles.compareHint]}>
                The cheapest total is not always the best deal. Check how many of your{' '}
                {items.length} line{items.length === 1 ? '' : 's'} each shop can actually supply
                before you pay.
              </Text>
            )}

            {quotes.map((q, i) => {
              const priced = q.availableCount + q.unavailableCount;
              const lowest = cheapestLive?.id === q.id && liveCount > 1;

              return (
                <Pressable
                  key={q.id}
                  onPress={() => router.push(`/quotes/${q.id}`)}
                  style={({ pressed }) => [
                    styles.row,
                    i > 0 && styles.rowDivider,
                    pressed && styles.rowPressed,
                  ]}
                  accessibilityRole="button"
                  accessibilityLabel={
                    `${q.isLive ? 'Review the quote' : 'Open the closed quote'} from ` +
                    `${q.vendors?.store_name ?? 'a shop'}, ${formatNaira(q.total_price)}`
                  }
                >
                  <View style={[styles.thumb, !q.isLive && styles.thumbOff]}>
                    <Text style={[styles.thumbText, !q.isLive && styles.thumbTextOff]}>
                      {(q.vendors?.store_name ?? '?').slice(0, 1).toUpperCase()}
                    </Text>
                  </View>

                  <View style={styles.rowText}>
                    <View style={styles.nameRow}>
                      <Text
                        style={[styles.itemTitle, !q.isLive && styles.dim]}
                        numberOfLines={1}
                      >
                        {q.vendors?.store_name ?? 'Shop'}
                      </Text>
                      {lowest && <Tag label="Lowest total" tone="info" />}
                      {q.status !== 'sent' && <Tag label={QUOTE_STATE[q.status] ?? q.status} />}
                    </View>

                    <Text style={styles.itemMeta} numberOfLines={2}>
                      {[
                        q.vendors?.city ?? null,
                        // A lump-sum quote has no lines to count, so
                        // saying "0 of 12" would be a lie about the
                        // shop rather than a fact about the quote.
                        q.pricing_mode === 'lump_sum'
                          ? 'Priced on the shop\'s own sheet'
                          : priced > 0
                            ? `Priced ${q.availableCount} of ${items.length} line${
                                items.length === 1 ? '' : 's'
                              }`
                            : null,
                        q.unavailableCount > 0
                          ? `${q.unavailableCount} not available`
                          : null,
                        q.fileCount > 0
                          ? `${q.fileCount} attachment${q.fileCount === 1 ? '' : 's'}`
                          : null,
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                    </Text>
                  </View>

                  <Text style={[styles.itemPrice, !q.isLive && styles.dim]}>
                    {formatNaira(q.total_price)}
                  </Text>
                  <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
                </Pressable>
              );
            })}

            <Text style={styles.footNote}>
              {liveCount > 0
                ? 'Open a quote to see every line, the shop\'s attachments, and to accept and pay or decline it.'
                : 'These quotes are closed. Your booklist stays open, so other shops can still quote it.'}
            </Text>
          </View>
        )}
      </Panel>
    </BuyerPage>
  );
}

const styles = StyleSheet.create({
  estimate: { fontSize: font.md, fontWeight: '700', color: colors.text },
  muted: { fontSize: font.md, color: colors.textMuted, lineHeight: 20 },

  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.md },
  rowDivider: { borderTopWidth: 1, borderTopColor: colors.border },
  rowPressed: { backgroundColor: colors.surfaceMuted },
  rowText: { flex: 1, minWidth: 0 },
  itemTitle: { fontSize: font.md, fontWeight: '600', color: colors.text },
  itemMeta: { fontSize: font.sm, color: colors.textMuted, marginTop: 1 },
  itemPrice: { fontSize: font.md, fontWeight: '700', color: colors.text },
  itemPriceMuted: { color: colors.textFaint, fontWeight: '500', fontSize: font.sm },

  thumb: {
    width: 34, height: 34, borderRadius: radius.sm, backgroundColor: colors.surfaceMuted,
    alignItems: 'center', justifyContent: 'center',
  },
  thumbText: { fontSize: font.md, fontWeight: '800', color: colors.navy },
  thumbOff: { backgroundColor: colors.surfaceMuted },
  thumbTextOff: { color: colors.textFaint },

  nameRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, flexWrap: 'wrap' },
  dim: { color: colors.textFaint },

  tag: { borderRadius: radius.sm, paddingHorizontal: 6, paddingVertical: 2 },
  tagText: { fontSize: font.xs, fontWeight: '700', letterSpacing: 0.3 },

  compareHint: { marginBottom: spacing.sm },
  footNote: {
    fontSize: font.sm,
    color: colors.textFaint,
    lineHeight: 18,
    marginTop: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingTop: spacing.md,
  },
});
