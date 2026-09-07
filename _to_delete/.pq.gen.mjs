export function ratingFor(vendor) {
  const rating = vendor?.rating == null ? null : Number(vendor.rating);
  return {
    rating: Number.isFinite(rating) ? rating : null,
    review_count: Number(vendor?.review_count) || 0
  };
}

export function pendingQuotesFrom(quotes) {
  const pendingQuotes = quotes.filter(q => q.status === 'sent').map(q => ({
      id: q.id,
      vendor_name: q.vendors?.store_name ?? 'Vendor (name hidden by RLS)',
      total_price: Number(q.total_price) || 0,
      status: q.status,
      ...ratingFor(q.vendors)
    }));
  return pendingQuotes;
}
