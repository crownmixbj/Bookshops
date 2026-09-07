import { transformFileSync } from '@babel/core';
import { writeFileSync } from 'fs';
writeFileSync('.rn2.stub.mjs', `export const Platform = { OS: 'web', select: (o) => o.web ?? o.default };`);
writeFileSync('.ip2.stub.mjs', `export const requestCameraPermissionsAsync = async () => ({granted:true});
export const requestMediaLibraryPermissionsAsync = async () => ({granted:true});
export const launchCameraAsync = async () => ({canceled:true});
export const launchImageLibraryAsync = async () => ({canceled:true});`);
writeFileSync('.sb2.stub.mjs', `export const supabase = { from: (t) => globalThis.__from(t), functions: { invoke: async () => ({data:null,error:null}) } };`);

let code = transformFileSync('lib/booklistUpload.ts', {
  presets: [['@babel/preset-typescript', { allExtensions: true }]],
  filename: 'b.ts', configFile: false, babelrc: false }).code
  .replace("'../utils/supabase'", `'${process.cwd()}/.sb2.stub.mjs'`)
  .replace("'react-native'", `'${process.cwd()}/.rn2.stub.mjs'`)
  .replace("'expo-image-picker'", `'${process.cwd()}/.ip2.stub.mjs'`);
writeFileSync('.direct.gen.mjs', code);
const M = await import(process.cwd() + '/.direct.gen.mjs');

let fail = 0;
const eq=(n,a,b)=>{const ok=JSON.stringify(a)===JSON.stringify(b); if(!ok)fail++;
  console.log(`${ok?'PASS':'FAIL'}  ${n}: ${JSON.stringify(a)}${ok?'':' != '+JSON.stringify(b)}`);};

// A tiny fake PostgREST that records updates and can reject dispatch_type.
function harness({ itemCount, imagePath, hasDispatchType }) {
  const updates = [];
  globalThis.__from = (table) => {
    if (table === 'book_request_items') return {
      select: () => ({ eq: async () => ({ count: itemCount, error: null }) }) };
    return {
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { image_path: imagePath }, error: null }) }) }),
      update: (payload) => ({ eq: () => ({ select: async () => {
        updates.push(payload);
        if (!hasDispatchType && 'dispatch_type' in payload) {
          return { data: null, error: { code: '42703', message: 'column "dispatch_type" does not exist' } };
        }
        return { data: [{ id: 'r1' }], error: null };
      } }) }),
    };
  };
  return updates;
}

console.log('--- this database (no dispatch_type column) ---');
let u = harness({ itemCount: 3, imagePath: null, hasDispatchType: false });
await M.publishBookRequest('r1', M.directTo('vendor-9'));
eq('it retries rather than failing', u.length, 2);
eq('the retry drops only the missing column', 'dispatch_type' in u[1], false);
eq('the shop is still recorded', u[1].target_vendor_id, 'vendor-9');
eq('and it is published', u[1].status, 'pending_quote');

console.log('--- after bookshops_dispatch_routing.sql ---');
u = harness({ itemCount: 3, imagePath: null, hasDispatchType: true });
await M.publishBookRequest('r1', M.directTo('vendor-9'));
eq('one update, no retry needed', u.length, 1);
eq('dispatch_type written', u[0].dispatch_type, 'direct');
eq('target written', u[0].target_vendor_id, 'vendor-9');

console.log('--- photo-only, sent to one shop ---');
u = harness({ itemCount: 0, imagePath: 'uid/r1.jpg', hasDispatchType: false });
await M.publishBookRequest('r1', M.directTo('vendor-9'));
eq('a photo with no typed books is allowed', u.at(-1).target_vendor_id, 'vendor-9');

console.log('--- nothing to quote ---');
harness({ itemCount: 0, imagePath: null, hasDispatchType: false });
let msg = null;
try { await M.publishBookRequest('r1', M.directTo('vendor-9')); } catch (e) { msg = e.message; }
eq('no books and no photo is refused', msg,
   'Add at least one book, or attach a photo of the list, before sending this to vendors.');

console.log('--- open market is unaffected ---');
u = harness({ itemCount: 2, imagePath: null, hasDispatchType: false });
await M.publishBookRequest('r1', M.OPEN_MARKET);
eq('target cleared for open market', u.at(-1).target_vendor_id, null);

console.log('--- a direct dispatch with no shop is a programming error ---');
harness({ itemCount: 2, imagePath: null, hasDispatchType: true });
msg = null;
try { await M.publishBookRequest('r1', { type: 'direct', vendorId: null }); } catch (e) { msg = e.message; }
eq('caught', msg, 'Choose a shop to send this booklist to.');

console.log(fail === 0 ? '\nALL PASS' : `\n${fail} FAILED`);
process.exit(fail?1:0);
