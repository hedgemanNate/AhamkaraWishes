#!/usr/bin/env node
// Ahamkara Wishes — lint ratchet.
//
//   node tools/lint-ratchet.js            check (part of npm test and CI)
//   node tools/lint-ratchet.js --update   record lower counts after a cleanup
//
// Counts the patterns the pre-launch audit flagged and fails if any count goes
// UP compared with tools/ratchet.json. Counts may only go down, so the codebase
// gets cleaner as old screens are rebuilt and can't quietly slide back.
//
// Metrics:
//   innerHTMLInterpolations  innerHTML assignments built from a template with ${...}
//                            (the injection risk aw-dom.js exists to remove)
//   rawHexColors             hex colours in CSS outside the token files
//   importantRules           !important declarations in CSS
//   directDimDataWrites      chrome.storage writes of dimData outside aw-store.js
//   nativeDialogs            alert()/confirm()/prompt() in UI code
//   inlineStyleAttributes    style="..." inside JS template strings
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const BASELINE = path.join(__dirname, 'ratchet.json');
// Token files are where raw colours are supposed to live.
const TOKEN_FILES = new Set(['styles/tokens.css']);
const SKIP_DIRS = new Set(['node_modules', 'dist', 'ahamkara-wishes', 'tools', 'tests', 'vendor', 'oracle-engine', 'supabase', 'docs', '.git', '.github', '.playwright-mcp', 'DIM-master']);

function sources() {
  const out = [];
  (function walk(dir) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name)) walk(path.join(dir, e.name)); continue; }
      if (/\.(js|css)$/.test(e.name)) out.push(path.join(dir, e.name));
    }
  })(ROOT);
  return out.sort();
}

/**
 * From the index of an opening backtick, returns [endIndex, hasInterpolation]
 * for that template literal, stepping over nested templates inside ${...}.
 */
function scanTemplate(text, start) {
  let i = start + 1, has = false;
  while (i < text.length) {
    const c = text[i];
    if (c === '\\') { i += 2; continue; }
    if (c === '`') return [i, has];
    if (c === '$' && text[i + 1] === '{') {
      has = true; i += 2; let depth = 1;
      while (i < text.length && depth > 0) {
        const d = text[i];
        if (d === '`') { i = scanTemplate(text, i)[0] + 1; continue; }
        if (d === "'" || d === '"') { const q = d; i++; while (i < text.length && text[i] !== q) { if (text[i] === '\\') i++; i++; } i++; continue; }
        if (d === '{') depth++; else if (d === '}') depth--;
        i++;
      }
      continue;
    }
    i++;
  }
  return [i, has];
}

function count(file) {
  const text = fs.readFileSync(file, 'utf8');
  const relPath = path.relative(ROOT, file).split(path.sep).join('/');
  const m = { innerHTMLInterpolations: 0, rawHexColors: 0, importantRules: 0, directDimDataWrites: 0, nativeDialogs: 0, inlineStyleAttributes: 0 };
  if (file.endsWith('.css')) {
    const noComments = text.replace(/\/\*[\s\S]*?\*\//g, '');
    if (!TOKEN_FILES.has(relPath)) m.rawHexColors = (noComments.match(/#[0-9a-fA-F]{3,8}\b/g) || []).length;
    m.importantRules = (noComments.match(/!important/g) || []).length;
    return m;
  }
  for (const hit of text.matchAll(/\.(?:innerHTML|outerHTML)\s*\+?=\s*`/g)) {
    const [, has] = scanTemplate(text, hit.index + hit[0].length - 1);
    if (has) m.innerHTMLInterpolations++;
  }
  if (relPath !== 'aw-store.js') m.directDimDataWrites = (text.match(/\.set\(\s*\{\s*dimData\b/g) || []).length;
  m.nativeDialogs = (text.match(/(?<![\w.])(?:window\.)?(?:alert|confirm|prompt)\s*\(/g) || []).length;
  m.inlineStyleAttributes = (text.match(/style="[^"$]*"/g) || []).filter(Boolean).length;
  return m;
}

function totals() {
  const sum = {}, perFile = {};
  for (const f of sources()) {
    const c = count(f);
    const r = path.relative(ROOT, f).split(path.sep).join('/');
    for (const [k, v] of Object.entries(c)) {
      sum[k] = (sum[k] || 0) + v;
      if (v) { perFile[k] = perFile[k] || {}; perFile[k][r] = v; }
    }
  }
  return { sum, perFile };
}

const { sum, perFile } = totals();

if (process.argv.includes('--update')) {
  fs.writeFileSync(BASELINE, JSON.stringify(sum, null, 2) + '\n');
  console.log('Ratchet baseline updated:', sum);
  process.exit(0);
}

const base = JSON.parse(fs.readFileSync(BASELINE, 'utf8'));
let worse = 0, better = 0;
for (const [k, v] of Object.entries(sum)) {
  const b = base[k] ?? 0;
  if (v > b) {
    worse++;
    console.log(`FAIL: ${k} went up ${b} -> ${v}`);
    console.log('      where: ' + Object.entries(perFile[k] || {}).map(([f, n]) => `${f}:${n}`).join(', '));
  } else if (v < b) {
    better++;
    console.log(`down: ${k} ${b} -> ${v} (run node tools/lint-ratchet.js --update to lock it in)`);
  }
}
if (worse) { console.error(`\nLint ratchet: ${worse} metric(s) got worse. New code should use aw-dom.js, tokens and AWStore instead.`); process.exit(1); }
console.log(`Lint ratchet OK${better ? ` (${better} metric(s) improved)` : ''}: ` + Object.entries(sum).map(([k, v]) => `${k}=${v}`).join(', '));
