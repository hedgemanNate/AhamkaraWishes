#!/usr/bin/env node
// Ahamkara Wishes — UI smoke check in headless Chrome (dev tool).
//
//   npm run ui-check
//
// Starts the preview server and a private headless Chrome, then loads the real
// side panel with each fixture and checks what a person would see:
//   demo     lists render, no page errors, nothing wider than the panel; Delete
//            and Edit hit the right wish after the list shifted under them
//   hostile  shared/imported junk renders as inert text: no script runs, no
//            off-site image loads, the rest of each list still works
//   empty    a fresh install shows its empty states
//   gallery  every AWUI building block: fonts, overflow, target sizes, keyboard
//            (segmented arrows, Escape on sheets and dialogs, focus return), Undo
// --gallery-only runs just the gallery (no game-data download needed).
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
  const sets = [...document.querySelectorAll('#armor-list-container .set-name-text')].map((e) => e.textContent.trim());
  document.querySelectorAll('.set-header').forEach((h) => h.click()); await s(200);
  const html = document.documentElement.outerHTML;
  return {
    weapons, armor, sets,
    pwned: window.__pwned ?? null,
    handlers: document.querySelectorAll('[onerror],[onload],script:not([src])').length,
    offsite: [...document.images].map((i) => i.getAttribute('src') || '').filter((u) => /^https?:/.test(u) && !/^https:\/\/www\.bungie\.net\//.test(u)),
    evilInDom: /evil\.example/.test(html),
    wider: document.documentElement.scrollWidth > window.innerWidth + 1
  };
};

/**
 * Delete and Edit after the list changed under them (sync, another tab): each
 * must act on the wish its row was drawn from, never a neighbour at the same
 * index. Runs the app's real deleteWish / deleteArmorWish / editItemWish.
 */
const staleRowActions = async () => {
  const WS = window.WishlistSync;
  const items = () => window.__awPreview.dump().dimData.lists[window.__awPreview.dump().dimData.activeId].items;
  const pick = (type) => Object.entries(items()).find(([, i]) => i.static.type === type);
  // Another browser's wish arrives at the front: every saved row's index is now off by one.
  const pushFront = (hash, wish) => AWStore.update((d) => { d.lists[d.activeId].items[hash].wishes.unshift(wish); });
  const out = {};

  let [hash, item] = pick('weapon');
  let target = item.wishes[0];
  let intruder = { tags: ['pvp'], config: { perks: [[1]] }, raw: '[[1]]', added: Date.now() };
  await pushFront(hash, intruder);
  await deleteWish(hash, 0, WS.wishKey(target)); // the row was drawn when target was at 0
  let left = items()[hash]?.wishes || [];
  out.weaponDelete = left.length === 1 && left[0].raw === '[[1]]';

  [hash, item] = pick('armor');
  target = item.wishes[0];
  intruder = { tags: ['pvp'], config: { archetype: 'GUNNER', tertiary: null, spark: null }, raw: `armor-wish:${hash}`, added: Date.now() };
  await pushFront(hash, intruder);
  await deleteArmorWish(hash, 0, WS.wishKey(target));
  left = items()[hash]?.wishes || [];
  out.armorDelete = left.length === 1 && WS.wishKey(left[0]) === WS.wishKey(intruder);

  [hash, item] = pick('weapon');
  target = item.wishes[0];
  await pushFront(hash, { tags: ['pvp'], config: { perks: [[2]] }, raw: '[[2]]', added: Date.now() });
  let r = await editItemWish(hash, 0, '[[3]]', { perks: [[3]] }, 'pve', WS.wishKey(target));
  left = items()[hash].wishes;
  out.editStale = r.result === 'updated' && left[0].raw === '[[2]]' && left[1].raw === '[[3]]';
  r = await editItemWish(hash, 1, '[[2]]', { perks: [[2]] }, 'pvp', r.key);
  out.editDuplicate = r.result === 'duplicate' && items()[hash].wishes[1].raw === '[[3]]';
  r = await editItemWish(hash, 0, '[[4]]', { perks: [[4]] }, 'pve', 'pve|weapon:gone');
  out.editMissing = r.result === 'missing' && items()[hash].wishes.length === 2;
  return out;
};

