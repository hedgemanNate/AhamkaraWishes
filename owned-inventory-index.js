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

  // Combo colours a weapon wish can carry, in slot order. Mirrors COMBO_COLORS
  // in the weapon builder, which is what writes them.
  const COMBO_COLORS = ['red', 'blue', 'green', 'orange'];

  // A combo needs members in at least two columns to mean anything — a colour
  // sitting alone in one column constrains nothing the column itself doesn't
  // already say, so it is ignored rather than treated as a hard requirement.
  const MIN_COMBO_COLUMNS = 2;

  /**
   * Rebuild combos from saved perkColumnsData. Each column entry may carry a
   * `colors` map naming the one perk wearing each colour there; a colour found
   * across two or more columns becomes a combo — a concrete perk tuple that an
   * owned roll has to satisfy in full.
   * @param {Array<{socketIndex:number, colIndex:number, hashes:number[], colors?:Object}>} perkColumnsData
   * @returns {Array<{color:string, members:Array<{socketIndex:number, hashes:number[]}>}>}
   */
  function buildCombos(perkColumnsData) {
    const byColor = new Map();
    for (const entry of perkColumnsData) {
      for (const [color, hashes] of Object.entries(entry.colors || {})) {
        if (!Array.isArray(hashes) || hashes.length === 0) continue;
        if (!byColor.has(color)) byColor.set(color, []);
        byColor.get(color).push({ socketIndex: entry.socketIndex, hashes });
      }
    }

    const combos = [];
    for (const color of COMBO_COLORS) {
      const members = byColor.get(color);
      if (members && members.length >= MIN_COMBO_COLUMNS) combos.push({ color, members });
    }
    return combos;
  }

  /** True when the owned roll's socket at `socketIndex` holds any of `hashes`. */
  function socketHasAny(owned, socketIndex, hashes) {
    const socket = owned.perkSockets[socketIndex];
    if (!socket) return false;
    return hashes.some((h) => socket.options.includes(h));
  }

  // Reverse lookup: statHash -> statName, built from DestinyStatDefinition.
  // Populated once during buildOwnedIndex; reused by applyProfileDelta.
  let _armorHashToStatName = null;
  // Cached item defs used by applyProfileDelta (sync path) after initial build.
  let _itemDefs = null;

  function buildArmorHashToStatName(hashsByName) {
    const map = new Map();
    for (const [name, hashes] of hashsByName.entries()) {
      for (const h of hashes) map.set(h, name);
    }
    return map;
  }

  /**
   * Derive an armor piece's true archetype and Tertiary from its base roll by
   * reading only the `armor_stats` socket plugs — the three sockets that hold
   * the item's actual rolled stat values, untouched by mods or masterwork.
   *
   * Returns { archetype: string|null, tertiary: string|null } where archetype is
   * the matching ARCHETYPES entry name (e.g. "GUNNER") and tertiary is the name
   * of the 3rd-highest base stat. Returns null when no armor_stats sockets are
   * found (non-armor item or missing item defs).
   */
  /**
   * A wish's Tertiary in either config shape. Mirrors WishlistSync.armorFields
   * (wishlist-sync-core.js), inlined so this module still loads on its own in
   * the Node tests: before the Tertiary/Spark split the Tertiary was saved as
   * `spark`, and a config with a `tertiary` key is in the current shape.
   */
  function armorTertiaryOf(cfg) {
    if (!cfg) return null;
    const legacy = !Object.prototype.hasOwnProperty.call(cfg, 'tertiary');
    return (legacy ? cfg.spark : cfg.tertiary) || null;
  }

  function computeArmorRoll(perkSockets, itemDefs) {
    if (!_armorHashToStatName || !itemDefs || !perkSockets) return null;

    // Collect base stat values from armor_stats sockets only — these hold the
    // raw roll values before any mods, masterwork, or tuning adjustments.
    const baseStats = new Map(); // statName -> value
    for (const socket of perkSockets) {
      if (!socket.activeHash) continue;
      const def = itemDefs.get(String(socket.activeHash));
      if (def?.plug?.plugCategoryIdentifier !== 'armor_stats') continue;
      for (const invStat of (def.investmentStats || [])) {
        if (invStat.value <= 0) continue;
        const name = _armorHashToStatName.get(invStat.statTypeHash);
        if (name) baseStats.set(name, Math.max(invStat.value, baseStats.get(name) ?? 0));
      }
    }

    if (baseStats.size === 0) return null;

    // Sort stats by base value descending: top 2 = archetype, 3rd = Tertiary.
    const sorted = [...baseStats.entries()].sort((a, b) => b[1] - a[1]);

    let archetype = null;
    if (sorted.length >= 2 && typeof ARCHETYPES !== 'undefined') {
      const top2 = new Set([sorted[0][0], sorted[1][0]]);
      const match = ARCHETYPES.find(a => top2.has(a.stats[0]) && top2.has(a.stats[1]));
      if (match) archetype = match.name;
    }

    const tertiary = sorted.length >= 3 ? sorted[2][0] : null;
    return { archetype, tertiary };
  }

  /**
   * Build the per-socket perk structure for an instance: each socket's
   * currently-equipped plug plus every other plug that could have rolled there
   * (the full random-roll pool). The "isEnabled" flag on the base sockets
   * component only tells us the ACTIVE plug per socket — the full pool of
   * possible perks per socket instead lives in the separate ItemReusablePlugs
   * component (310), keyed by socket index.
   * @param {object} profile
   * @param {string} instanceId
   * @returns {Array<{socketIndex:number, activeHash:number|null, options:number[]}>}
   */
  function buildPerkSockets(profile, instanceId) {
    const socketData = profile?.itemComponents?.sockets?.data?.[instanceId]?.sockets;
    if (!Array.isArray(socketData)) return [];

    const reusableBySocket = profile?.itemComponents?.reusablePlugs?.data?.[instanceId]?.plugs || {};

    return socketData.map((s, socketIndex) => {
      const activeHash = s.plugHash || null;
      const options = new Set();
      if (activeHash) options.add(activeHash);
      const reusable = reusableBySocket[String(socketIndex)];
      if (Array.isArray(reusable)) {
        for (const p of reusable) {
          if (p?.plugItemHash) options.add(p.plugItemHash);
        }
      }
      return { socketIndex, activeHash, options: Array.from(options) };
    });
  }

  /**
   * Build a rolledPerkSet from profile socket + reusable-plug data for an
   * instance — a flattened view of every perk that could be on this roll,
   * used for wishlist subset matching.
   * @param {object} profile - Destiny2.GetProfile response object (component bundle)
   * @param {string} instanceId
   * @returns {Set<number>} set of plug hashes
   */
  function buildRolledPerkSet(profile, instanceId) {
    const rolled = new Set();
    for (const socket of buildPerkSockets(profile, instanceId)) {
      for (const h of socket.options) rolled.add(h);
    }
    return rolled;
  }

  const POSTMASTER_BUCKET_HASH = 215593132;
  // DestinyItemState.Crafted. `state` lives on the inventory item itself
  // (DestinyItemComponent), not on the ItemInstances component.
  const ITEM_STATE_CRAFTED = 8;

  /**
   * Bungie stamps every GetProfile response with responseMintedTimestamp; two
   * responses carrying the same stamp are the same cached snapshot. Falls back
   * to the inventory version for fixtures/older payloads that lack it.
   */
  function profileVersionOf(profile) {
    return profile?.responseMintedTimestamp || profile?.profileInventory?.data?.version || profile?.profile?.data?.version || null;
  }

  /**
   * One pass over every inventory source: instanceId -> {itemHash, characterId,
   * bucketHash, state}. Vault items (profileInventory) have no owning
   * character; character inventory/equipment items need that characterId for
   * the SetLockState and TransferItem APIs.
   * @returns {Map<string, {itemHash:number, characterId:string|null, bucketHash:number, state:number}>}
   */
  function scanInventoryItems(profile) {
    const items = new Map();
    const scan = (arr, characterId = null) => {
      for (const item of (arr || [])) {
        if (!item.itemInstanceId || !item.itemHash) continue;
        items.set(String(item.itemInstanceId), {
          itemHash: item.itemHash,
          characterId,
          bucketHash: item.bucketHash,
          state: item.state || 0
        });
      }
    };
    scan(profile?.profileInventory?.data?.items);
    const charInvs = profile?.characterInventories?.data || {};
    const charEquip = profile?.characterEquipment?.data || {};
    for (const cid of Object.keys(charInvs)) scan(charInvs[cid]?.items, cid);
    for (const cid of Object.keys(charEquip)) scan(charEquip[cid]?.items, cid);
    return items;
  }

  /** Build the OwnedIndex entry for one instance, or null if it isn't in any inventory. */
  function buildOwnedEntry(profile, instanceId, item) {
    if (!item) return null;
    const perkSockets = buildPerkSockets(profile, instanceId);
    const rolledPerkSet = new Set();
    for (const socket of perkSockets) for (const h of socket.options) rolledPerkSet.add(h);
    return {
      instanceId,
      itemHash: item.itemHash,
      rolledPerkSet,
      perkSockets,
      location: item.bucketHash === POSTMASTER_BUCKET_HASH ? 'postmaster' : 'inventory',
      characterId: item.characterId,
      isCrafted: (item.state & ITEM_STATE_CRAFTED) !== 0
    };
  }

  /**
   * Build OwnedIndex from a profile response.
   * Note: expects `profile` to include the inventory (102/201/205), ItemSockets
   * (305) and ItemReusablePlugs (310) components.
   * @param {object} profile - profile response
   * @returns {OwnedIndex}
   */
  async function buildOwnedIndex(profile) {
    if (!profile) return { byInstanceId: new Map(), byItemHash: new Map() };

    const version = profileVersionOf(profile);
    if (cache.profileVersion && cache.profileVersion === version && cache.index) return cache.index;

    const byInstanceId = new Map();
    const byItemHash = new Map(); // itemHash -> Set<instanceId>

    const items = scanInventoryItems(profile);
    const socketEntries = profile?.itemComponents?.sockets?.data || {};

    for (const instanceId of Object.keys(socketEntries)) {
      try {
        const owned = buildOwnedEntry(profile, instanceId, items.get(instanceId));
        if (!owned) continue;
        const itemHash = owned.itemHash;

        byInstanceId.set(instanceId, owned);

        if (!byItemHash.has(itemHash)) byItemHash.set(itemHash, new Set());
        byItemHash.get(itemHash).add(instanceId);
      } catch (e) {
        console.warn('[OwnedIndex] error building entry for', instanceId, e);
      }
    }

    // --- Armor stat pass ---
    // Load stat hash→name map and item defs, then classify each armor instance
    // by reading its armor_stats socket plugs directly for true base roll values
    // (ignoring mods, masterwork, and tuning adjustments).
    try {
      if (typeof loadArmorStatHashesByName === 'function' && typeof loadInventoryItemDefsToMemory === 'function') {
        const [hashsByName, itemDefs] = await Promise.all([
          loadArmorStatHashesByName(),
          loadInventoryItemDefsToMemory()
        ]);
        if (hashsByName && hashsByName.size > 0 && itemDefs) {
          _armorHashToStatName = buildArmorHashToStatName(hashsByName);
          _itemDefs = itemDefs;

          for (const [, owned] of byInstanceId.entries()) {
            const roll = computeArmorRoll(owned.perkSockets, itemDefs);
            if (roll) {
              owned.armorArchetype = roll.archetype;
              owned.armorTertiary = roll.tertiary;
            }
          }
        }
      }
    } catch (e) {
      console.warn('[OwnedIndex] armor stat pass failed:', e);
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
   *
   * Weapon match definition: same weapon (itemHash) AND, for every column the
   * wish specifies acceptable perks for (barrel/mag/trait1/trait2 AND the origin
   * trait column alike), the owned roll's socket at that same index contains at
   * least one of those acceptable hashes. Columns 1-4 typically carry a single
   * required perk each (OR within the column, AND across columns 1-4); the origin
   * trait column (5th) follows the identical rule — only one matching perk is
   * needed there too. A column the user left unselected imposes no constraint.
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
        // Some weapons exist twice in the manifest under different hashes with
        // an otherwise identical name/season (a leftover duplicate definition —
        // only one variant usually actually drops). linkedHashes, auto-captured
        // at craft time, lets matching check owned copies under ANY sibling
        // hash, not just the one the user happened to pick in search.
        const aliasHashes = Array.isArray(item.static?.linkedHashes) ? item.static.linkedHashes : [];
        const allHashesToCheck = [Number(itemHash), ...aliasHashes.map(Number)];

        for (const wish of item.wishes) {
          total++;

          // Cleared up front so a wish edited from combos back to plain columns
          // doesn't keep reporting the previous run's combo results.
          wish.comboMatches = null;
          wish.matchedCombos = [];

          const instances = [];
          for (const h of allHashesToCheck) {
            const instancesSet = ownedIndex.byItemHash.get(h);
            if (instancesSet) instances.push(...instancesSet);
          }
          const matchingInstances = [];

          // --- Armor matching ---
          // Armor wishes carry an archetype (e.g. "GUNNER") and, optionally, a
          // Tertiary (e.g. "Health") and a Spark. Each owned armor instance is
          // pre-classified with armorArchetype (the archetype whose stat pair are
          // the top 2 base-roll stats) and armorTertiary (the 3rd-highest).
          // Stage 1 = archetype matches; Stage 2 (full match) = Tertiary matches
          // too, or the wish takes any Tertiary.
          // Spark (the Tier 5 tuned stat) isn't matched yet: reading it from an
          // owned piece still has to be verified on a live profile (D9), so a
          // wish's Spark doesn't narrow the match for now.
          const archName = wish.config?.archetype;
          if (archName) {
            const tertiary = armorTertiaryOf(wish.config);
            const stage1 = [], stage2 = [];

            for (const iid of instances) {
              const owned = ownedIndex.byInstanceId.get(iid);
              if (!owned?.armorArchetype) continue;
              if (owned.armorArchetype !== archName) continue;
              stage1.push(iid);
              if (!tertiary || owned.armorTertiary === tertiary) stage2.push(iid);
            }

            wish.receivedInstances = stage2;
            wish.received = stage2.length > 0;
            wish.matchScore = wish.received ? 1.0 : 0;
            wish.matchedPerkHashes = [];
            // Stage 1: instances whose true archetype matches, regardless of Tertiary
            wish.stage1Instances = stage1;
            wish.stage1Received = stage1.length > 0;
            if (wish.received) received++;
            continue;
          }

          // Column-aware weapon rolls: each column's acceptable hashes are
          // tagged with the def's real socket index, so a roll only matches
          // if EVERY wishlisted column has at least one acceptable perk in
          // its own socket (not just anywhere on the item).
          const perkColumnsData = Array.isArray(wish.config?.perkColumnsData) ? wish.config.perkColumnsData : null;

          // Combo matching: a colour appearing in two or more columns names a
          // concrete perk tuple. Once a wish defines any combo, an owned roll
          // has to satisfy a WHOLE combo to count — the per-column any-of rule
          // below is what lets unrelated perks pair up into matches that were
          // never wished for, and combos exist precisely to stop that.
          const combos = perkColumnsData ? buildCombos(perkColumnsData) : [];

          if (combos.length > 0) {
            // Columns no colour touches keep the plain any-of rule. A column
            // holding a colour is governed by its combos alone, so plain picks
            // sitting beside a coloured perk no longer open their own path.
            const uncoloredColumns = perkColumnsData.filter((c) => Object.keys(c.colors || {}).length === 0);

            const comboMatches = {};
            for (const { color } of combos) comboMatches[color] = [];
            const matchedPerkHashes = new Set();

            for (const iid of instances) {
              const owned = ownedIndex.byInstanceId.get(iid);
              if (!owned || !Array.isArray(owned.perkSockets)) continue;

              if (!uncoloredColumns.every(({ socketIndex, hashes }) => socketHasAny(owned, socketIndex, hashes))) continue;

              let matchedAny = false;
              for (const { color, members } of combos) {
                if (!members.every(({ socketIndex, hashes }) => socketHasAny(owned, socketIndex, hashes))) continue;
                comboMatches[color].push(iid);
                matchedAny = true;
                for (const { socketIndex, hashes } of members) {
                  for (const h of hashes) {
                    if (owned.perkSockets[socketIndex].options.includes(h)) matchedPerkHashes.add(h);
                  }
                }
              }
              if (!matchedAny) continue;

              matchingInstances.push(iid);
              for (const { socketIndex, hashes } of uncoloredColumns) {
                for (const h of hashes) {
                  if (owned.perkSockets[socketIndex]?.options.includes(h)) matchedPerkHashes.add(h);
                }
              }
            }

            wish.receivedInstances = matchingInstances;
            wish.received = matchingInstances.length > 0;
            // Per-combo instance lists — combos are independent, so three combos
            // can legitimately be covered by three different guns and the card
            // shows an owned count against each one.
            wish.comboMatches = comboMatches;
            wish.matchedCombos = combos.map((c) => c.color).filter((c) => comboMatches[c].length > 0);
            wish.matchedPerkHashes = Array.from(matchedPerkHashes);
            wish.traitPoolMatchedInstances = [];
            // "How much of this wish do I have" — counts satisfied combos rather
            // than scoring a single best instance, since no one roll is expected
            // to carry them all.
            wish.matchScore = wish.matchedCombos.length / combos.length;
            if (wish.received) received++;
            continue;
          }

          if (perkColumnsData && perkColumnsData.length > 0) {
            // Additional match rule (OR'd with the strict per-column rule
            // below — never replaces it): columns 3 & 4 (0-indexed colIndex 2
            // & 3) are the weapon's two trait-perk columns. Pool the
            // wishlisted perks from just those two columns and treat it as a
            // match if 4 or more of them (out of up to 6 total) are present
            // on the owned roll's matching sockets — even if one of the two
            // columns individually has zero hits. This catches outlier rolls
            // the strict AND-across-all-columns rule misses. Fixed threshold:
            // if fewer than 4 perks were wishlisted across the two columns,
            // this rule can never fire (all of them would need to hit).
            // Requires colIndex on perkColumnsData entries (added at save
            // time); wishes saved before that are backfilled via
            // backfillPerkColIndex() in manager.js, so this degrades to "rule
            // doesn't apply yet" rather than misfiring on untagged data.
            const TRAIT_POOL_MATCH_THRESHOLD = 4;
            const col3Entry = perkColumnsData.find((c) => c.colIndex === 2);
            const col4Entry = perkColumnsData.find((c) => c.colIndex === 3);
            const traitPoolHashes = (col3Entry && col4Entry)
              ? [...col3Entry.hashes, ...col4Entry.hashes]
              : null;

            const traitPoolMatchedInstances = [];

            for (const iid of instances) {
              const owned = ownedIndex.byInstanceId.get(iid);
              if (!owned || !Array.isArray(owned.perkSockets)) continue;

              const allColumnsMatch = perkColumnsData.every(({ socketIndex, hashes }) => {
                const socket = owned.perkSockets[socketIndex];
                if (!socket) return false;
                return hashes.some((h) => socket.options.includes(h));
              });

              let traitPoolMatch = false;
              if (traitPoolHashes && traitPoolHashes.length > 0) {
                const socket3 = owned.perkSockets[col3Entry.socketIndex];
                const socket4 = owned.perkSockets[col4Entry.socketIndex];
                let hitCount = 0;
                for (const h of col3Entry.hashes) if (socket3 && socket3.options.includes(h)) hitCount++;
                for (const h of col4Entry.hashes) if (socket4 && socket4.options.includes(h)) hitCount++;
                traitPoolMatch = hitCount >= TRAIT_POOL_MATCH_THRESHOLD;
              }

              if (allColumnsMatch || traitPoolMatch) {
                matchingInstances.push(iid);
                if (traitPoolMatch && !allColumnsMatch) traitPoolMatchedInstances.push(iid);
              }
            }

            wish.receivedInstances = matchingInstances;
            wish.received = matchingInstances.length > 0;
            // Instances that matched ONLY via the columns-3&4 pooled rule, not
            // the strict per-column rule — kept for debugging/UI transparency.
            wish.traitPoolMatchedInstances = traitPoolMatchedInstances;

            // Which specific acceptable hashes were actually confirmed present
            // on a matching owned roll — lets the UI put a gold border on just
            // those perk icons instead of highlighting the whole card.
            const matchedPerkHashes = new Set();
            let bestScore = 0;
            for (const iid of matchingInstances) {
              const owned = ownedIndex.byInstanceId.get(iid);
              if (!owned) continue;
              const matchedColumns = perkColumnsData.filter(({ socketIndex, hashes }) => {
                const socket = owned.perkSockets[socketIndex];
                if (!socket) return false;
                const hit = hashes.some((h) => socket.options.includes(h));
                if (hit) hashes.forEach((h) => { if (socket.options.includes(h)) matchedPerkHashes.add(h); });
                return hit;
              }).length;
              const score = perkColumnsData.length > 0 ? (matchedColumns / perkColumnsData.length) : 0;
              if (score > bestScore) bestScore = score;
            }
            wish.matchScore = bestScore;
            wish.matchedPerkHashes = Array.from(matchedPerkHashes);
            if (wish.received) received++;
            continue;
          }

          // Legacy fallback for wishes saved before perkColumnsData existed:
          // flat subset check across the whole roll pool (column-blind).
          const desired = new Set(Array.isArray(wish.desiredSet) ? wish.desiredSet : (wish.desiredSet instanceof Set ? Array.from(wish.desiredSet) : []));
          const mustHave = new Set(Array.isArray(wish.mustHaveSet) ? wish.mustHaveSet : (wish.mustHaveSet instanceof Set ? Array.from(wish.mustHaveSet) : Array.from(desired)));

          for (const iid of instances) {
            const owned = ownedIndex.byInstanceId.get(iid);
            if (!owned) continue;
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

    // Handle additions — look up each new instance in the latest profile
    const lp = cache.lastProfile;
    const items = scanInventoryItems(lp);

    for (const iid of added) {
      try {
        const owned = buildOwnedEntry(lp, iid, items.get(iid));
        if (!owned) continue;
        const itemHash = owned.itemHash;

        const roll = computeArmorRoll(owned.perkSockets, _itemDefs);
        if (roll) {
          owned.armorArchetype = roll.archetype;
          owned.armorTertiary = roll.tertiary;
        }

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
  async function updateFromProfile(newProfile) {
    if (!newProfile) return cache.index;
    cache.lastProfile = newProfile;
    const newVersion = profileVersionOf(newProfile);
    const newInstanceIds = new Set(Object.keys(newProfile?.itemComponents?.sockets?.data || {}));

    if (!cache.index || !cache.instanceIds || cache.instanceIds.size === 0) {
      // No existing index — build fresh
      return buildOwnedIndex(newProfile);
    }
    if (newVersion && newVersion === cache.profileVersion) return cache.index;

    // Compute delta
    const added = [];
    const removed = [];
    for (const id of newInstanceIds) if (!cache.instanceIds.has(id)) added.push(id);
    for (const id of cache.instanceIds) if (!newInstanceIds.has(id)) removed.push(id);

    // If delta seems reasonable (not a huge reparenting), apply it; otherwise rebuild
    const deltaThreshold = 200; // heuristics: if too many changes, rebuild for correctness
    if ((added.length + removed.length) > deltaThreshold) return await buildOwnedIndex(newProfile);

    applyProfileDelta({ addedInstanceIds: added, removedInstanceIds: removed }, cache.index);

    // An item moved between the vault and a character keeps its instanceId, so
    // the delta above never sees it — refresh where every kept item now sits,
    // or lock/vault-transfer calls go out with a stale characterId.
    const items = scanInventoryItems(newProfile);
    for (const [iid, owned] of cache.index.byInstanceId) {
      const item = items.get(iid);
      if (!item) continue;
      owned.characterId = item.characterId;
      owned.location = item.bucketHash === POSTMASTER_BUCKET_HASH ? 'postmaster' : 'inventory';
    }

    cache.profileVersion = newVersion;
    cache.instanceIds = newInstanceIds;
    return cache.index;
  }

  // Export
  global.OwnedInventoryIndex = {
    // Single source of truth for the combo slots — the weapon builder authors them
    // and manager.js renders them, and a mismatch would silently misfile perks.
    COMBO_COLORS,
    buildCombos,
    buildOwnedIndex,
    matchWishlist, // mutating compatibility API
    matchWishlistPure,
    applyProfileDelta,
    updateFromProfile,
    getCachedIndex
  };

})(window || this);
