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