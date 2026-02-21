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
    index: null,
    instanceIds: new Set()
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
    const byItemHash = new Map(); // itemHash -> Set<instanceId>

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

        if (!byItemHash.has(itemHash)) byItemHash.set(itemHash, new Set());
        byItemHash.get(itemHash).add(instanceId);
      } catch (e) {
        console.warn('[OwnedIndex] error building entry for', instanceId, e);
      }
    }

    const index = { byInstanceId, byItemHash };
    cache.index = index;
    cache.profileVersion = version;
    cache.instanceIds = new Set(Object.keys(socketEntries));
    cache.lastProfile = profile;
    return index;
  }

  /**
   * Match wishlist entries in `dimData` against an OwnedIndex.
   * This mutates `dimData` in-place to set `received`, `receivedInstances` and `matchScore` for each wish.
   * @param {object} dimData - the stored wishlist data structure
   * @param {OwnedIndex} ownedIndex
   * @returns {object} summary {totalEntries, receivedCount}
   */
  // Internal implementation that mutates the provided `data` structure and
  // returns the summary. This is reused by the pure and in-place APIs.
  function matchWishlistImpl(data, ownedIndex) {
    if (!data || !data.lists) return { totalEntries: 0, receivedCount: 0 };

    let total = 0, received = 0;

    for (const listId of Object.keys(data.lists)) {
      const list = data.lists[listId];
      if (!list || !list.items) continue;
      for (const itemHash of Object.keys(list.items)) {
        const item = list.items[itemHash];
        if (!item || !Array.isArray(item.wishes)) continue;
        for (const wish of item.wishes) {
          total++;
          const desired = new Set(Array.isArray(wish.desiredSet) ? wish.desiredSet : (wish.desiredSet instanceof Set ? Array.from(wish.desiredSet) : []));
          const mustHave = new Set(Array.isArray(wish.mustHaveSet) ? wish.mustHaveSet : (wish.mustHaveSet instanceof Set ? Array.from(wish.mustHaveSet) : Array.from(desired)));

          const instancesSet = ownedIndex.byItemHash.get(Number(wish.itemHash) || Number(itemHash));
          const instances = instancesSet ? Array.from(instancesSet) : [];
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
   * Mutating API kept for compatibility: annotates `dimData` in-place.
   */
  function matchWishlist(dimData, ownedIndex) {
    return matchWishlistImpl(dimData, ownedIndex);
  }

  /**
   * Pure API: returns an object { annotatedData, summary } and does NOT mutate input.
   */
  function matchWishlistPure(dimData, ownedIndex) {
    const copy = JSON.parse(JSON.stringify(dimData || {}));
    const summary = matchWishlistImpl(copy, ownedIndex);
    return { annotatedData: copy, summary };
  }

  /**
   * Get the cached OwnedIndex, if available.
   */
  function getCachedIndex() { return cache.index; }

  /**
   * Apply a profile delta (addedInstanceIds, removedInstanceIds) to an existing OwnedIndex.
   * This mutates the provided index in-place and keeps cache in sync.
   * @param {{addedInstanceIds?:string[], removedInstanceIds?:string[]}} delta
   * @param {OwnedIndex} ownedIndex
   */
  function applyProfileDelta(delta, ownedIndex) {
    if (!delta || !ownedIndex) return ownedIndex;
    const added = delta.addedInstanceIds || [];
    const removed = delta.removedInstanceIds || [];

    // Handle removals first
    for (const iid of removed) {
      const owned = ownedIndex.byInstanceId.get(iid);
      if (!owned) continue;
      ownedIndex.byInstanceId.delete(iid);
      const s = ownedIndex.byItemHash.get(owned.itemHash);
      if (s) {
        s.delete(iid);
        if (s.size === 0) ownedIndex.byItemHash.delete(owned.itemHash);
      }
    }

    // Handle additions
    for (const iid of added) {
      try {
        const instComp = (cache.lastProfile?.itemInstances?.data || {})[iid] || {};
        const itemObj = (cache.lastProfile?.items?.data || {})[iid] || {};
        const itemHash = itemObj?.itemHash || (instComp?.itemHash ?? null);
        if (!itemHash) continue;
        const rolledPerkSet = buildRolledPerkSet(cache.lastProfile, iid);

        let location = 'inventory';
        let characterId = null;
        const itemLocation = cache.lastProfile?.itemInventories?.data?.[iid] || cache.lastProfile?.profileInventory?.data?.items?.find?.(i => i.itemInstanceId === iid);
        if (itemLocation && itemLocation.bucketHash === 215593132) location = 'postmaster';

        const isCrafted = !!(instComp?.state && (instComp.state & 16));

        const owned = { instanceId: iid, itemHash, rolledPerkSet, location, characterId, isCrafted };

        ownedIndex.byInstanceId.set(iid, owned);
        if (!ownedIndex.byItemHash.has(itemHash)) ownedIndex.byItemHash.set(itemHash, new Set());
        ownedIndex.byItemHash.get(itemHash).add(iid);
      } catch (e) {
        console.warn('[OwnedIndex] applyProfileDelta add error', iid, e);
      }
    }

    // Keep cache.instanceIds in sync
    for (const r of removed) cache.instanceIds.delete(r);
    for (const a of added) cache.instanceIds.add(a);

    return ownedIndex;
  }

  /**
   * Update the cached index from a new profile. Attempts to apply an incremental delta
   * when possible, otherwise falls back to a full rebuild.
   * @param {object} newProfile
   * @returns {OwnedIndex}
   */
  function updateFromProfile(newProfile) {
    if (!newProfile) return cache.index;
    cache.lastProfile = newProfile;
    const newVersion = newProfile?.profileInventory?.data?.version || newProfile?.profile?.data?.version || null;
    const newInstanceIds = new Set(Object.keys(newProfile?.itemSockets?.data || {}));

    if (!cache.index || !cache.instanceIds || cache.instanceIds.size === 0) {
      // No existing index — build fresh
      return buildOwnedIndex(newProfile);
    }

    // Compute delta
    const added = [];
    const removed = [];
    for (const id of newInstanceIds) if (!cache.instanceIds.has(id)) added.push(id);
    for (const id of cache.instanceIds) if (!newInstanceIds.has(id)) removed.push(id);

    // If delta seems reasonable (not a huge reparenting), apply it; otherwise rebuild
    const deltaThreshold = 200; // heuristics: if too many changes, rebuild for correctness
    if ((added.length + removed.length) > deltaThreshold) return buildOwnedIndex(newProfile);

    applyProfileDelta({ addedInstanceIds: added, removedInstanceIds: removed }, cache.index);
    cache.profileVersion = newVersion;
    cache.instanceIds = newInstanceIds;
    return cache.index;
  }

  // Export
  global.OwnedInventoryIndex = {
    buildOwnedIndex,
    matchWishlist, // mutating compatibility API
    matchWishlistPure,
    applyProfileDelta,
    updateFromProfile,
    getCachedIndex
  };

})(window || this);
