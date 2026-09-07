import { transformFileSync } from '@babel/core';
import { writeFileSync } from 'fs';

// Stub the supabase client so the real module graph (react-native) stays out.
const events = [];
let handler = null;
let sessionImpl = async () => ({ data: { session: { user: { id: 'u1' } } }, error: null });
writeFileSync('.sb.stub.mjs', `
export const supabase = {
  auth: {
    getSession: (...a) => globalThis.__sessionImpl(...a),
    onAuthStateChange: (cb) => { globalThis.__setHandler(cb);
      return { data: { subscription: { unsubscribe: () => globalThis.__setHandler(null) } } }; },
  },
};`);
globalThis.__sessionImpl = (...a) => sessionImpl(...a);
globalThis.__setHandler = (h) => { handler = h; };

let code = transformFileSync('lib/loadState.ts', {
  presets: [['@babel/preset-typescript', { allExtensions: true }]],
  filename: 'loadState.ts', configFile: false, babelrc: false,
}).code.replace("'../utils/supabase'", `'${process.cwd()}/.sb.stub.mjs'`);
writeFileSync('.ls.gen.mjs', code);
const M = await import(process.cwd() + '/.ls.gen.mjs');

let fail = 0;
const eq = (n, a, b) => { const ok = JSON.stringify(a) === JSON.stringify(b); if (!ok) fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}: ${JSON.stringify(a)}${ok ? '' : ' != ' + JSON.stringify(b)}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// --- withTimeout ---
eq('resolves under the limit', await M.withTimeout(Promise.resolve(7), 100, 'x'), 7);
let msg = null;
try { await M.withTimeout(new Promise(() => {}), 60, 'Checking your sign-in'); }
catch (e) { msg = e.message; }
eq('a hang rejects instead of hanging', msg, 'Checking your sign-in timed out after 0.06s');

// --- getSessionUserId ---
eq('reads the cached session', await M.getSessionUserId(), 'u1');
sessionImpl = async () => ({ data: { session: null }, error: null });
eq('signed out -> null', await M.getSessionUserId(), null);
// The bug this exists for: an auth read that never comes back.
sessionImpl = () => new Promise(() => {});
const t0 = Date.now();
let hung = null;
try { await M.getSessionUserId(); } catch (e) { hung = e.message.includes('timed out'); }
eq('a hung auth read gives up', hung, true);
eq('and does so in under 10s', Date.now() - t0 < 10000, true);

// --- subscribeToAuthReloads ---
let reloads = 0;
const unsub = M.subscribeToAuthReloads(() => { reloads++; });
handler('TOKEN_REFRESHED', {});
handler('INITIAL_SESSION', {});
await sleep(10);
eq('token refresh does NOT refetch', reloads, 0);

handler('SIGNED_IN', {});
eq('reload is deferred, not run inline', reloads, 0);   // still inside the auth pass
await sleep(10);
eq('and runs on a clean stack', reloads, 1);

handler('SIGNED_OUT', {});
handler('USER_UPDATED', {});
await sleep(10);
eq('sign-out and user-update refetch', reloads, 3);

unsub();
eq('unsubscribe detaches', handler, null);

console.log(fail === 0 ? '\nALL PASS' : `\n${fail} FAILED`);
process.exit(fail === 0 ? 0 : 1);
