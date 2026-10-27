// Ahamkara Wishes — the Inventory screen.
//
// Search what you actually own, and see which copies already satisfy a wish.
//   list     search by name, slot chips (Kinetic ... Class) and "Matches a wish";
//            one calm row per item: how many you own and how many match a wish
//   detail   every copy of the item: its perks (the equipped one marked), what
//            wishes it satisfies, and "Start a wish from this roll", which opens
//            the weapon or armor builder with that copy's real perks (D2: this
//            replaces the old double-click; nothing is saved until you save)
//
// Inventory comes from the last sync (the OwnedIndex built from Bungie); this
// screen never calls Bungie itself. The rules are in inventory-core.js.
//
// Needs aw-dom, aw-ui, sync-status and inventory-core.

(function (root) {
  'use strict';

  const D = root.AWDom, UI = root.AWUI, I = root.AWInventory, doc = root.document;
  const { h, raw } = D;
  const BUNGIE = typeof BUNGIE_ROOT !== 'undefined' ? BUNGIE_ROOT : 'https://www.bungie.net';
  const CHEVRON = raw('<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false"><path d="M9 6l6 6-6 6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" fill="none"/></svg>');
  const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

  function icon(url, className) {
    const src = D.safeImageUrl(url);
    return src ? h('img', { class: className, src, alt: '', loading: 'lazy' }) : h('span', { class: [className, 'ui-itemicon--blank'] });
  }

  function create(ctx) {
    const state = { query: '', slots: new Set(), onlyMatches: false };
    let data = null;          // dimData, kept current from storage
    let active = false;       // is the Inventory tab showing?
    let stale = true;         // something changed while it wasn't
    let seq = 0;
    let detail = null;        // { hash }

    // --- controls
    const search = UI.searchField({ label: 'Search your inventory', placeholder: 'Search your inventory', onInput: (v) => { state.query = v; render(); } });
    const chips = new Map();
    const chip = (key, label, on) => {
      const b = h('button', { type: 'button', class: 'ui-chip', aria: { pressed: 'false' }, on: { click: () => { on(); paintChips(); render(); } } }, h('span', null, label));
      chips.set(key, b);
      return b;
    };
    const chipRow = UI.chipRow([
      chip('matches', 'Matches a wish', () => { state.onlyMatches = !state.onlyMatches; }),
      ...I.SLOTS.map((s) => chip(s.key, s.label, () => { if (state.slots.has(s.key)) state.slots.delete(s.key); else state.slots.add(s.key); }))
    ], { label: 'Filter by slot' });
    function paintChips() {
      chips.forEach((b, key) => {
        const on = key === 'matches' ? state.onlyMatches : state.slots.has(key);
        b.classList.toggle('is-selected', on); b.setAttribute('aria-pressed', String(on));
      });
    }
    const syncNote = h('span', { class: 'ui-note' });
    const refreshBtn = UI.button({ label: 'Refresh', variant: 'ghost', onClick: () => ctx.syncNow() });
    const listEl = h('div', { class: 'ui-cardlist' });
    const top = h('div', { class: 'ui-stickytop' }, search, chipRow, h('div', { class: 'ui-inv__sync' }, syncNote, refreshBtn));
    const el = h('div', { class: 'ui-inventory' }, top, listEl);

    // --- data
    const index = () => root.OwnedInventoryIndex && root.OwnedInventoryIndex.getCachedIndex && root.OwnedInventoryIndex.getCachedIndex();
    const hasIndex = () => { const i = index(); return !!(i && i.byItemHash && i.byItemHash.size); };

    async function find(extra) {
      const defs = await root.loadInventoryItemDefsToMemory();
      return I.search(Object.assign({
        index: index(), defs, dimData: data, query: state.query, slots: state.slots, onlyMatches: state.onlyMatches,
        perkSocketIndexes: root.getWeaponPerkSocketIndexes,
        isTracker: (n) => typeof WEAPON_TRACKER_PLUG_NAME_PATTERN !== 'undefined' && WEAPON_TRACKER_PLUG_NAME_PATTERN.test(n),
        iconRoot: BUNGIE
      }, extra));
    }

    function paintSync() {
      const snap = (root.appManager && root.appManager.getSyncSnapshot && root.appManager.getSyncSnapshot()) || {};
      const ago = snap.lastSyncAt ? root.AWSync.formatAgo(Date.now() - snap.lastSyncAt) : '';
      syncNote.textContent = snap.syncing ? 'Syncing…' : snap.lastSyncAt ? `Inventory synced ${ago === 'Just now' ? 'just now' : `${ago} ago`}` : 'Not synced yet';
      refreshBtn.disabled = !!snap.syncing;
    }

    // --- the list
    async function render() {
      stale = false;
      paintSync();
      const mine = ++seq;
      if (!hasIndex()) {
        listEl.replaceChildren(ctx.store.auth.signedIn
          ? UI.emptyState({ title: 'No inventory yet', body: 'Sync to read your inventory from Bungie.', actions: [UI.button({ label: 'Sync now', variant: 'primary', onClick: () => ctx.syncNow() })] })
          : UI.emptyState({ title: 'Sign in to see your inventory', body: 'Ahamkara Wishes needs your Bungie account to read what you own.', actions: [UI.button({ label: 'Sign in with Bungie', variant: 'primary', onClick: () => ctx.signIn() })] }));
        return;
      }
      if (I.needsInput(state.query, state.slots, state.onlyMatches)) {
        listEl.replaceChildren(UI.emptyState({ title: 'Search your inventory', body: 'Type a name, or choose a slot or “Matches a wish” above. Items with a roll that matches a wish come first.' }));
        return;
      }
      let result;
      try { result = await find(); } catch (e) { console.warn('[Inventory] search failed', e); return; }
      if (mine !== seq) return;
      const rows = result.items.map((m) => itemRow(m));
      if (!rows.length) {
        listEl.replaceChildren(UI.emptyState({ title: 'Nothing matches', body: 'No item in your inventory fits that search.' }));
      } else {
        if (result.capped) rows.push(h('p', { class: 'ui-note' }, `Showing the first ${I.RESULT_CAP}. Narrow the search to see others.`));
        listEl.replaceChildren(...rows);
      }
      if (ctx.nav.isOpen('inventoryDetail')) renderDetail();
    }

    function itemRow(m) {
      const sub = I.summaryOf(m);
      return h('button', {
        type: 'button', class: 'ui-itemrow', aria: { label: `${m.name}, ${sub}${m.matchCount ? `, ${plural(m.matchCount, 'roll matches', 'rolls match')} a wish` : ''}` },
        on: { click: (e) => { detail = { hash: m.hash }; ctx.nav.open('inventoryDetail', detail, { returnFocus: e.currentTarget }); } }
      },
      icon(m.icon, 'ui-itemicon ui-itemicon--lg'),
      h('span', { class: 'ui-itemrow__text' },
        h('span', { class: 'ui-itemrow__name' }, m.name),
        h('span', { class: 'ui-itemrow__sub' }, sub),
        m.matchCount ? h('span', { class: 'ui-itemrow__owned' }, `★ ${plural(m.matchCount, 'roll matches', 'rolls match')} a wish`) : null),
      h('span', { class: 'ui-itemrow__end' }, CHEVRON));
    }

    // --- the detail screen
    const screen = ctx.addScreen('inventoryDetail', 'Item', () => renderDetail());

    async function renderDetail() {
      if (!detail) return;
      const mine = ++seq;
      let item;
      try { item = (await find({ onlyHash: detail.hash })).items[0]; } catch (e) { return; }
      if (mine !== seq) return;
      if (!item) { ctx.nav.close('inventoryDetail', { force: true }); return; }
      screen.setTitle(item.name);
      screen.body.replaceChildren(
        h('div', { class: 'ui-detailhead' }, icon(item.icon, 'ui-itemicon ui-itemicon--lg'),
          h('div', null, h('div', { class: 'ui-detailhead__name' }, item.name), h('div', { class: 'ui-detailhead__sub' }, I.summaryOf(item)))),
        ...item.instances.map((inst, n) => rollCard(item, inst, n)));
    }

    function rollCard(item, inst, n) {
      const input = I.wishInput(item, inst);
      const matched = inst.wishMatches.length > 0;
      const equipped = item.isWeapon ? inst.columns.map((c) => (c.perks.find((p) => p.isActive) || {}).name).filter(Boolean) : [];
      return h('article', { class: ['ui-rollcard', matched && 'is-owned'], data: { instance: inst.instanceId } },
        h('div', { class: 'ui-rollcard__head' },
          UI.badge(`#${n + 1}`, 'muted'),
          inst.isCrafted ? UI.badge('✦ Crafted', 'accent') : null,
          ...inst.wishMatches.map((m) => UI.badge(`✓ ${m.listName}`, m.mode))),
        item.isArmor && (inst.armorArchetype || inst.armorTertiary)
          ? h('div', { class: 'ui-traits' },
            inst.armorArchetype ? h('span', { class: 'ui-archetype' }, inst.armorArchetype) : null,
            inst.armorTertiary ? h('span', { class: 'ui-stat', data: { stat: inst.armorTertiary.toLowerCase() }, title: 'Tertiary' }, `+ ${inst.armorTertiary}`) : null)
          : null,
        inst.columns.length
          ? h('div', { class: 'ui-invcols', role: 'group', aria: { label: 'Perks. The equipped perk in each column is ringed.' } },
            inst.columns.map((c) => h('div', { class: 'ui-invcol' }, c.perks.map((p) => h('span', {
              class: ['ui-invperk', p.isActive && 'is-active'], role: 'img', title: p.name, aria: { label: `${p.name}${p.isActive ? ', equipped' : ''}` }
            }, icon(p.icon, 'ui-invperk__img'))))))
          : h('p', { class: 'ui-note' }, 'No perk data for this copy.'),
        equipped.length ? h('p', { class: 'ui-note ui-invequipped' }, `Equipped: ${equipped.join(' · ')}`) : null,
        input ? h('div', { class: 'ui-rollcard__foot' }, UI.button({ label: 'Start a wish from this roll', variant: 'secondary', onClick: (e) => ctx.startFromOwned(input, e.currentTarget) })) : null);
    }

    // --- keeping in step
    function schedule() { if (active || ctx.nav.isOpen('inventoryDetail')) render(); else stale = true; }
    root.chrome.storage.local.get(['dimData'], (res) => { data = res.dimData || {}; schedule(); });
    root.chrome.storage.onChanged.addListener((changes, area) => {
      if (area === 'local' && changes.dimData) { data = changes.dimData.newValue || {}; schedule(); }
    });
    doc.addEventListener('awSyncChanged', schedule);
    doc.addEventListener('awManifestReady', schedule);
    ctx.nav.onChange((s) => {
      const now = s.tab === 'inventory';
      if (now === active) return;
      active = now;
      if (now && stale) render(); else if (now) paintSync();
    });
    root.setInterval(() => { if (active) paintSync(); }, 30000);
    paintChips();

    return { el, render };
  }

  root.AWInventoryScreen = { create };
})(typeof window !== 'undefined' ? window : globalThis);
