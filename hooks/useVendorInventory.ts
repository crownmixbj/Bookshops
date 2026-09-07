import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '../utils/supabase';
import { getSessionUserId, withTimeout } from '../lib/loadState';
import type { Category } from '../types/catalog';

export interface InventoryListing {
  id: string;
  productId: string;
  title: string;
  author: string | null;
  publisher: string | null;
  categoryId: string | null;
  categoryName: string | null;
  price: number;
  stockQuantity: number;
  isAvailable: boolean;
}

/** What the add/edit form hands back. */
export interface ListingDraft {
  /** Set when editing an existing listing. */
  listingId?: string;
  /** Set when the vendor picked a product that already exists. */
  productId?: string;
  categoryId: string | null;
  title: string;
  author: string;
  publisher: string;
  price: number;
  stockQuantity: number;
  isAvailable: boolean;
}

export interface ProductMatch {
  id: string;
  title: string;
  author: string | null;
  publisher: string | null;
  categoryId: string | null;
}

export interface UseVendorInventory {
  listings: InventoryListing[];
  categories: Category[];
  /** The signed-in user's vendor row, once resolved. */
  vendorId: string | null;
  loading: boolean;
  error: Error | null;
  refresh: () => void;
  /** Flip is_available without opening the form. */
  setAvailability: (listingId: string, next: boolean) => Promise<void>;
  /** Create or update a listing, creating the product first if needed. */
  saveListing: (draft: ListingDraft) => Promise<void>;
  /** Titles already in the catalogue, so two shops share one product row. */
  searchProducts: (term: string) => Promise<ProductMatch[]>;
}

/**
 * A shop's own catalogue listings.
 *
 * Reads through the embeds rather than three round trips: RLS already
 * scopes shop_listings to this vendor, and products/categories are
 * publicly readable, so one select is both correct and cheap.
 */
