// Shared by the side panel (weapon-craft.js, manager.js saveItem) and the
// service worker (godroll-add.js): turning a set of picked perks into a weapon
// wish, and adding a wish to a list with the duplicate rules. Pure functions
// over plain data, so both contexts produce byte-identical wishes — the `raw`
// string below is a wish's identity for duplicate checks and cross-browser sync.

(function (root) {
  // Max distinct perks per column in one wish (four combo slots plus a couple
  // of uncoloured "any of" picks).
  const ACCEPTABLE_CAP = 6;

  // The combo colour a perk wears in its column: a comboColors name, 'plain'
  // (selected but in no combo), or null (not selected).
  function perkColor(state, baseHash, comboColors) {
    for (const color of comboColors) {
      if (state.colors.get(color) === baseHash) return color;
    }
    return state.acceptable.has(baseHash) ? 'plain' : null;
  }

  /**
   * @param {Array<{socketIndex:number, pairs:Array<{base:object, enhanced?:object|null}>}>} columns
   *        the weapon's perk columns (destiny-manifest.js getWeaponPerkColumns)
   * @param {Array<{acceptable:Set<number>, colors:Map<string,number>}>} perkState  one per column
   * @param {string[]} comboColors  combo colour names in click-cycle order
   * @returns {{hasAny:boolean, rawString:string, config:object}}
   */
  function buildWeaponWishPayload(columns, perkState, comboColors) {
    const perksArray = perkState.map((s) => Array.from(s.acceptable));
    const hasAny = perksArray.some((c) => c.length > 0);

    // Build display data for the list card — resolved at save time so cards render instantly
    const perkColumns = columns.map((col, colIndex) => {
        const state = perkState[colIndex];
        const selected = [];
        for (const { base, enhanced } of col.pairs) {
            const isAcceptable = state.acceptable.has(base.hash) || (enhanced && state.acceptable.has(enhanced.hash));
            if (!isAcceptable) continue;
            // A perk may be in several combos; `colors` lists them all, `color` is
            // the first (older cards and lists read just that one), null for a
            // plain "any of this column" pick.
            const worn = comboColors.filter((c) => state.colors.get(c) === base.hash);
            selected.push({
                name: base.name,
                icon: base.icon,
                hash: base.hash,
                enhancedHash: enhanced?.hash ?? null,
                color: worn[0] ?? null,
                colors: worn
            });
        }
        return selected;
    }).filter((col) => col.length > 0);

    // Column-aware acceptable perks, tagged with the weapon def's real socket
    // index so inventory matching can compare column-to-column instead of
    // flattening everything into one set (which would let an accepted barrel
    // perk falsely "match" against an accepted trait perk on an owned roll).
    // colIndex (0-based column position) is stored alongside socketIndex so
    // matching can reliably identify "column 3" / "column 4" (the trait perk
    // columns) regardless of which columns were actually selected — needed
    // for the pooled columns-3-and-4 trait-perk matching rule in
    // owned-inventory-index.js.
    // `colors` names the one perk wearing each combo colour in this column,
    // carrying both its base and enhanced hashes (either form counts as a hit
    // on an owned roll). A colour spanning two or more columns is a combo; the
    // matcher rebuilds those from these entries.
    const perkColumnsData = columns
        .map((col, colIndex) => {
            const state = perkState[colIndex];
            const entry = { socketIndex: col.socketIndex, colIndex, hashes: Array.from(state.acceptable) };
            const colors = {};
            for (const c of comboColors) {
                const baseHash = state.colors.get(c);
                if (baseHash === undefined) continue;
                const pair = col.pairs.find((p) => p.base.hash === baseHash);
                colors[c] = pair?.enhanced ? [baseHash, pair.enhanced.hash] : [baseHash];
            }
            if (Object.keys(colors).length > 0) entry.colors = colors;
            return entry;
        })
        .filter((c) => c.hashes.length > 0);

    // Wish identity — the dup check in addWishToList() and the sync merge
    // key in wishlist-sync-core.js both hash this string, so two wishes with the
    // same perks but different combos MUST NOT collapse into one. The colour
    // signature is appended only when colours exist, keeping every previously
    // saved (uncoloured) wish byte-identical to what is already stored.
    const colorSig = perkState.map((s) => comboColors.map((c) => s.colors.get(c) ?? 0));
    const hasColors = colorSig.some((col) => col.some((h) => h !== 0));
    const rawString = JSON.stringify(perksArray) + (hasColors ? `|${JSON.stringify(colorSig)}` : '');

    return { hasAny, rawString, config: { perks: perksArray, perkColumns, perkColumnsData } };
  }

  /**
   * Adds one wish to `data.lists[listId]` in place (creating the item container,
   * or backfilling its metadata if it already exists). Does no storage I/O.
   * Duplicate rule (WishlistSync.wishKey): armor = same archetype + Tertiary
   * (+ Spark) + mode; weapon = same raw string + mode.
   * @param {object} data    dimData
   * @param {string} listId
   * @param {object} spec    { hash, name, type, rawString, config, mode, icon, classType,
   *                           bucketHash, slotName, setName, setHash, linkedHashes, weaponMeta }
   * @returns {'added'|'duplicate'}
   */
  function addWishToList(data, listId, spec) {
    const { hash, name, type, rawString, config, mode, icon, classType, bucketHash, slotName,
            setName, setHash, linkedHashes, weaponMeta } = spec;

    const activeList = data.lists[listId];
    if (!activeList.items) activeList.items = {};

    // Create container if missing
    if (!activeList.items[hash]) {
      activeList.items[hash] = {
        static: { name, type, set: null, icon: icon || null, classType, bucketHash, slotName, setName, setHash, linkedHashes: Array.isArray(linkedHashes) ? linkedHashes : [],
          ammoType: weaponMeta?.ammoType ?? null,
          itemTypeDisplayName: weaponMeta?.itemTypeDisplayName ?? null,
          damageTypeHash: weaponMeta?.damageTypeHash ?? null
        },
        wishes: []
      };
    } else {
      // Backfill metadata if missing
      if (name && !activeList.items[hash].static?.name) activeList.items[hash].static.name = name;
      if (type && !activeList.items[hash].static?.type) activeList.items[hash].static.type = type;

      // Backfill icon if we now have one
      if (icon && (!activeList.items[hash].static || !activeList.items[hash].static.icon)) {
        activeList.items[hash].static.icon = icon;
      }

      // Backfill filter data if missing
      if (classType !== null && !activeList.items[hash].static?.classType) activeList.items[hash].static.classType = classType;
      if (bucketHash !== null && !activeList.items[hash].static?.bucketHash) activeList.items[hash].static.bucketHash = bucketHash;
      if (slotName && !activeList.items[hash].static?.slotName) activeList.items[hash].static.slotName = slotName;
      if (setName && !activeList.items[hash].static?.setName) activeList.items[hash].static.setName = setName;
      if (setHash && !activeList.items[hash].static?.setHash) activeList.items[hash].static.setHash = setHash;
      if (Array.isArray(linkedHashes) && linkedHashes.length && !(activeList.items[hash].static?.linkedHashes || []).length) {
        activeList.items[hash].static.linkedHashes = linkedHashes;
      }
      if (weaponMeta?.ammoType != null && activeList.items[hash].static?.ammoType == null) activeList.items[hash].static.ammoType = weaponMeta.ammoType;
      if (weaponMeta?.itemTypeDisplayName && !activeList.items[hash].static?.itemTypeDisplayName) activeList.items[hash].static.itemTypeDisplayName = weaponMeta.itemTypeDisplayName;
      if (weaponMeta?.damageTypeHash != null && activeList.items[hash].static?.damageTypeHash == null) activeList.items[hash].static.damageTypeHash = weaponMeta.damageTypeHash;
    }

    const existingWishes = activeList.items[hash].wishes || [];
    activeList.items[hash].wishes = existingWishes;

    // "Same wish" is defined once, by WishlistSync.wishKey, so the duplicate
    // check and cross-browser sync always agree: weapons by raw perks + mode,
    // armor by archetype + Tertiary (+ Spark) + mode.
    const sync = root.WishlistSync;
    if (!sync) throw new Error('weapon-wish-core.js needs wishlist-sync-core.js loaded first');
    if (config && config.archetype) sync.migrateArmorConfig(config); // store armor in the current shape
    const key = sync.wishKey({ tags: [mode], config, raw: rawString });
    if (existingWishes.some((w) => w && sync.wishKey(w) === key)) return 'duplicate';

    existingWishes.push({
      tags: [mode],          // ['pve'] or ['pvp']
      config,                // armor/weapon config
      raw: rawString,        // original string
      added: Date.now()
    });
    return 'added';
  }

  /**
   * Armor saved without its set (older builds, godroll.tv adds) can't be
   * grouped with the rest of its set or show the set's bonuses. Fills in
   * static.setHash (and the set's real name) from `setOf(itemHash)`, which
   * returns { hash, name } or null for a piece that has no set. Mutates `data`;
   * returns how many items changed.
   */
  function fillArmorSets(data, setOf) {
    let changed = 0;
    for (const list of Object.values((data && data.lists) || {})) {
      for (const [itemHash, item] of Object.entries((list && list.items) || {})) {
        const st = item && item.static;
        if (!st || st.type !== 'armor' || st.setHash) continue;
        const set = setOf(itemHash);
        if (!set || !set.hash) continue; // genuinely no set (e.g. Iron Forerunner)
        st.setHash = set.hash;
        if (set.name) st.setName = set.name;
        changed++;
      }
    }
    return changed;
  }

  root.WeaponWish = { ACCEPTABLE_CAP, buildWeaponWishPayload, addWishToList, fillArmorSets };
})(typeof window !== 'undefined' ? window : globalThis);
