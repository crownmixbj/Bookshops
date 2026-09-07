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
export const MOCK_BOOKLIST_ITEMS = [{
  id: 'm-i1',
  title: 'New General Mathematics SS1',
  unit_price: 2500,
  quantity: 1,
  checked: true,
  in_stock: true
}, {
  id: 'm-i2',
  title: 'Basic Science & Tech JSS3',
  unit_price: 1800,
  quantity: 1,
  checked: true,
  in_stock: true
}, {
  id: 'm-i3',
  title: 'History of Nigeria',
  unit_price: 3200,
  quantity: 1,
  checked: true,
  in_stock: true
}, {
  id: 'm-i4',
  title: 'Cambridge English Dictionary',
  unit_price: 7500,
  quantity: 1,
  checked: true,
  in_stock: false
}];

/*
 * REMOVED: MOCK_VENDOR_RATINGS / MOCK_VENDOR_RATING_DEFAULT.
 *
 * `vendors.rating` and `vendors.review_count` exist now, so the app
 * reads them. They are null on a shop nobody has reviewed, and the UI
 * says "No ratings yet" — which is true. The fixture printed a
 * confident "4.8 ★★★★★ Fast & Reliable" beside every real shop's name:
 * invented social proof about a real business, which is a worse thing
 * to ship than a blank.
 */

/**
 * TODO(db): needs a `categories` table (id, label, image_url, sort_order)
 *   or a `products` table these tiles would filter.
 *
 * There is no product catalogue in the schema — the app only models
 * booklist requests and quotes against them. Stationery / Uniforms /
 * Shoes have nothing behind them yet.
 */
// Shaped as types/catalog.ts `Category`, so the day a categories table
// lands the rows drop straight in and no caller changes. `slug` is what
// the URL carries: /categories/stationery — kept beside the name so the
// tile and its route cannot drift apart.
//
// image_url and item_count are deliberately absent rather than filled
// with stock photography and invented totals: the card renders neither
// when they are missing, which is the truth about a catalogue that does
// not exist yet.
export const MOCK_CATEGORIES = [{
  id: 'c-stationery',
  slug: 'stationery',
  name: 'Stationery',
  description: 'Pens, notebooks, sets',
  accent: '#FDE8D2',
  icon: 'pencil-outline'
}, {
  id: 'c-uniforms',
  slug: 'uniforms',
  name: 'Uniforms',
  description: 'By school and size',
  accent: '#DCE7F8',
  icon: 'shirt-outline'
}, {
  id: 'c-shoes',
  slug: 'school-shoes',
  name: 'School Shoes',
  description: 'Black leather, sandals',
  accent: '#E2E6EC',
  icon: 'footsteps-outline'
}, {
  id: 'c-new',
  slug: 'new-arrivals',
  name: 'New Arrivals',
  description: 'Fresh this term',
  accent: '#E4F2E8',
  icon: 'sparkles-outline'
}];

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
export const MOCK_BOOKLIST_REQUESTS = [{
  id: 'm-r1',
  demo: true,
  // vendor_name is what the card's header renders. The real path derives
  // it from the first quote's vendor; the demo row must supply it itself.
  vendor_name: 'Laterna Books (Ikeja)',
  school_name: 'Chrisland College',
  class_level: 'SS1',
  status: 'quoted',
  created_at: new Date().toISOString(),
  items: MOCK_BOOKLIST_ITEMS
}];

/*
 * REMOVED: MOCK_QUOTES.
 *
 * Four invented shops offering invented prices, shown on the buyer's
 * dashboard whenever the real query came back empty. "My Pending Quotes"
 * now shows its empty state instead, because no quotes is a true and
 * useful answer and four fake ones are neither.
 */

export const MOCK_FEATURED_SHOP = {
  id: 'm-v1',
  demo: true,
  store_name: 'Laterna Books (Ikeja)',
  city: 'Ikeja',
  rating: 4.8,
  review_count: 214
};