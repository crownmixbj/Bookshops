import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '../utils/supabase';
import { DRAFT_STATUS } from '../lib/booklistUpload';
import { pickPricingQuote, priceBooklistItems } from '../lib/booklistPricing';
import { getSessionUserId, subscribeToAuthReloads } from '../lib/loadState';

/**
 * ============================================================
 * READ THIS BEFORE DEBUGGING AN EMPTY DASHBOARD
 * ============================================================
 * The RLS remediation has been applied (verified 2026-08-31): every table
 * has policies, the handle_new_user trigger creates a profile on signup,
 * and the foreign keys are indexed. So empty panels now mean one of:
 *
 *  1. There genuinely are no rows yet — no vendors have registered, no
 *     booklists raised. Expected on a fresh project.
 *  2. PostgREST is serving a stale schema cache after DDL. It reports a
 *     column that exists as "does not exist" (code 42703). Fix with
 *     `notify pgrst, 'reload schema';` — handled defensively below.
 *  3. You are not actually signed in. `auth.users` was empty at the time
 *     of writing, so sign up first.
 *
 * `diagnostics` tells you which one you are hitting; the hook falls back
 * to demo data so the layout is still workable meanwhile.
 */

/**
 * What belongs in "Active Booklist Requests": lists that still need
 * something to happen to them.
 *
 *   pending_quote  out with shops, waiting to be priced
 *   quoted         priced, waiting for the buyer to choose
 *
 * 'ordered' used to be here too. It is not any more: an ordered list has
 * become an order, My Orders is the screen that tracks orders, and
 * carrying it in both places meant one purchase appeared twice — once
 * where a buyer acts on it and once where they can only look at it.
 * Nothing is lost by dropping it: useOrders reads the `orders` table
 * directly, so every ordered list is on that screen already.
 *
 * 'draft' belongs to My Booklists; 'cancelled' is archived, not active.
 */
const PUBLISHED_REQUEST_STATUSES = ['pending_quote', 'quoted'];

/** Statuses that have left this card for the My Orders screen. */
const ORDERED_REQUEST_STATUSES = ['ordered'];

/** The project ref the client is actually pointed at, for error messages. */
const PROJECT_REF =
  (process.env.EXPO_PUBLIC_SUPABASE_URL ?? '').match(/https:\/\/([^.]+)\./)?.[1] ??
  'unknown project';

const EMPTY = {
  profile: null,
  email: null,
  requests: [],
  draftCount: 0,
  orderedCount: 0,
  items: [],
  quotes: [],
  quoteItems: [],
  vendors: [],
  orders: [],
};

/**
 * Turns quotes.item_breakdown (jsonb) into the line-item rows the
 * "Active Booklist Requests" card renders.
 *
 * item_breakdown has no schema constraint today, so we are defensive:
 * we accept an array of objects and read the first plausible key for
 * title and price. Anything unparseable yields null.
 *
 * This is now the SECOND choice, not the first: a request's own
 * book_request_items rows are what the buyer actually saved, so they
 * win. A quote's breakdown is one vendor's reading of that list, and is
 * only used when the buyer's own lines are missing.
 */
function parseItemBreakdown(breakdown) {
  if (!Array.isArray(breakdown) || breakdown.length === 0) return null;

  const rows = breakdown
    .map((raw, i) => {
      if (!raw || typeof raw !== 'object') return null;
      const title = raw.title ?? raw.name ?? raw.book ?? raw.description;
      const price = raw.unit_price ?? raw.price ?? raw.amount ?? raw.cost;
      if (title == null) return null;
      return {
        id: raw.id ?? `bd-${i}`,
        title: String(title),
        unit_price: Number(price) || 0,
        quantity: Number(raw.quantity ?? raw.qty ?? 1) || 1,
        // TODO(db): no inventory model — in_stock is never real.
        in_stock: raw.in_stock ?? true,
        checked: true,
      };
    })
    .filter(Boolean);

  return rows.length ? rows : null;
}

