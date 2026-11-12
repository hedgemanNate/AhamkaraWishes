// Colour contrast of the design tokens (WCAG 2.x). Text must reach 4.5:1 on the
// surface it sits on; large text and UI parts 3:1. Reads styles/tokens.css, so a
// token change that makes something unreadable fails here.
const fs = require('fs');
const path = require('path');

const css = fs.readFileSync(path.resolve(__dirname, '..', 'styles', 'tokens.css'), 'utf8');
const vars = {};
for (const m of css.matchAll(/--([a-z0-9-]+):\s*([^;]+);/g)) vars[m[1]] = m[2].trim().replace(/\/\*.*?\*\//g, '').trim();

/** Resolves var(--x) chains to a colour string. */
function resolve(name, seen = new Set()) {
  const v = vars[name];
  if (v === undefined || seen.has(name)) throw new Error(`unknown token --${name}`);
  seen.add(name);
  const m = v.match(/^var\(--([a-z0-9-]+)\)$/);
  return m ? resolve(m[1], seen) : v;
}
function rgb(c) {
  let m = c.match(/^#([0-9a-f]{6})$/i);
  if (m) return [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16)).concat(1);
  m = c.match(/^#([0-9a-f]{3})$/i);
  if (m) return [0, 1, 2].map((i) => parseInt(m[1][i] + m[1][i], 16)).concat(1);
  m = c.match(/^rgba?\(([^)]+)\)$/);
  if (m) { const p = m[1].split(',').map(Number); return [p[0], p[1], p[2], p[3] === undefined ? 1 : p[3]]; }
  throw new Error(`cannot read colour ${c}`);
}
const over = (fg, bg) => fg.slice(0, 3).map((c, i) => c * fg[3] + bg[i] * (1 - fg[3]));
const lum = ([r, g, b]) => { const f = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
function ratio(fgName, bgName, layerName) {
  let bg = rgb(resolve(bgName));
  if (bg[3] < 1) bg = over(bg, rgb(resolve(layerName || 'ui-bg'))).concat(1);
  let fg = rgb(resolve(fgName));
  fg = fg[3] < 1 ? over(fg, bg) : fg.slice(0, 3);
  const [a, b] = [lum(fg), lum(bg.slice(0, 3))];
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

let failures = 0;
function check(label, fg, bg, min, layer) {
  const r = ratio(fg, bg, layer);
  const ok = r >= min;
  console.log(`${ok ? 'PASS' : 'FAIL'}: ${label} (${r.toFixed(2)}:1, needs ${min})`);
  if (!ok) failures++;
}

['ui-bg', 'ui-surface-1', 'ui-surface-2', 'ui-surface-3'].forEach((s) => {
  check(`body text on ${s}`, 'ui-text', s, 4.5);
  check(`muted text on ${s}`, 'ui-text-muted', s, 4.5);
  check(`accent text on ${s}`, 'ui-accent', s, 4.5);
  check(`success on ${s}`, 'ui-success', s, 4.5);
  check(`warning on ${s}`, 'ui-warning', s, 4.5);
  check(`danger on ${s}`, 'ui-danger', s, 4.5);
  check(`PvE on ${s}`, 'ui-mode-pve', s, 4.5);
  check(`PvP on ${s}`, 'ui-mode-pvp', s, 4.5);
});
check('text on a gold button', 'ui-on-accent', 'ui-accent', 4.5);
check('accent text on the selected chip (accent wash over a card)', 'ui-accent', 'ui-accent-soft', 4.5, 'ui-surface-1');
check('muted text on the accent wash', 'ui-text-muted', 'ui-accent-faint', 4.5, 'ui-surface-1');
check('muted text on the "owned" highlight', 'ui-text-muted', 'ui-accent-soft', 4.5, 'ui-surface-1');
check('danger text on its wash', 'ui-danger', 'ui-danger-soft', 4.5, 'ui-surface-1');
// Placeholder text is exempt from the 4.5 rule but must stay legible.
check('placeholder text (dim) on the field surface', 'ui-text-dim', 'ui-surface-1', 3);
// Non-text parts: the focus ring and the markers that carry meaning.
check('focus ring against the page', 'ui-focus', 'ui-bg', 3);
check('focus ring against a card', 'ui-focus', 'ui-surface-1', 3);
['ui-combo-1', 'ui-combo-2', 'ui-combo-3', 'ui-combo-4'].forEach((c, i) => check(`combo ${i + 1} marker against a card`, c, 'ui-surface-1', 3));

// Text that sits ON a combo colour (the combo number chips and dots).
['ui-combo-1', 'ui-combo-2', 'ui-combo-3', 'ui-combo-4'].forEach((c, i) => check(`combo ${i + 1} chip text (dark ink on the colour)`, 'ui-on-accent', c, 4.5));

// Combo colours used AS text (a brush chip that is in use) on the toolbar surfaces.
['ui-surface-1', 'ui-surface-3'].forEach((surf) => ['ui-combo-1-text', 'ui-combo-2-text', 'ui-combo-3-text', 'ui-combo-4-text'].forEach((c, i) => check(`combo ${i + 1} as text on ${surf}`, c, surf, 4.5)));

if (failures) { console.error(`\n${failures} contrast check(s) failed`); process.exit(1); }
console.log('\nAll contrast checks passed');
