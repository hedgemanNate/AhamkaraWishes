// --- IMPORTS ---
// All manifest loading, caching, and searching handled by destiny-manifest.js
// This file uses: ensureInventoryItemDefsReady, ensureEquippableItemSetDefsReady, searchArmorLocally, getArmorSetLookup, BUCKET_HASHES, BUNGIE_ROOT
// Weapon system: weapon-manager.js (weaponManager global), weapon-ui.js (weaponUI global)

// --- CONFIGURATION ---

const ARCHETYPES = [
    { id: 'paragon',   name: 'PARAGON',   stats: ['Super', 'Melee'] },
    { id: 'grenadr',   name: 'GRENADIER', stats: ['Grenade', 'Super'] },
    { id: 'special',   name: 'SPECIALIST',stats: ['Class', 'Weapons'] },
    { id: 'brawler',   name: 'BRAWLER',   stats: ['Melee', 'Health'] },
    { id: 'bulwark',   name: 'BULWARK',   stats: ['Health', 'Class'] },
    { id: 'gunner',    name: 'GUNNER',    stats: ['Weapons', 'Grenade'] }
];

// 'Weapons' replaces 'Mobility' in the Renegades expansion meta.
const STATS = ['Weapons', 'Health', 'Class', 'Grenade', 'Super', 'Melee'];


// --- INITIALIZATION ---
document.addEventListener('DOMContentLoaded', () => {
    const loadingOverlay = document.getElementById('loading-overlay');
  const loadingText = loadingOverlay ? loadingOverlay.querySelector('.loading-text') : null;
    
    setupWeaponArmorTabs();
    
    // Load manifest data ONCE at startup
    Promise.all([
        ensureInventoryItemDefsReady({ force: false }),
        ensureEquippableItemSetDefsReady({ force: false }),
        ensureCollectibleDefsReady({ force: false }),
      ensureDamageTypeDefsReady({ force: false }),
      getArmorSetLookup(),
      window.__manifest__?.getDamageTypeDefs?.()
    ]).then(() => {
        // Initialize weapon system after manifest is ready
        return initializeWeaponSystem();
    }).then(() => {
        // Hide loading overlay once all systems are ready (fade animation is 1.3s)
        if (loadingOverlay) {
            loadingOverlay.classList.add('hidden');
        }
        // Now load and display the wishlist UI
        loadLists();
    }).catch(err => {
        console.warn("[D2MANIFEST] Preflight failed:", err);
        // Hide overlay even on error
        if (loadingOverlay) {
            loadingOverlay.classList.add('hidden');
        }
        // Try to load UI anyway
        loadLists();
    });

    const clearCacheBtn = document.getElementById('clearCacheBtn');
    if (clearCacheBtn) {
        clearCacheBtn.addEventListener('click', async () => {
            const originalLabel = clearCacheBtn.textContent;
            const originalLoadingText = loadingText ? loadingText.textContent : null;
            clearCacheBtn.disabled = true;
            clearCacheBtn.textContent = 'Resetting...';
            if (loadingOverlay) {
                loadingOverlay.classList.remove('hidden');
            }
            if (loadingText) {
                loadingText.textContent = 'Resetting manifest cache...';
            }

            try {
                if (window.weaponUI?.shutdownWeaponSearchWorker) {
                    window.weaponUI.shutdownWeaponSearchWorker();
                }

                await deleteManifestCache({ retries: 3, delayMs: 700 });
                if (window.__manifest__?.resetManifestMemory) {
                    window.__manifest__.resetManifestMemory();
                }

                if (loadingText) {
                    loadingText.textContent = 'Downloading manifest...';
                }

                await Promise.all([
                    ensureInventoryItemDefsReady({ force: true }),
                    ensureEquippableItemSetDefsReady({ force: true }),
                    ensureCollectibleDefsReady({ force: true }),
                  ensureDamageTypeDefsReady({ force: true }),
                  getArmorSetLookup(),
                  window.__manifest__?.getDamageTypeDefs?.()
                ]);

                if (window.weaponUI?.resetWeaponSearchWorker) {
                    window.weaponUI.resetWeaponSearchWorker();
                }

                clearCacheBtn.textContent = 'Reset Complete';
                setTimeout(() => {
                    clearCacheBtn.textContent = originalLabel;
                }, 1500);
            } catch (err) {
                const message = err?.message || String(err);
                console.warn('[D2MANIFEST] Reset cache failed:', err);
                if (loadingText && message.includes('blocked')) {
                    loadingText.textContent = 'Close other extension views and retry.';
                }
                clearCacheBtn.textContent = message.includes('blocked') ? 'Reset Blocked' : 'Reset Failed';
                setTimeout(() => {
                    clearCacheBtn.textContent = originalLabel;
                }, 2000);
            } finally {
                if (loadingText && originalLoadingText) {
                    loadingText.textContent = originalLoadingText;
                }
                if (loadingOverlay) {
                    loadingOverlay.classList.add('hidden');
                }
                clearCacheBtn.disabled = false;
            }
        });
    }
});

