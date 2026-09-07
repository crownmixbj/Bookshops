
import { pickPricingQuote, priceBooklistItems } from './lib/booklistPricing.ts.mjs';
function parseItemBreakdown() { return null; }
function ratingFor(v) { return { rating: v?.rating == null ? null : Number(v.rating), review_count: Number(v?.review_count) || 0 }; }
function mapRequestItems(rows, quoteItems, pricingQuoteId) {
  return priceBooklistItems(rows, quoteItems, pricingQuoteId).map(row => ({
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
    checked: true
  }));
}
export function derive(data, hasLoaded) { 
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
      email: authEmail
    } = data;

    // True only once a read has finished AND found nothing. Before the
    // first load this is false, so no card concludes anything from a
    // state that just means "not fetched yet".
    const isEmpty = hasLoaded && requests.length === 0 && draftCount === 0 && orderedCount === 0;

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
    const activeRequests = requests.map(r => {
      const quotesForRequest = quotes.filter(q => q.request_id === r.id);
      // The accepted quote, else the cheapest one sent. The same
      // choice the booklists page makes, so the two screens cannot
      // show a line at two different prices.
      const pricingQuote = pickPricingQuote(quotesForRequest);
      const saved = mapRequestItems(items.filter(i => i.request_id === r.id), quoteItems, pricingQuote?.id ?? null);
      const fromBreakdown = parseItemBreakdown(quotesForRequest[0]?.item_breakdown);

      // The buyer's own saved lines first; a vendor's quote
      // breakdown only when there are none. An empty array is now a
      // real answer — the card renders an empty state for it rather
      // than filling the gap with invented titles.
      const lineItems = saved.length ? saved : fromBreakdown ?? [];
      return {
        ...r,
        vendor_name: quotesForRequest[0]?.vendors?.store_name ?? r.school_name ?? 'Awaiting vendor',
        items: lineItems,
        /** 'saved' | 'quote' | 'none' — what the card is showing. */
        itemsSource: saved.length ? 'saved' : fromBreakdown ? 'quote' : 'none',
        quoteCount: quotesForRequest.length,
        /**
         * True once a vendor has actually sent something. The row
         * only says "Awaiting quote" while this is false — past it,
         * a line with no money on it has been answered, not ignored.
         */
        hasQuote: pricingQuote != null
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
    const pendingQuotes = quotes.filter(q => q.status === 'sent').map(q => ({
      id: q.id,
      vendor_name: q.vendors?.store_name ?? 'Vendor (name hidden by RLS)',
      total_price: Number(q.total_price) || 0,
      status: q.status,
      ...ratingFor(q.vendors)
    }));

    // Null when no vendor is visible, and the card renders its own "No
    // shops yet". It used to name a shop that does not exist, which is a
    // worse thing to show a buyer than a blank.
    const featuredShop = vendors.length ? {
      ...vendors[0],
      ...ratingFor(vendors[0])
    } : null;

    // Order total = the checked line items of the first active request.
    // TODO(db): `orders` stores no amount, so a placed order's true value
    // is not recoverable — this is computed client-side from the quote.
    const activeItems = activeRequests[0]?.items ?? [];
    const orderTotal = activeItems.filter(i => i.checked !== false)
    // line_total already excludes unpriced and out-of-stock lines, and
    // is the same figure printed on the row — so the summary and the
    // rows above it cannot disagree. The fallback covers demo rows,
    // which carry a unit price and no line total.
    .reduce((sum, i) => sum + (i.line_total != null ? Number(i.line_total) : (Number(i.unit_price) || 0) * (Number(i.quantity) || 1)), 0);
    return {
      profile,
      displayName: profile?.full_name?.trim() ||
      // signup.js collects no name yet, so full_name is often ''.
      authEmail?.split('@')[0] || 'there',
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
      isEmptyProject: isEmpty && quotes.length === 0 && vendors.length === 0,
      /** True when the only thing this buyer has is unpublished drafts. */
      hasOnlyDrafts: requests.length === 0 && draftCount > 0
    };
   }
