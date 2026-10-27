// Ahamkara Wishes — keeping saved wishes in the shape the matcher reads.
//
// Wishes arrive from many places: the builders, a downloaded file, Discover, the
// godroll.tv button, older versions of the extension. This brings each one to the
// current shape (the perks to look for as lists the matcher can use, empty
// ownership fields, older armor configs rewritten once) and keeps doing it as
// wishes change, writing back only when something actually changed.
//
//   WishlistNormalize.normalizeWishlistEntry(wish)   in place; true if it changed anything saved
//   WishlistNormalize.normalizeWishlistData(dimData) every wish of every list
//
// Moved out of the old wishlist screen when it was removed.
// Tests: tests/normalize-wishlist-test.js, armor-schema-test.js.

(function (root) {
  'use strict';
  const window = root; // the code below was written against `window`

  // Normalize a single wishlist entry (in-place). Returns true if any persisted
  // fields were changed (i.e., mustHave or desired arrays were added/modified).
  function normalizeWishlistEntry(wish) {
    let mutated = false;
    if (!wish) return false;

    // Armor wishes saved before the Tertiary/Spark split stored the Tertiary
    // as `spark`; move it to `tertiary` once, here (wishKey is unchanged by it).
    if (window.WishlistSync && window.WishlistSync.migrateArmorConfig(wish.config)) mutated = true;

    // Ensure desired is an array. For weapon wishes, derive from config.perks if not already set.
    if (!Array.isArray(wish.desired) || wish.desired.length === 0) {
      if (wish.desiredSet instanceof Set && wish.desiredSet.size > 0) {
        wish.desired = Array.from(wish.desiredSet);
      } else if (Array.isArray(wish.config?.perks)) {
        wish.desired = wish.config.perks.flat().filter((h) => typeof h === 'number' && h > 0);
      } else if (typeof wish.config?.perks === 'string' && wish.config.perks.trim()) {
        // Content-script (DIM) saves store perks as the raw comma-separated
        // URL param. Without parsing it, desired/mustHave stay empty and the
        // legacy matcher treats ANY owned copy as a match (false positive).
        wish.desired = wish.config.perks.split(',').map((v) => Number(v)).filter((h) => Number.isFinite(h) && h > 0);
      } else {
        wish.desired = [];
      }
      mutated = true;
    } else {
      // normalize elements to numbers
      const nums = wish.desired.map((v) => Number(v));
      for (let i = 0; i < nums.length; i++) if (Number.isNaN(nums[i])) nums[i] = null;
      wish.desired = nums.filter((v) => v !== null);
    }

    // Ensure mustHave exists; default to desired. Also re-default when a
    // previously-broken entry persisted an empty mustHave despite having
    // desired perks (empty mustHave makes every owned copy match).
    if (!Array.isArray(wish.mustHave) || (wish.mustHave.length === 0 && wish.desired.length > 0)) {
      wish.mustHave = Array.from(wish.desired || []);
      mutated = true;
    } else {
      // normalize mustHave elements
      wish.mustHave = wish.mustHave.map((v) => Number(v)).filter((v) => !Number.isNaN(v));
    }

    // Ensure received fields exist (persistence-friendly)
    if (!Array.isArray(wish.receivedInstances)) { wish.receivedInstances = []; mutated = true; }
    if (typeof wish.received !== 'boolean') { wish.received = false; mutated = true; }

    // Derive runtime-only Sets
    try { wish.desiredSet = new Set(Array.isArray(wish.desired) ? wish.desired : []); } catch (e) { wish.desiredSet = new Set(); }
    try { wish.mustHaveSet = new Set(Array.isArray(wish.mustHave) ? wish.mustHave : Array.from(wish.desiredSet || [])); } catch (e) { wish.mustHaveSet = new Set(); }

    return mutated;
  }

  // Normalize entire dimData structure. Returns true if any persisted mutation occurred.
  function normalizeWishlistData(data) {
    if (!data || !data.lists) return false;
    let mutated = false;
    for (const lid of Object.keys(data.lists)) {
      const list = data.lists[lid];
      if (!list || !list.items) continue;
      for (const ih of Object.keys(list.items)) {
        const it = list.items[ih];
        if (!it || !Array.isArray(it.wishes)) continue;
        for (const w of it.wishes) {
          const m = normalizeWishlistEntry(w);
          if (m) mutated = true;
        }
      }
    }
    return mutated;
  }

  /** Normalizes what is stored, once at load and again whenever the wishes change; writes only on a real change. */
  function keepNormalized() {
    if (!root.chrome || !root.chrome.storage || !root.AWStore) return;
    let queued = false;
    const run = () => {
      queued = false;
      root.AWStore.update((fresh) => (normalizeWishlistData(fresh) ? fresh : root.AWStore.SKIP))
        .catch((e) => console.warn('[Normalize] could not tidy the wishlists', e));
    };
    const schedule = () => { if (!queued) { queued = true; setTimeout(run, 0); } };
    root.chrome.storage.onChanged.addListener((changes, area) => { if (area === 'local' && changes.dimData) schedule(); });
    schedule();
  }

  root.WishlistNormalize = { normalizeWishlistEntry, normalizeWishlistData, keepNormalized };
  if (root.document) root.document.addEventListener('DOMContentLoaded', keepNormalized);
})(typeof window !== 'undefined' ? window : globalThis);
