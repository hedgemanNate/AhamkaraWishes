/**
 * UI-CREATOR.JS
 * Separated UI Logic Layer. Uses manager.js for data.
 */

// --- UI STATE ---
let currentClass = 0; 
let searchTimeout = null; 
let selectedPieces = {}; // Track currently selected pieces by slot
let loadedArmorPieces = {}; // Track loaded pieces by slot
let currentArchetype = null;
let currentTertiary = null;
let currentMode = 'pve';
// Set only when the current craft session was loaded from an existing saved
// wish via the list card's EDIT button. Drives whether EDIT WISH is shown,
// and which wish it overwrites.
let armorEditContext = null; // { hash, wishIndex }

// --- FILTER STATE ---
let filterMode = null; // 'archetype' or 'class'
let selectedArchetypes = [];
let selectedClasses = [];
let armorNameSearch = '';
let filterTimeout = null;

const STAT_RANK = {
    "Health": 1,
    "Melee": 2,
    "Grenade": 3,
    "Super": 4,
    "Class": 5,
    "Weapons": 6
};

/**
 * Helper: Get friendly slot name from bucketHash
 */
function getBucketName(bucketHash) {
    if (bucketHash === BUCKET_HASHES.HELMET) return "Head";
    if (bucketHash === BUCKET_HASHES.GAUNTLETS) return "Arms";
    if (bucketHash === BUCKET_HASHES.CHEST) return "Chest";
    if (bucketHash === BUCKET_HASHES.LEGS) return "Legs";
    if (bucketHash === BUCKET_HASHES.CLASS_ITEM) return "Class";
    return "Unknown";
}

/**
 * Helper: Get friendly class name from classType
 */
function getClassName(classType) {
    if (classType === 0) return "Titan";
    if (classType === 1) return "Hunter";
    if (classType === 2) return "Warlock";
    return "Unknown";
}

document.addEventListener('DOMContentLoaded', () => {
    initArmorWizard();
    initManifestCacheReset();
});

/**
 * "Reset Manifest Cache": the fix for stale or corrupt game data. Empties the
 * cached manifest and reloads the panel, which downloads it again.
 */
function initManifestCacheReset() {
    const btn = document.getElementById('clearCacheBtn');
    if (!btn) return;
    btn.addEventListener('click', async () => {
        if (!confirm('Clear the downloaded Destiny game data?\n\nIt will be downloaded again when the panel reloads (about 200 MB). Your wishlists are not affected.')) return;
        btn.disabled = true;
        const original = btn.textContent;
        btn.textContent = 'Clearing...';
        try {
            await clearD2ManifestCache();
            location.reload();
        } catch (err) {
            console.error('[ManifestCache] reset failed', err);
            btn.textContent = "Couldn't clear — try again";
            setTimeout(() => { btn.textContent = original; btn.disabled = false; }, 2500);
        }
    });
}

/**
 * Populates filter buttons based on current filterMode
 */
function populateFilterButtons() {
    const container = document.getElementById('filter-buttons-container');
    const btnArchetype = document.getElementById('filter-btn-archetype');
    const btnClass = document.getElementById('filter-btn-class');

    if (!container) return;

    container.innerHTML = '';

    // Update toggle button states
    if (btnArchetype) btnArchetype.classList.toggle('active', filterMode === 'archetype');
    if (btnClass) btnClass.classList.toggle('active', filterMode === 'class');

    if (filterMode === 'archetype') {
        ARCHETYPES.forEach(arch => {
            const btn = document.createElement('button');
            btn.className = 'filter-btn filter-btn-arch';
            btn.dataset.arch = arch.id;
            if (selectedArchetypes.includes(arch.name)) btn.classList.add('selected');
            btn.textContent = arch.name.substring(0, 3);
            btn.onclick = () => {
                if (selectedArchetypes.includes(arch.name)) {
                    selectedArchetypes = selectedArchetypes.filter(a => a !== arch.name);
                } else {
                    selectedArchetypes.push(arch.name);
                }
                populateFilterButtons();
                applyArmorFilters();
            };
            container.appendChild(btn);
        });
    } else if (filterMode === 'class') {
        const classes = [
            { value: 0, name: 'Titan' },
            { value: 1, name: 'Hunter' },
            { value: 2, name: 'Warlock' }
        ];
        classes.forEach(cls => {
            const btn = document.createElement('button');
            btn.className = 'filter-btn';
            btn.dataset.class = cls.value;
            if (selectedClasses.includes(cls.value)) btn.classList.add('selected');
            btn.textContent = cls.name;
            btn.onclick = () => {
                if (selectedClasses.includes(cls.value)) {
                    selectedClasses = selectedClasses.filter(c => c !== cls.value);
                } else {
                    selectedClasses.push(cls.value);
                }
                populateFilterButtons();
                applyArmorFilters();
            };
            container.appendChild(btn);
        });
    }
}

/**
 * Applies all active filters and refreshes armor list
 */
