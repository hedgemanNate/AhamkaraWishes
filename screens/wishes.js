// Ahamkara Wishes — the Wishes screen.
//
// A companion to Godroll.tv and DIM: most rolls are chosen there and arrive
// here, where they are refined (colour-coded perk pairings) and tracked. So the
// list is calm: ONE ROW per weapon or armor set (icon, name, how many rolls,
// how many owned). Tap a row for the roomy detail screen, where the perks are
// large and named and each roll can be edited.
//
//   list     Weapons | Armor, search, one filter button (PvE/PvP, owned)
//   detail   a weapon's rolls, or an armor set's bonus and pieces (D15)
//
// Reads the list straight from storage (the same data as the classic screens)
// and draws it with AWDom, so wishlist text from other people stays text.
//
// Needs aw-dom, aw-store, aw-ui and wishlist-sync-core; set data and the
// archetype table come from destiny-manifest.js and manager.js when loaded.

(function (root) {
  'use strict';

  const D = root.AWDom, UI = root.AWUI, doc = root.document;
  const { h } = D;
  const WS = root.WishlistSync;
  const COMBO_COLORS = ['red', 'blue', 'green', 'orange'];
  const CLASS_NAMES = { 0: 'Titan', 1: 'Hunter', 2: 'Warlock' };

  // ---- small helpers -----------------------------------------------------------------

  const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
  const text = (v, fallback) => (typeof v === 'string' && v.trim() ? v : fallback);
  const tagOf = (w) => (w && w.tags && w.tags[0] === 'pvp' ? 'pvp' : 'pve');
  const ownedCount = (w) => (w && w.received ? Math.max(1, (w.receivedInstances || []).length) : 0);
  const byName = (a, b) => a.localeCompare(b, 'en', { sensitivity: 'base' });

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
    const state = { kind: 'weapon', query: '', modes: new Set(), owned: new Set() };
    let data = null;              // dimData, kept current from storage
    let queued = false;
    let detail = null;            // { kind: 'weapon', hash } | { kind: 'armor', key }
    const bonusCache = new Map(); // setHash -> bonuses | 'loading'

    // --- list controls
    const seg = UI.segmented({
      label: 'Show', value: state.kind,
      options: [{ value: 'weapon', label: 'Weapons' }, { value: 'armor', label: 'Armor' }],
      onChange: (v) => { state.kind = v; render(); }
    });
    const search = UI.searchField({ label: 'Search wishes', placeholder: 'Search by name', onInput: (v) => { state.query = v.trim().toLowerCase(); render(); } });
    const filterBtn = UI.iconButton({ label: 'Filters', icon: UI.ICON.filter, className: 'ui-filterbtn', onClick: (e) => ctx.nav.open('filters', {}, { returnFocus: e.currentTarget }) });
    const listEl = h('div', { class: 'ui-cardlist' });
    const top = h('div', { class: 'ui-stickytop' }, seg, h('div', { class: 'ui-searchrow' }, search, filterBtn));
    const el = h('div', { class: 'ui-wishes' }, top, listEl);

    // --- filters (one sheet instead of a row of chips)
    const filters = ctx.addSheet('filters', 'Filter wishes', () => fillFilters(), { footer: true });
    function activeFilterCount() { return state.modes.size + state.owned.size; }
    function fillFilters() {
      const f = UI.filterSheetBody({
        sections: [
          { key: 'modes', title: 'Mode', options: [{ value: 'pve', label: 'PvE' }, { value: 'pvp', label: 'PvP' }] },
          { key: 'owned', title: 'Ownership', options: [{ value: 'owned', label: 'Owned' }, { value: 'missing', label: 'Not owned' }] }
        ],
        selected: { modes: state.modes, owned: state.owned },
        noun: ['wish', 'wishes'],
        count: (sel) => countWishes(state.kind, sel.modes, sel.owned),
        onApply: (sel) => { state.modes = new Set(sel.modes); state.owned = new Set(sel.owned); ctx.nav.close('filters'); render(); },
        onReset: () => {}
      });
      filters.querySelector('.ui-sheet__body').replaceChildren(f.body);
      filters.querySelector('.ui-sheet__footslot').replaceChildren(...f.footer);
    }

    // --- roll actions (Edit / Delete), shared by every roll
    const actions = ctx.addSheet('rollActions', 'Roll', () => fillActions(actions._params));
    function openActions(params, trigger) { actions._params = params; ctx.nav.open('rollActions', params, { returnFocus: trigger }); }
    function fillActions(p) {
      if (!p) return;
      actions.setTitle(p.title);
      actions.querySelector('.ui-sheet__body').replaceChildren(h('div', { class: 'ui-sheetlist' },
        UI.row({ title: 'Edit roll', subtitle: 'Change the perks or stats', onClick: () => { ctx.nav.close('rollActions'); ctx.editWish(p); } }),
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

    // --- detail screen
    const screen = ctx.addScreen('wishDetail', 'Wish', () => renderDetail());
    function openDetail(ref, trigger) { detail = ref; ctx.nav.open('wishDetail', ref, { returnFocus: trigger }); }

    // --- data
    function activeItems() {
      const lists = (data && data.lists) || {};
      const list = lists[data && data.activeId] || lists.default || lists[Object.keys(lists)[0]];
      return (list && list.items) || {};
    }

    function passes(w, modes, owned) {
      if (modes.size && !modes.has(tagOf(w))) return false;
      if (owned.size) {
        const isOwned = !!w.received;
        if (!((owned.has('owned') && isOwned) || (owned.has('missing') && !isOwned))) return false;
      }
      return true;
    }

    function entries(kind) {
      return Object.entries(activeItems()).filter(([, it]) => it && it.static && it.static.type === kind && Array.isArray(it.wishes));
    }

    function countWishes(kind, modes, owned) {
      return entries(kind).reduce((n, [, it]) => n + it.wishes.filter((w) => passes(w, modes, owned)).length, 0);
    }

    // --- list rendering
    function render() {
      if (!data) return;
      const total = (k) => entries(k).reduce((n, [, it]) => n + it.wishes.length, 0);
      const c = { weapon: total('weapon'), armor: total('armor') };
      seg.querySelectorAll('.ui-seg__opt').forEach((b) => {
        let badge = b.querySelector('.ui-seg__badge');
        if (!badge) { badge = h('span', { class: 'ui-seg__badge' }); b.appendChild(badge); }
        badge.textContent = String(c[b.dataset.value]);
      });
      const n = activeFilterCount();
      filterBtn.classList.toggle('is-active', n > 0);
      filterBtn.querySelector('.ui-filterbtn__count')?.remove();
      if (n) filterBtn.appendChild(h('span', { class: 'ui-filterbtn__count', aria: { hidden: true } }, String(n)));
      filterBtn.setAttribute('aria-label', n ? `Filters, ${n} on` : 'Filters');

      const rows = state.kind === 'weapon' ? weaponRows() : armorRows();
      listEl.replaceChildren();
      if (rows.length) rows.forEach((r) => listEl.appendChild(r)); else listEl.appendChild(emptyFor(c[state.kind] === 0));
      if (ctx.nav.isOpen('wishDetail')) renderDetail();
    }

    function schedule() {
      if (queued) return;
      queued = true;
      Promise.resolve().then(() => { queued = false; render(); });
    }

    function emptyFor(nothingSaved) {
      const kindName = state.kind === 'weapon' ? 'weapon' : 'armor';
      if (nothingSaved) {
        return UI.emptyState({
          title: `No ${kindName} wishes yet`,
          body: state.kind === 'weapon'
            ? 'Add a roll from Godroll.tv, or build one here, and Ahamkara Wishes will tell you when it drops.'
            : 'Choose an archetype for a set and track the rolls you want.',
          actions: [UI.button({ label: '+ Wish', variant: 'primary', onClick: () => ctx.startWish(state.kind) })]
        });
      }
      return UI.emptyState({
        title: 'Nothing matches',
        body: 'No wishes fit this search and these filters.',
        actions: [UI.button({ label: 'Clear filters', variant: 'secondary', onClick: clearFilters })]
      });
    }

    function clearFilters() {
      state.modes = new Set(); state.owned = new Set();
      const input = search.querySelector('input');
      input.value = ''; input.dispatchEvent(new Event('input', { bubbles: true }));
    }

    const CHEVRON = UI.ICON.chevron;
    function itemRow({ lead, name, sub, ownedN, onClick, label }) {
      return h('button', { type: 'button', class: 'ui-itemrow', aria: { label }, on: { click: onClick } },
        lead,
        h('span', { class: 'ui-itemrow__text' },
          h('span', { class: 'ui-itemrow__name' }, name),
          h('span', { class: 'ui-itemrow__sub' }, sub),
          ownedN ? h('span', { class: 'ui-itemrow__owned' }, `${ownedN} owned`) : null),
        h('span', { class: 'ui-itemrow__end' }, CHEVRON));
    }

    function weaponRows() {
      return entries('weapon')
        .sort((a, b) => byName(text(a[1].static.name, ''), text(b[1].static.name, '')))
        .filter(([, item]) => !state.query || text(item.static.name, '').toLowerCase().includes(state.query))
        .filter(([, item]) => item.wishes.some((w) => passes(w, state.modes, state.owned)))
        .map(([hash, item]) => {
          const own = item.wishes.filter((w) => w.received).length;
          const name = text(item.static.name, '(unknown)');
          const sub = `${text(item.static.itemTypeDisplayName, 'Weapon')} · ${plural(item.wishes.length, 'roll', 'rolls')}`;
          return itemRow({
            lead: icon(item.static.icon, 'ui-itemicon ui-itemicon--lg'), name, sub, ownedN: own,
            label: `${name}, ${sub}${own ? `, ${own} owned` : ''}`,
            onClick: (e) => openDetail({ kind: 'weapon', hash }, e.currentTarget)
          });
        });
    }

    // --- armor sets
    function setNameOf(item) {
      const fromTable = item.static.setHash && typeof getArmorSetName === 'function' ? getArmorSetName(item.static.setHash) : null;
      return fromTable || text(item.static.setName, null) || text(item.static.name, '(unknown)');
    }

    /** Armor grouped by set. `keep(wish)` filters rolls (the list); the detail keeps all. */
    function buildSets(keep, query) {
      const sets = new Map();
      entries('armor').forEach(([hash, item]) => {
        if (query && !`${text(item.static.name, '')} ${setNameOf(item)}`.toLowerCase().includes(query)) return;
        const rolls = item.wishes.map((w, index) => ({ w, index })).filter((r) => keep(r.w));
        if (!rolls.length) return;
        const key = item.static.setHash ? `set-${item.static.setHash}` : `name-${setNameOf(item)}`;
        if (!sets.has(key)) sets.set(key, { key, setHash: item.static.setHash || null, name: setNameOf(item), pieces: [] });
        sets.get(key).pieces.push({ hash, item, rolls });
      });
      const order = typeof BUCKET_HASHES !== 'undefined'
        ? [BUCKET_HASHES.HELMET, BUCKET_HASHES.GAUNTLETS, BUCKET_HASHES.CHEST, BUCKET_HASHES.LEGS, BUCKET_HASHES.CLASS_ITEM] : [];
      sets.forEach((s) => s.pieces.sort((a, b) => (order.indexOf(a.item.static.bucketHash) - order.indexOf(b.item.static.bucketHash)) || byName(text(a.item.static.name, ''), text(b.item.static.name, ''))));
      return [...sets.values()].sort((a, b) => byName(a.name, b.name));
    }

    function armorRows() {
      return buildSets((w) => passes(w, state.modes, state.owned), state.query).map((set) => {
        const total = set.pieces.reduce((n, p) => n + p.item.wishes.length, 0);
        const own = set.pieces.reduce((n, p) => n + p.item.wishes.filter((w) => w.received).length, 0);
        const sub = `${plural(total, 'wish', 'wishes')} · ${plural(set.pieces.length, 'piece', 'pieces')}`;
        return itemRow({
          lead: h('span', { class: 'ui-itemrow__stack' }, set.pieces.slice(0, 3).map((p) => icon(p.item.static.icon))),
          name: set.name, sub, ownedN: own,
          label: `${set.name}, ${sub}${own ? `, ${own} owned` : ''}`,
          onClick: (e) => openDetail({ kind: 'armor', key: set.key }, e.currentTarget)
        });
      });
    }

    // --- detail screen
    function renderDetail() {
      if (!detail || !data) return;
      const body = screen.body;
      if (detail.kind === 'weapon') {
        const item = activeItems()[detail.hash];
        if (!item) { ctx.nav.close('wishDetail'); return; }
        screen.setTitle(text(item.static.name, 'Weapon'));
        body.replaceChildren(...weaponDetail(detail.hash, item));
      } else {
        const set = buildSets(() => true, '').find((s) => s.key === detail.key);
        if (!set) { ctx.nav.close('wishDetail'); return; }
        screen.setTitle(set.name);
        body.replaceChildren(...armorDetail(set));
      }
    }

    function detailHead(lead, name, sub) {
      return h('div', { class: 'ui-detailhead' }, lead,
        h('div', null, h('div', { class: 'ui-detailhead__name' }, name), h('div', { class: 'ui-detailhead__sub' }, sub)));
    }

    function weaponDetail(hash, item) {
      const own = item.wishes.filter((w) => w.received).length;
      const sub = [text(item.static.itemTypeDisplayName, 'Weapon'), plural(item.wishes.length, 'roll', 'rolls'), own ? `${own} owned` : null].filter(Boolean).join(' · ');
      return [
        detailHead(icon(item.static.icon, 'ui-itemicon ui-itemicon--lg'), text(item.static.name, '(unknown)'), sub),
        ...item.wishes.map((w, index) => weaponRollCard(hash, item, w, index))
      ];
    }

    function weaponRollCard(hash, item, w, index) {
      const mode = tagOf(w), n = ownedCount(w);
      const matched = new Set(Array.isArray(w.matchedPerkHashes) ? w.matchedPerkHashes : []);
      const columns = Array.isArray(w.config && w.config.perkColumns) ? w.config.perkColumns : [];
      const combos = w.comboMatches && typeof w.comboMatches === 'object' ? w.comboMatches : null;
      const chips = combos ? COMBO_COLORS.map((color, slot) => {
        const hits = combos[color];
        return Array.isArray(hits)
          ? h('span', { class: ['ui-combochip', hits.length === 0 && 'is-empty'], data: { combo: slot + 1 }, title: `Combo ${slot + 1}: ${hits.length} owned` }, `${slot + 1}×${hits.length}`)
          : null;
      }).filter(Boolean) : [];
      const params = { kind: 'weapon', hash, index, key: WS.wishKey(w), title: text(item.static.name, 'Roll'), item, wish: w };
      return h('article', { class: ['ui-rollcard', n && 'is-owned'], data: { index } },
        h('div', { class: 'ui-rollcard__head' },
          UI.badge(mode.toUpperCase(), mode),
          n ? UI.badge(`Owned ×${n}`, 'accent') : null,
          chips.length ? h('span', { class: 'ui-combochips' }, chips) : null,
          UI.iconButton({ label: `Roll actions, ${mode.toUpperCase()}`, icon: UI.ICON.more, onClick: (e) => openActions(params, e.currentTarget) })),
        h('div', { class: 'ui-perkgrid' }, columns.map((col) => h('div', { class: 'ui-perkgroup' }, (Array.isArray(col) ? col : []).map((p) => perkLarge(p, matched))))),
        h('div', { class: 'ui-rollcard__foot' }, UI.button({ label: 'Edit roll', variant: 'secondary', onClick: (e) => ctx.editWish(params, e.currentTarget) })));
    }

    function perkLarge(p, matched) {
      const nums = comboNumbers(p);
      const hit = matched.has(p.hash) || (p.enhancedHash && matched.has(p.enhancedHash));
      const src = D.safeImageUrl(p.icon);
      return h('div', { class: 'ui-perkl' },
        h('span', { class: ['ui-perk', hit && 'is-hit'], role: 'img', aria: { label: text(p.name, 'Perk') } },
          src ? h('img', { src, alt: '', loading: 'lazy' }) : null,
          nums.length ? h('span', { class: 'ui-perk__combos', aria: { hidden: true } }, nums.map((n) => h('span', { class: 'ui-perk__combo', data: { combo: n } }, String(n)))) : null),
        h('span', { class: 'ui-perkl__name' }, text(p.name, '')));
    }

    function armorDetail(set) {
      const total = set.pieces.reduce((n, p) => n + p.item.wishes.length, 0);
      const out = [
        detailHead(h('span', { class: 'ui-itemrow__stack' }, set.pieces.slice(0, 3).map((p) => icon(p.item.static.icon))), set.name, plural(total, 'wish', 'wishes')),
        bonusBlock(set)
      ];
      set.pieces.forEach(({ hash, item, rolls }) => {
        const slot = typeof getBucketName === 'function' && item.static.bucketHash ? getBucketName(item.static.bucketHash) : '';
        const cls = CLASS_NAMES[item.static.classType] || '';
        out.push(h('section', { class: 'ui-piece' },
          h('div', { class: 'ui-piece__head' }, icon(item.static.icon, 'ui-itemicon ui-itemicon--lg'),
            h('div', null, h('div', { class: 'ui-piece__name' }, text(item.static.name, '(unknown)')), h('div', { class: 'ui-detailhead__sub' }, [cls, slot].filter(Boolean).join(' · ')))),
          rolls.map((r) => armorRollCard(hash, item, r))));
      });
      return out;
    }

    function armorRollCard(hash, item, { w, index }) {
      const a = WS.armorFields(w.config);
      const mode = tagOf(w), n = ownedCount(w);
      const stats = archetypeStats(a.archetype);
      const params = { kind: 'armor', hash, index, key: WS.wishKey(w), title: text(item.static.name, 'Roll'), item, wish: w };
      return h('article', { class: ['ui-rollcard', n && 'is-owned'], data: { index } },
        h('div', { class: 'ui-rollcard__head' },
          UI.badge(mode.toUpperCase(), mode),
          h('span', { class: 'ui-archetype' }, text(a.archetype, 'Any archetype')),
          n ? UI.badge(`Owned ×${n}`, 'accent') : null,
          UI.iconButton({ label: `Roll actions, ${mode.toUpperCase()}`, icon: UI.ICON.more, onClick: (e) => openActions(params, e.currentTarget) })),
        h('div', { class: 'ui-traits' },
          stats.map((s) => h('span', { class: 'ui-stat', data: { stat: s.toLowerCase() } }, s)),
          a.tertiary ? h('span', { class: 'ui-stat', data: { stat: a.tertiary.toLowerCase() }, title: 'Tertiary' }, `+ ${a.tertiary}`) : null,
          a.spark ? h('span', { class: 'ui-spark', title: 'Spark' }, a.spark) : null),
        h('div', { class: 'ui-rollcard__foot' }, UI.button({ label: 'Edit roll', variant: 'secondary', onClick: (e) => ctx.editWish(params, e.currentTarget) })));
    }

    // --- set bonus (D15): what wearing 2 and 4 pieces does
    function bonusBlock(set) {
      const none = () => h('div', { class: 'ui-bonus ui-bonus--none' }, 'No set bonus');
      if (!set.setHash || typeof getArmorSetBonuses !== 'function') return none();
      const cached = bonusCache.get(set.setHash);
      if (cached === undefined) {
        bonusCache.set(set.setHash, 'loading');
        getArmorSetBonuses(set.setHash).then((b) => bonusCache.set(set.setHash, b), () => bonusCache.set(set.setHash, [])).then(schedule);
      }
      if (Array.isArray(cached) && cached.length === 0) return none();
      return h('div', { class: 'ui-bonus' }, h('div', { class: 'ui-bonus__title' }, 'Set bonus'),
        Array.isArray(cached)
          ? cached.map((b) => h('div', { class: 'ui-bonus__item' }, b.icon ? icon(b.icon) : null,
            h('div', null,
              h('div', { class: 'ui-bonus__name' }, `${b.name} `, h('span', { class: 'ui-bonus__count' }, `${b.count} pieces`)),
              h('div', { class: 'ui-bonus__desc' }, b.description))))
          : h('div', { class: 'ui-bonus__desc' }, 'Loading…'));
    }

    // --- wiring
    chrome.storage.local.get(['dimData'], (res) => { data = res.dimData || {}; render(); }); // a fresh install has no data yet
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === 'local' && changes.dimData) { data = changes.dimData.newValue || {}; schedule(); }
    });
    doc.addEventListener('awManifestReady', () => { bonusCache.clear(); schedule(); });

    /**
     * Opens the detail for an item (from a Drop). Resolves false when it isn't in
     * the active list, so the caller can say so.
     */
    function openItem(hash, trigger) {
      const item = data && activeItems()[hash];
      if (!item || !item.static) return false;
      state.kind = item.static.type === 'armor' ? 'armor' : 'weapon';
      seg.setValue(state.kind);
      render();
      if (state.kind === 'weapon') { openDetail({ kind: 'weapon', hash }, trigger); return true; }
      const set = buildSets(() => true, '').find((x) => x.pieces.some((p) => p.hash === String(hash)));
      if (!set) return false;
      openDetail({ kind: 'armor', key: set.key }, trigger);
      return true;
    }

    return { el, render, openItem };
  }

  root.AWWishes = { create };
})(typeof window !== 'undefined' ? window : globalThis);
