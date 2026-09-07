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
  onToggleSaved: (shop: ShopView) => void;
  /** Card width, so the grid can size cards to the container. */
  width?: number;
}

/**
 * One shop in the directory.
 *
 * The whole card is the control. It used to carry two buttons side by
 * side — "View Shop" and "Send Booklist Direct" — which at three columns
 * on a laptop left about nine characters for the second label, so it
 * read "Send Booklis…". Sending a booklist is now reached from the shop's
 * own page, where the buyer can see who they are dealing with and which
 * of their lists is going, rather than from a tile in a grid.
 *
 * The bookmark sits outside the card's Pressable rather than inside it.
 * Nesting the two works on iOS and Android, where the inner press wins
 * the responder — but on react-native-web a click bubbles, so saving a
 * shop would ALSO open it. Absolutely positioned, it is a sibling, and
 * neither press can reach the other on any platform.
 */
export function ShopCard({ shop, saving, onView, onToggleSaved, width }: Props) {
  return (
    <View style={[styles.wrap, width ? { width } : undefined]}>
      <Pressable
        onPress={() => onView(shop)}
        style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}
        accessibilityRole="button"
        accessibilityLabel={`${shop.store_name}. Open this shop.`}
      >
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

        {/* Spacer: the bookmark floats above this corner. Without it a
            long shop name runs under the icon. */}
        <View style={styles.bookmarkSpacer} />
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

        {/*
          Deliberately a View, not a Pressable.
          The card above is already the button, and a real control here
          would either fire twice on web (click bubbles) or announce a
          second identical action to a screen reader. This is the visual
          affordance for the press the whole card carries, so it is
          hidden from assistive tech rather than duplicated to it.
        */}
        <View
          style={styles.cta}
          importantForAccessibility="no-hide-descendants"
          accessibilityElementsHidden
        >
          <Ionicons name="storefront-outline" size={15} color={colors.navy} />
          <Text style={styles.ctaText}>View Shop</Text>
        </View>
      </Pressable>

      <Pressable
        onPress={() => onToggleSaved(shop)}
        disabled={saving}
        hitSlop={10}
        style={({ pressed }) => [styles.bookmark, pressed && styles.pressed]}
        accessibilityRole="button"
        accessibilityLabel={
          shop.isSaved ? `Remove ${shop.store_name} from saved` : `Save ${shop.store_name}`
        }
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
  );
}

const styles = StyleSheet.create({
  // The positioning context for the bookmark, and where the grid's
  // measured width lands.
  wrap: { position: 'relative' },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
    ...shadow.card,
  },
  cardPressed: { backgroundColor: colors.surfaceMuted, borderColor: colors.borderStrong },
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
  bookmarkSpacer: { width: 26 },
  bookmark: {
    position: 'absolute',
    top: spacing.md,
    right: spacing.md,
    width: 30,
    height: 30,
    alignItems: 'center',
    justifyContent: 'center',
  },

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

  // Full width, one action, so nothing has to be truncated at any
  // column count.
  cta: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    marginTop: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingVertical: 10,
    minHeight: 40,
  },
  ctaText: { color: colors.navy, fontWeight: '700', fontSize: font.sm },
  pressed: { opacity: 0.85 },
});