function deleteManifestCache({ retries = 3, delayMs = 700 } = {}) {
    const attemptDelete = (remaining) =>
        new Promise((resolve, reject) => {
            let blocked = false;
            let finished = false;
            const req = indexedDB.deleteDatabase('d2_manifest_cache');

            const retryTimer = setTimeout(() => {
                if (finished) return;
                if (blocked && remaining > 0) {
                    attemptDelete(remaining - 1).then(resolve).catch(reject);
                } else if (blocked) {
                    reject(new Error('Manifest cache reset blocked by another tab.'));
                }
            }, delayMs);

            req.onblocked = () => {
                blocked = true;
            };
            req.onsuccess = () => {
                finished = true;
                clearTimeout(retryTimer);
                resolve();
            };
            req.onerror = () => {
                finished = true;
                clearTimeout(retryTimer);
                reject(req.error);
            };
        });

    return attemptDelete(retries);
}

// --- LIVE UPDATE LISTENER ---
// Triggers whenever data changes (e.g. from Content Script or internal save)
chrome.storage.onChanged.addListener((changes, namespace) => {
    if (namespace === 'local' && changes.dimData) {
        loadLists();
    }
});

// Sidepanel version of saveItem (content.js has its own copy; it is NOT available here)
// Returns a Promise that resolves after the storage operation completes
function saveItem(hash, name, type, rawString, keyId, config, mode = "pve", icon = null, classType = null, bucketHash = null, slotName = null, setName = null, setHash = null) {
  return new Promise((resolve) => {
    chrome.storage.local.get(["dimData"], (result) => {
      let data = result.dimData || {
        activeId: "default",
        lists: { default: { name: "Main Wishlist", items: {} } }
      };

      const activeList = data.lists[data.activeId] || data.lists["default"];
      if (!activeList.items) activeList.items = {};

      // Create container if missing
      if (!activeList.items[hash]) {
        activeList.items[hash] = {
          static: { name, type, set: null, icon: icon || null, classType, bucketHash, slotName, setName, setHash },
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
      }

      const existingWishes = activeList.items[hash].wishes || [];
      activeList.items[hash].wishes = existingWishes;

      // Duplicate check: armor compares config, weapons compare raw string
      const isDuplicate = existingWishes.some((w) => {
        if (!w) return false;
        const sameMode = (w?.tags || []).includes(mode);
        if (!sameMode) return false;
        // Armor: same archetype + same spark + same mode = duplicate
        if (config?.archetype && config?.spark) {
          return w.config?.archetype === config.archetype &&
                 w.config?.spark === config.spark;
        }
        // Weapons: same raw string + same mode = duplicate
        return w?.raw === rawString;
      });
      if (isDuplicate) {
        resolve();
        return;
      }

      // Add new wish
      existingWishes.push({
        tags: [mode],          // ['pve'] or ['pvp']
        config,               // your armor/weapon config
        raw: rawString,       // original string
        added: Date.now()
      });

      chrome.storage.local.set({ dimData: data }, () => {
        resolve(); // Signal completion after storage operation completes
        // Don't call loadLists here - onChanged listener will handle UI refresh
      });
    });
  });
}

// --- WEAPON SYSTEM INITIALIZATION ---
/**
 * Verify weapon system modules are loaded and available.
 * Tracks if window.weaponUI and window.weaponManager are defined.
 *
 * @returns {boolean} True if weapon system is ready
 */
function verifyWeaponScriptsLoaded() {
    const weaponUIReady = window.weaponUI && typeof window.weaponUI.initWeaponCraft === 'function';
    const weaponManagerReady = window.weaponManager && typeof window.weaponManager.loadWeaponWishes === 'function';
    
    if (weaponUIReady && weaponManagerReady) {
        d2log('✅ Weapon system scripts verified', 'manager');
        return true;
    }
    
    if (!weaponUIReady) {
        d2log('⚠️ weapon-ui module not found', 'manager');
    }
    if (!weaponManagerReady) {
        d2log('⚠️ weapon-manager module not found', 'manager');
    }
    
    return false;
}

/**
 * Initialize weapon crafting system.
 * Called after manifest data loads. Sets up UI listeners and loads saved weapons.
 *
 * @returns {Promise<void>}
 */
async function initializeWeaponSystem() {
    try {
        // Verify exports are available
        if (!verifyWeaponScriptsLoaded()) {
            d2log('⚠️ Weapon system unavailable, skipping initialization', 'manager');
            return;
        }
        
        // Initialize UI (attach event listeners)
        window.weaponUI.initWeaponCraft();
        
        // Load saved weapons into list view
        await window.weaponUI.refreshWeaponList();
        
        // Set initial pane to craft view
        window.weaponUI.togglePane('craft');
        
        d2log('✅ Weapon system initialized', 'manager');
    } catch (error) {
        d2log(`❌ Error initializing weapon system: ${error.message}`, 'manager', 'error');
        // Continue gracefully - armor system should still work
    }
}

/**
 * Setup weapon/armor tab switching.
 * Manages #tab-weapons and #tab-armor button states and pane visibility.
 */
function setupWeaponArmorTabs() {
    const btnWeapons = document.getElementById('tab-weapons');
    const btnArmor = document.getElementById('tab-armor');
    const viewWeapons = document.getElementById('view-weapons');
    const viewArmor = document.getElementById('view-armor');

    if (!btnWeapons || !btnArmor || !viewWeapons || !viewArmor) {
        d2log('⚠️ Tab elements not found in DOM', 'manager');
        return;
    }

    // Click handler for weapons tab
    btnWeapons.addEventListener('click', () => {
        // Update tab buttons
        btnWeapons.classList.add('active');
        btnArmor.classList.remove('active');
        
        // Update view visibility
        viewWeapons.classList.add('active-view');
        viewArmor.classList.remove('active-view');
        
        // Ensure weapon craft pane is visible and refresh list
        if (verifyWeaponScriptsLoaded()) {
            window.weaponUI.togglePane('craft');
            window.weaponUI.refreshWeaponList().catch(err => {
                d2log(`⚠️ Could not refresh weapon list: ${err.message}`, 'manager');
            });
        }
        
        d2log('✅ Switched to weapons tab', 'manager');
    });

    // Click handler for armor tab
    btnArmor.addEventListener('click', () => {
        // Update tab buttons
        btnArmor.classList.add('active');
        btnWeapons.classList.remove('active');
        
        // Update view visibility
        viewArmor.classList.add('active-view');
        viewWeapons.classList.remove('active-view');
        
        d2log('✅ Switched to armor tab', 'manager');
    });
}


// --- VIEWER LOGIC ---
function loadLists() {
    chrome.storage.local.get(['dimData'], (result) => {
        const container = document.getElementById('weapon-list');
        const emptyState = document.getElementById('empty-state');
        
        // Skip old weapon list if element doesn't exist (now handled by weapon-ui.js)
        if (!container) {
            return;
        }
        
        container.innerHTML = ''; 

        if (!result.dimData || !result.dimData.lists) {
            if(emptyState) emptyState.classList.remove('hidden');
            return;
        } else {
            if(emptyState) emptyState.classList.add('hidden');
        }

        const activeList = result.dimData.lists['default'];
        if (!activeList || !activeList.items || Object.keys(activeList.items).length === 0) {
            if(emptyState) emptyState.classList.remove('hidden');
            return;
        }

        Object.keys(activeList.items)
          .sort((a, b) => {
            const setA = (activeList.items[a]?.static?.setName || '').toString().toLowerCase();
            const setB = (activeList.items[b]?.static?.setName || '').toString().toLowerCase();
            const nameA = (activeList.items[a]?.static?.name || '').toString().toLowerCase();
            const nameB = (activeList.items[b]?.static?.name || '').toString().toLowerCase();
            const primary = setA.localeCompare(setB, 'en', { sensitivity: 'base' });
            return primary !== 0 ? primary : nameA.localeCompare(nameB, 'en', { sensitivity: 'base' });
          })
          .forEach(hash => {
            const item = activeList.items[hash];
            const card = createItemCard(hash, item);
            container.appendChild(card);
          });
    });
}

function createItemCard(hash, item) {
  const card = document.createElement('div');
  card.className = 'weapon-card';

  const safeName = item?.static?.name || '(unknown)';
  const safeType = (item?.static?.type || 'item').toString();

  // Normalize icon:
  // - if icon is already absolute (starts with http), use as-is
  // - if it's a relative Bungie path, prefix with BUNGIE_ROOT
  const iconValue = item?.static?.icon;
  const iconUrl =
    iconValue
      ? (iconValue.startsWith('http') ? iconValue : `${BUNGIE_ROOT}${iconValue}`)
      : '';

  const iconHtml = iconUrl
    ? `<img src="${iconUrl}" class="card-icon" alt="">`
    : '';

  let wishesHtml = '';
  const wishes = Array.isArray(item?.wishes) ? item.wishes : [];

  wishes.forEach((wish, index) => {
    const tag = (wish?.tags && wish.tags[0]) ? wish.tags[0] : 'pve';
    const badgeClass = tag === 'pvp' ? 'badge-pvp' : 'badge-pve';

    let detailText = `Roll #${index + 1}`;
    if (safeType === 'armor' && wish?.config) {
      const arch = wish.config.archetype || '';
      const spark = wish.config.spark || '';
      detailText = `${arch} + ${spark}`;
    }

    wishesHtml += `
      <div class="roll-row">
        <div>
          <span class="badge ${badgeClass}">${tag}</span>
          <span>${detailText}</span>
        </div>
        <button class="btn-del" data-hash="${hash}" data-idx="${index}" type="button">🗑️</button>
      </div>
    `;
  });

  card.innerHTML = `
    <div class="card-header">
      <div style="display:flex; align-items:center;">
        ${iconHtml}
        <span class="card-title">${safeName}</span>
      </div>
      <span class="card-id">${safeType.toUpperCase()}</span>
    </div>
    <div class="card-body">
      ${wishesHtml}
    </div>
  `;

  // IMPORTANT: use currentTarget so dataset is always correct
  card.querySelectorAll('.btn-del').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const idx = Number(e.currentTarget.dataset.idx);
      deleteWish(hash, idx);
    });
  });

  return card;
}

function deleteWish(hash, index) {
    chrome.storage.local.get(['dimData'], (result) => {
        let data = result.dimData;
        let wishes = data.lists['default'].items[hash].wishes;
        wishes.splice(index, 1);
        if (wishes.length === 0) delete data.lists['default'].items[hash];
        chrome.storage.local.set({ dimData: data }, loadLists);
    });
}

