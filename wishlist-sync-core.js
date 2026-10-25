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
        const newest = Math.max(newestWishAdded(localList), newestWishAdded(remoteList));
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
    replaceWish,
    mergeDimData,
    stableStringify,
    emptyDimData,
    TOMBSTONE_TTL_MS
  };

})(typeof window !== 'undefined' ? window : globalThis);