/**
 * The AWUI building blocks in real Chrome (tools/preview/gallery.html): fonts,
 * overflow, target sizes, and keyboard/focus behaviour that a fake DOM can't show.
 */
async function checkGallery(browser, base, width) {
  const page = await browser.newPage({ width: width + 40, height: 900 });
  await page.goto(`${base}/gallery?w=${width}`);
  await page.waitFor(() => window.__gallery && document.fonts.status === 'loaded');
  const tag = `[${width}] gallery`;
  const ev = (fn, ...a) => page.eval(fn, ...a);

  check(`${tag}: IBM Plex fonts load from the extension`, await ev(() => document.fonts.check('16px "IBM Plex Sans"') && document.fonts.check('600 16px "IBM Plex Sans Condensed"')));

  const layout = await ev(() => {
    const frame = document.getElementById('frame').getBoundingClientRect();
    const over = [], small = [];
    document.querySelectorAll('#gallery *').forEach((e) => {
      if (e.closest('.ui-chip-row') && !e.closest('.ui-filter-section')) return; // scrolls sideways on purpose
      const r = e.getBoundingClientRect();
      if (r.width && r.right > frame.right + 1) over.push(e.className || e.tagName);
    });
    document.querySelectorAll('#gallery button, #gallery input').forEach((e) => {
      const r = e.getBoundingClientRect();
      if (!r.width || e.closest('[hidden]')) return;
      // 44px is the goal (D2); chips are 40px with a 44px hit area; switches draw
      // 28px with a 44px ::before hit area; WCAG 2.2's floor is 24px wide.
      const minH = e.classList.contains('ui-switch') ? 28 : 40;
      if (r.height < minH || r.width < 24) small.push(`${e.className || e.tagName} ${Math.round(r.width)}x${Math.round(r.height)}`);
    });
    return { over, small };
  });
  check(`${tag}: nothing wider than the panel`, layout.over.length === 0, layout.over.slice(0, 4).join(', '));
  check(`${tag}: every control is big enough to tap`, layout.small.length === 0, layout.small.slice(0, 4).join(', '));

  // Segmented control: real arrow key moves the choice and focus.
  await ev(() => document.querySelector('#g-seg [aria-checked="true"]').focus());
  await page.press('ArrowRight');
  check(`${tag}: segmented control follows arrow keys`, await ev(() => {
    const on = document.querySelector('#g-seg [aria-checked="true"]');
    return on && on.dataset.value === 'armor' && document.activeElement === on && window.__gallery.log.includes('seg:armor') && on.tabIndex === 0;
  }));

  // Switch
  check(`${tag}: switch toggles with a click and reports aria-checked`, await ev(() => {
    const sw = document.querySelector('#g-switch [role=switch]'); sw.click();
    return sw.getAttribute('aria-checked') === 'false' && window.__gallery.log.includes('lock:false');
  }));

  // Search clear button
  check(`${tag}: search shows a clear button only when there is text`, await ev(() => {
    const input = document.querySelector('#g-search input'), clear = document.querySelector('#g-search .ui-search__clear');
    const before = clear.hidden; input.value = 'fate'; input.dispatchEvent(new Event('input')); const during = clear.hidden;
    clear.click(); return before === true && during === false && input.value === '' && clear.hidden === true;
  }));

  // Sheet: inert background, focus in, Escape closes, focus back.
  await ev(() => document.getElementById('g-open-sheet').click());
  check(`${tag}: sheet opens over inert content and takes focus`, await ev(() =>
    !document.getElementById('g-lists').hidden && document.getElementById('gallery').inert === true && document.getElementById('g-lists').contains(document.activeElement)));
  await ev(() => [...document.querySelectorAll('#g-lists .ui-row--action')][1].click());
  check(`${tag}: sheets stack; the one beneath goes inert`, await ev(() =>
    !document.getElementById('g-filters').hidden && document.getElementById('g-lists').inert === true && document.getElementById('g-filters').inert === false));
  const counts = await ev(() => {
    const btn = () => document.querySelector('#g-filters .ui-btn--primary .ui-btn__label').textContent;
    const before = btn(); document.querySelector('#g-filters .ui-chip').click(); const after = btn();
    return { before, after };
  });
  check(`${tag}: filter sheet shows a live result count`, counts.before === 'Show 4 wishes' && counts.after === 'Show 2 wishes', JSON.stringify(counts));
  await page.press('Escape'); await page.press('Escape');
  check(`${tag}: Escape closes sheets top-first and focus returns to the opener`, await ev(() =>
    document.getElementById('g-lists').hidden && document.getElementById('g-filters').hidden && document.getElementById('gallery').inert === false && document.activeElement === document.getElementById('g-open-sheet')));

  // Confirm dialog: Cancel is focused first, Escape cancels, Confirm resolves true.
  await ev(() => document.getElementById('g-confirm').click());
  await sleep(100);
  check(`${tag}: confirm dialog opens with Cancel focused (no accidental deletes)`, await ev(() => {
    const d = document.querySelector('dialog.ui-dialog[open]'); return !!d && document.activeElement && document.activeElement.textContent.trim() === 'Cancel';
  }));
  await page.press('Escape'); await sleep(100);
  check(`${tag}: Escape cancels the dialog`, await ev(() => !document.querySelector('dialog.ui-dialog') && window.__gallery.log.includes('confirm:false')));
  await ev(() => document.getElementById('g-confirm').click()); await sleep(100);
  await ev(() => [...document.querySelectorAll('dialog.ui-dialog .ui-btn')].find((b) => b.textContent.trim() === 'Remove').click()); await sleep(100);
  check(`${tag}: confirming resolves true`, await ev(() => window.__gallery.log.includes('confirm:true')));

  // Toast with Undo, announced through one live region.
  await ev(() => document.getElementById('g-toast').click());
  check(`${tag}: toast appears in a polite live region with Undo`, await ev(() => {
    const t = document.querySelector('.ui-toasts[aria-live="polite"] .ui-toast'); return !!t && /Undo/.test(t.textContent);
  }));
  await ev(() => [...document.querySelectorAll('.ui-toast .ui-btn')].find((b) => b.textContent.trim() === 'Undo').click());
  check(`${tag}: Undo runs and dismisses the toast`, await ev(() => window.__gallery.log.includes('undo') && !document.querySelector('.ui-toast')));

  check(`${tag}: no page errors`, page.errors.length === 0, page.errors[0]);
  await page.eval(() => document.getElementById('gallery').scrollTo(0, 0));
  await page.screenshot(path.join(OUT, `gallery-${width}.png`));
}

