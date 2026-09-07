import { transformFileSync } from '@babel/core';
import { writeFileSync } from 'fs';

const code = transformFileSync('lib/booklistPricing.ts', {
  presets: [['@babel/preset-typescript', { allExtensions: true }]],
  filename: 'booklistPricing.ts', configFile: false, babelrc: false,
}).code;
writeFileSync('.bp.gen.mjs', code);
const M = await import(process.cwd() + '/.bp.gen.mjs');

const P = JSON.parse(process.argv[2]);
let fail = 0;
const eq = (n, a, b) => { const ok = JSON.stringify(a) === JSON.stringify(b); if (!ok) fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}: ${JSON.stringify(a)}${ok ? '' : ' != ' + JSON.stringify(b)}`); };

// --- mapRequestItems, mirrored exactly from hooks/useDashboardData.js ---
const mapRequestItems = (rows, quoteItems, pricingQuoteId) =>
  M.priceBooklistItems(rows, quoteItems, pricingQuoteId).map((row) => ({
    id: row.id,
    unit_price: row.effectiveUnitPrice,
    quantity: row.effectiveQuantity,
    requested_quantity: Number(row.quantity) || 1,
    line_total: row.lineTotal,
    is_available: row.isAvailable,
    price_source: row.priceSource,
    checked: true,
  }));

const orderTotal = (items) => items.filter((i) => i.checked !== false).reduce(
  (sum, i) => sum + (i.line_total != null ? Number(i.line_total)
    : (Number(i.unit_price) || 0) * (Number(i.quantity) || 1)), 0);

const label = (i, hasQuote) => {
  const s = M.linePriceState({ lineTotal: i.line_total, isAvailable: i.is_available !== false }, hasQuote);
  return s === 'priced' ? `NGN${i.line_total}` : M.LINE_PRICE_LABEL[s];
};

// === quoted booklist (the real accepted quote) ===
const picked = M.pickPricingQuote([P.quote]);
const mapped = mapRequestItems(P.items, P.quote_items, picked.id);
const hasQuote = true;

eq('order total === quotes.total_price', orderTotal(mapped), Number(P.quote.total_price));
eq('priced rows', mapped.filter((i) => i.line_total != null).length, 9);
eq('no row says Awaiting quote', mapped.filter((i) => label(i, hasQuote) === 'Awaiting quote').length, 0);
eq('out-of-stock rows labelled', mapped.filter((i) => label(i, hasQuote) === 'Out of stock').length, 3);
eq('first row label', label(mapped[0], hasQuote), 'NGN8000');

// unticking one line drops the total by exactly that line
const minusFirst = mapped.map((i, n) => (n === 0 ? { ...i, checked: false } : i));
eq('unticking a line', orderTotal(minusFirst), Number(P.quote.total_price) - 8000);

// === no quote yet ===
const none = mapRequestItems(P.items, [], null);
eq('no quote -> zero total', orderTotal(none), 0);
eq('no quote -> every row Awaiting quote', [...new Set(none.map((i) => label(i, false)))], ['Awaiting quote']);

// === quote came back but skipped a line ===
const partial = mapRequestItems(
  [{ id: 'a', quantity: 1, unit_price: null }, { id: 'b', quantity: 1, unit_price: null }],
  [{ quote_id: 'Q', request_item_id: 'a', quantity: 1, unit_price: 4500, is_available: true }],
  'Q'
);
eq('skipped line -> Not quoted', partial.map((i) => label(i, true)), ['NGN4500', 'Not quoted']);

// === null/undefined safety ===
eq('null quoteItems tolerated', mapRequestItems(P.items, [], undefined).length, 12);
eq('empty items tolerated', mapRequestItems([], P.quote_items, 'Q'), []);
eq('no quotes -> pickPricingQuote null', M.pickPricingQuote([]), null);
eq('draft-only quotes -> null', M.pickPricingQuote([{ id: 'd', status: 'draft', total_price: 999 }]), null);

// === demo rows: unit_price only, no line_total ===
eq('demo row total', orderTotal([{ unit_price: 2500, quantity: 2, checked: true }]), 5000);
eq('demo row label', label({ line_total: null, unit_price: 2500, is_available: true }, false), 'Awaiting quote');

console.log(fail === 0 ? '\nALL PASS' : `\n${fail} FAILED`);
process.exit(fail === 0 ? 0 : 1);
