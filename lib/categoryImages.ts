import type { ImageSourcePropType } from 'react-native';

/**
 * The photograph on each category tile, keyed by the category's slug.
 *
 * WHY A HAND-WRITTEN MAP
 *
 * Metro resolves `require()` for assets at BUILD time by reading the
 * literal string inside the call. `require(`../assets/images/${slug}.jpeg`)`
 * bundles nothing and throws at runtime on a device, so there is no way
 * to derive these from the slug — every file has to appear on its own
 * line. That is the whole reason this file exists rather than two lines
 * inside CategoryCard.
 *
 * The keys are the slugs the `categories` table actually uses, checked
 * against it: textbooks, stationery, uniforms, school-shoes. A slug with
 * no entry here is not an error — the tile falls back to its tint and
 * glyph, which is what every category did before these photos existed.
 *
 * FILENAMES
 *
 * Taken verbatim from assets/images, including "stationary-icon", which
 * is the American spelling of the wrong word — "stationary" means "not
 * moving". Left as saved on purpose: this map is the only place the
 * filename appears, so the misspelling costs nothing and renaming the
 * file is a change worth making on its own rather than buried in this
 * one. If it is ever renamed, this line is the only one to update.
 */
const CATEGORY_IMAGE: Record<string, ImageSourcePropType> = {
  textbooks: require('../assets/images/textbook-icon.jpeg'),
  stationery: require('../assets/images/stationary-icon.jpeg'),
  uniforms: require('../assets/images/uniform-icon.jpeg'),
  'school-shoes': require('../assets/images/shoes-icon.jpeg'),
};

/** The bundled photo for a slug, or null when there is not one. */
export function categoryImage(slug: string | null | undefined): ImageSourcePropType | null {
  if (!slug) return null;
  return CATEGORY_IMAGE[slug] ?? null;
}

/** Slugs that ship with artwork. Exported for the tests, not for the UI. */
export const CATEGORIES_WITH_IMAGES = Object.keys(CATEGORY_IMAGE);
