import type { QuoteStatus } from '../types/db';

/**
 * Where "Compare N quotes" goes, and what it should say.
 *
 * One function, used by every card that offers the buyer a way into
 * their quotes. The reason it is not two lines inlined in the screen:
 * the label and the destination have to agree. A button reading
 * "Compare 3 quotes" that lands on a single quote, or reading "Review
 * this quote" that lands on a list, is the same bug either way, and the
 * only way to guarantee they cannot drift is to decide both together.
 */

/** The minimum a quote needs for this decision. */
export interface RoutableQuote {
  id: string;
  status: QuoteStatus | string;
}

export interface QuoteCta {
  label: string;
  /** An expo-router path, ready for router.push(). */
  path: string;
  /** For the accessibility label, which needs the school name too. */
  hint: string;
}

/**
 * Draft quotes never count. A draft is the shop's private working copy;
 * the buyer is not shown it anywhere, so it must not change a count or
 * a destination either.
 */
function visible(quotes: readonly RoutableQuote[]): RoutableQuote[] {
  return quotes.filter((q) => q.status !== 'draft');
}

/** Offers the buyer can still act on — accept or decline. */
export function liveQuotes(quotes: readonly RoutableQuote[]): RoutableQuote[] {
  return quotes.filter((q) => q.status === 'sent');
}

/**
 * The route into the buyer's quotes for one request.
 *
 * The rule, in order:
 *
 *   accepted quote      straight to it. It is the only one that still
 *                       matters; the others lost.
 *   exactly one live    straight to it. "Compare 1 quote" is not a
 *                       comparison, and making the buyer tap through a
 *                       one-row list to reach the accept button is a
 *                       step that exists only because the code could
 *                       not be bothered to count.
 *   two or more live    the request page, which lists them side by side.
 *   none live, some     the request page, so a declined or withdrawn
 *   ended               offer is still reachable rather than vanishing.
 *   nothing at all      null — no button.
 */
export function quoteCta(requestId: string, quotes: readonly RoutableQuote[]): QuoteCta | null {
  const seen = visible(quotes);

  const accepted = seen.find((q) => q.status === 'accepted');
  if (accepted) {
    return {
      label: 'View The Accepted Quote',
      path: `/quotes/${accepted.id}`,
      hint: 'Open the quote you accepted',
    };
  }

  const live = liveQuotes(seen);
  if (live.length === 1) {
    return {
      label: 'Review This Quote',
      path: `/quotes/${live[0].id}`,
      hint: 'Open the quote to accept and pay, or decline it',
    };
  }
  if (live.length > 1) {
    return {
      label: `Compare ${live.length} Quotes`,
      path: `/booklists/${requestId}`,
      hint: `Compare the ${live.length} quotes side by side`,
    };
  }

  if (seen.length) {
    return {
      label: seen.length === 1 ? 'See The Closed Quote' : `See ${seen.length} Closed Quotes`,
      path: `/booklists/${requestId}`,
      hint: 'Open the quotes that are no longer available',
    };
  }

  return null;
}

/**
 * Comparison order for the request page.
 *
 * Live offers first and cheapest first within them, because that is the
 * decision in front of the buyer. Accepted next, then everything that
 * has ended — a declined quote is history and must not sit above an
 * offer that is still open, whatever it costs.
 */
const RANK: Record<string, number> = { sent: 0, accepted: 1 };

export function compareForBuyer(a: RoutableQuote & { total_price: number | string }, b: RoutableQuote & { total_price: number | string }): number {
  const ra = RANK[a.status] ?? 2;
  const rb = RANK[b.status] ?? 2;
  if (ra !== rb) return ra - rb;
  return Number(a.total_price) - Number(b.total_price);
}
