import { transformFileSync } from '@babel/core';
import { writeFileSync } from 'fs';

// bucketFor is module-private, so lift it out verbatim rather than
// re-implementing it — a re-implementation would test my copy, not theirs.
const src = transformFileSync('hooks/useBooklists.ts', {
  presets: [['@babel/preset-typescript', { allExtensions: true }]],
  filename: 'b.ts', configFile: false, babelrc: false }).code;
const start = src.indexOf('function bucketFor');
const end = src.indexOf('\n}\n', start) + 3;
writeFileSync('.bucket.gen.mjs', 'export ' + src.slice(start, end));
const { bucketFor } = await import(process.cwd() + '/.bucket.gen.mjs');

// PUBLISHED_REQUEST_STATUSES from the dashboard hook, also lifted.
const dash = transformFileSync('hooks/useDashboardData.js', {
  presets: [['@babel/preset-typescript', { allExtensions: true }]],
  filename: 'd.js', configFile: false, babelrc: false }).code;
const m = dash.match(/const PUBLISHED_REQUEST_STATUSES = (\[[^\]]*\])/);
const DASH_STATUSES = JSON.parse(m[1].replace(/'/g, '"'));

let fail = 0;
const eq=(n,a,b)=>{const ok=JSON.stringify(a)===JSON.stringify(b); if(!ok)fail++;
  console.log(`${ok?'PASS':'FAIL'}  ${n}: ${JSON.stringify(a)}${ok?'':' != '+JSON.stringify(b)}`);};

const sent = [{ status: 'sent' }];
const R = (status) => ({ status });
const O = (fulfillment_status) => ({ fulfillment_status });

console.log('--- dashboard "Active Booklist Requests" ---');
eq('awaiting quotes is included', DASH_STATUSES.includes('pending_quote'), true);
eq('quoted is included', DASH_STATUSES.includes('quoted'), true);
eq('ORDERED is excluded', DASH_STATUSES.includes('ordered'), false);
eq('cancelled is excluded', DASH_STATUSES.includes('cancelled'), false);
eq('drafts are excluded', DASH_STATUSES.includes('draft'), false);

console.log('--- My Booklists sections ---');
eq('draft -> draft', bucketFor(R('draft'), [], null), 'draft');
eq('sent, no quotes yet -> draft/pending', bucketFor(R('pending_quote'), [], null), 'draft');
eq('quoted -> active', bucketFor(R('quoted'), sent, null), 'active');
eq('ORDERED -> archived, not active', bucketFor(R('ordered'), sent, null), 'archived');
eq('ordered while processing -> archived', bucketFor(R('ordered'), sent, O('processing')), 'archived');
eq('ordered while dispatched -> archived', bucketFor(R('ordered'), sent, O('dispatched')), 'archived');
eq('delivered -> archived', bucketFor(R('ordered'), sent, O('delivered')), 'archived');
eq('cancelled -> archived', bucketFor(R('cancelled'), sent, null), 'archived');
eq('a paid order on a quoted list -> archived', bucketFor(R('quoted'), sent, O('processing')), 'archived');

console.log('--- nothing can be in two live places at once ---');
for (const status of ['draft', 'pending_quote', 'quoted', 'ordered', 'cancelled']) {
  const onDashboard = DASH_STATUSES.includes(status);
  const bucket = bucketFor(R(status), sent, status === 'ordered' ? O('processing') : null);
  const onMyOrders = status === 'ordered';
  const clash = onMyOrders && (onDashboard || bucket === 'active');
  eq(`  ${status}: dashboard=${onDashboard} booklists=${bucket} orders=${onMyOrders}`, clash, false);
}

console.log(fail === 0 ? '\nALL PASS' : `\n${fail} FAILED`);
process.exit(fail?1:0);
