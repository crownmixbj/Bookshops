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
/*
 * REMOVED: MOCK_BOOKLIST_ITEMS.
 * Priced lines for the invented booklist below. The dashboard's order
 * summary sums the visible lines, so these were the naira figure that
 * flashed over the real total on every reload.
 */

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
export const MOCK_CATEGORIES = [
  {
    id: 'c-textbooks',
    slug: 'textbooks',
    name: 'Textbooks',
    description: 'Course books by school and class',
    accent: '#DCE7F8',
    icon: 'book-outline',
  },
  {
    id: 'c-stationery',
    slug: 'stationery',
    name: 'Stationery',
    description: 'Pens, notebooks, sets',
    accent: '#FDE8D2',
    icon: 'pencil-outline',
  },
  {
    id: 'c-uniforms',
    slug: 'uniforms',
    name: 'Uniforms',
    description: 'By school and size',
    accent: '#DCE7F8',
    icon: 'shirt-outline',
  },
  {
    id: 'c-shoes',
    slug: 'school-shoes',
    name: 'School Shoes',
    description: 'Black leather, sandals',
    accent: '#E2E6EC',
    icon: 'footsteps-outline',
  },
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
/*
 * REMOVED: MOCK_BOOKLIST_REQUESTS.
 * An invented booklist quoted by a shop that does not exist, shown
 * whenever the account looked empty — which included the first frame of
 * every reload, before the query had returned. The dashboard has real
 * empty states; it does not need a pretend booklist.
 */

/*
 * REMOVED: MOCK_QUOTES.
 *
 * Four invented shops offering invented prices, shown on the buyer's
 * dashboard whenever the real query came back empty. "My Pending Quotes"
 * now shows its empty state instead, because no quotes is a true and
 * useful answer and four fake ones are neither.
 */

/*
 * REMOVED: MOCK_FEATURED_SHOP.
 * "Laterna Books (Ikeja)", a shop nobody can visit, with a hardcoded
 * 4.8. Featured Shops renders "No shops yet" instead.
 */