function applyArmorFilters() {
    chrome.storage.local.get(['dimData'], (result) => {
        const container = document.getElementById('armor-list-container');
        if (!container) return;

        container.innerHTML = '';

        const data = result.dimData;
        if (!data || !data.lists) {
            container.innerHTML = '<div class="empty-list-text">No Armor Wishes yet.</div>';
            return;
        }
        const activeId = data.activeId || 'default';
        const activeList = data.lists[activeId] || data.lists['default'];
        if (!activeList) {
            container.innerHTML = '<div class="empty-list-text">No Armor Wishes yet.</div>';
            return;
        }

        const items = activeList.items;
        const virtualEntries = [];

        // Flatten: one virtual entry per wish, with per-wish filtering
        Object.keys(items).forEach(hash => {
            const item = items[hash];
            // Imported or synced data can be malformed; skip that entry rather
            // than let one bad item throw and blank the whole list.
            if (item?.static?.type !== 'armor') return;

            // Filter by armor name (item-level)
            if (armorNameSearch) {
                const itemName = String(item.static.name || '').toLowerCase();
                if (!itemName.includes(armorNameSearch)) return;
            }

            // Filter by class (item-level)
            if (selectedClasses.length > 0) {
                if (!selectedClasses.includes(item.static.classType)) return;
            }

            // Expand each wish into its own virtual entry
            const wishes = item.wishes || [];
            wishes.forEach((wish, wishIndex) => {
                // Filter by archetype (per-wish)
                if (selectedArchetypes.length > 0) {
                    const wishArchetype = wish.config?.archetype;
                    if (!selectedArchetypes.includes(wishArchetype)) return;
                }

                virtualEntries.push({
                    hash,
                    wishIndex,
                    wish,
                    static: item.static
                });
            });
        });

        // Group virtual entries by set ID
        const armorSets = {};
        virtualEntries.forEach(entry => {
            const setId = getArmorSetId(entry);
            if (!armorSets[setId]) armorSets[setId] = [];
            armorSets[setId].push(entry);
        });

        // Render sets
        if (Object.keys(armorSets).length === 0) {
            container.innerHTML = '<div class="empty-list-text">No results found.</div>';
            return;
        }

        const sortedSetIds = Object.keys(armorSets).sort((a, b) => {
            const nameA = getSetDisplayName(armorSets[a]).toString().toLowerCase();
            const nameB = getSetDisplayName(armorSets[b]).toString().toLowerCase();
            return nameA.localeCompare(nameB, 'en', { sensitivity: 'base' });
        });

        sortedSetIds.forEach(setId => {
            const setContainer = document.createElement('div');
            setContainer.className = 'armor-set-row';
            
            // Generate readable set name for display
            const displayName = getSetDisplayName(armorSets[setId]);
            
            // Deduplicate background icons by hash
            const seenHashes = new Set();
            const piecesBackgroundHtml = armorSets[setId]
                .filter(entry => {
                    if (seenHashes.has(entry.hash)) return false;
                    seenHashes.add(entry.hash);
                    return true;
                })
                .map(entry => {
                    // Armor lists can come from other people; only Bungie art loads.
                    const iconUrl = AWDom.safeImageUrl(entry.static.icon);
                    return iconUrl ? `<img src="${escapeHtml(iconUrl)}" class="set-piece-bg" alt=""/>` : '';
                })
                .join('');

            setContainer.innerHTML = `
                <div class="set-header">
                    <div class="set-pieces-background">
                        <div class="set-pieces-container">${piecesBackgroundHtml}</div>
                        <div class="set-pieces-overlay"></div>
                    </div>
                    <div class="set-name-area">
                        <span class="set-name-text">${escapeHtml(displayName)}</span>
                        <span class="set-count-text">${armorSets[setId].length} WISHES</span>
                    </div>
                </div>
                <div class="set-content" id="set-content-${escapeHtml(setId.replace(/[^\w]+/g, ''))}" style="display: none;">
                </div>
            `;

            const contentArea = setContainer.querySelector('.set-content');

            armorSets[setId].forEach(item => {
                // One malformed wish must not take the rest of the list down with it.
                try {
                    contentArea.appendChild(createArmorCard(item));
                } catch (err) {
                    console.warn('[ArmorList] skipped a wish that could not be rendered', item?.hash, err);
                }
            });

            const header = setContainer.querySelector('.set-header');
            header.onclick = () => {
                const isExpanded = contentArea.style.display === 'flex';
                contentArea.style.display = isExpanded ? 'none' : 'flex';
            };

            container.appendChild(setContainer);
        });
    });
}

/**
 * Entry point for UI setup.
 */
function initArmorWizard() {
    attachListeners();
    populateStatGrids();
}

chrome.storage.onChanged.addListener((changes, namespace) => {
    if (namespace === 'local' && changes.dimData) {
        applyArmorFilters();
    }
});

/**
 * Attaches all event listeners for buttons, inputs, and toggles.
 */
