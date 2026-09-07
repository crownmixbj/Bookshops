import { transformFileSync } from '@babel/core';
import { writeFileSync } from 'fs';
const strip = (f, name) => transformFileSync(f, {
  presets: [['@babel/preset-typescript', { allExtensions: true }]],
  filename: name, configFile: false, babelrc: false }).code;

// booklistValidation imports guessCategory from booklistUpload; give it a
// tiny module holding only the real function, verbatim.
const up = strip('lib/booklistUpload.ts', 'u.ts');
const fn = up.slice(up.indexOf('export function guessCategory'));
writeFileSync('.gc.gen.mjs', fn.slice(0, fn.indexOf('\n}\n') + 3));
writeFileSync('.val.gen.mjs',
  strip('lib/booklistValidation.ts', 'v.ts').replace("'./booklistUpload'", `'${process.cwd()}/.gc.gen.mjs'`));
const V = await import(process.cwd() + '/.val.gen.mjs');

let fail = 0;
const eq = (n,a,b)=>{const ok=JSON.stringify(a)===JSON.stringify(b); if(!ok)fail++;
  console.log(`${ok?'PASS':'FAIL'}  ${n}: ${JSON.stringify(a)}${ok?'':' != '+JSON.stringify(b)}`);};

const L = (title, author = '', category) => ({ title, author, category });

console.log('--- who must name an author ---');
for (const [title, want] of [
  ['New General Mathematics', true],
  ['Keep Your Head Above Water', true],
  ['Oxford Advanced Learners Dictionary', true],
  ['Basic Technology', true],
  ['Home Economics', true],
  ['2 dozen exercise books', false],
  ['Pencil and eraser set', false],
  ['White school socks', false],
  ['Boys school sandals', false],
  ['', false],
]) eq(`  ${title || '(blank line)'}`, V.authorRequiredFor(L(title)), want);

console.log('--- per-line verdict ---');
eq('title, no author -> author problem', V.lineProblem(L('New General Mathematics')), 'author');
eq('title + author -> fine', V.lineProblem(L('New General Mathematics', 'A.O. Kalejaiye')), null);
eq('stationery, no author -> fine', V.lineProblem(L('2 dozen exercise books')), null);
eq('author, no title -> title problem', V.lineProblem(L('', 'Evans')), 'title');
eq('wholly blank row -> not a problem', V.lineProblem(L('')), null);
eq('whitespace-only author is empty', V.lineProblem(L('Basic Technology', '   ')), 'author');
eq('explicit category beats the guess', V.lineProblem(L('Ruler', '', 'stationery')), null);

console.log('--- whole-form gate ---');
const key = (l) => l.title || 'blank';
let v = V.validateLines([L('New General Mathematics', 'A.O. Kalejaiye'), L('Basic Technology', 'Evans')], key);
eq('a complete list submits', v.ok, true);
eq('...with no message', v.message, null);

v = V.validateLines([L('New General Mathematics', 'A.O. Kalejaiye'), L('Basic Technology')], key);
eq('one missing author blocks', v.ok, false);
eq('...names the offending line', v.missingAuthor, ['Basic Technology']);
eq('...with the exact copy', v.message, 'Author or publisher is required to avoid incorrect quotes.');

v = V.validateLines([L('A'), L('B'), L('C')], key);
eq('several missing -> counted', v.missingAuthor.length, 3);
eq('...and pluralised', v.message.startsWith('3 lines still need'), true);

v = V.validateLines([L('New General Mathematics', 'Evans'), L('2 dozen exercise books'), L('')], key);
eq('exempt + blank rows do not block', v.ok, true);
eq('blank trailing row is not counted as filled', v.filled, 2);

eq('an empty form cannot submit', V.validateLines([], key).ok, false);
eq('only blank rows cannot submit', V.validateLines([L(''), L('')], key).ok, false);

console.log('--- the screenshot list ---');
const lagos = [
  L('Keep Your Head Above Water', 'Kazeem Kareem'), L('Sunrise Poetry 3', 'Olusola Fadiya'),
  L('Attire Satire', 'Oiwana Andrew'), L('The Tobacconist', 'Dele Delani'),
];
eq('a fully-authored real list submits', V.validateLines(lagos, key).ok, true);
eq('drop one author and it stops',
   V.validateLines([...lagos, L('Into The Light')], key).ok, false);

console.log(fail === 0 ? '\nALL PASS' : `\n${fail} FAILED`);
process.exit(fail?1:0);
