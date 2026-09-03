import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Card, Pill } from './Card';
import { colors, spacing, radius, font, formatNaira } from '../../theme';

function Stars({ rating = 0 }) {
  const full = Math.floor(rating);
  const half = rating - full >= 0.5;
  return (
    <View style={styles.stars} accessibilityLabel={`Rated ${rating} out of 5`}>
      {[0, 1, 2, 3, 4].map((i) => (
        <Ionicons
          key={i}
          name={i < full ? 'star' : i === full && half ? 'star-half' : 'star-outline'}
          size={11}
          color={colors.star}
        />
      ))}
      <Text style={styles.ratingText}>{Number(rating).toFixed(1)}</Text>
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
        <Stars rating={quote.rating} />
        {!!quote.tagline && <Text style={styles.tagline}>{quote.tagline}</Text>}
      </View>
      <Text style={styles.price}>{formatNaira(quote.total_price)}</Text>
    </Pressable>
  );
}

export function PendingQuotes({ quotes, onSelectQuote, onCreatePress, loading }) {
  return (
    <Card
      title="My Pending Quotes"
      right={quotes?.[0]?.demo ? <Pill label="Demo data" tone="accent" /> : null}
    >
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
          <Text style={styles.emptyText}>
            No quotes yet. Vendors usually respond within a few hours.
          </Text>
        </View>
      )}

      <Pressable
        onPress={onCreatePress}
        style={({ pressed }) => [styles.cta, pressed && styles.ctaPressed]}
        accessibilityRole="button"
        // Without this a screen reader announces the icon glyph
        // alongside the label. The navy tile above already names
        // itself; this one did not.
        accessibilityLabel="Create a new booklist"
      >
        <Ionicons name="add" size={16} color={colors.onNavy} />
        <Text style={styles.ctaText}>Create New Booklist</Text>
      </Pressable>
    </Card>
  );
}

const styles = StyleSheet.create({
  sub: { fontSize: font.sm, color: colors.textMuted, marginBottom: spacing.md },
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
  vendor: { fontSize: font.md, fontWeight: '700', color: colors.text },
  stars: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  ratingText: { fontSize: font.xs, color: colors.textMuted, marginLeft: 3, fontWeight: '600' },
  tagline: { fontSize: font.xs, color: colors.textFaint },
  price: { fontSize: font.md, fontWeight: '800', color: colors.text },

  empty: { paddingVertical: spacing.lg },
  emptyText: { fontSize: font.md, color: colors.textMuted, textAlign: 'center' },

  cta: {
    marginTop: spacing.md,
    backgroundColor: colors.orange,
    borderRadius: radius.md,
    paddingVertical: 11,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
  },
  ctaPressed: { backgroundColor: colors.orangeDark },
  ctaText: { color: colors.onNavy, fontWeight: '700', fontSize: font.md },

  skeleton: { height: 62, borderRadius: radius.md, backgroundColor: colors.surfaceMuted },
});