function attachListeners() {
    // 1. Header Reset (Double Click) - Resets panel width and flashes red
    const labelTrigger = document.getElementById('panel-reset-trigger');
    if (labelTrigger) {
        labelTrigger.ondblclick = () => {
            document.body.style.width = "100%"; 
            window.getSelection().removeAllRanges();
            labelTrigger.style.color = "#ff0000";
            setTimeout(() => {
                labelTrigger.style.color = "var(--accent-gold)";
            }, 300);
        };
    }

        // Wishlist dropdown: populate from stored list and persist selection
        const wishlistSelect = document.getElementById('wishlist-select');
        if (wishlistSelect) {
            try {
                const stored = JSON.parse(localStorage.getItem('wishlists') || 'null');
                if (Array.isArray(stored) && stored.length) {
                    wishlistSelect.innerHTML = '';
                    stored.forEach(w => {
                        const opt = document.createElement('option');
                        opt.value = w.id || w.value || String(w.label || w.id || '').toLowerCase();
                        opt.textContent = w.label || w.value || w.id || opt.value;
                        wishlistSelect.appendChild(opt);
                    });
                }
            } catch (e) {
                console.warn('[Wishlist] failed to parse stored wishlists', e);
            }

            const active = localStorage.getItem('activeWishlist');
            if (active && Array.from(wishlistSelect.options).some(o => o.value === active)) {
                wishlistSelect.value = active;
            } else if (wishlistSelect.options.length) {
                wishlistSelect.value = wishlistSelect.options[0].value;
                localStorage.setItem('activeWishlist', wishlistSelect.value);
            }

            wishlistSelect.onchange = () => {
                const val = wishlistSelect.value;
                localStorage.setItem('activeWishlist', val);
                document.dispatchEvent(new CustomEvent('wishListChanged', { detail: { id: val } }));
                console.log('[Wishlist] active changed to', val);
            };
        }

    // 2. Tab Switching (Global: Weapons vs Armor + Menu)
    const btnWeapons = document.getElementById('tab-weapons');
    const btnMenu = document.getElementById('tab-menu');
    const btnArmor = document.getElementById('tab-armor');
    if (btnWeapons && btnArmor) {
        btnWeapons.onclick = () => {
            btnWeapons.classList.add('active');
            if (btnMenu) btnMenu.classList.remove('active');
            btnArmor.classList.remove('active');
            document.getElementById('view-weapons').classList.add('active-view');
            document.getElementById('view-armor').classList.remove('active-view');
        };
        btnArmor.onclick = () => {
            btnArmor.classList.add('active');
            if (btnMenu) btnMenu.classList.remove('active');
            btnWeapons.classList.remove('active');
            document.getElementById('view-armor').classList.add('active-view');
            document.getElementById('view-weapons').classList.remove('active-view');
        };
        if (btnMenu) {
            btnMenu.onclick = () => {
                btnMenu.classList.add('active');
                btnWeapons.classList.remove('active');
                btnArmor.classList.remove('active');
                // Menu does not swap to a dedicated content view by default.
                document.getElementById('view-weapons').classList.remove('active-view');
                document.getElementById('view-armor').classList.remove('active-view');
            };
        }
    }

    // 3. Bottom Nav Slider (Internal Armor Toggle: Craft vs List)
    const navCraft = document.getElementById('nav-craft');
    const navList = document.getElementById('nav-list');
    const armorSlider = document.getElementById('armor-slider');

    if (navCraft && navList && armorSlider) {
        navCraft.onclick = () => {
            navCraft.classList.add('active');
            navList.classList.remove('active');
            armorSlider.className = 'armor-view-slider show-craft';
        };

        navList.onclick = () => {
            navList.classList.add('active');
            navCraft.classList.remove('active');
            armorSlider.className = 'armor-view-slider show-list';
            // Placeholder for Feature 2: loadArmorList();
        };
    }

    // 3.b Weapons bottom nav inside view-weapons (Craft vs List)
    const wNavCraft = document.getElementById('weapons-nav-craft');
    const wNavList = document.getElementById('weapons-nav-list');
    const weaponCraftPane = document.getElementById('weapon-craft');
    const weaponListPane = document.getElementById('weapon-list');

    if (wNavCraft && wNavList && weaponCraftPane && weaponListPane) {
        // ensure initial state: craft active, list hidden
        wNavCraft.onclick = () => {
            wNavCraft.classList.add('active');
            wNavList.classList.remove('active');
            weaponCraftPane.classList.remove('hidden');
            weaponListPane.classList.remove('active-pane');
            weaponListPane.classList.add('hidden');
        };

        wNavList.onclick = () => {
            wNavList.classList.add('active');
            wNavCraft.classList.remove('active');
            weaponListPane.classList.remove('hidden');
            weaponListPane.classList.add('active-pane');
            weaponCraftPane.classList.add('hidden');
            // If a refresh function exists, call it
            if (typeof refreshWeaponList === 'function') try { refreshWeaponList(); } catch (e) { console.warn('refreshWeaponList failed', e); }
        };
    }

    // Inside attachListeners() -> Section 3 (Bottom Nav Slider)
    navList.onclick = () => {
        navList.classList.add('active');
        navCraft.classList.remove('active');
        armorSlider.className = 'armor-view-slider show-list';
        
        // Trigger the list refresh!
        refreshArmorList(); 
    };

    // 4. Class Selection Pill
    document.querySelectorAll('.class-btn').forEach(btn => {
        btn.onclick = (e) => {
            document.querySelectorAll('.class-btn').forEach(b => b.classList.remove('active'));
            e.target.classList.add('active');
            currentClass = parseInt(e.target.dataset.class);
            
            const query = document.getElementById('armor-query').value;
            if (query.length >= 2) triggerSearch(query);
        };
    });

    // 5. Search Input Logic
    const searchInput = document.getElementById('armor-query');
    const searchClearBtn = document.getElementById('armor-query-clear');
    if (searchInput) {
        searchInput.oninput = (e) => {
            if (searchClearBtn) searchClearBtn.classList.toggle('hidden', !e.target.value);
            clearTimeout(searchTimeout);
            const query = e.target.value.trim();
            if (query.length < 2) return;
            document.querySelectorAll('.armor-box').forEach(b => b.classList.add('loading'));
            searchTimeout = setTimeout(() => triggerSearch(query), 500);
        };
    }
    if (searchClearBtn) {
        searchClearBtn.onclick = () => {
            clearTimeout(searchTimeout);
            if (searchInput) searchInput.value = '';
            searchClearBtn.classList.add('hidden');
            if (searchInput) searchInput.focus();
        };
    }

    // 6. Filter Toggle Button Logic (for armor list view)
    const filterToggleBtn = document.getElementById('filter-toggle-btn');
    const filterControls = document.getElementById('filter-controls');
    let filtersExpanded = true; // Start with filters expanded
    
    if (filterToggleBtn && filterControls) {
        filterToggleBtn.onclick = () => {
            filtersExpanded = !filtersExpanded;
            
            if (filtersExpanded) {
                // Expand filters
                filterControls.classList.remove('collapsed');
                filterToggleBtn.classList.remove('collapsed');
                filterToggleBtn.title = 'Hide Filters';
            } else {
                // Collapse filters
                filterControls.classList.add('collapsed');
                filterToggleBtn.classList.add('collapsed');
                filterToggleBtn.title = 'Show Filters';
            }
        };
    }

    // 7. Nameplate Reset (Red Hover Reset)
    const nameplate = document.getElementById('armor-set-name');
    if (nameplate) {
        nameplate.onclick = () => {
            selectedPieces = {};
            loadedArmorPieces = {};
            currentArchetype = null;
            currentTertiary = null;
            armorEditContext = null;
            const input = document.getElementById('armor-query');
            if (input) input.value = "";
            document.querySelectorAll('.armor-box').forEach(b => {
                b.classList.remove('selected', 'dimmed', 'loading');
                b.innerHTML = `<span class="slot-label">${b.dataset.slot.toUpperCase()}</span>`;
            });
            document.querySelectorAll('.stat-btn').forEach(b => b.classList.remove('selected', 'unavailable'));
            nameplate.textContent = "";
            updateFullSetButton();
            updatePrimaryBtn();
        };
    }

    // 8. Select Full Set button
    const fullSetBtn = document.getElementById('select-full-set-btn');
    if (fullSetBtn) {
        fullSetBtn.onclick = () => {
            // Select all loaded pieces
            selectedPieces = { ...loadedArmorPieces };
            
            // Update visual state
            document.querySelectorAll('.armor-box').forEach(box => {
                const slot = box.dataset.slot;
                if (loadedArmorPieces[slot]) {
                    box.classList.remove('dimmed');
                    box.classList.add('selected');
                }
            });
            
            updateSelectionDisplay();
            updatePrimaryBtn();
        };
    }

    // 9. Mode Toggle (PvE/PvP)
    const toggle = document.getElementById('ui-mode-toggle');
    if (toggle) {
        toggle.onclick = () => {
            currentMode = (currentMode === 'pve') ? 'pvp' : 'pve';
            toggle.className = `toggle-container ${currentMode}`;
        };
    }

    // 10. Save Wish Button
    const saveBtn = document.getElementById('btn-create-armor');
    if (saveBtn) {
        saveBtn.onclick = handleSaveWish;
    }

    const editBtn = document.getElementById('btn-edit-armor');
    if (editBtn) {
        editBtn.onclick = handleEditWish;
    }

    // 10. Armor List Filter UI
    const filterBtnArchetype = document.getElementById('filter-btn-archetype');
    const filterBtnClass = document.getElementById('filter-btn-class');
    const filterNameSearch = document.getElementById('armor-name-search');
    const filterClear = document.getElementById('filter-clear');
    const filterClearAll = document.getElementById('filter-clear-all');

    if (filterBtnArchetype) {
        filterBtnArchetype.onclick = () => {
            filterMode = (filterMode === 'archetype') ? null : 'archetype';
            populateFilterButtons();
        };
    }

    if (filterBtnClass) {
        filterBtnClass.onclick = () => {
            filterMode = (filterMode === 'class') ? null : 'class';
            populateFilterButtons();
        };
    }

    if (filterNameSearch) {
        filterNameSearch.oninput = (e) => {
            clearTimeout(filterTimeout);
            armorNameSearch = e.target.value.trim().toLowerCase();
            filterTimeout = setTimeout(() => applyArmorFilters(), 300);
        };
    }

    if (filterClear) {
        filterClear.onclick = () => {
            if (filterMode === 'archetype') {
                selectedArchetypes = [];
            } else if (filterMode === 'class') {
                selectedClasses = [];
            }
            populateFilterButtons();
            applyArmorFilters();
        };
    }

    if (filterClearAll) {
        filterClearAll.onclick = () => {
            filterMode = null;
            selectedArchetypes = [];
            selectedClasses = [];
            armorNameSearch = '';
            if (filterNameSearch) filterNameSearch.value = '';
            populateFilterButtons();
            applyArmorFilters();
        };
    }
}

