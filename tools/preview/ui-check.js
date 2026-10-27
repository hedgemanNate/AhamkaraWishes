#!/usr/bin/env node
// Ahamkara Wishes — UI smoke check in headless Chrome (dev tool).
//
//   npm run ui-check
//
// Starts the preview server and a private headless Chrome, then loads the real
// side panel with each fixture and checks what a person would see, screen by screen
// (Wishes, Drops, Inventory, Discover, both builders, Lists, Me, first run):
//   demo     lists render, nothing wider than the panel; edits after the list shifted
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
const READY_FN = () => window.AWManifestState === 'ready' || window.AWManifestState === 'failed';
const WIDTHS = [320, 360];
let failures = 0;
const check = (label, ok, detail) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}: ${label}${ok || !detail ? '' : `  (${detail})`}`);
  if (!ok) failures++;
};

async function openPanel(browser, base, fixture, width, query = '') {
  const page = await browser.newPage({ width, height: 720 });
  await page.goto(`${base}/sidepanel.html?fixture=${fixture}${query ? `&${query}` : ''}`);
  // The game data is loaded (or has failed) once the engine says so.
  await page.waitFor(READY_FN, { timeoutMs: 600000, intervalMs: 500 });
  await sleep(300);
  return page;
}

/**
 * Editing a wish after the list changed under it (sync, another tab) must change
 * the wish the row was drawn from, never a neighbour at the same index. Runs the
 * engine's real editItemWish.
 */
const engineEdits = async () => {
  const WS = window.WishlistSync;
  const items = () => window.__awPreview.dump().dimData.lists[window.__awPreview.dump().dimData.activeId].items;
  const pick = (type) => Object.entries(items()).find(([, i]) => i.static.type === type);
  // Another browser's wish arrives at the front: every saved row's index is now off by one.
  const pushFront = (hash, wish) => AWStore.update((d) => { d.lists[d.activeId].items[hash].wishes.unshift(wish); });
  const out = {};
  const [hash, item] = pick('weapon');
  const target = item.wishes[0];
  await pushFront(hash, { tags: ['pvp'], config: { perks: [[2]] }, raw: '[[2]]', added: Date.now() });
  let r = await editItemWish(hash, 0, '[[3]]', { perks: [[3]] }, 'pve', WS.wishKey(target));
  let left = items()[hash].wishes;
  out.editStale = r.result === 'updated' && left[0].raw === '[[2]]' && left[1].raw === '[[3]]';
  r = await editItemWish(hash, 1, '[[2]]', { perks: [[2]] }, 'pvp', r.key);
  out.editDuplicate = r.result === 'duplicate' && items()[hash].wishes[1].raw === '[[3]]';
  r = await editItemWish(hash, 0, '[[4]]', { perks: [[4]] }, 'pve', 'pve|weapon:gone');
  out.editMissing = r.result === 'missing' && items()[hash].wishes.length === 2;
  return out;
};

/**
 * The redesigned shell and Wishes screen (?ui=next) with real data: the calm
 * list, the roomy detail screen, the sheets, delete + Undo, and what shared
 * lists can't do to it.
 */
async function checkNext(browser, base, width) {
  const tag = `[${width}] next`;
  const sleep2 = (ms) => new Promise((r) => setTimeout(r, ms));
  const page = await openPanel(browser, base, 'demo', width, 'ui=next');
  const ev = (fn, ...a) => page.eval(fn, ...a);
  await sleep2(1500); // the startup backfill gives saved armor its set

  const layout = await ev(() => {
    const vis = (e) => !!e && getComputedStyle(e).display !== 'none' && e.getClientRects().length > 0;
    const small = [...document.querySelectorAll('#ui-shell button, #ui-shell input')].filter(vis).map((e) => {
      const r = e.getBoundingClientRect();
      return { what: (e.getAttribute('aria-label') || e.textContent || e.className).trim().slice(0, 24), w: Math.round(r.width), h: Math.round(r.height) };
    }).filter((b) => b.h < 40 || b.w < 24);
    return {
      shell: !!document.getElementById('ui-shell'),
      noOldMarkup: !document.querySelector('.app-container, #view-menu, #loading-overlay'),
      tabs: [...document.querySelectorAll('.ui-tab')].map((t) => t.textContent.trim()),
      current: document.querySelector('.ui-tab[aria-current="page"]')?.textContent.trim(),
      wider: document.documentElement.scrollWidth > innerWidth + 1,
      barOverflow: document.querySelector('.ui-appbar').scrollWidth > document.querySelector('.ui-appbar').clientWidth + 1,
      list: document.querySelector('.ui-listname__text')?.textContent,
      rows: [...document.querySelectorAll('.ui-itemrow .ui-itemrow__name')].map((e) => e.textContent),
      perksOnList: document.querySelectorAll('.ui-itemrow .ui-perk').length,
      rowHeights: [...document.querySelectorAll('.ui-itemrow')].map((e) => Math.round(e.getBoundingClientRect().height)),
      small
    };
  });
  check(`${tag}: the shell is shown and none of the old page is left`, layout.shell && layout.noOldMarkup);
  check(`${tag}: four tabs, Wishes current`, JSON.stringify(layout.tabs) === '["Wishes","Drops","Inventory","Discover"]' && layout.current === 'Wishes', JSON.stringify(layout.tabs));
  check(`${tag}: nothing wider than the panel`, !layout.wider && !layout.barOverflow);
  check(`${tag}: app bar shows the list name`, layout.list === 'Main Wishlist', layout.list);
  check(`${tag}: one calm row per weapon, no perks crammed into the list`, JSON.stringify(layout.rows) === '["Eyasluna","Fatebringer","Service Revolver"]' && layout.perksOnList === 0, JSON.stringify(layout.rows));
  check(`${tag}: rows are roomy (at least 72px tall)`, layout.rowHeights.every((hgt) => hgt >= 72), JSON.stringify(layout.rowHeights));
  check(`${tag}: every control is at least 40px tall`, layout.small.length === 0, JSON.stringify(layout.small));

  // weapon detail: large, named perks, every roll, Edit
  await ev(() => [...document.querySelectorAll('.ui-itemrow')].find((r) => /Fatebringer/.test(r.textContent)).click());
  await sleep2(500);
  const wd = await ev(() => {
    const perk = document.querySelector('.ui-subscreen:not([hidden]) .ui-perk');
    return {
      title: document.querySelector('.ui-subscreen:not([hidden]) .ui-subscreen__title')?.textContent,
      rolls: document.querySelectorAll('.ui-subscreen:not([hidden]) .ui-rollcard').length,
      perkSize: perk ? Math.round(perk.getBoundingClientRect().width) : 0,
      names: [...document.querySelectorAll('.ui-subscreen:not([hidden]) .ui-perkl__name')].map((e) => e.textContent).filter(Boolean).length,
      edit: [...document.querySelectorAll('.ui-subscreen:not([hidden]) .ui-btn')].some((b) => /Edit roll/.test(b.textContent)),
      baseInert: document.querySelector('.ui-shell__base').inert === true,
      wider: document.documentElement.scrollWidth > innerWidth + 1
    };
  });
  check(`${tag}: weapon detail shows every roll with large named perks`, wd.title === 'Fatebringer' && wd.rolls === 2 && wd.perkSize >= 40 && wd.names >= 8, JSON.stringify(wd));
  check(`${tag}: each roll offers Edit, and nothing is wider than the panel`, wd.edit && !wd.wider);
  await page.press('Escape');
  await sleep2(300);
  check(`${tag}: Escape closes the detail and focus returns to its row`, await ev(() => !!document.querySelector('.ui-subscreen[hidden]') && document.querySelector('.ui-subscreen:not([hidden])') === null && /Fatebringer/.test(document.activeElement.textContent)));

  // armor: grouped under Bungie's set name; the set bonus is on the set's screen (D15)
  await ev(() => document.querySelector('.ui-seg__opt[data-value=armor]').click());
  await sleep2(1500);
  const sets = await ev(() => [...document.querySelectorAll('.ui-itemrow .ui-itemrow__name')].map((e) => e.textContent));
  check(`${tag}: armor groups by set (Techsec once)`, JSON.stringify(sets) === '["Iron Forerunner","Techsec"]', JSON.stringify(sets));
  await ev(() => [...document.querySelectorAll('.ui-itemrow')].find((r) => /Techsec/.test(r.textContent)).click());
  await sleep2(1500);
  const tech = await ev(() => ({
    perks: [...document.querySelectorAll('.ui-subscreen:not([hidden]) .ui-bonus__name')].map((e) => e.textContent.trim()),
    descriptions: [...document.querySelectorAll('.ui-subscreen:not([hidden]) .ui-bonus__desc')].map((e) => e.textContent.length),
    archetypes: [...document.querySelectorAll('.ui-subscreen:not([hidden]) .ui-archetype')].map((e) => e.textContent),
    pieces: [...document.querySelectorAll('.ui-subscreen:not([hidden]) .ui-piece__name')].map((e) => e.textContent),
    wider: document.documentElement.scrollWidth > innerWidth + 1
  }));
  check(`${tag}: Techsec shows its 2-piece and 4-piece bonus, named and described`, tech.perks.length === 2 && /Wrecker/.test(tech.perks[0]) && /Concussive/.test(tech.perks[1]) && tech.descriptions.every((n) => n > 40), JSON.stringify(tech));
  check(`${tag}: Techsec lists its pieces and their archetypes`, tech.pieces.length === 2 && tech.archetypes.length === 2 && !tech.wider, JSON.stringify(tech));
  await page.press('Escape');
  await sleep2(300);
  await ev(() => [...document.querySelectorAll('.ui-itemrow')].find((r) => /Iron Forerunner/.test(r.textContent)).click());
  await sleep2(500);
  check(`${tag}: armor with no set says "No set bonus"`, await ev(() => !!document.querySelector('.ui-subscreen:not([hidden]) .ui-bonus--none')));
  await page.press('Escape');
  await sleep2(300);
  await ev(() => document.querySelector('.ui-seg__opt[data-value=weapon]').click());
  await sleep2(300);

  // search, and ONE filter button instead of a row of chips
  await ev(() => { const i = document.querySelector('.ui-search__input'); i.value = 'fate'; i.dispatchEvent(new Event('input', { bubbles: true })); });
  await sleep2(200);
  check(`${tag}: search narrows the weapon list`, await ev(() => document.querySelectorAll('.ui-itemrow').length === 1));
  await ev(() => { const i = document.querySelector('.ui-search__input'); i.value = ''; i.dispatchEvent(new Event('input', { bubbles: true })); });
  await ev(() => document.querySelector('.ui-filterbtn').click());
  await sleep2(300);
  await ev(() => [...document.querySelectorAll('.ui-layer:not([hidden]) .ui-chip')].find((c) => c.textContent.trim() === 'PvP').click());
  const live = await ev(() => document.querySelector('.ui-layer:not([hidden]) .ui-btn--primary').textContent);
  check(`${tag}: the filter sheet shows the live result count`, /Show 2 wishes/.test(live), live);
  await ev(() => document.querySelector('.ui-layer:not([hidden]) .ui-btn--primary').click());
  await sleep2(300);
  check(`${tag}: PvP filter keeps only weapons with a PvP roll, and the button shows it is on`, await ev(() => document.querySelectorAll('.ui-itemrow').length === 2 && document.querySelector('.ui-filterbtn').classList.contains('is-active') && /1 on/.test(document.querySelector('.ui-filterbtn').getAttribute('aria-label'))));
  await ev(() => { const i = document.querySelector('.ui-search__input'); i.value = 'zzzz'; i.dispatchEvent(new Event('input', { bubbles: true })); });
  await sleep2(200);
  check(`${tag}: no matches says so and offers to clear`, await ev(() => /Nothing matches/.test(document.querySelector('.ui-cardlist').textContent) && !!document.querySelector('.ui-cardlist .ui-btn')));
  await ev(() => document.querySelector('.ui-cardlist .ui-btn').click());
  await sleep2(300);
  check(`${tag}: Clear filters brings everything back`, await ev(() => document.querySelectorAll('.ui-itemrow').length === 3 && !document.querySelector('.ui-filterbtn').classList.contains('is-active')));

  // Lists sheet: opens, switches list, Escape closes and returns focus
  await ev(() => document.querySelector('.ui-listname').click());
  await sleep2(300);
  check(`${tag}: Lists sheet opens with both lists, background inert`, await ev(() => {
    const layer = [...document.querySelectorAll('.ui-layer')].find((l) => !l.hidden);
    return !!layer && layer.querySelectorAll('.ui-listrow').length === 2 && document.querySelector('.ui-shell__base').inert === true;
  }));
  await page.press('Escape');
  await sleep2(300);
  check(`${tag}: Escape closes the sheet and focus returns to the list name`, await ev(() => ![...document.querySelectorAll('.ui-layer')].some((l) => !l.hidden) && document.activeElement === document.querySelector('.ui-listname')));
  await ev(() => document.querySelector('.ui-listname').click());
  await sleep2(300);
  await ev(() => [...document.querySelectorAll('.ui-layer:not([hidden]) .ui-listrow__main')].find((r) => /Raid/.test(r.textContent)).click());
  await sleep2(800);
  check(`${tag}: choosing another list switches to it`, await ev(() => document.querySelector('.ui-listname__text').textContent === 'Raid & Dungeon'));
  await ev(() => document.querySelector('.ui-listname').click());
  await sleep2(300);
  await ev(() => [...document.querySelectorAll('.ui-layer:not([hidden]) .ui-listrow__main')].find((r) => /Main/.test(r.textContent)).click());
  await sleep2(800);

  // Sync sheet says what is going on in plain words
  await ev(() => document.querySelector('.ui-syncchip').click());
  await sleep2(300);
  check(`${tag}: Sync sheet explains being signed out and offers sign-in`, await ev(() => {
    const layer = [...document.querySelectorAll('.ui-layer')].find((l) => !l.hidden);
    return !!layer && /Not signed in/.test(layer.textContent) && /Sign in with Bungie/.test(layer.textContent);
  }));
  await page.press('Escape');
  await sleep2(200);

  // delete a roll from the detail screen, then Undo it (D6)
  const before = await ev(() => window.__awPreview.dump().dimData.lists.default.items);
  const count = (items) => Object.values(items).reduce((n, it) => n + it.wishes.length, 0);
  await ev(() => [...document.querySelectorAll('.ui-itemrow')].find((r) => /Fatebringer/.test(r.textContent)).click());
  await sleep2(500);
  await ev(() => document.querySelector('.ui-subscreen:not([hidden]) .ui-rollcard .ui-icon-btn').click());
  await sleep2(300);
  await ev(() => [...document.querySelectorAll('.ui-layer:not([hidden]) .ui-row')].find((r) => /Delete roll/.test(r.textContent)).click());
  await sleep2(600);
  const afterDelete = await ev(() => window.__awPreview.dump().dimData.lists.default.items);
  check(`${tag}: Delete removes exactly one roll, shows Undo, and the detail updates`, count(afterDelete) === count(before) - 1 && await ev(() => !!document.querySelector('.ui-toast .ui-btn') && document.querySelectorAll('.ui-subscreen:not([hidden]) .ui-rollcard').length === 1));
  await ev(() => document.querySelector('.ui-toast .ui-btn').click());
  await sleep2(600);
  const afterUndo = await ev(() => window.__awPreview.dump().dimData.lists.default.items);
  check(`${tag}: Undo puts the roll back exactly`, JSON.stringify(Object.keys(afterUndo).sort()) === JSON.stringify(Object.keys(before).sort())
    && Object.keys(before).every((h) => afterUndo[h].wishes.map((w) => w.raw).join('|') === before[h].wishes.map((w) => w.raw).join('|')));
  await page.press('Escape');
  await sleep2(300);

  await ev(() => document.querySelector('.ui-tab[data-tab=wishes]').click()); // the open tab is remembered between panels
  check(`${tag}: no page errors`, page.errors.length === 0, page.errors[0]);
  if (width === WIDTHS[0]) await page.screenshot(path.join(OUT, `next-wishes-${width}.png`));
  return page;
}

/** Owned rolls, combo colours (one perk in two combos) and per-combo counts. */
async function checkNextOwned(browser, base, width) {
  const tag = `[${width}] next owned`;
  const page = await openPanel(browser, base, 'owned', width, 'ui=next');
  const r = await page.eval(async () => {
    const s = (ms) => new Promise((x) => setTimeout(x, ms));
    const q = (sel) => [...document.querySelectorAll(sel)];
    await s(1500);
    const out = { ownedRows: q('.ui-itemrow__owned').map((e) => e.textContent) };
    q('.ui-itemrow').find((r) => /Fatebringer/.test(r.textContent)).click();
    await s(500);
    const sub = '.ui-subscreen:not([hidden]) ';
    const multi = q(`${sub}.ui-perk`).find((p) => p.querySelectorAll('.ui-perk__combo').length === 2);
    Object.assign(out, {
      ownedCards: q(`${sub}.ui-rollcard.is-owned`).length,
      rollBadges: q(`${sub}.ui-rollcard .ui-badge`).map((b) => b.textContent.trim()),
      chips: q(`${sub}.ui-combochip`).map((c) => c.textContent.trim()),
      multiCombos: multi ? [...multi.querySelectorAll('.ui-perk__combo')].map((c) => c.textContent) : null,
      hitPerks: q(`${sub}.ui-perk.is-hit`).length,
      wider: document.documentElement.scrollWidth > innerWidth + 1
    });
    return out;
  });
  check(`${tag}: rows say how many rolls you own`, r.ownedRows.length === 2 && r.ownedRows.every((t) => t === '1 owned'), JSON.stringify(r.ownedRows));
  check(`${tag}: the owned roll is highlighted with its count`, r.ownedCards === 1 && r.rollBadges.includes('Owned ×2'), JSON.stringify([r.ownedCards, r.rollBadges]));
  check(`${tag}: combo chips show how many you own per combo`, r.chips.join(',') === '1×1,2×0', JSON.stringify(r.chips));
  check(`${tag}: one perk can wear two combo numbers`, JSON.stringify(r.multiCombos) === '["1","2"]', JSON.stringify(r.multiCombos));
  check(`${tag}: matched perks are ringed`, r.hitPerks === 2, String(r.hitPerks));
  check(`${tag}: nothing wider than the panel`, !r.wider);
  check(`${tag}: no page errors`, page.errors.length === 0, page.errors[0]);
}

/** The Drops screen: log, badge, Undo, Automation. */
async function checkNextDrops(browser, base, width) {
  const tag = `[${width}] next drops`;
  const page = await openPanel(browser, base, 'drops', width, 'ui=next');
  const s2 = (ms) => new Promise((r) => setTimeout(r, ms));
  const ev = (fn) => page.eval(fn);
  await sleep(1500);
  check(`${tag}: the tab shows how many drops are new`, await ev(() => document.querySelector('.ui-tab[data-tab=drops] .ui-tab__badge').textContent === '2'));
  await ev(() => document.querySelector('.ui-tab[data-tab=drops]').click());
  await sleep(500);
  const r = await ev(() => {
    const q = (sel) => [...document.querySelectorAll(sel)];
    return {
      rows: q('#ui-screen-drops .ui-droprow').length,
      newRows: q('#ui-screen-drops .ui-droprow.is-new').length,
      chips: q('#ui-screen-drops .ui-droprow .ui-badge').map((b) => b.textContent.trim()),
      badge: document.querySelector('.ui-tab[data-tab=drops] .ui-tab__badge').hidden,
      auto: q('#ui-screen-drops .ui-row')[0].textContent,
      wider: document.documentElement.scrollWidth > innerWidth + 1
    };
  });
  check(`${tag}: both drops listed, newest first, marked new`, r.rows === 2 && r.newRows === 2, JSON.stringify(r));
  check(`${tag}: each drop says what was done, failures honestly`, r.chips.join() === 'Locked,Couldn’t move,Locked', JSON.stringify(r.chips));
  check(`${tag}: the badge clears once Drops is open`, r.badge === true);
  check(`${tag}: Automation summary shows the settings`, /Lock on/.test(r.auto) && /Vault on/.test(r.auto), r.auto);
  check(`${tag}: nothing wider than the panel`, !r.wider);
  await ev(() => document.querySelector('#ui-screen-drops .ui-droprow .ui-icon-btn').click());
  await sleep(500);
  check(`${tag}: removing a drop shows Undo and removes one`, await ev(() => document.querySelectorAll('#ui-screen-drops .ui-droprow').length === 1 && !!document.querySelector('.ui-toast .ui-btn')));
  await ev(() => document.querySelector('.ui-toast .ui-btn').click());
  await sleep(500);
  check(`${tag}: Undo puts it back`, await ev(() => document.querySelectorAll('#ui-screen-drops .ui-droprow').length === 2));
  await ev(() => document.querySelector('#ui-screen-drops .ui-row').click());
  await sleep(400);
  check(`${tag}: Automation opens with three switches`, await ev(() => document.querySelectorAll('.ui-layer:not([hidden]) .ui-switch, .ui-layer:not([hidden]) [role=switch]').length === 3));
  await page.press('Escape');
  await sleep(300);
  await ev(() => document.querySelector('#ui-screen-drops .ui-droprow__main').click());
  await sleep(600);
  check(`${tag}: tapping a drop opens its wish`, await ev(() => !!document.querySelector('.ui-subscreen:not([hidden])') && /Fatebringer/.test(document.querySelector('.ui-subscreen:not([hidden])').textContent)));
  check(`${tag}: no page errors`, page.errors.length === 0, page.errors[0]);
}

/** The weapon builder: edit a saved roll, paint combos, discard prompt, and a new wish from search. */
async function checkNextBuilder(browser, base, width) {
  const tag = `[${width}] next builder`;
  const page = await openPanel(browser, base, 'owned', width, 'ui=next');
  const ev = (fn) => page.eval(fn);
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const sub = '.ui-subscreen:not([hidden]) ';
  const count = (items) => Object.values(items).reduce((n, it) => n + it.wishes.length, 0);
  await wait(1500);
  await ev(() => [...document.querySelectorAll('.ui-itemrow')].find((r) => /Fatebringer/.test(r.textContent)).click());
  await wait(500);
  await ev(() => document.querySelector('.ui-subscreen:not([hidden]) .ui-rollcard .ui-btn').click());
  await page.waitFor(() => document.querySelectorAll('.ui-builder:not([hidden]) .ui-ptile').length > 0, { timeoutMs: 20000 });
  await wait(600);
  const r = await ev(() => {
    const q = (sel) => [...document.querySelectorAll(sel)];
    const b = '.ui-builder:not([hidden]) ';
    const tile = q(`${b}.ui-ptile`)[0].getBoundingClientRect();
    return {
      title: document.querySelector(`${b}.ui-subscreen__title`).textContent,
      cols: q(`${b}.ui-col`).length,
      tileW: Math.round(tile.width), tileH: Math.round(tile.height),
      picked: q(`${b}.ui-ptile.is-picked`).length,
      multi: q(`${b}.ui-ptile`).some((t) => t.querySelectorAll('.ui-ptile__combo').length === 2),
      brush: q(`${b}.ui-brush .ui-seg__opt`).map((o) => o.textContent.trim()),
      actions: q(`${b}.ui-builder__actions .ui-btn`).map((o) => o.textContent.trim()),
      statRows: q(`${b}.ui-statrow`).length,
      onTop: (() => { const t = q(`${b}.ui-ptile`)[0].getBoundingClientRect(); const at = document.elementFromPoint(t.left + t.width / 2, t.top + t.height / 2); return !!(at && at.closest('.ui-builder')); })(),
      wider: document.documentElement.scrollWidth > innerWidth + 1
    };
  });
  check(`${tag}: editing a roll opens it with all its columns`, r.title === 'Edit roll' && r.cols >= 4, JSON.stringify(r));
  check(`${tag}: the builder is what you see, not hidden under the detail screen`, r.onTop);
  check(`${tag}: perk tiles are 48px and fit`, r.tileW === 48 && r.tileH === 48 && !r.wider, JSON.stringify([r.tileW, r.tileH, r.wider]));
  check(`${tag}: the saved roll's picks are painted, one perk in two combos`, r.picked > 0 && r.multi, JSON.stringify([r.picked, r.multi]));
  check(`${tag}: the toolbar offers Any and combos 1-4`, r.brush.join() === 'Any,1,2,3,4' || r.brush.join(',').startsWith('Any,1'), r.brush.join());
  check(`${tag}: Update roll and Save as new are pinned`, r.actions.join() === 'Update roll,Save as new', r.actions.join());
  check(`${tag}: stats are shown`, r.statRows >= 4, String(r.statRows));
  check(`${tag}: no stray "null" or "[object" text`, await ev(() => !/\[object|\bnull\b/.test(document.querySelector('.ui-builder:not([hidden])').textContent)));
  await page.screenshot(path.join(OUT, `next-builder-${width}.png`));

  // painting: pick an unpicked perk with combo 2, then tap it again to take it off
  const painted = await ev(async () => {
    const w = (ms) => new Promise((x) => setTimeout(x, ms));
    const b = '.ui-builder:not([hidden]) ';
    const opt = [...document.querySelectorAll(`${b}.ui-brush .ui-seg__opt`)].find((o) => o.dataset.value === 'blue');
    opt.click(); await w(150);
    const tile = [...document.querySelectorAll(`${b}.ui-ptile`)].find((t) => !t.classList.contains('is-picked'));
    const name = tile.getAttribute('aria-label');
    tile.click(); await w(250);
    const after = [...document.querySelectorAll(`${b}.ui-ptile`)].find((t) => t.getAttribute('aria-label').startsWith(name));
    const on = after.classList.contains('is-picked') && /2/.test(after.querySelector('.ui-ptile__combos').textContent) && after.getAttribute('aria-label').includes('combo 2');
    const detail = document.querySelector(`${b}.ui-perkdetail`).textContent.length > 20;
    after.click(); await w(250);
    const off = ![...document.querySelectorAll(`${b}.ui-ptile`)].find((t) => t.getAttribute('aria-label').startsWith(name)).classList.contains('is-picked');
    return { on, off, detail };
  });
  check(`${tag}: tapping paints the chosen combo, shows the perk's detail, and taps off again`, painted.on && painted.off && painted.detail, JSON.stringify(painted));

  // Update roll saves in place
  const before = await ev(() => window.__awPreview.dump().dimData.lists.default.items);
  await ev(() => [...document.querySelectorAll('.ui-builder:not([hidden]) .ui-builder__actions .ui-btn')].find((b) => /Update roll/.test(b.textContent)).click());
  await wait(800);
  const after = await ev(() => window.__awPreview.dump().dimData.lists.default.items);
  check(`${tag}: Update roll closes the builder and keeps the same number of rolls`, await ev(() => !document.querySelector('.ui-builder:not([hidden])')) && count(after) === count(before) && await ev(() => /Roll updated/.test(document.querySelector('.ui-toast') ? document.querySelector('.ui-toast').textContent : '')));

  // leaving with unsaved changes asks first
  await ev(() => document.querySelector('.ui-subscreen:not([hidden]) .ui-rollcard .ui-btn').click());
  await page.waitFor(() => document.querySelectorAll('.ui-builder:not([hidden]) .ui-ptile').length > 0, { timeoutMs: 20000 });
  await wait(500);
  await ev(() => [...document.querySelectorAll('.ui-builder:not([hidden]) .ui-ptile')].find((t) => !t.classList.contains('is-picked')).click());
  await wait(200);
  await ev(() => document.querySelector('.ui-builder:not([hidden]) .ui-subscreen__back').click());
  await wait(400);
  check(`${tag}: leaving with unsaved picks asks first`, await ev(() => !!document.querySelector('dialog[open]') && !!document.querySelector('.ui-builder:not([hidden])')));
  await ev(() => [...document.querySelectorAll('dialog[open] .ui-btn')].find((b) => /Keep editing/.test(b.textContent)).click());
  await wait(300);
  check(`${tag}: Keep editing stays in the builder`, await ev(() => !!document.querySelector('.ui-builder:not([hidden])') && !document.querySelector('dialog[open]')));
  await ev(() => document.querySelector('.ui-builder:not([hidden]) .ui-subscreen__back').click());
  await wait(300);
  await ev(() => [...document.querySelectorAll('dialog[open] .ui-btn')].find((b) => /Discard/.test(b.textContent)).click());
  await wait(500);
  check(`${tag}: Discard leaves, and nothing was saved`, await ev(() => !document.querySelector('.ui-builder:not([hidden])')) && JSON.stringify(await ev(() => window.__awPreview.dump().dimData.lists.default.items)) === JSON.stringify(after));
  await page.press('Escape'); await wait(300);

  // a new wish: + Wish -> weapon -> search -> pick -> any-perk -> save
  await ev(() => document.querySelector('.ui-addwish').click());
  await wait(400);
  await ev(() => [...document.querySelectorAll('.ui-layer:not([hidden]) .ui-row')].find((x) => /Weapon wish/.test(x.textContent)).click());
  await wait(500);
  await ev(() => { const i = document.querySelector('.ui-subscreen:not([hidden]) input[type=search]'); i.value = 'eyasluna'; i.dispatchEvent(new Event('input', { bubbles: true })); });
  await page.waitFor(() => document.querySelectorAll('.ui-subscreen:not([hidden]) .ui-itemrow').length > 0, { timeoutMs: 20000 });
  check(`${tag}: search finds the weapon`, await ev(() => /Eyasluna/i.test(document.querySelector('.ui-subscreen:not([hidden]) .ui-itemrow').textContent)));
  await ev(() => document.querySelector('.ui-subscreen:not([hidden]) .ui-itemrow').click());
  await page.waitFor(() => document.querySelectorAll('.ui-builder:not([hidden]) .ui-ptile').length > 0, { timeoutMs: 20000 });
  await wait(500);
  check(`${tag}: a new wish starts empty with Save off`, await ev(() => document.querySelector('.ui-builder:not([hidden]) .ui-subscreen__title').textContent === 'New wish' && document.querySelectorAll('.ui-builder:not([hidden]) .ui-ptile.is-picked').length === 0 && document.querySelector('.ui-builder:not([hidden]) .ui-builder__actions .ui-btn').disabled));
  await ev(() => {
    document.querySelector('.ui-builder:not([hidden]) .ui-brush .ui-seg__opt[data-value=any]').click();
    document.querySelectorAll('.ui-builder:not([hidden]) .ui-col')[2].querySelector('.ui-ptile').click();
  });
  await wait(300);
  const countBefore = count(await ev(() => window.__awPreview.dump().dimData.lists.default.items));
  await ev(() => document.querySelector('.ui-builder:not([hidden]) .ui-builder__actions .ui-btn').click());
  await wait(900);
  const countAfter = count(await ev(() => window.__awPreview.dump().dimData.lists.default.items));
  check(`${tag}: Save adds exactly one wish and closes both screens`, countAfter === countBefore + 1 && await ev(() => !document.querySelector('.ui-builder:not([hidden])') && !document.querySelector('.ui-subscreen:not([hidden])')), `${countBefore} -> ${countAfter}`);
  check(`${tag}: no page errors`, page.errors.length === 0, page.errors[0]);
}

