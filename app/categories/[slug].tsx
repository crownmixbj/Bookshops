import { View, Text, Image, Pressable, StyleSheet } from 'react-native';
import { useLocalSearchParams, router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { BuyerPage, Panel, Skeleton, ErrorPanel } from '../../components/buyer/BuyerPage';
import {
  useCategoryCatalog,
  LOW_STOCK_THRESHOLD,
  type CatalogProduct,
} from '../../hooks/useCategoryCatalog';
import { useLayout } from '../../hooks/useLayout';
import { colors, spacing, radius, font, formatNaira } from '../../theme';

/**
 * One category, and what shops actually have in it.
 *
 * This screen used to be a hard-coded panel explaining that browsing was
 * not built. It is now backed by the catalogue tables — but the panel
 * was honest at the time and the honesty has to survive the rewrite: a
 * category with nothing listed says so plainly and sends the buyer to
 * the flow that does work, rather than showing an empty grid and leaving
 * them to guess whether it is broken or just bare.
 */
export default function CategoryScreen() {
  const params = useLocalSearchParams<{ slug?: string | string[] }>();
  const slug = (Array.isArray(params.slug) ? params.slug[0] : params.slug) ?? '';
  const { isMobile } = useLayout();
  const { category, products, loading, notFound, error, refresh } = useCategoryCatalog(slug);

  const title =
    category?.name ?? slug.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

  if (loading) {
    return (
      <BuyerPage eyebrow="Category" title={title}>
        <Panel>
          <View style={styles.skeletonWrap}>
            <Skeleton height={18} width="45%" />
            <Skeleton height={14} width="70%" />
            <View style={{ height: spacing.md }} />
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} height={64} />
            ))}
          </View>
        </Panel>
      </BuyerPage>
    );
  }

  if (error) {
    return (
      <BuyerPage eyebrow="Category" title={title}>
        <ErrorPanel message={error.message} onRetry={refresh} />
      </BuyerPage>
    );
  }

  // A slug nobody has a row for. Distinct from "listed nothing yet":
  // the category does not exist, so there is nothing to check back for.
  if (notFound) {
    return (
      <BuyerPage eyebrow="Category" title={title}>
        <Panel>
          <View style={styles.empty}>
            <View style={styles.emptyIcon}>
              <Ionicons name="help-circle-outline" size={24} color={colors.textMuted} />
            </View>
            <Text style={styles.emptyTitle}>That category does not exist</Text>
            <Text style={styles.emptyBody}>
              The link may be out of date. Browse from your hub, or send a booklist and let shops
              quote exactly what you need.
            </Text>
            <BooklistCta />
          </View>
        </Panel>
      </BuyerPage>
    );
  }

  return (
    <BuyerPage
      eyebrow="Category"
      title={title}
      subtitle={category?.description}
      right={
        products.length > 0 ? (
          <Text style={styles.count}>
            {products.length} item{products.length === 1 ? '' : 's'}
          </Text>
        ) : null
      }
    >
      {products.length === 0 ? (
        <Panel>
          <View style={styles.empty}>
            <View style={styles.emptyIcon}>
              <Ionicons name="cube-outline" size={24} color={colors.textMuted} />
            </View>
            <Text style={styles.emptyTitle}>No items listed in {title} yet</Text>
            <Text style={styles.emptyBody}>
              Vendors are updating their term inventory. Check back soon, or request items via a
              booklist.
            </Text>
            <BooklistCta />
          </View>
        </Panel>
      ) : (
        <Panel title="Available from shops near you">
          <View>
            {products.map((product, i) => (
              <ProductRow
                key={product.id}
                product={product}
                isMobile={isMobile}
                divider={i > 0}
              />
            ))}
          </View>
        </Panel>
      )}
    </BuyerPage>
  );
}

/* ------------------------------------------------------------------ */

