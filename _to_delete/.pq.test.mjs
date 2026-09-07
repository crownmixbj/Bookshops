import { transformFileSync } from '@babel/core';
import { writeFileSync } from 'fs';

// Lift the real ratingFor and the real pendingQuotes mapping out of the
// hook rather than re-implementing them.
const src = transformFileSync('hooks/useDashboardData.js', {
  presets: [['@babel/preset-typescript', { allExtensions: true }]],
  filename: 'd.js', configFile: false, babelrc: false }).code;

const rf = src.slice(src.indexOf('function ratingFor'));
const ratingForSrc = rf.slice(0, rf.indexOf('\n}\n') + 3);
const map = src.slice(src.indexOf('const pendingQuotes = quotes'));
const mapSrc = map.slice(0, map.indexOf('}));') + 4);
writeFileSync('.pq.gen.mjs',
  `export ${ratingForSrc}\nexport function pendingQuotesFrom(quotes) {\n  ${mapSrc}\n  return pendingQuotes;\n}\n`);
const M = await import(process.cwd() + '/.pq.gen.mjs');

let fail = 0;
const eq=(n,a,b)=>{const ok=JSON.stringify(a)===JSON.stringify(b); if(!ok)fail++;
  console.log(`${ok?'PASS':'FAIL'}  ${n}: ${JSON.stringify(a)}${ok?'':' != '+JSON.stringify(b)}`);};

const FAKES = ['School Books & More', 'Laterna Books (Ikeja)', 'Campus Store Yaba'];
const names = (r) => r.map((q) => q.vendor_name);

console.log('--- the bug: zero quotes ---');
let r = M.pendingQuotesFrom([]);
eq('no quotes -> empty, not four fixtures', r, []);

console.log('--- the guard that also leaked fixtures ---');
r = M.pendingQuotesFrom([{ id: 'q1', status: 'draft', total_price: 1, vendors: null }]);
eq('only draft quotes -> empty', r, []);
r = M.pendingQuotesFrom([{ id: 'q1', status: 'accepted', total_price: 1, vendors: null }]);
eq('only accepted quotes -> empty', r, []);

console.log('--- real quotes ---');
const real = [
  { id: 'q1', status: 'sent', total_price: '57640.00',
    vendors: { store_name: 'Rasmed Bookshop', rating: null, review_count: 0 } },
  { id: 'q2', status: 'draft', total_price: '900', vendors: { store_name: 'Hidden', rating: 5 } },
  { id: 'q3', status: 'sent', total_price: '1200',
    vendors: { store_name: 'Edu mart', rating: '4.5', review_count: 12 } },
];
r = M.pendingQuotesFrom(real);
eq('only sent quotes survive', names(r), ['Rasmed Bookshop', 'Edu mart']);
eq('price coerced from numeric', r[0].total_price, 57640);
eq('an unrated shop is null, NOT 4.8', r[0].rating, null);
eq('...with no invented review count', r[0].review_count, 0);
eq('a real rating comes through as a number', r[1].rating, 4.5);
eq('...with its real review count', r[1].review_count, 12);
eq('no tagline is invented', r.every((q) => q.tagline === undefined), true);
eq('nothing is flagged demo', r.every((q) => q.demo === undefined), true);

console.log('--- no fixture shop can appear on any path ---');
let leaked = false;
for (const input of [[], [{ id: 'x', status: 'draft', vendors: null }], real]) {
  if (names(M.pendingQuotesFrom(input)).some((n) => FAKES.includes(n))) leaked = true;
}
eq('no path yields a fixture shop', leaked, false);

console.log('--- ratingFor directly ---');
eq('null rating stays null', M.ratingFor({ rating: null, review_count: 0 }), { rating: null, review_count: 0 });
eq('missing vendor (RLS hid it)', M.ratingFor(null), { rating: null, review_count: 0 });
eq('numeric string parsed', M.ratingFor({ rating: '4.8', review_count: '3' }), { rating: 4.8, review_count: 3 });
eq('garbage rating -> null, not NaN', M.ratingFor({ rating: 'x' }), { rating: null, review_count: 0 });

console.log(fail === 0 ? '\nALL PASS' : `\n${fail} FAILED`);
process.exit(fail?1:0);
