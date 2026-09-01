import { View, Text, Pressable, ActivityIndicator, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { ShopView } from '../../types/db';
import { colors, spacing, radius, font, shadow } from '../../theme';

function Stars({ rating }: { rating: number | null }) {
  if (rating == null) {
    return <Text style={styles.noRating}>No ratings yet</Text>;
  }
  const full = Math.floor(rating);
  const half = rating - full >= 0.5;
  return (
    <View style={styles.stars} accessibilityLabel={`Rated ${rating} out of 5`}>
      {[0, 1, 2, 3, 4].map((i) => (
        <Ionicons
          key={i}
          name={i < full ? 'star' : i === full && half ? 'star-half' : 'star-outline'}
          size={12}
          color={colors.star}
        />
      ))}
      <Text style={styles.ratingValue}>{rating.toFixed(1)}</Text>
    </View>
  );
}

interface Props {
  shop: ShopView;
  saving?: boolean;
  onView: (shop: ShopView) => void;
  onRequestQuote: (shop: ShopView) => void;
  onToggleSaved: (shop: ShopView) => void;
  /** Card width, so the grid can size cards to the container. */
  width?: number;
}

export function ShopCard({ shop, saving, onView, onRequestQuote, onToggleSaved, width }: Props) {
  return (
    <View style={[styles.card, width ? { width } : undefined]}>
      <View style={styles.head}>
        <View style={styles.logo}>
          <Text style={styles.logoText}>
            {(shop.store_name || '?').slice(0, 1).toUpperCase()}
          </Text>
        </View>

        <View style={{ flex: 1 }}>
          <View style={styles.nameRow}>
            <Text style={styles.name} numberOfLines={1}>
              {shop.store_name}
            </Text>
            {/* Verification is an administrative check on identity and
                address — deliberately distinct from is_active, which only
                says the shop is currently trading. */}
            {shop.isVerified && (
              <Ionicons
                name="checkmark-circle"
                size={15}
                color={colors.success}
                accessibilityLabel="Verified shop"
              />
            )}
          </View>
          <Text style={styles.address} numberOfLines={2}>
            {[shop.address, shop.city].filter(Boolean).join(', ') || 'No address on file'}
          </Text>
          <Stars rating={shop.rating} />
        </View>

        <Pressable
          onPress={() => onToggleSaved(shop)}
          disabled={saving}
          hitSlop={8}
          style={styles.starBtn}
          accessibilityRole="button"
          accessibilityLabel={shop.isSaved ? `Remove ${shop.store_name} from saved` : `Save ${shop.store_name}`}
        >
          {saving ? (
            <ActivityIndicator size="small" color={colors.navy} />
          ) : (
            <Ionicons
              name={shop.isSaved ? 'bookmark' : 'bookmark-outline'}
              size={19}
              color={shop.isSaved ? colors.orange : colors.textFaint}
            />
          )}
        </Pressable>
      </View>

      <View style={styles.metrics}>
        <View style={styles.metric}>
          <Text style={styles.metricValue}>{shop.completed_orders}</Text>
          <Text style={styles.metricLabel}>Completed orders</Text>
        </View>
        <View style={styles.metricDivider} />
        <View style={styles.metric}>
          <Text style={styles.metricValue}>{shop.review_count}</Text>
          <Text style={styles.metricLabel}>
            {shop.review_count === 1 ? 'Review' : 'Reviews'}
          </Text>
        </View>
      </View>

      <View style={styles.actions}>
        <Pressable
          onPress={() => onView(shop)}
          style={({ pressed }) => [styles.btn, styles.btnGhost, pressed && styles.pressed]}
          accessibilityRole="button"
        >
          <Ionicons name="storefront-outline" size={15} color={colors.navy} />
          <Text style={styles.btnGhostText}>View Shop</Text>
        </Pressable>
        <Pressable
          onPress={() => onRequestQuote(shop)}
          style={({ pressed }) => [styles.btn, styles.btnPrimary, pressed && styles.pressed]}
          accessibilityRole="button"
        >
          <Ionicons name="pricetag-outline" size={15} color={colors.onNavy} />
          <Text style={styles.btnPrimaryText}>Request Quote</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
    ...shadow.card,
  },
  head: { flexDirection: 'row', gap: spacing.md },
  logo: {
    width: 44,
    height: 44,
    borderRadius: radius.md,
    backgroundColor: colors.navy,
    alignItems: 'center',
    justifyContent: 'center',
  },
  logoText: { color: colors.onNavy, fontWeight: '800', fontSize: font.xl },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  name: { flexShrink: 1, fontSize: font.md, fontWeight: '700', color: colors.text },
  address: { fontSize: font.sm, color: colors.textMuted, marginTop: 2, lineHeight: 17 },
  stars: { flexDirection: 'row', alignItems: 'center', gap: 2, marginTop: 5 },
  ratingValue: { fontSize: font.xs, fontWeight: '700', color: colors.textMuted, marginLeft: 4 },
  noRating: { fontSize: font.xs, color: colors.textFaint, marginTop: 5, fontStyle: 'italic' },
  starBtn: { padding: 2 },

  metrics: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surfaceMuted,
    borderRadius: radius.md,
    paddingVertical: spacing.md,
    marginTop: spacing.md,
  },
  metric: { flex: 1, alignItems: 'center' },
  metricDivider: { width: 1, alignSelf: 'stretch', backgroundColor: colors.border },
  metricValue: { fontSize: font.lg, fontWeight: '800', color: colors.navy },
  metricLabel: { fontSize: font.xs, color: colors.textMuted, marginTop: 1 },

  actions: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md },
  btn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    borderRadius: radius.md,
    paddingVertical: 10,
    minHeight: 38,
  },
  btnGhost: { borderWidth: 1, borderColor: colors.border },
  btnGhostText: { color: colors.navy, fontWeight: '700', fontSize: font.sm },
  btnPrimary: { backgroundColor: colors.orange },
  btnPrimaryText: { color: colors.onNavy, fontWeight: '700', fontSize: font.sm },
  pressed: { opacity: 0.85 },
});
