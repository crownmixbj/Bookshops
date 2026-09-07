// react-native-web renders a View/Pressable carrying
// accessibilityRole="button" as a real <button> element. Nesting two of
// them is invalid HTML, and React says so once per offending tree.
//
// This walks the JSX and reports any pressable rendered inside another
// pressable in the same file.
const fs = require('fs');
const path = require('path');
const babel = require('@babel/core');
const traverse = require('@babel/traverse').default;

const PRESSABLE = new Set(['Pressable', 'TouchableOpacity', 'TouchableHighlight',
  'TouchableWithoutFeedback', 'Button', 'TouchableNativeFeedback']);

// Renders as a real <button>? Only the ROLE decides that in RNW — a
// bare Pressable is a <div>, and a button inside a div is valid. The
// element name is irrelevant, which is why the first pass over-reported.
function isButtonEl(node) {
  if (!node.openingElement) return false;
  return node.openingElement.attributes.some(
    (a) =>
      (a.name?.name === 'accessibilityRole' || a.name?.name === 'role') &&
      a.value?.value === 'button'
  );
}
// Secondary signal: nested pressables are legal HTML but share a click,
// so the inner one needs stopPropagation or both handlers fire.
function isPressable(node) {
  return PRESSABLE.has(node.openingElement?.name?.name);
}

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.(tsx|jsx|js)$/.test(e.name)) out.push(p);
  }
  return out;
}

const hits = [];
for (const file of [...walk('app'), ...walk('components')]) {
  let ast;
  try {
    ast = babel.parseSync(fs.readFileSync(file, 'utf8'), {
      filename: file, presets: ['babel-preset-expo'], configFile: false, babelrc: false, ast: true,
    });
  } catch { continue; }
  traverse(ast, {
    JSXElement(p) {
      const inner = p.node;
      const innerIsBtn = isButtonEl(inner);
      const innerIsPress = isPressable(inner) || innerIsBtn;
      if (!innerIsPress) return;
      const stops = /stopPropagation/.test(
        fs.readFileSync(file, 'utf8').slice(inner.start, inner.end)
      );
      let a = p.parentPath;
      while (a) {
        if (a.isJSXElement() && (isPressable(a.node) || isButtonEl(a.node))) {
          const invalidHtml = innerIsBtn && isButtonEl(a.node);
          if (invalidHtml || !stops) {
            hits.push({
              file,
              outer: a.node.openingElement.name.name,
              outerLine: a.node.loc.start.line,
              inner: inner.openingElement.name.name,
              innerLine: inner.loc.start.line,
              kind: invalidHtml ? 'NESTED <button> — React will warn' : 'shared click — no stopPropagation',
            });
          }
          break;
        }
        a = a.parentPath;
      }
    },
  });
}

if (!hits.length) console.log('no nested pressables found');
for (const h of hits) {
  console.log(`${h.kind}\n  ${h.file}\n    ${h.outer} (line ${h.outerLine})  ->  ${h.inner} (line ${h.innerLine})`);
}
console.log(`\n${hits.length} nested pressable(s)`);
