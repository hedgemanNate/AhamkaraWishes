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
        btn.onclick = () => {
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

  function enterMergeMode() { mergeMode = true; mergeTargets.clear(); document.getElementById('wl-merge').classList.add('merge-active'); }
  function exitMergeMode() { mergeMode = false; mergeTargets.clear(); document.getElementById('wl-merge').classList.remove('merge-active'); render(); }

  function toggleMergeTarget(id) {
    if (!mergeMode) return;
    if (id === 'default') return; // never merge default
    if (mergeTargets.has(id)) mergeTargets.delete(id); else mergeTargets.add(id);
    // show visual state
    document.querySelectorAll('.wishlist-btn').forEach(b => {
      if (mergeTargets.has(b.dataset.id)) b.classList.add('merge-selected'); else b.classList.remove('merge-selected');
    });
    const mergeBtn = document.getElementById('wl-merge');
    if (mergeTargets.size > 0) mergeBtn.classList.add('pulsing'); else mergeBtn.classList.remove('pulsing');
  }

  function performMerge() {
    if (!mergeMode || mergeTargets.size === 0) return;
    if (!confirm('Merge selected wishlists into the current wishlist? This will delete the merged sources.')) return;
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

  function attach() {
    document.getElementById('wl-create').onclick = createFromInput;
    document.getElementById('wl-duplicate').onclick = duplicateSelected;
    document.getElementById('wl-delete').onclick = deleteSelected;
    const mergeBtn = document.getElementById('wl-merge');
    mergeBtn.onclick = () => {
      if (!mergeMode) { enterMergeMode(); return; }
      if (mergeTargets.size === 0) { exitMergeMode(); return; }
      performMerge();
    };

    document.getElementById('wishlist-row').addEventListener('click', (e) => {
      const btn = e.target.closest('.wishlist-btn');
      if (!btn) return;
      const id = btn.dataset.id;
      if (mergeMode) { toggleMergeTarget(id); return; }
      // otherwise handled in render via button onclick
    });

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
  }

  document.addEventListener('DOMContentLoaded', attach);

  // Expose for debugging
  window.awWishlist = { render, createFromInput, duplicateSelected, deleteSelected, enterMergeMode, exitMergeMode };
})();
