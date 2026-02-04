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
    // 1. Class Selection Pill
    document.querySelectorAll('.class-btn').forEach(btn => {
        btn.onclick = (e) => {
            document.querySelectorAll('.class-btn').forEach(b => b.classList.remove('active'));
            e.target.classList.add('active');
            currentClass = parseInt(e.target.dataset.class);
            
            const query = document.getElementById('armor-query').value;
            if (query.length >= 2) triggerSearch(query);
        };
    });

    // 2. Search Input (Debounced)
    const searchInput = document.getElementById('armor-query');
    searchInput.oninput = (e) => {
        clearTimeout(searchTimeout);
        const query = e.target.value.trim();
        if (query.length < 2) return;

        document.querySelectorAll('.armor-box').forEach(b => b.classList.add('loading'));
        searchTimeout = setTimeout(() => triggerSearch(query), 500);
    };

    // 3. Muted Mode Toggle (PvE/PvP)
    const toggle = document.getElementById('ui-mode-toggle');
    toggle.onclick = () => {
        currentMode = (currentMode === 'pve') ? 'pvp' : 'pve';
        toggle.className = `toggle-container ${currentMode}`;
    };

    // 4. Save Wish Button
    document.getElementById('btn-create-armor').onclick = handleSaveWish;
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
function refreshArmorDisplay(buckets) {
    const slots = ['Head', 'Arms', 'Chest', 'Legs', 'Class'];
    slots.forEach(slot => {
        const box = document.querySelector(`.armor-box[data-slot="${slot}"]`);
        box.classList.remove('loading', 'selected');
        box.innerHTML = `<span class="slot-label">${slot.toUpperCase()}</span>`;
        
        const item = buckets[slot];
        if (item) {
            const img = document.createElement('img');
            img.src = item.icon; 
            box.appendChild(img);
            box.onclick = () => {
                document.querySelectorAll('.armor-box').forEach(b => b.classList.remove('selected'));
                box.classList.add('selected');
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