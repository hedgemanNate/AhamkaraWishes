// Ahamkara Wishes — the armor builder (D9, D15).
//
// An armor wish is a set piece plus the stat roll wanted on it:
//   choose    search armor sets by name (for one class)
//   build     the set and its bonus, the pieces to wish for (all selected: you
//             usually want the same roll on the whole set), the archetype
//             (required), the Tertiary and Spark (both optional), PvE/PvP, and a
//             pinned Save that says how many wishes it will make.
//
// The Spark is saved with the wish, but the game data in your inventory doesn't
// show a piece's Spark yet, so it isn't used to match drops. The builder says so
// instead of implying it works.
//
// The rules live in armor-builder-core.js. Editing a saved roll changes that one
// piece only: its piece is fixed, the roll and mode can change.
//
// Needs aw-dom, aw-ui, armor-builder-core, set-bonus, and the game data helpers of
// destiny-manifest.js plus saveItem/editItemWish of manager.js.

(function (root) {
  'use strict';

  const D = root.AWDom, UI = root.AWUI, A = root.AWArmorBuilder, doc = root.document;
  const { h, raw } = D;
  // manager.js and destiny-manifest.js declare these with const: shared by name, not as window properties.
  const BUNGIE = typeof BUNGIE_ROOT !== 'undefined' ? BUNGIE_ROOT : 'https://www.bungie.net';
  const BUCKETS = typeof BUCKET_HASHES !== 'undefined' ? BUCKET_HASHES : {};
  const ARCH = typeof ARCHETYPES !== 'undefined' ? ARCHETYPES : [];
  const STAT_LIST = typeof STATS !== 'undefined' ? STATS : ['Weapons', 'Health', 'Class', 'Grenade', 'Super', 'Melee'];
  const MODE_TOGGLE = [{ value: 'pve', label: 'PvE' }, { value: 'pvp', label: 'PvP' }];
  const CLASS_OPTIONS = [{ value: '0', label: 'Titan' }, { value: '1', label: 'Hunter' }, { value: '2', label: 'Warlock' }];
  const CHEVRON = raw('<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false"><path d="M9 6l6 6-6 6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" fill="none"/></svg>');
  const text = (v, fallback) => (typeof v === 'string' && v.trim() ? v : fallback);
  const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
  const setNameOf = (setHash) => (typeof getArmorSetName === 'function' ? getArmorSetName(setHash) : null);

  function icon(url, className) {
    const src = D.safeImageUrl(url);
    return src ? h('img', { class: className, src, alt: '', loading: 'lazy' }) : h('span', { class: [className, 'ui-itemicon--blank'] });
  }

  // ---- game data -------------------------------------------------------------------------

  const toPiece = (def) => ({
    hash: def.hash, name: (def.displayProperties && def.displayProperties.name) || '',
    icon: def.displayProperties && def.displayProperties.icon ? `${BUNGIE}${def.displayProperties.icon}` : '',
    classType: def.classType, bucketHash: def.inventory && def.inventory.bucketTypeHash,
    setHash: (def.equippingBlock && def.equippingBlock.equipableItemSetHash) || null
  });

  /** Armor named like `query` for a class, plus every other piece of the sets that turned up. */
  async function findPieces(query, classType) {
    await root.ensureInventoryItemDefsReady({ force: false });
    const defs = await root.loadInventoryItemDefsToMemory();
    const index = await root.buildNameIndexIfNeeded();
    const okClass = (def) => def.classType === classType || def.classType === 3;
    const found = new Map(), setHashes = new Set();
    let seen = 0;
    for (const it of index) {
      if (!it.n.includes(query)) continue;
      if (++seen > 400) break;
      const def = defs.get(String(it.h));
      if (!root.isRealArmorDef(def) || !okClass(def)) continue;
      found.set(def.hash, toPiece(def));
      const sh = def.equippingBlock && def.equippingBlock.equipableItemSetHash;
      if (sh && setHashes.size < 40) setHashes.add(sh);
    }
    if (setHashes.size) {
      for (const [, def] of defs.entries()) {
        if (!root.isRealArmorDef(def) || !okClass(def)) continue;
        const sh = def.equippingBlock && def.equippingBlock.equipableItemSetHash;
        if (sh && setHashes.has(sh) && !found.has(def.hash)) found.set(def.hash, toPiece(def));
      }
    }
    return [...found.values()];
  }

  // ===================================================================================================

  function create(ctx) {
    // ===================================================================== choose
    let klass = 0, searchSeq = 0, searchTimer = null, lastQuery = '';
    const results = h('div', { class: 'ui-droplist' });
    const classSeg = UI.segmented({ options: CLASS_OPTIONS, value: String(klass), label: 'Class', onChange: (v) => { klass = Number(v); runSearch(lastQuery); } });
    const search = UI.searchField({ placeholder: 'Search armor sets, e.g. Iron or Techsec', onInput: (q) => { lastQuery = q; clearTimeout(searchTimer); searchTimer = setTimeout(() => runSearch(q), 200); } });
    const pick = ctx.addScreen('armorPick', 'Choose an armor set', () => { const i = search.querySelector('input'); if (i) i.focus(); });
    pick.body.append(classSeg, search, results);
    hint('Type at least two letters of a set’s name.');

    function hint(message) { results.replaceChildren(h('p', { class: 'ui-note ui-pad' }, message)); }

    async function runSearch(query) {
      const seq = ++searchSeq;
      const q = String(query || '').trim().toLowerCase();
      if (q.length < 2) { hint('Type at least two letters of a set’s name.'); return; }
      let sets;
      try {
        sets = A.groupArmorSets(await findPieces(q, klass), { buckets: BUCKETS, setNameOf });
      } catch (e) { console.warn('[ArmorBuilder] search failed', e); hint('Search isn’t available yet. Game data may still be downloading.'); return; }
      if (seq !== searchSeq) return;
      if (!sets.length) { hint(`No ${A.CLASS_NAMES[klass]} armor found for “${query.trim()}”.`); return; }
      results.replaceChildren(...sets.map((set) => {
        const first = A.SLOTS.map((k) => set.pieces[k]).filter(Boolean);
        return h('button', {
          type: 'button', class: 'ui-itemrow', aria: { label: `${set.name}, ${plural(set.count, 'piece', 'pieces')}` },
          on: { click: (e) => openBuild({ set, classType: klass }, e.currentTarget) }
        },
        h('span', { class: 'ui-itemrow__stack' }, first.slice(0, 3).map((p) => icon(p.icon, 'ui-itemicon'))),
        h('span', { class: 'ui-itemrow__text' },
          h('span', { class: 'ui-itemrow__name' }, set.name),
          h('span', { class: 'ui-itemrow__sub' }, `${A.CLASS_NAMES[klass]} · ${plural(set.count, 'piece', 'pieces')}`)),
        h('span', { class: 'ui-itemrow__end' }, CHEVRON));
      }));
    }

    // ===================================================================== build
    const empty = () => ({
      session: 0, set: null, edit: null, selected: new Set(), pick: { archetype: null, tertiary: null, spark: null },
      mode: 'pve', baseline: '', saving: false
    });
    let s = empty();
    let refs = {};

    const build = ctx.addScreen('armorBuild', 'New wish', null, {
      canClose: () => {
        if (!dirty()) return true;
        UI.confirm({ title: 'Discard this wish?', body: 'What you chose hasn’t been saved.', confirmLabel: 'Discard', cancelLabel: 'Keep editing', danger: true })
          .then((ok) => { if (ok) ctx.nav.close('armorBuild', { force: true }); });
        return false;
      },
      onClose: () => { s.session++; }
    });
    build.el.classList.add('ui-builder');

    const snapshot = () => JSON.stringify([[...s.selected].sort(), s.pick, s.mode]);
    const dirty = () => !!s.set && !s.saving && snapshot() !== s.baseline;
    const chosenPieces = () => A.SLOTS.filter((k) => s.selected.has(k) && s.set.pieces[k]).map((k) => s.set.pieces[k]);

    /** req: { set, classType } for a new wish, or { set, edit:{hash,index,key,pick,mode}, ... } to edit one roll. */
    function openBuild(req, trigger) {
      const prevMode = s.mode;
      s = Object.assign(empty(), { session: s.session + 1, set: req.set, edit: req.edit || null, mode: req.edit ? req.edit.mode : prevMode });
      s.pick = A.normalizePick(req.edit ? req.edit.pick : req.pick, ARCH, STAT_LIST);
      s.selected = new Set(req.selected || (req.edit ? [Object.keys(req.set.pieces)[0]] : Object.keys(req.set.pieces)));
      s.baseline = req.pick && !req.edit ? '' : snapshot(); // a roll started from an owned piece counts as unsaved
      build.setTitle(s.edit ? 'Edit roll' : 'New wish');
      render();
      ctx.nav.open('armorBuild', {}, { returnFocus: trigger });
    }

    function render() {
      refs = { slots: new Map(), arch: new Map(), tert: new Map(), spark: new Map() };
      const set = s.set, pieces = A.SLOTS.map((k) => set.pieces[k] && { slot: k, piece: set.pieces[k] }).filter(Boolean);
      const mode = UI.segmented({ options: MODE_TOGGLE, value: s.mode, label: 'Game mode', onChange: (v) => { s.mode = v; paint(); } });

      refs.pieces = h('div', { class: 'ui-slots', style: { '--ui-slot-count': String(pieces.length) } }, pieces.map(({ slot, piece }) => {
        const b = h('button', { type: 'button', class: 'ui-slot', data: { slot }, disabled: !!s.edit, on: { click: () => toggle(slot) } },
          icon(piece.icon, 'ui-slot__img'), h('span', { class: 'ui-slot__label' }, A.SLOT_LABEL[slot]));
        refs.slots.set(slot, b);
        return b;
      }));
      refs.all = pieces.length > 1 && !s.edit ? UI.button({ label: 'Select all', variant: 'ghost' }) : null; // wired in paint()

      refs.archGrid = h('div', { class: 'ui-archgrid', role: 'group', aria: { label: 'Archetype' } }, ARCH.map((a) => {
        const b = h('button', { type: 'button', class: 'ui-arch', data: { arch: a.name }, on: { click: () => choose('archetype', a.name) } },
          h('span', { class: 'ui-arch__name' }, a.name), h('span', { class: 'ui-arch__stats' }, a.stats.join(' · ')));
        refs.arch.set(a.name, b);
        return b;
      }));
      const chips = (field, map) => STAT_LIST.map((stat) => {
        const b = h('button', { type: 'button', class: 'ui-chip ui-statchip', data: { stat: stat.toLowerCase() }, on: { click: () => { if (b.getAttribute('aria-disabled') !== 'true') choose(field, stat); } } },
          h('span', { class: 'ui-statchip__dot', aria: { hidden: true } }), h('span', null, stat));
        map.set(stat, b);
        return b;
      });
      refs.tertNote = h('p', { class: 'ui-note' });
      refs.summary = h('span', { class: 'ui-builder__summary' });
      refs.actions = h('div', { class: 'ui-builder__actions' });

      build.body.replaceChildren(
        h('div', { class: 'ui-detailhead' },
          h('span', { class: 'ui-itemrow__stack' }, A.SLOTS.map((k) => set.pieces[k]).filter(Boolean).slice(0, 3).map((p) => icon(p.icon, 'ui-itemicon ui-itemicon--lg'))),
          h('div', null, h('div', { class: 'ui-detailhead__name' }, set.name),
            h('div', { class: 'ui-detailhead__sub' }, `${A.CLASS_NAMES[(Object.values(set.pieces)[0] || {}).classType] || 'Armor'}${s.edit ? '' : ` · ${plural(pieces.length, 'piece', 'pieces')}`}`))),
        root.AWSetBonus.block(set.setHash, { fold: true }),
        mode,
        h('div', { class: 'ui-fieldblock' },
          h('div', { class: 'ui-fieldblock__head' }, h('div', { class: 'ui-sectiontitle' }, s.edit ? 'Piece' : 'Pieces to wish for'), refs.all),
          refs.pieces),
        h('div', { class: 'ui-fieldblock' },
          h('div', { class: 'ui-sectiontitle' }, 'Archetype'),
          h('p', { class: 'ui-note' }, 'The two stats the piece rolls highest. Required.'),
          refs.archGrid),
        h('div', { class: 'ui-fieldblock' },
          h('div', { class: 'ui-sectiontitle' }, 'Tertiary (optional)'),
          h('p', { class: 'ui-note' }, 'The third-highest stat. Leave empty to accept any.'),
          h('div', { class: 'ui-chip-wrap', role: 'group', aria: { label: 'Tertiary stat' } }, chips('tertiary', refs.tert)), refs.tertNote),
        h('div', { class: 'ui-fieldblock' },
          h('div', { class: 'ui-sectiontitle' }, 'Spark (optional)'),
          h('p', { class: 'ui-note' }, 'The stat a tuned piece raises. Saved with your wish. Ahamkara Wishes can’t see a piece’s Spark yet, so it isn’t used to match drops.'),
          h('div', { class: 'ui-chip-wrap', role: 'group', aria: { label: 'Spark stat' } }, chips('spark', refs.spark))),
        h('div', { class: 'ui-builder__foot' }, refs.summary, refs.actions));
      paint();
    }

    function toggle(slot) {
      if (s.edit) return;
      if (s.selected.has(slot)) s.selected.delete(slot); else s.selected.add(slot);
      paint();
    }

    /** A stat or archetype tap: tapping the chosen one again clears the optional ones. */
    function choose(field, value) {
      const p = Object.assign({}, s.pick);
      if (field === 'archetype') p.archetype = value;
      else if (p[field] === value) p[field] = null;
      else p[field] = value;
      const before = s.pick.tertiary;
      s.pick = A.normalizePick(p, ARCH, STAT_LIST);
      s.droppedTertiary = field === 'archetype' && before && !s.pick.tertiary ? before : null;
      paint();
    }

    function paint() {
      if (!s.set) return;
      const pieces = A.SLOTS.filter((k) => s.set.pieces[k]);
      refs.slots.forEach((b, slot) => { const on = s.selected.has(slot); b.classList.toggle('is-picked', on); b.setAttribute('aria-pressed', String(on)); });
      if (refs.all) {
        const every = pieces.every((k) => s.selected.has(k));
        refs.all.querySelector('.ui-btn__label').textContent = every ? 'Clear' : 'Select all';
        refs.all.onclick = () => { s.selected = every ? new Set() : new Set(pieces); paint(); };
      }
      refs.arch.forEach((b, name) => { const on = s.pick.archetype === name; b.classList.toggle('is-picked', on); b.setAttribute('aria-pressed', String(on)); });
      const free = A.tertiaryChoices(ARCH, STAT_LIST, s.pick.archetype);
      refs.tert.forEach((b, stat) => {
        const off = !free.includes(stat), on = s.pick.tertiary === stat;
        b.classList.toggle('is-selected', on); b.classList.toggle('is-unavailable', off);
        b.setAttribute('aria-pressed', String(on)); b.setAttribute('aria-disabled', String(off));
        b.title = off ? `Already part of ${s.pick.archetype}` : '';
      });
      refs.tertNote.textContent = s.droppedTertiary
        ? `${s.droppedTertiary} is part of ${s.pick.archetype}, so it was cleared.`
        : (s.pick.archetype ? `${s.pick.archetype} already covers ${ARCH.find((a) => a.name === s.pick.archetype).stats.join(' and ')}.` : '');
      refs.spark.forEach((b, stat) => { const on = s.pick.spark === stat; b.classList.toggle('is-selected', on); b.setAttribute('aria-pressed', String(on)); });

      const count = chosenPieces().length, why = A.missing(count, s.pick);
      const roll = s.pick.archetype ? [s.pick.archetype, s.pick.tertiary ? `+ ${s.pick.tertiary}` : null, s.pick.spark ? `✦ ${s.pick.spark}` : null].filter(Boolean).join(' ') : '';
      refs.summary.textContent = why || `${plural(count, 'piece', 'pieces')} · ${roll}`;
      const blocked = !!why || s.saving;
      refs.actions.replaceChildren(...[
        UI.button({ label: A.saveLabel(count, !!s.edit), variant: 'primary', disabled: blocked, onClick: () => save(!!s.edit) }),
        s.edit ? UI.button({ label: 'Save as new', variant: 'secondary', disabled: blocked, onClick: () => save(false) }) : null].filter(Boolean));
    }

    // --- saving
    async function save(overwrite) {
      const pieces = chosenPieces();
      if (!s.set || A.missing(pieces.length, s.pick) || s.saving) return;
      s.saving = true; paint();
      const setName = setNameOf(s.set.setHash) || s.set.name;
      try {
        if (overwrite && s.edit) {
          const e = s.edit;
          const { result } = await root.editItemWish(e.hash, e.index, `armor-wish:${e.hash}`, A.configFor(s.pick), s.mode, e.key);
          s.saving = false;
          if (result === 'duplicate') { ctx.toast('Another roll already has exactly this.'); paint(); return; }
          ctx.nav.close('armorBuild', { force: true });
          ctx.toast(result === 'missing' ? 'That roll was deleted, so nothing was changed.' : 'Roll updated.');
          return;
        }
        const outcome = { added: 0, duplicate: 0, failed: 0 };
        for (const p of A.planSaves(pieces, s.pick, { buckets: BUCKETS, setName })) {
          try {
            // Season reissues give one piece several manifest hashes; capture them so owned copies match under any.
            const linked = await root.findArmorSiblingHashes(p.hash).catch(() => []);
            const status = await root.saveItem(p.hash, p.name, 'armor', p.rawString, p.rawString, p.config, s.mode, p.icon,
              p.classType, p.bucketHash, p.slotName, p.setName, p.setHash, linked);
            if (status === 'added') outcome.added++; else outcome.duplicate++;
          } catch (e) { console.warn('[ArmorBuilder] save failed for', p.name, e); outcome.failed++; }
        }
        s.saving = false;
        const message = A.saveSummary(outcome);
        if (!outcome.added) { ctx.toast(message); paint(); return; }
        ctx.nav.close('armorBuild', { force: true });
        if (ctx.nav.isOpen('armorPick')) ctx.nav.close('armorPick', { force: true });
        ctx.toast(message, { action: { label: 'Add another', onClick: () => start() } });
      } catch (e) {
        console.warn('[ArmorBuilder] save failed', e);
        s.saving = false; paint();
        ctx.toast('Couldn’t save that. Please try again.');
      }
    }

    // ===================================================================== entry points
    function start(trigger) {
      searchSeq++;
      const input = search.querySelector('input');
      if (input) { input.value = ''; input.dispatchEvent(new Event('input')); }
      hint('Type at least two letters of a set’s name.');
      ctx.nav.open('armorPick', {}, { returnFocus: trigger });
    }

    /** Edit one saved roll. `p` = { hash, index, key, item, wish }. */
    function edit(p, trigger) {
      const st = (p.item && p.item.static) || {};
      const slot = st.slotName || A.slotOf(st.bucketHash, BUCKETS);
      if (!slot) { ctx.toast('Couldn’t open that piece.'); return; }
      const piece = { hash: Number(p.hash) || p.hash, name: st.name || '', icon: st.icon || '', classType: st.classType, bucketHash: st.bucketHash, setHash: st.setHash || null };
      const fields = root.WishlistSync.armorFields(p.wish && p.wish.config);
      openBuild({
        set: { key: 'edit', setHash: piece.setHash, name: setNameOf(piece.setHash) || text(st.setName, null) || text(st.name, 'Armor'), pieces: { [slot]: piece }, count: 1 },
        selected: [slot],
        edit: { hash: p.hash, index: p.index, key: p.key, pick: fields, mode: p.wish && p.wish.tags && p.wish.tags[0] === 'pvp' ? 'pvp' : 'pve' }
      }, trigger);
    }

    /** A new wish starting from an owned piece: { hash, archetype, tertiary } (Inventory). */
    async function fromOwned(o, trigger) {
      const defs = await root.loadInventoryItemDefsToMemory();
      const def = defs.get(String(o.hash));
      if (!def || !root.isRealArmorDef(def)) { ctx.toast('Couldn’t open that piece.'); return; }
      const all = await findPieces((def.displayProperties.name || '').toLowerCase(), def.classType === 3 ? 0 : def.classType);
      const sets = A.groupArmorSets(all, { buckets: BUCKETS, setNameOf });
      const piece = toPiece(def), slot = A.slotOf(piece.bucketHash, BUCKETS);
      const set = sets.find((x) => x.setHash === piece.setHash && x.pieces[slot]) || sets.find((x) => x.pieces[slot] && x.pieces[slot].hash === piece.hash);
      if (!set || !slot) { ctx.toast('Couldn’t open that piece.'); return; }
      openBuild({ set, selected: [slot], pick: { archetype: o.archetype, tertiary: o.tertiary } }, trigger);
    }

    return { start, edit, fromOwned };
  }

  root.AWArmorBuilderScreen = { create };
})(typeof window !== 'undefined' ? window : globalThis);
