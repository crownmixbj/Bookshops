import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../utils/supabase';
import { pickPricingQuote, priceBooklistItems } from '../lib/booklistPricing';
import { parseResponseFiles } from '../lib/quoteFiles';
import { compareForBuyer } from '../lib/quoteNavigation';
import type { PricedLineFields, Quote, QuoteItem } from '../types/db';

/**
 * The three detail screens opened from the Booklist Hub, behind one
 * hook each. They share a shape — loading / error / data / refresh —
 * so the screens all read the same way.
 *
 * Every query is scoped by RLS to the signed-in person: `vendors` is
 * readable only while active, `book_requests` only for its buyer (or
 * the vendors quoting on it), `quotes` only for the two sides of the
 * quote. None of these hooks widen that; they ask for a single row by
 * id and let the policy decide whether it comes back.
 */

export interface ShopDetail {
  id: string;
  store_name: string;
  city: string | null;
  address: string | null;
  phone: string | null;
  rating: number | null;
  review_count: number;
  completed_orders: number;
  verified_at: string | null;
  busy_mode: boolean;
  busy_note: string | null;
  featured: boolean;
}

export interface ShopReview {
  id: string;
  rating: number;
  comment: string | null;
  created_at: string;
}

export function useShopDetail(vendorId: string | null) {
  const [shop, setShop] = useState<ShopDetail | null>(null);
  const [reviews, setReviews] = useState<ShopReview[]>([]);
  const [saved, setSaved] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!vendorId) {
      setError('No shop was named in the link.');
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);

    const { data: { user } } = await supabase.auth.getUser();

    const [shopRes, reviewRes, savedRes] = await Promise.all([
      supabase
        .from('vendors')
        .select(
          'id, store_name, city, address, phone, rating, review_count, completed_orders, verified_at, busy_mode, busy_note, featured'
        )
        .eq('id', vendorId)
        .maybeSingle(),
      supabase
        .from('vendor_reviews')
        .select('id, rating, comment, created_at')
        .eq('vendor_id', vendorId)
        .order('created_at', { ascending: false })
        .limit(10),
      user
        ? supabase
            .from('saved_shops')
            .select('vendor_id')
            .eq('profile_id', user.id)
            .eq('vendor_id', vendorId)
            .maybeSingle()
        : Promise.resolve({ data: null, error: null } as const),
    ]);

    if (shopRes.error) {
      setError(shopRes.error.message);
      setLoading(false);
      return;
    }
    if (!shopRes.data) {
      // Either it does not exist or `vendors_select_active` hid it.
      // Both look the same from here, and saying which would leak
      // whether a suspended shop exists.
      setError('That shop is not available.');
      setLoading(false);
      return;
    }

    setShop(shopRes.data as ShopDetail);
    setReviews(reviewRes.error ? [] : ((reviewRes.data ?? []) as ShopReview[]));
    setSaved(!!savedRes.data);
    setLoading(false);

    // Browsing history. Best effort: a failure here must not take the
    // page down, and the person did not ask for it.
    if (user) {
      supabase
        .from('recently_viewed_shops')
        .upsert(
          { profile_id: user.id, vendor_id: vendorId, viewed_at: new Date().toISOString() },
          { onConflict: 'profile_id,vendor_id' }
        )
        .then(undefined, () => {});
    }
  }, [vendorId]);

  useEffect(() => {
    load().catch((e) => {
      setError(e instanceof Error ? e.message : String(e));
      setLoading(false);
    });
  }, [load]);

  const toggleSaved = useCallback(async () => {
    if (!vendorId) return;
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    // Optimistic: the row is the person's own and the policy cannot
    // refuse it, so the flip is safe to show before the round trip.
    const next = !saved;
    setSaved(next);
    const { error: writeError } = next
      ? await supabase.from('saved_shops').insert({ profile_id: user.id, vendor_id: vendorId })
      : await supabase.from('saved_shops').delete().eq('profile_id', user.id).eq('vendor_id', vendorId);
    if (writeError) setSaved(!next);
  }, [vendorId, saved]);

  return { shop, reviews, saved, loading, error, refresh: load, toggleSaved };
}

