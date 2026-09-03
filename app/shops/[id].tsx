import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, router } from 'expo-router';
import { BuyerPage, Panel, Skeleton, ErrorPanel } from '../../components/buyer/BuyerPage';
import { useShopDetail } from '../../hooks/useBuyerDetail';
import { colors, spacing, radius, font } from '../../theme';

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

      <Panel title="About this shop">
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
        onPress={() => router.push('/booklists/new-manual')}
        style={({ pressed }) => [styles.cta, pressed && styles.ctaPressed]}
        accessibilityRole="button"
      >
        <Ionicons name="add" size={16} color={colors.onNavy} />
        <Text style={styles.ctaText}>Send this shop a booklist</Text>
      </Pressable>
    </BuyerPage>
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

  cta: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm,
    backgroundColor: colors.orange, borderRadius: radius.md, paddingVertical: 13,
  },
  ctaPressed: { backgroundColor: colors.orangeDark },
  ctaText: { fontSize: font.md, fontWeight: '800', color: colors.onNavy },
});