function ProductRow({
  product,
  isMobile,
  divider,
}: {
  product: CatalogProduct;
  isMobile: boolean;
  divider: boolean;
}) {
  // Author first, publisher as the fallback — the same field that tells
  // a shop which edition to quote on a booklist.
  const attribution = product.author?.trim() || product.publisher?.trim() || '';

  const stock = stockLabel(product.total_stock);

  return (
    <View style={[styles.row, divider && styles.rowDivider, isMobile && styles.rowStacked]}>
      <View style={styles.thumb}>
        {product.image_url ? (
          <Image
            source={{ uri: product.image_url }}
            style={styles.thumbImage}
            resizeMode="cover"
            accessibilityLabel={product.title}
          />
        ) : (
          <Ionicons name="book-outline" size={18} color={colors.navy} />
        )}
      </View>

      <View style={styles.rowText}>
        <Text style={styles.title} numberOfLines={2}>
          {product.title}
        </Text>
        {/* Only from a real value. "Author unknown" under every line is
            noise; the absence of one is already visible. */}
        {!!attribution && (
          <Text style={styles.attribution} numberOfLines={1}>
            {attribution}
          </Text>
        )}
        <Text style={styles.vendors}>
          {product.vendor_count} shop{product.vendor_count === 1 ? '' : 's'}
        </Text>
      </View>

      <View style={[styles.rowRight, isMobile && styles.rowRightStacked]}>
        <Text style={styles.price}>
          {/* "From" only when there is more than one offer to be cheapest
              among — on a single listing it is simply the price. */}
          {product.multipleOffers ? 'From ' : ''}
          {formatNaira(product.min_price as number)}
        </Text>
        <View style={[styles.stockPill, { backgroundColor: stock.bg }]}>
          <Text style={[styles.stockText, { color: stock.fg }]}>{stock.label}</Text>
        </View>
      </View>
    </View>
  );
}

/**
 * Three states, not two.
 *
 * A listing can be flagged available while its stock has run to zero,
 * and calling that "In Stock" sends a parent to a shop for a book that
 * is not on the shelf.
 */
function stockLabel(total: number) {
  if (total <= 0) return { label: 'Out of stock', bg: colors.surfaceMuted, fg: colors.textMuted };
  if (total <= LOW_STOCK_THRESHOLD) {
    return { label: 'Low Stock', bg: colors.warningBg, fg: colors.warning };
  }
  return { label: 'In Stock', bg: '#E4F2E8', fg: colors.success };
}

/** What works today, on every empty state on this screen. */
function BooklistCta() {
  return (
    <Pressable
      onPress={() => router.push('/booklists/new-manual')}
      style={({ pressed }) => [styles.cta, pressed && styles.ctaPressed]}
      accessibilityRole="button"
      accessibilityLabel="Create a booklist request"
    >
      <Ionicons name="add" size={16} color={colors.onNavy} />
      <Text style={styles.ctaText}>Create a booklist request</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  skeletonWrap: { gap: spacing.sm },
  count: { fontSize: font.sm, fontWeight: '700', color: colors.textMuted },

  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md,
    paddingVertical: spacing.md,
  },
  rowStacked: { flexWrap: 'wrap' },
  rowDivider: { borderTopWidth: 1, borderTopColor: colors.border },
  thumb: {
    width: 46,
    height: 46,
    borderRadius: radius.sm,
    backgroundColor: colors.surfaceMuted,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  thumbImage: { width: '100%', height: '100%' },
  rowText: { flex: 1, minWidth: 0, gap: 2 },
  title: { fontSize: font.md, fontWeight: '600', color: colors.text },
  attribution: { fontSize: font.sm, color: colors.textMuted },
  vendors: { fontSize: font.xs, color: colors.textFaint },

  rowRight: { alignItems: 'flex-end', gap: 5, minWidth: 96 },
  rowRightStacked: { alignItems: 'flex-end' },
  price: { fontSize: font.md, fontWeight: '800', color: colors.text },
  stockPill: { borderRadius: radius.sm, paddingHorizontal: 8, paddingVertical: 3 },
  stockText: { fontSize: font.xs, fontWeight: '700' },

  empty: { alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.lg },
  emptyIcon: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surfaceMuted,
    borderWidth: 1,
    borderColor: colors.border,
  },
  emptyTitle: { fontSize: font.lg, fontWeight: '700', color: colors.text, textAlign: 'center' },
  emptyBody: {
    fontSize: font.sm,
    color: colors.textMuted,
    textAlign: 'center',
    lineHeight: 19,
    maxWidth: 380,
  },

  cta: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    marginTop: spacing.sm,
    backgroundColor: colors.orange,
    borderRadius: radius.md,
    paddingVertical: 12,
    paddingHorizontal: spacing.lg,
    minHeight: 44,
  },
  ctaPressed: { backgroundColor: colors.orangeDark },
  ctaText: { fontSize: font.md, fontWeight: '800', color: colors.onNavy },
});
