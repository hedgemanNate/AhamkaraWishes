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
  const FORMAT_VERSION = 1;

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

  // --- Toast notification ---

  function showToast(msg, isError) {
    const existing = document.getElementById('aw-io-toast');
    if (existing) existing.remove();
    const el = document.createElement('div');
    el.id = 'aw-io-toast';
    el.className = 'aw-io-toast' + (isError ? ' aw-io-toast-error' : '');
    el.textContent = msg;
    document.body.appendChild(el);
    // Force reflow so the fade-in transition fires
    void el.offsetWidth;
    el.classList.add('aw-io-toast-visible');
    const timer = setTimeout(() => {
      el.classList.remove('aw-io-toast-visible');
      setTimeout(() => el.remove(), 300);
    }, 3000);
    el.addEventListener('click', () => { clearTimeout(timer); el.remove(); });
  }

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

  function exportActiveWishlist() {
    chrome.storage.local.get(['dimData'], (res) => {
      const data = res.dimData;
      if (!data || !data.lists) {
        showToast('No wishlist data found.', true);
        return;
      }
      const activeId = data.activeId || 'default';
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

  function importFromPayload(payload) {
    if (payload.aw !== MAGIC) {
      showToast('Not a valid Ahamkara Wishes file.', true);
      return;
    }
    if (typeof payload.v !== 'number' || payload.v > FORMAT_VERSION) {
      showToast('Unrecognised file version. Update the extension and try again.', true);
      return;
    }
    if (!payload.list || typeof payload.list !== 'object') {
      showToast('Wishlist file is missing list data.', true);
      return;
    }

    const importedList = payload.list;

    chrome.storage.local.get(['dimData'], (res) => {
      let data = res.dimData || {
        activeId: 'default',
        lists: { default: { name: 'Main Wishlist', items: {} } },
      };
      if (!data.lists) data.lists = {};

      // Resolve name collision by appending a suffix
      const existingNames = new Set(Object.values(data.lists).map((l) => l.name));
      let name = importedList.name || 'Imported Wishlist';
      if (existingNames.has(name)) {
        let suffix = 2;
        while (existingNames.has(name + ' (' + suffix + ')')) suffix++;
        name = name + ' (' + suffix + ')';
      }

      const newId = 'wl_' + Math.random().toString(36).slice(2, 9);
      data.lists[newId] = { name, items: importedList.items || {} };
      data.activeId = newId;

      // Normalise imported entries (fills in mustHave, desired, runtime Sets)
      if (window.awWishlist && window.awWishlist.normalizeWishlistData) {
        window.awWishlist.normalizeWishlistData(data);
      }

      chrome.storage.local.set({ dimData: data }, () => {
        if (window.awWishlist && window.awWishlist.render) window.awWishlist.render();
        document.dispatchEvent(new CustomEvent('wishListChanged', { detail: { id: newId } }));
        const itemCount = Object.keys(data.lists[newId].items || {}).length;
        showToast('Imported "' + name + '" — ' + itemCount + ' item' + (itemCount !== 1 ? 's' : ''));
      });
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

  // --- Wire buttons ---

  function attach() {
    const exportBtn = document.getElementById('wl-export');
    const importBtn = document.getElementById('wl-import');
    if (exportBtn) exportBtn.addEventListener('click', exportActiveWishlist);
    if (importBtn) importBtn.addEventListener('click', triggerImport);
  }

  document.addEventListener('DOMContentLoaded', attach);

  window.awWishlistIO = {
    exportActiveWishlist,
    importWishlistFile,
    triggerImport,
    // Exposed for discover.js — importing a browsed wishlist reuses the same
    // validate/normalize/persist path as importing a downloaded .awwish file.
    importFromPayload,
    getActiveListPayload,
    showToast,
  };
})();
