// Ahamkara Wishes — searching what you own, without any screen.
//
// Works on the built OwnedIndex (your real Bungie inventory), the game's item
// definitions and your saved wishes, and says for every item you own: which
// copies there are, what perks each rolled, and which saved wishes each copy
// already satisfies ("I own the roll I wanted").
//
// Pure functions over plain data; tests/inventory-core-test.js. The classic
// Menu > Utility search in manager.js has its own copy until the new design
// replaces it.

(function (root) {
  'use strict';

  // The slot chips. Weapon buckets are listed here; armor buckets match BUCKET_HASHES in destiny-manifest.js.
  const SLOTS = [
    { key: 'kinetic', label: 'Kinetic', bucket: 1498876634 },
    { key: 'energy', label: 'Energy', bucket: 2465295065 },
    { key: 'power', label: 'Power', bucket: 953998645 },
    { key: 'helmet', label: 'Helmet', bucket: 3448274439 },
    { key: 'arms', label: 'Arms', bucket: 3551918588 },
    { key: 'chest', label: 'Chest', bucket: 14239492 },
    { key: 'legs', label: 'Legs', bucket: 20886954 },
    { key: 'class', label: 'Class', bucket: 1585787867 }
  ];
  const ARMOR_BUCKETS = new Set(SLOTS.slice(3).map((s) => s.bucket));
  const RESULT_CAP = 50;
  const MIN_QUERY = 2;
  const PLUG_ITEM_TYPE = 19; // itemType 19 = Plug (perks, mods)

  /** instanceId -> the wishes this exact copy satisfies, from what matching already recorded. */
  function matchLookup(dimData) {
    const map = new Map();
    for (const list of Object.values((dimData && dimData.lists) || {})) {
      for (const item of Object.values((list && list.items) || {})) {
        for (const wish of ((item && item.wishes) || [])) {
          for (const iid of ((wish && wish.receivedInstances) || [])) {
            const key = String(iid);
            if (!map.has(key)) map.set(key, []);
            map.get(key).push({ listName: (list && list.name) || 'Wishlist', mode: (wish.tags && wish.tags[0]) === 'pvp' ? 'pvp' : 'pve' });
          }
        }
      }
    }
    return map;
  }

  /**
   * True when there is nothing to search yet, so the screen shows a hint instead
   * of the whole inventory. A slot, or "matches a wish", is enough to browse.
   */
  const needsInput = (query, slots, onlyMatches) => String(query || '').trim().length < MIN_QUERY && !(slots && slots.size) && !onlyMatches;

  /**
   * @param {object} o
   *   index        OwnedIndex { byItemHash: Map<hash, Set<instanceId>>, byInstanceId: Map }
   *   defs         Map<string hash, itemDef>
   *   dimData      saved wishes (for the "matches a wish" marks)
   *   query        name text (2+ letters) — optional if slots are chosen
   *   slots        Set of SLOTS keys — optional if a query is given
   *   onlyMatches  keep only items with a copy that satisfies a wish
   *   onlyHash     just this item (the detail screen)
   *   perkSocketIndexes(def)  the real perk columns of a weapon (not mods, shaders, trackers)
   *   isTracker(name)         a kill-tracker plug
   *   iconRoot     prefix for relative icon paths
   * @returns {{ items: object[], capped: boolean }}
   */
  function search(o) {
    const q = String(o.query || '').trim().toLowerCase();
    const buckets = new Set(SLOTS.filter((s) => o.slots && o.slots.has(s.key)).map((s) => s.bucket));
    const idx = o.index, defs = o.defs;
    const out = [];
    if (!idx || !idx.byItemHash || !defs) return { items: out, capped: false };
    const matches = matchLookup(o.dimData);
    const root_ = o.iconRoot || '';
    const iconOf = (def) => (def && def.displayProperties && def.displayProperties.icon ? `${root_}${def.displayProperties.icon}` : '');

    for (const [itemHash, instanceIds] of idx.byItemHash.entries()) {
      if (o.onlyHash !== undefined && String(itemHash) !== String(o.onlyHash)) continue;
      const def = defs.get(String(itemHash));
      const name = (def && def.displayProperties && def.displayProperties.name) || '';
      if (!name) continue;
      if (o.onlyHash === undefined) {
        if (q.length >= MIN_QUERY && !name.toLowerCase().includes(q)) continue;
        const bucket = def.inventory && def.inventory.bucketTypeHash;
        if (buckets.size && !buckets.has(bucket)) continue;
      }
      const bucketHash = (def.inventory && def.inventory.bucketTypeHash) ?? null;
      const isWeapon = def.itemType === 3;
      const perkSockets = isWeapon && o.perkSocketIndexes ? o.perkSocketIndexes(def) : null;

      const instances = Array.from(instanceIds).map((iid) => {
        const owned = idx.byInstanceId.get(iid);
        const all = Array.isArray(owned && owned.perkSockets) ? owned.perkSockets : [];
        const sockets = perkSockets ? all.filter((s) => perkSockets.has(s.socketIndex)) : all;
        const columns = sockets.map((socket) => ({
          socketIndex: socket.socketIndex,
          activeHash: socket.activeHash,
          perks: (socket.options || []).map((h) => {
            const pd = defs.get(String(h));
            if (!pd || !pd.displayProperties || !pd.displayProperties.name || pd.itemType !== PLUG_ITEM_TYPE) return null;
            return { hash: h, name: pd.displayProperties.name, icon: iconOf(pd), isActive: h === socket.activeHash };
          }).filter(Boolean)
        })).filter((c) => c.perks.length > 0 && !(o.isTracker && c.perks.every((p) => o.isTracker(p.name))));
        return {
          instanceId: iid, columns, isCrafted: !!(owned && owned.isCrafted),
          wishMatches: matches.get(String(iid)) || [],
          armorArchetype: (owned && owned.armorArchetype) || null,
          armorTertiary: (owned && owned.armorTertiary) || null
        };
      });
      const matchCount = instances.filter((i) => i.wishMatches.length > 0).length;
      if (o.onlyMatches && !matchCount) continue;

      out.push({
        hash: itemHash, name, subtitle: def.itemTypeDisplayName || '', icon: iconOf(def), isWeapon,
        isArmor: ARMOR_BUCKETS.has(bucketHash), classType: def.classType ?? null,
        setHash: (def.equippingBlock && def.equippingBlock.equipableItemSetHash) ?? null, bucketHash, instances, matchCount
      });
    }

    // Items that match a wish first: "I already own the roll I wanted" must be impossible to scroll past.
    // Sorted before the cap, so a matching item can never be the one cut off.
    out.sort((a, b) => ((b.matchCount > 0) - (a.matchCount > 0)) || b.matchCount - a.matchCount || a.name.localeCompare(b.name, 'en', { sensitivity: 'base' }));
    const capped = out.length > RESULT_CAP;
    return { items: capped ? out.slice(0, RESULT_CAP) : out, capped };
  }

  /**
   * What a builder needs to start a NEW wish from one owned copy. Nothing is saved
   * until the person saves in the builder, so this is always safe to trigger.
   */
  function wishInput(item, instance) {
    if (item.isWeapon) {
      // socketIndex -> the plug actually equipped (not the whole pool the column could roll)
      const activeBySocketIndex = {};
      instance.columns.forEach((c) => { if (c.activeHash) activeBySocketIndex[c.socketIndex] = c.activeHash; });
      return { kind: 'weapon', hash: item.hash, name: item.name, activeBySocketIndex };
    }
    if (item.isArmor) return { kind: 'armor', hash: item.hash, archetype: instance.armorArchetype, tertiary: instance.armorTertiary };
    return null;
  }

  /** "3 owned · 2 match a wish" */
  function summaryOf(item) {
    const n = item.instances.length;
    return [item.subtitle, `${n} owned`].filter(Boolean).join(' · ');
  }

  root.AWInventory = { SLOTS, RESULT_CAP, MIN_QUERY, matchLookup, needsInput, search, wishInput, summaryOf };
})(typeof window !== 'undefined' ? window : globalThis);
