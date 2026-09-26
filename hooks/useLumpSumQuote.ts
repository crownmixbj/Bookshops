import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '../utils/supabase';
import {
  MAX_RESPONSE_FILES,
  parseResponseFiles,
  prepareResponseFile,
  releasePickedFile,
  removeQuoteResponse,
  uploadQuoteResponse,
  type PickedFile,
  type StoredFile,
} from '../lib/quoteFiles';
import type { QuoteStatus } from '../types/db';

/**
 * A single-total quote for a photo-only booklist.
 *
 * The shop prices the list on its own sheet and attaches it, as one or
 * more pages (photos and/or PDFs, up to 10, 5 MB each). Next to it goes
 * one total and an optional note. The total is what checkout charges;
 * the pages are what the buyer checks it against.
 *
 * Server-side rules back everything validated here
 * (bookshops_lump_sum_quotes.sql, bookshops_quote_multi_files.sql).
 */

/** One page in the form: already uploaded, or picked and waiting to upload. */
export type Page =
  | { key: string; kind: 'stored'; file: StoredFile }
  | { key: string; kind: 'pending'; file: PickedFile };

let pageSeq = 0;
const nextKey = () => `p${Date.now()}-${pageSeq++}`;

function parseTotal(text: string): number | null {
  const cleaned = text.replace(/[^0-9.]/g, '');
  if (!cleaned) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : null;
}

export const NOTE_MAX = 1000;

