import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, router } from 'expo-router';
import { BuyerPage, Panel, Skeleton, ErrorPanel } from '../../components/buyer/BuyerPage';
import { useQuoteDetail } from '../../hooks/useBuyerDetail';
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

      <View style={styles.actions}>
        {!!quote.request_id && (
          <Pressable
            onPress={() => router.push(`/booklists/${quote.request_id}`)}
            style={({ pressed }) => [styles.secondary, pressed && styles.secondaryPressed]}
            accessibilityRole="button"
          >
            <Text style={styles.secondaryText}>Compare all quotes</Text>
          </Pressable>
        )}
        {!!shop?.id && (
          <Pressable
            onPress={() => router.push(`/shops/${shop.id}`)}
            style={({ pressed }) => [styles.secondary, pressed && styles.secondaryPressed]}
            accessibilityRole="button"
          >
            <Text style={styles.secondaryText}>View shop details</Text>
          </Pressable>
        )}
        <Pressable
          onPress={() => router.push('/checkout')}
          style={({ pressed }) => [styles.cta, pressed && styles.ctaPressed]}
          accessibilityRole="button"
        >
          <Ionicons name="lock-closed" size={15} color={colors.onNavy} />
          <Text style={styles.ctaText}>Accept and pay</Text>
        </Pressable>
      </View>
    </BuyerPage>
  );
}

const styles = StyleSheet.create({
  total: { fontSize: font.xxl, fontWeight: '800', color: colors.text },
  muted: { fontSize: font.md, color: colors.textMuted, lineHeight: 20 },

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
  ctaText: { fontSize: font.md, fontWeight: '800', color: colors.onNavy },
});
