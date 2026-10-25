#!/usr/bin/env node
// Ahamkara Wishes — visual snapshots of the real side panel (dev tool).
//
//   node tools/preview/visual.js capture <dir> [--width 360]
//   node tools/preview/visual.js compare <dirA> <dirB>
//
// capture: loads the panel (demo fixture) in headless Chrome, walks a fixed set
//   of screens and saves a PNG of each. Time-dependent text, animations and the
//   text caret are frozen first so two captures of the same code match exactly.
// compare: decodes each pair of PNGs in Chrome and counts differing pixels.
//   Exits 1 if any screen changed. Used to prove a refactor (like moving the
//   legacy stylesheet into a cascade layer) changed nothing you can see.
'use strict';

const fs = require('fs');
const path = require('path');
const { start } = require('./serve');
const { launch, sleep } = require('./headless');

const args = process.argv.slice(2);
const mode = args[0];
const width = Number((args[args.indexOf('--width') + 1]) || 360) || 360;

// Each step runs in the page. Keep them deterministic: no clocks, no random.
const SCREENS = [
  ['weapons-craft', async () => { document.getElementById('tab-weapons').click(); document.getElementById('weapons-nav-craft').click(); }],
  ['weapons-craft-fatebringer', async () => {
    const s = (ms) => new Promise((r) => setTimeout(r, ms));
    document.getElementById('tab-weapons').click(); document.getElementById('weapons-nav-craft').click();
    const q = document.getElementById('weapon-query'); q.value = 'Fatebringer'; q.dispatchEvent(new Event('input', { bubbles: true }));
    for (let i = 0; i < 50 && document.querySelectorAll('#weapon-search-results > *').length < 2; i++) await s(100);
    document.querySelectorAll('#weapon-search-results > *')[1].click();
    for (let i = 0; i < 50 && !document.querySelector('#pp-grid > *'); i++) await s(100);
    await s(2500); // stat bars animate in
  }],
  ['weapons-list', async () => { document.getElementById('tab-weapons').click(); document.getElementById('weapons-nav-list').click(); }],
  ['armor-craft', async () => {
    const s = (ms) => new Promise((r) => setTimeout(r, ms));
    document.getElementById('tab-armor').click(); document.getElementById('nav-craft').click();
    const q = document.getElementById('armor-query'); q.value = 'Techsec'; q.dispatchEvent(new Event('input', { bubbles: true }));
    await s(1500);
  }],
  ['armor-list', async () => { document.getElementById('tab-armor').click(); document.getElementById('nav-list').click(); await new Promise((r) => setTimeout(r, 300)); document.querySelectorAll('.set-header').forEach((h) => h.click()); }],
  ['menu', async () => { document.getElementById('tab-menu').click(); }],
  ['discover', async () => { document.getElementById('tab-menu').click(); document.getElementById('nav-discover').click(); await new Promise((r) => setTimeout(r, 900)); }]
];

/** Freezes everything that differs between two captures of identical code. */
const FREEZE = () => {
  const st = document.createElement('style');
  st.textContent = '*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important}';
  document.head.appendChild(st);
  document.querySelectorAll('.sync-bar-status, #owned-index-summary').forEach((e) => { e.textContent = 'frozen'; });
  document.activeElement && document.activeElement.blur && document.activeElement.blur();
  return Promise.all([...document.images].map((img) => (img.complete ? null : new Promise((r) => { img.onload = img.onerror = r; }))));
};

