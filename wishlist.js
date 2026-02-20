// Wishlist UI and storage glue for Ahamkara Wishes
// Uses `dimData` in chrome.storage.local for persistence.

(function(){
  function ensureData(cb) {
    chrome.storage.local.get(['dimData'], (res) => {
      let data = res.dimData || { activeId: 'default', lists: { default: { name: 'Main Wishlist', items: {} } } };
      if (!data.lists) data.lists = { default: { name: 'Main Wishlist', items: {} } };
      cb(data);
    });
  }

  function writeData(data, cb) {
    chrome.storage.local.set({ dimData: data }, cb || (()=>{}));
  }

  function makeId() {
    return 'wl_' + Math.random().toString(36).slice(2, 9);
  }

  function render() {
    ensureData((data) => {
      const row = document.getElementById('wishlist-row');
      const sel = document.getElementById('wishlist-select');
      if (!row || !sel) return;
      row.innerHTML = '';
      sel.innerHTML = '';

      Object.keys(data.lists).forEach(id => {
        const list = data.lists[id];
        // header select option
        const opt = document.createElement('option');
        opt.value = id;
        opt.textContent = list.name || id;
        sel.appendChild(opt);

        // row button
        const btn = document.createElement('button');
        btn.className = 'wishlist-btn';
        btn.dataset.id = id;
        btn.textContent = list.name || id;
        if (id === data.activeId) btn.classList.add('active');
        btn.onclick = (e) => {
          if (mergeMode) { e.preventDefault(); toggleMergeTarget(id); return; }
          data.activeId = id;
          writeData(data, () => {
            render();
            document.dispatchEvent(new CustomEvent('wishListChanged', { detail: { id } }));
          });
        };
        row.appendChild(btn);
      });

      // ensure header select matches
      if (data.activeId && Array.from(sel.options).some(o => o.value === data.activeId)) sel.value = data.activeId;
    });
  }

  function createFromInput() {
    const input = document.getElementById('wl-name');
    if (!input) return;
    const name = (input.value || '').trim();
    if (!name) return;
    ensureData((data) => {
      const id = makeId();
      data.lists[id] = { name, items: {} };
      data.activeId = id;
      writeData(data, () => { input.value = ''; render(); });
    });
  }

  function duplicateSelected() {
    ensureData((data) => {
      const src = data.lists[data.activeId];
      if (!src) return;
      const id = makeId();
      data.lists[id] = { name: src.name + ' (copy)', items: JSON.parse(JSON.stringify(src.items || {})) };
      data.activeId = id;
      writeData(data, render);
    });
  }

  function deleteSelected() {
    ensureData((data) => {
      const id = data.activeId;
      if (!id || id === 'default') return;
      delete data.lists[id];
      data.activeId = 'default';
      writeData(data, render);
    });
  }

  // Simple merge: merge selected source(s) into active destination
  let mergeMode = false;
  const mergeTargets = new Set();

  function enterMergeMode() {
    mergeMode = true;
    mergeTargets.clear();
    const mergeBtn = document.getElementById('wl-merge');
    if (mergeBtn) {
      mergeBtn.classList.add('merge-active');
      mergeBtn.classList.remove('pulsing');
    }
    // clear any leftover selected visuals
    document.querySelectorAll('.wishlist-btn.merge-selected').forEach(b => b.classList.remove('merge-selected'));
    // mark document body for merge-mode styling (keeps wishlist button text white)
    try { document.body.classList.add('merge-mode'); } catch (e) { /* noop in weird contexts */ }
  }

  function exitMergeMode() {
    mergeMode = false;
    mergeTargets.clear();
    const mergeBtn = document.getElementById('wl-merge');
    if (mergeBtn) {
      mergeBtn.classList.remove('merge-active');
      mergeBtn.classList.remove('pulsing');
    }
    // remove selection visuals from all wishlist buttons
    document.querySelectorAll('.wishlist-btn.merge-selected').forEach(b => b.classList.remove('merge-selected'));
    try { document.body.classList.remove('merge-mode'); } catch (e) { /* noop */ }
    render();
  }

  function toggleMergeTarget(id) {
    if (!mergeMode) return;
    if (id === 'default') return; // never merge default
    if (mergeTargets.has(id)) mergeTargets.delete(id); else mergeTargets.add(id);
    // show visual state
    document.querySelectorAll('.wishlist-btn').forEach(b => {
      if (mergeTargets.has(b.dataset.id)) b.classList.add('merge-selected'); else b.classList.remove('merge-selected');
    });
    const mergeBtn = document.getElementById('wl-merge');
    // pulse only when at least two targets selected (attention state)
    if (mergeTargets.size >= 2) mergeBtn.classList.add('pulsing'); else mergeBtn.classList.remove('pulsing');
  }

  function performMerge() {
    if (!mergeMode || mergeTargets.size === 0) return;
    ensureData((data) => {
      const dest = data.lists[data.activeId];
      if (!dest) return exitMergeMode();
      mergeTargets.forEach(id => {
        if (!data.lists[id] || id === data.activeId) return;
        const src = data.lists[id];
        // merge items: shallow unique by hash key
        Object.keys(src.items || {}).forEach(h => {
          if (!dest.items[h]) dest.items[h] = src.items[h];
        });
        delete data.lists[id];
      });
      writeData(data, () => { exitMergeMode(); render(); });
    });
  }

  function showMergeConfirm() {
    // build a modal overlay listing selected wishlists
    const existing = document.getElementById('merge-confirm-overlay');
    if (existing) return;
    ensureData((data) => {
      const container = document.createElement('div');
      container.id = 'merge-confirm-overlay';
      container.innerHTML = `
        <div class="merge-confirm-dialog" role="dialog" aria-modal="true">
          <div class="merge-confirm-title">Confirm Merge</div>
          <div class="merge-confirm-body">
            <p>Merge the following wishlists into the current active wishlist? This will delete the merged sources.</p>
            <ul class="merge-confirm-list">
              ${Array.from(mergeTargets).map(id => `<li>${(data.lists[id] && data.lists[id].name) || id}</li>`).join('')}
            </ul>
          </div>
          <div class="merge-confirm-actions">
            <button id="merge-confirm-cancel" class="wishlist-action-btn">Cancel</button>
            <button id="merge-confirm-ok" class="wishlist-action-btn">Merge</button>
          </div>
        </div>
      `;
      document.body.appendChild(container);
      document.getElementById('merge-confirm-cancel').onclick = () => {
        // cancel ends merge mode without merging
        document.body.removeChild(container);
        exitMergeMode();
      };
      document.getElementById('merge-confirm-ok').onclick = () => {
        document.body.removeChild(container);
        performMerge();
      };
    });
  }

  function attach() {
    document.getElementById('wl-create').onclick = createFromInput;
    document.getElementById('wl-duplicate').onclick = duplicateSelected;
    document.getElementById('wl-delete').onclick = deleteSelected;
    const nameInput = document.getElementById('wl-name');
    if (nameInput) {
      nameInput.addEventListener('keydown', (ev) => {
        if (ev.key === 'Enter') {
          ev.preventDefault();
          createFromInput();
        }
      });
    }
    const mergeBtn = document.getElementById('wl-merge');
    mergeBtn.onclick = () => {
      if (!mergeMode) { enterMergeMode(); return; }
      // if not in pulsing/confirm state, clicking again exits merge mode
      if (mergeTargets.size < 2) { exitMergeMode(); return; }
      // otherwise show confirmation modal
      showMergeConfirm();
    };

    // button clicks are handled on each .wishlist-btn in render(), including merge-mode toggling

    // header select sync
    const select = document.getElementById('wishlist-select');
    if (select) select.onchange = (e) => {
      const val = e.target.value;
      ensureData((data) => { data.activeId = val; writeData(data, render); });
    };

    chrome.storage.onChanged.addListener((changes, ns) => {
      if (ns === 'local' && changes.dimData) render();
    });

    // initial render
    render();
    // attempt a light-weight sync with any existing OwnedInventoryIndex cache
    trySyncOwnedIndex();
  }

  document.addEventListener('DOMContentLoaded', attach);

  // Expose for debugging
  window.awWishlist = { render, createFromInput, duplicateSelected, deleteSelected, enterMergeMode, exitMergeMode };

  /**
   * Try to sync wishlist entries with a pre-built OwnedIndex cache.
   * If `OwnedInventoryIndex` is available and has a cached index, the function
   * will annotate `dimData` entries with `received`, `receivedInstances`, and `matchScore`.
   */
  function trySyncOwnedIndex() {
    try {
      if (!window.OwnedInventoryIndex || !OwnedInventoryIndex.getCachedIndex) return;
      const idx = OwnedInventoryIndex.getCachedIndex();
      if (!idx) return;
      ensureData((data) => {
        const summary = OwnedInventoryIndex.matchWishlist(data, idx);
        // persist updated dimData
        writeData(data, () => { console.log('[Wishlist] owned-index sync:', summary); });
      });
    } catch (e) { console.warn('[Wishlist] trySyncOwnedIndex error', e); }
  }
})();