(async () => {
  const { server, url } = await start(0);
  const browser = await launch();
  try {
    for (const width of [320, 360, 540]) await checkGallery(browser, url, width);
    for (const width of process.argv.includes('--gallery-only') ? [] : WIDTHS) {
      // demo
      let page = await openPanel(browser, url, 'demo', width);
      let r = await page.eval(readLists);
      check(`[${width}] demo: weapon list renders`, r.weapons.length === 3, JSON.stringify(r.weapons));
      check(`[${width}] demo: armor list renders`, r.armor.length === 3, JSON.stringify(r.armor));
      // The demo's armor was saved without set hashes; startup backfills them.
      check(`[${width}] demo: both Techsec pieces group under Bungie's set name`, r.sets.filter((n) => n === 'Techsec').length === 1 && r.sets.length === 2, JSON.stringify(r.sets));
      check(`[${width}] demo: nothing wider than the panel`, !r.wider);
      check(`[${width}] demo: no page errors`, page.errors.length === 0, page.errors[0]);
      await page.screenshot(path.join(OUT, `demo-armor-${width}.png`));
      if (width === WIDTHS[0]) {
        const s = await page.eval(staleRowActions);
        check('demo: Delete after the list shifted removes the right weapon wish', s.weaponDelete);
        check('demo: Delete after the list shifted removes the right armor wish', s.armorDelete);
        check('demo: Edit after the list shifted changes the right wish', s.editStale);
        check('demo: Edit into an existing roll is refused, nothing changes', s.editDuplicate);
        check('demo: Edit of a wish deleted elsewhere changes nothing', s.editMissing);
        check('demo: no page errors after the edits', page.errors.length === 0, page.errors[0]);
      }

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
