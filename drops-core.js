// Ahamkara Wishes — Drops (wished-for rolls that just landed) and Automation.
//
// Pure rules plus thin storage helpers, shared by the engine (manager.js: what
// to lock, vault and log after a sync) and the Drops screen (screens/drops.js).
// Keeping them here means "what counts as a drop" and "what was done about it"
// are decided in one place and can be tested without a browser.
//
// A drop is a wish that flipped from not-received to received during a sync.
// Drops are only found while the panel is open (D10): nothing runs when it's
// closed, and the next sync after opening picks up what landed meanwhile.
//
// Storage keys: feedEntries (the log, oldest first, capped), feedEnabled,
// dropsSeenAt (for the "new" dots), dropsBaselineAt (the first sync only
// records what you already own; it isn't a drop), automation.

(function (root) {
  'use strict';

  const MAX_ENTRIES = 20;

  /** D5: auto-lock on, auto-vault off until the person says otherwise. */
  const DEFAULT_AUTOMATION = Object.freeze({ autoLock: true, autoVault: false, answered: false });

  function normalizeAutomation(raw) {
    const r = raw && typeof raw === 'object' ? raw : {};
    return { autoLock: r.autoLock !== false, autoVault: r.autoVault === true, answered: r.answered === true };
  }

  // ---- finding drops ---------------------------------------------------------------------

  /** Which (list, item, wish) triples are received right now. Taken before a matching pass. */
  function snapshotReceivedState(dimData) {
    const map = new Map();
    for (const [listId, list] of Object.entries((dimData && dimData.lists) || {})) {
      for (const [itemHash, item] of Object.entries((list && list.items) || {})) {
        (item && Array.isArray(item.wishes) ? item.wishes : []).forEach((wish, idx) => {
          map.set(`${listId}|${itemHash}|${idx}`, !!(wish && wish.received));
        });
      }
    }
    return map;
  }

  /**
   * Wishes that went from not-received to received since `before`.
   * @returns {Array<{listId, listName, itemHash, index, itemName, iconUrl, instanceIds:string[]}>}
   */
  function newlyReceived(before, dimData) {
    const out = [];
    for (const [listId, list] of Object.entries((dimData && dimData.lists) || {})) {
      for (const [itemHash, item] of Object.entries((list && list.items) || {})) {
        (item && Array.isArray(item.wishes) ? item.wishes : []).forEach((wish, index) => {
          if (!wish || !wish.received || (before && before.get(`${listId}|${itemHash}|${index}`))) return;
          out.push({
            listId, listName: (list && list.name) || listId, itemHash: String(itemHash), index,
            itemName: (item.static && item.static.name) || 'Unknown Item',
            iconUrl: (item.static && item.static.icon) || '',
            instanceIds: (Array.isArray(wish.receivedInstances) ? wish.receivedInstances : []).map(String)
          });
        });
      }
    }
    return out;
  }

  /** Every instance across the drops, once each. */
  function instanceIdsOf(drops) {
    const ids = new Set();
    drops.forEach((d) => d.instanceIds.forEach((id) => ids.add(id)));
    return ids;
  }

  // ---- the log ---------------------------------------------------------------------------------

  /**
   * Log entries for `drops`. `results` maps instanceId -> { locked?, vaulted? }
   * where true = done, false = tried and failed, undefined = not attempted
   * (that automation is off). The entry says what was done, honestly.
   */
  function buildEntries(drops, results, now) {
    const t = now || Date.now();
    const res = results || {};
    return drops.map((d, i) => {
      const actions = [];
      const outcome = (field, ok, bad) => {
        const tried = d.instanceIds.filter((id) => res[id] && res[id][field] !== undefined);
        if (!tried.length) return;
        actions.push(tried.every((id) => res[id][field] === true) ? ok : bad);
      };
      outcome('locked', 'locked', 'lock-failed');
      outcome('vaulted', 'vaulted', 'vault-failed');
      return {
        id: `${t}-${d.itemHash}-${i}`,
        itemName: d.itemName, iconUrl: d.iconUrl, listName: d.listName, listId: d.listId,
        itemHash: d.itemHash, timestamp: t, actions
      };
    });
  }

  function appendEntries(entries, newEntries, max) {
    const all = (Array.isArray(entries) ? entries : []).concat(newEntries || []);
    const cap = max || MAX_ENTRIES;
    return all.length > cap ? all.slice(all.length - cap) : all;
  }

  /** Same entry? Entries from before ids existed are matched by time and name. */
  function sameEntry(a, ref) {
    if (!a || !ref) return false;
    if (a.id && ref.id) return a.id === ref.id;
    return a.timestamp === ref.timestamp && a.itemName === ref.itemName;
  }

  function removeEntry(entries, ref) {
    const list = Array.isArray(entries) ? entries : [];
    const at = list.findIndex((e) => sameEntry(e, ref));
    if (at < 0) return { entries: list.slice(), index: -1, removed: null };
    const next = list.slice();
    const [removed] = next.splice(at, 1);
    return { entries: next, index: at, removed };
  }

  /** Puts a removed entry back where it was (Undo). */
  function restoreEntry(entries, entry, index) {
    const list = (Array.isArray(entries) ? entries : []).slice();
    if (list.some((e) => sameEntry(e, entry))) return list;
    list.splice(Math.min(Math.max(index | 0, 0), list.length), 0, entry);
    return list;
  }

  function unseenCount(entries, seenAt) {
    return (Array.isArray(entries) ? entries : []).filter((e) => e && e.timestamp > (seenAt || 0)).length;
  }

  /** "Today", "Yesterday", or the date, for grouping the log. */
  function dayLabel(ts, now) {
    const day = (t) => { const d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime(); };
    const diff = Math.round((day(now || Date.now()) - day(ts)) / 86400000);
    if (diff <= 0) return 'Today';
    if (diff === 1) return 'Yesterday';
    return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  }

  // ---- storage ---------------------------------------------------------------------------------

  const get = (keys) => new Promise((res) => root.chrome.storage.local.get(keys, res));
  const set = (obj) => new Promise((res) => root.chrome.storage.local.set(obj, res));

  async function load() {
    const r = await get(['feedEntries', 'feedEnabled', 'dropsSeenAt', 'dropsBaselineAt', 'automation']);
    return {
      entries: Array.isArray(r.feedEntries) ? r.feedEntries : [],
      enabled: r.feedEnabled === undefined ? null : !!r.feedEnabled, // null: never chosen
      seenAt: r.dropsSeenAt || 0,
      baselineAt: r.dropsBaselineAt || 0,
      automation: normalizeAutomation(r.automation)
    };
  }

  const api = {
    MAX_ENTRIES, DEFAULT_AUTOMATION, normalizeAutomation,
    snapshotReceivedState, newlyReceived, instanceIdsOf,
    buildEntries, appendEntries, removeEntry, restoreEntry, unseenCount, dayLabel,
    load,
    saveEntries: (entries) => set({ feedEntries: entries }),
    setEnabled: (on) => set({ feedEnabled: !!on }),
    markSeen: (ts) => set({ dropsSeenAt: ts || Date.now() }),
    setBaseline: (ts) => set({ dropsBaselineAt: ts || Date.now() }),
    saveAutomation: (a) => set({ automation: normalizeAutomation(a) })
  };
  root.AWDrops = api;
})(typeof window !== 'undefined' ? window : globalThis);
