export function bucketFor(request, quotes, order) {
  if (request.status === 'cancelled') return 'archived';
  // Explicit rather than falling through to the no-live-quotes branch
  // below: a draft has no quotes by construction, and saying so here is
  // what makes "Drafts & pending" mean something.
  if (request.status === 'draft') return 'draft';

  // Ordered lists leave Active whatever stage the delivery is at.
  //
  // "Active" on this page means a booklist still needing a decision from
  // the buyer, and an ordered one does not: it has been paid for, and My
  // Orders is the screen that tracks what happens next. Keeping it here
  // put the same purchase in two places, one of which could do nothing
  // with it. It moves to Archived rather than disappearing, so the list
  // itself is still readable from the page that owns booklists.
  if (request.status === 'ordered' || order) return 'archived';
  const liveQuotes = quotes.filter(q => q.status === 'sent' || q.status === 'accepted');
  return liveQuotes.length > 0 ? 'active' : 'draft';
}
