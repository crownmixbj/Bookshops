import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '../utils/supabase';
import { withTimeout } from '../lib/loadState';
import type { Category } from '../types/catalog';

/** Total stock at or below this reads as "Low Stock" rather than "In Stock". */
export const LOW_STOCK_THRESHOLD = 5;

export interface CatalogProduct {
  id: string;
  title: string;
  author: string | null;
  publisher: string | null;
  image_url: string | null;
  /** Cheapest available listing. Null when no shop has it. */
  min_price: number | null;
  /** True when more than one shop lists it, so the price reads "From ₦x". */
  multipleOffers: boolean;
  /** Copies across every available listing. */
  total_stock: number;
  /** Distinct shops with it available. */
  vendor_count: number;
}

export interface UseCategoryCatalog {
  category: Category | null;
  products: CatalogProduct[];
  loading: boolean;
  /** True when the slug matched no row — a 404, not an empty shelf. */
  notFound: boolean;
  error: Error | null;
  refresh: () => void;
}

/**
 * One category and everything a buyer can actually buy in it.
 *
 * Three reads rather than one deep embed, because the aggregate the page
 * wants — cheapest price, total stock, how many shops — is not something
 * PostgREST will compute across a nested relation. Doing it here also
 * keeps the filtering honest: `shop_listings_select_public` already
 * restricts rows to available listings from active, approved shops, so a
 * plain select returns exactly the listings a buyer is allowed to act
 * on. There is no client-side filter that could drift from the policy.
 *
 * A product with no available listing is dropped, not shown at zero. A
 * catalogue entry nobody stocks is not something you can buy, and
 * listing it with no price is how a parent drives to a shop for a book
 * that is not there.
 */
export function useCategoryCatalog(slug: string | null): UseCategoryCatalog {
  const [category, setCategory] = useState<Category | null>(null);
  const [products, setProducts] = useState<CatalogProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
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
    setNotFound(false);

    try {
      if (!slug) {
        setNotFound(true);
        return;
      }

      const { data: categoryRow, error: categoryError } = await withTimeout(
        supabase
          .from('categories')
          .select('id, name, slug, description, image_url, display_order')
          .eq('slug', slug)
          .maybeSingle(),
        8000,
        'Loading this category'
      );
      if (!current()) return;
      if (categoryError) throw categoryError;
      if (!categoryRow) {
        setCategory(null);
        setProducts([]);
        setNotFound(true);
        return;
      }
      setCategory(categoryRow as Category);

      const { data: productRows, error: productsError } = await withTimeout(
        supabase
          .from('products')
          .select('id, title, author, publisher, image_url')
          .eq('category_id', (categoryRow as Category).id)
          .order('title', { ascending: true }),
        8000,
        'Loading the products'
      );
      if (!current()) return;
      if (productsError) throw productsError;

      const rows = productRows ?? [];
      if (rows.length === 0) {
        setProducts([]);
        return;
      }

      // RLS does the filtering: this returns only available listings
      // from shops that are active and approved.
      const { data: listingRows, error: listingsError } = await withTimeout(
        supabase
          .from('shop_listings')
          .select('product_id, shop_id, price, stock_quantity')
          .in(
            'product_id',
            rows.map((p) => p.id)
          ),
        8000,
        'Loading shop prices'
      );
      if (!current()) return;
      if (listingsError) throw listingsError;

      const byProduct = new Map<
        string,
        { min: number | null; stock: number; shops: Set<string>; offers: number }
      >();
      for (const listing of listingRows ?? []) {
        const key = listing.product_id as string;
        const entry =
          byProduct.get(key) ?? { min: null, stock: 0, shops: new Set<string>(), offers: 0 };
        const price = Number(listing.price);
        if (Number.isFinite(price) && (entry.min === null || price < entry.min)) entry.min = price;
        entry.stock += Number(listing.stock_quantity) || 0;
        entry.shops.add(listing.shop_id as string);
        entry.offers += 1;
        byProduct.set(key, entry);
      }

      setProducts(
        rows
          .map((product): CatalogProduct | null => {
            const agg = byProduct.get(product.id);
            if (!agg || agg.min === null) return null;
            return {
              id: product.id as string,
              title: product.title as string,
              author: (product.author as string | null) ?? null,
              publisher: (product.publisher as string | null) ?? null,
              image_url: (product.image_url as string | null) ?? null,
              min_price: agg.min,
              multipleOffers: agg.offers > 1,
              total_stock: agg.stock,
              vendor_count: agg.shops.size,
            };
          })
          .filter((p): p is CatalogProduct => p !== null)
      );
    } catch (e) {
      if (!current()) return;
      setError(e as Error);
    } finally {
      // Unconditional, and guarded so a superseded run cannot switch the
      // spinner off under a newer one.
      if (current()) setLoading(false);
    }
  }, [slug]);

  useEffect(() => {
    load();
  }, [load]);

  return { category, products, loading, notFound, error, refresh: load };
}
