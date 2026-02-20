/*
 * owned-inventory-index.js
 *
 * Builds a cached OwnedIndex from a Destiny2.GetProfile response and
 * provides helpers to match wishlist entries against the owned inventory.
 *
 * Responsibilities:
 * - Compute `rolledPerkSet` for each weapon instance using ItemSockets
 * - Provide `OwnedIndex` with `byInstanceId` and `byItemHash` maps
 * - Provide `matchWishlist(dimData, ownedIndex)` to annotate wishlist entries
 *
 * Phase 1 note: crafted weapons may have limited `reusablePlugHashes` in
 * ItemSockets. Phase 2 should add plugSet / DestinyPlugSetDefinition lookup.
 */

(function (global) {
  'use strict';

  /**
   * OwnedIndex structure
   * @typedef {{byInstanceId: Map<string, object>, byItemHash: Map<number,string[]>}} OwnedIndex
   */

  const cache = {
    profileVersion: null,
    index: null
  };

  /**
   * Build a rolledPerkSet from profile.itemSockets data for an instance.
   * Uses manifest hints (if provided) only for optional filtering (consumer may pass full manifest).
   * @param {object} profile - Destiny2.GetProfile response object (component bundle)
   * @param {string} instanceId
   * @returns {Set<number>} set of plug hashes
   */
  function buildRolledPerkSet(profile, instanceId) {
    const rolled = new Set();
    const socketData = profile?.itemSockets?.data?.[instanceId]?.sockets;
    if (!Array.isArray(socketData)) return rolled;

    for (const s of socketData) {
      if (s.plugHash) rolled.add(s.plugHash);
      if (Array.isArray(s.reusablePlugHashes)) {
        for (const h of s.reusablePlugHashes) rolled.add(h);
      }
    }
    return rolled;
  }

  /**
   * Build OwnedIndex from a profile response.
   * Note: expects `profile` to include itemSockets and itemInstances components.
   * @param {object} profile - profile response
   * @returns {OwnedIndex}
   */
  function buildOwnedIndex(profile) {
    if (!profile) return { byInstanceId: new Map(), byItemHash: new Map() };

    const version = profile?.profileInventory?.data?.version || profile?.profile?.data?.version || null;
    if (cache.profileVersion && cache.profileVersion === version && cache.index) return cache.index;

    const byInstanceId = new Map();
    const byItemHash = new Map();

    const instances = profile?.itemInstances?.data || {};
    // Walk sockets map for available instances
    const socketEntries = profile?.itemSockets?.data || {};

    // Instances may be present in multiple components (profile + characters + vault). We'll iterate sockets keys.
    for (const instanceId of Object.keys(socketEntries)) {
      try {
        const instComp = instances[instanceId] || {};
        const itemObj = profile?.items?.data?.[instanceId] || {};
        const itemHash = itemObj?.itemHash || (instComp?.itemHash ?? null);
        if (!itemHash) continue;

        const rolledPerkSet = buildRolledPerkSet(profile, instanceId);

        // determine location and characterId best-effort from available components
        let location = 'inventory';
        let characterId = null;
        const itemLocation = profile?.itemInventories?.data?.[instanceId] || profile?.profileInventory?.data?.items?.find?.(i => i.itemInstanceId === instanceId);
        if (itemLocation && itemLocation.bucketHash === 215593132) location = 'postmaster';

        // crafted detection (best-effort) — check itemInstances or itemComponents
        const isCrafted = !!(instComp?.state && (instComp.state & 16));

        const owned = {
          instanceId,
          itemHash,
          rolledPerkSet,
          location,
          characterId,
          isCrafted
        };

        byInstanceId.set(instanceId, owned);

        if (!byItemHash.has(itemHash)) byItemHash.set(itemHash, []);
        byItemHash.get(itemHash).push(instanceId);
      } catch (e) {
        console.warn('[OwnedIndex] error building entry for', instanceId, e);
      }
    }

    const index = { byInstanceId, byItemHash };
    cache.index = index;
    cache.profileVersion = version;
    return index;
  }

  /**
   * Match wishlist entries in `dimData` against an OwnedIndex.
   * This mutates `dimData` in-place to set `received`, `receivedInstances` and `matchScore` for each wish.
   * @param {object} dimData - the stored wishlist data structure
   * @param {OwnedIndex} ownedIndex
   * @returns {object} summary {totalEntries, receivedCount}
   */
  function matchWishlist(dimData, ownedIndex) {
    if (!dimData || !dimData.lists) return { totalEntries: 0, receivedCount: 0 };

    let total = 0, received = 0;

    for (const listId of Object.keys(dimData.lists)) {
      const list = dimData.lists[listId];
      if (!list || !list.items) continue;
      for (const itemHash of Object.keys(list.items)) {
        const item = list.items[itemHash];
        if (!item || !Array.isArray(item.wishes)) continue;
        for (const wish of item.wishes) {
          total++;
          // Expect wish.desiredSet and wish.mustHaveSet to be arrays of numbers or Sets
          const desired = new Set(Array.isArray(wish.desiredSet) ? wish.desiredSet : (wish.desiredSet instanceof Set ? Array.from(wish.desiredSet) : []));
          const mustHave = new Set(Array.isArray(wish.mustHaveSet) ? wish.mustHaveSet : (wish.mustHaveSet instanceof Set ? Array.from(wish.mustHaveSet) : Array.from(desired)));

          const instances = ownedIndex.byItemHash.get(Number(wish.itemHash) || Number(itemHash)) || [];
          const matchingInstances = [];
          for (const iid of instances) {
            const owned = ownedIndex.byInstanceId.get(iid);
            if (!owned) continue;
            // Subset check: mustHave ⊆ owned.rolledPerkSet
            let hasAll = true;
            for (const h of mustHave) if (!owned.rolledPerkSet.has(h)) { hasAll = false; break; }
            if (!hasAll) continue;
            matchingInstances.push(iid);
          }

          wish.receivedInstances = matchingInstances;
          wish.received = matchingInstances.length > 0;

          // Match quality: intersection of desired and rolledPerkSet of best matching instance
          let bestScore = 0;
          for (const iid of matchingInstances) {
            const owned = ownedIndex.byInstanceId.get(iid);
            if (!owned) continue;
            let matched = 0;
            for (const h of desired) if (owned.rolledPerkSet.has(h)) matched++;
            const score = desired.size > 0 ? (matched / desired.size) : 0;
            if (score > bestScore) bestScore = score;
          }
          wish.matchScore = bestScore;

          if (wish.received) received++;
        }
      }
    }

    return { totalEntries: total, receivedCount: received };
  }

  /**
   * Get the cached OwnedIndex, if available.
   */
  function getCachedIndex() { return cache.index; }

  // Export
  global.OwnedInventoryIndex = {
    buildOwnedIndex,
    matchWishlist,
    getCachedIndex
  };

})(window || this);
