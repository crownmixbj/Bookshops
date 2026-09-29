import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '../utils/supabase';
import { freshChannel } from '../lib/realtime';
import { loadRequestDelivery } from '../lib/requestDelivery';
import type {
  BookRequestItem,
  QueueBadge,
  QuoteItem,
  Vendor,
  VendorQueueRow,
  RequestDelivery,
} from '../types/db';

/**
 * The vendor's side of the marketplace: an incoming request queue, and a
 * working quote for whichever request is open.
 *
 * Security shape worth understanding before changing anything:
 *
 *  - The queue comes from the `vendor_request_queue()` RPC, not a table
 *    read. That function is SECURITY DEFINER and decides whether this
 *    vendor may see the customer's name — only for requests they have
 *    quoted or that were addressed to them. Do not replace it with a
 *    direct join onto `profiles`; the join would simply be denied, and
 *    working around that would hand every shop a list of every parent.
 *
 *  - Prices are written to `quote_items`, never to `book_request_items`.
 *    The buyer's lines are their statement of what they want; a vendor
 *    writing to them would corrupt every other vendor's quote too.
 *
 *  - A draft quote is invisible to the buyer, enforced by RLS on both
 *    `quotes` and `quote_items`.
 *
 *  - An open-pool list is exclusive to the first shop that accepts it
 *    (bookshops_quote_claims_and_limits.sql). acceptRequest() claims it
 *    through `claim_book_request()` before the editor opens, and a
 *    trigger on `quotes` refuses a quote on a list another shop holds, so
 *    the rule does not depend on this hook being the only client.
 */

/** PostgREST / Postgres codes for "that function does not exist yet". */
const MISSING_FUNCTION = new Set(['PGRST202', '42883']);

/** True when the database refused because another shop holds the list. */
export function isClaimLost(error: unknown): boolean {
  const e = error as { hint?: string; message?: string } | null;
  return e?.hint === 'request_claimed' || e?.hint === 'request_closed';
}

/** "Reserved for you for 23 more hours" and friends. */
export function claimTimeLeft(expiresAt: string | null | undefined, now = Date.now()): string | null {
  if (!expiresAt) return null;
  const ms = new Date(expiresAt).getTime() - now;
  if (!Number.isFinite(ms) || ms <= 0) return null;
  const hours = Math.floor(ms / 3_600_000);
  if (hours < 1) return 'less than an hour';
  return `${hours} more hour${hours === 1 ? '' : 's'}`;
}

export interface DraftLine {
  /** Present once the line exists in quote_items. */
  id: string | null;
  request_item_id: string;
  title: string;
  quantity: number;
  /** Held as text so a half-typed price does not fight the input. */
  priceText: string;
  is_available: boolean;
  position: number;
}

export function badgeFor(row: VendorQueueRow): QueueBadge {
  // Rows only reach the queue while the shop can still act on them, so a
  // quote the customer declined never gets here (see loadQueue). Before
  // that was true, a declined quote fell through to the last line and
  // came back badged "New Request".
  if (row.my_quote_status === 'accepted') return 'accepted';
  if (row.my_quote_status === 'sent') return 'sent';
  if (row.my_quote_status === 'draft') return 'processing';
  if (row.claimed_by_me && !row.is_targeted) return 'claimed';
  return row.is_targeted ? 'pending' : 'new';
}

export const BADGE_LABEL: Record<QueueBadge, string> = {
  new: 'New Request',
  claimed: 'Accepted by You',
  pending: 'Pending Quote',
  processing: 'Processing Quote',
  sent: 'Quote Sent',
  accepted: 'Accepted',
};