async function capture(dir) {
  fs.mkdirSync(dir, { recursive: true });
  const { server, url } = await start(0);
  const browser = await launch();
  try {
    // Chrome updates change text anti-aliasing, so compare notes the version.
    fs.writeFileSync(path.join(dir, 'browser.txt'), `${await browser.version()}\n`);
    for (const [name, steps] of SCREENS) {
      const page = await browser.newPage({ width, height: 720 });
      await page.goto(`${url}/sidepanel.html?fixture=demo`);
      await page.waitFor(() => document.getElementById('loading-overlay')?.classList.contains('hidden'), { timeoutMs: 600000, intervalMs: 500 });
      await sleep(500);
      await page.eval(steps);
      await sleep(400);
      await page.eval(FREEZE);
      await sleep(200);
      await page.screenshot(path.join(dir, `${name}.png`));
      if (page.errors.length) console.log(`  note: ${name} logged ${page.errors.length} page error(s): ${page.errors[0]}`);
      console.log(`captured ${name}`);
    }
  } finally { await browser.close(); server.close(); }
}

async function compare(a, b) {
  const names = fs.readdirSync(a).filter((f) => f.endsWith('.png'));
  const ver = (d) => { try { return fs.readFileSync(path.join(d, 'browser.txt'), 'utf8').trim(); } catch (e) { return 'unknown'; } };
  if (ver(a) !== ver(b)) {
    console.log(`warning: captured with different browsers (${ver(a)} vs ${ver(b)}).`);
    console.log('  Text anti-aliasing changes between Chrome versions, so every screen may differ.');
    console.log('  Re-capture the baseline from the old commit with this browser before comparing.\n');
  }
  const browser = await launch();
  let changed = 0;
  try {
    const page = await browser.newPage({ width: 200, height: 200 });
    for (const f of names) {
      const pb = path.join(b, f);
      if (!fs.existsSync(pb)) { console.log(`MISSING in ${b}: ${f}`); changed++; continue; }
      const A = 'data:image/png;base64,' + fs.readFileSync(path.join(a, f)).toString('base64');
      const B = 'data:image/png;base64,' + fs.readFileSync(pb).toString('base64');
      const r = await page.eval(async (srcA, srcB) => {
        const load = (src) => new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = src; });
        const [ia, ib] = await Promise.all([load(srcA), load(srcB)]);
        if (ia.width !== ib.width || ia.height !== ib.height) return { size: `${ia.width}x${ia.height} vs ${ib.width}x${ib.height}` };
        const px = (img) => { const c = document.createElement('canvas'); c.width = img.width; c.height = img.height; const x = c.getContext('2d'); x.drawImage(img, 0, 0); return x.getImageData(0, 0, c.width, c.height).data; };
        const da = px(ia), db = px(ib); let diff = 0, x0 = 1e9, y0 = 1e9, x1 = -1, y1 = -1;
        for (let i = 0; i < da.length; i += 4) {
          if (da[i] !== db[i] || da[i + 1] !== db[i + 1] || da[i + 2] !== db[i + 2] || da[i + 3] !== db[i + 3]) {
            diff++; const p = i / 4, x = p % ia.width, y = Math.floor(p / ia.width);
            if (x < x0) x0 = x; if (y < y0) y0 = y; if (x > x1) x1 = x; if (y > y1) y1 = y;
          }
        }
        return { diff, total: da.length / 4, box: diff ? `x ${x0}-${x1}, y ${y0}-${y1} (device px)` : '' };
      }, A, B);
      if (r.size) { console.log(`CHANGED ${f}: size ${r.size}`); changed++; }
      else if (r.diff) { console.log(`CHANGED ${f}: ${r.diff} of ${r.total} pixels in ${r.box}`); changed++; }
      else console.log(`same    ${f}`);
    }
  } finally { await browser.close(); }
  if (changed) { console.error(`\n${changed} screen(s) differ.`); process.exit(1); }
  console.log(`\nAll ${names.length} screens are pixel-identical.`);
}

(async () => {
  if (mode === 'capture' && args[1]) await capture(path.resolve(args[1]));
  else if (mode === 'compare' && args[1] && args[2]) await compare(path.resolve(args[1]), path.resolve(args[2]));
  else { console.error('usage: visual.js capture <dir> [--width N] | compare <dirA> <dirB>'); process.exit(2); }
})().catch((e) => { console.error(e); process.exit(1); });
