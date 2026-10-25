// Gallery of AWUI building blocks (dev tool). Also the fixture that
// tools/preview/ui-check.js drives to test the blocks in real Chrome.
(function () {
  'use strict';
  const { h } = AWDom;
  const UI = AWUI;
  const w = Number(new URLSearchParams(location.search).get('w')) || 360;
  const frame = document.getElementById('frame');
  const g = document.getElementById('gallery');
  frame.style.width = w + 'px';
  document.getElementById('g-width').textContent = String(w);

  const log = [];
  const section = (title, ...kids) => g.appendChild(h('section', { class: 'g-section', data: { section: title } }, h('h2', null, title), kids));
  const wrap = (...kids) => h('div', { class: 'g-wrap' }, kids);

  // Buttons
  section('Buttons',
    wrap(UI.button({ label: 'Save to Main Wishlist', variant: 'primary' }), UI.button({ label: 'Secondary' })),
    wrap(UI.button({ label: 'Delete list', variant: 'danger' }), UI.button({ label: 'Ghost', variant: 'ghost' }), UI.button({ label: 'Disabled', variant: 'primary', disabled: true })),
    UI.button({ label: 'Large block', variant: 'primary', size: 'lg', block: true }),
    wrap(UI.iconButton({ label: 'More actions' }), UI.iconButton({ label: 'Close', icon: UI.ICON.close }), UI.iconButton({ label: 'Filters', icon: UI.ICON.filter })));

  // Chips
  const chipState = { owned: false };
  const ownedChip = UI.chip({ label: 'Owned', selected: false, onClick: () => { chipState.owned = !chipState.owned; ownedChip.classList.toggle('is-selected', chipState.owned); ownedChip.setAttribute('aria-pressed', String(chipState.owned)); } });
  ownedChip.id = 'g-owned-chip';
  section('Chips',
    UI.chipRow([ownedChip, UI.chip({ label: 'Hand Cannon', selected: true }), UI.chip({ label: 'Solar', count: 4 }), UI.chip({ label: 'Primary' }), UI.chip({ label: 'Kinetic' }), UI.chip({ label: 'Strand' })], { label: 'Quick filters' }),
    UI.chipRow([UI.chip({ label: 'Gunner', onRemove: () => log.push('removed') })], { label: 'Active filters' }));

  // Segmented
  const seg = UI.segmented({ label: 'Wish type', value: 'weapons', options: [{ value: 'weapons', label: 'Weapons', badge: 12 }, { value: 'armor', label: 'Armor', badge: 8 }], onChange: (v) => log.push('seg:' + v) });
  seg.id = 'g-seg';
  section('Segmented control', seg,
    UI.segmented({ label: 'Mode', value: 'pve', options: [{ value: 'pve', label: 'PvE' }, { value: 'pvp', label: 'PvP' }] }));

  // Search
  const search = UI.searchField({ label: 'Search wishes', placeholder: 'Search weapons', onInput: (v) => log.push('search:' + v) });
  search.id = 'g-search';
  section('Search', search);

  // Rows, cards, badges
  const img = (src) => h('img', { src, alt: '', width: 44, height: 44, style: { borderRadius: '7px' } });
  section('Rows and cards',
    UI.card(
      UI.row({ leading: img('icons/icon48.png'), title: 'Fatebringer', subtitle: 'Hand Cannon · Primary · 2 rolls', trailing: UI.badge('Owned ×2', 'accent'), onClick: () => log.push('row') , label: 'Fatebringer, actions' }),
      UI.row({ leading: img('icons/icon48.png'), title: 'A very long weapon name that has to wrap instead of overflowing the panel', subtitle: 'Sidearm', trailing: UI.badge('PvP', 'pvp') })),
    wrap(UI.badge('PvE', 'pve'), UI.badge('PvP', 'pvp'), UI.badge('Owned', 'accent'), UI.badge('Not yet'), UI.badge('Locked', 'success'), UI.badge('Paused', 'warning'), UI.badge('Failed', 'danger')));

  // Switches
  const sw = UI.switchRow({ label: 'Lock new matches', description: 'So they can’t be dismantled by accident', checked: true, onChange: (v) => log.push('lock:' + v) });
  sw.id = 'g-switch';
  section('Switches', UI.card(sw, UI.switchRow({ label: 'Move new matches to vault', description: 'Off unless you turn it on', checked: false })));

  // Status
  const now = Date.now();
  const states = [
    {}, { syncing: true }, { manifest: 'downloading', manifestProgress: 37 }, { manifest: 'missing' }, { online: false },
    { sessionExpired: true }, { signedIn: false }, { lastError: { code: 5 } }, { lastError: new Error('x') }
  ].map((over) => AWSync.describe(Object.assign({ signedIn: true, online: true, manifest: 'ready', lastSyncAt: now - 125000, now }, over)));
  section('Sync states (D11)',
    UI.card(...states.map((s) => UI.row({ title: s.title, subtitle: s.body, trailing: UI.badge(s.chip.label, { ok: 'success', busy: 'accent', warning: 'warning', danger: 'danger' }[s.chip.tone] || 'muted') }))),
    ...states.filter((s) => s.banner).map((s) => UI.banner({ tone: s.banner.tone, text: s.banner.text, action: s.banner.action ? { label: s.banner.action.label, onClick: () => log.push('banner') } : null })));

  section('Progress', UI.progress({ value: 37, label: 'Getting game data' }));

  section('Empty state', UI.card(UI.emptyState({ icon: '✦', title: 'No weapon wishes yet', body: 'Pick the perks you want on a weapon and we’ll tell you when one drops.', actions: [UI.button({ label: 'New weapon wish', variant: 'primary' }), UI.button({ label: 'More ways to add', variant: 'ghost' })] })));

  // Navigation: a tab and two stacked sheets, driven by AWNav
  const nav = AWNav.create({ base: g });
  const openBtn = UI.button({ label: 'Open the lists sheet', onClick: (e) => nav.open('lists', {}, { returnFocus: e.currentTarget }) });
  openBtn.id = 'g-open-sheet';
  const listsSheet = UI.sheet({
    title: 'Wishlists',
    onClose: () => nav.close('lists'),
    body: UI.card(
      UI.row({ title: 'Main Wishlist', subtitle: '20 wishes · 9 owned', trailing: UI.ICON.check, onClick: () => {} }),
      UI.row({ title: 'Raid & Dungeon', subtitle: '14 wishes', onClick: (e) => nav.open('filters', {}, { returnFocus: e.currentTarget }) })),
    footer: [UI.button({ label: 'Import file' }), UI.button({ label: '+ New list', variant: 'primary', size: 'lg' })]
  });
  listsSheet.id = 'g-lists';
  const allWishes = [{ type: 'Hand Cannon', elem: 'Solar' }, { type: 'Hand Cannon', elem: 'Kinetic' }, { type: 'Glaive', elem: 'Strand' }, { type: 'Grenade Launcher', elem: 'Kinetic' }];
  const fb = UI.filterSheetBody({
    sections: [{ key: 'type', title: 'Type', options: ['Hand Cannon', 'Glaive', 'Grenade Launcher'].map((v) => ({ value: v, label: v })) },
               { key: 'elem', title: 'Element', options: ['Kinetic', 'Solar', 'Strand'].map((v) => ({ value: v, label: v })) }],
    selected: {}, noun: ['wish', 'wishes'],
    count: (sel) => allWishes.filter((x) => (!sel.type.size || sel.type.has(x.type)) && (!sel.elem.size || sel.elem.has(x.elem))).length,
    onApply: () => nav.close('filters')
  });
  const filters = UI.sheet({ title: 'Filters', onClose: () => nav.close('filters'), body: fb.body, footer: fb.footer });
  filters.id = 'g-filters';
  frame.appendChild(listsSheet); frame.appendChild(filters);
  nav.addLayer('lists', { el: listsSheet, kind: 'sheet' });
  nav.addLayer('filters', { el: filters, kind: 'sheet' });

  const confirmBtn = UI.button({ label: 'Remove from Discover…', variant: 'danger', onClick: async () => {
    const ok = await UI.confirm({ title: 'Remove this list from Discover?', body: 'Other people will no longer see it. Anyone who saved it keeps their copy. This can’t be undone.', confirmLabel: 'Remove', danger: true });
    log.push('confirm:' + ok);
  } });
  confirmBtn.id = 'g-confirm';
  const toastBtn = UI.button({ label: 'Delete a roll (toast with Undo)', onClick: () => UI.toast('Roll deleted.', { undo: () => log.push('undo') }) });
  toastBtn.id = 'g-toast';
  section('Sheets, dialog, toast', wrap(openBtn), wrap(confirmBtn), wrap(toastBtn),
    h('p', { class: 'g-note' }, 'Sheets are AWNav layers: the content behind becomes inert, focus moves in and back, Escape closes.'));

  window.__gallery = { nav, log, width: w };
})();