/**
 * book_request_items rows as the "Active Booklist Requests" card renders
 * them, with the pricing quote's money folded in.
 *
 * The prices do NOT come from book_request_items.unit_price. Vendors
 * write to quote_items and never back onto the request rows, so that
 * column is null on every row in practice — reading it and nothing else
 * is why every line in this accordion said "Not priced" while a quote
 * for the same list sat above it. lib/booklistPricing does the match.
 *
 * unit_price stays null rather than becoming 0 where there is no price:
 * ₦0 against a textbook reads as free, not as unpriced. The card checks
 * for null.
 */
function mapRequestItems(rows, quoteItems, pricingQuoteId) {
  return priceBooklistItems(rows, quoteItems, pricingQuoteId).map((row) => ({
    id: row.id,
    title: row.title,
    // Absent entirely on projects that have not run
    // bookshops_booklist_author.sql — hence ?? null, not a bare read.
    author: row.author ?? null,
    /** Per copy. Drives the order total, which multiplies by quantity. */
    unit_price: row.effectiveUnitPrice,
    /** What the shop is actually offering, which may be fewer copies. */
    quantity: row.effectiveQuantity,
    /** Requested copies, kept so the row can flag a short quote. */
    requested_quantity: Number(row.quantity) || 1,
    /** unit_price × quantity, or null when unpriced or out of stock. */
    line_total: row.lineTotal,
    /** False when the pricing vendor marked the line out of stock. */
    is_available: row.isAvailable,
    /** 'quote' | 'request' | 'none' — where the figure came from. */
    price_source: row.priceSource,
    // TODO(db): no inventory model — in_stock is never real.
    in_stock: true,
    checked: true,
  }));
}

/**
 * A shop's real reputation, or the absence of one.
 *
 * vendors.rating and vendors.review_count exist now, and both shops on
 * this project have rating NULL — nobody has reviewed them yet. That is
 * the honest answer and the card renders it as "No ratings yet". It used
 * to be answered from a fixture that painted 4.8 stars and "Fast &
 * Reliable" onto every vendor, which is invented social proof about a
 * real business: a parent choosing a shop on the strength of it is being
 * misled about who they are handing money to.
 */
function ratingFor(vendor) {
  const rating = vendor?.rating == null ? null : Number(vendor.rating);
  return {
    rating: Number.isFinite(rating) ? rating : null,
    review_count: Number(vendor?.review_count) || 0,
  };
}

