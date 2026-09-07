import { transformFileSync } from '@babel/core';
import { writeFileSync } from 'fs';
// The fixture must satisfy the Category contract the card reads.
const code = transformFileSync('lib/mockData.js', {
  presets: [['@babel/preset-typescript', { allExtensions: true }]],
  filename: 'm.js', configFile: false, babelrc: false }).code;
writeFileSync('.cat.gen.mjs', code);
const { MOCK_CATEGORIES } = await import(process.cwd() + '/.cat.gen.mjs');

let fail = 0;
const eq=(n,a,b)=>{const ok=JSON.stringify(a)===JSON.stringify(b); if(!ok)fail++;
  console.log(`${ok?'PASS':'FAIL'}  ${n}: ${JSON.stringify(a)}${ok?'':' != '+JSON.stringify(b)}`);};

eq('four categories', MOCK_CATEGORIES.length, 4);
eq('every one has id/name/slug',
   MOCK_CATEGORIES.every((c) => c.id && c.name && c.slug), true);
eq('renamed label -> name', MOCK_CATEGORIES.map((c) => c.name),
   ['Stationery', 'Uniforms', 'School Shoes', 'New Arrivals']);
eq('no stray `label` left', MOCK_CATEGORIES.some((c) => 'label' in c), false);
eq('no stray `subtitle` left', MOCK_CATEGORIES.some((c) => 'subtitle' in c), false);
eq('slugs are url-safe', MOCK_CATEGORIES.every((c) => /^[a-z0-9-]+$/.test(c.slug)), true);
eq('slugs unique', new Set(MOCK_CATEGORIES.map((c) => c.slug)).size, 4);

console.log('--- nothing invented ---');
eq('no stock photo urls', MOCK_CATEGORIES.some((c) => c.image_url), false);
eq('no invented item counts', MOCK_CATEGORIES.some((c) => c.item_count != null), false);
eq('every one has a fallback icon + tint',
   MOCK_CATEGORIES.every((c) => c.icon && c.accent), true);

console.log('--- the card contract ---');
// Mirrors CategoryCard: image only when a non-blank url is present.
const shows = (c) => Boolean(c.image_url?.trim());
eq('today every card uses the icon fallback', MOCK_CATEGORIES.some(shows), false);
eq('a real url would show the photo', shows({ image_url: 'https://x/y.jpg' }), true);
eq('a blank string does not', shows({ image_url: '   ' }), false);
eq('null does not', shows({ image_url: null }), false);
eq('undefined does not', shows({}), false);

console.log(fail === 0 ? '\nALL PASS' : `\n${fail} FAILED`);
process.exit(fail?1:0);
