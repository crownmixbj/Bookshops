import type { Ionicons } from '@expo/vector-icons';

/**
 * A browsable category.
 *
 * There is no `categories` table on this project yet — verified against
 * the live schema, which has no categories, products, catalog or listing
 * table of any kind. The four categories on the hub come from
 * lib/mockData.js and exist as navigation, not as data: tapping one
 * lands on a screen that says plainly that browsing is not built.
 *
 * This shape is written for the table when it lands, which is why
 * `image_url` and `item_count` are optional rather than absent: the card
 * renders them when they are there and degrades honestly when they are
 * not. Nothing invents a count or a photograph in the meantime.
 */
export interface Category {
  id: string;
  name: string;
  /** What the URL carries: /categories/stationery. */
  slug: string;
  description?: string;
  /** A photograph for the card header. Falls back to accent + icon. */
  image_url?: string | null;
  /** How many listings sit under it. Hidden entirely while unknown. */
  item_count?: number | null;
  /** Presentational only: the tint behind the fallback icon. */
  accent?: string;
  /** Presentational only: the fallback glyph. */
  icon?: keyof typeof Ionicons.glyphMap;
}
