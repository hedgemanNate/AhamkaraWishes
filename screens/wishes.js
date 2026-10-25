// Ahamkara Wishes — the Wishes screen: everything you're hunting, in the active
// list. Weapons and Armor, search, PvE/PvP and owned filters, a card per
// weapon, and a card per armor SET that says what the set does (D15).
//
// Reads the list straight from storage (the same data as the classic screens)
// and draws it with AWDom, so wishlist text from other people stays text.
//
// Needs aw-dom, aw-store, aw-ui and wishlist-sync-core; the set data and
// archetype table come from destiny-manifest.js and manager.js when loaded.

(function (root) {
  'use strict';

  const D = root.AWDom, UI = root.AWUI, doc = root.document;
  const { h } = D;
  const WS = root.WishlistSync;
  const COMBO_COLORS = ['red', 'blue', 'green', 'orange'];
  const CLASS_NAMES = { 0: 'Titan', 1: 'Hunter', 2: 'Warlock' };
  const BONUS_KEY = 'aw-bonus-collapsed';
  const CARET = D.raw('<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true" focusable="false"><path d="M9 6l6 6-6 6" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" fill="none"/></svg>');

  // ---- small helpers -----------------------------------------------------------------

  const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
  const text = (v, fallback) => (typeof v === 'string' && v.trim() ? v : fallback);
  const tagOf = (w) => (w && w.tags && w.tags[0] === 'pvp' ? 'pvp' : 'pve');
  const ownedCount = (w) => (w && w.received ? Math.max(1, (w.receivedInstances || []).length) : 0);

  function loadCollapsed() {
    try { return new Set(JSON.parse(root.localStorage.getItem(BONUS_KEY) || '[]')); } catch (e) { return new Set(); }
  }
  function saveCollapsed(set) {
    try { root.localStorage.setItem(BONUS_KEY, JSON.stringify([...set])); } catch (e) { /* storage blocked */ }
  }

  /** Combo numbers (1-4) a perk wears. One perk can wear several colors. */
  function comboNumbers(perk) {
    const colors = Array.isArray(perk.colors) ? perk.colors : (perk.color ? [perk.color] : []);
    return colors.map((c) => COMBO_COLORS.indexOf(c) + 1).filter((n) => n > 0);
  }

  function archetypeStats(name) {
    const table = typeof ARCHETYPES !== 'undefined' ? ARCHETYPES : [];
    const a = table.find((x) => x.name === name);
    return a ? a.stats : [];
  }

  function icon(url, className) {
    const src = D.safeImageUrl(url);
    return src
      ? h('img', { class: className || 'ui-itemicon', src, alt: '', loading: 'lazy' })
      : h('span', { class: [className || 'ui-itemicon', 'ui-itemicon--blank'] });
  }

  // ---- the screen ---------------------------------------------------------------------

  function create(ctx) {
    const state = { kind: 'weapon', query: '', modes: new Set(), owned: 'all' };
    let data = null;           // dimData, kept current from storage
    let queued = false;
    const collapsed = loadCollapsed();
    const bonusCache = new Map(); // setHash -> bonuses | 'loading'

    // --- controls
    const seg = UI.segmented({
      label: 'Show', value: state.kind,
      options: [{ value: 'weapon', label: 'Weapons' }, { value: 'armor', label: 'Armor' }],
      onChange: (v) => { state.kind = v; render(); }
    });
    const search = UI.searchField({ label: 'Search wishes', placeholder: 'Search by name', onInput: (v) => { state.query = v.trim().toLowerCase(); render(); } });
    const chipsEl = h('div');
    const listEl = h('div', { class: 'ui-cardlist' });
    const top = h('div', { class: 'ui-stickytop' }, seg, search, chipsEl);
    const el = h('div', { class: 'ui-wishes' }, top, listEl);

    // --- roll actions (shared by every card)
    const actions = ctx.addSheet('rollActions', 'Roll', () => fillActions(actions._params));
    function openActions(params, trigger) { actions._params = params; ctx.nav.open('rollActions', params, { returnFocus: trigger }); }
    function fillActions(p) {
      if (!p) return;
      actions.setTitle(p.title);
      const body = actions.querySelector('.ui-sheet__body');
      body.replaceChildren(h('div', { class: 'ui-sheetlist' },
        UI.row({ title: 'Edit roll', subtitle: 'Change the perks or stats', onClick: () => { ctx.nav.close('rollActions'); ctx.startWish(); } }),
        UI.row({ title: 'Delete roll', subtitle: 'You can undo this', className: 'is-danger', onClick: () => { ctx.nav.close('rollActions'); deleteRoll(p); } })));
    }

    /** Deletes one roll and offers Undo (D6: restorable, so no confirm). */
    async function deleteRoll(p) {
      let removed = null, staticInfo = null, listId = null, pos = -1;
      await AWStore.update((d) => {
        listId = AWStore.ensureActiveList(d);
        const item = d.lists[listId].items[p.hash];
        const at = WS.locateWish(item && item.wishes, p.index, p.key);
        if (at < 0) return AWStore.SKIP;
        [removed] = item.wishes.splice(at, 1);
        pos = at; staticInfo = item.static;
        WS.recordWishTombstone(d, listId, p.hash, removed);
        if (!item.wishes.length) delete d.lists[listId].items[p.hash];
      });
      if (!removed) return;
      ctx.toast('Roll deleted.', {
        undo: () => AWStore.update((d) => { if (!WS.restoreWish(d, listId, p.hash, removed, staticInfo, pos)) return AWStore.SKIP; })
      });
    }

    // --- data
    function activeItems() {
      const lists = (data && data.lists) || {};
      const list = lists[data && data.activeId] || lists.default || lists[Object.keys(lists)[0]];
      return (list && list.items) || {};
    }

    function wishPasses(w) {
      if (state.modes.size && !state.modes.has(tagOf(w))) return false;
      if (state.owned === 'owned' && !w.received) return false;
      if (state.owned === 'missing' && w.received) return false;
      return true;
    }

    function entries(kind) {
      return Object.entries(activeItems()).filter(([, it]) => it && it.static && it.static.type === kind && Array.isArray(it.wishes));
    }

    function counts() {
      const n = (kind) => entries(kind).reduce((sum, [, it]) => sum + it.wishes.length, 0);
      return { weapon: n('weapon'), armor: n('armor') };
    }

    // --- rendering
    function render() {
      if (!data) return;
      const c = counts();
      seg.querySelectorAll('.ui-seg__opt').forEach((b) => {
        const badge = b.querySelector('.ui-seg__badge');
        if (badge) badge.textContent = String(c[b.dataset.value]);
      });
      if (!seg.querySelector('.ui-seg__badge')) {
        seg.querySelectorAll('.ui-seg__opt').forEach((b) => b.appendChild(h('span', { class: 'ui-seg__badge' }, String(c[b.dataset.value]))));
      }
      paintChips();
      const nodes = state.kind === 'weapon' ? weaponCards() : armorSets();
      listEl.replaceChildren();
      if (nodes.length) { nodes.forEach((n) => listEl.appendChild(n)); return; }
      listEl.appendChild(emptyFor(c[state.kind] === 0));
    }

    function schedule() {
      if (queued) return;
      queued = true;
      Promise.resolve().then(() => { queued = false; render(); });
    }

    function paintChips() {
      const mk = (label, on, fn) => UI.chip({ label, selected: on, onClick: fn });
      const toggleMode = (m) => { if (state.modes.has(m)) state.modes.delete(m); else state.modes.add(m); render(); };
      const setOwned = (v) => { state.owned = state.owned === v ? 'all' : v; render(); };
      chipsEl.replaceChildren(UI.chipRow([
        mk('PvE', state.modes.has('pve'), () => toggleMode('pve')),
        mk('PvP', state.modes.has('pvp'), () => toggleMode('pvp')),
        mk('Owned', state.owned === 'owned', () => setOwned('owned')),
        mk('Not owned', state.owned === 'missing', () => setOwned('missing'))
      ], { label: 'Filters' }));
    }

    function emptyFor(nothingSaved) {
      const kindName = state.kind === 'weapon' ? 'weapon' : 'armor';
      if (nothingSaved) {
        return UI.emptyState({
          title: `No ${kindName} wishes yet`,
          body: state.kind === 'weapon' ? 'Pick the perks you want on a weapon and Ahamkara Wishes will tell you when you have it.' : 'Choose an archetype for a set and track the rolls you want.',
          actions: [UI.button({ label: '+ Wish', variant: 'primary', onClick: () => ctx.startWish() })]
        });
      }
      return UI.emptyState({
        title: 'Nothing matches',
        body: 'No wishes fit this search and these filters.',
        actions: [UI.button({ label: 'Clear filters', variant: 'secondary', onClick: clearFilters })]
      });
    }

    function clearFilters() {
      state.query = ''; state.modes.clear(); state.owned = 'all';
      const input = search.querySelector('input');
      input.value = ''; input.dispatchEvent(new Event('input'));
    }

    // --- weapons
    function weaponCards() {
      const cards = [];
      entries('weapon')
        .sort((a, b) => text(a[1].static.name, '').localeCompare(text(b[1].static.name, ''), 'en', { sensitivity: 'base' }))
        .forEach(([hash, item]) => {
          if (state.query && !text(item.static.name, '').toLowerCase().includes(state.query)) return;
          const rolls = item.wishes.map((w, index) => ({ w, index })).filter((r) => wishPasses(r.w));
          if (!rolls.length) return;
          cards.push(weaponCard(hash, item, rolls));
        });
      return cards;
    }

    function weaponCard(hash, item, rolls) {
      const owned = rolls.filter((r) => r.w.received).length;
      const typeName = text(item.static.itemTypeDisplayName, 'Weapon');
      return h('article', { class: 'ui-wcard', data: { hash } },
        h('div', { class: 'ui-wcard__head' }, icon(item.static.icon),
          h('div', { class: 'ui-wcard__text' },
            h('div', { class: 'ui-wcard__name' }, text(item.static.name, '(unknown)')),
            h('div', { class: 'ui-wcard__sub' }, `${typeName} · ${plural(item.wishes.length, 'roll', 'rolls')}`)),
          owned ? UI.badge(`${owned} owned`, 'accent') : null),
        rolls.map((r) => rollRow(hash, item, r)));
    }

    function rollRow(hash, item, { w, index }) {
      const mode = tagOf(w);
      const n = ownedCount(w);
      const key = WS.wishKey(w);
      const matched = new Set(Array.isArray(w.matchedPerkHashes) ? w.matchedPerkHashes : []);
      const columns = Array.isArray(w.config && w.config.perkColumns) ? w.config.perkColumns : [];
      const combos = w.comboMatches && typeof w.comboMatches === 'object' ? w.comboMatches : null;

      const chips = combos ? COMBO_COLORS.map((color, slot) => {
        const hits = combos[color];
        return Array.isArray(hits)
          ? h('span', { class: ['ui-combochip', hits.length === 0 && 'is-empty'], data: { combo: slot + 1 }, title: `Combo ${slot + 1}: ${hits.length} owned` }, `${slot + 1}×${hits.length}`)
          : null;
      }).filter(Boolean) : [];

      const more = UI.iconButton({
        label: `Roll actions for ${text(item.static.name, 'this weapon')}, ${mode.toUpperCase()}`,
        icon: UI.ICON.more,
        onClick: (e) => openActions({ hash, index, key, title: text(item.static.name, 'Roll') }, e.currentTarget)
      });

      const perks = h('div', { class: 'ui-roll__perks' });
      columns.forEach((col, i) => {
        if (i > 0) perks.appendChild(h('span', { class: 'ui-perksep', aria: { hidden: true } }));
        perks.appendChild(h('div', { class: 'ui-perkcol' }, (Array.isArray(col) ? col : []).map((p) => perkEl(p, matched))));
      });

      return h('div', { class: ['ui-roll', n && 'is-owned'] },
        h('div', { class: 'ui-roll__head' },
          UI.badge(mode.toUpperCase(), mode),
          n ? UI.badge(`Owned ×${n}`, 'accent') : null,
          chips.length ? h('span', { class: 'ui-combochips' }, chips) : null,
          more),
        perks);
    }

    function perkEl(p, matched) {
      const nums = comboNumbers(p);
      const hit = matched.has(p.hash) || (p.enhancedHash && matched.has(p.enhancedHash));
      const src = D.safeImageUrl(p.icon);
      return h('span', { class: ['ui-perk', hit && 'is-hit'], title: text(p.name, ''), aria: { label: text(p.name, 'Perk') } },
        src ? h('img', { src, alt: '', loading: 'lazy' }) : null,
        nums.length ? h('span', { class: 'ui-perk__combos', aria: { hidden: true } }, nums.map((n) => h('span', { class: 'ui-perk__combo', data: { combo: n } }, String(n)))) : null);
    }

    // --- armor
    function setNameOf(item) {
      const fromTable = item.static.setHash && typeof getArmorSetName === 'function' ? getArmorSetName(item.static.setHash) : null;
      return fromTable || text(item.static.setName, null) || text(item.static.name, '(unknown)');
    }

    function armorSets() {
      const sets = new Map();
      entries('armor').forEach(([hash, item]) => {
        if (state.query) {
          const hay = `${text(item.static.name, '')} ${setNameOf(item)}`.toLowerCase();
          if (!hay.includes(state.query)) return;
        }
        const rolls = item.wishes.map((w, index) => ({ w, index })).filter((r) => wishPasses(r.w));
        if (!rolls.length) return;
        const key = item.static.setHash ? `set-${item.static.setHash}` : `name-${setNameOf(item)}`;
        if (!sets.has(key)) sets.set(key, { key, setHash: item.static.setHash || null, name: setNameOf(item), pieces: [] });
        sets.get(key).pieces.push({ hash, item, rolls });
      });
      return [...sets.values()]
        .sort((a, b) => a.name.localeCompare(b.name, 'en', { sensitivity: 'base' }))
        .map(setCard);
    }

    const SLOT_ORDER = () => (typeof BUCKET_HASHES !== 'undefined'
      ? [BUCKET_HASHES.HELMET, BUCKET_HASHES.GAUNTLETS, BUCKET_HASHES.CHEST, BUCKET_HASHES.LEGS, BUCKET_HASHES.CLASS_ITEM] : []);

    function setCard(set) {
      const order = SLOT_ORDER();
      set.pieces.sort((a, b) => (order.indexOf(a.item.static.bucketHash) - order.indexOf(b.item.static.bucketHash)) || text(a.item.static.name, '').localeCompare(text(b.item.static.name, '')));
      const total = set.pieces.reduce((n, p) => n + p.rolls.length, 0);
      return h('article', { class: 'ui-set', data: { set: set.key } },
        h('div', { class: 'ui-set__head' },
          h('div', { class: 'ui-set__stack' }, set.pieces.slice(0, 5).map((p) => icon(p.item.static.icon))),
          h('div', { class: 'ui-set__text' },
            h('div', { class: 'ui-set__name' }, set.name),
            h('div', { class: 'ui-wcard__sub' }, plural(total, 'wish', 'wishes')))),
        bonusBlock(set),
        set.pieces.map((p) => pieceBlock(p)));
    }

    function pieceBlock({ hash, item, rolls }) {
      const slot = typeof getBucketName === 'function' && item.static.bucketHash ? getBucketName(item.static.bucketHash) : '';
      const cls = CLASS_NAMES[item.static.classType] || '';
      return h('div', { class: 'ui-piece' },
        h('div', { class: 'ui-piece__head' }, icon(item.static.icon),
          h('div', { class: 'ui-wcard__text' },
            h('div', { class: 'ui-wcard__name' }, text(item.static.name, '(unknown)')),
            h('div', { class: 'ui-wcard__sub' }, [cls, slot].filter(Boolean).join(' · ')))),
        rolls.map((r) => armorRoll(hash, item, r)));
    }

    function armorRoll(hash, item, { w, index }) {
      const a = WS.armorFields(w.config);
      const mode = tagOf(w);
      const n = ownedCount(w);
      const stats = archetypeStats(a.archetype);
      const more = UI.iconButton({
        label: `Roll actions for ${text(item.static.name, 'this piece')}, ${mode.toUpperCase()}`,
        icon: UI.ICON.more,
        onClick: (e) => openActions({ hash, index, key: WS.wishKey(w), title: text(item.static.name, 'Roll') }, e.currentTarget)
      });
      return h('div', { class: ['ui-armorroll', n && 'is-owned'] },
        h('div', { class: 'ui-armorroll__head' },
          UI.badge(mode.toUpperCase(), mode),
          h('span', { class: 'ui-archetype' }, text(a.archetype, 'Any archetype')),
          n ? UI.badge(`Owned ×${n}`, 'accent') : null,
          more),
        h('div', { class: 'ui-armorroll__traits' },
          stats.map((s) => h('span', { class: 'ui-stat', data: { stat: s.toLowerCase() } }, s)),
          a.tertiary ? h('span', { class: 'ui-stat', data: { stat: a.tertiary.toLowerCase() }, title: 'Tertiary' }, `+ ${a.tertiary}`) : null,
          a.spark ? h('span', { class: 'ui-spark', title: 'Spark' }, a.spark) : null));
    }

    // --- set bonus (D15): what wearing 2 and 4 pieces does
    function bonusBlock(set) {
      if (!set.setHash || typeof getArmorSetBonuses !== 'function') {
        return h('div', { class: 'ui-bonus ui-bonus--none' }, 'No set bonus');
      }
      const open = !collapsed.has(set.key);
      const cached = bonusCache.get(set.setHash);
      if (cached === undefined) {
        bonusCache.set(set.setHash, 'loading');
        getArmorSetBonuses(set.setHash).then((b) => bonusCache.set(set.setHash, b), () => bonusCache.set(set.setHash, []))
          .then(schedule);
      }
      const bonuses = Array.isArray(cached) ? cached : null;
      if (bonuses && bonuses.length === 0) return h('div', { class: 'ui-bonus ui-bonus--none' }, 'No set bonus');

      const toggle = h('button', {
        type: 'button', class: 'ui-bonus__toggle', aria: { expanded: open },
        on: { click: () => { if (collapsed.has(set.key)) collapsed.delete(set.key); else collapsed.add(set.key); saveCollapsed(collapsed); render(); } }
      }, h('span', null, 'Set bonus'), CARET);
      return h('div', { class: 'ui-bonus' }, toggle,
        open ? (bonuses
          ? bonuses.map((b) => h('div', { class: 'ui-bonus__item' }, b.icon ? icon(b.icon) : null,
            h('div', null,
              h('div', { class: 'ui-bonus__name' }, `${b.name} `, h('span', { class: 'ui-bonus__count' }, `${b.count} pieces`)),
              h('div', { class: 'ui-bonus__desc' }, b.description))))
          : h('div', { class: 'ui-bonus__desc' }, 'Loading…')) : null);
    }

    // --- wiring
    chrome.storage.local.get(['dimData'], (res) => { data = res.dimData || {}; render(); }); // a fresh install has no data yet
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === 'local' && changes.dimData) { data = changes.dimData.newValue || {}; schedule(); }
    });
    doc.addEventListener('awManifestReady', () => { bonusCache.clear(); schedule(); });

    return { el, render };
  }

  root.AWWishes = { create };
})(typeof window !== 'undefined' ? window : globalThis);
