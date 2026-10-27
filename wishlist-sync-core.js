// Ahamkara Wishes — shared merge + tombstone rules for cross-browser sync.
//
// chrome.storage.local is per-browser-install, so the same admin account can
// end up with divergent copies of dimData in different browsers. admin-sync.js
// reconciles them through Supabase; the rules live here rather than in
// admin-sync.js because the delete paths (manager.js, ui-creator.js,
// wishlist.js) must record tombstones using the exact same notion of "which
// wish is this", and duplicating that definition would silently break merging.
//
// Merge model: additive union of lists -> items -> wishes, filtered by
// tombstones. Union is deliberate. The previous whole-blob last-write-wins
// scheme destroyed an entire wishlist that existed in only one browser, and
// losing hand-built wishlists is far worse than a deleted roll reappearing —
// so nothing is ever dropped except via an explicit tombstone.

(function (global) {
  'use strict';

  // Tombstones are pruned past this age. A browser that has been offline
  // longer than this could resurrect a deletion, which is an acceptable
  // trade for not growing the synced blob forever.
  const TOMBSTONE_TTL_MS = 90 * 24 * 60 * 60 * 1000; // 90 days

  function emptyDimData() {
    return { activeId: 'default', lists: { default: { name: 'Main Wishlist', items: {} } } };
  }

  const hasOwn = (o, k) => Object.prototype.hasOwnProperty.call(o, k);

  /**
   * An armor wish's fields, from either config shape:
   *   current  { archetype, tertiary, spark }   tertiary = the piece's third
   *            stat, spark = the Tier 5 tuned stat; both optional (D9)
   *   legacy   { archetype, spark }             saved before the split, when
   *            `spark` held what is really the Tertiary
   * A config is current when it has a `tertiary` key (even if null).
   * Read armor configs through this, never config.spark directly.
   */
  function armorFields(cfg) {
    const c = cfg || {};
    const legacy = !hasOwn(c, 'tertiary');
    return {
      archetype: c.archetype || null,
      tertiary: (legacy ? c.spark : c.tertiary) || null,
      spark: (legacy ? null : c.spark) || null
    };
  }

  /**
   * Rewrites a legacy armor config ({ archetype, spark }) to the current shape
   * in place. Returns true if it changed anything. Weapon configs and configs
   * already in the current shape are left alone.
   */
  function migrateArmorConfig(cfg) {
    if (!cfg || typeof cfg !== 'object' || !cfg.archetype || hasOwn(cfg, 'tertiary')) return false;
    cfg.tertiary = cfg.spark || null;
    cfg.spark = null;
    return true;
  }

  /**
   * Identity of a wish: the duplicate rule (weapon-wish-core.js addWishToList)
   * and cross-browser sync both use it, so they can't disagree about what
   * "the same wish" means. Armor is identified by archetype + Tertiary (+ Spark
   * when set), weapons by their raw perk string, both scoped to the PvE/PvP
   * tag. Keying on this (rather than the `added` timestamp) means two browsers
   * independently creating the same wish collapse into one entry.
   * A migrated legacy armor wish keeps exactly its old key
   * ("pve|armor:GUNNER+Class"), so existing tombstones still apply.
   */
  function wishKey(wish) {
    const mode = (wish && Array.isArray(wish.tags) && wish.tags[0]) || 'pve';
    const cfg = (wish && wish.config) || {};
    if (cfg.archetype) {
      const a = armorFields(cfg);
      return `${mode}|armor:${a.archetype}+${a.tertiary || ''}${a.spark ? `~${a.spark}` : ''}`;
    }
    return `${mode}|weapon:${(wish && wish.raw) || ''}`;
  }

  function ensureTombstones(data) {
    if (!data.tombstones || typeof data.tombstones !== 'object') data.tombstones = {};
    if (!data.tombstones.lists) data.tombstones.lists = {};
    if (!data.tombstones.wishes) data.tombstones.wishes = {};
    return data.tombstones;
  }

  /** Mutates `data` — callers persist it as part of their own storage write. */
  function recordListTombstone(data, listId, now) {
    if (!data || !listId) return;
    const t = ensureTombstones(data);
    t.lists[listId] = Math.max(now || Date.now(), t.lists[listId] || 0);
  }

  /** Mutates `data` — callers persist it as part of their own storage write. */
  function recordWishTombstone(data, listId, itemHash, wish, now) {
    if (!data || !listId || !itemHash || !wish) return;
    const t = ensureTombstones(data);
    const key = wishKey(wish);
    const hash = String(itemHash);
    if (!t.wishes[listId]) t.wishes[listId] = {};
    if (!t.wishes[listId][hash]) t.wishes[listId][hash] = {};
    const bucket = t.wishes[listId][hash];
    bucket[key] = Math.max(now || Date.now(), bucket[key] || 0);
  }

  /**
   * Replaces wishes[index] with `next` (an edit). Editing can change which wish
   * this is, because identity is the perks (weapons) or archetype + Tertiary
   * (+ Spark) for armor.
   * When it does, the old identity is tombstoned — otherwise the next merge with
   * a browser still holding the old version would bring it back beside the
   * edited one — and `next` gets a fresh `added`, so that editing back to an
   * earlier identity isn't mistaken for the deleted original (a tombstone only
   * kills wishes added at or before it). Mutates `data`; returns false when
   * there is no wish at that index.
   */
  function replaceWish(data, listId, itemHash, index, next, now) {
    const item = data && data.lists && data.lists[listId] && data.lists[listId].items &&
      data.lists[listId].items[itemHash];
    const wishes = item && item.wishes;
    if (!wishes || !wishes[index] || !next) return false;
    const old = wishes[index];
    if (wishKey(old) !== wishKey(next)) {
      recordWishTombstone(data, listId, itemHash, old, now);
      next.added = now || Date.now();
    }
    wishes[index] = next;
    return true;
  }

  /**
   * Undoes a delete: puts `wish` back (an item that was removed with its last
   * wish comes back with `staticInfo`) and withdraws the tombstone the delete
   * recorded. The restored wish gets an `added` newer than that tombstone, so
   * a merge with a browser that saw the delete can't remove it again.
   * Returns false, changing nothing, if the same wish is already on the item.
   */
  function restoreWish(data, listId, itemHash, wish, staticInfo, index, now) {
    const list = data && data.lists && data.lists[listId];
    if (!list || !wish) return false;
    if (!list.items) list.items = {};
    const hash = String(itemHash);
    if (!list.items[hash]) list.items[hash] = { static: staticInfo || {}, wishes: [] };
    const wishes = list.items[hash].wishes;
    const key = wishKey(wish);
    if (wishes.some((w) => wishKey(w) === key)) return false;

    const bucket = data.tombstones && data.tombstones.wishes && data.tombstones.wishes[listId] && data.tombstones.wishes[listId][hash];
    const tombstonedAt = (bucket && bucket[key]) || 0;
    if (bucket) delete bucket[key];
    wish.added = Math.max(now || Date.now(), tombstonedAt + 1, wish.added || 0);
    wishes.splice(Math.min(Math.max(index | 0, 0), wishes.length), 0, wish);
    return true;
  }

  // ---- list operations (the Lists screen) -------------------------------------------
  // Pure edits of `data`, callers persist it under the AWStore lock. Anything that
  // removes a list records a tombstone so a browser still holding the old copy
  // can't bring it back; the matching restore withdraws it.

  const DEFAULT_LIST_ID = 'default';
  const LIST_NAME_MAX = 60;

  const makeListId = () => 'wl_' + Math.random().toString(36).slice(2, 9);
  const cleanListName = (name) => String(name == null ? '' : name).replace(/\s+/g, ' ').trim().slice(0, LIST_NAME_MAX);
  const sameName = (a, b) => String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase();

  function nameTaken(data, name, exceptId) {
    return Object.entries((data && data.lists) || {}).some(([id, l]) => id !== exceptId && sameName(l && l.name, name));
  }

  /** `name`, or `name (2)`, `name (3)` ... when another list already has it. */
  function uniqueListName(data, name, exceptId) {
    if (!nameTaken(data, name, exceptId)) return name;
    let n = 2;
    while (nameTaken(data, `${name} (${n})`, exceptId)) n++;
    return `${name} (${n})`;
  }

  /** New empty list, made the active one. Returns { id } or { error: 'empty' | 'taken' }. */
  function createList(data, name) {
    const clean = cleanListName(name);
    if (!clean) return { error: 'empty' };
    if (nameTaken(data, clean)) return { error: 'taken' };
    const id = makeListId();
    data.lists[id] = { name: clean, items: {} };
    data.activeId = id;
    return { id };
  }

  /** Returns 'ok' | 'empty' | 'taken' | 'missing'. */
  function renameList(data, id, name) {
    if (!data.lists[id]) return 'missing';
    const clean = cleanListName(name);
    if (!clean) return 'empty';
    if (nameTaken(data, clean, id)) return 'taken';
    data.lists[id].name = clean;
    return 'ok';
  }

  /** A copy named "<name> (copy)", made the active list. Returns its id, or null. */
  function duplicateList(data, id) {
    const src = data.lists[id];
    if (!src) return null;
    const copy = makeListId();
    data.lists[copy] = { name: uniqueListName(data, cleanListName(`${src.name} (copy)`)), items: JSON.parse(JSON.stringify(src.items || {})) };
    data.activeId = copy;
    return copy;
  }

  const listPosition = (data, id) => Object.keys(data.lists).indexOf(id);

  /**
   * Deletes a list (never the default). Returns what restoreList needs, or null.
   * The active list falls back to the default.
   */
  function removeList(data, id, now) {
    if (!id || id === DEFAULT_LIST_ID || !data.lists[id]) return null;
    const snap = { id, list: data.lists[id], position: listPosition(data, id), wasActive: data.activeId === id };
    delete data.lists[id];
    recordListTombstone(data, id, now);
    if (snap.wasActive) data.activeId = DEFAULT_LIST_ID;
    return snap;
  }

  /**
   * Undoes removeList: puts the list back where it was and withdraws its tombstone.
   * Its wishes get an `added` newer than that tombstone (in their old order), so a
   * merge with a browser that saw the delete can't remove them again.
   * Returns false, changing nothing, if a list with that id exists.
   */
  function restoreList(data, snap, now) {
    if (!data || !snap || !snap.list || data.lists[snap.id]) return false;
    const tombs = data.tombstones && data.tombstones.lists;
    const deletedAt = (tombs && tombs[snap.id]) || 0;
    if (tombs) delete tombs[snap.id];
    const floor = Math.max(now || Date.now(), deletedAt + 1);
    for (const item of Object.values(snap.list.items || {})) {
      let prev = floor - 1;
      for (const w of (item && item.wishes) || []) {
        if (!w) continue;
        w.added = Math.max(Number(w.added) || 0, prev + 1, floor);
        prev = w.added;
      }
    }
    const entries = Object.entries(data.lists);
    entries.splice(Math.min(Math.max(snap.position | 0, 0), entries.length), 0, [snap.id, snap.list]);
    // A list with no wishes has nothing to date, so the list itself carries when it came back.
    snap.list.restoredAt = floor;
    data.lists = Object.fromEntries(entries);
    if (snap.wasActive) data.activeId = snap.id;
    return true;
  }

  /**
   * Folds the `sourceIds` lists into `destId`: every roll of every list is kept
   * (the same roll in two lists once), then the sources are removed. The default
   * list is never a source. Returns what undoMerge needs ({ destId, addedKeys,
   * removed, added }), or null when there was nothing to merge.
   */
  function mergeLists(data, destId, sourceIds, now) {
    const dest = data.lists[destId];
    if (!dest) return null;
    const sources = [...new Set(sourceIds || [])].filter((id) => id !== destId && id !== DEFAULT_LIST_ID && data.lists[id]);
    if (!sources.length) return null;
    const keysOf = (items) => {
      const out = {};
      for (const [hash, item] of Object.entries(items || {})) out[hash] = new Set(((item && item.wishes) || []).map(wishKey));
      return out;
    };
    const had = keysOf(dest.items);
    const removed = [];
    for (const id of sources) {
      dest.items = mergeItems(dest.items, data.lists[id].items, null);
      removed.push(removeList(data, id, now));
    }
    // Exactly what the merge brought in, so Undo takes out only that and leaves
    // anything else that changes on the list in the meantime alone.
    const addedKeys = {};
    let added = 0;
    for (const [hash, keys] of Object.entries(keysOf(dest.items))) {
      const fresh = [...keys].filter((k) => !(had[hash] && had[hash].has(k)));
      if (fresh.length) { addedKeys[hash] = fresh; added += fresh.length; }
    }
    return { destId, addedKeys, removed: removed.filter(Boolean), added, activeId: data.activeId === destId ? destId : null };
  }

  /**
   * Undoes mergeLists: takes the merged-in rolls back out of the destination
   * (tombstoned, so a browser that already has the merged list drops them too)
   * and puts the source lists back where they were.
   */
  function undoMerge(data, result, now) {
    const dest = result && data.lists[result.destId];
    if (!dest) return false;
    for (const [hash, keys] of Object.entries(result.addedKeys || {})) {
      const item = dest.items && dest.items[hash];
      if (!item || !Array.isArray(item.wishes)) continue;
      item.wishes = item.wishes.filter((w) => {
        if (!keys.includes(wishKey(w))) return true;
        recordWishTombstone(data, result.destId, hash, w, now);
        return false;
      });
      if (!item.wishes.length) delete dest.items[hash];
    }
    // Last removed first: each list was removed from the shape the previous one left, so this retraces it exactly.
    [...result.removed].reverse().forEach((snap) => restoreList(data, snap, now));
    return true;
  }

  /**
   * Finds the wish a list row was drawn from. Rows remember the index AND the
   * wish's key when they render; by the time someone taps Delete or Save, the
   * list may have changed (cross-browser sync, a godroll.tv add, another tab),
   * so the index alone can point at a different wish. Returns the index of the
   * wish with `key` (preferring `index` when it still matches), or -1 if that
   * wish is gone. Without a key, trusts the index (old callers).
   */
  function locateWish(wishes, index, key) {
    if (!Array.isArray(wishes)) return -1;
    if (key == null) return wishes[index] ? index : -1;
    if (wishes[index] && wishKey(wishes[index]) === key) return index;
    return wishes.findIndex((w) => w && wishKey(w) === key);
  }

  function mergeTombstones(a, b) {
    const out = { lists: {}, wishes: {} };
    const cutoff = Date.now() - TOMBSTONE_TTL_MS;

    for (const src of [a, b]) {
      const t = (src && src.tombstones) || {};
      for (const [listId, ts] of Object.entries(t.lists || {})) {
        if (typeof ts !== 'number' || ts < cutoff) continue;
        out.lists[listId] = Math.max(ts, out.lists[listId] || 0);
      }
      for (const [listId, items] of Object.entries(t.wishes || {})) {
        for (const [hash, keys] of Object.entries(items || {})) {
          for (const [key, ts] of Object.entries(keys || {})) {
            if (typeof ts !== 'number' || ts < cutoff) continue;
            if (!out.wishes[listId]) out.wishes[listId] = {};
            if (!out.wishes[listId][hash]) out.wishes[listId][hash] = {};
            out.wishes[listId][hash][key] = Math.max(ts, out.wishes[listId][hash][key] || 0);
          }
        }
      }
    }
    return out;
  }

  function newestWishAdded(list) {
    let newest = 0;
    for (const item of Object.values((list && list.items) || {})) {
      for (const w of (item && item.wishes) || []) {
        const added = Number(w && w.added) || 0;
        if (added > newest) newest = added;
      }
    }
    return newest;
  }

  function mergeWishes(localWishes, remoteWishes, tombsForItem) {
    const byKey = new Map();

    const absorb = (wishes) => {
      for (const w of wishes || []) {
        if (!w) continue;
        const key = wishKey(w);
        if (byKey.has(key)) continue; // local is offered first, so local wins ties
        const deletedAt = tombsForItem && tombsForItem[key];
        // A wish re-created after its deletion has a newer `added` and survives.
        if (deletedAt && (Number(w.added) || 0) <= deletedAt) continue;
        byKey.set(key, w);
      }
    };

    absorb(localWishes);
    absorb(remoteWishes);

    // Deterministic order so a wish's array index means the same thing in every
    // browser — the list UI deletes and edits wishes by index.
    return Array.from(byKey.values()).sort((x, y) => (Number(x.added) || 0) - (Number(y.added) || 0));
  }

  // Prefer the local copy, but backfill anything it is missing. Mirrors the
  // null-backfill behaviour saveItem() already applies to `static`.
  function mergeStatic(localStatic, remoteStatic) {
    const out = Object.assign({}, remoteStatic || {}, localStatic || {});
    for (const [k, v] of Object.entries(remoteStatic || {})) {
      if (out[k] === null || out[k] === undefined) out[k] = v;
      else if (Array.isArray(out[k]) && out[k].length === 0 && Array.isArray(v) && v.length > 0) out[k] = v;
    }
    return out;
  }

  function mergeItems(localItems, remoteItems, wishTombsForList) {
    const out = {};
    const hashes = new Set([
      ...Object.keys(localItems || {}),
      ...Object.keys(remoteItems || {})
    ]);

    for (const hash of hashes) {
      const localItem = (localItems || {})[hash];
      const remoteItem = (remoteItems || {})[hash];
      const wishes = mergeWishes(
        localItem && localItem.wishes,
        remoteItem && remoteItem.wishes,
        (wishTombsForList || {})[hash]
      );
      // An item with no surviving wishes was fully deleted; the delete paths
      // drop the item entirely in that case, so match that here.
      if (wishes.length === 0) continue;
      out[hash] = {
        static: mergeStatic(localItem && localItem.static, remoteItem && remoteItem.static),
        wishes
      };
    }
    return out;
  }

  /**
   * Reconcile two dimData snapshots. Pure — neither input is mutated.
   * Symmetric except that `local` wins field-level ties, so a browser never
   * sees its own most recent edit replaced by an older remote copy.
   */
  function mergeDimData(localIn, remoteIn) {
    const local = (localIn && localIn.lists) ? localIn : emptyDimData();
    const remote = (remoteIn && remoteIn.lists) ? remoteIn : { activeId: null, lists: {} };

    const tombstones = mergeTombstones(local, remote);
    const merged = { activeId: 'default', lists: {}, tombstones };

    const listIds = new Set([
      ...Object.keys(local.lists || {}),
      ...Object.keys(remote.lists || {})
    ]);

    for (const listId of listIds) {
      const localList = local.lists[listId];
      const remoteList = remote.lists[listId];
      const deletedAt = tombstones.lists[listId] || 0;

      // A list deleted on one browser stays deleted — unless the other browser
      // has added a wish to it since, which means it is genuinely back in use.
      if (deletedAt) {
        const newest = Math.max(newestWishAdded(localList), newestWishAdded(remoteList),
          Number(localList && localList.restoredAt) || 0, Number(remoteList && remoteList.restoredAt) || 0);
        if (newest <= deletedAt) continue;
      }

      merged.lists[listId] = {
        name: (localList && localList.name) || (remoteList && remoteList.name) || 'Wishlist',
        items: mergeItems(
          localList && localList.items,
          remoteList && remoteList.items,
          tombstones.wishes[listId]
        )
      };
      const restoredAt = Math.max(Number(localList && localList.restoredAt) || 0, Number(remoteList && remoteList.restoredAt) || 0);
      if (restoredAt) merged.lists[listId].restoredAt = restoredAt;
    }

    // 'default' is special-cased throughout the app (lookups fall back to
    // lists['default']), and deleteSelected() refuses to remove it, so a merge
    // must never be able to leave it missing.
    if (!merged.lists.default) merged.lists.default = { name: 'Main Wishlist', items: {} };

    merged.activeId = [local.activeId, remote.activeId, 'default']
      .find((id) => id && merged.lists[id]) || 'default';

    return merged;
  }

  /**
   * Key-sorted JSON, so "did this actually change?" comparisons aren't fooled
   * by property ordering (merging rebuilds objects in a different order than
   * the stored copy). Comparison only — never persist this form.
   */
  function stableStringify(value) {
    if (value === null || typeof value !== 'object') return JSON.stringify(value);
    if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
    const keys = Object.keys(value).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(value[k])}`).join(',')}}`;
  }

  global.WishlistSync = {
    wishKey,
    armorFields,
    migrateArmorConfig,
    recordListTombstone,
    recordWishTombstone,
    createList,
    renameList,
    duplicateList,
    removeList,
    restoreList,
    mergeLists,
    undoMerge,
    uniqueListName,
    LIST_NAME_MAX,
    replaceWish,
    restoreWish,
    locateWish,
    mergeDimData,
    stableStringify,
    emptyDimData,
    TOMBSTONE_TTL_MS
  };

})(typeof window !== 'undefined' ? window : globalThis);
