#!/usr/bin/env node
// Ahamkara Wishes — checks a built extension before it ships.
//
//   bash build-extension.sh && node tools/check-build.js [dist/ahamkara-wishes]
//
// build-extension.sh copies an explicit file list, so a new file that someone
// forgets to add there ships as a broken extension with no warning. This
// finds every file the extension refers to and fails if any is missing from
// the build, and fails if dev-only files (tools, tests, docs, ...) leaked in.
//
// References it follows:
//   manifest.json   service worker, content scripts, side panel, icons
//   *.html          <script src>, <link href>, <img src>
//   *.js            string literals that name a local file (importScripts,
//                   chrome.runtime.getURL, registered content scripts, ...)
//   *.css           url(...) and @import
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const DIST = path.resolve(process.argv[2] || path.join(ROOT, 'dist', 'ahamkara-wishes'));

const FORBIDDEN_DIRS = ['tools', 'tests', 'docs', 'supabase', 'node_modules', '.playwright-mcp', '.git', '.github', '.vscode'];
const FORBIDDEN_FILES = [/\.md$/i, /^package(-lock)?\.json$/, /^build-extension\.sh$/, /\.zip$/];
// Docs that are deliberately shipped alongside third-party data they describe.
const ALLOWED_MD = new Set(['vendor/dim-watermarks/LICENSE.md', 'vendor/dim-watermarks/README.md']);

// Strings that look like file names but aren't files in the package.
const NOT_FILES = new Map([
  // chrome.identity.getRedirectURL(path) builds a virtual https://<id>.chromiumapp.org/<path>
  // URL for the Bungie sign-in redirect; no file is ever loaded from it.
  ['bungie-oauth-callback.html', 'identity redirect path']
]);

// Local file paths inside string literals: no scheme, no leading slash, a known extension.
const LOCAL_REF = /['"`]((?:[\w.-]+\/)*[\w.-]+\.(?:js|mjs|css|html|json|csv|wasm|png|jpe?g|svg|webp|woff2?))['"`]/g;
const CSS_REF = /url\(\s*['"]?([^'")]+)['"]?\s*\)|@import\s+['"]([^'"]+)['"]/g;
const HTML_REF = /\s(?:src|href)=["']([^"'#?]+)["']/g;

/**
 * Removes line and block comments while leaving string and template literals
 * intact, so URLs and match patterns such as https://godroll.tv/<star> survive.
 */
function stripComments(js) {
  let out = '', i = 0;
  while (i < js.length) {
    const c = js[i], n = js[i + 1];
    if (c === '/' && n === '*') { const end = js.indexOf('*/', i + 2); i = end < 0 ? js.length : end + 2; continue; }
    if (c === '/' && n === '/') { while (i < js.length && js[i] !== '\n') i++; continue; }
    if (c === "'" || c === '"' || c === '`') {
      let j = i + 1;
      while (j < js.length && js[j] !== c) { if (js[j] === '\\') j++; j++; }
      out += js.slice(i, j + 1); i = j + 1; continue;
    }
    out += c; i++;
  }
  return out;
}

let failures = 0;
const fail = (msg) => { console.log('FAIL: ' + msg); failures++; };

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out); else out.push(p);
  }
  return out;
}
const rel = (p) => path.relative(DIST, p).split(path.sep).join('/');
const isRemote = (u) => /^(?:[a-z]+:)?\/\//i.test(u) || /^(data|blob|chrome|about):/i.test(u);

if (!fs.existsSync(path.join(DIST, 'manifest.json'))) {
  console.error(`No build at ${DIST}. Run: bash build-extension.sh`);
  process.exit(2);
}

const files = walk(DIST);
const shipped = new Set(files.map(rel));
const refs = new Map(); // target -> Set(of referrers)
const ref = (target, from) => {
  const t = path.posix.normalize(target.replace(/^\.\//, ''));
  if (!refs.has(t)) refs.set(t, new Set());
  refs.get(t).add(from);
};
const resolveFrom = (fromFile, target) => path.posix.normalize(path.posix.join(path.posix.dirname(fromFile), target));

// ---- manifest
const manifest = JSON.parse(fs.readFileSync(path.join(DIST, 'manifest.json'), 'utf8'));
if (manifest.background && manifest.background.service_worker) ref(manifest.background.service_worker, 'manifest.json');
for (const cs of manifest.content_scripts || []) [...(cs.js || []), ...(cs.css || [])].forEach((f) => ref(f, 'manifest.json'));
if (manifest.side_panel && manifest.side_panel.default_path) ref(manifest.side_panel.default_path, 'manifest.json');
Object.values(manifest.icons || {}).forEach((f) => ref(f, 'manifest.json'));
Object.values((manifest.action && manifest.action.default_icon) || {}).forEach((f) => ref(f, 'manifest.json'));

// ---- shipped sources
for (const file of files) {
  const r = rel(file);
  const ext = path.extname(file).toLowerCase();
  if (!['.html', '.js', '.css'].includes(ext)) continue;
  // The generated WASM glue is third-party output; its own imports are relative to itself.
  const text = fs.readFileSync(file, 'utf8');
  if (ext === '.html') {
    for (const m of text.matchAll(HTML_REF)) if (!isRemote(m[1])) ref(resolveFrom(r, m[1]), r);
  } else if (ext === '.css') {
    for (const m of text.matchAll(CSS_REF)) { const u = m[1] || m[2]; if (u && !isRemote(u)) ref(resolveFrom(r, u), r); }
  } else {
    // Comments aren't references (they often mention example paths).
    const code = stripComments(text);
    // JS paths are usually relative to the extension root (chrome.runtime.getURL,
    // importScripts from the root service worker, content-script lists); ES
    // modules such as the WASM glue load files relative to themselves instead.
    for (const m of code.matchAll(LOCAL_REF)) {
      if (NOT_FILES.has(m[1])) continue;
      const besideIt = resolveFrom(r, m[1]);
      ref(!shipped.has(m[1]) && shipped.has(besideIt) ? besideIt : m[1], r);
    }
  }
}

// ---- 1. everything referenced exists in the build
for (const [target, from] of [...refs].sort()) {
  if (!shipped.has(target)) fail(`${target} is referenced by ${[...from].join(', ')} but is not in the build (add it to build-extension.sh)`);
}

// ---- 2. nothing dev-only leaked in
for (const r of shipped) {
  const top = r.split('/')[0];
  if (FORBIDDEN_DIRS.includes(top)) fail(`${r} is a dev-only file and must not ship`);
  else if (!ALLOWED_MD.has(r) && FORBIDDEN_FILES.some((re) => re.test(path.posix.basename(r)))) fail(`${r} must not ship`);
}

// ---- 3. note files nothing refers to (not a failure: data files can be loaded indirectly)
const orphans = [...shipped].filter((r) => !refs.has(r) && r !== 'manifest.json' && !ALLOWED_MD.has(r));
if (orphans.length) console.log(`note: ${orphans.length} shipped file(s) not referenced by name: ${orphans.join(', ')}`);

if (failures) { console.error(`\n${failures} build problem(s).`); process.exit(1); }
console.log(`Build OK: ${shipped.size} files, ${refs.size} references all resolve.`);
