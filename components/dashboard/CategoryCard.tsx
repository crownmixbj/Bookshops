import { useEffect, useMemo, useState } from 'react';
import { View, Text, Image, Pressable, Platform, StyleSheet } from 'react-native';
import type { ImageSourcePropType } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import type { Category } from '../../types/catalog';
import { categoryImage } from '../../lib/categoryImages';
import { colors, spacing, radius, shadow, typography } from '../../theme';

/** Where a category tile goes. One place, so the tiles cannot drift from the route. */
export function categoryHref(slug: string) {
  return { pathname: '/categories/[slug]' as const, params: { slug } };
}

interface Props {
  category: Category;
  /** Measured tile width from the grid. Undefined before the first layout pass. */
  width?: number;
  /** Override navigation — the hub passes its own handler. */
  onPress?: (category: Category) => void;
}

/**
 * One category tile.
 *
 * The header shows a photograph, and falls back to a tinted block with
 * a glyph for any category that has none. Two sources of photograph, in
 * this order:
 *
 *   categories.image_url   a URL in the database. Wins when it is set,
 *                          so a picture can be swapped without shipping
 *                          a release. Null on every row today.
 *   the bundled asset      assets/images, mapped by slug in
 *                          lib/categoryImages. This is what renders.
 *
 * Ordering them this way rather than the other way round means the
 * bundled art is the floor, not the ceiling: setting image_url on a row
 * overrides it, and clearing the column puts the shipped photo back.
 *
 * Hover is handled with Pressable's onHoverIn/onHoverOut rather than CSS.
 * react-native-web maps those to real pointer events, so the same
 * component lifts on a desktop pointer and dims under a thumb, with no
 * web-only branch in the markup.
 */
export function CategoryCard({ category, width, onPress }: Props) {
  const [hovered, setHovered] = useState(false);

  /** Every picture worth trying for this tile, best first. */
  const sources = useMemo(() => {
    const out: ImageSourcePropType[] = [];
    const remote = category.image_url?.trim();
    if (remote) out.push({ uri: remote });
    const bundled = categoryImage(category.slug);
    if (bundled) out.push(bundled);
    return out;
  }, [category.image_url, category.slug]);

  /*
   * Which candidate is on screen. A failure steps to the next one
   * rather than straight to the glyph: a dead image_url on a category
   * that ships with artwork should show the artwork, not give up.
   */
  const [attempt, setAttempt] = useState(0);
  // A refresh can change image_url without remounting the tile — the
  // grid keys on category.id, which does not change with it. Without
  // this, a tile that had already fallen through would stay fallen
  // through against a brand new URL.
  useEffect(() => setAttempt(0), [sources]);

  const source = sources[attempt] ?? null;
  const showImage = source != null;

  const go = () => {
    if (onPress) return onPress(category);
    router.push(categoryHref(category.slug));
  };

  return (
    <Pressable
      onPress={go}
      onHoverIn={() => setHovered(true)}
      onHoverOut={() => setHovered(false)}
      style={({ pressed }) => [
        styles.card,
        width != null && { width },
        hovered && styles.cardHovered,
        pressed && styles.cardPressed,
      ]}
      accessibilityRole="link"
      accessibilityLabel={category.name}
      accessibilityHint={
        category.description ? `${category.description}. Opens this category.` : 'Opens this category'
      }
    >
      {/* The tint is behind the photo, not instead of it. On web the
          bundled JPEG is still a request, so the first frame of a tile
          would otherwise be a white rectangle that fills in a moment
          later. A tinted block of the exact same size reads as the tile
          loading rather than as the layout jumping — and the box is a
          fixed height either way, so nothing below it moves. */}
      <View style={[styles.header, { backgroundColor: category.accent ?? colors.surfaceMuted }]}>
        {showImage ? (
          <Image
            source={source as ImageSourcePropType}
            style={styles.image}
            // object-fit: cover. The art is centred with wide margins,
            // so filling a 92px-tall box crops the empty background
            // rather than the subject. 'contain' would letterbox it.
            resizeMode="cover"
            // Step to the next candidate; the glyph is what is left
            // when they have all failed.
            onError={() => setAttempt((a) => a + 1)}
            // Decorative. The Pressable around it already announces the
            // category name, and labelling the image too made a screen
            // reader read "Textbooks" and then "Textbooks category".
            accessible={false}
          />
        ) : (
          <Ionicons
            name={category.icon ?? 'pricetag-outline'}
            size={22}
            color={colors.navy}
            style={styles.fallbackIcon}
          />
        )}
      </View>

      <Text style={styles.label} numberOfLines={1}>
        {category.name}
      </Text>

      {/* Only ever rendered from real values. A category with no
          description and no count shows neither, rather than "0 items",
          which would read as an empty shelf rather than an unknown one. */}
      {!!category.description && (
        <Text style={styles.sub} numberOfLines={1}>
          {category.description}
        </Text>
      )}
      {category.item_count != null && (
        <Text style={styles.count}>
          {category.item_count} item{category.item_count === 1 ? '' : 's'}
        </Text>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    gap: 4,
    // The grid measures and hands down an exact width; these two govern
    // the first frame before that lands, and let a row finish flush
    // against the right edge afterwards.
    flexGrow: 1,
    minWidth: 132,
    borderRadius: radius.md,
    // Clips the header image to the rounded corner on every platform.
    overflow: 'hidden',
    ...(Platform.OS === 'web' ? { cursor: 'pointer', transitionDuration: '160ms' } : null),
  },
  // Lift and deepen on a pointer; nothing on touch, where there is no
  // hover to speak of and the press state does the work.
  cardHovered: {
    transform: [{ translateY: -3 }],
    ...shadow.card,
  },
  cardPressed: { opacity: 0.75, transform: [{ scale: 0.97 }] },

  header: {
    height: 92,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  image: { width: '100%', height: '100%' },
  fallbackIcon: { opacity: 0.75 },

  label: { ...typography.bodyStrong },
  sub: { ...typography.caption },
  count: { ...typography.caption, fontWeight: '600', color: colors.textMuted, marginTop: 1 },
});
