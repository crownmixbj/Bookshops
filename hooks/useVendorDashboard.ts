import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '../utils/supabase';
import type {
  BookRequestItem,
  QueueBadge,
  QuoteItem,
  Vendor,
  VendorQueueRow,
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
 */

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
  if (row.my_quote_status === 'accepted') return 'accepted';
  if (row.my_quote_status === 'sent') return 'sent';
  if (row.my_quote_status === 'draft') return 'processing';
  return row.is_targeted ? 'pending' : 'new';
}

export const BADGE_LABEL: Record<QueueBadge, string> = {
  new: 'New Request',
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
  const [quoteId, setQuoteId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [busySaving, setBusySaving] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  /** Null while we do not yet know; false means signed in but not a vendor. */
  const [isVendor, setIsVendor] = useState<boolean | null>(null);

  const loadQueue = useCallback(async () => {
    setLoading(true);
    setError(null);
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
      setQueue((data ?? []) as VendorQueueRow[]);
    } catch (e) {
      setError(e as Error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadQueue();
  }, [loadQueue]);

  /**
   * Opens a request: reads the buyer's lines, and this vendor's existing
   * quote lines if there is a draft, merging the two so a half-finished
   * quote reopens where it was left.
   */
  const openRequest = useCallback(
    async (row: VendorQueueRow) => {
      setSelectedId(row.request_id);
      setImagePath(null);
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

        let existing: QuoteItem[] = [];
        if (row.my_quote_id) {
          const { data: qi, error: qiError } = await supabase
            .from('quote_items')
            .select('*')
            .eq('quote_id', row.my_quote_id);
          if (qiError) throw qiError;
          existing = (qi ?? []) as QuoteItem[];
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
    return {
      itemCount: available.reduce((n, l) => n + l.quantity, 0),
      unavailableCount: lines.length - available.length,
      unpricedCount: available.length - priced.length,
      estimatedTotal: priced.reduce(
        (sum, l) => sum + (parsePrice(l.priceText) ?? 0) * l.quantity,
        0
      ),
    };
  }, [lines]);

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

        // Upsert the quote header. total_price is recalculated by trigger
        // from the lines, so the value sent here is only a placeholder.
        let id = quoteId;
        if (id) {
          const { error: e } = await supabase
            .from('quotes')
            .update({ status, updated_at: new Date().toISOString() })
            .eq('id', id);
          if (e) throw e;
        } else {
          const { data, error: e } = await supabase
            .from('quotes')
            .insert({
              request_id: selectedId,
              vendor_id: vendor.id,
              status,
              total_price: 0,
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
    totals,
    loading,
    loadingDetail,
    busySaving,
    error,
    notice,
    openRequest,
    closeRequest: () => {
      setSelectedId(null);
      setLines([]);
      setImagePath(null);
    },
    setLinePrice,
    setLineAvailable,
    saveQuote,
    declineRequest,
    setBusyMode,
    refresh: loadQueue,
  };
}
