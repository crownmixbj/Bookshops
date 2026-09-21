import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Card } from './Card';
import { colors, spacing, radius, font, typography, formatNaira } from '../../theme';

/**
 * A shop's rating, or a plain statement that it has none.
 *
 * Null is not zero and it is not 4.8. A new shop on a new marketplace
 * has no reviews, and drawing five hollow stars beside "0.0" reads as a
 * bad shop rather than a new one — while the fixture this replaced drew
 * a confident 4.8 on every vendor alike.
 */
function Stars({ rating, reviewCount = 0 }) {
  if (rating == null) {
    return <Text style={styles.noRating}>No ratings yet</Text>;
  }

  const full = Math.floor(rating);
  const half = rating - full >= 0.5;
  return (
    <View
      style={styles.stars}
      accessibilityLabel={
        reviewCount > 0
          ? `Rated ${rating} out of 5 from ${reviewCount} review${reviewCount === 1 ? '' : 's'}`
          : `Rated ${rating} out of 5`
      }
    >
      {[0, 1, 2, 3, 4].map((i) => (
        <Ionicons
          key={i}
          name={i < full ? 'star' : i === full && half ? 'star-half' : 'star-outline'}
          size={11}
          color={colors.star}
        />
      ))}
      <Text style={styles.ratingText}>{Number(rating).toFixed(1)}</Text>
      {reviewCount > 0 && <Text style={styles.ratingText}>({reviewCount})</Text>}
    </View>
  );
}

function QuoteRow({ quote, onPress }) {
  return (
    <Pressable
      onPress={() => onPress?.(quote)}
      style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
      accessibilityRole="button"
      accessibilityLabel={`Quote from ${quote.vendor_name}, ${formatNaira(quote.total_price)}`}
    >
      <View style={styles.thumb}>
        <Text style={styles.thumbText}>
          {(quote.vendor_name ?? '?').slice(0, 1).toUpperCase()}
        </Text>
      </View>
      <View style={styles.rowText}>
        <Text style={styles.vendor} numberOfLines={1}>
          {quote.vendor_name}
        </Text>
        <Stars rating={quote.rating} reviewCount={quote.review_count} />
      </View>
      <Text style={styles.price}>{formatNaira(quote.total_price)}</Text>
    </Pressable>
  );
}

export function PendingQuotes({ quotes, onSelectQuote, loading }) {
  return (
    <Card title="My Pending Quotes">
      <Text style={styles.sub}>Vendors who have responded to your booklists</Text>

      {loading ? (
        <View style={{ gap: spacing.sm }}>
          {[0, 1, 2].map((i) => (
            <View key={i} style={styles.skeleton} />
          ))}
        </View>
      ) : quotes?.length ? (
        <View style={styles.list}>
          {quotes.map((q) => (
            <QuoteRow key={q.id} quote={q} onPress={onSelectQuote} />
          ))}
        </View>
      ) : (
        <View style={styles.empty}>
          <View style={styles.emptyIcon}>
            <Ionicons name="time-outline" size={22} color={colors.textMuted} />
          </View>
          <Text style={styles.emptyTitle}>No quotes pending</Text>
          <Text style={styles.emptyText}>
            When vendors submit offers for your active booklists, they will appear here for
            comparison and checkout.
          </Text>
        </View>
      )}
    </Card>
  );
}

const styles = StyleSheet.create({
  sub: { ...typography.body, marginBottom: spacing.md },
  list: { gap: spacing.sm },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
  },
  rowPressed: { backgroundColor: colors.surfaceMuted },
  rowText: { flex: 1, gap: 2 },
  thumb: {
    width: 38,
    height: 38,
    borderRadius: radius.sm,
    backgroundColor: colors.surfaceMuted,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  thumbText: { fontWeight: '800', color: colors.navy, fontSize: font.lg },
  vendor: { ...typography.bodyStrong },
  stars: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  ratingText: { ...typography.caption, color: colors.textMuted, marginLeft: 3, fontWeight: '600' },
  noRating: { ...typography.caption },
  price: { ...typography.bodyStrong, fontWeight: '800' },

  empty: { paddingVertical: spacing.lg, alignItems: 'center', gap: spacing.sm },
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
  // Matches ActiveBooklists exactly: the two empty states sit one
  // above the other in the same column, and any difference between
  // them reads as a mistake rather than a distinction.
  emptyTitle: { ...typography.emptyTitle },
  emptyText: { ...typography.body, textAlign: 'center', maxWidth: 320 },

  skeleton: { height: 62, borderRadius: radius.md, backgroundColor: colors.surfaceMuted },
});