/** The armor builder: edit a saved roll, optional Tertiary/Spark, discard prompt, and a new set wish. */
async function checkNextArmorBuilder(browser, base, width) {
  const tag = `[${width}] next armor builder`;
  const page = await openPanel(browser, base, 'owned', width, 'ui=next');
  const ev = (fn) => page.eval(fn);
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const B = '.ui-builder:not([hidden]) ';
  const items = () => ev(() => window.__awPreview.dump().dimData.lists.default.items);
  const count = (it) => Object.values(it).reduce((n, x) => n + x.wishes.length, 0);
  await wait(1500);
  await ev(() => document.querySelector('.ui-seg__opt[data-value=armor]').click());
  await wait(800);
  await ev(() => [...document.querySelectorAll('.ui-itemrow')].find((r) => /Techsec/.test(r.textContent)).click());
  await wait(600);
  await ev(() => document.querySelector('.ui-subscreen:not([hidden]) .ui-rollcard .ui-btn').click());
  await page.waitFor(() => document.querySelectorAll('.ui-builder:not([hidden]) .ui-arch').length > 0, { timeoutMs: 20000 });
  await wait(500);
  const r = await ev(() => {
    const q = (sel) => [...document.querySelectorAll(sel)];
    const b = '.ui-builder:not([hidden]) ';
    const a = document.querySelector(`${b}.ui-detailhead`).getBoundingClientRect();
    const at = document.elementFromPoint(a.left + 20, a.top + a.height / 2);
    return {
      title: document.querySelector(`${b}.ui-subscreen__title`).textContent,
      onTop: !!(at && at.closest('.ui-builder')),
      archetypes: q(`${b}.ui-arch`).length,
      arch: q(`${b}.ui-arch[aria-pressed=true]`).map((x) => x.dataset.arch),
      tert: q(`${b}[aria-label="Tertiary stat"] [aria-pressed=true]`).map((x) => x.dataset.stat),
      blocked: q(`${b}[aria-label="Tertiary stat"] [aria-disabled=true]`).map((x) => x.dataset.stat),
      slots: q(`${b}.ui-slot`).length, slotsDisabled: q(`${b}.ui-slot:disabled`).length,
      bonus: !!document.querySelector(`${b}.ui-bonus`),
      actions: q(`${b}.ui-builder__actions .ui-btn`).map((x) => x.textContent.trim()),
      wider: document.documentElement.scrollWidth > innerWidth + 1
    };
  });
  check(`${tag}: Edit roll opens it, on top, with the saved archetype`, r.title === 'Edit roll' && r.onTop && r.archetypes === 12 && r.arch.join() === 'BULWARK', JSON.stringify(r));
  check(`${tag}: an older roll's stat shows as the Tertiary, and the archetype's stats can't be`, r.tert.join() === 'weapons' && r.blocked.join() === 'health,class', JSON.stringify([r.tert, r.blocked]));
  check(`${tag}: editing fixes the piece and shows the set bonus block`, r.slots === 1 && r.slotsDisabled === 1 && r.bonus && r.actions.join() === 'Update roll,Save as new', JSON.stringify([r.slots, r.bonus, r.actions]));
  check(`${tag}: nothing wider than the panel`, !r.wider);
  check(`${tag}: no stray "null" or "[object" text`, await ev(() => !/\[object|\bnull\b/.test(document.querySelector('.ui-builder:not([hidden])').textContent)));
  await page.screenshot(path.join(OUT, `next-armor-builder-${width}.png`));

  // Tertiary and Spark are optional, and tapping the chosen one clears it
  const opt = await ev(async () => {
    const w = (ms) => new Promise((x) => setTimeout(x, ms));
    const b = '.ui-builder:not([hidden]) ';
    const chip = (group, stat) => document.querySelector(`${b}[aria-label="${group}"] .ui-statchip[data-stat=${stat}]`);
    chip('Tertiary stat', 'weapons').click(); await w(150);
    const cleared = chip('Tertiary stat', 'weapons').getAttribute('aria-pressed') === 'false';
    chip('Spark stat', 'super').click(); await w(150);
    const set = chip('Spark stat', 'super').getAttribute('aria-pressed') === 'true';
    chip('Spark stat', 'super').click(); await w(150);
    const off = chip('Spark stat', 'super').getAttribute('aria-pressed') === 'false';
    chip('Tertiary stat', 'melee').click(); await w(150);
    return { cleared, set, off, melee: chip('Tertiary stat', 'melee').getAttribute('aria-pressed') === 'true' };
  });
  check(`${tag}: Tertiary and Spark can be cleared and set`, opt.cleared && opt.set && opt.off && opt.melee, JSON.stringify(opt));
  await ev(() => [...document.querySelectorAll('.ui-builder:not([hidden]) .ui-builder__actions .ui-btn')].find((b) => /Update roll/.test(b.textContent)).click());
  await wait(900);
  const cfg = (await items())[517096395].wishes[0].config;
  check(`${tag}: Update roll saves the new roll in the current shape`, cfg.archetype === 'BULWARK' && cfg.tertiary === 'Melee' && cfg.spark === null && 'tertiary' in cfg, JSON.stringify(cfg));
  check(`${tag}: it closes with a confirmation`, await ev(() => !document.querySelector('.ui-builder:not([hidden])') && /Roll updated/.test((document.querySelector('.ui-toast') || {}).textContent || '')));

  // leaving with unsaved changes asks first
  await ev(() => document.querySelector('.ui-subscreen:not([hidden]) .ui-rollcard .ui-btn').click());
  await page.waitFor(() => document.querySelectorAll('.ui-builder:not([hidden]) .ui-arch').length > 0, { timeoutMs: 20000 });
  await wait(400);
  await ev(() => document.querySelector('.ui-builder:not([hidden]) .ui-arch[data-arch=GUNNER]').click());
  await wait(200);
  await ev(() => document.querySelector('.ui-builder:not([hidden]) .ui-subscreen__back').click());
  await wait(400);
  check(`${tag}: leaving with unsaved changes asks first`, await ev(() => !!document.querySelector('dialog[open]') && !!document.querySelector('.ui-builder:not([hidden])')));
  await ev(() => [...document.querySelectorAll('dialog[open] .ui-btn')].find((b) => /Discard/.test(b.textContent)).click());
  await wait(500);
  check(`${tag}: Discard leaves, and nothing was saved`, (await items())[517096395].wishes[0].config.archetype === 'BULWARK' && await ev(() => !document.querySelector('.ui-builder:not([hidden])')));
  await page.press('Escape'); await wait(300);

  // a new wish for a whole set: + Wish -> Armor -> search -> set -> archetype -> save
  await ev(() => document.querySelector('.ui-addwish').click());
  await wait(400);
  await ev(() => [...document.querySelectorAll('.ui-layer:not([hidden]) .ui-row')].find((x) => /Armor wish/.test(x.textContent)).click());
  await wait(500);
  await ev(() => { const i = document.querySelector('.ui-subscreen:not([hidden]) input[type=search]'); i.value = 'techsec'; i.dispatchEvent(new Event('input', { bubbles: true })); });
  await page.waitFor(() => document.querySelectorAll('.ui-subscreen:not([hidden]) .ui-itemrow').length > 0, { timeoutMs: 30000 });
  check(`${tag}: search finds the set`, await ev(() => /Techsec/i.test(document.querySelector('.ui-subscreen:not([hidden]) .ui-itemrow').textContent)));
  await ev(() => document.querySelector('.ui-subscreen:not([hidden]) .ui-itemrow').click());
  await page.waitFor(() => document.querySelectorAll('.ui-builder:not([hidden]) .ui-arch').length > 0, { timeoutMs: 20000 });
  await wait(600);
  const n = await ev(() => document.querySelectorAll('.ui-builder:not([hidden]) .ui-slot.is-picked').length);
  const fresh = await ev(() => ({
    title: document.querySelector('.ui-builder:not([hidden]) .ui-subscreen__title').textContent,
    save: document.querySelector('.ui-builder:not([hidden]) .ui-builder__actions .ui-btn').disabled,
    why: document.querySelector('.ui-builder:not([hidden]) .ui-builder__summary').textContent
  }));
  check(`${tag}: a new wish starts with every piece chosen and asks for an archetype`, n >= 2 && fresh.title === 'New wish' && fresh.save && /archetype/i.test(fresh.why), JSON.stringify([n, fresh]));
  await ev(() => document.querySelector('.ui-builder:not([hidden]) .ui-arch[data-arch=DEMOLITIONIST]').click());
  await wait(200);
  const dem = await ev(() => ({
    blocked: [...document.querySelectorAll('.ui-builder:not([hidden]) [aria-label="Tertiary stat"] [aria-disabled=true]')].map((x) => x.dataset.stat).join(),
    label: document.querySelector('.ui-builder:not([hidden]) .ui-builder__actions .ui-btn').textContent.trim(),
    on: !document.querySelector('.ui-builder:not([hidden]) .ui-builder__actions .ui-btn').disabled
  }));
  check(`${tag}: Save names how many wishes it makes, and the archetype's stats can't be the Tertiary`, dem.on && dem.label === `Save ${n} wishes` && dem.blocked === 'class,grenade', JSON.stringify(dem));
  const before = count(await items());
  await ev(() => document.querySelector('.ui-builder:not([hidden]) .ui-builder__actions .ui-btn').click());
  await wait(1500);
  const afterItems = await items();
  check(`${tag}: Save adds one wish per piece and closes both screens`, count(afterItems) === before + n && await ev(() => !document.querySelector('.ui-builder:not([hidden])') && !document.querySelector('.ui-subscreen:not([hidden])')), `${before} -> ${count(afterItems)}, expected +${n}`);
  const added = Object.values(afterItems).flatMap((it) => it.wishes).filter((w) => w.config && w.config.archetype === 'DEMOLITIONIST');
  check(`${tag}: the new wishes have the chosen roll and no Tertiary or Spark`, added.length === n && added.every((w) => w.config.tertiary === null && w.config.spark === null), JSON.stringify(added.map((w) => w.config)));
  check(`${tag}: no page errors`, page.errors.length === 0, page.errors[0]);
}

/** Inventory: search what you own, which copies match a wish, and starting a wish from one. */
async function checkNextInventory(browser, base, width) {
  const tag = `[${width}] next inventory`;
  const page = await openPanel(browser, base, 'owned', width, 'ui=next');
  const ev = (fn, ...args) => page.eval(fn, ...args);
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  await wait(1500);
  await ev(() => document.querySelector('.ui-tab[data-tab=inventory]').click());
  await wait(500);
  check(`${tag}: without a sign-in it asks for one`, await ev(() => /Sign in to see your inventory/.test(document.querySelector('#ui-screen-inventory').textContent) && !!document.querySelector('#ui-screen-inventory .ui-btn--primary')));

  // an inventory as a sync would build it: two Fatebringers (one crafted) and a Techsec Helm
  await ev(async () => {
    const FB = 4184168210, IDS = ['6917529000000000001', '6917529000000000002'];
    const sockets = (active) => ({ sockets: [{ plugHash: 1 }].concat(active.map((h) => ({ plugHash: h }))) });
    const profile = {
      responseMintedTimestamp: `t${Date.now()}`,
      profileInventory: { data: { items: [
        { itemInstanceId: IDS[0], itemHash: FB, state: 8 }, { itemInstanceId: IDS[1], itemHash: FB, state: 0 },
        { itemInstanceId: '6917529000000000030', itemHash: 517096395, state: 0 }] } },
      itemComponents: {
        sockets: { data: {
          [IDS[0]]: sockets([3661387068, 106909392, 3038247973, 3824105627]),
          [IDS[1]]: sockets([3250034553, 3142289711, 47981717, 699525795]),
          '6917529000000000030': { sockets: [{ plugHash: 2 }] } } },
        reusablePlugs: { data: { [IDS[0]]: { plugs: { 3: [{ plugItemHash: 3038247973 }, { plugItemHash: 47981717 }], 4: [{ plugItemHash: 3824105627 }, { plugItemHash: 699525795 }] } } } }
      }
    };
    await OwnedInventoryIndex.buildOwnedIndex(profile);
    document.dispatchEvent(new CustomEvent('awSyncChanged'));
  });
  await wait(600);
  check(`${tag}: with an inventory and nothing typed it says how to search`, await ev(() => /Search your inventory/.test(document.querySelector('#ui-screen-inventory .ui-empty__title').textContent)));

  await ev(() => { const i = document.querySelector('#ui-screen-inventory input[type=search]'); i.value = 'fatebringer'; i.dispatchEvent(new Event('input', { bubbles: true })); });
  await page.waitFor(() => document.querySelectorAll('#ui-screen-inventory .ui-itemrow').length > 0, { timeoutMs: 20000 });
  const row = await ev(() => ({
    n: document.querySelectorAll('#ui-screen-inventory .ui-itemrow').length,
    text: document.querySelector('#ui-screen-inventory .ui-itemrow').textContent,
    wider: document.documentElement.scrollWidth > innerWidth + 1
  }));
  check(`${tag}: search finds the item with how many you own and how many match a wish`, row.n === 1 && /Fatebringer/.test(row.text) && /2 owned/.test(row.text) && /2 rolls match a wish/.test(row.text) && !row.wider, JSON.stringify(row));

  // slot chips and "Matches a wish" filter on their own
  await ev(() => { const i = document.querySelector('#ui-screen-inventory input[type=search]'); i.value = ''; i.dispatchEvent(new Event('input', { bubbles: true })); });
  await wait(300);
  await ev(() => [...document.querySelectorAll('#ui-screen-inventory .ui-chip')].find((c) => /Matches a wish/.test(c.textContent)).click());
  await wait(800);
  const only = await ev(() => ({ names: [...document.querySelectorAll('#ui-screen-inventory .ui-itemrow__name')].map((n) => n.textContent), pressed: document.querySelector('#ui-screen-inventory .ui-chip.is-selected') && document.querySelector('#ui-screen-inventory .ui-chip.is-selected').getAttribute('aria-pressed') }));
  check(`${tag}: "Matches a wish" alone lists what you own that matches`, only.names.join() === 'Fatebringer' && only.pressed === 'true', JSON.stringify(only));
  await ev(() => [...document.querySelectorAll('#ui-screen-inventory .ui-chip')].find((c) => /Matches a wish/.test(c.textContent)).click());
  const slot = await ev(async () => {
    const defs = await loadInventoryItemDefsToMemory();
    const bucket = defs.get('4184168210').inventory.bucketTypeHash;
    return AWInventory.SLOTS.find((x) => x.bucket === bucket).label;
  });
  await ev((label) => [...document.querySelectorAll('#ui-screen-inventory .ui-chip')].find((c) => c.textContent.trim() === label).click(), slot);
  await wait(800);
  check(`${tag}: a slot chip alone browses that slot`, await ev(() => /Fatebringer/.test(document.querySelector('#ui-screen-inventory .ui-cardlist').textContent)));

  // detail
  await ev(() => [...document.querySelectorAll('#ui-screen-inventory .ui-itemrow')].find((r) => /Fatebringer/.test(r.textContent)).click());
  await page.waitFor(() => document.querySelectorAll('.ui-subscreen:not([hidden]) .ui-rollcard').length === 2, { timeoutMs: 20000 });
  await wait(400);
  const d = await ev(() => {
    const q = (sel) => [...document.querySelectorAll(sel)];
    const sub = '.ui-subscreen:not([hidden]) ';
    const head = document.querySelector(`${sub}.ui-detailhead`).getBoundingClientRect();
    const at = document.elementFromPoint(head.left + 20, head.top + head.height / 2);
    const cards = q(`${sub}.ui-rollcard`);
    return {
      onTop: !!(at && at.closest('.ui-subscreen')),
      first: cards[0].textContent, second: cards[1].textContent,
      cols: cards[0].querySelectorAll('.ui-invcol').length, active: cards[0].querySelectorAll('.ui-invperk.is-active').length,
      options: cards[0].querySelectorAll('.ui-invperk').length,
      buttons: cards.map((c) => (c.querySelector('.ui-rollcard__foot .ui-btn') || {}).textContent),
      stray: /\[object|\bnull\b/.test(document.querySelector(`${sub}.ui-subscreen__body`).textContent),
      wider: document.documentElement.scrollWidth > innerWidth + 1
    };
  });
  check(`${tag}: the detail shows each copy on top, and what it satisfies`, d.onTop && /#1/.test(d.first) && /Crafted/.test(d.first) && /Main Wishlist/.test(d.first) && /#2/.test(d.second) && !/Crafted/.test(d.second), JSON.stringify(d));
  check(`${tag}: perks show by column with the equipped one marked`, d.cols === 4 && d.active === 4 && d.options > 4 && /Equipped: /.test(d.first), JSON.stringify([d.cols, d.active, d.options]));
  check(`${tag}: each copy offers to start a wish, nothing stray or too wide`, d.buttons.every((t) => t === 'Start a wish from this roll') && !d.stray && !d.wider);
  await page.screenshot(path.join(OUT, `next-inventory-${width}.png`));

  // start a wish from copy #1: the builder opens on top with that copy's perks as combo 1
  await ev(() => document.querySelector('.ui-subscreen:not([hidden]) .ui-rollcard .ui-rollcard__foot .ui-btn').click());
  await page.waitFor(() => document.querySelectorAll('.ui-builder:not([hidden]) .ui-ptile').length > 0, { timeoutMs: 20000 });
  await wait(600);
  const b = await ev(() => {
    const q = (sel) => [...document.querySelectorAll(sel)];
    const t = document.querySelector('.ui-builder:not([hidden]) .ui-detailhead').getBoundingClientRect();
    const at = document.elementFromPoint(t.left + 20, t.top + t.height / 2);
    const picked = q('.ui-builder:not([hidden]) .ui-ptile.is-picked');
    return { title: document.querySelector('.ui-builder:not([hidden]) .ui-subscreen__title').textContent, onTop: !!(at && at.closest('.ui-builder')), picked: picked.length, allCombo1: picked.every((p) => p.querySelector('.ui-ptile__combos').textContent.trim() === '1') };
  });
  check(`${tag}: Start a wish opens the builder on top, with that copy's perks as combo 1`, b.title === 'New wish' && b.onTop && b.picked === 4 && b.allCombo1, JSON.stringify(b));
  await ev(() => document.querySelector('.ui-builder:not([hidden]) .ui-subscreen__back').click());
  await wait(400);
  check(`${tag}: leaving that unsaved wish asks first`, await ev(() => !!document.querySelector('dialog[open]')));
  await ev(() => [...document.querySelectorAll('dialog[open] .ui-btn')].find((x) => /Discard/.test(x.textContent)).click());
  await wait(500);
  check(`${tag}: Discard returns to the item, and nothing was saved`, await ev(() => !document.querySelector('.ui-builder:not([hidden])') && document.querySelectorAll('.ui-subscreen:not([hidden]) .ui-rollcard').length === 2));
  await ev(() => document.querySelector('.ui-tab[data-tab=wishes]').click()); // the open tab is remembered between panels
  check(`${tag}: no page errors`, page.errors.length === 0, page.errors[0]);
}

/** Wishlists: create, rename, duplicate, delete and merge (each undoable where it should be), import, and the Me sheet. */
async function checkNextLists(browser, base, width) {
  const tag = `[${width}] next lists`;
  const page = await openPanel(browser, base, 'demo', width, 'ui=next');
  const ev = (fn, ...args) => page.eval(fn, ...args);
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const lists = async () => Object.values((await ev(() => window.__awPreview.dump().dimData)).lists).map((l) => l.name);
  const dim = () => ev(() => window.__awPreview.dump().dimData);
  const wishCount = (l) => Object.values(l.items).reduce((n, it) => n + it.wishes.length, 0);
  await wait(1500);
  await ev(() => {
    window.__t = {
      layer: (title) => [...document.querySelectorAll('.ui-layer:not([hidden])')].find((l) => new RegExp(title).test(l.querySelector('.ui-sheet__title').textContent)),
      press: (title, text) => [...window.__t.layer(title).querySelectorAll('button')].find((b) => new RegExp(text).test(b.textContent || b.getAttribute('aria-label'))).click(),
      row: (title, text) => [...window.__t.layer(title).querySelectorAll('.ui-row, .ui-listrow__main')].find((b) => new RegExp(text).test(b.textContent)).click(),
      actions: (name) => [...window.__t.layer('Wishlists').querySelectorAll('.ui-listrow')].find((r) => r.querySelector('.ui-row__title').textContent === name).querySelector('.ui-icon-btn').click(),
      toast: () => (document.querySelector('.ui-toast') || {}).textContent || ''
    };
  });
  const open = async () => { await ev(() => document.querySelector('.ui-listname').click()); await wait(300); };

  await open();
  const sheet = await ev(() => ({ rows: window.__t.layer('Wishlists').querySelectorAll('.ui-listrow').length, foot: [...window.__t.layer('Wishlists').querySelectorAll('.ui-sheet__foot .ui-btn')].map((b) => b.textContent.trim()), menus: window.__t.layer('Wishlists').querySelectorAll('.ui-listrow .ui-icon-btn').length, wider: document.documentElement.scrollWidth > innerWidth + 1 }));
  check(`${tag}: each list has an actions button, and New list and Import are in the footer`, sheet.rows === 2 && sheet.menus === 2 && sheet.foot.join() === 'New list,Import' && !sheet.wider, JSON.stringify(sheet));

  // create
  await ev(() => window.__t.press('Wishlists', '^New list$'));
  await wait(400);
  await ev(() => window.__t.press('New list', '^Create list$'));
  await wait(300);
  check(`${tag}: an empty name is refused in words`, await ev(() => /Give the list a name/.test(window.__t.layer('New list').textContent) && window.__t.layer('New list').querySelector('input').getAttribute('aria-invalid') === 'true'));
  await ev(() => { const i = window.__t.layer('New list').querySelector('input'); i.value = 'Main wishlist'; i.dispatchEvent(new Event('input', { bubbles: true })); });
  await ev(() => window.__t.press('New list', '^Create list$'));
  await wait(300);
  check(`${tag}: a name another list has is refused`, await ev(() => /already have a list/.test(window.__t.layer('New list').textContent)));
  await ev(() => { const i = window.__t.layer('New list').querySelector('input'); i.value = '  Crucible  '; i.dispatchEvent(new Event('input', { bubbles: true })); i.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); });
  await wait(900);
  const made = await dim();
  check(`${tag}: Enter creates the list, makes it current, and closes the sheets`, (await lists()).join() === 'Main Wishlist,Raid & Dungeon,Crucible' && made.lists[made.activeId].name === 'Crucible'
    && await ev(() => document.querySelector('.ui-listname__text').textContent === 'Crucible' && ![...document.querySelectorAll('.ui-layer')].some((l) => !l.hidden) && /Created/.test(window.__t.toast())));

  // rename
  await open();
  await ev(() => window.__t.actions('Crucible'));
  await wait(300);
  await ev(() => window.__t.row('Crucible', '^Rename'));
  await wait(400);
  await ev(() => { const i = window.__t.layer('Rename list').querySelector('input'); i.value = 'PvP'; i.dispatchEvent(new Event('input', { bubbles: true })); window.__t.press('Rename list', '^Save name$'); });
  await wait(800);
  check(`${tag}: Rename changes the name in place`, (await lists()).join() === 'Main Wishlist,Raid & Dungeon,PvP' && await ev(() => document.querySelector('.ui-listname__text').textContent === 'PvP'));

  // duplicate
  await open();
  await ev(() => window.__t.actions('Raid & Dungeon'));
  await wait(300);
  await ev(() => window.__t.row('Raid & Dungeon', '^Duplicate'));
  await wait(800);
  const dup = await dim();
  const raid = Object.values(dup.lists).find((l) => l.name === 'Raid & Dungeon'), copy = Object.values(dup.lists).find((l) => l.name === 'Raid & Dungeon (copy)');
  check(`${tag}: Duplicate makes an independent copy with every wish`, !!copy && wishCount(copy) === wishCount(raid) && copy.items !== raid.items && await ev(() => /Copied as/.test(window.__t.toast())));

  // delete + undo
  await open();
  await ev(() => window.__t.actions('PvP'));
  await wait(300);
  await ev(() => window.__t.row('PvP', '^Delete'));
  await wait(800);
  check(`${tag}: Delete removes the list and offers Undo, no confirm`, !(await lists()).includes('PvP') && await ev(() => !!document.querySelector('.ui-toast .ui-btn') && !document.querySelector('dialog[open]')));
  await ev(() => document.querySelector('.ui-toast .ui-btn').click());
  await wait(800);
  check(`${tag}: Undo brings the list back where it was`, (await lists()).join() === 'Main Wishlist,Raid & Dungeon,PvP,Raid & Dungeon (copy)', (await lists()).join());
  await open();
  await ev(() => window.__t.actions('Main Wishlist'));
  await wait(300);
  check(`${tag}: the default list can't be deleted`, await ev(() => !/Delete/.test(window.__t.layer('Main Wishlist').textContent) && /Merge other lists/.test(window.__t.layer('Main Wishlist').textContent)));

  // merge + undo
  const beforeMerge = await dim();
  const mainBefore = wishCount(Object.values(beforeMerge.lists).find((l) => l.name === 'Main Wishlist'));
  await ev(() => window.__t.row('Main Wishlist', '^Merge other lists'));
  await wait(400);
  check(`${tag}: Merge starts with nothing chosen`, await ev(() => window.__t.layer('Merge into').querySelector('.ui-btn--primary').disabled && window.__t.layer('Merge into').querySelectorAll('[role=switch]').length === 3));
  await ev(() => { const sw = [...window.__t.layer('Merge into').querySelectorAll('[role=switch]')]; sw[1].click(); sw[2].click(); });
  await wait(200);
  check(`${tag}: it says what will happen`, await ev(() => /Merge 2 lists/.test(window.__t.layer('Merge into').querySelector('.ui-btn--primary').textContent) && /folded into/.test(window.__t.layer('Merge into').textContent)));
  await ev(() => window.__t.layer('Merge into').querySelector('.ui-btn--primary').click());
  await wait(900);
  const merged = await dim();
  check(`${tag}: Merge folds the chosen lists in and removes them`, (await lists()).join() === 'Main Wishlist,Raid & Dungeon' && wishCount(Object.values(merged.lists).find((l) => l.name === 'Main Wishlist')) > mainBefore && await ev(() => /Merged 2 lists/.test(window.__t.toast())), (await lists()).join());
  await ev(() => document.querySelector('.ui-toast .ui-btn').click());
  await wait(900);
  const undone = await dim();
  check(`${tag}: Undo restores every list and the target exactly`, (await lists()).join() === 'Main Wishlist,Raid & Dungeon,PvP,Raid & Dungeon (copy)' && wishCount(Object.values(undone.lists).find((l) => l.name === 'Main Wishlist')) === mainBefore);

  // import opens the file picker
  await open();
  await ev(() => window.__t.press('Wishlists', '^Import$'));
  await wait(200);
  check(`${tag}: Import opens the file picker for .awwish files`, await ev(() => !!document.querySelector('input[type=file][accept=".awwish"]')));
  await page.press('Escape'); await wait(300);

  // Me
  await ev(() => document.querySelector('.ui-avatar').click());
  await wait(300);
  const me = await ev(() => ({ text: window.__t.layer('Account').textContent, wider: document.documentElement.scrollWidth > innerWidth + 1 }));
  check(`${tag}: Me offers sign-in, Automation, Reset game data and the version`, /Sign in with Bungie/.test(me.text) && /Automation/.test(me.text) && /Reset game data/.test(me.text) && /Ahamkara Wishes \S+/.test(me.text) && !me.wider, me.text.slice(0, 200));
  await ev(() => window.__t.row('Account', 'Reset game data'));
  await wait(400);
  check(`${tag}: Reset game data asks first, and Cancel changes nothing`, await ev(() => !!document.querySelector('dialog[open]')));
  await ev(() => [...document.querySelectorAll('dialog[open] .ui-btn')].find((b) => /Cancel/.test(b.textContent)).click());
  await wait(300);
  await ev(() => window.__t.row('Account', 'Automation'));
  await wait(400);
  check(`${tag}: Automation opens from Me`, await ev(() => !!window.__t.layer('Automation')));
  check(`${tag}: no page errors`, page.errors.length === 0, page.errors[0]);
}

/** Discover: browse, search, filters, save, submit (with the cap error), delete your own, and failing gracefully. */
async function checkNextDiscover(browser, base, width) {
  const tag = `[${width}] next discover`;
  const page = await openPanel(browser, base, 'demo', width, 'ui=next');
  const ev = (fn, ...args) => page.eval(fn, ...args);
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const dim = () => ev(() => window.__awPreview.dump().dimData);
  await wait(1500);

  // a pretend server, so the check needs no network and can make it fail on purpose
  await ev(() => {
    const row = (id, extra) => Object.assign({ id, title: `List ${id}`, game_mode: 'pve', has_weapons: true, has_armor: false, item_count: 3, save_count: 2, featured: false, submitter_bungie_name: `Guardian#${id}` }, extra);
    const evil = row(100, { title: '<img src=x onerror="window.__pwned=1">', game_mode: 'x" onclick="window.__pwned=1' });
    window.__srv = {
      fail: false, capReached: false, calls: [],
      creators: [{ bungie_name: 'Datto#1', display_name: 'Datto', verified: true }],
      featured: [row(1, { title: 'Datto PvE meta', featured: true, submitter_bungie_name: 'Datto#1', save_count: 9 })],
      page1: [evil].concat(Array.from({ length: 19 }, (_, i) => row(200 + i))),
      page2: [row(300), row(301), row(302)],
      search: [row(400, { title: 'Datto’s picks', submitter_bungie_name: 'Datto#1' })],
      mine: [row(500, { title: 'My PvP list', game_mode: 'pvp', submitter_bungie_name: 'Me#1' })]
    };
    window.supabaseFetch = async (url, init) => {
      const S = window.__srv, body = init && init.body ? JSON.parse(init.body) : null;
      S.calls.push({ url, body });
      const r = (status, json) => ({ ok: status < 400, status, json: async () => json });
      if (S.fail) throw new Error('offline');
      if (url.includes('/creators')) return r(200, S.creators);
      if (url.includes('wishlist-actions')) {
        if (body.action === 'whoami') return r(200, { membershipId: 'm1', submittedCount: S.mine.length, cap: 5 });
        if (body.action === 'submit') return S.capReached ? r(400, { error: 'submission_cap_reached' }) : r(200, { ok: true });
        if (body.action === 'delete') { S.mine = S.mine.filter((x) => String(x.id) !== String(body.wishlist_id)); return r(200, { ok: true }); }
      }
      if (url.includes('select=payload')) return r(200, [{ payload: window.__payload }]);
      if (url.includes('increment_wishlist_save_count')) return r(200, {});
      if (url.includes('submitter_membership_id=eq.m1')) return r(200, S.mine);
      if (url.includes('featured=eq.true')) return r(200, S.featured);
      if (url.includes('featured=eq.false')) return r(200, url.includes('offset=0') ? S.page1 : S.page2);
      if (url.includes('ilike')) return r(200, S.search);
      return r(404, {});
    };
    // Like the real one: no token until signed in.
    window.bungieAuth = { getValidAuth: async () => { if (!window.__signedIn) throw new Error('NOT_SIGNED_IN'); return { access_token: 'tok' }; }, signIn: async () => {} };
    return new Promise((res) => window.awWishlistIO.getActiveListPayload((p) => { window.__payload = p; res(); }));
  });
  const cards = () => ev(() => document.querySelectorAll('#ui-screen-discover .ui-wlcard').length);
  const titles = () => ev(() => [...document.querySelectorAll('#ui-screen-discover .ui-sectiontitle')].map((x) => x.textContent));
  const calls = () => ev(() => window.__srv.calls.map((c) => c.url));

  await ev(() => document.querySelector('.ui-tab[data-tab=discover]').click());
  await page.waitFor(() => document.querySelectorAll('#ui-screen-discover .ui-wlcard').length > 0, { timeoutMs: 20000 });
  await wait(300);
  const b = await ev(() => ({
    titles: [...document.querySelectorAll('#ui-screen-discover .ui-sectiontitle')].map((x) => x.textContent),
    first: document.querySelector('#ui-screen-discover .ui-wlcard').textContent,
    verified: !!document.querySelector('#ui-screen-discover .ui-wlcard__verified'),
    evil: document.querySelectorAll('#ui-screen-discover img').length, pwned: window.__pwned || null,
    evilCard: [...document.querySelectorAll('#ui-screen-discover .ui-wlcard__title')].find((x) => /onerror/.test(x.textContent)) ? true : false,
    more: [...document.querySelectorAll('#ui-screen-discover .ui-btn')].some((x) => /Load more/.test(x.textContent)),
    wider: document.documentElement.scrollWidth > innerWidth + 1
  }));
  if (width === WIDTHS[0]) await page.screenshot(path.join(OUT, `next-discover-${width}.png`));
  check(`${tag}: Featured then Community, the creator's own name and a verified tick`, b.titles.join() === 'Featured,Community' && /Datto PvE meta/.test(b.first) && /Datto/.test(b.first) && /Featured/.test(b.first) && b.verified, JSON.stringify(b));
  check(`${tag}: someone else's markup shows as text and nothing runs`, b.evilCard && b.evil === 0 && !b.pwned && !b.wider);
  check(`${tag}: a full page offers Load more`, b.more);
  await ev(() => [...document.querySelectorAll('#ui-screen-discover .ui-btn')].find((x) => /Load more/.test(x.textContent)).click());
  await wait(500);
  check(`${tag}: Load more adds the next page and then goes away`, (await cards()) === 1 + 20 + 3 && await ev(() => ![...document.querySelectorAll('#ui-screen-discover .ui-btn')].some((x) => /Load more/.test(x.textContent))));

  // filter and search
  await ev(() => [...document.querySelectorAll('#ui-screen-discover .ui-chip')].find((c) => c.textContent === 'PvP').click());
  await wait(700);
  check(`${tag}: a filter chip asks the server for that mode`, (await calls()).some((u) => u.includes('game_mode=eq.pvp')) && await ev(() => document.querySelector('#ui-screen-discover .ui-chip.is-selected').textContent === 'PvP'));
  await ev(() => [...document.querySelectorAll('#ui-screen-discover .ui-chip')].find((c) => c.textContent === 'All').click());
  await wait(500);
  await ev(() => { const i = document.querySelector('#ui-screen-discover input[type=search]'); i.value = 'datto'; i.dispatchEvent(new Event('input', { bubbles: true })); });
  await page.waitFor(() => /Results/.test(document.querySelector('#ui-screen-discover').textContent), { timeoutMs: 10000 });
  await wait(300);
  check(`${tag}: searching shows Results, with title and creator matches`, (await titles()).includes('Results') && !(await titles()).includes('Community') && (await calls()).some((u) => u.includes('ilike.*datto*')) && (await cards()) === 1);

  // save
  const listsBefore = Object.keys((await dim()).lists).length;
  await ev(() => [...document.querySelectorAll('#ui-screen-discover .ui-wlcard .ui-btn')].find((x) => /Save to my lists/.test(x.textContent)).click());
  await wait(1200);
  const after = await dim();
  const saved = await ev(() => ({ btn: document.querySelector('#ui-screen-discover .ui-wlcard .ui-btn').textContent.trim(), disabled: document.querySelector('#ui-screen-discover .ui-wlcard .ui-btn').disabled, saves: document.querySelector('#ui-screen-discover .ui-wlcard__saves').textContent, toast: (document.querySelector('.ui-toast') || {}).textContent || '' }));
  check(`${tag}: Save adds the list as a new list of yours, says Saved, and counts the save`, Object.keys(after.lists).length === listsBefore + 1 && saved.btn === 'Saved' && saved.disabled && saved.saves === '3 saved' && /Imported/.test(saved.toast) && (await calls()).some((u) => u.includes('increment_wishlist_save_count')), JSON.stringify(saved));
  await ev(() => { const i = document.querySelector('#ui-screen-discover input[type=search]'); i.value = ''; i.dispatchEvent(new Event('input', { bubbles: true })); });
  await wait(900);

  // submit, signed out then signed in
  await ev(() => document.querySelector('.ui-discover__submit').click());
  await wait(400);
  check(`${tag}: signed out, Submit asks you to sign in`, await ev(() => /Sign in to submit/.test(document.querySelector('.ui-layer:not([hidden])').textContent) && !!document.querySelector('.ui-layer:not([hidden]) .ui-sheet__foot .ui-btn--primary')));
  await page.press('Escape'); await wait(300);
  await ev(() => { window.__signedIn = true; return chrome.storage.local.set({ bungie_auth: { access_token: 'x', user: { displayName: 'Tester' } } }); });
  await wait(400);
  await ev(() => document.dispatchEvent(new CustomEvent('bungieAuthChanged', { detail: { auth: { access_token: 'x' } } })));
  await wait(900);
  check(`${tag}: signing in offers the Automation choice (D5)`, await ev(() => [...document.querySelectorAll('.ui-layer:not([hidden]) .ui-sheet__title')].some((t) => /Automation/.test(t.textContent))));
  await page.press('Escape'); await wait(300);
  check(`${tag}: signed in, My submissions shows your list with Delete and your limit`, await ev(() => { const t = document.querySelector('#ui-screen-discover').textContent; return /My submissions/.test(t) && /1 of 5 used/.test(t) && /My PvP list/.test(t) && [...document.querySelectorAll('#ui-screen-discover .ui-btn')].some((x) => x.textContent === 'Delete'); }));
  await ev(() => document.querySelector('.ui-discover__submit').click());
  await wait(900);
  const sub = await ev(() => { const l = document.querySelector('.ui-layer:not([hidden])'); return { title: (l.querySelector('input') || {}).value || '', mode: (l.querySelector('.ui-seg__opt.is-selected') || {}).textContent || '', text: l.textContent }; });
  check(`${tag}: Submit shows your current list, its suggested mode and your limit`, sub.title.length > 0 && /PvE|PvP|Mixed/.test(sub.mode) && /items? in/.test(sub.text) && /1 of 5 submissions used/.test(sub.text), JSON.stringify(sub));
  await ev(() => { const l = document.querySelector('.ui-layer:not([hidden])'); const i = l.querySelector('input'); i.value = ''; i.dispatchEvent(new Event('input', { bubbles: true })); l.querySelector('.ui-sheet__foot .ui-btn').click(); });
  await wait(300);
  check(`${tag}: a missing title is refused in words`, await ev(() => /Give your wishlist a title/.test(document.querySelector('.ui-layer:not([hidden])').textContent)));
  await ev(() => { window.__srv.capReached = true; const l = document.querySelector('.ui-layer:not([hidden])'); const i = l.querySelector('input'); i.value = 'Test list'; i.dispatchEvent(new Event('input', { bubbles: true })); l.querySelector('.ui-sheet__foot .ui-btn').click(); });
  await wait(600);
  check(`${tag}: the server's limit error is explained and the sheet stays`, await ev(() => /limit of 5/.test(document.querySelector('.ui-layer:not([hidden])').textContent)));
  await ev(() => { window.__srv.capReached = false; document.querySelector('.ui-layer:not([hidden]) .ui-sheet__foot .ui-btn').click(); });
  await wait(900);
  const sent = await ev(() => window.__srv.calls.filter((c) => c.body && c.body.action === 'submit').pop().body);
  check(`${tag}: Submit sends title, mode and the list, then closes with a thank-you`, sent.title === 'Test list' && ['pve', 'pvp', 'mixed'].includes(sent.game_mode) && sent.payload && sent.payload.items && await ev(() => ![...document.querySelectorAll('.ui-layer')].some((l) => !l.hidden) && /submitted/.test((document.querySelector('.ui-toast') || {}).textContent || '')));

  // delete your own: asks first
  await ev(() => [...document.querySelectorAll('#ui-screen-discover .ui-btn')].find((x) => x.textContent === 'Delete').click());
  await wait(400);
  check(`${tag}: deleting your own submission asks first, and Keep it changes nothing`, await ev(() => !!document.querySelector('dialog[open]')) && (await ev(() => { [...document.querySelectorAll('dialog[open] .ui-btn')].find((x) => /Keep it/.test(x.textContent)).click(); return true; })) && (await wait(300), await ev(() => /My PvP list/.test(document.querySelector('#ui-screen-discover').textContent))));
  await ev(() => [...document.querySelectorAll('#ui-screen-discover .ui-btn')].find((x) => x.textContent === 'Delete').click());
  await wait(400);
  await ev(() => [...document.querySelectorAll('dialog[open] .ui-btn')].find((x) => x.textContent === 'Delete').click());
  await wait(900);
  check(`${tag}: confirming deletes it from the server and the screen`, await ev(() => window.__srv.calls.some((c) => c.body && c.body.action === 'delete' && c.body.wishlist_id === 500) && !/My PvP list/.test(document.querySelector('#ui-screen-discover').textContent)));

  // an unreachable server is said plainly, with a way to retry
  await ev(() => { window.__srv.fail = true; [...document.querySelectorAll('#ui-screen-discover .ui-chip')].find((c) => c.textContent === 'PvE').click(); });
  await wait(900);
  check(`${tag}: if Discover can't be reached it says so and offers Try again`, await ev(() => /Couldn.t reach Discover/.test(document.querySelector('#ui-screen-discover').textContent) && [...document.querySelectorAll('#ui-screen-discover .ui-btn')].some((x) => /Try again/.test(x.textContent))));
  await ev(() => { window.__srv.fail = false; [...document.querySelectorAll('#ui-screen-discover .ui-btn')].find((x) => /Try again/.test(x.textContent)).click(); });
  await wait(900);
  check(`${tag}: Try again brings it back`, (await cards()) > 0);
  await ev(() => document.querySelector('.ui-tab[data-tab=wishes]').click()); // the open tab is remembered between panels
  check(`${tag}: no page errors`, page.errors.length === 0, page.errors[0]);
}

/** First run: the app is usable at once, and a banner shows real download progress (D13). */
async function checkNextFirstRun(browser, base, width) {
  const tag = `[${width}] next first run`;
  const page = await openPanel(browser, base, 'empty', width, 'ui=next');
  const ev = (fn, ...args) => page.eval(fn, ...args);
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  await wait(1200);
  // pretend the game data is still arriving
  await ev(() => { AWShell.instance.ctx.store.manifest = 'downloading'; document.dispatchEvent(new CustomEvent('awManifestProgress', { detail: { percent: 42 } })); });
  await wait(300);
  const b = await ev(() => ({
    text: document.querySelector('.ui-banner-slot').textContent,
    bar: (document.querySelector('.ui-banner-slot [role=progressbar]') || { getAttribute: () => null }).getAttribute('aria-valuenow'),
    chip: document.querySelector('.ui-syncchip').textContent,
    usable: !document.querySelector('.ui-shell__base').inert && !!document.querySelector('.ui-addwish') && !document.querySelector('#ui-screen-wishes').hidden,
    wider: document.documentElement.scrollWidth > innerWidth + 1
  }));
  check(`${tag}: the app is usable while it downloads, with a banner and the real percentage`, /Getting game data · 42%/.test(b.text) && b.bar === '42' && /42%/.test(b.chip) && b.usable && !b.wider, JSON.stringify(b));
  await page.screenshot(path.join(OUT, `next-firstrun-${width}.png`));
  await ev(() => document.dispatchEvent(new CustomEvent('awManifestProgress', { detail: { percent: 88 } })));
  await wait(200);
  check(`${tag}: the bar moves`, await ev(() => document.querySelector('.ui-banner-slot [role=progressbar]').getAttribute('aria-valuenow') === '88'));
  await ev(() => document.dispatchEvent(new CustomEvent('awManifestReady')));
  await wait(300);
  check(`${tag}: the banner goes away when the data is ready`, await ev(() => !/game data/i.test(document.querySelector('.ui-banner-slot').textContent) && !document.querySelector('.ui-banner-slot [role=progressbar]')));
  check(`${tag}: no page errors`, page.errors.length === 0, page.errors[0]);
}

/** Godroll.tv and DIM: reached from + Wish (and the empty list), with the access explainer first. */
async function checkNextSites(browser, base, width) {
  const tag = `[${width}] next sites`;
  const page = await openPanel(browser, base, 'empty', width, 'ui=next');
  const ev = (fn, ...args) => page.eval(fn, ...args);
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  await wait(1200);
  await ev(() => { window.__tabs = []; chrome.tabs.create = (o) => { window.__tabs.push(o.url); return Promise.resolve({}); }; });
  const layer = (title) => `[...document.querySelectorAll('.ui-layer:not([hidden])')].find((l) => /${title}/.test(l.querySelector('.ui-sheet__title').textContent))`;
  await ev(() => document.querySelector('.ui-addwish').click());
  await wait(300);
  const rows = await ev(() => [...document.querySelector('.ui-layer:not([hidden])').querySelectorAll('.ui-row__title')].map((x) => x.textContent));
  check(`${tag}: + Wish offers weapon, armor, Godroll.tv and DIM`, rows.join() === 'Weapon wish,Armor wish,Godroll.tv,Destiny Item Manager', rows.join());
  await ev(() => [...document.querySelector('.ui-layer:not([hidden])').querySelectorAll('.ui-row')].find((r) => /Destiny Item Manager/.test(r.textContent)).click());
  await wait(300);
  check(`${tag}: DIM opens in a new tab`, (await ev(() => window.__tabs)).join() === 'https://app.destinyitemmanager.com/');
  await ev(() => document.querySelector('.ui-addwish').click());
  await wait(300);
  await ev(() => [...document.querySelector('.ui-layer:not([hidden])').querySelectorAll('.ui-row')].find((r) => /Godroll\.tv/.test(r.textContent)).click());
  await wait(400);
  const ex = await ev(() => { const l = [...document.querySelectorAll('.ui-layer:not([hidden])')].find((x) => /Godroll\.tv/.test(x.querySelector('.ui-sheet__title').textContent)); return l ? { text: l.textContent, buttons: [...l.querySelectorAll('.ui-sheet__foot .ui-btn')].map((b) => b.textContent.trim()) } : null; });
  check(`${tag}: without access, Godroll.tv explains first, and nothing opened yet`, !!ex && /Ahamkara Wish/.test(ex.text) && /read and change/.test(ex.text) && ex.buttons.join() === 'Allow access,Just open Godroll.tv' && (await ev(() => window.__tabs.length)) === 1, JSON.stringify(ex));
  await ev(() => [...document.querySelectorAll('.ui-layer:not([hidden]) .ui-sheet__foot .ui-btn')].find((b) => /Just open/.test(b.textContent)).click());
  await wait(300);
  check(`${tag}: "Just open Godroll.tv" opens the site`, (await ev(() => window.__tabs)).pop() === 'https://godroll.tv/');
  await ev(() => document.querySelector('.ui-addwish').click());
  await wait(300);
  await ev(() => [...document.querySelector('.ui-layer:not([hidden])').querySelectorAll('.ui-row')].find((r) => /Godroll\.tv/.test(r.textContent)).click());
  await wait(400);
  await ev(() => [...document.querySelectorAll('.ui-layer:not([hidden]) .ui-sheet__foot .ui-btn')].find((b) => /Allow access/.test(b.textContent)).click());
  await wait(500);
  check(`${tag}: if Chrome's permission isn't given, it still opens the site and says what's missing`, (await ev(() => window.__tabs)).pop() === 'https://godroll.tv/' && await ev(() => /without the Ahamkara Wish button/.test((document.querySelector('.ui-toast') || {}).textContent || '')));
  await ev(() => { const b = [...document.querySelectorAll('#ui-screen-wishes .ui-btn')].find((x) => /Get rolls from Godroll/.test(x.textContent)); b && b.click(); });
  await wait(400);
  check(`${tag}: the empty list offers Godroll.tv too`, await ev(() => !![...document.querySelectorAll('.ui-layer:not([hidden])')].find((x) => /Godroll\.tv/.test(x.querySelector('.ui-sheet__title').textContent))));
  check(`${tag}: no page errors`, page.errors.length === 0, page.errors[0]);
}

/** Lists from other people, shown in the new screens. */
async function checkNextHostile(browser, base, width) {
  const tag = `[${width}] next hostile`;
  const page = await openPanel(browser, base, 'hostile', width, 'ui=next');
  const r = await page.eval(async () => {
    const s = (ms) => new Promise((x) => setTimeout(x, ms));
    const q = (sel) => [...document.querySelectorAll(sel)];
    await s(1500);
    const grab = () => ({
      pwned: window.__pwned ?? null,
      handlers: document.querySelectorAll('[onerror],[onload],script:not([src])').length,
      offsite: [...document.images].map((i) => i.getAttribute('src') || '').filter((u) => /^https?:/.test(u) && !/^https:\/\/www\.bungie\.net\//.test(u)),
      evilInDom: /evil\.example/.test(document.documentElement.outerHTML),
      wider: document.documentElement.scrollWidth > innerWidth + 1
    });
    const weaponNames = q('.ui-itemrow__name').map((e) => e.textContent);
    // open every weapon's detail screen
    for (let i = 0; i < weaponNames.length; i++) {
      q('.ui-itemrow')[i].click(); await s(300);
      document.querySelector('.ui-subscreen:not([hidden]) .ui-subscreen__back').click(); await s(200);
    }
    const weapons = grab();
    document.querySelector('.ui-seg__opt[data-value=armor]').click(); await s(1200);
    const setNames = q('.ui-itemrow__name').map((e) => e.textContent);
    const detailNames = [];
    for (let i = 0; i < setNames.length; i++) {
      q('.ui-itemrow')[i].click(); await s(500);
      detailNames.push(...q('.ui-subscreen:not([hidden]) .ui-piece__name, .ui-subscreen:not([hidden]) .ui-archetype').map((e) => e.textContent));
      document.querySelector('.ui-subscreen:not([hidden]) .ui-subscreen__back').click(); await s(200);
    }
    return { weaponNames, setNames, detailNames, weapons, armor: grab() };
  });
  check(`${tag}: no injected script ran`, r.weapons.pwned === null && r.weapons.handlers === 0 && r.armor.handlers === 0, JSON.stringify([r.weapons.pwned, r.weapons.handlers]));
  check(`${tag}: no off-site images`, r.weapons.offsite.length === 0 && r.armor.offsite.length === 0 && !r.weapons.evilInDom && !r.armor.evilInDom, JSON.stringify(r.weapons.offsite));
  check(`${tag}: the honest wish still renders`, r.weaponNames.includes('Honest Gun'), JSON.stringify(r.weaponNames));
  check(`${tag}: malicious names show as text`, r.weaponNames.some((n) => n.includes('onerror')));
  check(`${tag}: malformed armor does not blank the list or its detail`, r.setNames.length >= 1 && r.detailNames.length >= 2, JSON.stringify([r.setNames, r.detailNames]));
  check(`${tag}: nothing wider than the panel`, !r.weapons.wider && !r.armor.wider);
  check(`${tag}: no page errors`, page.errors.length === 0, page.errors[0]);
}

/** A fresh install, and the way back to the classic design. */
async function checkNextEmptyAndSwitch(browser, base, width) {
  const tag = `[${width}] next empty`;
  const page = await openPanel(browser, base, 'empty', width, 'ui=next');
  await page.eval(() => new Promise((r) => setTimeout(r, 800)));
  check(`${tag}: empty weapons and armor say what to do`, await page.eval(async () => {
    const hasEmpty = () => /No (weapon|armor) wishes yet/.test(document.querySelector('.ui-cardlist').textContent) && !!document.querySelector('.ui-cardlist .ui-btn');
    const a = hasEmpty();
    document.querySelector('.ui-seg__opt[data-value=armor]').click(); await new Promise((r) => setTimeout(r, 400));
    return a && hasEmpty();
  }));
  check(`${tag}: no page errors`, page.errors.length === 0, page.errors[0]);
}

/**
 * A guest (not signed in) must not retry Bungie in a loop: every panel re-show
 * used to start another sync. Counts calls to the sync's profile fetch.
 */
const guestSyncLoop = async () => {
  const s = (ms) => new Promise((r) => setTimeout(r, ms));
  let calls = 0;
  const real = window.refreshProfileAndBuildIndex;
  window.refreshProfileAndBuildIndex = (...a) => { calls++; return real(...a); };
  for (let i = 0; i < 3; i++) { document.dispatchEvent(new Event('visibilitychange')); await s(100); }
  const afterShows = calls;
  const bar = (document.querySelector('.ui-banner-slot')?.textContent || '') + ' ' + (document.querySelector('.ui-syncchip')?.textContent || '');
  document.dispatchEvent(new CustomEvent('bungieAuthChanged', { detail: { auth: { access_token: 'x' } } }));
  await s(300);
  window.refreshProfileAndBuildIndex = real;
  return { afterShows, afterSignIn: calls - afterShows, bar };
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
  check(`${tag}: a confirm whose dialog is removed settles as "no" (never hangs)`, await ev(async () => {
    const pending = AWUI.confirm({ title: 'Removed while open' });
    await new Promise((r) => setTimeout(r, 50));
    document.querySelector('dialog.ui-dialog').remove();
    return (await Promise.race([pending, new Promise((r) => setTimeout(() => r('hung'), 500))])) === false;
  }));

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
      check(`[${width}] demo: no page errors`, page.errors.length === 0, page.errors[0]);
      await checkNext(browser, url, width);
      if (width === WIDTHS[0]) {
        const s = await page.eval(engineEdits);
        check('demo: Edit after the list shifted changes the right wish', s.editStale);
        check('demo: Edit into an existing roll is refused, nothing changes', s.editDuplicate);
        check('demo: Edit of a wish deleted elsewhere changes nothing', s.editMissing);
        check('demo: no page errors after the edits', page.errors.length === 0, page.errors[0]);
        const g = await page.eval(guestSyncLoop);
        check('guest: re-showing the panel does not retry sync', g.afterShows === 0, `${g.afterShows} retries`);
        check('guest: the app says to sign in', /sign in/i.test(g.bar), g.bar);
        check('guest: signing in syncs once', g.afterSignIn === 1, `${g.afterSignIn} syncs`);
      }

      await checkNextHostile(browser, url, width);
      await checkNextOwned(browser, url, width);
      await checkNextDrops(browser, url, width);
      await checkNextBuilder(browser, url, width);
      await checkNextArmorBuilder(browser, url, width);
      await checkNextInventory(browser, url, width);
      await checkNextLists(browser, url, width);
      await checkNextDiscover(browser, url, width);
      await checkNextFirstRun(browser, url, width);
      await checkNextSites(browser, url, width);

      // empty
      await checkNextEmptyAndSwitch(browser, url, width);
    }
  } finally {
    await browser.close();
    server.close();
  }
  if (failures) { console.error(`\n${failures} UI check(s) failed. Screenshots: ${OUT}`); process.exit(1); }
  console.log(`\nAll UI checks passed. Screenshots: ${OUT}`);
})().catch((e) => { console.error(e); process.exit(1); });
