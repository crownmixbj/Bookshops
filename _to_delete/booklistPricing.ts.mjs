/**
 * Where a booklist line's money comes from.
 *
 * Prices are written to `quote_items`, never back onto
 * `book_request_items` — a request line is what the buyer asked for and
 * two shops may price it differently, so it has no single price of its
 * own. Reading `book_request_items.unit_price` and nothing else is why
 * a card could show an order total of ₦57,640 above twelve lines that
 * each said "Not priced".
 *
 * These helpers are the one place that mapping lives, so the list, the
 * card and the detail screen cannot drift apart on what a line costs.
 */

/**
 * The quote a booklist's money should be read from.
 *
 * The accepted one if there is one — that is the deal actually struck.
 * Otherwise the cheapest quote the buyer has been sent, which is the
 * figure the card headlines as "Best quote". Draft quotes are the
 * vendor's private working copy and never count; RLS hides them from
 * the buyer anyway, this is belt and braces.
 */
export function pickPricingQuote(quotes) {
  const accepted = quotes.find(q => q.status === 'accepted');
  if (accepted) return accepted;
  const sent = quotes.filter(q => q.status === 'sent').sort((a, b) => Number(a.total_price) - Number(b.total_price));
  return sent[0] ?? null;
}

/**
 * Attach the pricing quote's numbers to each requested line.
 *
 * Matched on `quote_items.request_item_id`, which is the link the vendor
 * quote builder writes. Three outcomes per line:
 *
 *   quoted and available    a real price, and it counts toward the total
 *   quoted, out of stock    the vendor kept the line but excluded it
 *   not on the quote        no price — the shop did not answer this line
 *
 * The quote carries its OWN quantity: a shop may offer two of the three
 * copies asked for, and the line total must follow what is being sold,
 * not what was requested.
 */
/** The minimum a row needs for pricing: an id to match on and its own fallback price. */

export function priceBooklistItems(items, quoteItems, pricingQuoteId) {
  const byRequestItem = new Map();
  if (pricingQuoteId) {
    for (const qi of quoteItems) {
      if (qi.quote_id !== pricingQuoteId || !qi.request_item_id) continue;
      byRequestItem.set(qi.request_item_id, qi);
    }
  }
  return items.map(item => {
    const quoted = byRequestItem.get(item.id);
    if (quoted) {
      const unitPrice = quoted.unit_price == null ? null : Number(quoted.unit_price);
      const quantity = Number(quoted.quantity) || item.quantity;
      const isAvailable = quoted.is_available !== false;
      return {
        ...item,
        effectiveUnitPrice: unitPrice,
        effectiveQuantity: quantity,
        // An out-of-stock line is deliberately null rather than 0: it is
        // excluded from the total by the same rule the database's
        // refresh_quote_total trigger uses, so the two always agree.
        lineTotal: isAvailable && unitPrice != null ? unitPrice * quantity : null,
        isAvailable,
        priceSource: 'quote'
      };
    }

    // No quote in play. A price on the request row itself is the buyer's
    // own estimate — today nothing writes one, but the shape supports it
    // and treating it as a price is better than discarding it.
    const own = item.unit_price == null ? null : Number(item.unit_price);
    return {
      ...item,
      effectiveUnitPrice: own,
      effectiveQuantity: item.quantity,
      lineTotal: own == null ? null : own * item.quantity,
      isAvailable: true,
      priceSource: own == null ? 'none' : 'request'
    };
  });
}

/** Sum of the lines that actually have money on them. Nulls are unknown, not zero. */
export function sumLineTotals(items) {
  return items.reduce((sum, i) => sum + (i.lineTotal ?? 0), 0);
}

/** True once at least one line carries a price read off the quote. */
export function hasQuotedLines(items) {
  return items.some(i => i.priceSource === 'quote' && i.lineTotal != null);
}

/**
 * Naira are quoted to the kobo in the column and to the naira on screen,
 * so compare at one-naira tolerance rather than on exact equality.
 */
export function totalsAgree(linesTotal, quoteTotal) {
  return Math.abs(linesTotal - quoteTotal) < 1;
}

/**
 * What a line's price cell is saying.
 *
 * Four states, and collapsing them is the bug this module exists to
 * fix. Only the last one means "nobody has answered":
 *
 *   priced          a real figure from the quote
 *   out_of_stock    the shop looked and cannot supply it
 *   not_quoted      a quote came back, but it skipped this line
 *   awaiting_quote  no vendor has sent anything yet
 */

export function linePriceState(line, hasQuote) {
  if (!line.isAvailable) return 'out_of_stock';
  if (line.lineTotal != null) return 'priced';
  return hasQuote ? 'not_quoted' : 'awaiting_quote';
}

/** The words for each state. `priced` is formatted by the caller. */
export const LINE_PRICE_LABEL = {
  out_of_stock: 'Out of stock',
  not_quoted: 'Not quoted',
  awaiting_quote: 'Awaiting quote'
};