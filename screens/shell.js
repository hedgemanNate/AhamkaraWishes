// Ahamkara Wishes — the redesigned app shell (D3).
//
//   app bar    list name (opens Lists) · sync chip (opens Sync) · + Wish · avatar (opens Me)
//   banner     the one sync/data message that needs attention
//   screens    Wishes · Drops · Inventory · Discover, switched by the tab bar
//   sheets     Lists, Sync status, Me
//
// On by default. ?ui=classic (or Account > Back to the classic design) shows the
// old screens instead, until they are removed. Their scripts keep running
// underneath as the engine (game data, sign-in, sync, matching); this file only
// draws.
//
// Needs aw-dom, aw-store, aw-nav, aw-ui, sync-status and wishlist-sync-core.

(function (root) {
  'use strict';

  const D = root.AWDom, UI = root.AWUI, doc = root.document;
  const { h, raw } = D;
  const FLAG_KEY = 'aw-ui';

  // ---- on/off ---------------------------------------------------------------

  function param() { try { return new URLSearchParams(root.location.search).get('ui'); } catch (e) { return null; } }

  /**
   * The new design is the default. ?ui=classic (or "Back to the classic design" in
   * Account, which remembers it) turns it off; ?ui=next turns it back on.
   */
  function enabled() {
    const p = param();
    // ?ui=next also clears a remembered "classic"; ?ui=classic is only for this visit.
    if (p === 'next') { try { root.localStorage.setItem(FLAG_KEY, 'next'); } catch (e) { /* storage blocked */ } return true; }
    if (p === 'classic') return false;
    try { return root.localStorage.getItem(FLAG_KEY) !== 'classic'; } catch (e) { return true; }
  }

  function setEnabled(on) {
    try { root.localStorage.setItem(FLAG_KEY, on ? 'next' : 'classic'); } catch (e) { /* storage blocked */ }
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
    auth: { signedIn: false, expired: false, name: '', avatar: '' },
    manifest: 'downloading',
    isAdmin: false,
    manifestProgress: null,   // 0-100 while game data downloads, else null
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
      name: (user && (user.cachedBungieGlobalDisplayName || user.displayName || user.uniqueName || user.bnetDisplayName)) || '',
      avatar: user && (user.profilePicturePath || user.ProfilePicturePath) ? `https://www.bungie.net${user.profilePicturePath || user.ProfilePicturePath}` : ''
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
      manifestProgress: store.manifestProgress === null ? undefined : store.manifestProgress,
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
    function addSheet(name, title, onOpen, opts = {}) {
      const layer = UI.sheet({ title, body: h('div'), footer: opts.footer ? h('div', { class: 'ui-sheet__footslot' }) : undefined, onClose: () => nav.close(name) });
      sheets[name] = layer;
      nav.addLayer(name, { el: layer, kind: 'sheet', onOpen });
      sheetEls.push(layer);
      if (shell) shell.appendChild(layer);
      return layer;
    }

    /** A screen that opens over the tabs (weapon detail, builders) with a Back button. */
    function addScreen(name, title, onOpen, opts = {}) {
      const titleEl = h('h2', { class: 'ui-subscreen__title' }, title);
      const body = h('div', { class: 'ui-subscreen__body' });
      const el = h('section', { class: 'ui-subscreen', hidden: true, aria: { labelledby: `ui-sub-${name}` } },
        h('div', { class: 'ui-subscreen__head' },
          UI.iconButton({ label: 'Back', icon: UI.ICON.chevron, className: 'ui-subscreen__back', onClick: () => nav.close(name) }), titleEl), body);
      titleEl.id = `ui-sub-${name}`;
      nav.addLayer(name, { el, kind: 'screen', onOpen, canClose: opts.canClose, onClose: opts.onClose });
      sheetEls.push(el);
      if (shell) shell.appendChild(el);
      return { el, body, setTitle: (t) => { titleEl.textContent = t; } };
    }

    // --- screens
    const main = h('main', { class: 'ui-main', id: 'ui-main' });
    const ctx = {
      nav, store, UI, AWDom: D, addSheet, addScreen,
      toast: UI.toast,
      openSheet,
      startWish, editWish, startFromOwned, openGodroll: () => openGodroll(),
      openAutomation: (trigger) => { if (drops) drops.openAutomation(trigger); },
      goClassic: () => setEnabled(false),
      signIn: () => runAction('signin'),
      /** Shows how many new things a tab has (0 hides it). */
      setTabBadge(tab, n) {
        const b = tabButtons[tab] && tabButtons[tab].querySelector('.ui-tab__badge');
        if (!b) return;
        b.hidden = !n; b.textContent = !n ? '' : n > 99 ? '99+' : String(n);
        tabButtons[tab].setAttribute('aria-label', n ? `${TABS.find((t) => t.id === tab).label}, ${n} new` : TABS.find((t) => t.id === tab).label);
      },
      /** Opens a wish's detail from elsewhere (a Drop). Says so if it's in another list. */
      openWish(hash, trigger, listName) {
        nav.show('wishes');
        if (!(wishes && wishes.openItem(hash, trigger || tabButtons.wishes))) {
          const current = store.lists.find((l) => l.id === store.activeId);
          const elsewhere = listName && !(current && current.name === listName);
          UI.toast(elsewhere ? `That wish is in “${listName}”. Switch lists to see it.` : 'That wish is no longer in this list.');
        }
      },
      syncNow: () => root.appManager && root.appManager.syncNow && root.appManager.syncNow(true)
    };
    const wishes = root.AWWishes ? root.AWWishes.create(ctx) : null;
    const inventory = root.AWInventoryScreen ? root.AWInventoryScreen.create(ctx) : null;
    if (root.AWListsScreen) root.AWListsScreen.create(ctx);
    // After the Wishes and Inventory screens: full-screen layers stack in page order, and a builder opened from a detail screen must sit above it.
    ctx.weaponBuilder = root.AWWeaponBuilderScreen ? root.AWWeaponBuilderScreen.create(ctx) : null;
    ctx.armorBuilder = root.AWArmorBuilderScreen ? root.AWArmorBuilderScreen.create(ctx) : null;
    views.wishes = h('section', { class: 'ui-screen', id: 'ui-screen-wishes', hidden: true }, wishes ? wishes.el : null);
    const drops = root.AWDropsScreen ? root.AWDropsScreen.create(ctx) : null;
    views.drops = h('section', { class: 'ui-screen', id: 'ui-screen-drops', hidden: true }, drops ? drops.el : null);
    views.inventory = h('section', { class: 'ui-screen', id: 'ui-screen-inventory', hidden: true }, inventory ? inventory.el : null);
    const discover = root.AWDiscoverScreen ? root.AWDiscoverScreen.create(ctx) : null;
    views.discover = h('section', { class: 'ui-screen', id: 'ui-screen-discover', hidden: true }, discover ? discover.el : null);
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
          TAB_ICON[t.id], h('span', null, t.label), h('span', { class: 'ui-tab__badge', hidden: true, aria: { hidden: true } }));
        tabButtons[t.id] = b;
        return b;
      }));
    TABS.forEach((t) => nav.addTab(t.id, { view: views[t.id], button: tabButtons[t.id] }));

    addSheet('sync', 'Sync', () => fillSheet('sync'));
    addSheet('me', 'Account', () => fillSheet('me'));
    addSheet('newWish', 'New wish', () => fillSheet('newWish'));
    addSheet('godrollAccess', 'Godroll.tv', () => fillSheet('godrollAccess'), { footer: true });

    base.append(appbar, bannerSlot, main, tabbar);
    shell = h('div', { id: 'ui-shell', class: 'ui-root ui-shell' }, base, sheetEls);
    doc.body.appendChild(shell);

    function openSheet(name, trigger) { nav.open(name, {}, { returnFocus: trigger }); }
    function sheetBody(name) { return sheets[name].querySelector('.ui-sheet__body'); }
    function setBody(name, ...nodes) { const b = sheetBody(name); b.replaceChildren(); nodes.flat().forEach((n) => n && b.appendChild(n)); }

    const builderMissing = () => ctx.toast('The new wish builders are the next step.', { action: { label: 'Use classic', onClick: ctx.goClassic } });

    // ---- Godroll.tv and DIM. Access to godroll.tv is optional (godroll-access.js): the first
    // visit without it explains first; once it is held the link just opens.
    const GODROLL_URL = 'https://godroll.tv/';
    let godrollGranted = false; // cached: chrome.permissions.request() must run synchronously inside the click
    if (root.GodrollAccess && root.chrome && root.chrome.permissions) {
      const refreshGranted = () => root.GodrollAccess.has().then((v) => { godrollGranted = v; }, () => {});
      refreshGranted();
      root.chrome.permissions.onAdded.addListener(refreshGranted);
      root.chrome.permissions.onRemoved.addListener(refreshGranted);
    }
    function openSite(url) { try { root.chrome.tabs.create({ url }); } catch (e) { root.open(url, '_blank', 'noopener'); } }
    function openGodroll() {
      if (godrollGranted || !root.GodrollAccess || !root.chrome.permissions) { openSite(GODROLL_URL); return; }
      nav.open('godrollAccess', {}, { returnFocus: addWish });
    }
    function allowGodroll() {
      nav.close('godrollAccess');
      root.GodrollAccess.request()
        .then((ok) => (ok ? root.chrome.runtime.sendMessage({ type: 'ahamkara:sync-godroll-access' }).then(() => ok) : ok))
        .catch(() => false)
        .then((ok) => {
          openSite(GODROLL_URL);
          if (!ok) ctx.toast('Opened Godroll.tv without the Ahamkara Wish button. You can allow access next time.');
        });
    }

    /** Starts a new wish: a weapon or armor. Without a kind, asks which. */
    function startWish(kind) {
      if (kind === 'weapon') { if (ctx.weaponBuilder) ctx.weaponBuilder.start(); else builderMissing(); return; }
      if (kind === 'armor') { if (ctx.armorBuilder) ctx.armorBuilder.start(); else builderMissing(); return; }
      openSheet('newWish', addWish);
    }

    /** Edits one saved roll: { kind, hash, index, key, item, wish }. */
    function editWish(p, trigger) {
      if (p && p.kind === 'weapon' && ctx.weaponBuilder) ctx.weaponBuilder.edit(p, trigger);
      else if (p && p.kind === 'armor' && ctx.armorBuilder) ctx.armorBuilder.edit(p, trigger);
      else builderMissing();
    }

    /** A new wish that starts from the perks of an owned copy (Inventory). `input` is AWInventory.wishInput's. */
    function startFromOwned(input, trigger) {
      if (input && input.kind === 'weapon' && ctx.weaponBuilder) ctx.weaponBuilder.fromOwned(input.hash, input.name, input.activeBySocketIndex, trigger);
      else if (input && input.kind === 'armor' && ctx.armorBuilder) ctx.armorBuilder.fromOwned(input, trigger);
      else builderMissing();
    }

    // --- sheet content
    function fillSheet(name) {
      if (name === 'newWish') {
        setBody('newWish', h('div', { class: 'ui-field-gap' }, h('div', { class: 'ui-sheetlist' },
          UI.row({ title: 'Weapon wish', subtitle: 'Choose a weapon and the perks you want', trailing: UI.ICON.chevron, onClick: () => { nav.close('newWish'); startWish('weapon'); } }),
          UI.row({ title: 'Armor wish', subtitle: 'Choose an archetype for a set', trailing: UI.ICON.chevron, onClick: () => { nav.close('newWish'); startWish('armor'); } })),
          h('div', { class: 'ui-sectiontitle' }, 'Pick rolls on another site'),
          h('div', { class: 'ui-sheetlist' },
            UI.row({ title: 'Godroll.tv', subtitle: 'Pick perks on a weapon page, then press Ahamkara Wish', trailing: UI.ICON.chevron, onClick: () => { nav.close('newWish'); openGodroll(); } }),
            UI.row({ title: 'Destiny Item Manager', subtitle: 'Opens DIM in a new tab', trailing: UI.ICON.chevron, onClick: () => { nav.close('newWish'); openSite('https://app.destinyitemmanager.com/'); } }))));
      } else if (name === 'godrollAccess') {
        // Chrome's own permission prompt can't be reworded, so say what it is first. "Allow access"
        // is the click Chrome needs to show that prompt, so it asks synchronously.
        setBody('godrollAccess', h('div', { class: 'ui-field-gap' },
          h('p', { class: 'ui-note' }, 'Pick perks on any Godroll.tv weapon page, then press ', h('strong', null, 'Ahamkara Wish'), ' to save that roll to one of your lists. No rebuilding it here.'),
          h('p', { class: 'ui-note' }, 'Chrome will ask to let Ahamkara Wishes “read and change” godroll.tv. That’s only so it can add the button and read the perks you select. Nothing is sent anywhere, and you can turn it off any time in Chrome’s extension settings.')));
        sheets.godrollAccess.querySelector('.ui-sheet__footslot').replaceChildren(h('div', { class: 'ui-field-gap' },
          UI.button({ label: 'Allow access', variant: 'primary', size: 'lg', block: true, onClick: allowGodroll }),
          UI.button({ label: 'Just open Godroll.tv', variant: 'ghost', block: true, onClick: () => { nav.close('godrollAccess'); openSite(GODROLL_URL); } })));
      } else if (name === 'sync') {
        const s = syncState();
        const actions = [];
        if (s.action) actions.push(UI.button({ label: s.action.label, variant: 'primary', block: true, onClick: () => runAction(s.action.kind) }));
        setBody('sync', h('div', { class: 'ui-field-gap' }, h('p', { class: 'ui-note' }, s.body), actions));
        sheets.sync.setTitle(s.title);
      } else if (name === 'me') {
        const a = store.auth;
        const avatar = D.safeImageUrl(a.avatar);
        const version = (() => { try { return root.chrome.runtime.getManifest().version; } catch (e) { return ''; } })();
        setBody('me', h('div', { class: 'ui-field-gap' },
          UI.row({
            leading: avatar ? h('img', { class: 'ui-itemicon', src: avatar, alt: '' }) : null,
            title: a.signedIn ? (a.name || 'Signed in') : 'Not signed in',
            subtitle: a.signedIn ? 'Signed in with Bungie' : a.expired ? 'Your Bungie session expired. Sign in again.' : 'Sign in to see which wishes you already own.'
          }),
          a.signedIn
            ? UI.button({ label: 'Sign out', variant: 'secondary', block: true, onClick: () => { nav.close('me'); if (root.bungieAuth) root.bungieAuth.signOut(); } })
            : UI.button({ label: 'Sign in with Bungie', variant: 'primary', block: true, onClick: () => { nav.close('me'); runAction('signin'); } }),
          h('div', { class: 'ui-sectiontitle' }, 'Settings'),
          h('div', { class: 'ui-sheetlist' },
            UI.row({ title: 'Automation', subtitle: 'Lock and vault new drops, and the drops log', trailing: UI.ICON.chevron, onClick: (e) => { nav.close('me'); ctx.openAutomation(e && e.currentTarget); } }),
            store.isAdmin ? UI.row({ title: 'Admin', subtitle: 'Creators and moderation', trailing: UI.ICON.chevron, onClick: () => { nav.close('me'); const b = doc.getElementById('nav-admin'); if (b) b.click(); } }) : null,
            UI.row({ title: 'Reset game data', subtitle: 'Download Destiny’s item data again if search or perks look wrong. Your wishlists aren’t affected.', className: 'is-danger', onClick: resetGameData })),
          UI.button({ label: 'Back to the classic design', variant: 'ghost', block: true, onClick: ctx.goClassic }),
          version ? h('p', { class: 'ui-note ui-me__version' }, `Ahamkara Wishes ${version}`) : null));
      }
    }

    /** Clears the downloaded manifest, then reloads so it downloads again (about 200 MB). */
    async function resetGameData() {
      const ok = await UI.confirm({
        title: 'Reset game data?', body: 'The downloaded Destiny data is cleared and downloaded again when the panel reloads (about 200 MB). Your wishlists are not affected.',
        confirmLabel: 'Reset and reload', danger: true
      });
      if (!ok) return;
      try { await root.clearD2ManifestCache(); root.location.reload(); }
      catch (e) { console.warn('[Shell] reset game data failed', e); ctx.toast('Couldn’t clear the game data. Please try again.'); }
    }

    function runAction(kind) {
      if (kind === 'signin') { if (root.bungieAuth) root.bungieAuth.signIn().catch((e) => ctx.toast(e && e.message ? e.message : 'Sign-in failed.')); }
      else if (kind === 'download') { if (root.ensureInventoryItemDefsReady) root.ensureInventoryItemDefsReady({ force: true }).then(() => root.location.reload()); }
      else ctx.syncNow();
      if (nav.isOpen('sync')) nav.close('sync');
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
        // First run: a real bar under the message, so the wait is visibly going somewhere.
        if (typeof s.banner.progress === 'number') bannerSlot.appendChild(UI.progress({ value: s.banner.progress, max: 100, label: 'Downloading game data' }));
      }
      if (nav.isOpen('sync') || nav.isOpen('me')) fillSheet(nav.top);
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
    // The owner's moderation tools stay in the classic Admin sheet; Me offers the way in once admin is confirmed.
    doc.addEventListener('ahamkara:adminStatusChanged', (e) => { store.isAdmin = !!(e.detail && e.detail.isAdmin); if (nav.isOpen('me')) fillSheet('me'); });
    doc.addEventListener('awSyncChanged', paint);
    doc.addEventListener('awManifestProgress', (e) => { store.manifestProgress = e.detail && typeof e.detail.percent === 'number' ? e.detail.percent : null; paint(); });
    doc.addEventListener('awManifestReady', () => { store.manifest = 'ready'; store.manifestProgress = null; paint(); });
    const overlay = doc.getElementById('loading-overlay');
    store.manifest = !overlay || overlay.classList.contains('hidden') ? 'ready' : 'downloading';
    root.addEventListener('online', paint);
    root.addEventListener('offline', paint);
    // "Synced 2m ago" stays honest while nothing else changes.
    root.setInterval(() => { if (!doc.hidden) paint(); }, 30000);

    nav.restore('wishes');
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
