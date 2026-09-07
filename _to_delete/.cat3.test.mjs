import { transformFileSync } from '@babel/core';
import { writeFileSync } from 'fs';

// Lift the real aggregation + the real stockLabel out of the sources.
const hook = transformFileSync('hooks/useCategoryCatalog.ts', {
  presets: [['@babel/preset-typescript', { allExtensions: true }]],
  filename: 'h.ts', configFile: false, babelrc: false }).code;
const aggStart = hook.indexOf('const byProduct = new Map');
const aggEnd = hook.indexOf('setProducts(', aggStart);
const mapStart = hook.indexOf('rows\n', aggEnd);
const page = transformFileSync('app/categories/[slug].tsx', {
  presets: [['@babel/preset-typescript', { isTSX: true, allExtensions: true }]],
  filename: 'p.tsx', configFile: false, babelrc: false }).code;
const slStart = page.indexOf('function stockLabel');
const stockLabelSrc = page.slice(slStart, page.indexOf('\n}\n', slStart) + 3);

writeFileSync('.cat3.gen.mjs', `
export const LOW_STOCK_THRESHOLD = 5;
const colors = { surfaceMuted:'muted', textMuted:'muted', warningBg:'warnbg', warning:'warn', success:'ok' };
export ${stockLabelSrc}
export function aggregate(rows, listingRows) {
  ${hook.slice(aggStart, aggEnd)}
  return rows.map((product) => {
    const agg = byProduct.get(product.id);
    if (!agg || agg.min === null) return null;
    return { id: product.id, title: product.title,
      min_price: agg.min, multipleOffers: agg.offers > 1,
      total_stock: agg.stock, vendor_count: agg.shops.size };
  }).filter((p) => p !== null);
}`);
const M = await import(process.cwd() + '/.cat3.gen.mjs');

let fail = 0;
const eq=(n,a,b)=>{const ok=JSON.stringify(a)===JSON.stringify(b); if(!ok)fail++;
  console.log(`${ok?'PASS':'FAIL'}  ${n}: ${JSON.stringify(a)}${ok?'':' != '+JSON.stringify(b)}`);};

const P = [{ id: 'p1', title: 'Ruler set' }, { id: 'p2', title: 'Exercise books' }, { id: 'p3', title: 'Nobody stocks this' }];

console.log('--- price aggregation ---');
let r = M.aggregate(P, [
  { product_id: 'p1', shop_id: 's1', price: '5000.00', stock_quantity: 20 },
  { product_id: 'p1', shop_id: 's2', price: '4500.00', stock_quantity: 3 },
  { product_id: 'p2', shop_id: 's1', price: '1200.50', stock_quantity: 0 },
]);
eq('cheapest offer wins', r.find((p) => p.id === 'p1').min_price, 4500);
eq('two shops -> "From"', r.find((p) => p.id === 'p1').multipleOffers, true);
eq('one shop -> plain price', r.find((p) => p.id === 'p2').multipleOffers, false);
eq('stock summed across shops', r.find((p) => p.id === 'p1').total_stock, 23);
eq('distinct shops counted', r.find((p) => p.id === 'p1').vendor_count, 2);
eq('unstocked product dropped entirely', r.some((p) => p.id === 'p3'), false);
eq('numeric strings parsed', r.find((p) => p.id === 'p2').min_price, 1200.5);

console.log('--- same shop, no double-count ---');
r = M.aggregate([P[0]], [
  { product_id: 'p1', shop_id: 's1', price: '900', stock_quantity: 4 },
  { product_id: 'p1', shop_id: 's1', price: '800', stock_quantity: 6 },
]);
eq('one shop counted once', r[0].vendor_count, 1);
eq('...but both offers make it "From"', r[0].multipleOffers, true);

console.log('--- empty catalogue (today) ---');
eq('no listings -> empty list, no crash', M.aggregate(P, []), []);
eq('no products -> empty list', M.aggregate([], []), []);

console.log('--- stock labels ---');
eq('zero stock is NOT "In Stock"', M.stockLabel(0).label, 'Out of stock');
eq('negative guarded', M.stockLabel(-1).label, 'Out of stock');
eq('1 -> Low Stock', M.stockLabel(1).label, 'Low Stock');
eq('at the threshold -> Low Stock', M.stockLabel(5).label, 'Low Stock');
eq('above it -> In Stock', M.stockLabel(6).label, 'In Stock');

console.log(fail === 0 ? '\nALL PASS' : `\n${fail} FAILED`);
process.exit(fail?1:0);
