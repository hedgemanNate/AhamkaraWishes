// Wishlist Import / Export for Ahamkara Wishes
// Proprietary file format: .awwish (JSON with magic header)
//
// Format:
// {
//   "aw": "wishes",      -- magic identifier
//   "v": 1,              -- format version
//   "exportedAt": <ms>,  -- unix timestamp
//   "list": {
//     "name": "...",
//     "items": { <itemHash>: { static: {...}, wishes: [...] }, ... }
//   }
// }
//
// Ownership state is stripped on export (received, receivedInstances, etc.)
// and will be re-computed on next inventory sync after import.

(function () {
  const MAGIC = 'wishes';
  // v2: armor wishes store { archetype, tertiary, spark } (the Tier 5 Spark is
  // separate from the Tertiary). v1 files (Tertiary saved as `spark`) still
  // import: wishlist-validate.js converts them. Older builds refuse v2 files
  // rather than misreading `spark`.
  const FORMAT_VERSION = 2;

  // Wish fields that reflect ownership state — computed from inventory,
  // not part of the wish definition itself. Strip these on export.
  const STRIP_WISH_KEYS = new Set([
    'received',
    'receivedInstances',
    'desiredSet',
    'mustHaveSet',
    'matchScore',
    'matchedPerkHashes',
    'matchedCombos',
    'comboMatches',
    'traitPoolMatchedInstances',
    'stage1Instances',
    'stage1Received',
  ]);

  // --- Toast notification (the panel's own) ---

  function showToast(msg) { window.AWUI.toast(msg); }

  // --- Export ---

  function stripWish(wish) {
    const out = {};
    for (const k of Object.keys(wish)) {
      if (!STRIP_WISH_KEYS.has(k)) out[k] = wish[k];
    }
    return out;
  }

  function buildExportPayload(list) {
    const items = {};
    for (const [hash, item] of Object.entries(list.items || {})) {
      items[hash] = {
        static: item.static,
        wishes: (item.wishes || []).map(stripWish),
      };
    }
    return {
      aw: MAGIC,
      v: FORMAT_VERSION,
      exportedAt: Date.now(),
      list: {
        name: list.name,
        items,
      },
    };
  }

  /** Downloads one list as a .awwish file (the active list when no id is given). */
  function exportList(listId) {
    chrome.storage.local.get(['dimData'], (res) => {
      const data = res.dimData;
      if (!data || !data.lists) {
        showToast('No wishlist data found.', true);
        return;
      }
      const activeId = listId || data.activeId || 'default';
      const list = data.lists[activeId];
      if (!list) {
        showToast('No active wishlist to export.', true);
        return;
      }

      const payload = buildExportPayload(list);
      const json = JSON.stringify(payload, null, 2);
      const blob = new Blob([json], { type: 'application/octet-stream' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      const safeName = (list.name || 'wishlist').replace(/[^a-z0-9_\- ]/gi, '_').trim() || 'wishlist';
      a.href = url;
      a.download = safeName + '.awwish';
      document.body.appendChild(a);
      a.click();
      setTimeout(() => { a.remove(); URL.revokeObjectURL(url); }, 1500);
      showToast('Exported "' + list.name + '"');
    });
  }

  const exportActiveWishlist = () => exportList();

  // Returns the active wishlist as a `{ name, items }` payload (the same
  // shape stored in the `wishlists.payload` column), for Discover's submit
  // flow. Reuses buildExportPayload so submission and file-export always
  // agree on shape/ownership-stripping.
  function getActiveListPayload(cb) {
    chrome.storage.local.get(['dimData'], (res) => {
      const data = res.dimData;
      const activeId = data?.activeId || 'default';
      const list = data?.lists?.[activeId];
      if (!list) { cb(null); return; }
      cb(buildExportPayload(list).list);
    });
  }

  // --- Import ---

  /** Imports a list. Resolves true when it was added, false when it was refused (the reason is toasted). */
  function importFromPayload(payload) {
    if (payload.aw !== MAGIC) {
      showToast('Not a valid Ahamkara Wishes file.', true);
      return Promise.resolve(false);
    }
    if (typeof payload.v !== 'number' || payload.v > FORMAT_VERSION) {
      showToast('Unrecognised file version. Update the extension and try again.', true);
      return Promise.resolve(false);
    }
    if (!payload.list || typeof payload.list !== 'object') {
      showToast('Wishlist file is missing list data.', true);
      return Promise.resolve(false);
    }

    // The list came from a file or from someone else's Discover submission, so
    // rebuild it from known fields only before it touches storage.
    const importedList = window.WishlistValidate && window.WishlistValidate.sanitizeList(payload.list);
    if (!importedList) {
      showToast('Wishlist file is missing list data.', true);
      return Promise.resolve(false);
    }
    if (importedList.itemCount === 0 && (importedList.droppedItems > 0 || importedList.droppedWishes > 0)) {
      showToast('No valid wishes found in this file.', true);
      return Promise.resolve(false);
    }

    let name = importedList.name;
    let newId = null;

    return AWStore.update((data) => {
      // A free name by the same rules as creating and renaming a list ("PvE Meta" and
      // "pve meta" are the same name), so imports never make a clash Rename refuses.
      name = window.WishlistSync.uniqueListName(data, (importedList.name || '').trim() || 'Imported list');

      newId = 'wl_' + Math.random().toString(36).slice(2, 9);
      data.lists[newId] = { name, items: importedList.items };
      data.activeId = newId;

      // Normalise imported entries (fills in mustHave, desired, runtime Sets)
      if (window.WishlistNormalize) window.WishlistNormalize.normalizeWishlistData(data);
    }).then(() => {
      document.dispatchEvent(new CustomEvent('wishListChanged', { detail: { id: newId } }));
      const itemCount = importedList.itemCount;
      const skipped = importedList.droppedItems + importedList.droppedWishes;
      showToast('Imported "' + name + '" — ' + itemCount + ' item' + (itemCount !== 1 ? 's' : '') +
        (skipped ? ' (' + skipped + ' skipped)' : ''));
      return true;
    }).catch((e) => {
      console.warn('[Import] failed', e);
      showToast('Could not import this wishlist.', true);
      return false;
    });
  }

  function importWishlistFile(file) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      let payload;
      try {
        payload = JSON.parse(e.target.result);
      } catch {
        showToast('Could not read file — invalid format.', true);
        return;
      }
      importFromPayload(payload);
    };
    reader.onerror = () => showToast('Failed to read file.', true);
    reader.readAsText(file);
  }

  function triggerImport() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.awwish';
    input.style.display = 'none';
    input.addEventListener('change', (e) => {
      importWishlistFile(e.target.files && e.target.files[0]);
      input.remove();
    });
    document.body.appendChild(input);
    input.click();
  }

  window.awWishlistIO = {
    exportActiveWishlist,
    exportList,
    importWishlistFile,
    triggerImport,
    // Exposed for discover.js — importing a browsed wishlist reuses the same
    // validate/normalize/persist path as importing a downloaded .awwish file.
    importFromPayload,
    getActiveListPayload,
    showToast,
  };
})();
