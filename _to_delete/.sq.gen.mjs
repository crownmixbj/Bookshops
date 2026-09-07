
const DRAFT_STATUS = 'draft';
export const STATUS_FROM_QUOTE = {
  sent: 'received',
  accepted: 'accepted',
  rejected: 'declined',
  withdrawn: 'declined',
  expired: 'expired'
};
export function buildCards(requests, quoteRows, vendorId) {
  const itemCountOf = (r) => Number(r.book_request_items?.[0]?.count) || 0;
  const quoteByRequest = new Map();
  for (const q of quoteRows) {
    const existing = quoteByRequest.get(q.request_id);
    if (!existing || String(q.created_at) > String(existing.created_at)) quoteByRequest.set(q.request_id, q);
  }
  const cards = [];
      for (const r of requests) {
        const quote = quoteByRequest.get(r.id);
        const addressedHere = r.target_vendor_id === vendorId;
        if (!quote && !addressedHere) continue;
        if (!quote && r.status === DRAFT_STATUS) continue; // never sent

        cards.push({
          quoteId: quote?.id ?? null,
          requestId: r.id,
          title: r.school_name || 'Untitled booklist',
          classLevel: r.class_level || null,
          submittedAt: r.created_at,
          status: quote ? STATUS_FROM_QUOTE[quote.status] ?? 'received' : 'awaiting',
          total: quote?.total_price == null ? null : Number(quote.total_price),
          quotedItems: Number(quote?.quote_items?.[0]?.count) || 0,
          requestedItems: itemCountOf(r)
        });
      }
      
  return cards;
}
export function buildSendable(requests, vendorId) {
  const itemCountOf = (r) => Number(r.book_request_items?.[0]?.count) || 0;
  return requests.filter(r => r.target_vendor_id !== vendorId && r.status !== 'ordered' && r.status !== 'cancelled').map(r => ({
        id: r.id,
        title: r.school_name || 'Untitled booklist',
        classLevel: r.class_level || null,
        itemCount: itemCountOf(r),
        isDraft: r.status === DRAFT_STATUS,
        alreadyPublished: r.status !== DRAFT_STATUS
      }));
}