/**
 * Searches the local manifest via manager.js and updates the grid.
 * A fresh manual search always starts a new wish, never an edit —
 * loadWishIntoArmorCraft calls doArmorSearch directly to skip this reset.
 */
async function triggerSearch(query) {
    armorEditContext = null;
    updateArmorEditButtonVisibility();
    await doArmorSearch(query);
}

async function doArmorSearch(query) {
    try {
        const results = await searchArmorLocally(query, currentClass);

        const buckets = {
            Head: results.find(i => i.bucketHash === BUCKET_HASHES.HELMET),
            Arms: results.find(i => i.bucketHash === BUCKET_HASHES.GAUNTLETS),
            Chest: results.find(i => i.bucketHash === BUCKET_HASHES.CHEST),
            Legs: results.find(i => i.bucketHash === BUCKET_HASHES.LEGS),
            Class: results.find(i => i.bucketHash === BUCKET_HASHES.CLASS_ITEM)
        };

        refreshArmorDisplay(buckets);
    } catch (e) {
        console.error("[UI] Search Error:", e);
    }
}

/**
 * Builds buttons for Archetypes and Tertiary stats using constants from manager.js.
 */
function populateStatGrids() {
    const archGrid = document.getElementById('archetype-grid');
    const sparkGrid = document.getElementById('spark-grid');

    // Ensure grids are clear before populating
    archGrid.innerHTML = '';
    sparkGrid.innerHTML = '';
    
    // ARCHETYPES from manager.js
    ARCHETYPES.forEach(arch => {
        const btn = document.createElement('div');
        btn.className = 'stat-btn';
        btn.dataset.archetype = arch.id;
        btn.innerHTML = `<strong>${arch.name}</strong><span class="stat-sub">${arch.stats.join(' + ')}</span>`;
        btn.onclick = () => {
            document.querySelectorAll('#archetype-grid .stat-btn').forEach(b => b.classList.remove('selected'));
            btn.classList.add('selected');
            currentArchetype = arch;
            syncTertiaryAvailability(arch.stats);
            updatePrimaryBtn();
        };
        archGrid.appendChild(btn);
    });

    // STATS from manager.js
    STATS.forEach(stat => {
        const btn = document.createElement('div');
        btn.className = 'stat-btn';
        btn.innerHTML = `<strong>${stat.substring(0,3).toUpperCase()}</strong>`; 
        btn.dataset.stat = stat; 
        btn.onclick = () => {
            if (btn.classList.contains('unavailable')) return;
            document.querySelectorAll('#spark-grid .stat-btn').forEach(b => b.classList.remove('selected'));
            btn.classList.add('selected');
            currentTertiary = stat;
            updatePrimaryBtn();
        };
        sparkGrid.appendChild(btn);
    });
}

/**
 * Check if all 5 armor pieces are loaded and show/hide the Select Full Set button
 */
function updateFullSetButton() {
    const selectedCount = Object.keys(selectedPieces).length;
    const fullSetBtn = document.getElementById('select-full-set-btn');
    
    if (fullSetBtn) {
        if (selectedCount > 0) {
            fullSetBtn.classList.remove('hidden');
        } else {
            fullSetBtn.classList.add('hidden');
        }
    }
}

/**
 * Update display based on current selections
 */
