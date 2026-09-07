import { transformFileSync } from '@babel/core';
import { writeFileSync } from 'fs';
import path from 'path';

const root = process.cwd();
const out = transformFileSync(path.join(root, 'lib/booklistPricing.ts'), {
  presets: [['@babel/preset-typescript', { isTSX: false, allExtensions: true }]],
  plugins: [],
  filename: 'booklistPricing.ts',
  configFile: false, babelrc: false,
}).code;
const tmp = process.cwd() + '/.booklistPricing.gen.mjs';
writeFileSync(tmp, out);
const { pickPricingQuote, priceBooklistItems, sumLineTotals, hasQuotedLines, totalsAgree } = await import(tmp);

const P = JSON.parse(process.argv[2]);
const quote = P.quote;
const picked = pickPricingQuote([quote]);
const priced = priceBooklistItems(P.items, P.quote_items, picked?.id ?? null);
const sum = sumLineTotals(priced);

let fail = 0;
const eq = (name, a, b) => { const ok = a === b; if (!ok) fail++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}: ${a}${ok ? '' : ' != ' + b}`); };

eq('pricing quote picked', picked?.id, quote.id);
eq('sum of lines === quotes.total_price', sum, Number(quote.total_price));
eq('totalsAgree', totalsAgree(sum, Number(quote.total_price)), true);
eq('hasQuotedLines', hasQuotedLines(priced), true);
eq('out-of-stock lines', priced.filter(i => !i.isAvailable).length, 3);
eq('lines with a price shown', priced.filter(i => i.lineTotal != null).length, 9);
eq('lines still "awaiting"', priced.filter(i => i.isAvailable && i.lineTotal == null).length, 0);
eq('every line resolved from the quote', priced.every(i => i.priceSource === 'quote'), true);

// no-quote path: nothing should be priced, and no total should show
const unquoted = priceBooklistItems(P.items, [], null);
eq('no quote -> zero total', sumLineTotals(unquoted), 0);
eq('no quote -> no quoted lines', hasQuotedLines(unquoted), false);
eq('no quote -> all priceSource none', unquoted.every(i => i.priceSource === 'none'), true);

// partial-quantity path
const partial = priceBooklistItems(
  [{ id: 'x', quantity: 3, unit_price: null }],
  [{ quote_id: 'q', request_item_id: 'x', quantity: 2, unit_price: 4500, is_available: true }],
  'q'
);
eq('partial qty line total', partial[0].lineTotal, 9000);
eq('partial qty recorded', partial[0].effectiveQuantity, 2);

console.log(fail === 0 ? '\nALL PASS' : `\n${fail} FAILED`);
process.exit(fail === 0 ? 0 : 1);
