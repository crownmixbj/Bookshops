import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '../utils/supabase';
import { withTimeout } from '../lib/loadState';
import { MOCK_CATEGORIES } from '../lib/mockData';
import type { Category } from '../types/catalog';

/** Where the tiles on screen came from. */
export type CategorySource = 'database' | 'builtin';

export interface UseCategories {
  categories: Category[];
  /**
   * 'database' once 20260907_create_catalog_schema.sql has been run;
   * 'builtin' while it has not. Worth surfacing in dev: the two lists
   * are identical by design, so without this flag you cannot tell
   * whether the migration actually landed.
   */
  source: CategorySource;
  loading: boolean;
  error: Error | null;
  refresh: () => void;
}

const COLUMNS = 'id, name, slug, description, image_url, display_order';

/**
 * The catalogue's category list.
 *
 * Falls back to the built-in four when the table is not there yet, and
 * that is a narrower thing than it sounds: these are navigation labels
 * and routes, not claims about stock. They are the same four rows the
 * migration seeds, with the same names and slugs, so nothing on screen
 * moves or renames when it runs. What the hook will NOT do is invent an
 * item_count or a photograph — a category with no catalogue behind it
 * renders as a name and a glyph, which is true.
 *
 * item_count is deliberately not fetched yet. The honest number is
 * "products in this category that at least one approved shop has
 * available", which needs products and shop_listings to have rows in
 * them; counting bare product rows would tell a buyer there are ten
 * things to buy when no shop stocks any of them.
 */
export function useCategories(): UseCategories {
  const [categories, setCategories] = useState<Category[]>(MOCK_CATEGORIES as Category[]);
  const [source, setSource] = useState<CategorySource>('builtin');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const runId = useRef(0);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const load = useCallback(async () => {
    const run = ++runId.current;
    const current = () => alive.current && runId.current === run;

    setLoading(true);
    setError(null);
    try {
      const { data, error: queryError } = await withTimeout(
        supabase
          .from('categories')
          .select(COLUMNS)
          .order('display_order', { ascending: true })
          .order('name', { ascending: true }),
        8000,
        'Loading categories'
      );
      if (!current()) return;

      // 42P01 = undefined_table, PGRST205 = not in PostgREST's schema
      // cache. Both mean the catalogue migration has not been run here.
      // That is a deployment state, not a fault, so it is not surfaced
      // as an error — the built-in list stands in and `source` says so.
      if (queryError?.code === '42P01' || queryError?.code === 'PGRST205') {
        setCategories(MOCK_CATEGORIES as Category[]);
        setSource('builtin');
        return;
      }
      if (queryError) throw queryError;

      const rows = (data ?? []) as Category[];
      // An empty table means the seed did not run. Showing nothing would
      // strip the tiles off the hub for no reason a buyer can act on.
      if (rows.length === 0) {
        setCategories(MOCK_CATEGORIES as Category[]);
        setSource('builtin');
        return;
      }

      // The tint and glyph are presentation, not catalogue data, and the
      // table has no column for either. Matched by slug so a seeded row
      // keeps the look it already has; anything new gets the default.
      const decoration = new Map(
        (MOCK_CATEGORIES as Category[]).map((c) => [c.slug, c])
      );
      setCategories(
        rows.map((row) => ({
          ...row,
          accent: decoration.get(row.slug)?.accent,
          icon: decoration.get(row.slug)?.icon,
        }))
      );
      setSource('database');
    } catch (e) {
      if (!current()) return;
      setError(e as Error);
      // Keep whatever is on screen. A failed refresh should not empty a
      // row of tiles the person was about to tap.
    } finally {
      // Unconditional, and guarded so a superseded run cannot switch the
      // spinner off under a newer one.
      if (current()) setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return { categories, source, loading, error, refresh: load };
}