function updateSelectionDisplay() {
    const nameplate = document.getElementById('armor-set-name');
    const selectedCount = Object.keys(selectedPieces).length;
    
    if (nameplate) {
        if (selectedCount === 0) {
            nameplate.textContent = "";
        } else if (selectedCount === 1) {
            const piece = Object.values(selectedPieces)[0];
            nameplate.textContent = piece.name;
            nameplate.style.color = "var(--accent-gold)";
        } else {
            const setName = Object.values(selectedPieces)[0]?.name
                .replace(/(Mask|Vest|Grips|Strides|Cloak|Gauntlets|Plate|Helm|Greaves|Mark|Gloves|Robes|Bond)/gi, '').trim();
            nameplate.textContent = `${setName} (${selectedCount} PIECES)`;
            nameplate.style.color = "var(--accent-gold)";
        }
    }
    
    updateFullSetButton();
}

/**
 * Refreshes the armor icons in Step 1.
 */
/**
 * Refreshes the armor icons in Step 1.
 * Handles set name detection, selective dimming, and individual name updates.
 */
function refreshArmorDisplay(buckets) {
    const slots = ['Head', 'Arms', 'Chest', 'Legs', 'Class'];
    const nameplate = document.getElementById('armor-set-name');
    
    // Clear loaded pieces tracking
    loadedArmorPieces = {};
    
    const firstItem = Object.values(buckets).find(item => item !== undefined);
    if (nameplate && Object.keys(selectedPieces).length === 0) {
        if (firstItem) {
            // Display general set name in White
            nameplate.textContent = getArmorSetName(firstItem.setHash) || firstItem.name;
            nameplate.style.color = "#ffffff"; 
        } else {
            nameplate.textContent = ""; 
        }
    }

    slots.forEach(slot => {
        const box = document.querySelector(`.armor-box[data-slot="${slot}"]`);
        if (!box) return;
        
        box.classList.remove('loading');
        box.innerHTML = `<span class="slot-label">${slot.toUpperCase()}</span>`;
        
        const item = buckets[slot];
        if (item) {
            // Track loaded pieces
            loadedArmorPieces[slot] = item;
            
            const img = document.createElement('img');
            img.src = item.icon; 
            box.appendChild(img);
            
            // Set visual state based on current selection
            if (selectedPieces[slot]) {
                box.classList.add('selected');
                box.classList.remove('dimmed');
            } else {
                box.classList.remove('selected');
                box.classList.add('dimmed');
            }
            
            box.onclick = () => {
                // Toggle selection for this piece
                if (selectedPieces[slot]) {
                    // Deselect this piece
                    delete selectedPieces[slot];
                    box.classList.remove('selected');
                    box.classList.add('dimmed');
                } else {
                    // Select this piece
                    selectedPieces[slot] = item;
                    box.classList.remove('dimmed');
                    box.classList.add('selected');
                }

                updateSelectionDisplay();
                updatePrimaryBtn();
            };
        } else {
            // No item for this slot
            box.classList.remove('selected', 'dimmed');
        }
    });
    
    // Update full set button visibility and selection display
    updateFullSetButton();
    updateSelectionDisplay();
}

/**
 * Prevents picking a Tertiary stat already covered by the archetype.
 */
function syncTertiaryAvailability(usedStats) {
    document.querySelectorAll('#spark-grid .stat-btn').forEach(btn => {
        const stat = btn.dataset.stat;
        if (usedStats.includes(stat)) {
            btn.classList.add('unavailable');
            btn.classList.remove('selected');
            if (currentTertiary === stat) currentTertiary = null;
        } else {
            btn.classList.remove('unavailable');
        }
    });
}

/**
 * Handles the logic for enabling and labeling the final Save button.
 */
function updatePrimaryBtn() {
    const btn = document.getElementById('btn-create-armor');
    const selectedCount = Object.keys(selectedPieces).length;
    
    if (selectedCount === 0) {
        btn.disabled = true;
        btn.textContent = "SELECT ARMOR PIECE FIRST";
    } else if (!currentArchetype || !currentTertiary) {
        btn.disabled = true;
        btn.textContent = "SELECT STATS ABOVE";
    } else {
        btn.disabled = false;
        if (selectedCount === 1) {
            btn.textContent = `MAKE WISH: ${currentArchetype.name} + ${currentTertiary.toUpperCase()}`;
        } else {
            btn.textContent = `MAKE ${selectedCount} WISHES: ${currentArchetype.name} + ${currentTertiary.toUpperCase()}`;
        }
    }

    updateArmorEditButtonVisibility();
}

/**
 * EDIT WISH is only shown once a saved wish has been loaded via a list
 * card's EDIT button, and only enabled while that same piece is still the
 * one (and only one) selected — switching pieces/slots while "editing"
 * would otherwise silently overwrite the wrong wish.
 */
function updateArmorEditButtonVisibility() {
    const editBtn = document.getElementById('btn-edit-armor');
    if (!editBtn) return;

    editBtn.classList.toggle('hidden', !armorEditContext);
    if (!armorEditContext) return;

    const selectedCount = Object.keys(selectedPieces).length;
    const editingSamePiece = selectedCount === 1 &&
        String(Object.values(selectedPieces)[0]?.hash) === String(armorEditContext.hash);
    editBtn.disabled = !editingSamePiece || !currentArchetype || !currentTertiary;
}

/**
 * Final step: Passes selection(s) to the backend saveItem() in manager.js.
 */