export function useVendorInventory(): UseVendorInventory {
  const [listings, setListings] = useState<InventoryListing[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [vendorId, setVendorId] = useState<string | null>(null);
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
      const uid = await getSessionUserId();
      if (!current()) return;
      if (!uid) {
        setVendorId(null);
        setListings([]);
        return;
      }

      // vendors.profile_id -> auth.uid(). The listings policy keys off
      // the vendor row, so nothing can be read or written without it.
      const { data: vendorRow, error: vendorError } = await withTimeout(
        supabase.from('vendors').select('id').eq('profile_id', uid).maybeSingle(),
        8000,
        'Finding your shop'
      );
      if (!current()) return;
      if (vendorError) throw vendorError;
      if (!vendorRow) {
        setVendorId(null);
        setListings([]);
        return;
      }
      const vid = vendorRow.id as string;
      setVendorId(vid);

      const [listingsRes, categoriesRes] = await Promise.all([
        withTimeout(
          supabase
            .from('shop_listings')
            .select(
              'id, price, stock_quantity, is_available, products ( id, title, author, publisher, category_id, categories ( id, name ) )'
            )
            .eq('shop_id', vid)
            .order('created_at', { ascending: false }),
          8000,
          'Loading your inventory'
        ),
        withTimeout(
          supabase
            .from('categories')
            .select('id, name, slug, description, image_url, display_order')
            .order('display_order', { ascending: true }),
          8000,
          'Loading categories'
        ),
      ]);
      if (!current()) return;
      if (listingsRes.error) throw listingsRes.error;
      if (categoriesRes.error) throw categoriesRes.error;

      setCategories((categoriesRes.data ?? []) as Category[]);
      setListings(
        ((listingsRes.data ?? []) as Array<Record<string, any>>)
          // A listing whose product vanished has nothing to show. The FK
          // cascades, so this is belt and braces rather than expected.
          .filter((row) => row.products)
          .map((row) => ({
            id: row.id as string,
            productId: row.products.id as string,
            title: row.products.title as string,
            author: (row.products.author as string | null) ?? null,
            publisher: (row.products.publisher as string | null) ?? null,
            categoryId: (row.products.category_id as string | null) ?? null,
            categoryName: (row.products.categories?.name as string | null) ?? null,
            price: Number(row.price) || 0,
            stockQuantity: Number(row.stock_quantity) || 0,
            isAvailable: row.is_available !== false,
          }))
      );
    } catch (e) {
      if (!current()) return;
      setError(e as Error);
    } finally {
      // Unconditional, and guarded so a superseded run cannot switch the
      // spinner off under a newer one.
      if (current()) setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const setAvailability = useCallback(
    async (listingId: string, next: boolean) => {
      // Optimistic: the row belongs to this shop and the policy cannot
      // refuse it, so the switch moves before the round trip. Rolled
      // back below if the write is refused anyway.
      const previous = listings;
      setListings((rows) =>
        rows.map((r) => (r.id === listingId ? { ...r, isAvailable: next } : r))
      );
      const { error: writeError } = await supabase
        .from('shop_listings')
        .update({ is_available: next })
        .eq('id', listingId);
      if (writeError) {
        setListings(previous);
        throw writeError;
      }
    },
    [listings]
  );

  const searchProducts = useCallback(async (term: string): Promise<ProductMatch[]> => {
    const q = term.trim();
    if (q.length < 3) return [];
    const { data, error: searchError } = await supabase
      .from('products')
      .select('id, title, author, publisher, category_id')
      .ilike('title', `%${q}%`)
      .limit(8);
    if (searchError) return [];
    return ((data ?? []) as Array<Record<string, any>>).map((p) => ({
      id: p.id as string,
      title: p.title as string,
      author: (p.author as string | null) ?? null,
      publisher: (p.publisher as string | null) ?? null,
      categoryId: (p.category_id as string | null) ?? null,
    }));
  }, []);

  const saveListing = useCallback(
    async (draft: ListingDraft) => {
      if (!vendorId) throw new Error('Your shop could not be identified. Sign in again.');

      let productId = draft.productId;

      if (!productId) {
        // A new catalogue entry. products is shared across shops, so an
        // exact-title match is reused rather than duplicated — six
        // spellings of one textbook is what makes a catalogue useless.
        const { data: existing } = await supabase
          .from('products')
          .select('id')
          .ilike('title', draft.title.trim())
          .limit(1);

        if (existing?.length) {
          productId = existing[0].id as string;
        } else {
          const { data: created, error: productError } = await supabase
            .from('products')
            .insert({
              title: draft.title.trim(),
              author: draft.author.trim() || null,
              publisher: draft.publisher.trim() || null,
              category_id: draft.categoryId,
            })
            // .single() makes "no row came back" an error rather than a
            // null we would carry forward as a product id.
            .select('id')
            .single();

          if (productError) {
            // 42501 is the RLS refusal. Until vendors are granted INSERT
            // on products only an admin can add a catalogue entry, and
            // "new row violates row-level security policy" tells a
            // bookshop owner nothing about what to do next.
            if ((productError as { code?: string }).code === '42501') {
              throw new Error(
                'Your shop cannot add new catalogue entries yet. Search for the book above and list that, or ask an admin to add it.'
              );
            }
            throw productError;
          }
          productId = created.id as string;
        }
      }

      const row = {
        shop_id: vendorId,
        product_id: productId,
        price: draft.price,
        stock_quantity: draft.stockQuantity,
        is_available: draft.isAvailable,
      };

      // Keyed on (shop_id, product_id), which is unique — so re-listing
      // a product a shop already stocks updates the price rather than
      // failing on the constraint.
      //
      // `.select()` is not decoration. Without it PostgREST answers a
      // write with 201 and an empty body, and this code read a null
      // error as "saved" — so a write that touched no row at all closed
      // the form and reported success. Asking for the row back means the
      // only thing that counts as saved is a row coming back.
      const { data: written, error: listingError } = await supabase
        .from('shop_listings')
        .upsert(row, { onConflict: 'shop_id,product_id' })
        .select('id');
      if (listingError) throw listingError;
      if (!written?.length) {
        throw new Error(
          'The listing was not saved — the database accepted the request but stored no row. This is usually a permissions rule refusing the write silently.'
        );
      }

      await load();
    },
    [vendorId, load]
  );

  return {
    listings,
    categories,
    vendorId,
    loading,
    error,
    refresh: load,
    setAvailability,
    saveListing,
    searchProducts,
  };
}
