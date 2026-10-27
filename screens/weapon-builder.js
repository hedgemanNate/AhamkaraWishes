// Ahamkara Wishes — the weapon builder (D4, D14).
//
// Most rolls are chosen on Godroll.tv or in DIM and arrive here to be REFINED:
// which perks, and which of them belong together (combos). So the builder is
// built around that:
//
//   choose    search for a weapon (+ Wish)
//   build     all perk columns side by side; a combo toolbar ("brush") picks what a
//             tap does: add the perk to combo 1-4, or as a plain "any of these".
//             One perk may wear several combo numbers. A detail strip says what
//             the last perk you touched does; live stats preview any combo; Save
//             is pinned to the bottom.
//
// Nothing relies on hover (D2): every perk is a button that paints, and the
// detail strip shows the perk you last touched. The rules (what a tap does) are
// in weapon-builder-core.js; the saved wish is built by weapon-wish-core.js, the
// same code the Godroll.tv button uses, so both save identical wishes.
//
// Needs aw-dom, aw-ui, weapon-builder-core and weapon-wish-core, plus the game
// data helpers of destiny-manifest.js and saveItem/editItemWish of manager.js.

(function (root) {
  'use strict';

  const D = root.AWDom, UI = root.AWUI, B = root.AWWeaponBuilder, doc = root.document;
  const { h, raw } = D;
  const COMBO = root.OwnedInventoryIndex.COMBO_COLORS;
  const CAP = root.WeaponWish.ACCEPTABLE_CAP;
  const comboNo = (color) => COMBO.indexOf(color) + 1;
  const text = (v, fallback) => (typeof v === 'string' && v.trim() ? v : fallback);
  const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
  // destiny-manifest.js declares these with const, so they are shared by name, not as window properties.
  const BUNGIE = typeof BUNGIE_ROOT !== 'undefined' ? BUNGIE_ROOT : 'https://www.bungie.net';
  const STAT_HASHES = typeof WEAPON_STAT_HASHES !== 'undefined' ? WEAPON_STAT_HASHES : [];
  const MODE_TOGGLE = [{ value: 'pve', label: 'PvE' }, { value: 'pvp', label: 'PvP' }];
  const RECOIL_SVG = '<svg viewBox="0 0 2 1" class="ui-recoil" aria-hidden="true" focusable="false"><path d="M0,1 A1,1 0 0,1 2,1 Z" class="ui-recoil__back"/><path class="ui-recoil__wedge" d=""/></svg>';
  const CHEVRON = raw('<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false"><path d="M9 6l6 6-6 6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" fill="none"/></svg>');

  function icon(url, className) {
    const src = D.safeImageUrl(url);
    return src ? h('img', { class: className, src, alt: '', loading: 'lazy' }) : h('span', { class: [className, 'ui-itemicon--blank'] });
  }

  function create(ctx) {
    // ===================================================================== choose
    let searchSeq = 0, searchTimer = null;
    const results = h('div', { class: 'ui-droplist' });
    const search = UI.searchField({ placeholder: 'Search weapons by name', onInput: (q) => { clearTimeout(searchTimer); searchTimer = setTimeout(() => runSearch(q), 200); } });
    const pick = ctx.addScreen('weaponPick', 'Choose a weapon', () => { search.querySelector('input') && search.querySelector('input').focus(); });
    pick.body.append(search, results);
    hint('Type at least two letters of a weapon’s name.');

    function hint(message) { results.replaceChildren(h('p', { class: 'ui-note ui-pad' }, message)); }

    async function runSearch(query) {
      const seq = ++searchSeq;
      const q = String(query || '').trim();
      if (q.length < 2) { hint('Type at least two letters of a weapon’s name.'); return; }
      let found;
      try { found = await root.searchWeaponsLocally(q); } catch (e) { console.warn('[WeaponBuilder] search failed', e); hint('Search isn’t available yet. Game data may still be downloading.'); return; }
      if (seq !== searchSeq) return;
      if (!found.length) { hint(`No weapons found for “${q}”.`); return; }
      const idx = root.OwnedInventoryIndex.getCachedIndex && root.OwnedInventoryIndex.getCachedIndex();
      results.replaceChildren(...found.map((w) => {
        const owned = (idx && idx.byItemHash && idx.byItemHash.get(w.hash) && idx.byItemHash.get(w.hash).size) || 0;
        const sub = [w.itemTypeDisplayName, w.seasonLabel].filter(Boolean).join(' · ');
        return h('button', {
          type: 'button', class: 'ui-itemrow', aria: { label: `${w.name}, ${sub}${w.originTraitCount ? `, ${w.originTraitCount} origin traits` : ''}${owned ? `, you own ${owned}` : ''}` },
          on: { click: (e) => openBuild({ hash: w.hash, name: w.name, linked: w.linkedHashes }, e.currentTarget) }
        },
        icon(w.icon, 'ui-itemicon ui-itemicon--lg'),
        h('span', { class: 'ui-itemrow__text' },
          h('span', { class: 'ui-itemrow__name' }, w.name),
          h('span', { class: 'ui-itemrow__sub' }, sub),
          owned ? h('span', { class: 'ui-itemrow__owned' }, `${owned} owned`) : null),
        h('span', { class: 'ui-itemrow__end' }, CHEVRON));
      }));
    }

    // ===================================================================== build
    const empty = () => ({
      session: 0, loading: false, error: null, weapon: null, perks: [], brush: COMBO[0], preview: null, mode: 'pve',
      edit: null, focus: null, baseline: '', seasons: [], saving: false
    });
    let s = empty();
    const tiles = new Map();           // `${col}|${hash}` -> button
    let refs = {};                     // elements the live updates need

    const build = ctx.addScreen('weaponBuild', 'New wish', null, {
      canClose: () => {
        if (!dirty()) return true;
        UI.confirm({ title: 'Discard this wish?', body: 'The perks you picked haven’t been saved.', confirmLabel: 'Discard', cancelLabel: 'Keep editing', danger: true })
          .then((ok) => { if (ok) ctx.nav.close('weaponBuild', { force: true }); });
        return false;
      },
      onClose: () => { s.session++; }
    });
    build.el.classList.add('ui-builder');

    function openBuild(req, trigger) {
      const edit = req.edit || null;
      load(req, edit);
      ctx.nav.open('weaponBuild', {}, { returnFocus: trigger });
    }

    async function load(req, edit) {
      const session = ++s.session;
      const prev = s;
      s = Object.assign(empty(), { session, loading: true, edit, mode: edit ? edit.mode : prev.mode });
      tiles.clear();
      build.setTitle(edit ? 'Edit roll' : 'New wish');
      render();
      try {
        const defs = await root.loadInventoryItemDefsToMemory();
        if (session !== s.session) return;
        const def = defs.get(String(req.hash));
        if (!def) throw new Error('That weapon isn’t in the game data.');
        const [columns, displayStats] = await Promise.all([root.getWeaponPerkColumns(def), root.getWeaponDisplayStats(def)]);
        if (session !== s.session) return;
        const shot = (def.displayProperties && def.displayProperties.screenshot) || def.screenshot;
        s.weapon = {
          hash: def.hash, def, columns, displayStats,
          name: (def.displayProperties && def.displayProperties.name) || req.name || '',
          icon: def.displayProperties && def.displayProperties.icon ? `${BUNGIE}${def.displayProperties.icon}` : '',
          type: def.itemTypeDisplayName || 'Weapon',
          linkedHashes: Array.isArray(req.linked) ? req.linked : [],
          statNames: new Map(displayStats.map((r) => [r.statHash, r.name])),
          shot: shot ? (shot.startsWith('http') ? shot : `${BUNGIE}${shot}`) : ''
        };
        s.perks = edit ? B.fromWish(columns, edit.wish) : (req.start ? req.start(columns) : B.emptyState(columns));
        s.preview = B.usedColours(s.perks, COMBO)[0] || null;
        s.baseline = req.start ? '' : snapshot(); // a roll started from an owned copy counts as unsaved
        s.loading = false;
        render();
        seasons(session);
        refreshStats(session, true);
      } catch (e) {
        if (session !== s.session) return;
        console.warn('[WeaponBuilder] load failed', e);
        s.loading = false; s.error = e && e.message ? e.message : 'Couldn’t load that weapon.';
        render();
      }
    }

    const payload = () => root.WeaponWish.buildWeaponWishPayload(s.weapon.columns, s.perks, COMBO);
    const snapshot = () => (s.weapon ? JSON.stringify([payload().config.perkColumnsData, s.mode]) : '');
    const dirty = () => !!s.weapon && !s.saving && snapshot() !== s.baseline;

    // --- drawing
    function render() {
      refs = {};
      tiles.clear();
      const body = build.body;
      if (s.loading) { body.replaceChildren(h('p', { class: 'ui-note ui-pad', role: 'status' }, 'Loading the weapon…')); return; }
      if (s.error) {
        body.replaceChildren(UI.emptyState({ title: 'Couldn’t open this weapon', body: s.error, actions: [UI.button({ label: 'Back', variant: 'secondary', onClick: () => ctx.nav.close('weaponBuild', { force: true }) })] }));
        return;
      }
      const w = s.weapon;
      refs.seasons = h('div', { class: 'ui-chip-row', role: 'group', aria: { label: 'Version' }, hidden: true });
      refs.toolbar = h('div', { class: 'ui-brush' });
      refs.hint = h('p', { class: 'ui-note ui-brush__hint', role: 'status' });
      refs.detail = h('div', { class: 'ui-perkdetail' });
      refs.previewBar = h('div', { class: 'ui-statsbar' });
      refs.stats = h('div', { class: 'ui-stats' });
      refs.ttk = h('p', { class: 'ui-note ui-ttk' });
      refs.summary = h('span', { class: 'ui-builder__summary' });
      refs.save = h('div', { class: 'ui-builder__actions' });

      const mode = UI.segmented({ options: MODE_TOGGLE, value: s.mode, label: 'Game mode', onChange: (v) => { s.mode = v; refreshSummary(); } });
      const bg = w.shot ? D.safeImageUrl(w.shot) : null;
      refs.statsCard = h('section', { class: 'ui-card ui-statscard', aria: { label: 'Stats' } },
        h('div', { class: 'ui-sectiontitle' }, 'Stats'), refs.previewBar, refs.stats, refs.ttk);
      if (bg) refs.statsCard.style.setProperty('--ui-stats-art', `url("${bg}")`);

      build.body.replaceChildren(
        h('div', { class: 'ui-detailhead' }, icon(w.icon, 'ui-itemicon ui-itemicon--lg'),
          h('div', null, h('div', { class: 'ui-detailhead__name' }, text(w.name, 'Weapon')), h('div', { class: 'ui-detailhead__sub' }, w.type))),
        refs.seasons,
        mode,
        h('div', { class: 'ui-builder__sticky' }, refs.toolbar, refs.hint),
        h('div', { class: 'ui-cols', style: { '--ui-cols': String(w.columns.length) } }, w.columns.map((col, c) => column(col, c))),
        refs.detail,
        refs.statsCard,
        h('div', { class: 'ui-builder__foot' }, refs.summary, refs.save));
      buildStatRows();
      refreshAll();
    }

    function column(col, c) {
      return h('div', { class: 'ui-col', role: 'group', aria: { label: `Column ${c + 1}` } },
        h('div', { class: 'ui-col__label' }, `Col ${c + 1}`),
        col.pairs.map((pair) => {
          const b = h('button', { type: 'button', class: 'ui-ptile', data: { col: c, hash: pair.base.hash }, on: { click: () => tap(c, pair) } },
            icon(pair.base.icon, 'ui-ptile__img'), h('span', { class: 'ui-ptile__combos', aria: { hidden: true } }));
          tiles.set(`${c}|${pair.base.hash}`, b);
          return b;
        }));
    }

    function tap(c, pair) {
      const r = B.paint(s.perks, s.weapon.columns, c, pair.base.hash, s.brush, COMBO, CAP);
      s.focus = { c, pair };
      if (!r.changed && r.reason === 'cap') ctx.toast(`A column holds up to ${CAP} perks.`);
      if (r.changed && s.preview && !B.usedColours(s.perks, COMBO).includes(s.preview)) s.preview = null;
      if (r.changed && !s.preview && s.brush !== 'any' && B.usedColours(s.perks, COMBO).includes(s.brush)) s.preview = s.brush;
      refreshAll();
      if (r.changed) refreshStats(s.session, false);
    }

    function refreshAll() {
      if (!s.weapon) return;
      paintTiles(); paintToolbar(); paintDetail(); paintPreviewBar(); refreshSummary();
    }

    function paintTiles() {
      s.weapon.columns.forEach((col, c) => col.pairs.forEach((pair) => {
        const el = tiles.get(`${c}|${pair.base.hash}`);
        if (!el) return;
        const colours = B.coloursOf(s.perks[c], pair.base.hash, COMBO);
        const picked = B.isPicked(s.perks[c], pair);
        el.classList.toggle('is-picked', picked);
        el.classList.toggle('is-focus', !!s.focus && s.focus.c === c && s.focus.pair === pair);
        el.setAttribute('aria-pressed', String(picked));
        el.setAttribute('aria-label', `${text(pair.base.name, 'Perk')}${colours.length ? `, combo ${colours.map(comboNo).join(' and ')}` : picked ? ', any of these' : ''}`);
        el.querySelector('.ui-ptile__combos').replaceChildren(...colours.map((k) => h('span', { class: 'ui-ptile__combo', data: { combo: comboNo(k) } }, String(comboNo(k)))));
      }));
    }

    function paintToolbar() {
      const opts = [{ value: 'any', label: 'Any' }].concat(COMBO.map((k) => ({ value: k, label: String(comboNo(k)) })));
      const seg = UI.segmented({ options: opts, value: s.brush, label: 'What a tap does: add to', onChange: (v) => { s.brush = v; paintToolbar(); } });
      seg.classList.add('ui-brush__seg');
      seg.querySelectorAll('.ui-seg__opt').forEach((b) => {
        const k = b.dataset.value;
        if (k === 'any') { b.setAttribute('aria-label', 'Any of these: add a perk that is in no combo'); return; }
        const n = B.comboSpan(s.perks, k);
        b.classList.toggle('is-used', n > 0);
        b.setAttribute('aria-label', `Combo ${comboNo(k)}${n ? `, ${plural(n, 'column', 'columns')}` : ', empty'}`);
      });
      const hadFocus = refs.toolbar.contains(doc.activeElement);
      refs.toolbar.replaceChildren(seg);
      if (hadFocus) { const on = seg.querySelector('.is-selected'); if (on) on.focus(); }
      const lone = COMBO.filter((k) => B.comboSpan(s.perks, k) === 1);
      refs.hint.textContent = (s.brush === 'any'
        ? 'Tap a perk to accept it on its own.'
        : `Tap perks to add them to combo ${comboNo(s.brush)}. Tap again to remove.`)
        + (lone.length ? ` Combo ${lone.map(comboNo).join(' and ')} has one perk so far.` : '');
    }

    function paintDetail() {
      const f = s.focus;
      if (!f) { refs.detail.replaceChildren(h('p', { class: 'ui-note' }, 'Tap a perk to add it. Its details show here.')); return; }
      const plug = f.pair.enhanced || f.pair.base;
      const rows = (plug.stats || []).filter((x) => s.weapon.statNames.has(x.hash));
      refs.detail.replaceChildren(
        h('div', { class: 'ui-perkdetail__head' }, icon(f.pair.base.icon, 'ui-ptile__img ui-perkdetail__icon'),
          h('div', { class: 'ui-perkdetail__name' }, text(f.pair.base.name, 'Perk'), f.pair.enhanced ? h('span', { class: 'ui-badge ui-badge--accent' }, 'Enhanced available') : null)),
        plug.description ? h('p', { class: 'ui-perkdetail__desc' }, plug.description) : null,
        rows.length
          ? h('div', { class: 'ui-perkdetail__stats' }, rows.map((x) => h('span', { class: ['ui-delta', x.value > 0 ? 'is-pos' : 'is-neg'] },
            `${s.weapon.statNames.get(x.hash)} ${x.value > 0 ? '+' : ''}${x.value}`)))
          : h('p', { class: 'ui-note' }, 'No stat changes.'));
    }

    function paintPreviewBar() {
      const used = B.usedColours(s.perks, COMBO);
      if (!used.length) { refs.previewBar.replaceChildren(h('p', { class: 'ui-note' }, 'Base stats. Put perks in a combo to preview it.')); return; }
      const seg = UI.segmented({
        options: [{ value: 'base', label: 'Base' }].concat(used.map((k) => ({ value: k, label: `Combo ${comboNo(k)}` }))),
        value: s.preview || 'base', label: 'Preview stats for',
        onChange: (v) => { s.preview = v === 'base' ? null : v; refreshStats(s.session, false); }
      });
      seg.classList.add('ui-brush__seg');
      refs.previewBar.replaceChildren(seg);
    }

    function refreshSummary() {
      if (!s.weapon) return;
      const perks = s.perks.reduce((n, st, c) => n + B.pickedCount(st, s.weapon.columns[c]), 0);
      const combos = B.usedColours(s.perks, COMBO).length;
      refs.summary.textContent = perks ? `${plural(perks, 'perk', 'perks')}${combos ? ` · ${plural(combos, 'combo', 'combos')}` : ''}` : 'Nothing picked yet';
      const nothing = B.isEmpty(s.perks);
      const primary = UI.button({ label: s.edit ? 'Update roll' : 'Save wish', variant: 'primary', disabled: nothing || s.saving, onClick: () => save(!!s.edit) });
      refs.save.replaceChildren(primary, s.edit ? UI.button({ label: 'Save as new', variant: 'secondary', disabled: nothing || s.saving, onClick: () => save(false) }) : null);
    }

    // --- stats
    function buildStatRows() {
      refs.rows = new Map();
      refs.stats.replaceChildren(...s.weapon.displayStats.map((stat) => {
        const num = h('span', { class: 'ui-stat__num' }, '0');
        let mid = null;
        if (stat.isRecoil) mid = h('span', { class: 'ui-stat__recoil' }, raw(RECOIL_SVG));
        else if (stat.isBar) mid = h('span', { class: 'ui-stat__track' }, h('span', { class: 'ui-stat__base' }), h('span', { class: 'ui-stat__delta' }));
        const row = h('div', { class: 'ui-stat' }, h('span', { class: 'ui-stat__label' }, text(stat.name, '')), mid, num);
        refs.rows.set(stat.statHash, { stat, row, num, mid });
        return row;
      }));
    }

    function paintStats(deltas) {
      const clamp = (v) => Math.max(0, Math.min(v, 100));
      refs.rows.forEach(({ stat, num, mid }) => {
        const delta = deltas.get(stat.statHash) || 0;
        const shown = Math.round(root.interpolateStatValue(stat.base + delta, stat.interpolation));
        num.textContent = String(shown);
        if (stat.isRecoil) { const p = mid.querySelector('.ui-recoil__wedge'); if (p) p.setAttribute('d', B.recoilWedgePath(shown)); return; }
        if (!stat.isBar) return;
        const baseShown = root.interpolateStatValue(stat.base, stat.interpolation);
        const basePct = clamp(baseShown / stat.displayMaximum * 100), totalPct = clamp(shown / stat.displayMaximum * 100);
        const baseEl = mid.querySelector('.ui-stat__base'), deltaEl = mid.querySelector('.ui-stat__delta');
        const low = Math.min(basePct, totalPct);
        baseEl.style.width = `${low}%`;
        deltaEl.style.left = `${low}%`;
        deltaEl.style.width = `${Math.abs(totalPct - basePct)}%`;
        deltaEl.classList.toggle('is-pos', totalPct > basePct);
        deltaEl.classList.toggle('is-neg', totalPct < basePct);
      });
    }

    let oracleFor = null;
    async function refreshStats(session, first) {
      if (!s.weapon || session !== s.session) return;
      const plugs = B.comboPlugs(s.weapon.columns, s.perks, s.preview);
      paintStats(B.statDeltas(plugs)); // numbers straight away; the oracle adds the time-to-kill line
      try {
        const calc = await root.oracleEngineReady;
        if (session !== s.session) return;
        if (oracleFor !== s.weapon.hash || first) {
          const def = s.weapon.def, socket = def.sockets && def.sockets.socketEntries && def.sockets.socketEntries[0];
          calc.setWeapon(def.hash, def.itemSubType, (socket && socket.singleInitialItemHash) || 0, def.equippingBlock && def.equippingBlock.ammoType, def.defaultDamageTypeHash);
          const base = new Map();
          (def.investmentStats || []).forEach((st) => { if (STAT_HASHES.includes(st.statTypeHash)) base.set(st.statTypeHash, st.value); });
          calc.setStats(base);
          oracleFor = s.weapon.hash;
        }
        calc.resetTraits();
        plugs.forEach(({ plug }) => calc.addTrait(new Map((plug.stats || []).filter((x) => !x.conditional).map((x) => [x.hash, x.value])), 1, plug.hash));
        const ttk = calc.getWeaponTtk(0);
        const best = Array.isArray(ttk) && ttk[0] && ttk[0].optimalTtk;
        refs.ttk.textContent = best ? `Time to kill: ${best.headshots} headshots or ${best.bodyshots} body shots, ${best.timeTaken.toFixed(3)}s` : '';
      } catch (e) { console.warn('[WeaponBuilder] stats engine unavailable', e); }
    }

    // --- other versions of the same weapon (reissues)
    async function seasons(session) {
      const w = s.weapon;
      const all = [w.hash].concat(w.linkedHashes);
      if (all.length < 2 || !root.ensureWatermarkLookupReady) return;
      try {
        const [defs, marks] = await Promise.all([root.loadInventoryItemDefsToMemory(), root.ensureWatermarkLookupReady()]);
        if (session !== s.session) return;
        const mapped = all.map((hash) => {
          const label = root.getSeasonLabelForWatermark((defs.get(String(hash)) || {}).iconWatermark, marks);
          const n = label ? parseInt((label.match(/\d+/) || [])[0], 10) : 0;
          return { hash, n, label: n ? `Season ${n}` : '?' };
        }).sort((a, b) => a.n - b.n);
        const bySeason = new Map();
        mapped.forEach((m) => { if (!bySeason.has(m.n) || m.hash === w.hash) bySeason.set(m.n, m); });
        const list = [...bySeason.values()];
        if (list.length < 2 || !refs.seasons) return;
        refs.seasons.hidden = false;
        refs.seasons.replaceChildren(...list.map((m) => UI.chip({
          label: m.label, selected: m.hash === w.hash,
          onClick: () => { if (m.hash !== w.hash) load({ hash: m.hash, name: w.name, linked: all.filter((x) => x !== m.hash) }, null); }
        })));
      } catch (e) { console.warn('[WeaponBuilder] seasons unavailable', e); }
    }

    // --- saving
    async function save(overwrite) {
      if (!s.weapon || B.isEmpty(s.perks) || s.saving) return;
      const w = s.weapon, { rawString, config } = payload();
      s.saving = true; refreshSummary();
      try {
        if (overwrite && s.edit) {
          const e = s.edit;
          const { result } = await root.editItemWish(e.hash, e.index, rawString, config, s.mode, e.key);
          s.saving = false;
          if (result === 'duplicate') { ctx.toast('Another roll already has exactly these perks.'); refreshSummary(); return; }
          ctx.nav.close('weaponBuild', { force: true });
          ctx.toast(result === 'missing' ? 'That roll was deleted, so nothing was changed.' : 'Roll updated.');
          return;
        }
        const status = await root.saveItem(w.hash, w.name, 'weapon', rawString, rawString, config, s.mode, w.icon,
          null, null, null, null, null, w.linkedHashes,
          { ammoType: (w.def.equippingBlock && w.def.equippingBlock.ammoType) ?? null, itemTypeDisplayName: w.def.itemTypeDisplayName ?? null, damageTypeHash: w.def.defaultDamageTypeHash ?? null });
        s.saving = false;
        if (status !== 'added') { ctx.toast('This exact roll is already on your list.'); refreshSummary(); return; }
        ctx.nav.close('weaponBuild', { force: true });
        if (ctx.nav.isOpen('weaponPick')) ctx.nav.close('weaponPick', { force: true });
        ctx.toast(`${text(w.name, 'Weapon')} added.`, { action: { label: 'Add another', onClick: () => start() } });
      } catch (e) {
        console.warn('[WeaponBuilder] save failed', e);
        s.saving = false; refreshSummary();
        ctx.toast('Couldn’t save that. Please try again.');
      }
    }

    // ===================================================================== entry points
    function start(trigger) {
      searchSeq++;
      const input = search.querySelector('input');
      if (input) { input.value = ''; input.dispatchEvent(new Event('input')); }
      hint('Type at least two letters of a weapon’s name.');
      ctx.nav.open('weaponPick', {}, { returnFocus: trigger });
    }

    /** Edit one saved roll. `p` = { hash, index, key, item, wish }. */
    function edit(p, trigger) {
      const wish = p.wish;
      openBuild({
        hash: p.hash, name: p.item && p.item.static && p.item.static.name, linked: (p.item && p.item.static && p.item.static.linkedHashes) || [],
        edit: { hash: p.hash, index: p.index, key: p.key, wish, mode: wish && wish.tags && wish.tags[0] === 'pvp' ? 'pvp' : 'pve' }
      }, trigger);
    }

    /** A new wish that starts from the perks of an owned copy (Inventory). */
    function fromOwned(itemHash, name, activeBySocketIndex, trigger) {
      openBuild({ hash: itemHash, name, linked: [], start: (columns) => B.fromOwned(columns, activeBySocketIndex, COMBO) }, trigger);
    }

    return { start, edit, fromOwned };
  }

  root.AWWeaponBuilderScreen = { create };
})(typeof window !== 'undefined' ? window : globalThis);
