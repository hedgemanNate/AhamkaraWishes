/*
 * list-manager.js
 * Simple wishlist list manager: create/delete/merge/import/export user lists.
 * Reuses existing weaponManager export/save functions to avoid duplicating import/export logic.
 *
 * Exports: window.listManager
 * Storage key: chrome.storage.local.dimData
 *
 * NOTE: This file intentionally keeps UI code small and relies on prompt()/confirm()
 * for merge/import flows to avoid adding UI framework code. It uses existing
 * `weaponManager.saveWeaponWish` and `weaponManager.exportWeapons` where possible.
 */

(function () {
  'use strict';

  async function getDimData() {
    const r = await chrome.storage.local.get('dimData');
    return r.dimData || { activeListId: 'default', lists: { default: { name: 'Main Wishlist', items: {} } } };
  }

  async function saveDimData(data) {
    await chrome.storage.local.set({ dimData: data });
  }

  function safeId(name) {
    return `list-${Date.now()}-${Math.random().toString(36).slice(2,8)}`;
  }

  async function loadLists() {
    const dimData = await getDimData();
    const tabs = document.getElementById('wl-tabs');
    const body = document.getElementById('wl-body');
    if (!tabs || !body) return;

    tabs.innerHTML = '';
    // `#wl-list` (weapon-card area) has been removed; do not render weapon cards here.

    const lists = dimData.lists || {};
    const entries = Object.keys(lists).map(id => ({ id, name: lists[id].name || id }));
    const activeId = dimData.activeListId || 'default';

    // Build tabs
    entries.forEach((entry) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'options-tab';
      btn.dataset.id = entry.id;
      btn.textContent = entry.name || entry.id;
      if (entry.id === activeId) btn.classList.add('active');
      btn.addEventListener('click', async (e) => {
        await setActiveList(e.currentTarget.dataset.id);
        await loadLists();
      });
      tabs.appendChild(btn);
    });

    // Update header card title/body with active list info (if present)
    try {
      const titleEl = document.getElementById('wl-card-title');
      const bodyEl = document.getElementById('wl-card-body');
      const active = lists[activeId] || { name: 'No List Selected' };
      if (titleEl) titleEl.textContent = active.name || activeId || 'No List Selected';
      if (bodyEl) bodyEl.textContent = active.description || '';
    } catch (err) {
      // ignore if DOM not present
    }

    // We intentionally do not render per-weapon cards here.
    // The tabs area (`#wl-tabs`) and body (`#wl-body`) can be used by other UI elements.
  }

  async function createList(name) {
    if (!name || !name.trim()) {
      alert('Please enter a list name');
      return;
    }
    const dimData = await getDimData();
    const id = safeId(name);
    dimData.lists = dimData.lists || {};
    dimData.lists[id] = { name: name.trim(), items: {} };
    dimData.activeListId = id;
    await saveDimData(dimData);
    await loadLists();
  }

  async function deleteList(listId) {
    const dimData = await getDimData();
    if (!dimData.lists || !dimData.lists[listId]) return;
    if (!confirm(`Delete list "${dimData.lists[listId].name || listId}"? This cannot be undone.`)) return;
    delete dimData.lists[listId];
    if (dimData.activeListId === listId) dimData.activeListId = Object.keys(dimData.lists)[0] || 'default';
    await saveDimData(dimData);
    await loadLists();
  }

  async function setActiveList(listId) {
    const dimData = await getDimData();
    dimData.activeListId = listId || 'default';
    await saveDimData(dimData);
    // weaponManager and other listeners should react to storage change
  }

  async function mergeLists(sourceId, destId) {
    if (!sourceId || !destId || sourceId === destId) {
      alert('Invalid source/destination selection');
      return;
    }
    const dimData = await getDimData();
    if (!dimData.lists[sourceId] || !dimData.lists[destId]) {
      alert('One of the lists could not be found');
      return;
    }

    const move = confirm('Click OK to MOVE items into destination and DELETE the source; Cancel to COPY and KEEP source.');

    const prevActive = dimData.activeListId;
    // Temporarily set active to dest so weaponManager.saveWeaponWish writes into it
    dimData.activeListId = destId;
    await saveDimData(dimData);

    // Iterate source items and save each wish into dest via weaponManager.saveWeaponWish
    const sourceItems = dimData.lists[sourceId].items || {};
    for (const hash of Object.keys(sourceItems)) {
      const item = sourceItems[hash];
      for (const wish of (item.wishes || [])) {
        // Use existing weaponManager.saveWeaponWish to leverage dedupe logic
        try {
          if (window.weaponManager && typeof window.weaponManager.saveWeaponWish === 'function') {
            // ensure numeric hash
            const wHash = Number(hash);
            await window.weaponManager.saveWeaponWish(wHash, wish, wish.tags || [], wish.displayString || item.static?.name || '', { mode: wish.mode || 'pve', addedDate: wish.added });
          } else {
            // Fallback: direct merge into dimData structure
            dimData.lists[destId] = dimData.lists[destId] || { name: destId, items: {} };
            const destItems = dimData.lists[destId].items;
            destItems[hash] = destItems[hash] || { static: item.static || {}, wishes: [] };
            destItems[hash].wishes.push(wish);
          }
        } catch (err) {
          console.warn('Merge: failed saving wish', err);
        }
      }
    }

    if (move) {
      delete dimData.lists[sourceId];
    }

    // restore prev active
    dimData.activeListId = prevActive || destId;
    await saveDimData(dimData);
    await loadLists();
  }

  async function exportList(listId) {
    const dimData = await getDimData();
    const prevActive = dimData.activeListId;
    dimData.activeListId = listId || prevActive;
    await saveDimData(dimData);
    // Reuse existing weaponManager.exportWeapons which exports active list
    if (window.weaponManager && typeof window.weaponManager.exportWeapons === 'function') {
      const json = await window.weaponManager.exportWeapons();
      const blob = new Blob([json], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `wishlist-${listId || dimData.activeListId || 'export'}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } else {
      alert('Export not available');
    }
    dimData.activeListId = prevActive;
    await saveDimData(dimData);
  }

  async function importIntoList(listId) {
    // Ask user to paste JSON string (keeping UI simple)
    const raw = prompt('Paste wishlist JSON to import (array of wishes exported from the app):');
    if (!raw) return;
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (err) {
      alert('Invalid JSON');
      return;
    }

    if (!Array.isArray(parsed)) {
      alert('Expected an array of wishes');
      return;
    }

    const dimData = await getDimData();
    const prevActive = dimData.activeListId;
    dimData.activeListId = listId || prevActive;
    await saveDimData(dimData);

    for (const entry of parsed) {
      // Expected entry shape (as exported by weaponManager): { weaponHash, static, wish }
      try {
        const wHash = Number(entry.weaponHash || entry.hash || entry.weapon?.hash || entry.weaponHash);
        const wish = entry.wish || entry;
        if (window.weaponManager && typeof window.weaponManager.saveWeaponWish === 'function') {
          await window.weaponManager.saveWeaponWish(wHash, wish, wish.tags || [], wish.displayString || '', { mode: wish.mode || 'pve', addedDate: wish.added });
        }
      } catch (err) {
        console.warn('Import item failed', err);
      }
    }

    dimData.activeListId = prevActive;
    await saveDimData(dimData);
    await loadLists();
  }

  // Wire basic UI
  document.addEventListener('DOMContentLoaded', () => {
    const createBtn = document.getElementById('wl-create-btn');
    const createName = document.getElementById('wl-create-name');
    const deleteBtn = document.getElementById('wl-delete-btn');
    const mergeBtn = document.getElementById('wl-merge-btn');
    const importBtn = document.getElementById('wl-import-btn');
    const exportBtn = document.getElementById('wl-export-btn');

    if (createBtn && createName) {
      createBtn.addEventListener('click', async () => {
        await createList(createName.value || `List ${new Date().toLocaleString()}`);
        createName.value = '';
      });
    }

    if (deleteBtn) {
      deleteBtn.addEventListener('click', async () => {
        const dimData = await getDimData();
        const active = dimData.activeListId || 'default';
        await deleteList(active);
      });
    }

    if (mergeBtn) {
      mergeBtn.addEventListener('click', async () => {
        const dimData = await getDimData();
        const ids = Object.keys(dimData.lists || {});
        if (ids.length < 2) { alert('Need at least two lists to merge'); return; }
        // Show simple chooser prompt
        let msg = 'Available lists:\n';
        ids.forEach((id, i) => { msg += `${i}: ${dimData.lists[id].name} (${id})\n`; });
        msg += '\nEnter "sourceIndex,destIndex" (e.g. 0,1)';
        const ans = prompt(msg);
        if (!ans) return;
        const parts = ans.split(',').map(s => Number(s.trim()));
        if (parts.length !== 2 || isNaN(parts[0]) || isNaN(parts[1])) return alert('Invalid input');
        const source = ids[parts[0]]; const dest = ids[parts[1]];
        await mergeLists(source, dest);
      });
    }

    if (importBtn) {
      importBtn.addEventListener('click', async () => {
        const dimData = await getDimData();
        const active = dimData.activeListId || 'default';
        await importIntoList(active);
      });
    }

    if (exportBtn) {
      exportBtn.addEventListener('click', async () => {
        const dimData = await getDimData();
        const active = dimData.activeListId || 'default';
        await exportList(active);
      });
    }

    // initial render
    setTimeout(() => loadLists(), 50);
  });

  // Public API
  window.listManager = {
    loadLists,
    createList,
    deleteList,
    mergeLists,
    setActiveList,
    exportList,
    importIntoList,
  };

})();
