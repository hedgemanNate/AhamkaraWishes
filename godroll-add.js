// Service-worker side of the godroll.tv "Ahamkara Wish" button: turns the perks
// picked on a godroll.tv page into a full weapon wish and writes it straight
// into the chosen wishlist — no craft view, so the roll is only built once.
//
// Runs in the service worker (importScripts'd by background.js, after
// destiny-manifest.js, godroll-roll-core.js and weapon-wish-core.js). It uses
// the same Bungie-manifest code and IndexedDB cache as the side panel, so the
// wish it stores has exactly the shape the craft view's MAKE A NEW WISH does.

(function (root) {
  const DEFAULT_DATA = () => ({
    activeId: 'default',
    lists: { default: { name: 'Main Wishlist', items: {} } }
  });

  // Adds are serialised: each one is a read-modify-write of `dimData`, so two
  // quick clicks must not interleave and drop one of the wishes.
  let queue = Promise.resolve();
  function enqueue(fn) {
    const run = queue.then(fn, fn);
    queue = run.catch(() => {});
    return run;
  }

  function validate(req) {
    if (!req || !Number.isInteger(req.itemHash) || req.itemHash <= 0) return 'Invalid weapon.';
    if (typeof req.listId !== 'string' || !req.listId) return 'No wishlist chosen.';
    if (!Array.isArray(req.columns) || !req.columns.every((c) => Array.isArray(c) && c.every(Number.isInteger))) {
      return 'Invalid perk selection.';
    }
    return null;
  }

  async function addRoll(req) {
    const bad = validate(req);
    if (bad) return { ok: false, error: bad };
    const mode = req.mode === 'pvp' ? 'pvp' : 'pve';

    // Everything manifest-derived is resolved before touching storage, so the
    // read-modify-write below has no slow step inside it.
    let defs;
    try {
      defs = await loadInventoryItemDefsToMemory();
    } catch (e) {
      return { ok: false, error: 'Game data isn’t downloaded yet — open Ahamkara Wishes once, then try again.' };
    }
    const def = defs.get(String(req.itemHash));
    if (!def) return { ok: false, error: 'This weapon isn’t in the game data yet.' };

    const columns = await getWeaponPerkColumns(def);
    const picks = GodrollRoll.assignColumns(req.columns, columns);
    if (!picks.length) return { ok: false, error: 'None of the selected perks match this weapon.' };

    // Same plain "any of" picks the craft view produces for an uncoloured perk,
    // under the same per-column cap.
    const perkState = columns.map(() => ({ acceptable: new Set(), colors: new Map() }));
    picks.forEach(({ colIndex, baseHash, enhancedHash }) => {
      const state = perkState[colIndex];
      const distinct = columns[colIndex].pairs.filter(({ base, enhanced }) =>
        state.acceptable.has(base.hash) || (enhanced && state.acceptable.has(enhanced.hash))).length;
      if (distinct >= WeaponWish.ACCEPTABLE_CAP) return;
      state.acceptable.add(baseHash);
      if (enhancedHash) state.acceptable.add(enhancedHash);
    });

    const { rawString, config } = WeaponWish.buildWeaponWishPayload(columns, perkState, []);
    const linkedHashes = await findWeaponSiblingHashes(req.itemHash);
    const name = def.displayProperties?.name || '';
    const spec = {
      hash: def.hash,
      name,
      type: 'weapon',
      rawString,
      config,
      mode,
      icon: def.displayProperties?.icon ? `${BUNGIE_ROOT}${def.displayProperties.icon}` : null,
      classType: null, bucketHash: null, slotName: null, setName: null, setHash: null,
      linkedHashes,
      weaponMeta: {
        ammoType: def.equippingBlock?.ammoType ?? null,
        itemTypeDisplayName: def.itemTypeDisplayName ?? null,
        damageTypeHash: def.defaultDamageTypeHash ?? null
      }
    };

    const { dimData } = await chrome.storage.local.get('dimData');
    const data = dimData || DEFAULT_DATA();
    if (!data.lists || !data.lists[req.listId]) {
      return { ok: false, error: 'That wishlist no longer exists.' };
    }
    const listName = data.lists[req.listId].name;

    const status = WeaponWish.addWishToList(data, req.listId, spec);
    if (status === 'added') {
      // wishAddedExternally prompts the side panel (if open) to match the new
      // wish against the cached inventory; the service worker has no owned index.
      await chrome.storage.local.set({ dimData: data, wishAddedExternally: Date.now() });
    }
    return { ok: true, status, listName, name, mode };
  }

  root.GodrollAdd = { addRoll: (req) => enqueue(() => addRoll(req)) };
})(self);
