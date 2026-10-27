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

async function openPanel(browser, base, fixture, width, query = '') {
  const page = await browser.newPage({ width, height: 720 });
  await page.goto(`${base}/sidepanel.html?fixture=${fixture}${query ? `&${query}` : ''}`);
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

  // An armor wish with a Spark (e.g. imported) keeps it through an edit in the
  // builder, which can't pick a Spark yet.
  // (an armor wish with a Tertiary: the builder can only edit those)
  const pickWithTertiary = () => Object.entries(items()).find(([, i]) => i.static.type === 'armor' && i.wishes[0]?.config?.tertiary);
  [hash, item] = pickWithTertiary();
  await AWStore.update((d) => { d.lists[d.activeId].items[hash].wishes[0].config.spark = 'Super'; });
  item = items()[hash];
  const before = item.wishes[0];
  await loadWishIntoArmorCraft(hash, 0, item, before);
  const flipped = before.tags[0] === 'pvp' ? 'pve' : 'pvp';
  currentMode = flipped; // the edit: switch PvE/PvP (the builder's own state)
  await handleEditWish();
  const after = items()[hash].wishes[0];
  out.armorEditDiag = JSON.stringify({ before: before.config, after: after.config, tags: after.tags, arch: currentArchetype && currentArchetype.name, tertiary: currentTertiary });
  out.armorEditKeepsSpark = after.tags[0] === flipped && after.config.spark === 'Super';
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
      classicHidden: !vis(document.querySelector('.app-container')),
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
  check(`${tag}: the new shell is shown and the classic screens are hidden`, layout.shell && layout.classicHidden);
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
    return !!layer && layer.querySelectorAll('.ui-row').length === 2 && document.querySelector('.ui-shell__base').inert === true;
  }));
  await page.press('Escape');
  await sleep2(300);
  check(`${tag}: Escape closes the sheet and focus returns to the list name`, await ev(() => ![...document.querySelectorAll('.ui-layer')].some((l) => !l.hidden) && document.activeElement === document.querySelector('.ui-listname')));
  await ev(() => document.querySelector('.ui-listname').click());
  await sleep2(300);
  await ev(() => [...document.querySelectorAll('.ui-layer:not([hidden]) .ui-row')].find((r) => /Raid/.test(r.textContent)).click());
  await sleep2(800);
  check(`${tag}: choosing another list switches to it`, await ev(() => document.querySelector('.ui-listname__text').textContent === 'Raid & Dungeon'));
  await ev(() => document.querySelector('.ui-listname').click());
  await sleep2(300);
  await ev(() => [...document.querySelectorAll('.ui-layer:not([hidden]) .ui-row')].find((r) => /Main/.test(r.textContent)).click());
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

  // tabs that aren't rebuilt yet are honest stubs
  await ev(() => document.querySelector('.ui-tab[data-tab=inventory]').click());
  await sleep2(200);
  check(`${tag}: tabs that are not rebuilt yet say so and offer the classic design`, await ev(() => /Inventory is coming/.test(document.querySelector('#ui-screen-inventory').textContent) && !!document.querySelector('#ui-screen-inventory .ui-btn')));
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
      statRows: q(`${b}.ui-stat`).length,
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

  // ?ui=classic wins over the remembered choice, and the classic Menu offers the switch
  const classic = await openPanel(browser, base, 'empty', width, 'ui=classic');
  check(`${tag}: ?ui=classic shows the classic screens`, await classic.eval(() => !document.getElementById('ui-shell') && getComputedStyle(document.querySelector('.app-container')).display !== 'none' && !!document.getElementById('try-new-design')));
  await classic.eval(() => { try { localStorage.removeItem('aw-ui'); } catch (e) { /* none */ } });
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
  const bar = document.getElementById('weapon-sync-status')?.textContent || '';
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
      let r = await page.eval(readLists);
      check(`[${width}] demo: weapon list renders`, r.weapons.length === 3, JSON.stringify(r.weapons));
      check(`[${width}] demo: armor list renders`, r.armor.length === 3, JSON.stringify(r.armor));
      // The demo's armor was saved without set hashes; startup backfills them.
      check(`[${width}] demo: both Techsec pieces group under Bungie's set name`, r.sets.filter((n) => n === 'Techsec').length === 1 && r.sets.length === 2, JSON.stringify(r.sets));
      check(`[${width}] demo: nothing wider than the panel`, !r.wider);
      check(`[${width}] demo: no page errors`, page.errors.length === 0, page.errors[0]);
      await page.screenshot(path.join(OUT, `demo-armor-${width}.png`));
      await checkNext(browser, url, width);
      if (width === WIDTHS[0]) {
        const s = await page.eval(staleRowActions);
        check('demo: Delete after the list shifted removes the right weapon wish', s.weaponDelete);
        check('demo: Delete after the list shifted removes the right armor wish', s.armorDelete);
        check('demo: Edit after the list shifted changes the right wish', s.editStale);
        check('demo: Edit into an existing roll is refused, nothing changes', s.editDuplicate);
        check('demo: Edit of a wish deleted elsewhere changes nothing', s.editMissing);
        check('demo: editing an armor wish keeps its Spark', s.armorEditKeepsSpark, s.armorEditDiag);
        check('demo: no page errors after the edits', page.errors.length === 0, page.errors[0]);
        const g = await page.eval(guestSyncLoop);
        check('guest: re-showing the panel does not retry sync', g.afterShows === 0, `${g.afterShows} retries`);
        check('guest: the sync bar says to sign in', /sign in/i.test(g.bar), g.bar);
        check('guest: signing in syncs once', g.afterSignIn === 1, `${g.afterSignIn} syncs`);
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

      await checkNextHostile(browser, url, width);
      await checkNextOwned(browser, url, width);
      await checkNextDrops(browser, url, width);
      await checkNextBuilder(browser, url, width);

      // empty
      page = await openPanel(browser, url, 'empty', width);
      r = await page.eval(readLists);
      check(`[${width}] empty: no wishes, no crash`, r.weapons.length === 0 && r.armor.length === 0);
      check(`[${width}] empty: empty states shown`, await page.eval(() => /No (Armor|weapon) Wishes yet/i.test(document.body.innerText)));
      check(`[${width}] empty: no page errors`, page.errors.length === 0, page.errors[0]);
      await checkNextEmptyAndSwitch(browser, url, width);
    }
  } finally {
    await browser.close();
    server.close();
  }
  if (failures) { console.error(`\n${failures} UI check(s) failed. Screenshots: ${OUT}`); process.exit(1); }
  console.log(`\nAll UI checks passed. Screenshots: ${OUT}`);
})().catch((e) => { console.error(e); process.exit(1); });