interface BooklistItemRow {
  id: string;
  title: string;
  category: string;
  quantity: number;
  /** The request row's own price. Almost always null — see lib/booklistPricing. */
  unit_price: number | null;
  parsed: boolean;
  position: number;
}

/** A line with the pricing quote's numbers resolved onto it. */
export type BooklistItem = BooklistItemRow & PricedLineFields;

export interface BooklistQuote {
  id: string;
  vendor_id: string;
  total_price: number;
  status: string;
  created_at: string;
  /** 'itemised' or 'lump_sum'. A lump-sum quote's breakdown is an attachment. */
  pricing_mode: string | null;
  vendor_note: string | null;
  /** quotes.response_files, unparsed. Use parseResponseFiles() on it. */
  response_files: unknown;
  vendors: { id: string; store_name: string; city: string | null } | null;
}

/**
 * A quote with the few figures a buyer needs to compare it against the
 * one below it, resolved here rather than on the screen.
 *
 * The point of these three numbers: a total on its own is not
 * comparable. A shop that is ₦2,000 cheaper because it cannot get two
 * of the titles is more expensive, and the only way the buyer can see
 * that before opening each quote in turn is if the list says so.
 */
export interface ComparableQuote extends BooklistQuote {
  /** Lines this shop priced and can supply. */
  availableCount: number;
  /** Lines it kept on the quote but marked out of stock. */
  unavailableCount: number;
  /** Pages the shop attached — a photographed or scanned priced sheet. */
  fileCount: number;
  /** Still open: the buyer can accept or decline it. */
  isLive: boolean;
}

export function useBooklistDetail(requestId: string | null) {
  const [request, setRequest] = useState<any>(null);
  const [items, setItems] = useState<BooklistItem[]>([]);
  const [quotes, setQuotes] = useState<ComparableQuote[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!requestId) {
      setError('No booklist was named in the link.');
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);

    const { data, error: reqError } = await supabase
      .from('book_requests')
      .select('id, school_name, class_level, status, created_at, image_url')
      .eq('id', requestId)
      .maybeSingle();

    if (reqError) {
      setError(reqError.message);
      setLoading(false);
      return;
    }
    if (!data) {
      setError('That booklist is not available.');
      setLoading(false);
      return;
    }
    setRequest(data);

    const [itemRes, quoteRes] = await Promise.all([
      supabase
        .from('book_request_items')
        .select('id, title, category, quantity, unit_price, parsed, position')
        .eq('request_id', requestId)
        .order('position', { ascending: true }),
      supabase
        .from('quotes')
        .select(
          'id, vendor_id, total_price, status, created_at, pricing_mode, vendor_note, ' +
            'response_files, vendors ( id, store_name, city )'
        )
        .eq('request_id', requestId)
        .order('total_price', { ascending: true }),
    ]);

    // Drafts are the vendor's private working copy — a buyer must not
    // see a price that has not been sent to them.
    const visibleQuotes = quoteRes.error
      ? []
      : ((quoteRes.data ?? []) as unknown as BooklistQuote[]).filter((q) => q.status !== 'draft');

    const rows = itemRes.error ? [] : ((itemRes.data ?? []) as BooklistItemRow[]);

    /*
     * Coverage per quote, for the comparison list.
     *
     * One query for every quote on the request rather than one each: a
     * booklist with five quotes would otherwise be five round trips on
     * a phone, to draw a line of small grey text. Only quote_id and
     * is_available are selected because that is all the counting needs;
     * the prices are read per quote on the quote screen.
     */
    const counts = new Map<string, { available: number; unavailable: number }>();
    if (visibleQuotes.length) {
      const { data: coverage } = await supabase
        .from('quote_items')
        .select('quote_id, is_available')
        .in('quote_id', visibleQuotes.map((q) => q.id));
      for (const row of (coverage ?? []) as { quote_id: string; is_available: boolean }[]) {
        const c = counts.get(row.quote_id) ?? { available: 0, unavailable: 0 };
        if (row.is_available) c.available += 1;
        else c.unavailable += 1;
        counts.set(row.quote_id, c);
      }
    }

    const comparable: ComparableQuote[] = visibleQuotes
      .map((q) => {
        const c = counts.get(q.id) ?? { available: 0, unavailable: 0 };
        return {
          ...q,
          availableCount: c.available,
          unavailableCount: c.unavailable,
          fileCount: parseResponseFiles(q.response_files).length,
          isLive: q.status === 'sent',
        };
      })
      // Live offers first, cheapest first within them. A declined quote
      // must not sit above one the buyer can still accept, however
      // little it cost.
      .sort(compareForBuyer);

    setQuotes(comparable);

    // Line prices live on quote_items, not on the request rows. Without
    // this read every line here showed a dash while the quotes below it
    // carried real money.
    const pricing = pickPricingQuote(visibleQuotes as unknown as Quote[]);
    let quoteItems: QuoteItem[] = [];
    if (pricing) {
      const { data: qiData } = await supabase
        .from('quote_items')
        .select('id, quote_id, request_item_id, title, quantity, unit_price, is_available, position, created_at, updated_at')
        .eq('quote_id', pricing.id)
        .order('position', { ascending: true });
      quoteItems = (qiData ?? []) as QuoteItem[];
    }

    setItems(priceBooklistItems(rows, quoteItems, pricing?.id ?? null));
    setLoading(false);
  }, [requestId]);

  useEffect(() => {
    load().catch((e) => {
      setError(e instanceof Error ? e.message : String(e));
      setLoading(false);
    });
  }, [load]);

  return { request, items, quotes, loading, error, refresh: load };
}