function handleSaveWish() {
  const itemsToSave = Object.values(selectedPieces);
  const btn = document.getElementById("btn-create-armor");
  
  console.log("[SaveWish] Button clicked. Items to save:", itemsToSave.length);
  console.log("[SaveWish] currentArchetype:", currentArchetype);
  console.log("[SaveWish] currentTertiary:", currentTertiary);
  console.log("[SaveWish] currentMode:", currentMode);
  
  if (itemsToSave.length === 0) {
    console.warn("[SaveWish] No items selected");
    return;
  }
  
  // Feedback waits for the saves to finish, so it can say what really happened
  // (saved vs. already on the list vs. failed) instead of always claiming success.
  const outcome = { added: 0, duplicate: 0, failed: 0 };
  const showOutcome = () => {
    const { added, duplicate, failed } = outcome;
    let label;
    if (failed && !added) label = "COULDN'T SAVE";
    else if (added && !duplicate && !failed) label = "WISH GRANTED!";
    else if (!added && duplicate && !failed) label = "ALREADY ON YOUR LIST";
    else label = `${added} SAVED · ${duplicate + failed} NOT SAVED`;
    btn.textContent = label;
    btn.classList.toggle("success", added > 0);
    setTimeout(() => {
      btn.classList.remove("success");
      updatePrimaryBtn();
    }, 1500);
  };

  let saveChain = Promise.resolve();

  itemsToSave.forEach((item, index) => {
    saveChain = saveChain.then(() => {
      console.log("[SaveWish] Starting save for item", index + 1, ":", item.name);
      const slotName = getBucketName(item.bucketHash);
      const setName = getArmorSetName(item.setHash) || item.name || "Unknown";

      // Season reissues give the same physical piece several manifest hashes;
      // capture them all so inventory matching finds owned copies under any.
      return findArmorSiblingHashes(item.hash)
        .catch((err) => {
          console.warn("[SaveWish] sibling hash lookup failed for", item.name, err);
          return [];
        })
        .then((linkedHashes) => saveItem(
        item.hash,
        item.name,
        "armor",
        `armor-wish:${item.hash}`,
        `armor-wish:${item.hash}`,
        { archetype: currentArchetype.name, tertiary: currentTertiary, spark: null },
        currentMode,
        item.icon,
        item.classType,
        item.bucketHash,
        slotName,
        setName,
        item.setHash,
        linkedHashes
      )).then((status) => {
        if (status === 'added') outcome.added++; else outcome.duplicate++;
        console.log("[SaveWish] Item", status === 'added' ? "saved:" : "already on the list:", item.name);
      }).catch(err => {
        outcome.failed++;
        console.error("[SaveWish] Error saving item:", item.name, err);
      });
    });
  });

  saveChain.catch(err => {
    console.error("[SaveWish] Save chain failed:", err);
  }).then(showOutcome);
}

/**
 * Overwrites the single wish currently loaded via a list card's EDIT
 * button, instead of appending a new one.
 */
function handleEditWish() {
  if (!armorEditContext || !currentArchetype || !currentTertiary) return;

  const btn = document.getElementById("btn-edit-armor");
  const original = btn.textContent;
  btn.textContent = "WISH UPDATED!";
  btn.classList.add("success");
  setTimeout(() => {
    btn.classList.remove("success");
    btn.textContent = original;
    updatePrimaryBtn();
  }, 1500);

  editItemWish(
    armorEditContext.hash,
    armorEditContext.wishIndex,
    `armor-wish:${armorEditContext.hash}`,
    { archetype: currentArchetype.name, tertiary: currentTertiary, spark: null },
    currentMode
  ).catch(err => console.error("[EditWish] Error updating wish:", err));
}

/**
 * Drives the craft pane to a specific armor piece + stat pair. Shared by the
 * list's EDIT button and by double-clicking an owned roll in inventory search,
 * so both land on exactly the same pre-filled state.
 */
async function applyArmorCraftSelection({ hash, classType, setName, slotName, archetype, tertiary }) {
  document.getElementById('nav-craft')?.click();

  if (classType !== undefined && classType !== null) {
    currentClass = classType;
    document.querySelectorAll('.class-btn').forEach(b => {
      b.classList.toggle('active', parseInt(b.dataset.class) === classType);
    });
  }

  const input = document.getElementById('armor-query');
  if (input) input.value = setName || '';

  selectedPieces = {};
  await doArmorSearch(setName || '');

  // Select just the one slot this came from, never the whole set.
  const piece = loadedArmorPieces[slotName];
  const box = document.querySelector(`.armor-box[data-slot="${slotName}"]`);
  if (piece && String(piece.hash) === String(hash)) {
    selectedPieces[slotName] = piece;
    if (box) {
      box.classList.remove('dimmed');
      box.classList.add('selected');
    }
  } else {
    // Season reissues give the same piece several manifest hashes, so the set
    // search can return a sibling instead. Leave the slot unselected rather
    // than silently picking the wrong variant.
    console.warn('[ArmorCraft] Could not re-locate the exact piece in the manifest search results.');
  }
  updateSelectionDisplay();

  const arch = ARCHETYPES.find(a => a.name === archetype);
  if (arch) {
    document.querySelectorAll('#archetype-grid .stat-btn').forEach(b => b.classList.remove('selected'));
    document.querySelector(`#archetype-grid .stat-btn[data-archetype="${arch.id}"]`)?.classList.add('selected');
    currentArchetype = arch;
    // Must run before the Tertiary is applied — it clears currentTertiary for any
    // stat the archetype already covers.
    syncTertiaryAvailability(arch.stats);
  }

  if (tertiary) {
    document.querySelectorAll('#spark-grid .stat-btn').forEach(b => b.classList.remove('selected'));
    document.querySelector(`#spark-grid .stat-btn[data-stat="${tertiary}"]`)?.classList.add('selected');
    currentTertiary = tertiary;
  }
}

/**
 * Called from a list card's EDIT button (createArmorCard). Loads the exact
 * set/piece/archetype/Tertiary/mode this wish was saved with into the craft
 * page and reveals EDIT WISH so it can be overwritten in place.
 */
async function loadWishIntoArmorCraft(hash, wishIndex, entry, wish) {
  await applyArmorCraftSelection({
    hash,
    classType: entry.static.classType,
    setName: getArmorSetName(entry.static.setHash) || entry.static.setName || entry.static.name,
    slotName: entry.static.slotName,
    archetype: wish.config?.archetype,
    // Either config shape (legacy wishes kept the Tertiary in `spark`).
    tertiary: window.WishlistSync.armorFields(wish.config).tertiary
  });

  currentMode = (wish.tags && wish.tags[0]) || 'pve';
  const modeToggle = document.getElementById('ui-mode-toggle');
  if (modeToggle) modeToggle.className = `toggle-container ${currentMode}`;

  armorEditContext = { hash, wishIndex };
  updatePrimaryBtn();
}

/**
 * Called on double-click of an owned roll in Menu > Utility inventory search.
 * Opens that piece in the craft pane with its real rolled archetype/Tertiary
 * (derived by owned-inventory-index.js) as a starting point for a new wish.
 */
