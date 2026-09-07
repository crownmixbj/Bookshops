import { transformFileSync } from '@babel/core';
import { writeFileSync } from 'fs';

const hook = transformFileSync('hooks/useShopQuotes.ts', {
  presets: [['@babel/preset-typescript', { allExtensions: true }]],
  filename: 'h.ts', configFile: false, babelrc: false }).code;
const mapStart = hook.indexOf('const STATUS_FROM_QUOTE');
const mapSrc = hook.slice(mapStart, hook.indexOf('};', mapStart) + 2);
const cardStart = hook.indexOf('const cards = [];');
const cardSrc = hook.slice(cardStart, hook.indexOf('setQuotes(cards);', cardStart));
const sendOpen = hook.lastIndexOf('setSendable(') + 'setSendable('.length;
let depth = 1, i = sendOpen;
while (depth > 0) { const ch = hook[i++]; if (ch === '(') depth++; else if (ch === ')') depth--; }
const sendSrc = hook.slice(sendOpen, i - 1);

writeFileSync('.sq.gen.mjs', `
const DRAFT_STATUS = 'draft';
export ${mapSrc}
export function buildCards(requests, quoteRows, vendorId) {
  const itemCountOf = (r) => Number(r.book_request_items?.[0]?.count) || 0;
  const quoteByRequest = new Map();
  for (const q of quoteRows) {
    const existing = quoteByRequest.get(q.request_id);
    if (!existing || String(q.created_at) > String(existing.created_at)) quoteByRequest.set(q.request_id, q);
  }
  ${cardSrc}
  return cards;
}
export function buildSendable(requests, vendorId) {
  const itemCountOf = (r) => Number(r.book_request_items?.[0]?.count) || 0;
  return ${sendSrc};
}`);
const M = await import(process.cwd() + '/.sq.gen.mjs');

let fail = 0;
const eq=(n,a,b)=>{const ok=JSON.stringify(a)===JSON.stringify(b); if(!ok)fail++;
  console.log(`${ok?'PASS':'FAIL'}  ${n}: ${JSON.stringify(a)}${ok?'':' != '+JSON.stringify(b)}`);};
const V = 'rasmed';
const R = (o) => ({ id: o.id, school_name: o.name, class_level: null, status: o.status,
  created_at: o.at ?? '2026-01-01', target_vendor_id: o.target ?? null,
  book_request_items: [{ count: o.items ?? 0 }] });

console.log('--- the real rows on the Rasmed page ---');
let cards = M.buildCards(
  [R({ id: 'r1', name: 'ara romi', status: 'pending_quote', target: V, items: 2, at: '2026-09-06' }),
   R({ id: 'r2', name: 'Methodist', status: 'ordered', items: 12, at: '2026-09-01' })],
  [{ id: 'q1', request_id: 'r2', status: 'accepted', total_price: '57640.00', created_at: '2026-09-02', quote_items: [{ count: 12 }] }], V);
eq('two cards', cards.length, 2);
eq('addressed, no reply -> awaiting', cards[0].status, 'awaiting');
eq('...with no invented total', cards[0].total, null);
eq('accepted quote -> accepted', cards[1].status, 'accepted');
eq('...total parsed', cards[1].total, 57640);
eq('...12 of 12 items', [cards[1].quotedItems, cards[1].requestedItems], [12, 12]);

console.log('--- every quote status maps to a real badge ---');
for (const [db, want] of [['sent','received'],['accepted','accepted'],['rejected','declined'],['withdrawn','declined'],['expired','expired']]) {
  const c = M.buildCards([R({ id: 'x', name: 'L', status: 'quoted', items: 10 })],
    [{ id: 'q', request_id: 'x', status: db, total_price: '1000', created_at: '1', quote_items: [{ count: 8 }] }], V);
  eq(`  quotes.status '${db}'`, c[0].status, want);
}
eq('no badge invented for a status the db cannot hold',
   Object.keys(M.STATUS_FROM_QUOTE).sort(), ['accepted','expired','rejected','sent','withdrawn']);

console.log('--- what is NOT shown ---');
eq('a draft never sent anywhere', M.buildCards([R({ id: 'd', name: 'D', status: 'draft', items: 3 })], [], V).length, 0);
eq('an open-market list this shop has not quoted',
   M.buildCards([R({ id: 'o', name: 'O', status: 'pending_quote', items: 3 })], [], V).length, 0);
eq('...but it DOES show once they quote it',
   M.buildCards([R({ id: 'o', name: 'O', status: 'quoted', items: 3 })],
     [{ id: 'q', request_id: 'o', status: 'sent', total_price: '5', created_at: '1', quote_items: [{ count: 3 }] }], V).length, 1);

console.log('--- partial quotes ---');
cards = M.buildCards([R({ id: 'p', name: 'P', status: 'quoted', items: 10 })],
  [{ id: 'q', request_id: 'p', status: 'sent', total_price: '45000', created_at: '1', quote_items: [{ count: 8 }] }], V);
eq('8 of 10 surfaced', [cards[0].quotedItems, cards[0].requestedItems], [8, 10]);

console.log('--- two quotes on one request: newest wins ---');
cards = M.buildCards([R({ id: 'z', name: 'Z', status: 'quoted', items: 4 })], [
  { id: 'old', request_id: 'z', status: 'withdrawn', total_price: '100', created_at: '2026-01-01', quote_items: [{ count: 1 }] },
  { id: 'new', request_id: 'z', status: 'sent', total_price: '200', created_at: '2026-06-01', quote_items: [{ count: 4 }] }], V);
eq('newest quote used', cards[0].quoteId, 'new');
eq('...and its status', cards[0].status, 'received');

console.log('--- the picker ---');
const all = [R({ id: 'a', name: 'Draft', status: 'draft', items: 3 }),
             R({ id: 'b', name: 'Open', status: 'pending_quote', items: 5 }),
             R({ id: 'c', name: 'Already here', status: 'pending_quote', target: V, items: 2 }),
             R({ id: 'd', name: 'Bought', status: 'ordered', items: 9 }),
             R({ id: 'e', name: 'Dead', status: 'cancelled', items: 1 })];
const s = M.buildSendable(all, V);
eq('offers only what can move', s.map((x) => x.title), ['Draft', 'Open']);
eq('draft flagged for publish', s[0].isDraft, true);
eq('published flagged for re-route', s[1].alreadyPublished, true);
eq('item counts carried', s.map((x) => x.itemCount), [3, 5]);

console.log(fail === 0 ? '\nALL PASS' : `\n${fail} FAILED`);
process.exit(fail?1:0);
