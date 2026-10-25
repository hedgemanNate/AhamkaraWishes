// Ahamkara Wishes — the redesigned app shell (D3).
//
//   app bar    list name (opens Lists) · sync chip (opens Sync) · + Wish · avatar (opens Me)
//   banner     the one sync/data message that needs attention
//   screens    Wishes · Drops · Inventory · Discover, switched by the tab bar
//   sheets     Lists, Sync status, Me
//
// Opt-in while the screens are built one at a time: add ?ui=next to the panel
// URL, or use "Try the new design" in the old Menu. Nothing about the old
// screens changes unless it's on. Their scripts keep running underneath as the
// engine (game data, sign-in, sync, matching); this file only draws.
//
// Needs aw-dom, aw-store, aw-nav, aw-ui, sync-status and wishlist-sync-core.

(function (root) {
  'use strict';

  const D = root.AWDom, UI = root.AWUI, doc = root.document;
  const { h, raw } = D;
  const FLAG_KEY = 'aw-ui';

  // ---- on/off ---------------------------------------------------------------

  function param() { try { return new URLSearchParams(root.location.search).get('ui'); } catch (e) { return null; } }

  /** ?ui=next turns it on, ?ui=classic turns it off; otherwise the remembered choice. */
  function enabled() {
    const p = param();
    if (p === 'next') return true;
    if (p === 'classic') return false;
    try { return root.localStorage.getItem(FLAG_KEY) === 'next'; } catch (e) { return false; }
  }

  function setEnabled(on) {
    try { if (on) root.localStorage.setItem(FLAG_KEY, 'next'); else root.localStorage.removeItem(FLAG_KEY); } catch (e) { /* storage blocked */ }
    const url = new URL(root.location.href);
    url.searchParams.set('ui', on ? 'next' : 'classic');
    root.location.href = url.toString();
  }

  // ---- icons (our own markup) ---------------------------------------------------

  const svg = (d) => raw(`<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">${d}</svg>`);
  const TAB_ICON = {
    wishes: svg('<path d="M12 3.5l2.6 5.4 5.9.8-4.3 4.1 1 5.9L12 17l-5.2 2.7 1-5.9L3.5 9.7l5.9-.8z"/>'),
    drops: svg('<path d="M12 3.5c3 3.6 5.5 6.4 5.5 9.5a5.5 5.5 0 11-11 0c0-3.1 2.5-5.9 5.5-9.5z"/>'),
    inventory: svg('<path d="M4 8l8-4 8 4v8l-8 4-8-4zM4 8l8 4 8-4M12 12v8"/>'),
    discover: svg('<circle cx="12" cy="12" r="8.5"/><path d="M15.5 8.5l-2 5-5 2 2-5z"/>')
  };
  const CARET = raw('<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true" focusable="false"><path d="M9 6l6 6-6 6" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" fill="none"/></svg>');
  const PERSON = raw('<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" focusable="false"><circle cx="12" cy="9" r="3.6" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M5 20c.8-3.6 3.6-5.4 7-5.4s6.2 1.8 7 5.4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>');

  const TABS = [
    { id: 'wishes', label: 'Wishes' },
    { id: 'drops', label: 'Drops' },
    { id: 'inventory', label: 'Inventory' },
    { id: 'discover', label: 'Discover' }
  ];

  // ---- state the shell shows -----------------------------------------------------------

  const store = {
    auth: { signedIn: false, expired: false, name: '' },
    manifest: 'downloading',
    lists: [],           // [{ id, name, count }]
    activeId: 'default'
  };

  function readAuth(res) {
    const s = res && res.bungie_auth;
    const signedIn = !!(s && s.access_token);
    const user = signedIn && s.user ? (s.user.user || s.user) : null;
    store.auth = {
      signedIn,
      expired: !!(res && res.bungie_session_expired),
      name: (user && (user.cachedBungieGlobalDisplayName || user.displayName || user.uniqueName || user.bnetDisplayName)) || ''
    };
  }

  function readLists(dimData) {
    const lists = (dimData && dimData.lists) || {};
    store.activeId = (dimData && dimData.activeId && lists[dimData.activeId]) ? dimData.activeId : (Object.keys(lists)[0] || 'default');
    store.lists = Object.keys(lists).map((id) => {
      const items = (lists[id] && lists[id].items) || {};
      const count = Object.values(items).reduce((n, it) => n + ((it && it.wishes && it.wishes.length) || 0), 0);
      return { id, name: (lists[id] && lists[id].name) || id, count };
    });
  }

  /** The inputs AWSync.describe wants, from what the shell knows right now. */
  function syncState() {
    const snap = (root.appManager && root.appManager.getSyncSnapshot && root.appManager.getSyncSnapshot()) || {};
    return AWSync.describe({
      signedIn: store.auth.signedIn,
      sessionExpired: store.auth.expired,
      online: root.navigator ? root.navigator.onLine : true,
      manifest: store.manifest,
      syncing: !!snap.syncing,
      lastSyncAt: snap.lastSyncAt || undefined,
      lastError: snap.lastError || null,
      now: Date.now()
    });
  }

  // ---- building the shell ---------------------------------------------------------------

  function mount() {
    if (!enabled() || doc.getElementById('ui-shell')) return null;
    doc.documentElement.classList.add('ui-next');

    // Everything except the sheets: made inert while a sheet is open.
    const base = h('div', { class: 'ui-shell__base' });
    const nav = root.AWNav.create({ base, remember: 'aw-next-tab' });
    const views = {};
    const tabButtons = {};

    // --- app bar
    const listName = h('button', { type: 'button', class: 'ui-listname', aria: { haspopup: 'dialog' }, on: { click: (e) => openSheet('lists', e.currentTarget) } },
      h('span', { class: 'ui-listname__text' }, 'Wishes'), h('span', { class: 'ui-listname__caret', aria: { hidden: true } }, CARET));
    const syncChip = h('button', { type: 'button', class: 'ui-syncchip', on: { click: (e) => openSheet('sync', e.currentTarget) } });
    const addWish = UI.button({ label: '+ Wish', variant: 'primary', onClick: () => startWish() });
    addWish.classList.add('ui-addwish');
    const avatar = h('button', { type: 'button', class: 'ui-avatar', aria: { label: 'Account' }, on: { click: (e) => openSheet('me', e.currentTarget) } },
      h('span', { class: 'ui-avatar__disc' }, PERSON));
    const appbar = h('header', { class: 'ui-appbar' },
      h('div', { class: 'ui-appbar__title' }, listName), syncChip, addWish, avatar);

    const bannerSlot = h('div', { class: 'ui-banner-slot' });

    // --- sheets (the three of the shell; screens add their own through ctx.addSheet)
    const sheets = {};
    const sheetEls = [];
    let shell = null;
    function addSheet(name, title, onOpen) {
      const layer = UI.sheet({ title, body: h('div'), onClose: () => nav.close(name) });
      sheets[name] = layer;
      nav.addLayer(name, { el: layer, kind: 'sheet', onOpen });
      sheetEls.push(layer);
      if (shell) shell.appendChild(layer);
      return layer;
    }

    // --- screens
    const main = h('main', { class: 'ui-main', id: 'ui-main' });
    const ctx = {
      nav, store, UI, AWDom: D, addSheet,
      toast: UI.toast,
      openSheet,
      startWish,
      goClassic: () => setEnabled(false),
      syncNow: () => root.appManager && root.appManager.syncNow && root.appManager.syncNow(true)
    };
    const wishes = root.AWWishes ? root.AWWishes.create(ctx) : null;
    views.wishes = h('section', { class: 'ui-screen', id: 'ui-screen-wishes', hidden: true }, wishes ? wishes.el : null);
    views.drops = comingSoon('Drops', 'Drops, your new matching rolls as they land, is the next screen to move over.');
    views.inventory = comingSoon('Inventory', 'Inventory search is the next screen to move over.');
    views.discover = h('section', { class: 'ui-screen', id: 'ui-screen-discover', hidden: true },
      UI.emptyState({
        title: 'Discover', body: 'Community and creator wishlists.',
        actions: [UI.button({ label: 'Open Discover', variant: 'primary', onClick: openDiscover })]
      }));
    TABS.forEach((t) => main.appendChild(views[t.id]));

    function comingSoon(title, body) {
      return h('section', { class: 'ui-screen', id: `ui-screen-${title.toLowerCase()}`, hidden: true },
        h('div', { class: 'ui-stub' }, UI.emptyState({
          title: `${title} is coming`, body,
          actions: [UI.button({ label: 'Use the classic design for now', variant: 'secondary', onClick: ctx.goClassic })]
        })));
    }

    // --- tab bar
    const tabbar = h('nav', { class: 'ui-tabbar', aria: { label: 'Sections' } },
      TABS.map((t) => {
        const b = h('button', { type: 'button', class: 'ui-tab', data: { tab: t.id }, on: { click: () => nav.show(t.id) } },
          TAB_ICON[t.id], h('span', null, t.label));
        tabButtons[t.id] = b;
        return b;
      }));
    TABS.forEach((t) => nav.addTab(t.id, { view: views[t.id], button: tabButtons[t.id] }));

    addSheet('lists', 'Wishlists', () => fillSheet('lists'));
    addSheet('sync', 'Sync', () => fillSheet('sync'));
    addSheet('me', 'Account', () => fillSheet('me'));

    base.append(appbar, bannerSlot, main, tabbar);
    shell = h('div', { id: 'ui-shell', class: 'ui-root ui-shell' }, base, sheetEls);
    doc.body.appendChild(shell);

    function openSheet(name, trigger) { nav.open(name, {}, { returnFocus: trigger }); }
    function sheetBody(name) { return sheets[name].querySelector('.ui-sheet__body'); }
    function setBody(name, ...nodes) { const b = sheetBody(name); b.replaceChildren(); nodes.flat().forEach((n) => n && b.appendChild(n)); }

    function startWish() {
      ctx.toast('The new wish builders are the next step.', { action: { label: 'Use classic', onClick: ctx.goClassic } });
    }

    function openDiscover() {
      const btn = doc.getElementById('nav-discover');
      if (btn) btn.click();
    }

    // --- sheet content
    function fillSheet(name) {
      if (name === 'lists') {
        setBody('lists', h('div', { class: 'ui-sheetlist' }, store.lists.map((l) => UI.row({
          title: l.name, subtitle: `${l.count} ${l.count === 1 ? 'wish' : 'wishes'}`,
          className: l.id === store.activeId ? 'is-current' : undefined,
          trailing: l.id === store.activeId ? UI.ICON.check : null,
          label: `${l.name}, ${l.count} wishes${l.id === store.activeId ? ', current list' : ''}`,
          onClick: () => switchList(l.id)
        }))));
      } else if (name === 'sync') {
        const s = syncState();
        const actions = [];
        if (s.action) actions.push(UI.button({ label: s.action.label, variant: 'primary', block: true, onClick: () => runAction(s.action.kind) }));
        setBody('sync', h('div', { class: 'ui-field-gap' }, h('p', { class: 'ui-note' }, s.body), actions));
        sheets.sync.setTitle(s.title);
      } else if (name === 'me') {
        const a = store.auth;
        setBody('me', h('div', { class: 'ui-field-gap' },
          UI.row({
            title: a.signedIn ? (a.name || 'Signed in') : 'Not signed in',
            subtitle: a.signedIn ? 'Bungie account' : 'Sign in to see which wishes you already own.'
          }),
          a.signedIn
            ? UI.button({ label: 'Sign out', variant: 'secondary', block: true, onClick: () => { nav.close('me'); if (root.bungieAuth) root.bungieAuth.signOut(); } })
            : UI.button({ label: 'Sign in with Bungie', variant: 'primary', block: true, onClick: () => { nav.close('me'); runAction('signin'); } }),
          UI.button({ label: 'Back to the classic design', variant: 'ghost', block: true, onClick: ctx.goClassic })));
      }
    }

    function runAction(kind) {
      if (kind === 'signin') { if (root.bungieAuth) root.bungieAuth.signIn().catch((e) => ctx.toast(e && e.message ? e.message : 'Sign-in failed.')); }
      else if (kind === 'download') { if (root.ensureInventoryItemDefsReady) root.ensureInventoryItemDefsReady({ force: true }).then(() => root.location.reload()); }
      else ctx.syncNow();
      if (nav.isOpen('sync')) nav.close('sync');
    }

    function switchList(id) {
      AWStore.update((data) => {
        if (!data.lists || !data.lists[id]) return AWStore.SKIP;
        data.activeId = id;
      }).then(() => {
        doc.dispatchEvent(new CustomEvent('wishListChanged', { detail: { id } }));
        nav.close('lists');
      });
    }

    // --- repaint
    function paint() {
      const s = syncState();
      const active = store.lists.find((l) => l.id === store.activeId);
      listName.querySelector('.ui-listname__text').textContent = (active && active.name) || 'Wishes';
      listName.setAttribute('aria-label', `Wishlist: ${(active && active.name) || 'Wishes'}. Change list`);
      syncChip.replaceChildren(h('span', { class: ['ui-dot', `ui-dot--${s.chip.tone}`], aria: { hidden: true } }), h('span', { class: 'ui-syncchip__label' }, s.chip.label));
      syncChip.setAttribute('aria-label', `Sync: ${s.title}`);
      avatar.classList.toggle('is-signed-in', store.auth.signedIn);
      const initials = store.auth.name.trim().slice(0, 2).toUpperCase();
      avatar.querySelector('.ui-avatar__disc').replaceChildren(initials ? doc.createTextNode(initials) : h('span', { class: 'ui-avatar__glyph' }, PERSON));
      bannerSlot.replaceChildren();
      if (s.banner) {
        bannerSlot.appendChild(UI.banner({
          tone: s.banner.tone, text: s.banner.text,
          action: s.banner.action ? { label: s.banner.action.label, onClick: () => runAction(s.banner.action.kind) } : null
        }));
      }
      if (nav.isOpen('sync') || nav.isOpen('lists') || nav.isOpen('me')) fillSheet(nav.top);
    }

    // --- wiring
    chrome.storage.local.get(['dimData', 'bungie_auth', 'bungie_session_expired'], (res) => {
      readAuth(res); readLists(res.dimData); paint();
    });
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local') return;
      if (changes.dimData) { readLists(changes.dimData.newValue); paint(); }
      if (changes.bungie_auth || changes.bungie_session_expired) {
        chrome.storage.local.get(['bungie_auth', 'bungie_session_expired'], (res) => { readAuth(res); paint(); });
      }
    });
    doc.addEventListener('awSyncChanged', paint);
    doc.addEventListener('awManifestReady', () => { store.manifest = 'ready'; paint(); });
    const overlay = doc.getElementById('loading-overlay');
    store.manifest = !overlay || overlay.classList.contains('hidden') ? 'ready' : 'downloading';
    root.addEventListener('online', paint);
    root.addEventListener('offline', paint);
    // "Synced 2m ago" stays honest while nothing else changes.
    root.setInterval(() => { if (!doc.hidden) paint(); }, 30000);

    // Opening the Discover tab opens the Discover sheet (the old one, until it is rebuilt).
    let lastTab = null, started = false;
    nav.onChange((s) => {
      if (started && s.tab === 'discover' && lastTab !== 'discover') openDiscover();
      lastTab = s.tab;
    });
    nav.restore('wishes');
    started = true;
    paint();

    return { nav, ctx, paint, el: shell };
  }

  root.AWShell = { mount, enabled, setEnabled };

  doc.addEventListener('DOMContentLoaded', () => {
    root.AWShell.instance = mount();
    // The classic Menu's switch into the new design.
    const tryIt = doc.getElementById('try-new-design');
    if (tryIt) tryIt.addEventListener('click', () => setEnabled(true));
  });
})(typeof window !== 'undefined' ? window : globalThis);