async function loadOwnedArmorIntoCraft({ hash, classType, setName, slotName, archetype, tertiary }) {
  document.getElementById('tab-armor')?.click();

  await applyArmorCraftSelection({ hash, classType, setName, slotName, archetype, tertiary });

  // A new wish, not an edit of a saved one, so EDIT WISH stays hidden. PvE/PvP
  // is left where the user had it — an owned roll carries no mode of its own.
  armorEditContext = null;
  updatePrimaryBtn();
}

/**
 * Disables or enables the tab buttons and nav buttons to prevent user navigation during wish granting.
 */
function disableTabButtons(disabled) {
    const btnWeapons = document.getElementById('tab-weapons');
    const btnMenu = document.getElementById('tab-menu');
    const btnArmor = document.getElementById('tab-armor');
  const navCraft = document.getElementById('nav-craft');
  const navList = document.getElementById('nav-list');
  
  if (btnWeapons) {
    btnWeapons.disabled = disabled;
    if (disabled) {
      btnWeapons.classList.add('disabled');
    } else {
      btnWeapons.classList.remove('disabled');
    }
  }
  
  if (btnArmor) {
    btnArmor.disabled = disabled;
    if (disabled) {
      btnArmor.classList.add('disabled');
    } else {
      btnArmor.classList.remove('disabled');
    }
  }

    if (btnMenu) {
        btnMenu.disabled = disabled;
        if (disabled) {
            btnMenu.classList.add('disabled');
        } else {
            btnMenu.classList.remove('disabled');
        }
    }

  if (navCraft) {
    navCraft.disabled = disabled;
    if (disabled) {
      navCraft.classList.add('disabled');
    } else {
      navCraft.classList.remove('disabled');
    }
  }

  if (navList) {
    navList.disabled = disabled;
    if (disabled) {
      navList.classList.add('disabled');
    } else {
      navList.classList.remove('disabled');
    }
  }
}

/**
 * Renders the Armor List grouped by Set.
 */
/**
 * Renders the Armor List grouped by Set.
 * Now delegates to applyArmorFilters() for filtering logic.
 */
function refreshArmorList() {
    applyArmorFilters();
}

