import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '../utils/supabase';
import { DRAFT_STATUS } from '../lib/booklistUpload';
import {
  MOCK_BOOKLIST_REQUESTS,
  MOCK_QUOTES,
  MOCK_FEATURED_SHOP,
  MOCK_VENDOR_RATING_DEFAULT,
  MOCK_VENDOR_RATINGS,
} from '../lib/mockData';

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
 * The statuses a vendor can see, and therefore the only ones that belong
 * in "Active Booklist Requests".
 *
 * Mirrors vendor_request_queue()'s filter plus 'ordered', which the queue
 * drops (nothing left to quote) but a buyer still wants on their
 * dashboard. 'cancelled' is excluded: it is archived, not active.
 */
const PUBLISHED_REQUEST_STATUSES = ['pending_quote', 'quoted', 'ordered'];

/** The project ref the client is actually pointed at, for error messages. */
const PROJECT_REF =
  (process.env.EXPO_PUBLIC_SUPABASE_URL ?? '').match(/https:\/\/([^.]+)\./)?.[1] ??
  'unknown project';

const EMPTY = {
  profile: null,
  email: null,
  requests: [],
  draftCount: 0,
  items: [],
  quotes: [],
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
 * them.
 *
 * unit_price stays null rather than becoming 0: a booklist that no
 * vendor has quoted has no prices, and showing ₦0 against a textbook
 * reads as free rather than as unpriced. The card checks for null.
 */
function mapRequestItems(rows) {
  return rows.map((row) => ({
    id: row.id,
    title: row.title,
    // Absent entirely on projects that have not run
    // bookshops_booklist_author.sql — hence ?? null, not a bare read.
    author: row.author ?? null,
    unit_price: row.unit_price == null ? null : Number(row.unit_price),
    quantity: Number(row.quantity) || 1,
    // TODO(db): no inventory model — in_stock is never real.
    in_stock: true,
    checked: true,
  }));
}

/** TODO(db): vendors has no rating column. See lib/mockData.js. */
function ratingFor(vendorId) {
  return MOCK_VENDOR_RATINGS[vendorId] ?? MOCK_VENDOR_RATING_DEFAULT;
}

export function useDashboardData() {
  const [data, setData] = useState(EMPTY);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);
  const [diagnostics, setDiagnostics] = useState([]);

  const load = useCallback(async ({ isRefresh = false } = {}) => {
    isRefresh ? setRefreshing(true) : setLoading(true);
    setError(null);
    const notes = [];

    try {
      const {
        data: { user },
        error: userError,
      } = await supabase.auth.getUser();

      if (userError) throw userError;
      if (!user) {
        notes.push({
          level: 'info',
          message: 'Not signed in — showing demo data.',
        });
        setData(EMPTY);
        setDiagnostics(notes);
        return;
      }

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
      if (requestIds.length) {
        const { data: q, error: quotesError } = await supabase
          .from('quotes')
          .select(
            'id, request_id, vendor_id, total_price, item_breakdown, status, created_at, vendors ( id, store_name, city, is_active )'
          )
          .in('request_id', requestIds)
          .order('created_at', { ascending: false });

        if (quotesError) throw quotesError;
        quotes = q ?? [];

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
        items: bookItems,
        quotes,
        orders: orders ?? [],
        vendors: vendors ?? [],
      });
    } catch (e) {
      if (e?.code === 'PGRST205') {
        // "Could not find the table ... in the schema cache"
        e = new Error(
          `This project (${PROJECT_REF}) does not have the table this app expects. ` +
            'Check EXPO_PUBLIC_SUPABASE_URL in .env — it is probably pointing at a ' +
            `different Supabase project. Original: ${e.message}`
        );
      }
      setError(e);
      setData(EMPTY);
    } finally {
      setDiagnostics(notes);
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    load();
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(() => load());
    return () => subscription.unsubscribe();
  }, [load]);

  /**
   * Shape the raw rows into exactly what the cards render, substituting
   * mock data only where the schema genuinely has no home for it. Every
   * substitution sets `demo: true` so the UI can badge it.
   */
  const view = useMemo(() => {
    const { requests, draftCount, items, quotes, vendors, orders, profile, email: authEmail } =
      data;

    // `requests` now holds published lists only, so a buyer whose whole
    // account is drafts would look empty and get demo data on top of
    // their own real work. The draft count is what keeps that honest.
    const isEmpty = requests.length === 0 && draftCount === 0;

    // Active booklist requests, each with its best available line items.
    const activeRequests = isEmpty
      ? MOCK_BOOKLIST_REQUESTS
      : requests.map((r) => {
          const quotesForRequest = quotes.filter((q) => q.request_id === r.id);
          const saved = mapRequestItems(items.filter((i) => i.request_id === r.id));
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
          };
        });

    const pendingQuotes = quotes.length
      ? quotes
          .filter((q) => q.status === 'sent')
          .map((q) => ({
            id: q.id,
            vendor_name: q.vendors?.store_name ?? 'Vendor (name hidden by RLS)',
            total_price: Number(q.total_price) || 0,
            status: q.status,
            ...ratingFor(q.vendor_id), // TODO(db): vendors.rating
          }))
      : MOCK_QUOTES.map((q) => ({ ...q, ...MOCK_VENDOR_RATING_DEFAULT }));

    const featuredShop = vendors.length
      ? { ...vendors[0], ...ratingFor(vendors[0].id) }
      : MOCK_FEATURED_SHOP;

    // Order total = the checked line items of the first active request.
    // TODO(db): `orders` stores no amount, so a placed order's true value
    // is not recoverable — this is computed client-side from the quote.
    const activeItems = activeRequests[0]?.items ?? [];
    const orderTotal = activeItems
      .filter((i) => i.checked !== false)
      .reduce((sum, i) => sum + (Number(i.unit_price) || 0) * (Number(i.quantity) || 1), 0);

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
      pendingQuotes,
      featuredShop,
      vendors,
      orders,
      orderTotal,
      /** True when any panel is showing invented rows rather than real ones. */
      usingDemoData: isEmpty,
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
  }, [data]);

  return {
    ...view,
    raw: data,
    loading,
    refreshing,
    error,
    diagnostics,
    refresh: () => load({ isRefresh: true }),
  };
}
