import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '../utils/supabase';
import type {
  Booklist,
  BooklistBucket,
  BooklistItemGroup,
  BookRequest,
  BookRequestItem,
  ItemCategory,
  Order,
  PricedBooklistItem,
  Quote,
  QuoteItem,
} from '../types/db';
import { getSessionUserId, subscribeToAuthReloads } from '../lib/loadState';
import {
  hasQuotedLines,
  pickPricingQuote,
  priceBooklistItems,
  sumLineTotals,
  totalsAgree,
} from '../lib/booklistPricing';

/**
 * Loads every booklist belonging to the signed-in buyer, with its items,
 * quotes and order, and sorts them into the page's three sections.
 *
 * Security: every query filters on the authenticated user's id, and RLS
 * enforces the same thing server-side — `requests_select_visible` scopes
 * book_requests, `items_select_via_request` scopes the line items, and
 * `orders_select_own` scopes orders. The client filter is for efficiency;
 * the policy is what actually protects the data.
 */

export const CATEGORY_ORDER: ItemCategory[] = ['textbook', 'stationery', 'uniform', 'other'];

export const CATEGORY_LABEL: Record<ItemCategory, string> = {
  textbook: 'Textbooks',
  stationery: 'Stationery',
  uniform: 'Uniforms',
  other: 'Other items',
};

interface RawState {
  requests: BookRequest[];
  items: BookRequestItem[];
  quotes: Quote[];
  /** Vendor line prices for every quote above. This is where money lives. */
  quoteItems: QuoteItem[];
  orders: Order[];
}

const EMPTY: RawState = { requests: [], items: [], quotes: [], quoteItems: [], orders: [] };

/**
 * Which section a request belongs in.
 *   archived  finished, abandoned, or now an order — nothing to do here
 *   draft     still being edited, or published with no quote back yet
 *   active    quoted — awaiting a decision from the buyer
 */
function bucketFor(request: BookRequest, quotes: Quote[], order: Order | null): BooklistBucket {
  if (request.status === 'cancelled') return 'archived';
  // Explicit rather than falling through to the no-live-quotes branch
  // below: a draft has no quotes by construction, and saying so here is
  // what makes "Drafts & pending" mean something.
  if (request.status === 'draft') return 'draft';

  // Ordered lists leave Active whatever stage the delivery is at.
  //
  // "Active" on this page means a booklist still needing a decision from
  // the buyer, and an ordered one does not: it has been paid for, and My
  // Orders is the screen that tracks what happens next. Keeping it here
  // put the same purchase in two places, one of which could do nothing
  // with it. It moves to Archived rather than disappearing, so the list
  // itself is still readable from the page that owns booklists.
  if (request.status === 'ordered' || order) return 'archived';

  const liveQuotes = quotes.filter((q) => q.status === 'sent' || q.status === 'accepted');
  return liveQuotes.length > 0 ? 'active' : 'draft';
}

function groupItems(items: PricedBooklistItem[]): BooklistItemGroup[] {
  return CATEGORY_ORDER.map((category) => {
    const inGroup = items.filter((i) => i.category === category);
    return {
      category,
      items: inGroup,
      subtotal: sumLineTotals(inGroup),
      // Out-of-stock lines are answered, not pending, so they are not
      // counted as awaiting a price.
      unpricedCount: inGroup.filter((i) => i.isAvailable && i.lineTotal == null).length,
    };
  }).filter((g) => g.items.length > 0);
}

/**
 * How a load announces itself.
 *   initial     first paint — skeletons are correct here
 *   refresh     pull-to-refresh — the platform spinner, no skeletons
 *   background  a revalidate after a write — nothing moves, the rows
 *               just change underneath. This is what a newly created
 *               booklist triggers, so the cards already on screen are
 *               never thrown back to a skeleton for a list they are
 *               still perfectly able to show.
 */
export type LoadMode = 'initial' | 'refresh' | 'background';

