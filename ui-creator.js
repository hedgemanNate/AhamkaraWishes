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
let currentSpark = null;
let currentMode = 'pve';

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
});

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
        if (!data || !data.lists || !data.lists.default) {
            container.innerHTML = '<div class="empty-list-text">No Armor Wishes yet.</div>';
            return;
        }

        const items = data.lists.default.items;
        const filteredItems = {};

        // Apply filters
        Object.keys(items).forEach(hash => {
            const item = items[hash];
            if (item.static.type !== 'armor') return;

            // Filter by armor name
            if (armorNameSearch) {
                const itemName = item.static.name.toLowerCase();
                if (!itemName.includes(armorNameSearch)) return;
            }

            // Filter by archetype
            if (selectedArchetypes.length > 0 && item.wishes && item.wishes[0]) {
                const itemArchetype = item.wishes[0].config?.archetype;
                if (!selectedArchetypes.includes(itemArchetype)) return;
            }

            // Filter by class
            if (selectedClasses.length > 0) {
                if (!selectedClasses.includes(item.static.classType)) return;
            }

            filteredItems[hash] = item;
        });

        // Group by set ID (using gearset data only)
        const armorSets = {};
        Object.keys(filteredItems).forEach(hash => {
            const item = filteredItems[hash];
            const setId = getArmorSetId(item);
            if (!armorSets[setId]) armorSets[setId] = [];
            armorSets[setId].push({ hash, ...item });
        });

        // Render sets
        if (Object.keys(armorSets).length === 0) {
            container.innerHTML = '<div class="empty-list-text">No results found.</div>';
            return;
        }

        Object.keys(armorSets).forEach(setId => {
            const setContainer = document.createElement('div');
            setContainer.className = 'armor-set-row';
            
            // Generate readable set name for display
            const displayName = getSetDisplayName(armorSets[setId]);
            
            const piecesBackgroundHtml = armorSets[setId]
                .map(item => {
                    const iconUrl = item.static.icon
                        ? (item.static.icon.startsWith('http') ? item.static.icon : `${BUNGIE_ROOT}${item.static.icon}`)
                        : '';
                    return `<img src="${iconUrl}" class="set-piece-bg" alt=""/>`;
                })
                .join('');
            
            setContainer.innerHTML = `
                <div class="set-header">
                    <div class="set-pieces-background">
                        <div class="set-pieces-container">${piecesBackgroundHtml}</div>
                        <div class="set-pieces-overlay"></div>
                    </div>
                    <div class="set-name-area">
                        <span class="set-name-text">${displayName}</span>
                        <span class="set-count-text">${armorSets[setId].length} / 5 PIECES</span>
                    </div>
                    <div class="set-badge-area">
                        <div class="expansion-badge" title="Renegades Expansion"></div>
                    </div>
                </div>
                <div class="set-content" id="set-content-${setId.replace(/[\s-]+/g, '')}" style="display: none;">
                </div>
            `;

            const contentArea = setContainer.querySelector('.set-content');

            armorSets[setId].forEach(item => {
                const card = createArmorCard(item);
                contentArea.appendChild(card);
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

    // 2. Tab Switching (Global: Weapons vs Armor)
    const btnWeapons = document.getElementById('tab-weapons');
    const btnArmor = document.getElementById('tab-armor');
    if (btnWeapons && btnArmor) {
        btnWeapons.onclick = () => {
            btnWeapons.classList.add('active');
            btnArmor.classList.remove('active');
            document.getElementById('view-weapons').classList.add('active-view');
            document.getElementById('view-armor').classList.remove('active-view');
        };
        btnArmor.onclick = () => {
            btnArmor.classList.add('active');
            btnWeapons.classList.remove('active');
            document.getElementById('view-armor').classList.add('active-view');
            document.getElementById('view-weapons').classList.remove('active-view');
        };
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
    if (searchInput) {
        searchInput.oninput = (e) => {
            clearTimeout(searchTimeout);
            const query = e.target.value.trim();
            if (query.length < 2) return;
            document.querySelectorAll('.armor-box').forEach(b => b.classList.add('loading'));
            searchTimeout = setTimeout(() => triggerSearch(query), 500);
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
            currentSpark = null;
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
 */
async function triggerSearch(query) {
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
 * Builds buttons for Archetypes and Sparks using constants from manager.js.
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
            syncSparkAvailability(arch.stats);
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
            currentSpark = stat;
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
            nameplate.textContent = firstItem.name.replace(/(Mask|Vest|Grips|Strides|Cloak|Gauntlets|Plate|Helm|Greaves|Mark|Gloves|Robes|Bond)/gi, '').trim();
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
 * Prevents picking a spark stat already covered by the archetype.
 */
function syncSparkAvailability(usedStats) {
    document.querySelectorAll('#spark-grid .stat-btn').forEach(btn => {
        const stat = btn.dataset.stat;
        if (usedStats.includes(stat)) {
            btn.classList.add('unavailable');
            btn.classList.remove('selected');
            if (currentSpark === stat) currentSpark = null;
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
    } else if (!currentArchetype || !currentSpark) {
        btn.disabled = true;
        btn.textContent = "SELECT STATS ABOVE";
    } else {
        btn.disabled = false;
        if (selectedCount === 1) {
            btn.textContent = `MAKE WISH: ${currentArchetype.name} + ${currentSpark.toUpperCase()}`;
        } else {
            btn.textContent = `MAKE ${selectedCount} WISHES: ${currentArchetype.name} + ${currentSpark.toUpperCase()}`;
        }
    }
}

/**
 * Final step: Passes selection(s) to the backend saveItem() in manager.js.
 */
function handleSaveWish() {
  const itemsToSave = Object.values(selectedPieces);
  const btn = document.getElementById("btn-create-armor");
  
  console.log("[SaveWish] Button clicked. Items to save:", itemsToSave.length);
  console.log("[SaveWish] currentArchetype:", currentArchetype);
  console.log("[SaveWish] currentSpark:", currentSpark);
  console.log("[SaveWish] currentMode:", currentMode);
  
  if (itemsToSave.length === 0) {
    console.warn("[SaveWish] No items selected");
    return;
  }
  
  // Show feedback with green flash
  btn.textContent = "WISH GRANTED!";
  btn.classList.add("success");
  
  // Reset after 1.5 seconds
  setTimeout(() => {
    btn.classList.remove("success");
    updatePrimaryBtn();
  }, 1500);
  
  let saveChain = Promise.resolve();
  
  itemsToSave.forEach((item, index) => {
    saveChain = saveChain.then(() => {
      console.log("[SaveWish] Starting save for item", index + 1, ":", item.name);
      const slotName = getBucketName(item.bucketHash);
      const setName = item.static?.name || "Unknown";
      
      return saveItem(
        item.hash,
        item.name,
        "armor",
        `armor-wish:${item.hash}`,
        `armor-wish:${item.hash}`,
        { archetype: currentArchetype.name, spark: currentSpark },
        currentMode,
        item.icon,
        item.classType,
        item.bucketHash,
        slotName,
        setName,
        item.setHash
      ).then(() => {
        console.log("[SaveWish] Item saved successfully:", item.name);
      }).catch(err => {
        console.error("[SaveWish] Error saving item:", item.name, err);
      });
    });
  });
  
  saveChain.catch(err => {
    console.error("[SaveWish] Save chain failed:", err);
  });
}

/**
 * Disables or enables the tab buttons and nav buttons to prevent user navigation during wish granting.
 */
function disableTabButtons(disabled) {
  const btnWeapons = document.getElementById('tab-weapons');
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
    card.className = 'armor-card';
    
    // Safety check for 2026 wish data integrity
    if (!item.wishes || !item.wishes[0]) return card;

    const wishConfig = item.wishes[0].config;
    const archName = wishConfig.archetype;
    const sparkName = wishConfig.spark;
    const archetype = ARCHETYPES.find(a => a.name === archName);

    // 1. Assemble the 3 stats into a list for sorting
    const statsToDisplay = [
        { name: archetype.stats[0], type: 'pri', weight: 85 },
        { name: archetype.stats[1], type: 'sec', weight: 60 },
        { name: sparkName.toLowerCase(), type: 'spark', weight: 40 }
    ];

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

    card.innerHTML = `
        <div class="card-img-side">
            <img src="${item.static.icon}" alt="">
        </div>
        <div class="card-info-side">
            <div class="card-armor-name">${item.static.name}</div>
            <div class="card-archetype-sub">${archName} +${sparkName.toLowerCase()}</div>
        </div>
        <div class="card-stats-side">
            ${statRowsHTML}
        </div>
        <div class="delete-overlay">
            <button class="del-btn">DELETE</button>
            <button class="cancel-btn">CANCEL</button>
        </div>
    `;

    // Single Click: Selection
    card.onclick = (e) => {
        if (card.classList.contains('deleting')) return;
        card.classList.toggle('selected');
    };

    // Double Click: Delete Mode
    card.ondblclick = (e) => {
        e.stopPropagation();
        card.classList.add('deleting');
    };

    // Overlay Buttons
    card.querySelector('.cancel-btn').onclick = (e) => {
        e.stopPropagation();
        card.classList.remove('deleting');
    };

    card.querySelector('.del-btn').onclick = (e) => {
        e.stopPropagation();
        // Visual feedback: Shrink and fade before it vanishes
        card.style.transform = "scale(0.9)";
        card.style.opacity = "0";
        card.style.transition = "0.3s ease";

        // Delay the data deletion slightly so the animation finishes
        setTimeout(() => {
            deleteArmorWish(item.hash);
        }, 300);
    };

    return card;
}

/**
 * Deletes an armor wish from local storage.
 */
function deleteArmorWish(hash) {
    chrome.storage.local.get(['dimData'], (result) => {
        let data = result.dimData;

        // Safety check: ensure the data structure exists
        if (data && data.lists && data.lists.default && data.lists.default.items) {
            
            // Remove the item using its unique hash
            if (data.lists.default.items[hash]) {
                delete data.lists.default.items[hash];

                // Save the updated list back to storage
                chrome.storage.local.set({ dimData: data }, () => {
                    console.log(`[Manager] Wish rescinded for hash: ${hash}`);
                    
                    // Refresh the UI to reflect the removal
                    refreshArmorList();
                });
            }
        }
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
 * Uses the name of the first item in the set (typically they're all named the same set).
 */
function getSetDisplayName(setItems) {
    if (!setItems || setItems.length === 0) return "Unknown Set";
    
    const firstItem = setItems[0];
    
    // Use the item name to extract set name
    // Armor sets typically have consistent naming patterns (e.g., "Swordmaster's Robes", "Swordmaster's Gaskets", etc.)
    const itemName = firstItem.static?.name || "Unknown Set";
    
    // Try to extract set name by removing slot keywords
    const slotKeywords = ['Helmet', 'Gauntlets', 'Armor', 'Chest', 'Legs', 'Class', 'Mark', 'Cloak', 'Bond', 'Robes', 'Gloves', 'Plate'];
    let setName = itemName;
    
    for (const keyword of slotKeywords) {
        const regex = new RegExp(`\\b${keyword}\\b`, 'i');
        if (regex.test(setName)) {
            setName = setName.replace(regex, '').trim();
            break;
        }
    }
    
    return setName || itemName;
}