function parsePrice(text: string): number | null {
  const cleaned = text.replace(/[^0-9.]/g, '');
  if (!cleaned) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

export function useVendorDashboard() {
  const [vendor, setVendor] = useState<Vendor | null>(null);
  const [queue, setQueue] = useState<VendorQueueRow[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [lines, setLines] = useState<DraftLine[]>([]);
  /** The buyer's booklist photo for the open request, if they attached one. */
  const [imagePath, setImagePath] = useState<string | null>(null);
  /**
   * Where the open list is to be delivered (bookshops_booklist_delivery.sql),
   * so the delivery cost is priced to a real destination. RLS releases it
   * only once the list is this shop's work — claimed, addressed to it, or
   * quoted — which is exactly when the editor opens.
   */
  const [delivery, setDelivery] = useState<RequestDelivery | null>(null);
  /** The last request opened, so a slow address lookup cannot land on another. */
  const openedRef = useRef<string | null>(null);
  const [quoteId, setQuoteId] = useState<string | null>(null);
  /**
   * The shop's delivery charge for this quote, as typed. Kept apart from
   * the line prices on purpose: quotes.total_price stays the books only,
   * and the buyer sees the two side by side before paying.
   */
  const [deliveryText, setDeliveryText] = useState('');
  const [loading, setLoading] = useState(true);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [busySaving, setBusySaving] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  /** Null while we do not yet know; false means signed in but not a vendor. */
  const [isVendor, setIsVendor] = useState<boolean | null>(null);
  /** Shown above the queue, e.g. "another shop accepted this first". */
  const [queueMessage, setQueueMessage] = useState<string | null>(null);
  /** The request whose "Accept & Quote" is in flight. */
  const [claimingId, setClaimingId] = useState<string | null>(null);

  /**
   * `quiet` is for background refreshes (realtime, after a claim): no
   * spinner, and a failure is logged rather than shown in the editor —
   * the queue on screen is still the last good one.
   */
  const loadQueue = useCallback(async (quiet = false) => {
    if (!quiet) {
      setLoading(true);
      setError(null);
    }
    try {
      const {
        data: { user },
        error: userError,
      } = await supabase.auth.getUser();
      if (userError) throw userError;
      if (!user) {
        setIsVendor(false);
        return;
      }

      // Being a vendor is a property of the PROFILE, not of having a
      // shop row yet. Conflating the two sent a newly signed-up vendor —
      // who now lands here automatically — to a gate telling them their
      // account is not a bookshop, which was simply untrue. A missing
      // vendors row is "finish setting up", handled in the screen.
      const { data: profile, error: profileError } = await supabase
        .from('profiles')
        .select('role')
        .eq('id', user.id)
        .maybeSingle();
      if (profileError) throw profileError;
      setIsVendor(profile?.role === 'vendor');
      if (profile?.role !== 'vendor') return;

      const { data: v, error: vendorError } = await supabase
        .from('vendors')
        .select('*')
        .eq('profile_id', user.id)
        .maybeSingle();
      if (vendorError) throw vendorError;

      setVendor((v ?? null) as Vendor | null);
      // No shop row yet: the queue RPC returns nothing, and the screen
      // shows the "add your business details" prompt.
      if (!v) return;

      const { data, error: queueError } = await supabase.rpc('vendor_request_queue');
      if (queueError) throw queueError;
      // A quote the customer declined is a finished offer, not work to do.
      // vendor_request_queue() already leaves those requests out
      // (bookshops_quote_decline_closes_offer.sql); this is the backstop
      // for a database where that has not been run yet.
      setQueue(
        ((data ?? []) as VendorQueueRow[]).filter((r) => r.my_quote_status !== 'rejected')
      );
    } catch (e) {
      if (quiet) console.warn('[vendor] queue refresh failed:', (e as Error).message);
      else setError(e as Error);
    } finally {
      if (!quiet) setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadQueue();
  }, [loadQueue]);

  // Live queue: a list another shop claims leaves this queue within a
  // second, and one released back to the pool comes back. RLS decides
  // which book_requests changes this shop hears about at all.
  const quietTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const vendorId = vendor?.id ?? null;
  useEffect(() => {
    if (!vendorId) return;
    const channel = freshChannel('vendor-request-pool')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'book_requests' }, () => {
        if (quietTimer.current) clearTimeout(quietTimer.current);
        quietTimer.current = setTimeout(() => loadQueue(true), 500);
      })
      .subscribe();
    return () => {
      if (quietTimer.current) clearTimeout(quietTimer.current);
      supabase.removeChannel(channel);
    };
  }, [vendorId, loadQueue]);

  /**
   * Opens a request: reads the buyer's lines, and this vendor's existing
   * quote lines if there is a draft, merging the two so a half-finished
   * quote reopens where it was left.
   */
  const openRequest = useCallback(
    async (row: VendorQueueRow) => {
      openedRef.current = row.request_id;
      setSelectedId(row.request_id);
      setImagePath(null);
      setDelivery(null);
      setDeliveryText('');
      setLoadingDetail(true);
      setNotice(null);
      setError(null);
      try {
        // The photo path is read alongside the lines. It is not on the
        // queue RPC's row, and requests_select_visible already lets a
        // vendor read any request that is in their queue.
        const [{ data: items, error: itemsError }, { data: req, error: reqError }] =
          await Promise.all([
            supabase
              .from('book_request_items')
              .select('id, request_id, title, category, quantity, unit_price, parsed, position, created_at, updated_at')
              .eq('request_id', row.request_id)
              .order('position', { ascending: true }),
            supabase
              .from('book_requests')
              .select('image_path')
              .eq('id', row.request_id)
              .maybeSingle(),
          ]);
        if (itemsError) throw itemsError;
        // Not fatal: without the path the editor behaves exactly as it
        // did before the photo viewer existed.
        if (reqError) console.warn('[vendor] booklist photo path not loaded:', reqError.message);
        setImagePath(req?.image_path ?? null);
        // Not awaited with the rest: a missing address must never hold up
        // the lines, and the editor says so plainly when there is none.
        loadRequestDelivery(row.request_id).then((d) => {
          if (openedRef.current === row.request_id) setDelivery(d);
        });

        let existing: QuoteItem[] = [];
        if (row.my_quote_id) {
          const [{ data: qi, error: qiError }, { data: head }] = await Promise.all([
            supabase.from('quote_items').select('*').eq('quote_id', row.my_quote_id),
            // Not fatal if the column is missing (migration not run yet):
            // the field just opens blank.
            supabase.from('quotes').select('delivery_fee').eq('id', row.my_quote_id).maybeSingle(),
          ]);
          if (qiError) throw qiError;
          existing = (qi ?? []) as QuoteItem[];
          const fee = (head as { delivery_fee?: number | null } | null)?.delivery_fee;
          setDeliveryText(fee == null ? '' : String(Number(fee)));
        }
        setQuoteId(row.my_quote_id);

        const byRequestItem = new Map(existing.map((q) => [q.request_item_id, q]));
        setLines(
          ((items ?? []) as BookRequestItem[]).map((item, i) => {
            const prior = byRequestItem.get(item.id);
            return {
              id: prior?.id ?? null,
              request_item_id: item.id,
              title: item.title,
              quantity: prior?.quantity ?? item.quantity,
              priceText: prior?.unit_price != null ? String(prior.unit_price) : '',
              is_available: prior?.is_available ?? true,
              position: i,
            };
          })
        );
      } catch (e) {
        setError(e as Error);
        setLines([]);
      } finally {
        setLoadingDetail(false);
      }
    },
    []
  );

  /**
   * "Accept & Quote". On an open-pool list nobody holds yet, claims it
   * first — so no other shop can start on the same list — then opens the
   * editor. Lists sent only to this shop, lists this shop already holds
   * and lists it has already quoted open straight away.
   */
  const acceptRequest = useCallback(
    async (row: VendorQueueRow) => {
      setQueueMessage(null);
      const needsClaim = !row.is_targeted && !row.claimed_by_me && !row.my_quote_id;
      if (!needsClaim) {
        await openRequest(row);
        return;
      }

      setClaimingId(row.request_id);
      try {
        const { data, error: e } = await supabase.rpc('claim_book_request', {
          p_request_id: row.request_id,
        });
        if (e) {
          // Claims not enabled on this database yet: behave as before.
          if (MISSING_FUNCTION.has(e.code ?? '')) {
            await openRequest(row);
            return;
          }
          setQueueMessage(e.message || 'This booklist is no longer available.');
          await loadQueue(true);
          return;
        }
        const claim = Array.isArray(data) ? (data[0] as { expires_at?: string | null }) : null;
        await openRequest({ ...row, claimed_by_me: true, claim_expires_at: claim?.expires_at ?? null });
        loadQueue(true);
      } finally {
        setClaimingId(null);
      }
    },
    [openRequest, loadQueue]
  );

  const setLinePrice = useCallback((requestItemId: string, priceText: string) => {
    setLines((prev) =>
      prev.map((l) => (l.request_item_id === requestItemId ? { ...l, priceText } : l))
    );
  }, []);

  const setLineAvailable = useCallback((requestItemId: string, available: boolean) => {
    setLines((prev) =>
      prev.map((l) =>
        l.request_item_id === requestItemId ? { ...l, is_available: available } : l
      )
    );
  }, []);

  /** Live figures for the footer — recomputed from the inputs, not the DB. */
  const totals = useMemo(() => {
    const available = lines.filter((l) => l.is_available);
    const priced = available.filter((l) => parsePrice(l.priceText) != null);
    const itemsTotal = priced.reduce(
      (sum, l) => sum + (parsePrice(l.priceText) ?? 0) * l.quantity,
      0
    );
    const deliveryFee = parsePrice(deliveryText);
    return {
      itemCount: available.reduce((n, l) => n + l.quantity, 0),
      unavailableCount: lines.length - available.length,
      unpricedCount: available.length - priced.length,
      /** Books only — what quotes.total_price will hold. */
      estimatedTotal: itemsTotal,
      /** Null until the shop types something; 0 is free delivery. */
      deliveryFee,
      /** What the buyer will be charged at checkout. */
      grandTotal: itemsTotal + (deliveryFee ?? 0),
    };
  }, [lines, deliveryText]);

  /**
   * Writes the quote and its lines.
   *
   * `status` is the only difference between Save as Draft and Submit —
   * the rows written are identical, so a submitted quote is exactly what
   * was previewed.
   */
  const saveQuote = useCallback(
    async (status: 'draft' | 'sent'): Promise<boolean> => {
      if (!vendor || !selectedId) return false;
      setBusySaving(true);
      setError(null);
      setNotice(null);

      try {
        if (status === 'sent' && totals.unpricedCount > 0) {
          throw new Error(
            `${totals.unpricedCount} available item${totals.unpricedCount === 1 ? '' : 's'} still need a price.`
          );
        }
        if (status === 'sent' && totals.deliveryFee == null) {
          throw new Error('Enter your delivery cost before sending — put 0 if delivery is free.');
        }

        // Upsert the quote header. total_price is recalculated by trigger
        // from the lines, so the value sent here is only a placeholder.
        //
        // A brand-new quote is created as a DRAFT and only promoted to
        // 'sent' after its lines are written. Inserting it as 'sent'
        // straight away told the buyer "New quote — ₦0" (the header lands
        // before the lines that price it) and then "revised" a second
        // later.
        let id = quoteId;
        if (id) {
          const { error: e } = await supabase
            .from('quotes')
            // Demoting to draft goes in the same write: a sent quote with
            // its delivery cleared would otherwise fail the "sent needs a
            // delivery fee" check before the status could change.
            .update({
              delivery_fee: totals.deliveryFee,
              ...(status === 'draft' ? { status: 'draft' as const } : {}),
              updated_at: new Date().toISOString(),
            })
            .eq('id', id);
          if (e) throw e;
        } else {
          const { data, error: e } = await supabase
            .from('quotes')
            .insert({
              request_id: selectedId,
              vendor_id: vendor.id,
              status: 'draft',
              total_price: 0,
              delivery_fee: totals.deliveryFee,
              item_breakdown: [],
            })
            .select('id')
            .single();
          if (e) throw e;
          id = data.id as string;
          setQuoteId(id);
        }

        // Replace the lines wholesale. Simpler and safer than diffing:
        // the delete and insert are scoped to this quote, which only this
        // vendor can touch.
        const { error: delError } = await supabase.from('quote_items').delete().eq('quote_id', id);
        if (delError) throw delError;

        const payload = lines.map((l) => ({
          quote_id: id,
          request_item_id: l.request_item_id,
          title: l.title,
          quantity: l.quantity,
          unit_price: parsePrice(l.priceText),
          is_available: l.is_available,
          position: l.position,
        }));
        if (payload.length) {
          const { error: insError } = await supabase.from('quote_items').insert(payload);
          if (insError) throw insError;
        }

        // Now the lines (and so the total) are in place, set the status.
        const { error: statusError } = await supabase
          .from('quotes')
          .update({ status, updated_at: new Date().toISOString() })
          .eq('id', id);
        if (statusError) throw statusError;

        // Move the request along so the buyer sees it has been quoted.
        if (status === 'sent') {
          const { error: reqError } = await supabase
            .from('book_requests')
            .update({ status: 'quoted', updated_at: new Date().toISOString() })
            .eq('id', selectedId);
          // Not fatal: requests_update_own is scoped to the buyer, so a
          // vendor cannot move it. The buyer's own view derives the same
          // thing from the quotes anyway.
          if (reqError) console.warn('[vendor] request status not updated:', reqError.message);
        }

        setNotice(status === 'draft' ? 'Draft saved.' : 'Quote sent to the customer.');
        await loadQueue();
        return true;
      } catch (e) {
        if (isClaimLost(e)) {
          // The claim lapsed and another shop took the list. The editor
          // is about to close (the row leaves the queue), so say why
          // where the vendor will still see it.
          setQueueMessage((e as Error).message);
          setSelectedId(null);
          setLines([]);
          setImagePath(null);
          setDelivery(null);
          await loadQueue(true);
          return false;
        }
        setError(e as Error);
        return false;
      } finally {
        setBusySaving(false);
      }
    },
    [vendor, selectedId, quoteId, lines, totals, loadQueue]
  );

  const declineRequest = useCallback(
    async (row: VendorQueueRow, reason?: string) => {
      if (!vendor) return;
      setError(null);
      const { error: e } = await supabase
        .from('request_declines')
        .upsert(
          { request_id: row.request_id, vendor_id: vendor.id, reason: reason ?? null },
          { onConflict: 'request_id,vendor_id' }
        );
      if (e) {
        setError(e as unknown as Error);
        return;
      }
      if (selectedId === row.request_id) {
        setSelectedId(null);
        setLines([]);
        setImagePath(null);
        setDelivery(null);
      }
      await loadQueue();
    },
    [vendor, selectedId, loadQueue]
  );

  const setBusyMode = useCallback(
    async (on: boolean) => {
      if (!vendor) return;
      const previous = vendor;
      setVendor({ ...vendor, busy_mode: on });
      const { error: e } = await supabase
        .from('vendors')
        .update({ busy_mode: on, updated_at: new Date().toISOString() })
        .eq('id', vendor.id);
      if (e) {
        setVendor(previous);
        setError(e as unknown as Error);
      }
    },
    [vendor]
  );

  const selected = useMemo(
    () => queue.find((r) => r.request_id === selectedId) ?? null,
    [queue, selectedId]
  );

  return {
    vendor,
    isVendor,
    queue,
    selected,
    lines,
    imagePath,
    delivery,
    totals,
    loading,
    loadingDetail,
    busySaving,
    error,
    notice,
    openRequest,
    acceptRequest,
    claimingId,
    queueMessage,
    dismissQueueMessage: () => setQueueMessage(null),
    closeRequest: () => {
      setSelectedId(null);
      setLines([]);
      setImagePath(null);
      setDelivery(null);
      setDeliveryText('');
    },
    deliveryText,
    setDeliveryText,
    setLinePrice,
    setLineAvailable,
    saveQuote,
    declineRequest,
    setBusyMode,
    refresh: () => loadQueue(),
  };
}
