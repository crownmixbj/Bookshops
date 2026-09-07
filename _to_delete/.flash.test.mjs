import { transformFileSync } from '@babel/core';
import { writeFileSync } from 'fs';

// Lift the real derived-view logic out of the hook and replay the frames
// a reload actually goes through.
const hook = transformFileSync('hooks/useDashboardData.js', {
  presets: [['@babel/preset-typescript', { allExtensions: true }]],
  filename: 'd.js', configFile: false, babelrc: false }).code;

const viewStart = hook.indexOf('const view = useMemo(');
const bodyStart = hook.indexOf('{', hook.indexOf('=>', viewStart)) + 1;
let depth = 1, i = bodyStart;
while (depth > 0) { const ch = hook[i++]; if (ch === '{') depth++; else if (ch === '}') depth--; }
const body = hook.slice(bodyStart, i - 1);

// mapRequestItems is module-private in the hook; lift it verbatim too.
const mapStart = hook.indexOf('function mapRequestItems');
let md = 0, mj = hook.indexOf('{', mapStart);
const mStart = mj;
do { const ch = hook[mj++]; if (ch === '{') md++; else if (ch === '}') md--; } while (md > 0);
const mapFn = hook.slice(mapStart, mj);
writeFileSync('.flash.gen.mjs', `
import { pickPricingQuote, priceBooklistItems } from './lib/booklistPricing.ts.mjs';
function parseItemBreakdown() { return null; }
function ratingFor(v) { return { rating: v?.rating == null ? null : Number(v.rating), review_count: Number(v?.review_count) || 0 }; }
${mapFn}
export function derive(data, hasLoaded) { ${body} }
`);
// booklistPricing has no runtime deps beyond types.
writeFileSync('lib/booklistPricing.ts.mjs', transformFileSync('lib/booklistPricing.ts', {
  presets: [['@babel/preset-typescript', { allExtensions: true }]],
  filename: 'bp.ts', configFile: false, babelrc: false }).code.replace("'./booklistUpload'", "'./guessCategory.mjs'"));
writeFileSync('lib/guessCategory.mjs', `export function guessCategory(t){const s=String(t).toLowerCase();
if(/(uniform|shirt|sock|shoe|sandal)/.test(s))return 'uniform';
if(/(pen|pencil|note ?book|exercise book)/.test(s))return 'stationery';
return 'other';}`);
const { derive } = await import(process.cwd() + '/.flash.gen.mjs');

const EMPTY = { profile: null, email: null, requests: [], draftCount: 0, orderedCount: 0,
  items: [], quotes: [], quoteItems: [], vendors: [], orders: [] };

let fail = 0;
const eq=(n,a,b)=>{const ok=JSON.stringify(a)===JSON.stringify(b); if(!ok)fail++;
  console.log(`${ok?'PASS':'FAIL'}  ${n}: ${JSON.stringify(a)}${ok?'':' != '+JSON.stringify(b)}`);};

console.log('--- FRAME 1: the reload, before any query returns ---');
const f1 = derive(EMPTY, false);   // hasLoaded === false
eq('no booklist rows', f1.activeRequests.length, 0);
eq('order total is 0, not a fixture sum', f1.orderTotal, 0);
eq('no invented featured shop', f1.featuredShop, null);
eq('no pending quotes', f1.pendingQuotes.length, 0);
eq('nothing claims to be demo', f1.usingDemoData, false);
eq('not yet declared an empty account', f1.hasOnlyDrafts, false);

console.log('--- FRAME 2: real data lands ---');
const f2 = derive({ ...EMPTY,
  requests: [{ id: 'r1', school_name: 'Methodist', class_level: 'JSS2', status: 'pending_quote', created_at: '2026-09-01' }],
  items: [{ id: 'i1', request_id: 'r1', title: 'New General Mathematics', author: 'Evans', category: 'other', quantity: 1, unit_price: null }],
  quotes: [{ id: 'q1', request_id: 'r1', vendor_id: 'v1', status: 'sent', total_price: '8000', vendors: { store_name: 'Rasmed Bookshop', rating: null, review_count: 0 } }],
  quoteItems: [{ id: 'l1', quote_id: 'q1', request_item_id: 'i1', quantity: 1, unit_price: 8000, is_available: true }],
  vendors: [{ id: 'v1', store_name: 'Rasmed Bookshop', rating: null, review_count: 0 }],
}, true);
eq('the real booklist appears', f2.activeRequests.map((r) => r.school_name), ['Methodist']);
eq('the real total appears', f2.orderTotal, 8000);
eq('the real shop appears', f2.featuredShop.store_name, 'Rasmed Bookshop');
eq('the real quote appears', f2.pendingQuotes.map((q) => q.vendor_name), ['Rasmed Bookshop']);

console.log('--- FRAME 2b: a genuinely empty account, after loading ---');
const f2b = derive(EMPTY, true);
eq('still no invented rows', f2b.activeRequests.length, 0);
eq('still no invented total', f2b.orderTotal, 0);
eq('still no invented shop', f2b.featuredShop, null);
eq('empty-project flag is honest', f2b.isEmptyProject, true);

console.log('--- the regression itself: could any frame show a fake price? ---');
const FAKE = [2500, 1800, 3200, 7500, 15000];
let flashed = false;
for (const hasLoaded of [false, true]) {
  const v = derive(EMPTY, hasLoaded);
  if (FAKE.includes(v.orderTotal)) flashed = true;
  if (v.activeRequests.some((r) => r.demo)) flashed = true;
  if (v.featuredShop?.demo) flashed = true;
  if (v.pendingQuotes.some((q) => q.demo)) flashed = true;
}
eq('no frame produces fixture money or demo rows', flashed, false);

console.log(fail === 0 ? '\nALL PASS' : `\n${fail} FAILED`);
process.exit(fail?1:0);
