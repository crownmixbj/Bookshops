#!/usr/bin/env node
/**
 * Move the exported assets out of a `node_modules` path so Cloudflare
 * Pages will actually upload them.
 *
 * The problem
 * -----------
 * `expo export --platform web` writes every asset that comes from a
 * package under `assets/node_modules/<package>/...` — which is where the
 * icon fonts live:
 *
 *   assets/node_modules/@expo/vector-icons/build/vendor/
 *     react-native-vector-icons/Fonts/Ionicons.<hash>.ttf
 *
 * Wrangler — which both `wrangler pages deploy` and the Pages Git build
 * use to upload a project — keeps a hardcoded list of directory names it
 * refuses to upload, and `node_modules` is on it. See
 * cloudflare/workers-sdk#3615, closed "not planned", so this is not
 * something that gets fixed upstream.
 *
 * The result on a deployed site is silent and confusing: the font files
 * are simply absent, the request for one falls through the SPA rule in
 * `_redirects` and is answered with `index.html`, the browser cannot
 * parse HTML as a font, and every icon in the app renders as an empty
 * box. Nothing errors; the app looks broken.
 *
 * The fix
 * -------
 * Rename the directory and rewrite the references. Expo emits these
 * paths as plain string literals in the bundle, so a whole-word
 * replacement of the prefix is exact — there is no path building to
 * chase. This script fails loudly if the rename and the rewrite do not
 * agree, because a half-applied rename is worse than none.
 *
 * Usage:  node scripts/fix-cf-assets.mjs [outDir]     (default: dist)
 */
import { readdirSync, statSync, readFileSync, writeFileSync, renameSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

const OUT = resolve(process.argv[2] ?? 'dist');
const FROM = 'assets/node_modules/';
const TO = 'assets/vendor/';

/** Every file under `dir`, recursively. */
function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out;
}

if (!existsSync(OUT)) {
  console.error(`fix-cf-assets: no such directory: ${OUT}`);
  process.exit(1);
}

const legacy = join(OUT, 'assets', 'node_modules');
const target = join(OUT, 'assets', 'vendor');

if (!existsSync(legacy)) {
  // Either already fixed, or a future Expo stopped emitting this path.
  // Either way, only say so if nothing still points at the old location.
  const stragglers = walk(OUT).filter(
    (f) => /\.(js|css|html|json|map)$/.test(f) && readFileSync(f, 'utf8').includes(FROM)
  );
  if (stragglers.length) {
    console.error(
      `fix-cf-assets: ${legacy} is missing but ${stragglers.length} file(s) still reference ` +
        `${FROM} — the export is inconsistent:\n  ${stragglers.join('\n  ')}`
    );
    process.exit(1);
  }
  console.log('fix-cf-assets: nothing to do (no assets/node_modules in the export)');
  process.exit(0);
}

if (existsSync(target)) {
  console.error(`fix-cf-assets: ${target} already exists — refusing to merge into it`);
  process.exit(1);
}

const moved = walk(legacy).length;
renameSync(legacy, target);

let rewritten = 0;
let refs = 0;
for (const file of walk(OUT)) {
  if (!/\.(js|css|html|json|map)$/.test(file)) continue;
  const before = readFileSync(file, 'utf8');
  if (!before.includes(FROM)) continue;
  refs += before.split(FROM).length - 1;
  writeFileSync(file, before.split(FROM).join(TO));
  rewritten += 1;
}

// A rename with no rewrite means the assets are now unreachable — worse
// than the bug this script exists to fix. Fail rather than ship it.
if (refs === 0) {
  console.error(
    `fix-cf-assets: moved ${moved} file(s) but found no references to rewrite. ` +
      'The export may name these paths some other way; not shipping a broken bundle.'
  );
  process.exit(1);
}

const left = walk(OUT).filter(
  (f) => /\.(js|css|html|json|map)$/.test(f) && readFileSync(f, 'utf8').includes(FROM)
);
if (left.length) {
  console.error(`fix-cf-assets: ${left.length} file(s) still reference ${FROM}`);
  process.exit(1);
}

console.log(
  `fix-cf-assets: moved ${moved} asset(s) to ${TO} and rewrote ${refs} reference(s) ` +
    `across ${rewritten} file(s)`
);
