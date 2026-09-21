import { useState } from 'react';
import { View, Text, Image, Pressable, Platform, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import type { Category } from '../../types/catalog';
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
 * Two states for the header: a real photograph when the category has
 * one, and a tinted block with a glyph when it does not. The fallback is
 * not a placeholder image or a grey box pretending to be loading — no
 * category has a photo today, so the tinted state is the one that
 * actually ships, and it is built to look deliberate rather than broken.
 *
 * Hover is handled with Pressable's onHoverIn/onHoverOut rather than CSS.
 * react-native-web maps those to real pointer events, so the same
 * component lifts on a desktop pointer and dims under a thumb, with no
 * web-only branch in the markup.
 */
export function CategoryCard({ category, width, onPress }: Props) {
  const [hovered, setHovered] = useState(false);
  const imageUri = category.image_url?.trim() ? category.image_url : null;
  const [imageFailed, setImageFailed] = useState(false);
  const showImage = Boolean(imageUri) && !imageFailed;

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
      <View style={[styles.header, !showImage && { backgroundColor: category.accent ?? colors.surfaceMuted }]}>
        {showImage ? (
          <Image
            source={{ uri: imageUri as string }}
            style={styles.image}
            resizeMode="cover"
            // A dead URL falls back to the tinted block rather than
            // leaving a blank rectangle where a picture should be.
            onError={() => setImageFailed(true)}
            accessibilityLabel={`${category.name} category`}
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