export interface QuoteLine {
  id: string;
  title: string;
  quantity: number;
  unit_price: number | null;
  is_available: boolean;
  position: number;
}

export function useQuoteDetail(quoteId: string | null) {
  const [quote, setQuote] = useState<any>(null);
  const [lines, setLines] = useState<QuoteLine[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!quoteId) {
      setError('No quote was named in the link.');
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);

    const { data, error: qError } = await supabase
      .from('quotes')
      .select(
        'id, request_id, vendor_id, total_price, status, created_at, item_breakdown, ' +
          'pricing_mode, vendor_note, response_files, decline_reason, ' +
          'vendors ( id, store_name, city, rating, review_count ), ' +
          'book_requests ( id, school_name, class_level )'
      )
      .eq('id', quoteId)
      .maybeSingle();

    if (qError) {
      setError(qError.message);
      setLoading(false);
      return;
    }
    if (!data) {
      setError('That quote is not available.');
      setLoading(false);
      return;
    }
    // Two nested relations in one select make supabase-js widen the row
    // type to a union with its error shape, so the fields below are not
    // visible on it. The runtime shape is checked above.
    const row = data as any;
    setQuote(row);

    const { data: lineData, error: lineError } = await supabase
      .from('quote_items')
      .select('id, title, quantity, unit_price, is_available, position')
      .eq('quote_id', quoteId)
      .order('position', { ascending: true });

    // Older quotes predate quote_items and carry their lines in the
    // item_breakdown jsonb instead. Fall back to it rather than showing
    // a total with nothing under it.
    if (!lineError && lineData?.length) {
      setLines(lineData as QuoteLine[]);
    } else {
      const raw = Array.isArray(row.item_breakdown) ? row.item_breakdown : [];
      setLines(
        raw.map((r: any, i: number) => ({
          id: String(r.id ?? i),
          title: String(r.title ?? 'Item'),
          quantity: Number(r.quantity) || 1,
          unit_price: r.unit_price == null ? null : Number(r.unit_price),
          is_available: r.is_available !== false,
          position: i,
        }))
      );
    }
    setLoading(false);
  }, [quoteId]);

  useEffect(() => {
    load().catch((e) => {
      setError(e instanceof Error ? e.message : String(e));
      setLoading(false);
    });
  }, [load]);

  return { quote, lines, loading, error, refresh: load };
}