export function useBooklists() {
  const [raw, setRaw] = useState<RawState>(EMPTY);
  const [userId, setUserId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  /**
   * Which load is the current one.
   *
   * Loads overlap — a pull-to-refresh lands on top of a post-create
   * revalidate, an auth event lands on top of both. Without this, a slow
   * earlier run could finish last and both clobber the newer data and
   * flip the spinners for a request nobody is waiting on any more.
   */
  const runId = useRef(0);
  /** Set on unmount so a load in flight stops touching state. */
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const load = useCallback(async ({ mode = 'initial' as LoadMode } = {}) => {
    const run = ++runId.current;
    const current = () => alive.current && runId.current === run;

    if (mode === 'refresh') setRefreshing(true);
    else if (mode === 'initial') setLoading(true);
    setError(null);

    try {
      const uid = await getSessionUserId();
      if (!current()) return;
      if (!uid) {
        setUserId(null);
        setRaw(EMPTY);
        return;
      }
      setUserId(uid);
      const user = { id: uid };

      // target_vendor is an embed on book_requests_target_vendor_id_fkey.
      // Without it the card knew only an opaque uuid, so a list sent to
      // one shop could not name the shop it was sent to.
      const REQUEST_COLUMNS =
        'id, buyer_id, school_name, class_level, image_url, image_path, target_vendor_id, dispatch_type, status, created_at, updated_at, target_vendor:vendors!book_requests_target_vendor_id_fkey ( id, store_name, city, is_active )';

      const readRequests = (columns: string) =>
        supabase
          .from('book_requests')
          .select(columns)
          .eq('buyer_id', user.id)
          .order('created_at', { ascending: false });

      let { data: requestRows, error: requestsError } = await readRequests(REQUEST_COLUMNS);

      // 42703 = undefined_column, PGRST204 = not in PostgREST's schema
      // cache. Either way bookshops_dispatch_routing.sql has not been
      // run here, and naming dispatch_type fails the WHOLE select — which
      // would blank the page over a badge. Retry without it.
      if (requestsError?.code === '42703' || requestsError?.code === 'PGRST204') {
        ({ data: requestRows, error: requestsError } = await readRequests(
          REQUEST_COLUMNS.replace(', dispatch_type', '')
        ));
      }

      // PGRST200 = PostgREST cannot find the relationship. The FK is
      // there, but its schema cache may not have caught up after DDL.
      // Dropping the embed costs the shop's NAME on the badge; keeping
      // it would cost the entire booklists page.
      if (requestsError?.code === 'PGRST200') {
        ({ data: requestRows, error: requestsError } = await readRequests(
          REQUEST_COLUMNS.slice(0, REQUEST_COLUMNS.indexOf(', target_vendor:'))
        ));
      }
      if (requestsError) throw requestsError;

      // The two selects have different column lists, so their inferred
      // row types differ; BookRequest is the shape both actually satisfy
      // (dispatch_type is optional on it for exactly this reason).
      const requests = (requestRows ?? []) as unknown as BookRequest[];

      const ids = requests.map((r) => r.id);
      if (ids.length === 0) {
        setRaw({ ...EMPTY, requests: [] });
        return;
      }

      // `author` is what tells a shop which edition to quote, and it was
      // simply not being selected — the column exists and the forms
      // require it, but every card showed a bare title. Named here, with
      // the same retry the rest of this file uses for a column a project
      // may not have migrated yet.
      const ITEM_COLUMNS =
        'id, request_id, title, author, category, quantity, unit_price, parsed, position, created_at, updated_at';

      // Three scoped reads rather than one deep embed: a failure in any
      // one of them then names the table it came from.
      const [itemsRes, quotesRes, ordersRes] = await Promise.all([
        supabase
          .from('book_request_items')
          .select(ITEM_COLUMNS)
          .in('request_id', ids)
          .order('position', { ascending: true }),
        supabase
          .from('quotes')
          .select('id, request_id, vendor_id, total_price, item_breakdown, status, created_at, updated_at, vendors ( id, store_name, city, is_active )')
          .in('request_id', ids)
          .order('total_price', { ascending: true }),
        supabase
          .from('orders')
          .select('id, quote_id, buyer_id, payment_status, fulfillment_status, created_at, updated_at')
          .eq('buyer_id', user.id),
      ]);

      // 42703 / PGRST204: bookshops_booklist_author.sql has not been run
      // on this project. Naming `author` fails the WHOLE select, which
      // would empty every card over one optional field — so retry
      // without it rather than lose the lines.
      // Typed as unknown because the two selects have different column
      // lists and so different inferred row types; BookRequestItem is the
      // shape both actually satisfy (author is optional on it for exactly
      // this reason).
      let itemRows: unknown = itemsRes.data;
      if (itemsRes.error?.code === '42703' || itemsRes.error?.code === 'PGRST204') {
        const retry = await supabase
          .from('book_request_items')
          .select(ITEM_COLUMNS.replace(', author', ''))
          .in('request_id', ids)
          .order('position', { ascending: true });
        if (retry.error) throw retry.error;
        itemRows = retry.data;
      } else if (itemsRes.error) {
        throw itemsRes.error;
      }
      if (quotesRes.error) throw quotesRes.error;
      if (ordersRes.error) throw ordersRes.error;

      const quotes = (quotesRes.data ?? []) as unknown as Quote[];

      // Fourth read, and the one this page was missing: the per-line
      // prices. It has to follow the quotes because it is keyed by their
      // ids. quote_items_select_buyer_sent scopes it server-side to
      // non-draft quotes on this buyer's own requests.
      let quoteItems: QuoteItem[] = [];
      const quoteIds = quotes.map((q) => q.id);
      if (quoteIds.length > 0) {
        const quoteItemsRes = await supabase
          .from('quote_items')
          .select('id, quote_id, request_item_id, title, quantity, unit_price, is_available, position, created_at, updated_at')
          .in('quote_id', quoteIds)
          .order('position', { ascending: true });
        if (quoteItemsRes.error) throw quoteItemsRes.error;
        quoteItems = (quoteItemsRes.data ?? []) as QuoteItem[];
      }

      setRaw({
        requests,
        items: (itemRows ?? []) as BookRequestItem[],
        quotes,
        quoteItems,
        orders: (ordersRes.data ?? []) as Order[],
      });
    } catch (e) {
      if (!current()) return;
      setError(e as Error);
      // A background revalidate that fails must not wipe the rows the
      // buyer is already reading. Keep them and surface the error.
      if (mode !== 'background') setRaw(EMPTY);
    } finally {
      // Unconditional, and guarded so only the newest run may clear the
      // flags: an older run finishing late must not switch a spinner off
      // under a newer one, nor leave one on after this run is done.
      if (current()) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, []);

  useEffect(() => {
    load({ mode: 'initial' });
    return subscribeToAuthReloads(() => load({ mode: 'background' }));
  }, [load]);

  const booklists: Booklist[] = useMemo(() => {
    const { requests, items, quotes, quoteItems, orders } = raw;

    return requests.map((request) => {
      const rawItems = items
        .filter((i) => i.request_id === request.id)
        .sort((a, b) => a.position - b.position);
      const myQuotes = quotes.filter((q) => q.request_id === request.id);
      const quoteIds = new Set(myQuotes.map((q) => q.id));
      const order = orders.find((o) => quoteIds.has(o.quote_id)) ?? null;

      // One quote prices the lines, and it is the same one the header
      // figure comes from. Reading the total off quote A while pricing
      // the lines from quote B is how a card ends up not adding up.
      const pricingQuote = pickPricingQuote(myQuotes);
      const myItems = priceBooklistItems(rawItems, quoteItems, pricingQuote?.id ?? null);
      const linesTotal = sumLineTotals(myItems);
      const quotedLines = hasQuotedLines(myItems);

      let estimatedTotal = 0;
      let totalSource: Booklist['totalSource'] = 'none';
      let totalMatchesLines = true;

      if (pricingQuote) {
        const quoteTotal = Number(pricingQuote.total_price) || 0;
        // Prefer the sum of the lines on screen. refresh_quote_total()
        // keeps quotes.total_price equal to exactly this sum, so the two
        // normally agree — and when they do not, the number the buyer
        // can check line by line is the one to show.
        estimatedTotal = quotedLines ? linesTotal : quoteTotal;
        totalMatchesLines = !quotedLines || totalsAgree(linesTotal, quoteTotal);
        totalSource = order && pricingQuote.status === 'accepted' ? 'order' : 'quote';
      } else if (linesTotal > 0) {
        estimatedTotal = linesTotal;
        totalSource = 'items';
      }

      return {
        ...request,
        items: myItems,
        groups: groupItems(myItems),
        quotes: myQuotes,
        order,
        bucket: bucketFor(request, myQuotes, order),
        itemCount: myItems.reduce((n, i) => n + i.quantity, 0),
        lineCount: myItems.length,
        estimatedTotal,
        totalSource,
        hasUnpricedItems: myItems.some((i) => i.isAvailable && i.lineTotal == null),
        unavailableCount: myItems.filter((i) => !i.isAvailable).length,
        totalMatchesLines,
      };
    });
  }, [raw]);

  const sections = useMemo(
    () => ({
      active: booklists.filter((b) => b.bucket === 'active'),
      draft: booklists.filter((b) => b.bucket === 'draft'),
      archived: booklists.filter((b) => b.bucket === 'archived'),
    }),
    [booklists]
  );

  return {
    userId,
    booklists,
    sections,
    loading,
    refreshing,
    error,
    /** Pull-to-refresh: platform spinner, rows stay put. */
    refresh: () => load({ mode: 'refresh' }),
    /**
     * Re-read after a write. Nothing on screen goes back to a skeleton —
     * the rows are replaced in place once the new data lands.
     */
    revalidate: () => load({ mode: 'background' }),
    /** Full reload with skeletons. For a retry after a hard failure. */
    reload: () => load({ mode: 'initial' }),
  };
}
