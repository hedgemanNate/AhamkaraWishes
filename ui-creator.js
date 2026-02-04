/**
 * UI-CREATOR.JS
 * Separated UI Logic Layer. Uses manager.js for data.
 */

// --- UI STATE ---
let currentClass = 0; 
let searchTimeout = null; 
let armorSelection = null; 
let currentArchetype = null;
let currentSpark = null;
let currentMode = 'pve';

const STAT_RANK = {
    "Health": 1,
    "Melee": 2,
    "Grenade": 3,
    "Super": 4,
    "Class": 5,
    "Weapons": 6
};

document.addEventListener('DOMContentLoaded', () => {
    initArmorWizard();
});

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

    // 6. Nameplate Reset (Red Hover Reset)
    const nameplate = document.getElementById('armor-set-name');
    if (nameplate) {
        nameplate.onclick = () => {
            armorSelection = null;
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
            updatePrimaryBtn();
        };
    }

    // 7. Mode Toggle (PvE/PvP)
    const toggle = document.getElementById('ui-mode-toggle');
    if (toggle) {
        toggle.onclick = () => {
            currentMode = (currentMode === 'pve') ? 'pvp' : 'pve';
            toggle.className = `toggle-container ${currentMode}`;
        };
    }

    // 8. Save Wish Button
    const saveBtn = document.getElementById('btn-create-armor');
    if (saveBtn) {
        saveBtn.onclick = handleSaveWish;
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
 * Refreshes the armor icons in Step 1.
 */
/**
 * Refreshes the armor icons in Step 1.
 * Handles set name detection, selective dimming, and individual name updates.
 */
function refreshArmorDisplay(buckets) {
    const slots = ['Head', 'Arms', 'Chest', 'Legs', 'Class'];
    const nameplate = document.getElementById('armor-set-name');
    
    const firstItem = Object.values(buckets).find(item => item !== undefined);
    if (nameplate) {
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
        
        box.classList.remove('loading', 'selected', 'dimmed');
        box.innerHTML = `<span class="slot-label">${slot.toUpperCase()}</span>`;
        
        const item = buckets[slot];
        if (item) {
            const img = document.createElement('img');
            img.src = item.icon; 
            box.appendChild(img);
            
            box.onclick = () => {
                // Dim others, highlight selected
                document.querySelectorAll('.armor-box').forEach(b => {
                    b.classList.remove('selected');
                    b.classList.add('dimmed');
                });
                
                box.classList.remove('dimmed');
                box.classList.add('selected');
                
                // Update nameplate to specific piece in Gold
                if (nameplate) {
                    nameplate.textContent = item.name;
                    nameplate.style.color = "var(--accent-gold)";
                }

                armorSelection = item;
                updatePrimaryBtn();
            };
        }
    });
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
    if (!armorSelection) {
        btn.disabled = true;
        btn.textContent = "SELECT ARMOR PIECE FIRST";
    } else if (!currentArchetype || !currentSpark) {
        btn.disabled = true;
        btn.textContent = "SELECT STATS ABOVE";
    } else {
        btn.disabled = false;
        btn.textContent = `MAKE WISH: ${currentArchetype.name} + ${currentSpark.toUpperCase()}`;
    }
}

/**
 * Final step: Passes selection to the backend saveItem() in manager.js.
 */
function handleSaveWish() {
  saveItem(
    armorSelection.hash,
    armorSelection.name,
    "armor",
    `armor-wish:${armorSelection.hash}`,
    `armor-wish:${armorSelection.hash}`,
    { archetype: currentArchetype.name, spark: currentSpark },
    currentMode
  );

  const btn = document.getElementById("btn-create-armor");
  const originalText = btn.textContent;
  btn.textContent = "WISH GRANTED!";
  btn.classList.add("success");

  setTimeout(() => {
    btn.classList.remove("success");
    updatePrimaryBtn();
  }, 2000);
}

/**
 * Renders the Armor List grouped by Set.
 */
/**
 * Renders the Armor List grouped by Set.
 * Corrected: Ensures set containers exist before injecting cards.
 */
function refreshArmorList() {
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
        const armorSets = {};

        // 1. Grouping logic: Organize items by their set name
        Object.keys(items).forEach(hash => {
            const item = items[hash];
            // Only process items explicitly marked as armor wishes
            if (item.static.type !== 'armor' || !item.wishes) return;

            // Extract set name (e.g., "Iron Forerunner")
            const setName = getArmorSetName(item.static.name);
            
            if (!armorSets[setName]) armorSets[setName] = [];
            armorSets[setName].push({ hash, ...item });
        });

        // 2. Create the UI for each set
        Object.keys(armorSets).forEach(setName => {
            const setContainer = document.createElement('div');
            setContainer.className = 'armor-set-row';
            
            setContainer.innerHTML = `
                <div class="set-header">
                    <div class="set-name-area">
                        <span class="set-name-text">${setName}</span>
                        <span class="set-count-text">${armorSets[setName].length} / 5 PIECES</span>
                    </div>
                    <div class="set-badge-area">
                        <div class="expansion-badge" title="Renegades Expansion"></div>
                    </div>
                </div>
                <div class="set-content" id="set-content-${setName.replace(/\s+/g, '')}" style="display: none;">
                </div>
            `;

            const contentArea = setContainer.querySelector('.set-content');

            // 3. Inject cards into the newly created set-content area
            armorSets[setName].forEach(item => {
                const card = createArmorCard(item);
                contentArea.appendChild(card);
            });

            // Toggle expansion logic
            const header = setContainer.querySelector('.set-header');
            header.onclick = () => {
                const isExpanded = contentArea.style.display === 'flex';
                contentArea.style.display = isExpanded ? 'none' : 'flex';
            };

            container.appendChild(setContainer);
        });

        // 4. Handle completely empty armor list state
        if (Object.keys(armorSets).length === 0) {
            container.innerHTML = '<div class="empty-list-text">No Armor Wishes yet.</div>';
        }
    });
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
 * Cleans armor names to extract the base Set Name.
 * Optimized for 2026 Renegades slot naming conventions.
 */
function getArmorSetName(fullName) {
    if (!fullName) return "Unknown Set";
    
    // Comprehensive list of slot keywords across all 3 classes (2026 update)
    const slotKeywords = [
        "Mask", "Vest", "Grips", "Strides", "Cloak",              // Hunter
        "Helm", "Gauntlets", "Plate", "Greaves", "Mark",            // Titan
        "Hood", "Gloves", "Robes", "Boots", "Bond", "Cover",        // Warlock
        "Helmet", "Chest", "Arms", "Legs", "Class Item"            // Generic
    ];

    // Create a dynamic Regex to strip slot names and trailing spaces
    const regex = new RegExp(`\\b(${slotKeywords.join('|')})\\b`, 'gi');
    
    // Remove slot keywords and any double spaces/trailing punctuation
    let cleaned = fullName.replace(regex, '').replace(/\s\s+/g, ' ').trim();
    
    // If the name is empty after cleaning (rare), fallback to the full name
    return cleaned || fullName;
}