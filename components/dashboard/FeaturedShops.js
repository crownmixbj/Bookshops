import { useState } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Card, Pill } from './Card';
import { MOCK_CATEGORIES } from '../../lib/mockData';
import { colors, spacing, radius, font } from '../../theme';
import { useLayout } from '../../hooks/useLayout';

function CategoryTile({ category, width, onPress }) {
  return (
    <Pressable
      onPress={() => onPress?.(category)}
      style={({ pressed }) => [styles.tile, { width }, pressed && styles.tilePressed]}
      accessibilityRole="button"
      accessibilityLabel={category.label}
    >
      {/* TODO(db): no categories table and no product imagery — a flat
          colour block stands in for the photo in the mockup. */}
      <View style={[styles.tileImage, { backgroundColor: category.accent }]}>
        <Ionicons name="pricetag-outline" size={20} color={colors.navy} />
      </View>
      <Text style={styles.tileLabel} numberOfLines={1}>
        {category.label}
      </Text>
      <Text style={styles.tileSub} numberOfLines={1}>
        {category.subtitle}
      </Text>
    </Pressable>
  );
}

export function FeaturedShops({ shop, onViewShop, onSelectCategory }) {
  const { gridColumns } = useLayout();
  const [measured, setMeasured] = useState(null);

  // Compute tile width from the measured card body so the grid stays
  // even at any window size without hard-coded pixel widths.
  const gap = spacing.md;
  const tileWidth = measured ? (measured - gap * (gridColumns - 1)) / gridColumns : undefined;

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
            <Ionicons name="star" size={11} color={colors.star} />
            <Text style={styles.shopMeta}>
              {Number(shop?.rating ?? 0).toFixed(1)}
              {shop?.city ? ` · ${shop.city}` : ''}
            </Text>
          </View>
        </View>
        {shop?.demo && <Pill label="Demo" tone="accent" />}
      </View>

      <Pressable
        onPress={() => onViewShop?.(shop)}
        style={({ pressed }) => [styles.viewBtn, pressed && styles.viewBtnPressed]}
        accessibilityRole="button"
      >
        <Text style={styles.viewBtnText}>View Shop Details</Text>
      </Pressable>

      <View style={styles.grid} onLayout={(e) => setMeasured(e.nativeEvent.layout.width)}>
        {MOCK_CATEGORIES.map((c) => (
          <CategoryTile key={c.id} category={c} width={tileWidth} onPress={onSelectCategory} />
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
  },
  tile: { gap: 4 },
  tilePressed: { opacity: 0.75 },
  tileImage: {
    height: 92,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tileLabel: { fontSize: font.md, fontWeight: '700', color: colors.text },
  tileSub: { fontSize: font.xs, color: colors.textFaint },
});