function createArmorCard(item) {
    const card = document.createElement('div');
    card.className = `armor-card${item.wish?.received ? ' armor-card-owned' : ''}`;

    // Safety check for wish data integrity
    if (!item.wish) return card;

    // Config can come from an import or an older/newer version, so nothing here
    // may assume the archetype is one we know or that a Tertiary is present — a
    // throw here would take the card (and used to take the whole list) down.
    const wishConfig = item.wish.config || {};
    const archName = typeof wishConfig.archetype === 'string' ? wishConfig.archetype : '';
    const archetype = ARCHETYPES.find(a => a.name === archName);
    // Either config shape (legacy wishes kept the Tertiary in `spark`). Only a
    // real stat name is ever used, since it ends up in a CSS class name.
    const fields = window.WishlistSync.armorFields(wishConfig);
    const asStat = (v) => STATS.find(s => s.toLowerCase() === String(v || '').toLowerCase()) || null;
    const tertiaryStat = asStat(fields.tertiary);
    const sparkStat = asStat(fields.spark);

    // 1. Assemble the stats we can show into a list for sorting
    const statsToDisplay = [];
    if (archetype) {
        statsToDisplay.push({ name: archetype.stats[0], type: 'pri', weight: 85 });
        statsToDisplay.push({ name: archetype.stats[1], type: 'sec', weight: 60 });
    }
    // The third bar keeps its old 'spark' style class; it shows the Tertiary.
    if (tertiaryStat) statsToDisplay.push({ name: tertiaryStat, type: 'spark', weight: 40 });

    // 2. Sort stats by in-game Rank (Health at top, Weapons at bottom)
    statsToDisplay.sort((a, b) => STAT_RANK[a.name] - STAT_RANK[b.name]);

    // 3. Map the sorted stats to HTML rows
    const statRowsHTML = statsToDisplay.map(stat => {
        const lowerName = stat.name.toLowerCase();
        // Secondary stats use the stat-specific muted colors we brainstormed
        const colorClass = (stat.type === 'sec') ? `bar-sec-${lowerName}` : `bar-${stat.type}`;
        
        return `
            <div class="stat-row-mini">
                <div class="stat-bar-fill">
                    <div class="bar-progress ${colorClass}" style="width: ${stat.weight}%"></div>
                </div>
                <div class="stat-icon-mini icon-${lowerName}"></div>
            </div>
        `;
    }).join('');

    const ownedCount = Array.isArray(item.wish.receivedInstances) ? item.wish.receivedInstances.length : 0;
    const ownedBadgeHTML = item.wish.received
        ? `<span class="wc-badge wc-badge-owned">OWNED x${ownedCount}</span>`
        : '';

    const isOwned = !!item.wish.received;
    const ownedInstanceIds = Array.isArray(item.wish.receivedInstances) ? item.wish.receivedInstances : [];

    // Names and icons are untrusted (shared lists): escape the text, and only
    // load Bungie-hosted art. See aw-dom.js.
    const iconSrc = escapeHtml(AWDom.safeImageUrl(item.static?.icon));
    const archSub = escapeHtml(archName) + (tertiaryStat ? ` +${tertiaryStat.toLowerCase()}` : '') +
        (sparkStat ? ` · ✦ ${sparkStat.toLowerCase()}` : '');

    card.innerHTML = `
        <div class="card-img-side">
            ${iconSrc ? `<img src="${iconSrc}" alt="">` : ''}
        </div>
        <div class="card-info-side">
            <div class="card-armor-name">${escapeHtml(item.static?.name || '(unknown)')}</div>
            <div class="card-archetype-sub">${archSub} ${ownedBadgeHTML}</div>
        </div>
        <div class="card-stats-side">
            ${statRowsHTML}
        </div>
        <div class="delete-overlay">
            ${isOwned ? '<button class="overlay-btn lock-btn">LOCK</button>' : ''}
            ${isOwned ? '<button class="overlay-btn equip-btn">EQUIP</button>' : ''}
            <button class="overlay-btn edit-btn">EDIT</button>
            <button class="overlay-btn del-btn">DELETE</button>
            <button class="overlay-btn cancel-btn">CANCEL</button>
        </div>
    `;

    // Single Click: Selection
    card.onclick = (e) => {
        if (card.classList.contains('deleting')) return;
        card.classList.toggle('selected');
    };

    // Double Click: action overlay
    card.ondblclick = (e) => {
        e.stopPropagation();
        card.classList.add('deleting');
    };

    card.querySelector('.cancel-btn').onclick = (e) => {
        e.stopPropagation();
        card.classList.remove('deleting');
    };

    card.querySelector('.del-btn').onclick = (e) => {
        e.stopPropagation();
        card.style.transform = "scale(0.9)";
        card.style.opacity = "0";
        card.style.transition = "0.3s ease";
        setTimeout(() => { deleteArmorWish(item.hash, item.wishIndex); }, 300);
    };

    card.querySelector('.edit-btn').onclick = (e) => {
        e.stopPropagation();
        card.classList.remove('deleting');
        loadWishIntoArmorCraft(item.hash, item.wishIndex, item, item.wish);
    };

    // --- LOCK button: locks every owned instance via Bungie API ---
    const lockBtn = card.querySelector('.lock-btn');
    if (lockBtn) {
        lockBtn.onclick = async (e) => {
            e.stopPropagation();
            lockBtn.disabled = true;
            lockBtn.textContent = '...';
            try {
                const res = await new Promise(r => chrome.storage.local.get(['activeMembership'], r));
                const mem = res?.activeMembership;
                if (!mem?.membershipType || !mem?.membershipId || !mem?.characterIds?.length) {
                    throw new Error('No membership info cached — sync inventory first');
                }
                const idx = window.OwnedInventoryIndex?.getCachedIndex?.();
                const fallbackCharId = mem.characterIds[0];
                for (const iid of ownedInstanceIds) {
                    const owned = idx?.byInstanceId?.get(String(iid));
                    const charId = owned?.characterId || fallbackCharId;
                    await window.bungieAuth.setItemLockState(iid, charId, mem.membershipType, mem.membershipId, true);
                }
                lockBtn.textContent = 'LOCKED';
            } catch (err) {
                console.warn('[Card] Lock failed:', err);
                lockBtn.textContent = 'FAILED';
                lockBtn.disabled = false;
            }
        };
    }

    // --- EQUIP button: equips the first instance already in a character inventory ---
    const equipBtn = card.querySelector('.equip-btn');
    if (equipBtn) {
        equipBtn.onclick = async (e) => {
            e.stopPropagation();
            equipBtn.disabled = true;
            equipBtn.textContent = '...';
            try {
                const res = await new Promise(r => chrome.storage.local.get(['activeMembership'], r));
                const mem = res?.activeMembership;
                if (!mem?.membershipType || !mem?.membershipId) {
                    throw new Error('No membership info cached — sync inventory first');
                }
                const idx = window.OwnedInventoryIndex?.getCachedIndex?.();
                let targetIid = null, targetCharId = null;
                for (const iid of ownedInstanceIds) {
                    const owned = idx?.byInstanceId?.get(String(iid));
                    if (owned?.characterId) { targetIid = iid; targetCharId = owned.characterId; break; }
                }
                if (!targetIid) {
                    // All copies are in the vault — equip isn't possible without a transfer
                    equipBtn.textContent = 'IN VAULT';
                    return;
                }
                await window.bungieAuth.equipItem(targetIid, targetCharId, mem.membershipType, mem.membershipId);
                equipBtn.textContent = 'EQUIPPED';
            } catch (err) {
                console.warn('[Card] Equip failed:', err);
                equipBtn.textContent = 'FAILED';
                equipBtn.disabled = false;
            }
        };
    }

    return card;
}

/**
 * Deletes a specific armor wish from local storage by index.
 * Removes the entire item if no wishes remain.
 */
function deleteArmorWish(hash, wishIndex) {
    return AWStore.update((data) => {
        const listId = AWStore.ensureActiveList(data);
        const activeList = data.lists[listId];
        const item = activeList.items[hash];
        if (!item || !item.wishes || wishIndex >= item.wishes.length) return AWStore.SKIP;

        const [removed] = item.wishes.splice(wishIndex, 1);
        // Record the deletion so cross-browser sync can't restore it from
        // a browser still holding the old copy — see wishlist-sync-core.js.
        if (removed) window.WishlistSync?.recordWishTombstone(data, listId, hash, removed);

        // Remove item entirely if no wishes remain
        if (item.wishes.length === 0) {
            delete activeList.items[hash];
        }
    }).then(() => {
        console.log(`[Manager] Wish rescinded for hash: ${hash}, index: ${wishIndex}`);
        // Refresh the UI to reflect the removal
        refreshArmorList();
    });
}

/**
 * Gets a consistent armor set identifier using ONLY Bungie's official gearset data.
 * Items without gearset data are treated as individual ungrouped items.
 */
function getArmorSetId(item) {
    // Use Bungie's official equipableItemSetHash for grouping
    const setHash = item.static?.setHash || item.setHash;
    if (setHash) {
        return `set-${setHash}`;
    }
    
    // Items without set data get their own unique group (ungrouped)
    return `ungrouped-${item.hash}`;
}

/**
 * Generates a readable display name for an armor set group.
 * Uses the pre-built lookup table from the manifest (built at startup).
 */
function getSetDisplayName(setItems) {
    if (!setItems || setItems.length === 0) return "Unknown Set";

    const firstItem = setItems[0];
    const setHash = firstItem.static?.setHash || firstItem.setHash;

    if (setHash) {
        const lookupName = getArmorSetName(setHash);
        if (lookupName) return lookupName;
    }

    return firstItem.static?.name || "Unknown Set";
}

/**
 * Resolve perk/item names from manifest hashes.
 * Returns array of names (or fallback strings) for given numeric hashes.
 */
// Expose API
window.uiCreator = window.uiCreator || {};

