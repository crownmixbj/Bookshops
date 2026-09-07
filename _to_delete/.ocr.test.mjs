import { transformFileSync } from '@babel/core';
import { writeFileSync } from 'fs';

writeFileSync('.sbfn.stub.mjs', `
export const supabase = { functions: { invoke: (...a) => globalThis.__invoke(...a) } };`);
writeFileSync('.rn.stub.mjs', `export const Platform = { OS: 'web', select: (o) => o.web ?? o.default };`);
writeFileSync('.ip.stub.mjs', `export const requestCameraPermissionsAsync = async () => ({granted:true});
export const requestMediaLibraryPermissionsAsync = async () => ({granted:true});
export const launchCameraAsync = async () => ({canceled:true});
export const launchImageLibraryAsync = async () => ({canceled:true});`);

let code = transformFileSync('lib/booklistUpload.ts', {
  presets: [['@babel/preset-typescript', { allExtensions: true }]],
  filename: 'booklistUpload.ts', configFile: false, babelrc: false,
}).code
  .replace("'./supabase'", "'x'")
  .replace("'../utils/supabase'", `'${process.cwd()}/.sbfn.stub.mjs'`)
  .replace("'react-native'", `'${process.cwd()}/.rn.stub.mjs'`)
  .replace("'expo-image-picker'", `'${process.cwd()}/.ip.stub.mjs'`);
writeFileSync('.ocr.gen.mjs', code);
const M = await import(process.cwd() + '/.ocr.gen.mjs');

let fail = 0;
const eq = (n,a,b)=>{const ok=JSON.stringify(a)===JSON.stringify(b); if(!ok)fail++;
  console.log(`${ok?'PASS':'FAIL'}  ${n}: ${JSON.stringify(a)}${ok?'':' != '+JSON.stringify(b)}`);};
const NOTE = "We couldn't automatically read this photo. Please type your books below, or send the raw photo directly to shops.";
const warn = console.warn; console.warn = () => {};

// 1. The bug: the parser is not deployed / not configured.
globalThis.__invoke = async () => ({ data: null, error: new Error('Function not found') });
let r = await M.parseBooklistImage('u1/x.jpg');
eq('undeployed parser -> NO items', r.items, []);
eq('undeployed parser -> parsed:false', r.parsed, false);
eq('undeployed parser -> the promised copy', r.note, NOTE);

// 2. Model returned an empty read (unreadable photo).
globalThis.__invoke = async () => ({ data: { school_name: '', class_level: '', items: [] }, error: null });
r = await M.parseBooklistImage('u1/x.jpg');
eq('empty read -> NO items', r.items, []);
eq('empty read -> says so', r.note, NOTE);

// 3. Network / throw.
globalThis.__invoke = async () => { throw new Error('boom'); };
r = await M.parseBooklistImage('u1/x.jpg');
eq('a throw never escapes', r.items.length, 0);
eq('a throw is not fatal', r.parsed, false);

// 4. A real read of the Lagos State list in the screenshot.
globalThis.__invoke = async () => ({ data: {
  school_name: 'Lagos State Examinations Board', class_level: 'JSS III',
  items: [
    { title: 'Keep Your Head Above Water', author: 'Kazeem Kareem', quantity: 1 },
    { title: 'Sunrise Poetry 3', author: 'Olusola Fadiya', quantity: 2 },
    { title: 'The Tobacconist', author: 'Dele Delani' },
    { title: '', author: 'ignored — no title' },
  ],
}, error: null });
r = await M.parseBooklistImage('u1/x.jpg');
eq('a real read comes through', r.items.map(i => i.title),
   ['Keep Your Head Above Water', 'Sunrise Poetry 3', 'The Tobacconist']);
eq('school from the photo, not a fixture', r.school_name, 'Lagos State Examinations Board');
eq('class from the photo', r.class_level, 'JSS III');
eq('quantity honoured', r.items[1].quantity, 2);
eq('missing quantity defaults to 1', r.items[2].quantity, 1);
eq('titleless rows dropped', r.items.length, 3);
eq('parsed:true only on a real read', r.parsed, true);
eq('ids marked parsed- so the vendor flag is right', r.items.every(i => i.id.startsWith('parsed-')), true);

// 5. Garbage in.
globalThis.__invoke = async () => ({ data: 'not json at all', error: null });
r = await M.parseBooklistImage('u1/x.jpg');
eq('garbage -> no items', r.items, []);

// 6. The regression that started this: no fixture title can ever appear.
const FIXTURES = ['Intensive English Language for JSS 1', 'New General Mathematics', 'Oxford Advanced Learners Dictionary'];
let leaked = false;
for (const impl of [
  async () => ({ data: null, error: new Error('nope') }),
  async () => ({ data: {}, error: null }),
  async () => { throw new Error('x'); },
]) {
  globalThis.__invoke = impl;
  const out = await M.parseBooklistImage('u1/x.jpg');
  if (out.items.some((i) => FIXTURES.includes(i.title))) leaked = true;
}
eq('no failure path can emit a fixture book', leaked, false);
console.warn = warn;
console.log(fail === 0 ? '\nALL PASS' : `\n${fail} FAILED`);
process.exit(fail?1:0);
