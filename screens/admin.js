// Ahamkara Wishes — Admin: creators and wishlist moderation (the owner only).
//
// Reached from Account > Admin, which only appears once admin.js has confirmed
// who you are; every change here is re-checked on the server regardless.
//   Creators    people whose lists show under a chosen name with a verified tick
//   Wishlists   everything submitted to Discover: feature one, or delete it
//
// Deleting a creator or a list can't be undone, so each asks first (D6).
// Needs aw-dom, aw-ui and admin.js (window.AWAdmin).

(function (root) {
  'use strict';

  const D = root.AWDom, UI = root.AWUI;
  const { h } = D;
  const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
  const TABS = [{ value: 'creators', label: 'Creators' }, { value: 'wishlists', label: 'Wishlists' }];

  function create(ctx) {
    const A = () => root.AWAdmin.api;
    let tab = 'creators', term = '', timer = null, seq = 0;
    const screen = ctx.addScreen('admin', 'Admin', () => { show(); });
    const seg = UI.segmented({ options: TABS, value: tab, label: 'Admin sections', onChange: (v) => { tab = v; show(); } });
    const panel = h('div', { class: 'ui-field-gap' });
    screen.body.append(seg, panel);

    function show() { if (tab === 'creators') loadCreators(); else loadWishlists(); }
    const note = (text) => h('p', { class: 'ui-note', role: 'status' }, text);

    // ---- creators
    async function loadCreators() {
      const mine = ++seq;
      const bungie = UI.textField({ label: 'Bungie name', placeholder: 'Guardian#1234', hint: 'Exactly as Bungie shows it.' });
      const display = UI.textField({ label: 'Name to show', placeholder: 'Datto', hint: '' });
      const add = UI.button({ label: 'Add or update creator', variant: 'primary', block: true, onClick: async () => {
        const b = bungie.input.value.trim(), d = display.input.value.trim();
        if (!b || !d) { (b ? display : bungie).setError('Both fields are required.'); return; }
        add.disabled = true;
        try { await A().addCreator(b, d); bungie.input.value = ''; display.input.value = ''; ctx.toast('Creator added.'); loadCreators(); }
        catch (e) { ctx.toast(`Couldn’t add: ${e.message}`); }
        add.disabled = false;
      } });
      const list = h('div', { class: 'ui-droplist' }, note('Loading creators…'));
      panel.replaceChildren(h('div', { class: 'ui-card ui-wlcard' }, bungie, display, add), list);
      try {
        const rows = await A().creators();
        if (mine !== seq) return;
        list.replaceChildren(...(rows.length ? rows.map((c) => h('div', { class: 'ui-card ui-adminrow' },
          h('div', { class: 'ui-adminrow__text' }, h('div', { class: 'ui-wlcard__title' }, c.display_name), h('div', { class: 'ui-note' }, c.bungie_name)),
          UI.button({ label: 'Remove', variant: 'ghost', aria: { label: `Remove ${c.display_name}` }, onClick: () => removeCreator(c) }))) : [note('No creators added yet.')]));
      } catch (e) { if (mine === seq) list.replaceChildren(note('Couldn’t load creators.')); }
    }

    async function removeCreator(c) {
      const ok = await UI.confirm({ title: `Remove ${c.display_name}?`, body: 'Their lists show under their Bungie name again, without a tick.', confirmLabel: 'Remove', danger: true });
      if (!ok) return;
      try { await A().removeCreator(c.bungie_name); ctx.toast('Creator removed.'); loadCreators(); }
      catch (e) { ctx.toast(`Couldn’t remove: ${e.message}`); }
    }

    // ---- wishlists
    async function loadWishlists() {
      const mine = ++seq;
      const search = UI.searchField({ label: 'Search all wishlists', placeholder: 'Search all wishlists', value: term, onInput: (v) => { clearTimeout(timer); timer = root.setTimeout(() => { term = v.trim(); loadWishlists(); }, 300); } });
      const list = h('div', { class: 'ui-droplist' }, note('Loading wishlists…'));
      panel.replaceChildren(search, list);
      try {
        const rows = await A().wishlists(term);
        if (mine !== seq) return;
        list.replaceChildren(...(rows.length ? rows.map(wishlistRow) : [note('No wishlists found.')]));
      } catch (e) { if (mine === seq) list.replaceChildren(note('Couldn’t load wishlists.')); }
    }

    function wishlistRow(w) {
      let featured = !!w.featured;
      const star = UI.button({ label: featured ? '★ Featured' : '☆ Feature', variant: 'secondary', aria: { pressed: String(featured) }, onClick: async () => {
        try {
          await A().feature(w.id, !featured);
          featured = !featured;
          star.querySelector('.ui-btn__label').textContent = featured ? '★ Featured' : '☆ Feature';
          star.setAttribute('aria-pressed', String(featured));
          row.classList.toggle('is-featured', featured);
        } catch (e) { ctx.toast(`Couldn’t update: ${e.message}`); }
      } });
      const row = h('article', { class: ['ui-card', 'ui-wlcard', featured && 'is-featured'], data: { id: String(w.id) } },
        h('div', { class: 'ui-wlcard__title' }, w.title || 'Untitled'),
        h('div', { class: 'ui-note' }, `${w.submitter_bungie_name || 'Unknown'} · ${plural(Number(w.item_count) || 0, 'item', 'items')}`),
        h('div', { class: 'ui-wlcard__foot' }, star,
          UI.button({ label: 'Delete', variant: 'ghost', aria: { label: `Delete ${w.title}` }, onClick: async () => {
            const ok = await UI.confirm({ title: `Delete “${w.title}”?`, body: 'It leaves Discover for everyone. This can’t be undone.', confirmLabel: 'Delete', cancelLabel: 'Keep it', danger: true });
            if (!ok) return;
            try { await A().remove(w.id); row.remove(); ctx.toast('Wishlist deleted.'); }
            catch (e) { ctx.toast(`Couldn’t delete: ${e.message}`); }
          } })));
      return row;
    }

    return { open: (trigger) => ctx.nav.open('admin', {}, { returnFocus: trigger }) };
  }

  root.AWAdminScreen = { create };
})(typeof window !== 'undefined' ? window : globalThis);
