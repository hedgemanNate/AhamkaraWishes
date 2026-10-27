// Ahamkara Wishes — Wishlists (D3, D6, D12).
//
// The list name in the app bar opens this sheet. Tap a list to switch to it; the
// ⋯ on a list opens what you can do with it:
//   Rename · Duplicate · Export · Merge other lists into it · Delete
// and the footer has New list and Import.
//
// Delete and Merge can be undone (a toast, D6), so neither asks first. Merge is
// guided: you pick what to fold in and are told what happens. Unlike the old
// merge it keeps every roll of both lists (the same roll once); the old one
// dropped a list's rolls for any weapon the target already had.
//
// The edits are WishlistSync's list operations (tested in tests/list-ops-test.js).
// Needs aw-dom, aw-ui, aw-store, wishlist-sync-core; Import and Export come from
// wishlist-io.js (awWishlistIO).

(function (root) {
  'use strict';

  const D = root.AWDom, UI = root.AWUI, WS = root.WishlistSync, doc = root.document;
  const { h } = D;
  const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
  const countOf = (list) => Object.values((list && list.items) || {}).reduce((n, it) => n + ((it && it.wishes && it.wishes.length) || 0), 0);
  const ERROR_TEXT = { empty: 'Give the list a name.', taken: 'You already have a list with that name.', missing: 'That list no longer exists.' };

  function create(ctx) {
    let data = { lists: {}, activeId: 'default' };   // kept current from storage
    let target = null;                               // the list the actions sheet is about
    let form = null;                                 // { mode: 'create' | 'rename', id }
    let merge = { into: null, picked: new Set() };

    const listOf = (id) => data.lists[id];
    const nameOf = (id) => (listOf(id) && listOf(id).name) || 'Wishlist';
    const changed = (id) => doc.dispatchEvent(new CustomEvent('wishListChanged', { detail: { id } }));

    // ---- sheets
    const lists = ctx.addSheet('lists', 'Wishlists', () => fillLists(), { footer: true });
    const actions = ctx.addSheet('listActions', 'List', () => fillActions());
    const formSheet = ctx.addSheet('listForm', 'New list', () => fillForm(), { footer: true });
    const mergeSheet = ctx.addSheet('listMerge', 'Merge lists', () => fillMerge(), { footer: true });
    const body = (sheet) => sheet.querySelector('.ui-sheet__body');
    const foot = (sheet) => sheet.querySelector('.ui-sheet__footslot');

    // ---- the list of lists
    function fillLists() {
      const rows = Object.keys(data.lists).map((id) => {
        const l = data.lists[id], n = countOf(l), current = id === data.activeId;
        return h('div', { class: ['ui-listrow', current && 'is-current'], data: { id } },
          h('button', {
            type: 'button', class: 'ui-listrow__main', aria: { label: `${l.name}, ${plural(n, 'wish', 'wishes')}${current ? ', current list' : ''}` },
            on: { click: () => switchTo(id) }
          },
          h('span', { class: 'ui-row__text' }, h('span', { class: 'ui-row__title' }, l.name), h('span', { class: 'ui-row__sub' }, plural(n, 'wish', 'wishes'))),
          current ? h('span', { class: 'ui-row__trail' }, UI.ICON.check) : null),
          UI.iconButton({ label: `Actions for ${l.name}`, icon: UI.ICON.more, onClick: (e) => { target = id; ctx.nav.open('listActions', { id }, { returnFocus: e.currentTarget }); } }));
      });
      body(lists).replaceChildren(h('div', { class: 'ui-field-gap' },
        h('p', { class: 'ui-note' }, 'Each list has its own wishes. Tap one to use it. The ⋯ has rename, duplicate, export, merge and delete.'),
        h('div', { class: 'ui-listlist' }, rows)));
      foot(lists).replaceChildren(h('div', { class: 'ui-builder__actions' },
        UI.button({ label: 'New list', variant: 'primary', size: 'lg', onClick: (e) => openForm({ mode: 'create' }, e.currentTarget) }),
        UI.button({ label: 'Import', variant: 'secondary', size: 'lg', onClick: () => importFile() })));
    }

    async function switchTo(id) {
      await AWStore.update((d) => { if (!d.lists[id]) return AWStore.SKIP; d.activeId = id; });
      changed(id);
      ctx.nav.close('lists');
    }

    // ---- what you can do with one list
    function fillActions() {
      const id = target, l = listOf(id);
      if (!l) { ctx.nav.close('listActions', { force: true }); return; }
      actions.setTitle(l.name);
      const others = Object.keys(data.lists).filter((x) => x !== id && x !== 'default');
      const row = (title, subtitle, onClick, className) => UI.row({ title, subtitle, onClick, className });
      body(actions).replaceChildren(h('div', { class: 'ui-sheetlist' },
        row('Rename', 'Change the name', (e) => { ctx.nav.close('listActions'); openForm({ mode: 'rename', id }, e && e.currentTarget); }),
        row('Duplicate', 'Make a copy to change freely', () => { ctx.nav.close('listActions'); duplicate(id); }),
        row('Export', 'Save this list as a file to share or back up', () => { ctx.nav.close('listActions'); if (root.awWishlistIO) root.awWishlistIO.exportList(id); }),
        others.length ? row('Merge other lists into this one', 'Combine their wishes here', (e) => { ctx.nav.close('listActions'); openMerge(id, e && e.currentTarget); }) : null,
        id === 'default' ? null : row('Delete', 'You can undo this', () => { ctx.nav.close('listActions'); remove(id); }, 'is-danger')));
    }

    async function duplicate(id) {
      let made = null;
      await AWStore.update((d) => { made = WS.duplicateList(d, id); if (!made) return AWStore.SKIP; });
      if (!made) return;
      changed(made);
      ctx.toast(`Copied as “${nameOf(made)}”.`);
    }

    async function remove(id) {
      let snap = null;
      await AWStore.update((d) => { snap = WS.removeList(d, id); if (!snap) return AWStore.SKIP; });
      if (!snap) return;
      changed('default');
      ctx.toast(`“${snap.list.name}” deleted.`, { undo: async () => {
        await AWStore.update((d) => { if (!WS.restoreList(d, snap)) return AWStore.SKIP; });
        changed(snap.id);
      } });
    }

    // ---- new list / rename
    function openForm(f, trigger) { form = f; ctx.nav.open('listForm', f, { returnFocus: trigger }); }

    function fillForm() {
      const renaming = form.mode === 'rename';
      formSheet.setTitle(renaming ? 'Rename list' : 'New list');
      const field = UI.textField({ label: 'Name', value: renaming ? nameOf(form.id) : '', maxLength: WS.LIST_NAME_MAX, hint: renaming ? '' : 'You can change it any time.', onSubmit: () => submit() });
      async function submit() {
        let result = 'ok', id = form.id;
        await AWStore.update((d) => {
          if (renaming) { result = WS.renameList(d, form.id, field.input.value); if (result !== 'ok') return AWStore.SKIP; return; }
          const r = WS.createList(d, field.input.value);
          if (r.error) { result = r.error; return AWStore.SKIP; }
          id = r.id;
        });
        if (result !== 'ok') { field.setError(ERROR_TEXT[result] || 'Couldn’t save that.'); field.input.focus(); return; }
        changed(id);
        ctx.nav.close('listForm', { force: true });
        if (!renaming && ctx.nav.isOpen('lists')) ctx.nav.close('lists');
        ctx.toast(renaming ? 'Renamed.' : `Created “${field.input.value.trim()}”. It’s the current list.`);
      }
      body(formSheet).replaceChildren(field);
      foot(formSheet).replaceChildren(UI.button({ label: renaming ? 'Save name' : 'Create list', variant: 'primary', size: 'lg', block: true, onClick: submit }));
      root.setTimeout(() => field.input.focus(), 50);
    }

    // ---- merge
    function openMerge(into, trigger) { merge = { into, picked: new Set() }; ctx.nav.open('listMerge', { into }, { returnFocus: trigger }); }

    function fillMerge() {
      const into = merge.into, dest = listOf(into);
      if (!dest) { ctx.nav.close('listMerge', { force: true }); return; }
      mergeSheet.setTitle(`Merge into “${dest.name}”`);
      const others = Object.keys(data.lists).filter((x) => x !== into && x !== 'default');
      const button = UI.button({ label: 'Merge', variant: 'primary', size: 'lg', block: true, disabled: true, onClick: () => doMerge() });
      const summary = h('p', { class: 'ui-note', role: 'status' });
      function paint() {
        const n = merge.picked.size;
        button.disabled = !n;
        button.querySelector('.ui-btn__label').textContent = n ? `Merge ${plural(n, 'list', 'lists')}` : 'Merge';
        summary.textContent = n
          ? `${plural(n, 'list', 'lists')} will be folded into “${dest.name}” and removed. You can undo it.`
          : 'Choose the lists to fold in.';
      }
      body(mergeSheet).replaceChildren(h('div', { class: 'ui-field-gap' },
        h('p', { class: 'ui-note' }, `Every roll from the lists you choose is added to “${dest.name}”. A roll that’s already there is kept once. The default list can’t be merged away.`),
        ...others.map((id) => UI.switchRow({
          label: nameOf(id), description: plural(countOf(listOf(id)), 'wish', 'wishes'), checked: merge.picked.has(id),
          onChange: (on) => { if (on) merge.picked.add(id); else merge.picked.delete(id); paint(); }
        })),
        summary));
      foot(mergeSheet).replaceChildren(button);
      paint();
    }

    async function doMerge() {
      const into = merge.into, picked = [...merge.picked];
      let result = null;
      await AWStore.update((d) => { result = WS.mergeLists(d, into, picked); if (!result) return AWStore.SKIP; });
      if (!result) { ctx.toast('Nothing to merge.'); return; }
      changed(into);
      ctx.nav.close('listMerge', { force: true });
      ctx.toast(`Merged ${plural(result.removed.length, 'list', 'lists')} into “${nameOf(into)}”: ${plural(result.added, 'wish', 'wishes')} added.`, { undo: async () => {
        await AWStore.update((d) => { if (!WS.undoMerge(d, result)) return AWStore.SKIP; });
        changed(into);
      } });
    }

    // ---- import
    function importFile() {
      if (!root.awWishlistIO) { ctx.toast('Import isn’t available right now.'); return; }
      root.awWishlistIO.triggerImport();
    }

    // ---- keeping in step
    const open = () => ['lists', 'listActions', 'listForm', 'listMerge'].some((n) => ctx.nav.isOpen(n));
    function refill() {
      if (ctx.nav.isOpen('lists')) fillLists();
      if (ctx.nav.isOpen('listActions')) fillActions();
      if (ctx.nav.isOpen('listMerge')) fillMerge();
    }
    root.chrome.storage.local.get(['dimData'], (res) => { data = res.dimData || data; });
    root.chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local' || !changes.dimData) return;
      data = changes.dimData.newValue || { lists: {}, activeId: 'default' };
      if (open()) refill();
    });
    return {};
  }

  root.AWListsScreen = { create };
})(typeof window !== 'undefined' ? window : globalThis);
