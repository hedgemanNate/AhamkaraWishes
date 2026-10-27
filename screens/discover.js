// Ahamkara Wishes — the Discover screen.
//
// Browse and search wishlists other people share (community and verified
// creators), save one as a new list of your own, and share yours.
//   list     search (title or creator), filters, then My submissions (when signed
//            in), Featured, Community with Load more; searching shows Results
//   card     title, author (a tick for verified creators), modes, item count, how
//            many people saved it, and Save
//   submit   shares your ACTIVE list: a title and a mode, with the limit shown
//
// Saving goes through the same validate-and-import path as a downloaded .awwish
// file (awWishlistIO.importFromPayload), so a list from someone else is checked
// before it touches your data. Deleting your own submission can't be undone (it
// leaves Discover for everyone), so it asks first (D6).
//
// Needs aw-dom, aw-ui and discover-core; wishlist-io.js for import and export.

(function (root) {
  'use strict';

  const D = root.AWDom, UI = root.AWUI, X = root.AWDiscover, doc = root.document;
  const { h } = D;
  const MODE_OPTIONS = [{ value: 'pve', label: 'PvE' }, { value: 'pvp', label: 'PvP' }, { value: 'mixed', label: 'Mixed' }];
  const STALE_MS = 60 * 1000;

  function create(ctx) {
    const client = X.createClient({
      fetch: (url, init) => root.supabaseFetch(url, init),
      getAuth: async () => { try { return root.bungieAuth ? await root.bungieAuth.getValidAuth() : null; } catch (e) { return null; } }
    });
    const state = { filter: 'all', search: '' };
    let creators = new Map();
    let featured = [], community = { rows: [], more: false }, results = { rows: [], more: false };
    let mine = null;                 // { who, rows } when signed in
    let failed = false, loading = false, loadedAt = 0, seq = 0, active = false;
    const saved = new Set();         // ids saved in this visit

    // --- controls
    const search = UI.searchField({ label: 'Search wishlists or creators', placeholder: 'Search lists or creators', onInput: (v) => { clearTimeout(timer); timer = root.setTimeout(() => { state.search = v.trim(); load(); }, 300); } });
    let timer = null;
    const submitBtn = UI.button({ label: 'Submit', variant: 'primary', onClick: (e) => openSubmit(e.currentTarget) });
    submitBtn.classList.add('ui-discover__submit');
    const chips = new Map();
    const chipRow = UI.chipRow(X.FILTERS.map((f) => {
      const b = h('button', { type: 'button', class: 'ui-chip', aria: { pressed: 'false' }, on: { click: () => { state.filter = f.key; paintChips(); load(); } } }, h('span', null, f.label));
      chips.set(f.key, b);
      return b;
    }), { label: 'Filter lists' });
    function paintChips() { chips.forEach((b, key) => { const on = key === state.filter; b.classList.toggle('is-selected', on); b.setAttribute('aria-pressed', String(on)); }); }
    const listEl = h('div', { class: 'ui-cardlist' });
    const el = h('div', { class: 'ui-discover' },
      h('div', { class: 'ui-stickytop' }, h('div', { class: 'ui-searchrow' }, search, submitBtn), chipRow), listEl);

    // --- loading
    async function load() {
      const mineSeq = ++seq;
      loading = true; failed = false; paint();
      try {
        creators = await client.creators();
        if (state.search) {
          const rows = await client.search(state.search, state.filter, 0);
          if (mineSeq !== seq) return;
          results = { rows, more: rows.length >= X.PAGE_SIZE };
        } else {
          const [f, c] = await Promise.all([client.featured(state.filter), client.community(state.filter, 0)]);
          if (mineSeq !== seq) return;
          featured = f; community = { rows: c, more: c.length >= X.PAGE_SIZE };
        }
        loadedAt = Date.now();
      } catch (e) {
        if (mineSeq !== seq) return;
        console.warn('[Discover] load failed', e);
        failed = true;
      }
      loading = false;
      paint();
      loadMine(mineSeq);
    }

    // Asks Bungie directly rather than the shell's signed-in flag, which catches up
    // a moment after a sign-in; signed out, client.mine() fails and this shows nothing.
    async function loadMine(forSeq) {
      try {
        const m = await client.mine();
        if (forSeq !== undefined && forSeq !== seq) return;
        mine = m;
      } catch (e) { mine = null; }
      paint();
    }

    async function more(kind) {
      const bucket = kind === 'results' ? results : community;
      try {
        const rows = kind === 'results'
          ? await client.search(state.search, state.filter, bucket.rows.length)
          : await client.community(state.filter, bucket.rows.length);
        bucket.rows = bucket.rows.concat(rows);
        bucket.more = rows.length >= X.PAGE_SIZE;
      } catch (e) { ctx.toast('Couldn’t load more. Check your connection.'); }
      paint();
    }

    // --- drawing
    function paint() {
      const out = [];
      if (loading && !featured.length && !community.rows.length && !results.rows.length) { listEl.replaceChildren(h('p', { class: 'ui-note', role: 'status' }, 'Loading wishlists…')); return; }
      if (failed) {
        listEl.replaceChildren(UI.emptyState({ title: 'Couldn’t reach Discover', body: 'Check your connection and try again.', actions: [UI.button({ label: 'Try again', variant: 'primary', onClick: () => load() })] }));
        return;
      }
      if (mine && mine.rows.length) {
        out.push(h('div', { class: 'ui-sectiontitle' }, `My submissions ${X.capNote(mine.who) ? `· ${X.capNote(mine.who).replace(' submissions used.', ' used')}` : ''}`.trim()));
        mine.rows.forEach((r) => out.push(card(r, { own: true })));
      }
      if (state.search) {
        out.push(h('div', { class: 'ui-sectiontitle' }, 'Results'));
        results.rows.forEach((r) => out.push(card(r)));
        if (!results.rows.length) out.push(UI.emptyState({ title: 'No wishlists found', body: 'Try another name, or a creator’s.' }));
        if (results.more) out.push(UI.button({ label: 'Load more', variant: 'secondary', block: true, onClick: () => more('results') }));
      } else {
        if (featured.length) { out.push(h('div', { class: 'ui-sectiontitle' }, 'Featured')); featured.forEach((r) => out.push(card(r))); }
        out.push(h('div', { class: 'ui-sectiontitle' }, 'Community'));
        community.rows.forEach((r) => out.push(card(r)));
        if (!community.rows.length) out.push(UI.emptyState({ title: 'No wishlists yet', body: state.filter === 'all' ? 'Be the first to share one.' : 'Nothing matches this filter.' }));
        if (community.more) out.push(UI.button({ label: 'Load more', variant: 'secondary', block: true, onClick: () => more('community') }));
      }
      listEl.replaceChildren(...out);
    }

    function card(row, { own = false } = {}) {
      const v = X.cardView(row, creators);
      const countEl = h('span', { class: 'ui-wlcard__saves' }, `${v.saves} saved`);
      const save = UI.button({ label: saved.has(v.id) ? 'Saved' : 'Save to my lists', variant: 'secondary', disabled: saved.has(v.id), aria: { label: `Save ${v.title} to my lists` }, onClick: () => saveList(row, v, save, countEl) });
      return h('article', { class: ['ui-card', 'ui-wlcard', v.featured && 'is-featured'], data: { id: v.id } },
        h('div', { class: 'ui-wlcard__title' }, v.title),
        h('div', { class: 'ui-wlcard__meta' },
          h('span', { class: 'ui-wlcard__author' }, v.author.name),
          v.author.verified ? h('span', { class: 'ui-wlcard__verified', role: 'img', aria: { label: 'Verified creator' } }, '✓') : null,
          v.featured ? UI.badge('★ Featured', 'accent') : null,
          h('span', null, `· ${X.itemsText(v.items)}`)),
        h('div', { class: 'ui-wlcard__tags' },
          UI.badge(v.mode.toUpperCase(), v.mode === 'mixed' ? 'muted' : v.mode),
          v.hasWeapons ? UI.badge('Weapons', 'muted') : null,
          v.hasArmor ? UI.badge('Armor', 'muted') : null),
        h('div', { class: 'ui-wlcard__foot' },
          own ? UI.button({ label: 'Delete', variant: 'ghost', aria: { label: `Delete ${v.title} from Discover` }, onClick: () => removeOwn(row, v) }) : save,
          countEl));
    }

    // --- save
    async function saveList(row, v, btn, countEl) {
      btn.disabled = true;
      btn.querySelector('.ui-btn__label').textContent = 'Saving…';
      try {
        const payload = await client.payload(row.id);
        const ok = await root.awWishlistIO.importFromPayload({ aw: 'wishes', v: 1, list: payload });
        if (!ok) throw new Error('refused');
        saved.add(v.id);
        btn.querySelector('.ui-btn__label').textContent = 'Saved';
        row.save_count = (row.save_count || 0) + 1;
        client.countSave(row.id).then((counted) => { if (counted) countEl.textContent = `${row.save_count} saved`; });
      } catch (e) {
        btn.disabled = false;
        btn.querySelector('.ui-btn__label').textContent = 'Save to my lists';
        if (e.message !== 'refused') ctx.toast(`Couldn’t save: ${e.message}`);
      }
    }

    // --- delete your own
    async function removeOwn(row, v) {
      const ok = await UI.confirm({
        title: `Delete “${v.title}”?`, body: 'It leaves Discover for everyone. Lists people already saved from it are not affected. This can’t be undone.',
        confirmLabel: 'Delete', cancelLabel: 'Keep it', danger: true
      });
      if (!ok) return;
      try {
        await client.remove(row.id); // the id as the server sent it, not the card's text form
        if (mine) { mine.rows = mine.rows.filter((r) => String(r.id) !== v.id); mine.who.submittedCount = Math.max(0, (mine.who.submittedCount || 1) - 1); }
        featured = featured.filter((r) => String(r.id) !== v.id);
        community.rows = community.rows.filter((r) => String(r.id) !== v.id);
        results.rows = results.rows.filter((r) => String(r.id) !== v.id);
        paint();
        ctx.toast('Deleted from Discover.');
      } catch (e) { ctx.toast(`Couldn’t delete: ${e.code || e.message}`); }
    }

    // --- submit
    const sheet = ctx.addSheet('discoverSubmit', 'Submit a wishlist', () => fillSubmit(), { footer: true });
    const sBody = () => sheet.querySelector('.ui-sheet__body'), sFoot = () => sheet.querySelector('.ui-sheet__footslot');
    function openSubmit(trigger) { ctx.nav.open('discoverSubmit', {}, { returnFocus: trigger }); }

    function fillSubmit() {
      if (!ctx.store.auth.signedIn) {
        sBody().replaceChildren(UI.emptyState({ title: 'Sign in to submit', body: 'Sharing a list needs your Bungie account, so Discover can show who made it and keep to your limit.' }));
        sFoot().replaceChildren(UI.button({ label: 'Sign in with Bungie', variant: 'primary', size: 'lg', block: true, onClick: () => { ctx.nav.close('discoverSubmit'); ctx.signIn(); } }));
        return;
      }
      sBody().replaceChildren(h('p', { class: 'ui-note', role: 'status' }, 'Loading your list…'));
      sFoot().replaceChildren();
      root.awWishlistIO.getActiveListPayload((payload) => {
        const count = X.itemCountOf(payload);
        if (!payload || !count) {
          sBody().replaceChildren(UI.emptyState({ title: 'Your current list is empty', body: 'Add some wishes first. Discover shares the list you’re using, shown at the top of Wishes.' }));
          sFoot().replaceChildren(UI.button({ label: 'Close', variant: 'secondary', size: 'lg', block: true, onClick: () => ctx.nav.close('discoverSubmit') }));
          return;
        }
        let mode = X.detectMode(payload);
        const field = UI.textField({ label: 'Title', value: payload.name || '', maxLength: 80, placeholder: 'e.g. Datto’s PvE meta', hint: '', onSubmit: () => submit() });
        const modes = UI.segmented({ options: MODE_OPTIONS, value: mode, label: 'Mode', onChange: (v) => { mode = v; } });
        const note = [`${X.itemsText(count)} in “${payload.name}”.`, X.capNote(mine && mine.who)].filter(Boolean).join(' ');
        const btn = UI.button({ label: 'Submit', variant: 'primary', size: 'lg', block: true, onClick: () => submit() });
        let sending = false; // Enter in the title can't send a second copy while one is on its way
        async function submit() {
          if (sending) return;
          const title = field.input.value.trim();
          if (!title) { field.setError('Give your wishlist a title.'); field.input.focus(); return; }
          sending = true;
          btn.disabled = true; btn.querySelector('.ui-btn__label').textContent = 'Submitting…';
          try {
            await client.submit({ title, mode, payload });
            ctx.nav.close('discoverSubmit', { force: true });
            ctx.toast('Wishlist submitted!');
            load();
          } catch (e) {
            if (e.code === 'not_signed_in') field.setError('Sign in first to submit a wishlist.');
            else field.setError(X.submitError(e.code || e.message, mine && mine.who && mine.who.cap));
          }
          sending = false;
          btn.disabled = false; btn.querySelector('.ui-btn__label').textContent = 'Submit';
        }
        sBody().replaceChildren(h('div', { class: 'ui-field-gap' }, h('p', { class: 'ui-note' }, `${note} It shares the list you’re using now. Switch lists from the list name at the top.`), field,
          h('div', { class: 'ui-fieldblock' }, h('div', { class: 'ui-sectiontitle' }, 'Mode'), modes)));
        sFoot().replaceChildren(btn);
      });
    }

    // --- keeping in step
    ctx.nav.onChange((s) => {
      const now = s.tab === 'discover';
      if (now === active) return;
      active = now;
      if (now && Date.now() - loadedAt > STALE_MS) load();
    });
    doc.addEventListener('bungieAuthChanged', () => { if (active || loadedAt) loadMine(); });
    paintChips();

    return { el, load };
  }

  root.AWDiscoverScreen = { create };
})(typeof window !== 'undefined' ? window : globalThis);
