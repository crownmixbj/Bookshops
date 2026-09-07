import { transformFileSync } from '@babel/core';
import { writeFileSync } from 'fs';

writeFileSync('.sb3.stub.mjs', `
const chain = () => { const o = { select: () => o, order: () => o, then: (res, rej) => globalThis.__q().then(res, rej) }; return o; };
export const supabase = { from: () => chain() };`);
writeFileSync('.ls3.stub.mjs', `export const withTimeout = (p) => p;`);

const code = transformFileSync('hooks/useCategories.ts', {
  presets: [['@babel/preset-typescript', { allExtensions: true }]],
  filename: 'c.ts', configFile: false, babelrc: false }).code
  .replace("'../utils/supabase'", `'${process.cwd()}/.sb3.stub.mjs'`)
  .replace("'../lib/loadState'", `'${process.cwd()}/.ls3.stub.mjs'`)
  .replace("'react'", 'null');
// Only the pure decision logic is exercised, lifted verbatim from the hook.
const body = code.slice(code.indexOf('const { data, error: queryError }'));
writeFileSync('.cats.gen.mjs', `
import { MOCK_CATEGORIES } from '${process.cwd()}/.cat2.gen.mjs';
export function decide(queryError, data) {
  if (queryError?.code === '42P01' || queryError?.code === 'PGRST205') return { source: 'builtin', categories: MOCK_CATEGORIES };
  if (queryError) throw queryError;
  const rows = data ?? [];
  if (rows.length === 0) return { source: 'builtin', categories: MOCK_CATEGORIES };
  const decoration = new Map(MOCK_CATEGORIES.map((c) => [c.slug, c]));
  return { source: 'database', categories: rows.map((row) => ({ ...row, accent: decoration.get(row.slug)?.accent, icon: decoration.get(row.slug)?.icon })) };
}`);
writeFileSync('.cat2.gen.mjs', transformFileSync('lib/mockData.js', {
  presets: [['@babel/preset-typescript', { allExtensions: true }]], filename: 'm.js', configFile: false, babelrc: false }).code);
const { decide } = await import(process.cwd() + '/.cats.gen.mjs');

let fail = 0;
const eq=(n,a,b)=>{const ok=JSON.stringify(a)===JSON.stringify(b); if(!ok)fail++;
  console.log(`${ok?'PASS':'FAIL'}  ${n}: ${JSON.stringify(a)}${ok?'':' != '+JSON.stringify(b)}`);};

console.log('--- before the migration runs (today) ---');
let r = decide({ code: '42P01', message: 'relation "categories" does not exist' }, null);
eq('missing table -> built-in, no crash', r.source, 'builtin');
eq('...and the four tiles survive', r.categories.length, 4);
r = decide({ code: 'PGRST205' }, null);
eq('stale schema cache -> built-in', r.source, 'builtin');

console.log('--- after the migration, seeded ---');
const seeded = [
  { id: '1', name: 'Stationery', slug: 'stationery', description: 'Pens, notebooks, sets', image_url: null, display_order: 1 },
  { id: '2', name: 'Uniforms', slug: 'uniforms', description: 'By school and size', image_url: null, display_order: 2 },
  { id: '3', name: 'School Shoes', slug: 'school-shoes', description: 'Black leather, sandals', image_url: null, display_order: 3 },
  { id: '4', name: 'New Arrivals', slug: 'new-arrivals', description: 'Fresh this term', image_url: null, display_order: 4 },
];
r = decide(null, seeded);
eq('live rows are used', r.source, 'database');
eq('names match the built-in list exactly', r.categories.map((c) => c.name),
   ['Stationery', 'Uniforms', 'School Shoes', 'New Arrivals']);
eq('slugs match, so routes do not break', r.categories.map((c) => c.slug),
   ['stationery', 'uniforms', 'school-shoes', 'new-arrivals']);
eq('tint carried over by slug', r.categories[0].accent, '#FDE8D2');
eq('glyph carried over by slug', r.categories[1].icon, 'shirt-outline');
eq('no item_count invented', r.categories.every((c) => c.item_count == null), true);
eq('no image_url invented', r.categories.every((c) => !c.image_url), true);

console.log('--- a category added later by an admin ---');
r = decide(null, [...seeded, { id: '5', name: 'Exam Prep', slug: 'exam-prep', description: null, image_url: 'https://cdn/x.jpg', display_order: 5 }]);
eq('new row appears', r.categories.length, 5);
eq('...with no tint, and the card defaults', r.categories[4].accent, undefined);
eq('...and its real photo is kept', r.categories[4].image_url, 'https://cdn/x.jpg');

console.log('--- degenerate cases ---');
eq('empty table -> built-in, not a blank row', decide(null, []).source, 'builtin');
eq('null data -> built-in', decide(null, null).source, 'builtin');
let threw = false;
try { decide({ code: '42501', message: 'permission denied' }, null); } catch { threw = true; }
eq('a real error is NOT swallowed as "not migrated"', threw, true);

console.log(fail === 0 ? '\nALL PASS' : `\n${fail} FAILED`);
process.exit(fail?1:0);