export function useLumpSumQuote({
  vendorId,
  requestId,
  initialQuoteId,
}: {
  vendorId: string | null;
  requestId: string;
  initialQuoteId: string | null;
}) {
  const [quoteId, setQuoteId] = useState<string | null>(initialQuoteId);
  const [status, setStatus] = useState<QuoteStatus | null>(null);
  const [totalText, setTotalText] = useState('');
  const [note, setNote] = useState('');
  const [pages, setPagesState] = useState<Page[]>([]);
  /** Uploaded files the vendor removed; deleted from storage after a save. */
  const removedRef = useRef<StoredFile[]>([]);
  const [preparing, setPreparing] = useState(0);
  const [loading, setLoading] = useState(!!initialQuoteId);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // Mirrored in a ref so unmount can free picked web blobs.
  const pagesRef = useRef<Page[]>([]);
  const setPages = useCallback((next: Page[] | ((prev: Page[]) => Page[])) => {
    setPagesState((prev) => {
      const value = typeof next === 'function' ? next(prev) : next;
      pagesRef.current = value;
      return value;
    });
  }, []);
  useEffect(
    () => () => {
      for (const p of pagesRef.current) if (p.kind === 'pending') releasePickedFile(p.file);
    },
    []
  );

  // Reopening a draft (or a sent quote to revise) starts where it was left.
  useEffect(() => {
    setQuoteId(initialQuoteId);
    setError(null);
    setNotice(null);
    removedRef.current = [];
    for (const p of pagesRef.current) if (p.kind === 'pending') releasePickedFile(p.file);
    setPages([]);
    if (!initialQuoteId) {
      setStatus(null);
      setTotalText('');
      setNote('');
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    (async () => {
      const { data, error: e } = await supabase
        .from('quotes')
        .select('status, pricing_mode, total_price, vendor_note, response_files')
        .eq('id', initialQuoteId)
        .maybeSingle();
      if (cancelled) return;
      if (e) setError(e.message);
      else if (data) {
        setStatus(data.status as QuoteStatus);
        const total = Number(data.total_price) || 0;
        setTotalText(data.pricing_mode === 'lump_sum' && total > 0 ? String(total) : '');
        setNote(data.vendor_note ?? '');
        setPages(
          parseResponseFiles(data.response_files).map((file) => ({
            key: nextKey(),
            kind: 'stored' as const,
            file,
          }))
        );
      }
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [initialQuoteId, requestId, setPages]);

  const total = parseTotal(totalText);
  // Accepted: the customer is paying for exactly this. Rejected: the
  // customer said no, and that offer is closed for good.
  const locked = status === 'accepted' || status === 'rejected';
  const busy = saving || preparing > 0;
  const canSend = !locked && !busy && total != null && total > 0 && pages.length > 0;
  const roomLeft = MAX_RESPONSE_FILES - pages.length;

  /**
   * Adds picked files as new pages, in the order given.
   *
   * Each one is shrunk (photos) and size-checked here, at pick time, so an
   * oversized page is reported while the vendor can still fix it. Files
   * that fail are listed in the error; the rest are still added.
   */
  const addFiles = useCallback(
    async (picked: PickedFile[], alreadyRejected: string[] = []) => {
      setError(null);
      setNotice(null);
      const problems = [...alreadyRejected];
      let room = MAX_RESPONSE_FILES - pagesRef.current.length;
      const accepted: PickedFile[] = [];
      for (const f of picked) {
        if (room <= 0) {
          problems.push(`${f.fileName}: a quote can have at most ${MAX_RESPONSE_FILES} files.`);
          releasePickedFile(f);
          continue;
        }
        room -= 1;
        accepted.push(f);
      }

      setPreparing((n) => n + accepted.length);
      for (const f of accepted) {
        try {
          const ready = await prepareResponseFile(f);
          setPages((prev) => [...prev, { key: nextKey(), kind: 'pending', file: ready }]);
        } catch (e) {
          problems.push(`${f.fileName} ${(e as Error).message}`);
        } finally {
          setPreparing((n) => n - 1);
        }
      }
      if (problems.length) setError(problems.join('\n'));
    },
    [setPages]
  );

  const removePage = useCallback(
    (key: string) => {
      // Side effects outside the state updater: React may run an updater
      // twice in development, which would queue the file for deletion twice.
      const page = pagesRef.current.find((p) => p.key === key);
      if (!page) return;
      if (page.kind === 'pending') releasePickedFile(page.file);
      else removedRef.current.push(page.file);
      setPages((prev) => prev.filter((p) => p.key !== key));
    },
    [setPages]
  );

  const movePage = useCallback(
    (key: string, delta: -1 | 1) => {
      setPages((prev) => {
        const i = prev.findIndex((p) => p.key === key);
        const j = i + delta;
        if (i < 0 || j < 0 || j >= prev.length) return prev;
        const next = [...prev];
        [next[i], next[j]] = [next[j], next[i]];
        return next;
      });
    },
    [setPages]
  );

  const save = useCallback(
    async (target: 'draft' | 'sent'): Promise<boolean> => {
      if (!vendorId) {
        setError('Your shop details are still loading. Try again in a moment.');
        return false;
      }
      if (locked) {
        setError(
          status === 'rejected'
            ? 'The customer declined this quote, so it is closed.'
            : 'The customer has accepted this quote, so it can no longer be changed.'
        );
        return false;
      }
      if (preparing > 0) {
        setError('Wait for your files to finish preparing.');
        return false;
      }
      if (target === 'sent') {
        if (total == null || total <= 0) {
          setError('Enter the total for this booklist before sending.');
          return false;
        }
        if (!pages.length) {
          setError('Attach your priced sheet (photos or a PDF) so the customer can check the total.');
          return false;
        }
      }
      const trimmedNote = note.trim();
      if (trimmedNote.length > NOTE_MAX) {
        setError(`Keep the note under ${NOTE_MAX} characters.`);
        return false;
      }

      setSaving(true);
      setError(null);
      setNotice(null);
      const uploaded: StoredFile[] = [];

      try {
        // 1. A quote row must exist first: the files' paths contain its id.
        //    Created as a draft so "sent needs a file" cannot trip early.
        let id = quoteId;
        if (!id) {
          const { data, error: e } = await supabase
            .from('quotes')
            .insert({
              request_id: requestId,
              vendor_id: vendorId,
              status: 'draft',
              pricing_mode: 'lump_sum',
              total_price: total ?? 0,
              item_breakdown: [],
            })
            .select('id')
            .single();
          if (e) throw e;
          id = data.id as string;
          setQuoteId(id);
        }

        // 2. Upload waiting pages in order, keeping the page order.
        const finalFiles: StoredFile[] = [];
        for (const page of pages) {
          if (page.kind === 'stored') {
            finalFiles.push(page.file);
          } else {
            const stored = await uploadQuoteResponse(vendorId, id, page.file);
            uploaded.push(stored);
            finalFiles.push(stored);
          }
        }

        // 3. The whole set, total, note and status in ONE write, so the
        //    customer never sees a half-updated set of pages.
        const { error: e } = await supabase
          .from('quotes')
          .update({
            pricing_mode: 'lump_sum',
            total_price: total ?? 0,
            vendor_note: trimmedNote || null,
            response_files: finalFiles,
            status: target,
            updated_at: new Date().toISOString(),
          })
          .eq('id', id);
        if (e) throw e;

        // 4. Tidy up only after the row points at the new set.
        for (const f of removedRef.current) removeQuoteResponse(f.path);
        removedRef.current = [];
        for (const p of pages) if (p.kind === 'pending') releasePickedFile(p.file);
        setPages(finalFiles.map((file) => ({ key: nextKey(), kind: 'stored' as const, file })));
        setStatus(target);
        setNotice(target === 'draft' ? 'Draft saved.' : 'Quote sent to the customer.');
        return true;
      } catch (e) {
        // The row never pointed at these uploads; do not leave them behind.
        for (const f of uploaded) removeQuoteResponse(f.path);
        setError(describeSaveError(e));
        return false;
      } finally {
        setSaving(false);
      }
    },
    [vendorId, locked, status, preparing, total, pages, note, quoteId, requestId, setPages]
  );

  return {
    quoteId,
    status,
    locked,
    loading,
    saving,
    preparing,
    busy,
    error,
    notice,
    totalText,
    setTotalText,
    total,
    note,
    setNote,
    pages,
    roomLeft,
    addFiles,
    removePage,
    movePage,
    clearError: () => setError(null),
    setError,
    canSend,
    save,
  };
}

function describeSaveError(e: unknown): string {
  const message = (e as { message?: string })?.message ?? '';
  if (/itemised lines/i.test(message)) {
    return 'The customer has since added items to this booklist. Close and reopen it to price the lines.';
  }
  if (/row-level security|violates row-level|403|Unauthorized/i.test(message)) {
    return 'Your shop is not approved to send quotes yet, or this request is no longer open to you.';
  }
  if (/quotes_lump_sum_complete/i.test(message)) {
    return 'A quote needs a total and at least one page of your priced sheet before it can be sent.';
  }
  if (/quotes_response_files_valid/i.test(message)) {
    return 'One of the files could not be accepted (too many, too large, or an unsupported type).';
  }
  return message || 'The quote could not be saved. Check your connection and try again.';
}
