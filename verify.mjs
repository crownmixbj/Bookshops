/**
 * Offline verification: parse every source file with the project's own
 * babel-preset-expo, then resolve every relative import to a real file.
 * Catches syntax errors, bad JSX and wrong import paths without needing
 * the network (expo export phones home and the proxy blocks it).
 */
import { transformFileAsync } from '@babel/core';
import { readdirSync, statSync, existsSync } from 'node:fs';
import { join, dirname, resolve, extname } from 'node:path';

const ROOT = process.cwd();
const SKIP = new Set(['node_modules', '.git', '.expo', 'dist', 'assets', '.claude']);
const EXTS = ['', '.js', '.jsx', '.ts', '.tsx', '.json', '/index.js', '/index.jsx'];

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (SKIP.has(name)) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (['.js', '.jsx', '.ts', '.tsx'].includes(extname(p)) && !p.endsWith('.bak') && !p.endsWith('.d.ts')) out.push(p);
  }
  return out;
}

const files = walk(ROOT);
let parseErrors = 0;
let resolveErrors = 0;
const importRe = /(?:from\s+|import\s*\(\s*)['"]([^'"]+)['"]/g;

for (const file of files) {
  let code;
  try {
    const result = await transformFileAsync(file, {
      presets: ['babel-preset-expo'],
      babelrc: false,
      configFile: false,
      caller: { name: 'metro', platform: 'web', isDev: true, supportsStaticESM: true },
    });
    code = result.code;
  } catch (e) {
    parseErrors++;
    console.log(`PARSE FAIL  ${file.replace(ROOT + '/', '')}\n            ${e.message.split('\n')[0]}`);
    continue;
  }

  // Resolution check runs on the ORIGINAL source so specifiers are intact.
  const src = (await import('node:fs')).readFileSync(file, 'utf8');
  for (const m of src.matchAll(importRe)) {
    const spec = m[1];
    if (!spec.startsWith('.')) continue; // bare specifiers -> node_modules
    const base = resolve(dirname(file), spec);
    if (!EXTS.some((ext) => existsSync(base + ext))) {
      resolveErrors++;
      console.log(`UNRESOLVED  ${file.replace(ROOT + '/', '')}  ->  ${spec}`);
    }
  }
}

console.log(`\nparsed ${files.length} files | parse errors: ${parseErrors} | unresolved imports: ${resolveErrors}`);
process.exit(parseErrors + resolveErrors === 0 ? 0 : 1);
