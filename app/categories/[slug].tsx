import { Text, Pressable, StyleSheet, View } from 'react-native';
import { useLocalSearchParams, router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { BuyerPage, NotBuiltPanel } from '../../components/buyer/BuyerPage';
import { MOCK_CATEGORIES } from '../../lib/mockData';
import { colors, spacing, radius, font } from '../../theme';

/**
 * A category, opened from a tile on the Booklist Hub.
 *
 * The route is real so the tiles are not dead, but there is nothing
 * behind it yet and this screen says so. The four tiles come from
 * MOCK_CATEGORIES in lib/mockData.js — there is no categories table, no
 * product catalogue and no inventory, so there is literally no query
 * that would return "the stationery in shops near you".
 *
 * What it can honestly do is send you where the marketplace does work
 * today: ask the shops directly, by sending them a booklist.
 */
export default function CategoryScreen() {
  const params = useLocalSearchParams<{ slug?: string | string[] }>();
  const slug = Array.isArray(params.slug) ? params.slug[0] : params.slug ?? '';
  const category = MOCK_CATEGORIES.find((c) => c.slug === slug);
  const label = category?.label ?? slug.replace(/-/g, ' ');

  return (
    <BuyerPage
      eyebrow="Category"
      title={label.replace(/\b\w/g, (c) => c.toUpperCase())}
      subtitle={category?.subtitle}
    >
      <NotBuiltPanel
        what="Browsing by category is not built yet"
        missing={[
          'A categories table. The four tiles on the hub are hard-coded in lib/mockData.js.',
          'A product catalogue. Nothing in the schema stores what a shop sells — only what buyers ask for and what shops quote.',
          'Stock levels per shop, so a listing could say what is actually in.',
        ]}
      />

      <View style={styles.alt}>
        <Ionicons name="bulb-outline" size={18} color={colors.navy} />
        <Text style={styles.altText}>
          What works today is the other direction: send a booklist and let the shops near you come
          back with prices for exactly what you need.
        </Text>
      </View>

      <Pressable
        onPress={() => router.push('/booklists/new-manual')}
        style={({ pressed }) => [styles.cta, pressed && styles.ctaPressed]}
        accessibilityRole="button"
      >
        <Ionicons name="add" size={16} color={colors.onNavy} />
        <Text style={styles.ctaText}>Create a booklist instead</Text>
      </Pressable>
    </BuyerPage>
  );
}

const styles = StyleSheet.create({
  alt: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm, paddingHorizontal: spacing.xs },
  altText: { flex: 1, fontSize: font.md, color: colors.text, lineHeight: 20 },
  cta: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm,
    backgroundColor: colors.orange, borderRadius: radius.md, paddingVertical: 13,
  },
  ctaPressed: { backgroundColor: colors.orangeDark },
  ctaText: { fontSize: font.md, fontWeight: '800', color: colors.onNavy },
});
