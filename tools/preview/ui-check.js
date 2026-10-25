#!/usr/bin/env node
// Ahamkara Wishes — UI smoke check in headless Chrome (dev tool).
//
//   npm run ui-check
//
// Starts the preview server and a private headless Chrome, then loads the real
// side panel with each fixture and checks what a person would see:
//   demo     lists render, no page errors, nothing wider than the panel
//   hostile  shared/imported junk renders as inert text: no script runs, no
//            off-site image loads, the rest of each list still works
//   empty    a fresh install shows its empty states
// Screenshots go to tools/preview/.out/ (git-ignored).
//
// Not part of `npm test`/CI on purpose: it needs Chrome and downloads Bungie's
// game data (~200 MB) on its first run. Later runs reuse the cached copy.
'use strict';

const path = require('path');
const { start } = require('./serve');
const { launch, sleep } = require('./headless');

const OUT = path.join(__dirname, '.out');
const WIDTHS = [320, 360];
let failures = 0;
const check = (label, ok, detail) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}: ${label}${ok || !detail ? '' : `  (${detail})`}`);
  if (!ok) failures++;
};

async function openPanel(browser, base, fixture, width) {
  const page = await browser.newPage({ width, height: 720 });
  await page.goto(`${base}/sidepanel.html?fixture=${fixture}`);
  // The loading overlay hides once Bungie's game data is ready.
  await page.waitFor(() => document.getElementById('loading-overlay')?.classList.contains('hidden'), { timeoutMs: 600000, intervalMs: 500 });
  await sleep(300);
  return page;
}

/** Opens a list view inside the page and returns what it shows. */
const readLists = async () => {
  const s = (ms) => new Promise((r) => setTimeout(r, ms));
  document.getElementById('tab-weapons').click(); document.getElementById('weapons-nav-list').click(); await s(600);
  const weapons = [...document.querySelectorAll('#weapon-list-items .wc-name')].map((e) => e.textContent);
  document.getElementById('tab-armor').click(); document.getElementById('nav-list').click(); await s(600);
  const armor = [...document.querySelectorAll('#armor-list-container .card-armor-name')].map((e) => e.textContent);
  document.querySelectorAll('.set-header').forEach((h) => h.click()); await s(200);
  const html = document.documentElement.outerHTML;
  return {
    weapons, armor,
    pwned: window.__pwned ?? null,
    handlers: document.querySelectorAll('[onerror],[onload],script:not([src])').length,
    offsite: [...document.images].map((i) => i.getAttribute('src') || '').filter((u) => /^https?:/.test(u) && !/^https:\/\/www\.bungie\.net\//.test(u)),
    evilInDom: /evil\.example/.test(html),
    wider: document.documentElement.scrollWidth > window.innerWidth + 1
  };
};

(async () => {
  const { server, url } = await start(0);
  const browser = await launch();
  try {
    for (const width of WIDTHS) {
      // demo
      let page = await openPanel(browser, url, 'demo', width);
      let r = await page.eval(readLists);
      check(`[${width}] demo: weapon list renders`, r.weapons.length === 3, JSON.stringify(r.weapons));
      check(`[${width}] demo: armor list renders`, r.armor.length === 3, JSON.stringify(r.armor));
      check(`[${width}] demo: nothing wider than the panel`, !r.wider);
      check(`[${width}] demo: no page errors`, page.errors.length === 0, page.errors[0]);
      await page.screenshot(path.join(OUT, `demo-armor-${width}.png`));

      // hostile
      page = await openPanel(browser, url, 'hostile', width);
      r = await page.eval(readLists);
      check(`[${width}] hostile: no injected script ran`, r.pwned === null && r.handlers === 0, `pwned=${r.pwned} handlers=${r.handlers}`);
      check(`[${width}] hostile: no off-site images`, r.offsite.length === 0 && !r.evilInDom, JSON.stringify(r.offsite));
      check(`[${width}] hostile: the honest wish still renders`, r.weapons.some((n) => n === 'Honest Gun'), JSON.stringify(r.weapons));
      check(`[${width}] hostile: malformed armor doesn't blank the list`, r.armor.length >= 3, JSON.stringify(r.armor));
      check(`[${width}] hostile: malicious names show as text`, r.weapons.some((n) => n.includes('onerror')));
      check(`[${width}] hostile: no page errors`, page.errors.length === 0, page.errors[0]);
      await page.screenshot(path.join(OUT, `hostile-armor-${width}.png`));

      // empty
      page = await openPanel(browser, url, 'empty', width);
      r = await page.eval(readLists);
      check(`[${width}] empty: no wishes, no crash`, r.weapons.length === 0 && r.armor.length === 0);
      check(`[${width}] empty: empty states shown`, await page.eval(() => /No (Armor|weapon) Wishes yet/i.test(document.body.innerText)));
      check(`[${width}] empty: no page errors`, page.errors.length === 0, page.errors[0]);
    }
  } finally {
    await browser.close();
    server.close();
  }
  if (failures) { console.error(`\n${failures} UI check(s) failed. Screenshots: ${OUT}`); process.exit(1); }
  console.log(`\nAll UI checks passed. Screenshots: ${OUT}`);
})().catch((e) => { console.error(e); process.exit(1); });
