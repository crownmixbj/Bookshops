import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '../utils/supabase';
import { getSessionUserId, withTimeout } from '../lib/loadState';
import {
  DRAFT_STATUS,
  directTo,
  publishBookRequest,
  routeBookRequest,
} from '../lib/booklistUpload';

/**
 * What the buyer sees on a quote card.
 *
 * Derived, not stored. There is no single column that says "pending
 * vendor response" — that is a request addressed to this shop with no
 * quote row against it yet, which is two tables away from any status
 * field.
 */
export type ShopQuoteStatus =
  | 'awaiting'   // sent to this shop, nothing back yet
  | 'received'   // they have quoted; the buyer can act
  | 'accepted'   // the buyer took it
  | 'declined'   // the shop rejected or withdrew it
  | 'expired';

export interface ShopQuote {
  /** The quote row, when one exists. Null while awaiting a response. */
  quoteId: string | null;
  requestId: string;
  title: string;
  classLevel: string | null;
  /** When the buyer sent the booklist, not when the shop replied. */
  submittedAt: string;
  status: ShopQuoteStatus;
  /** Null until they quote. */
  total: number | null;
  /** Lines this shop priced and can supply. */
  quotedItems: number;
  /** Lines the buyer asked for. */
  requestedItems: number;
}

/** A booklist the buyer could send to this shop. */
export interface SendableBooklist {
  id: string;
  title: string;
  classLevel: string | null;
  itemCount: number;
  isDraft: boolean;
  /** Already out on the open market — sending re-routes it to this shop alone. */
  alreadyPublished: boolean;
}

export interface UseShopQuotes {
  quotes: ShopQuote[];
  sendable: SendableBooklist[];
  loading: boolean;
  error: Error | null;
  /** Null when signed out — the page hides the buyer-only sections. */
  userId: string | null;
  refresh: () => void;
  /** Send an existing booklist to this shop. Throws with a readable message. */
  sendBooklist: (booklist: SendableBooklist) => Promise<void>;
}

const STATUS_FROM_QUOTE: Record<string, ShopQuoteStatus> = {
  sent: 'received',
  accepted: 'accepted',
  rejected: 'declined',
  withdrawn: 'declined',
  expired: 'expired',
};

/**
 * This buyer's dealings with one shop.
 *
 * Two sources, deliberately. `quotes` gives the shop's replies;
 * `book_requests.target_vendor_id` gives the lists sent to them that
 * have had no reply — and those are the ones a buyer most wants to see,
 * because silence is the state they are waiting on. Reading only the
 * quotes table would show an empty page to someone who sent a booklist
 * an hour ago.
 */
export function useShopQuotes(vendorId: string | null): UseShopQuotes {
  const [quotes, setQuotes] = useState<ShopQuote[]>([]);
  const [sendable, setSendable] = useState<SendableBooklist[]>([]);
  const [userId, setUserId] = useState<string | null>(null);
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
      if (!vendorId) return;

      const uid = await getSessionUserId();
      if (!current()) return;
      setUserId(uid);
      if (!uid) {
        setQuotes([]);
        setSendable([]);
        return;
      }

      // Every booklist this buyer owns, with its line count. One read
      // serves both the quote cards and the picker.
      const { data: requestRows, error: requestsError } = await withTimeout(
        supabase
          .from('book_requests')
          .select(
            'id, school_name, class_level, status, created_at, target_vendor_id, book_request_items(count)'
          )
          .eq('buyer_id', uid)
          .order('created_at', { ascending: false }),
        8000,
        'Loading your booklists'
      );
      if (!current()) return;
      if (requestsError) throw requestsError;

      const requests = (requestRows ?? []) as Array<Record<string, any>>;
      const itemCountOf = (r: Record<string, any>) =>
        Number(r.book_request_items?.[0]?.count) || 0;

      // Quotes this shop has written on those booklists. RLS already
      // hides their unsent drafts.
      const requestIds = requests.map((r) => r.id as string);
      let quoteRows: Array<Record<string, any>> = [];
      if (requestIds.length) {
        const { data, error: quotesError } = await withTimeout(
          supabase
            .from('quotes')
            .select('*, quote_items(count)')
            .eq('vendor_id', vendorId)
            .in('request_id', requestIds),
          8000,
          'Loading quotes from this shop'
        );
        if (!current()) return;
        if (quotesError) throw quotesError;
        quoteRows = (data ?? []) as Array<Record<string, any>>;
      }

      const quoteByRequest = new Map<string, Record<string, any>>();
      for (const q of quoteRows) {
        const existing = quoteByRequest.get(q.request_id as string);
        // Newest wins if a shop somehow has two on one request.
        if (!existing || String(q.created_at) > String(existing.created_at)) {
          quoteByRequest.set(q.request_id as string, q);
        }
      }

      // A card for every booklist that involves this shop: one they have
      // quoted, or one addressed to them and still silent.
      const cards: ShopQuote[] = [];
      for (const r of requests) {
        const quote = quoteByRequest.get(r.id as string);
        const addressedHere = r.target_vendor_id === vendorId;
        if (!quote && !addressedHere) continue;
        if (!quote && r.status === DRAFT_STATUS) continue; // never sent

        cards.push({
          quoteId: (quote?.id as string) ?? null,
          requestId: r.id as string,
          title: (r.school_name as string) || 'Untitled booklist',
          classLevel: (r.class_level as string) || null,
          submittedAt: r.created_at as string,
          status: quote ? STATUS_FROM_QUOTE[quote.status as string] ?? 'received' : 'awaiting',
          // Items plus the shop's delivery fee — what the buyer would pay.
          total:
            quote?.total_price == null
              ? null
              : Number(quote.total_price) + (Number(quote.delivery_fee) || 0),
          quotedItems: Number(quote?.quote_items?.[0]?.count) || 0,
          requestedItems: itemCountOf(r),
        });
      }
      setQuotes(cards);

      // What the picker offers: anything not already with this shop and
      // not finished. An ordered or cancelled list has nowhere to go.
      setSendable(
        requests
          .filter(
            (r) =>
              r.target_vendor_id !== vendorId &&
              r.status !== 'ordered' &&
              r.status !== 'cancelled'
          )
          .map((r) => ({
            id: r.id as string,
            title: (r.school_name as string) || 'Untitled booklist',
            classLevel: (r.class_level as string) || null,
            itemCount: itemCountOf(r),
            isDraft: r.status === DRAFT_STATUS,
            alreadyPublished: r.status !== DRAFT_STATUS,
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
  }, [vendorId]);

  useEffect(() => {
    load();
  }, [load]);

  const sendBooklist = useCallback(
    async (booklist: SendableBooklist) => {
      if (!vendorId) throw new Error('This shop could not be identified.');
      // Two different acts. Publishing takes a draft live and addresses
      // it; routing re-points a list already out on the open market
      // without dragging it back to 'pending_quote' and losing a quote
      // another shop may be part-way through writing.
      if (booklist.isDraft) {
        await publishBookRequest(booklist.id, directTo(vendorId));
      } else {
        await routeBookRequest(booklist.id, directTo(vendorId));
      }
      await load();
    },
    [vendorId, load]
  );

  return { quotes, sendable, loading, error, userId, refresh: load, sendBooklist };
}
