
export const LOW_STOCK_THRESHOLD = 5;
const colors = { surfaceMuted:'muted', textMuted:'muted', warningBg:'warnbg', warning:'warn', success:'ok' };
export function stockLabel(total) {
  if (total <= 0) return {
    label: 'Out of stock',
    bg: colors.surfaceMuted,
    fg: colors.textMuted
  };
  if (total <= LOW_STOCK_THRESHOLD) {
    return {
      label: 'Low Stock',
      bg: colors.warningBg,
      fg: colors.warning
    };
  }
  return {
    label: 'In Stock',
    bg: '#E4F2E8',
    fg: colors.success
  };
}

export function aggregate(rows, listingRows) {
  const byProduct = new Map();
      for (const listing of listingRows ?? []) {
        const key = listing.product_id;
        const entry = byProduct.get(key) ?? {
          min: null,
          stock: 0,
          shops: new Set(),
          offers: 0
        };
        const price = Number(listing.price);
        if (Number.isFinite(price) && (entry.min === null || price < entry.min)) entry.min = price;
        entry.stock += Number(listing.stock_quantity) || 0;
        entry.shops.add(listing.shop_id);
        entry.offers += 1;
        byProduct.set(key, entry);
      }
      
  return rows.map((product) => {
    const agg = byProduct.get(product.id);
    if (!agg || agg.min === null) return null;
    return { id: product.id, title: product.title,
      min_price: agg.min, multipleOffers: agg.offers > 1,
      total_stock: agg.stock, vendor_count: agg.shops.size };
  }).filter((p) => p !== null);
}