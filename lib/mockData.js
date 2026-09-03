/**
 * ============================================================
 * MOCK DATA — NOT BACKED BY THE DATABASE
 * ============================================================
 *
 * Everything in this file exists because the mockup shows it but the
 * Supabase schema has nowhere to store it. Each export names the table
 * or column that would have to exist for it to become real.
 *
 * Audited against project stychjbzqqfbzmwrdhnf on 2026-08-31. If you add
 * the tables below, delete the matching export here and the corresponding
 * `?? MOCK_*` fallback in hooks/useDashboardData.js — the UI needs no
 * other change.
 */

/**
 * DEMO ONLY — no longer a fallback for real requests.
 *
 * book_request_items now exists, and useDashboardData reads it: a real
 * request shows its own saved lines, a vendor's quotes.item_breakdown if
 * it has none, and an empty state if it has neither. These rows are used
 * exclusively by MOCK_BOOKLIST_REQUESTS below, which stands in when
 * nobody is signed in, so the layout is workable during development.
 */
export const MOCK_BOOKLIST_ITEMS = [
  { id: 'm-i1', title: 'New General Mathematics SS1', unit_price: 2500, quantity: 1, checked: true, in_stock: true },
  { id: 'm-i2', title: 'Basic Science & Tech JSS3', unit_price: 1800, quantity: 1, checked: true, in_stock: true },
  { id: 'm-i3', title: 'History of Nigeria', unit_price: 3200, quantity: 1, checked: true, in_stock: true },
  { id: 'm-i4', title: 'Cambridge English Dictionary', unit_price: 7500, quantity: 1, checked: true, in_stock: false },
];

/**
 * TODO(db): needs `vendors.rating` (numeric) and `vendors.review_count`
 *   (int), or a `vendor_reviews` table aggregated into a view.
 *
 * The mockup shows "4.8 ★★★★★ Fast & Reliable" on every vendor row.
 * `vendors` has no rating column at all, so this is invented. Keyed by
 * vendor id at runtime; falls back to the DEFAULT below.
 */
export const MOCK_VENDOR_RATINGS = {};
export const MOCK_VENDOR_RATING_DEFAULT = { rating: 4.8, review_count: 132, tagline: 'Fast & Reliable' };

/**
 * TODO(db): needs a `categories` table (id, label, image_url, sort_order)
 *   or a `products` table these tiles would filter.
 *
 * There is no product catalogue in the schema — the app only models
 * booklist requests and quotes against them. Stationery / Uniforms /
 * Shoes have nothing behind them yet.
 */
// `slug` is what the URL carries: /categories/stationery. Kept next to
// the label so the tile and its route cannot drift apart.
export const MOCK_CATEGORIES = [
  { id: 'c-stationery', slug: 'stationery', label: 'Stationery', subtitle: 'Pens, notebooks, sets', accent: '#FDE8D2' },
  { id: 'c-uniforms', slug: 'uniforms', label: 'Uniforms', subtitle: 'By school and size', accent: '#DCE7F8' },
  { id: 'c-shoes', slug: 'school-shoes', label: 'School Shoes', subtitle: 'Black leather, sandals', accent: '#E2E6EC' },
  { id: 'c-new', slug: 'new-arrivals', label: 'New Arrivals', subtitle: 'Fresh this term', accent: '#E4F2E8' },
];

/**
 * TODO(db): needs `vendors.logo_url` / `vendors.banner_url`.
 *
 * The "Featured Shops" card shows a shop photo. `vendors` stores only
 * store_name, address, city and is_active — no imagery.
 */
export const MOCK_SHOP_IMAGE = null; // render initials in a coloured tile instead

/**
 * TODO(db): needs an inventory model.
 *
 * The "Low Stock" pill in the mockup implies stock levels per vendor per
 * title. Nothing in the schema tracks inventory.
 */
export const MOCK_LOW_STOCK_ENABLED = true;

/**
 * Shown only when there is no signed-in session or the tables come back
 * empty, so the screen is never a blank rectangle during development.
 * Set `demo: true` so the UI can badge it honestly.
 */
export const MOCK_BOOKLIST_REQUESTS = [
  {
    id: 'm-r1',
    demo: true,
    // vendor_name is what the card's header renders. The real path derives
    // it from the first quote's vendor; the demo row must supply it itself.
    vendor_name: 'Laterna Books (Ikeja)',
    school_name: 'Chrisland College',
    class_level: 'SS1',
    status: 'quoted',
    created_at: new Date().toISOString(),
    items: MOCK_BOOKLIST_ITEMS,
  },
];

export const MOCK_QUOTES = [
  { id: 'm-q1', demo: true, vendor_name: 'School Books & More', total_price: 2500, status: 'sent', rating: 4.8 },
  { id: 'm-q2', demo: true, vendor_name: 'Laterna Books (Ikeja)', total_price: 1800, status: 'sent', rating: 4.7 },
  { id: 'm-q3', demo: true, vendor_name: 'School Books & More', total_price: 7500, status: 'sent', rating: 4.8 },
  { id: 'm-q4', demo: true, vendor_name: 'Campus Store Yaba', total_price: 3200, status: 'sent', rating: 4.6 },
];

export const MOCK_FEATURED_SHOP = {
  id: 'm-v1',
  demo: true,
  store_name: 'Laterna Books (Ikeja)',
  city: 'Ikeja',
  rating: 4.8,
  review_count: 214,
};
