// Ahamkara Wishes — the Drops screen.
//
// Drops are wished-for rolls that just landed in your inventory. They are found
// while the side panel is open (D10): the next sync after opening picks up
// whatever landed meanwhile. The screen shows the log, what was done about each
// drop (locked, moved to the vault) and the Automation settings (D5).
//
// Automation: auto-lock is on, auto-vault is off until you say so, and it is
// offered clearly right after you sign in. The same sheet is reachable from
// this screen at any time.
//
// Needs aw-dom, aw-ui, sync-status and drops-core.

(function (root) {
  'use strict';

  const D = root.AWDom, UI = root.AWUI, doc = root.document;
  const { h } = D;
  const A = root.AWDrops;
  const ACTION_LABEL = { locked: 'Locked', vaulted: 'Moved to vault', 'lock-failed': 'Couldn’t lock', 'vault-failed': 'Couldn’t move' };

  const ago = (ts) => { const t = root.AWSync.formatAgo(Date.now() - ts); return t === 'Just now' ? 'just now' : `${t} ago`; };

  function create(ctx) {
    let s = { entries: [], enabled: null, seenAt: 0, automation: A.normalizeAutomation(), signedIn: false };
    let viewSeenAt = 0;       // what counted as "new" when the tab was opened
    let captured = false;     // viewSeenAt taken for this visit yet?
    let loadedOnce = false;
    let current = false;      // is the Drops tab showing?
    let sawSignedOut = false; // so the offer follows a sign-in, not every page load

    const body = h('div', { class: 'ui-pad ui-drops' });
    const el = h('div', null, body);

    // --- Automation sheet (also opened right after sign-in)
    const sheet = ctx.addSheet('automation', 'Automation', () => fillSheet(), { footer: true });
    function openAutomation(trigger) { ctx.nav.open('automation', {}, { returnFocus: trigger }); }

    async function change(patch) {
      s.automation = A.normalizeAutomation(Object.assign({}, s.automation, patch, { answered: true }));
      await A.saveAutomation(s.automation);
      render();
    }

    function fillSheet() {
      const a = s.automation;
      sheet.querySelector('.ui-sheet__body').replaceChildren(h('div', { class: 'ui-field-gap' },
        h('p', { class: 'ui-note' }, 'When a roll you wished for lands, Ahamkara Wishes can look after it. This only happens while the side panel is open.'),
        UI.switchRow({ label: 'Log new drops', description: 'Keep a list of wished-for rolls here as they land.', checked: s.enabled !== false, onChange: (on) => { s.enabled = on; A.setEnabled(on).then(render); } }),
        UI.switchRow({ label: 'Lock new drops', description: 'Locks the item in-game so it can’t be dismantled by accident.', checked: a.autoLock, onChange: (on) => change({ autoLock: on }) }),
        UI.switchRow({ label: 'Move new drops to the vault', description: 'Sends the item to your vault when it lands. Off unless you turn it on.', checked: a.autoVault, onChange: (on) => change({ autoVault: on }) })));
      sheet.querySelector('.ui-sheet__footslot').replaceChildren(
        UI.button({ label: 'Done', variant: 'primary', size: 'lg', block: true, onClick: async () => { if (!s.automation.answered) await change({}); ctx.nav.close('automation'); } }));
    }

    // --- the screen
    function summary() {
      const a = s.automation;
      return `Lock ${a.autoLock ? 'on' : 'off'} · Vault ${a.autoVault ? 'on' : 'off'} · Log ${s.enabled === false ? 'off' : 'on'}`;
    }

    function render() {
      const out = [
        h('div', null, h('h2', { class: 'ui-screen__title' }, 'Drops'),
          h('p', { class: 'ui-note' }, 'Rolls you wished for that just landed. Found while this panel is open, checked every 30 seconds.')),
        UI.row({ title: 'Automation', subtitle: summary(), trailing: UI.ICON.chevron, className: 'ui-card', onClick: (e) => openAutomation(e.currentTarget) })
      ];

      if (s.signedIn && !s.automation.answered) {
        out.push(h('div', { class: 'ui-card ui-offer' },
          h('div', { class: 'ui-offer__title' }, 'Choose what happens to new drops'),
          h('p', { class: 'ui-note' }, 'New drops are locked for you. Want them moved to your vault too? You can change this any time.'),
          h('div', { class: 'ui-offer__actions' },
            UI.button({ label: 'Move to vault too', variant: 'primary', onClick: () => change({ autoVault: true }) }),
            UI.button({ label: 'Just lock', variant: 'secondary', onClick: () => change({ autoVault: false }) }))));
      }

      if (s.enabled === false) {
        out.push(UI.emptyState({
          title: 'The drops log is off', body: 'Turn it on to keep a list of wished-for rolls as they land.',
          actions: [UI.button({ label: 'Turn on', variant: 'primary', onClick: () => { s.enabled = true; A.setEnabled(true).then(render); } })]
        }));
      } else if (!s.entries.length) {
        out.push(s.signedIn
          ? UI.emptyState({ title: 'No drops yet', body: 'When a roll you wished for lands in your inventory, it shows up here.' })
          : UI.emptyState({
            title: 'Sign in to see your drops', body: 'Ahamkara Wishes needs your Bungie account to see what lands in your inventory.',
            actions: [UI.button({ label: 'Sign in with Bungie', variant: 'primary', onClick: () => ctx.signIn() })]
          }));
      } else {
        out.push(...entryGroups());
      }
      body.replaceChildren(...out);
    }

    function entryGroups() {
      const newest = s.entries.slice().reverse();
      const groups = [];
      newest.forEach((e) => {
        const label = A.dayLabel(e.timestamp);
        const g = groups[groups.length - 1];
        if (g && g.label === label) g.items.push(e); else groups.push({ label, items: [e] });
      });
      const out = [h('div', { class: 'ui-drops__bar' },
        h('span', { class: 'ui-sectiontitle' }, `${s.entries.length} ${s.entries.length === 1 ? 'drop' : 'drops'}`),
        UI.button({ label: 'Clear all', variant: 'ghost', onClick: clearAll }))];
      groups.forEach((g) => {
        out.push(h('div', { class: 'ui-sectiontitle' }, g.label));
        out.push(h('div', { class: 'ui-droplist' }, g.items.map(dropRow)));
      });
      return out;
    }

    function dropRow(e) {
      const isNew = e.timestamp > viewSeenAt;
      const img = D.safeImageUrl(e.iconUrl);
      const actions = Array.isArray(e.actions) ? e.actions : [];
      return h('div', { class: ['ui-droprow', isNew && 'is-new'], data: { id: e.id || '' } },
        h('button', {
          type: 'button', class: 'ui-droprow__main', aria: { label: `${e.itemName}, ${e.listName || ''}, ${ago(e.timestamp)}${isNew ? ', new' : ''}. Open` },
          on: { click: (ev) => ctx.openWish(e.itemHash, ev.currentTarget, e.listName) }
        },
        img ? h('img', { class: 'ui-itemicon', src: img, alt: '' }) : h('span', { class: 'ui-itemicon ui-itemicon--blank' }),
        h('span', { class: 'ui-droprow__text' },
          h('span', { class: 'ui-droprow__name' }, isNew ? h('span', { class: 'ui-newdot', aria: { hidden: true } }) : null, e.itemName || 'Unknown item'),
          h('span', { class: 'ui-droprow__sub' }, `${e.listName || 'Wishlist'} · ${ago(e.timestamp)}`),
          actions.length ? h('span', { class: 'ui-droprow__chips' }, actions.map((a) => UI.badge(ACTION_LABEL[a] || a, /failed/.test(a) ? 'warning' : 'success'))) : null)),
        UI.iconButton({ label: `Remove ${e.itemName || 'this drop'} from Drops`, icon: UI.ICON.close, onClick: () => removeOne(e) }));
    }

    // --- changes (each restorable, so Undo rather than a confirm: D6)
    async function removeOne(entry) {
      const fresh = await A.load();
      const r = A.removeEntry(fresh.entries, entry);
      if (!r.removed) return;
      await A.saveEntries(r.entries);
      ctx.toast('Removed from Drops.', { undo: async () => A.saveEntries(A.restoreEntry((await A.load()).entries, r.removed, r.index)) });
    }

    async function clearAll() {
      const fresh = await A.load();
      if (!fresh.entries.length) return;
      await A.saveEntries([]);
      ctx.toast('Drops cleared.', { undo: () => A.saveEntries(fresh.entries) });
    }

    // --- keeping in step
    function badge() { ctx.setTabBadge('drops', current ? 0 : A.unseenCount(s.entries, s.seenAt)); }

    async function refresh() {
      const [loaded, auth] = await Promise.all([A.load(), new Promise((r) => root.chrome.storage.local.get(['bungie_auth'], r))]);
      s = Object.assign(loaded, { signedIn: !!(auth.bungie_auth && auth.bungie_auth.access_token) });
      loadedOnce = true;
      if (current && !captured) { viewSeenAt = s.seenAt; captured = true; }
      render();
      if (current && s.seenAt < Date.now() - 1000) A.markSeen();
      badge();
    }

    ctx.nav.onChange((st) => {
      const now = st.tab === 'drops';
      if (now === current) return;
      current = now;
      captured = false;
      if (now && loadedOnce) { viewSeenAt = s.seenAt; captured = true; render(); A.markSeen(); }
      badge();
    });

    root.chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local') return;
      if (['feedEntries', 'feedEnabled', 'dropsSeenAt', 'automation', 'bungie_auth'].some((k) => changes[k])) refresh();
    });
    root.setInterval(() => { if (current) render(); }, 30000); // "5m ago" stays honest

    // The offer follows a sign-in (not every page load for someone already signed in).
    doc.addEventListener('bungieAuthChanged', (e) => {
      const auth = e.detail && e.detail.auth;
      if (!auth) { sawSignedOut = true; return; }
      if (sawSignedOut && !s.automation.answered) { sawSignedOut = false; openAutomation(null); }
    });

    // First time here: the log is on unless the person turned it off.
    A.load().then((st) => { if (st.enabled === null) return A.setEnabled(true); }).then(refresh);

    return { el, refresh, openAutomation };
  }

  root.AWDropsScreen = { create };
})(typeof window !== 'undefined' ? window : globalThis);
