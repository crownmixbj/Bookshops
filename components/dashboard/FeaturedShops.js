import { useState } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Card } from './Card';
import { CategoryCard } from './CategoryCard';
import { useCategories } from '../../hooks/useCategories';
import { colors, spacing, radius, font } from '../../theme';
import { useLayout } from '../../hooks/useLayout';

export function FeaturedShops({ shop, onViewShop, onSelectCategory }) {
  const { gridColumns } = useLayout();
  // Live rows once the catalogue migration has been run; the built-in
  // four until then. Same names and slugs either way, so the tiles do
  // not move when it lands.
  const { categories } = useCategories();
  const [measured, setMeasured] = useState(null);

  // Tile width from the measured card body, floored.
  //
  // Floored rather than exact: `(w - gap) / 2` doubled plus the gap is
  // the container width to the last decimal, and a browser that rounds
  // that up wraps the second tile onto its own row. One pixel of slack
  // costs nothing visible and removes the whole failure mode.
  //
  // Before the first onLayout there is no width to divide, so the tiles
  // grow from zero and wrap on their own minimum — which lays out
  // correctly rather than collapsing to content width for a frame.
  const gap = spacing.md;
  const tileWidth = measured
    ? Math.floor((measured - gap * (gridColumns - 1)) / gridColumns)
    : undefined;

  return (
    <Card title="Featured Shops & Categories">
      <View style={styles.shop}>
        <View style={styles.shopThumb}>
          <Text style={styles.shopThumbText}>
            {(shop?.store_name ?? '?').slice(0, 1).toUpperCase()}
          </Text>
        </View>
        <View style={styles.shopText}>
          <Text style={styles.shopName} numberOfLines={1}>
            {shop?.store_name ?? 'No shops yet'}
          </Text>
          <View style={styles.shopMetaRow}>
            {shop?.rating == null ? (
              <Text style={styles.shopMeta}>
                No ratings yet{shop?.city ? ` · ${shop.city}` : ''}
              </Text>
            ) : (
              <>
                <Ionicons name="star" size={11} color={colors.star} />
                <Text style={styles.shopMeta}>
                  {Number(shop.rating).toFixed(1)}
                  {shop?.city ? ` · ${shop.city}` : ''}
                </Text>
              </>
            )}
          </View>
        </View>
      </View>

      <Pressable
        onPress={() => onViewShop?.(shop)}
        style={({ pressed }) => [styles.viewBtn, pressed && styles.viewBtnPressed]}
        accessibilityRole="button"
        accessibilityLabel={`View details for ${shop?.store_name ?? 'this shop'}`}
      >
        <Text style={styles.viewBtnText}>View Shop Details</Text>
      </Pressable>

      <View style={styles.grid} onLayout={(e) => setMeasured(e.nativeEvent.layout.width)}>
        {categories.map((c) => (
          <CategoryCard key={c.id} category={c} width={tileWidth} onPress={onSelectCategory} />
        ))}
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  shop: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  shopThumb: {
    width: 42,
    height: 42,
    borderRadius: radius.sm,
    backgroundColor: colors.navy,
    alignItems: 'center',
    justifyContent: 'center',
  },
  shopThumbText: { color: colors.onNavy, fontWeight: '800', fontSize: font.xl },
  shopText: { flex: 1 },
  shopName: { fontSize: font.md, fontWeight: '700', color: colors.text },
  shopMetaRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2 },
  shopMeta: { fontSize: font.sm, color: colors.textMuted },

  viewBtn: {
    marginTop: spacing.md,
    backgroundColor: colors.orange,
    borderRadius: radius.md,
    paddingVertical: 10,
    alignItems: 'center',
  },
  viewBtnPressed: { backgroundColor: colors.orangeDark },
  viewBtnText: { color: colors.onNavy, fontWeight: '700', fontSize: font.md },

  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
    marginTop: spacing.lg,
    // Without this the row is only as wide as its content, which is what
    // left the white band down the right of the card.
    width: '100%',
  },
  // Tile styling now lives in CategoryCard, including the flexGrow that
  // spends the pixel the floor above leaves behind so a row finishes
  // flush against the right edge.
});
