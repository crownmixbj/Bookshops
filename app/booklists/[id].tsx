import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, router } from 'expo-router';
import { BuyerPage, Panel, Skeleton, ErrorPanel } from '../../components/buyer/BuyerPage';
import { useBooklistDetail } from '../../hooks/useBuyerDetail';
import { colors, spacing, radius, font, formatNaira } from '../../theme';

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

  // Only priced lines contribute; an unpriced line is not zero naira,
  // it is unknown, and adding it as zero would understate the total.
  const priced = items.filter((i) => i.unit_price != null);
  const estimate = priced.reduce((sum, i) => sum + Number(i.unit_price) * i.quantity, 0);

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
              {priced.length < items.length ? ` · ${items.length - priced.length} unpriced` : ''}
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
                <Text style={styles.itemPrice}>
                  {item.unit_price == null ? '—' : formatNaira(Number(item.unit_price) * item.quantity)}
                </Text>
              </View>
            ))}
          </View>
        )}
      </Panel>

      <Panel title={`Quotes (${quotes.length})`}>
        {quotes.length === 0 ? (
          <Text style={styles.muted}>
            No shop has quoted on this booklist yet. Vendors usually respond within a few hours.
          </Text>
        ) : (
          <View>
            {quotes.map((q, i) => (
              <Pressable
                key={q.id}
                onPress={() => router.push(`/quotes/${q.id}`)}
                style={({ pressed }) => [styles.row, i > 0 && styles.rowDivider, pressed && styles.rowPressed]}
                accessibilityRole="button"
                accessibilityLabel={`Quote from ${q.vendors?.store_name ?? 'a shop'}, ${formatNaira(q.total_price)}`}
              >
                <View style={styles.thumb}>
                  <Text style={styles.thumbText}>
                    {(q.vendors?.store_name ?? '?').slice(0, 1).toUpperCase()}
                  </Text>
                </View>
                <View style={styles.rowText}>
                  <Text style={styles.itemTitle} numberOfLines={1}>
                    {q.vendors?.store_name ?? 'Shop'}
                  </Text>
                  <Text style={styles.itemMeta}>
                    {q.vendors?.city ?? '—'}
                    {i === 0 && quotes.length > 1 ? ' · lowest' : ''}
                  </Text>
                </View>
                <Text style={styles.itemPrice}>{formatNaira(q.total_price)}</Text>
                <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
              </Pressable>
            ))}
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

  thumb: {
    width: 34, height: 34, borderRadius: radius.sm, backgroundColor: colors.surfaceMuted,
    alignItems: 'center', justifyContent: 'center',
  },
  thumbText: { fontSize: font.md, fontWeight: '800', color: colors.navy },
});