export function useDashboardData() {
  const [data, setData] = useState(EMPTY);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);
  const [diagnostics, setDiagnostics] = useState([]);
  /**
   * Has a load actually finished?
   *
   * Everything derived below reads as "this account has nothing" while
   * `data` is still EMPTY, which on a reload is the whole first frame.
   * That is what painted an order total over the summary bar before the
   * real numbers arrived. Nothing may be concluded from empty state
   * until a read has been and gone.
   */
  const [hasLoaded, setHasLoaded] = useState(false);

  /**
   * Which load is the current one. Loads overlap — a pull-to-refresh on
   * top of a post-create revalidate, an auth event on top of both — and
   * without this an older, slower run could finish last, clobber newer
   * data and flip the spinners for a request nobody is waiting on.
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

  /**
   * mode: 'initial' | 'refresh' | 'background'
   *
   * 'background' is the one that matters here: after a booklist is
   * created the cards already on screen have nothing wrong with them, so
   * the re-read swaps the rows underneath rather than putting every card
   * back to a skeleton.
   */
  const load = useCallback(async ({ mode = 'initial' } = {}) => {
    const run = ++runId.current;
    const current = () => alive.current && runId.current === run;

    if (mode === 'refresh') setRefreshing(true);
    else if (mode === 'initial') setLoading(true);
    setError(null);
    const notes = [];

    try {
      // getSession(), not getUser(): getUser() is a network round trip on
      // every load with no timeout, and right after an upload — busy
      // connection, token refresh possibly in flight — it is exactly the
      // call that hangs. A hang here means the finally below never runs
      // and the dashboard sits on a skeleton for good.
      const uid = await getSessionUserId();
      if (!current()) return;

      if (!uid) {
        notes.push({
          level: 'info',
          message: 'Not signed in — showing demo data.',
        });
        setData(EMPTY);
        setDiagnostics(notes);
        return;
      }
      const user = { id: uid };

      // --- profiles -------------------------------------------------
      // maybeSingle(), not single(): single() throws PGRST116 on zero
      // rows, and a missing profile should be a diagnostic, not a crash.
      let profile = null;
      let { data: profileData, error: profileError } = await supabase
        .from('profiles')
        .select('id, full_name, role, phone_number')
        .eq('id', user.id)
        .maybeSingle();

      // 42703 = undefined_column. Two causes, in order of likelihood:
      //   1. EXPO_PUBLIC_SUPABASE_URL points at a DIFFERENT project whose
      //      profiles table has different columns. Check the ref in .env
      //      against the project you migrated.
      //   2. PostgREST is serving a stale schema cache after DDL — fix
      //      with `notify pgrst, 'reload schema';`.
      // Retry with the columns every version has, so the rest of the
      // dashboard still renders while you sort it out.
      if (profileError?.code === '42703') {
        notes.push({
          level: 'error',
          message:
            `profiles is missing a column this app expects, at ${PROJECT_REF}. ` +
            'Most likely EXPO_PUBLIC_SUPABASE_URL points at the wrong project; ' +
            "otherwise PostgREST's schema cache is stale.",
        });
        ({ data: profileData, error: profileError } = await supabase
          .from('profiles')
          .select('id, full_name')
          .eq('id', user.id)
          .maybeSingle());
      }

      // A profile problem should degrade the greeting, not kill the page.
      if (profileError) {
        notes.push({ level: 'error', message: `Could not read your profile: ${profileError.message}` });
      } else {
        profile = profileData;
      }

      if (!profileError && !profile) {
        notes.push({
          level: 'error',
          message:
            'Signed in, but no profiles row exists for this user. Nothing creates one on signup — add the handle_new_user trigger.',
        });
      }

      // --- book_requests --------------------------------------------
      // Published only. A draft is the buyer's private workspace — it
      // belongs in "Drafts & pending" on the booklists hub, not in a card
      // headed "Active Booklist Requests", where it would sit next to
      // lists vendors are actively pricing and read as one of them.
      //
      // Filtered in the query rather than after it, so a long backlog of
      // drafts cannot push published requests past the limit below.
      const { data: requests, error: requestsError } = await supabase
        .from('book_requests')
        .select('id, school_name, class_level, image_url, status, created_at')
        .eq('buyer_id', user.id)
        .in('status', PUBLISHED_REQUEST_STATUSES)
        .order('created_at', { ascending: false })
        .limit(20);

      if (requestsError) throw requestsError;

      // How many drafts are waiting, without fetching them: head + count
      // returns the number and no rows. Two things need it — the card's
      // empty state, which would otherwise tell a buyer with three drafts
      // that they have no booklists, and the demo-data check below, which
      // must not decide the account is empty when it is only unpublished.
      const { count: draftCount, error: draftError } = await supabase
        .from('book_requests')
        .select('id', { count: 'exact', head: true })
        .eq('buyer_id', user.id)
        .eq('status', DRAFT_STATUS);

      // A failed count is cosmetic — it costs a nicer empty state, not
      // the dashboard. Treat it as zero and carry on.
      if (draftError) {
        notes.push({
          level: 'info',
          message: `Could not count your drafts: ${draftError.message}`,
        });
      }

      // Ordered lists are no longer fetched above, so without this a
      // buyer whose every booklist has become an order would look like a
      // brand new account and get DEMO DATA laid over their real
      // purchases. Same reason the draft count exists.
      const { count: orderedCount, error: orderedError } = await supabase
        .from('book_requests')
        .select('id', { count: 'exact', head: true })
        .eq('buyer_id', user.id)
        .in('status', ORDERED_REQUEST_STATUSES);

      if (orderedError) {
        notes.push({
          level: 'info',
          message: `Could not count your orders: ${orderedError.message}`,
        });
      }

      // --- book_request_items ---------------------------------------
      // The line items the buyer saved, read in one query for every
      // request on screen rather than one query per accordion — a nested
      // select under book_requests would do the same thing, but this way
      // a failure names this table instead of failing the whole request
      // list with it.
      const itemIds = (requests ?? []).map((r) => r.id);
      let bookItems = [];
      if (itemIds.length) {
        const ITEM_COLUMNS =
          'id, request_id, title, author, category, quantity, unit_price, parsed, position';

        let { data: itemRows, error: itemsError } = await supabase
          .from('book_request_items')
          .select(ITEM_COLUMNS)
          .in('request_id', itemIds)
          .order('position', { ascending: true });

        // 42703 = undefined_column. Naming `author` on a project that has
        // not run bookshops_booklist_author.sql fails the WHOLE select,
        // which would empty every accordion over one optional field.
        // Retry without it.
        if (itemsError?.code === '42703' && /author/i.test(itemsError.message ?? '')) {
          notes.push({
            level: 'info',
            message:
              'book_request_items has no `author` column yet — run bookshops_booklist_author.sql to show authors.',
          });
          ({ data: itemRows, error: itemsError } = await supabase
            .from('book_request_items')
            .select(ITEM_COLUMNS.replace(', author', ''))
            .in('request_id', itemIds)
            .order('position', { ascending: true }));
        }

        // Degrade to the quote breakdown rather than killing the page:
        // the rest of the dashboard does not depend on these rows.
        if (itemsError) {
          notes.push({
            level: 'error',
            message: `Could not read booklist items: ${itemsError.message}`,
          });
        } else {
          bookItems = itemRows ?? [];
        }
      }

      // --- quotes ---------------------------------------------------
      // Embedded vendors(...) requires the quotes -> vendors FK, which
      // exists. It will still come back null per row while `vendors` has
      // no SELECT policy, so we tolerate that below.
      const requestIds = (requests ?? []).map((r) => r.id);
      let quotes = [];
      let quoteItems = [];
      if (requestIds.length) {
        const { data: q, error: quotesError } = await supabase
          .from('quotes')
          .select(
            'id, request_id, vendor_id, total_price, item_breakdown, status, created_at, vendors ( id, store_name, city, is_active, rating, review_count )'
          )
          .in('request_id', requestIds)
          .order('created_at', { ascending: false });

        if (quotesError) throw quotesError;
        quotes = q ?? [];

        // --- quote_items ------------------------------------------
        // Where the line prices actually live. Keyed by quote id, so it
        // has to follow the quotes rather than run beside them.
        // quote_items_select_buyer_sent scopes it server-side to
        // non-draft quotes on this buyer's own requests, so a vendor's
        // unsent draft prices never reach here.
        const quoteIds = quotes.map((q2) => q2.id);
        if (quoteIds.length) {
          const { data: qi, error: quoteItemsError } = await supabase
            .from('quote_items')
            .select('id, quote_id, request_item_id, title, quantity, unit_price, is_available, position')
            .in('quote_id', quoteIds)
            .order('position', { ascending: true });

          // Degrade to unpriced lines rather than killing the page: the
          // accordion still lists the titles, it just cannot cost them.
          if (quoteItemsError) {
            notes.push({
              level: 'error',
              message: `Could not read quoted line prices: ${quoteItemsError.message}`,
            });
          } else {
            quoteItems = qi ?? [];
          }
        }

        if (quotes.length && quotes.every((q2) => q2.vendors == null)) {
          notes.push({
            level: 'error',
            message:
              'Quotes loaded but every embedded vendor is null — the vendors SELECT policy is hiding them. Check vendors_select_active.',
          });
        }
      }

      // --- orders ---------------------------------------------------
      const { data: orders, error: ordersError } = await supabase
        .from('orders')
        .select('id, quote_id, payment_status, fulfillment_status, created_at')
        .eq('buyer_id', user.id)
        .order('created_at', { ascending: false })
        .limit(20);

      if (ordersError) throw ordersError;

      // --- vendors (featured) ---------------------------------------
      const { data: vendors, error: vendorsError } = await supabase
        .from('vendors')
        .select('id, store_name, city, address, is_active')
        .eq('is_active', true)
        .limit(6);

      if (vendorsError) throw vendorsError;
      // No note here. Zero vendors on a new project is the correct state,
      // not a fault — the UI shows an empty state for it. RLS denial is
      // detected specifically, below, where it is distinguishable.

      setData({
        profile: profile ?? null,
        email: user.email ?? null,
        requests: requests ?? [],
        draftCount: draftError ? 0 : (draftCount ?? 0),
        orderedCount: orderedError ? 0 : (orderedCount ?? 0),
        items: bookItems,
        quotes,
        quoteItems,
        orders: orders ?? [],
        vendors: vendors ?? [],
      });
    } catch (e) {
      if (!current()) return;
      if (e?.code === 'PGRST205') {
        // "Could not find the table ... in the schema cache"
        e = new Error(
          `This project (${PROJECT_REF}) does not have the table this app expects. ` +
            'Check EXPO_PUBLIC_SUPABASE_URL in .env — it is probably pointing at a ' +
            `different Supabase project. Original: ${e.message}`
        );
      }
      setError(e);
      // A background revalidate that fails must not empty the dashboard
      // the buyer is already reading. Keep the rows, show the error.
      if (mode !== 'background') setData(EMPTY);
    } finally {
      // Unconditional, and guarded so only the newest run may clear the
      // flags: an older run finishing late must not switch a spinner off
      // under a newer one, nor leave one on after this run is done.
      if (current()) {
        setDiagnostics(notes);
        setLoading(false);
        setRefreshing(false);
        setHasLoaded(true);
      }
    }
  }, []);

  useEffect(() => {
    load({ mode: 'initial' });
    // Deferred and filtered. The callback runs inside supabase-js's own
    // notification pass, and TOKEN_REFRESHED fires on a timer and during
    // long uploads — reloading on it is how an upload could knock every
    // card on this dashboard back to a skeleton.
    return subscribeToAuthReloads(() => load({ mode: 'background' }));
  }, [load]);

  /**
   * Shape the raw rows into exactly what the cards render, substituting
   * mock data only where the schema genuinely has no home for it. Every
   * substitution sets `demo: true` so the UI can badge it.
   */
  const view = useMemo(() => {
    const {
      requests,
      draftCount,
      orderedCount,
      items,
      quotes,
      quoteItems,
      vendors,
      orders,
      profile,
      email: authEmail,
    } = data;

    // True only once a read has finished AND found nothing. Before the
    // first load this is false, so no card concludes anything from a
    // state that just means "not fetched yet".
    const isEmpty =
      hasLoaded && requests.length === 0 && draftCount === 0 && orderedCount === 0;

    /**
     * Active booklist requests, each with its best available line items.
     *
     * No fixture branch. This used to fall back to MOCK_BOOKLIST_REQUESTS
     * — an invented booklist from "Laterna Books (Ikeja)" with priced
     * lines — whenever the account looked empty, which included every
     * first frame before the query returned. The summary bar sums those
     * lines, so a reload flashed a made-up naira total over the real one.
     * An empty account has an empty state; it does not have a pretend
     * booklist.
     */
    const activeRequests = requests.map((r) => {
          const quotesForRequest = quotes.filter((q) => q.request_id === r.id);
          // The accepted quote, else the cheapest one sent. The same
          // choice the booklists page makes, so the two screens cannot
          // show a line at two different prices.
          const pricingQuote = pickPricingQuote(quotesForRequest);
          const saved = mapRequestItems(
            items.filter((i) => i.request_id === r.id),
            quoteItems,
            pricingQuote?.id ?? null
          );
          const fromBreakdown = parseItemBreakdown(quotesForRequest[0]?.item_breakdown);

          // The buyer's own saved lines first; a vendor's quote
          // breakdown only when there are none. An empty array is now a
          // real answer — the card renders an empty state for it rather
          // than filling the gap with invented titles.
          const lineItems = saved.length ? saved : (fromBreakdown ?? []);

          return {
            ...r,
            vendor_name:
              quotesForRequest[0]?.vendors?.store_name ??
              r.school_name ??
              'Awaiting vendor',
            items: lineItems,
            /** 'saved' | 'quote' | 'none' — what the card is showing. */
            itemsSource: saved.length ? 'saved' : fromBreakdown ? 'quote' : 'none',
            quoteCount: quotesForRequest.length,
            /**
             * True once a vendor has actually sent something. The row
             * only says "Awaiting quote" while this is false — past it,
             * a line with no money on it has been answered, not ignored.
             */
            hasQuote: pricingQuote != null,
          };
    });

    /**
     * Real quotes only. No fixture fallback, in any environment.
     *
     * This used to substitute four invented shops whenever the query
     * came back empty — so a buyer with no quotes was shown "School
     * Books & More" and "Laterna Books (Ikeja)" offering prices for
     * books nobody had priced. Accepting one leads nowhere, and the
     * "Demo data" pill was easy to miss above four convincing rows.
     * Zero quotes is a real answer, and the card has an empty state
     * that says so.
     *
     * Note the filter now runs unconditionally: the old `quotes.length ?`
     * guard meant a buyer holding only draft or accepted quotes fell
     * through to the fixtures too.
     */
    const pendingQuotes = quotes
      .filter((q) => q.status === 'sent')
      .map((q) => ({
        id: q.id,
        vendor_name: q.vendors?.store_name ?? 'Vendor (name hidden by RLS)',
        total_price: Number(q.total_price) || 0,
        status: q.status,
        ...ratingFor(q.vendors),
      }));

    // Null when no vendor is visible, and the card renders its own "No
    // shops yet". It used to name a shop that does not exist, which is a
    // worse thing to show a buyer than a blank.
    const featuredShop = vendors.length ? { ...vendors[0], ...ratingFor(vendors[0]) } : null;

    // Order total = the checked line items of the first active request.
    // TODO(db): `orders` stores no amount, so a placed order's true value
    // is not recoverable — this is computed client-side from the quote.
    const activeItems = activeRequests[0]?.items ?? [];
    const orderTotal = activeItems
      .filter((i) => i.checked !== false)
      // line_total already excludes unpriced and out-of-stock lines, and
      // is the same figure printed on the row — so the summary and the
      // rows above it cannot disagree. The fallback covers demo rows,
      // which carry a unit price and no line total.
      .reduce(
        (sum, i) =>
          sum +
          (i.line_total != null
            ? Number(i.line_total)
            : (Number(i.unit_price) || 0) * (Number(i.quantity) || 1)),
        0
      );

    return {
      profile,
      displayName:
        profile?.full_name?.trim() ||
        // signup.js collects no name yet, so full_name is often ''.
        authEmail?.split('@')[0] ||
        'there',
      activeRequests,
      /** Drafts, which this card deliberately does not show. */
      draftCount,
      /** Ordered lists, which live on My Orders rather than this card. */
      orderedCount,
      pendingQuotes,
      featuredShop,
      vendors,
      orders,
      orderTotal,
      /**
       * Nothing on this dashboard is invented any more, so this is
       * always false. Kept so callers do not break; remove it and the
       * banner it drove once nothing reads it.
       */
      usingDemoData: false,
      /**
       * True when the signed-in account is fine but the marketplace simply
       * has no data yet — the normal state of a freshly migrated project.
       * The screen shows empty states for this, never a warning.
       */
      isEmptyProject:
        isEmpty && quotes.length === 0 && vendors.length === 0,
      /** True when the only thing this buyer has is unpublished drafts. */
      hasOnlyDrafts: requests.length === 0 && draftCount > 0,
    };
  }, [data, hasLoaded]);

  return {
    ...view,
    raw: data,
    loading,
    refreshing,
    error,
    diagnostics,
    /** Pull-to-refresh: platform spinner, cards stay put. */
    refresh: () => load({ mode: 'refresh' }),
    /** Re-read after a write. No card returns to a skeleton. */
    revalidate: () => load({ mode: 'background' }),
    /** Full reload with skeletons. For a retry after a hard failure. */
    reload: () => load({ mode: 'initial' }),
  };
}
