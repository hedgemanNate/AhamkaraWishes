/**
 * UI-CREATOR.JS
 * Handles all DOM construction and UI state for the Armor Wizard.
 * Communicates with manager.js for data and search.
 */

// --- UI STATE ---
let currentClass = 0; 
let searchTimeout = null; 
let armorSelection = null; 
let currentArchetype = null;
let currentSpark = null;
let currentMode = 'pve';

// Initialize UI when the tab is clicked or loaded
document.addEventListener('DOMContentLoaded', () => {
    buildArmorWizard();
});

/**
 * Builds the main UI structure for the Armor Creator tab.
 */
function buildArmorWizard() {
    const container = document.querySelector('.armor-creator');
    if (!container) return;

    container.innerHTML = `
        <div class="class-selector">
            <button class="class-btn active" data-class="0">TITAN</button>
            <button class="class-btn" data-class="2">WARLOCK</button>
            <button class="class-btn" data-class="1">HUNTER</button>
        </div>

        <div class="armor-search-container">
            <div class="step-label">1. SEARCH ARMOR (Set Name)</div>
            <input type="text" class="search-input" id="armor-query" placeholder="e.g. Iron, Artifice, Darkhollow...">
            <div class="armor-grid" id="armor-grid">
                <div class="armor-box" data-slot="Head"></div>
                <div class="armor-box" data-slot="Arms"></div>
                <div class="armor-box" data-slot="Chest"></div>
                <div class="armor-box" data-slot="Legs"></div>
                <div class="armor-box" data-slot="Class"></div>
            </div>
        </div>

        <div class="step-container">
            <div class="step-label">2. CHOOSE ARCHETYPE</div>
            <div class="grid-2col" id="archetype-grid"></div>
        </div>

        <div class="step-container">
            <div class="step-label">3. CHOOSE SPARK</div>
            <div class="grid-3col" id="spark-grid"></div>
        </div>

        <div class="action-area" style="margin-top: 20px;">
            <div class="toggle-container pve" id="ui-mode-toggle">
                <div class="opt-pve">PvE</div>
                <div class="opt-pvp">PvP</div>
            </div>
            <button id="btn-create-armor" class="btn-primary" disabled>
                SELECT ARMOR PIECE FIRST
            </button>
        </div>
    `;

    attachUIEventListeners();
    populateStats();
}

/**
 * Attaches listeners for search, class switching, and the mode toggle.
 */
function attachUIEventListeners() {
    // Class Selection
    document.querySelectorAll('.class-btn').forEach(btn => {
        btn.onclick = (e) => {
            document.querySelectorAll('.class-btn').forEach(b => b.classList.remove('active'));
            e.target.classList.add('active');
            currentClass = parseInt(e.target.dataset.class);
            
            // Re-trigger search if input has content
            const query = document.getElementById('armor-query').value;
            if (query.length >= 2) performArmorSearch(query);
        };
    });

    // Search Input (Debounced)
    const searchInput = document.getElementById('armor-query');
    searchInput.oninput = (e) => {
        clearTimeout(searchTimeout);
        const query = e.target.value.trim();
        
        if (query.length < 2) return;

        document.querySelectorAll('.armor-box').forEach(b => b.classList.add('loading'));
        searchTimeout = setTimeout(() => performArmorSearch(query), 500);
    };

    // Mode Toggle (PvE/PvP)
    const toggle = document.getElementById('ui-mode-toggle');
    toggle.onclick = () => {
        currentMode = currentMode === 'pve' ? 'pvp' : 'pve';
        toggle.className = `toggle-container ${currentMode}`;
    };

    // Save Button
    document.getElementById('btn-create-armor').onclick = saveArmorWish;
}

/**
 * Bridging function: Calls the local search in manager.js and updates the UI.
 */
async function performArmorSearch(query) {
    try {
        const results = await searchArmorLocally(query, currentClass);
        
        const buckets = {
            Head: results.find(i => i.bucketHash === BUCKET_HASHES.HELMET),
            Arms: results.find(i => i.bucketHash === BUCKET_HASHES.GAUNTLETS),
            Chest: results.find(i => i.bucketHash === BUCKET_HASHES.CHEST),
            Legs: results.find(i => i.bucketHash === BUCKET_HASHES.LEGS),
            Class: results.find(i => i.bucketHash === BUCKET_HASHES.CLASS_ITEM)
        };

        updateArmorGrid(buckets);
    } catch (e) {
        console.error("[UI-CREATOR] Search bridge failed:", e);
    }
}

/**
 * Populates the archetype and spark stat buttons from backend constants.
 */
function populateStats() {
    const archGrid = document.getElementById('archetype-grid');
    const sparkGrid = document.getElementById('spark-grid');

    ARCHETYPES.forEach(arch => {
        const btn = document.createElement('div');
        btn.className = 'stat-btn';
        btn.innerHTML = `<strong>${arch.name}</strong><span class="stat-sub">${arch.stats.join(' + ')}</span>`;
        btn.onclick = () => selectArchetype(arch, btn);
        archGrid.appendChild(btn);
    });

    STATS.forEach(stat => {
        const btn = document.createElement('div');
        btn.className = 'stat-btn';
        btn.innerHTML = `<strong>${stat.substring(0,3).toUpperCase()}</strong>`; 
        btn.dataset.stat = stat; 
        btn.onclick = () => selectSpark(stat, btn);
        sparkGrid.appendChild(btn);
    });
}

/**
 * Visual update for the 5-slot armor boxes.
 */
function updateArmorGrid(buckets) {
    const grid = document.getElementById('armor-grid');
    const slots = ['Head', 'Arms', 'Chest', 'Legs', 'Class'];
    
    slots.forEach(slot => {
        const box = grid.querySelector(`[data-slot="${slot}"]`);
        box.classList.remove('loading', 'selected');
        box.innerHTML = `<span class="slot-label">${slot.toUpperCase()}</span>`;
        
        const item = buckets[slot];
        if (item) {
            const img = document.createElement('img');
            img.src = item.icon; // Already prefixed by backend
            box.appendChild(img);
            box.onclick = () => {
                document.querySelectorAll('.armor-box').forEach(b => b.classList.remove('selected'));
                box.classList.add('selected');
                armorSelection = item;
                checkButtonState();
            };
        }
    });
}

/**
 * Handles Archetype selection and updates Spark availability.
 */
function selectArchetype(arch, btn) {
    document.querySelectorAll('#archetype-grid .stat-btn').forEach(b => b.classList.remove('selected'));
    btn.classList.add('selected');
    currentArchetype = arch;
    
    updateSparkAvailability(arch.stats);
    checkButtonState();
}

/**
 * Handles Spark selection.
 */
function selectSpark(stat, btn) {
    if (btn.classList.contains('unavailable')) return;
    document.querySelectorAll('#spark-grid .stat-btn').forEach(b => b.classList.remove('selected'));
    btn.classList.add('selected');
    currentSpark = stat;
    checkButtonState();
}

/**
 * Disables Sparks that are already part of the chosen Archetype.
 */
function updateSparkAvailability(usedStats) {
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
 * Gathers UI state and sends the "Wish" to backend storage.
 */
function saveArmorWish() {
    if (!armorSelection || !currentArchetype || !currentSpark) return;

    // Call backend save function (manager.js)
    saveItem(
        armorSelection.hash, 
        armorSelection.name, 
        'armor', 
        `armor-wish:${armorSelection.hash}`, 
        { 
            archetype: currentArchetype.name, 
            spark: currentSpark,
            icon: armorSelection.icon.replace(BUNGIE_ROOT, "") // Store relative path
        }
    );

    // Visual Feedback
    const btn = document.getElementById('btn-create-armor');
    const originalText = btn.textContent;
    btn.textContent = "WISH GRANTED!";
    btn.classList.add('success'); // Ensure success class is in CSS
    
    setTimeout(() => {
        btn.classList.remove('success');
        checkButtonState();
    }, 2000);
}

/**
 * Final validation for the "Save" button.
 */
function checkButtonState() {
    const btn = document.getElementById('btn-create-armor');
    if (!armorSelection) {
        btn.disabled = true;
        btn.textContent = "SELECT ARMOR PIECE FIRST";
    } else if (!currentArchetype || !currentSpark) {
        btn.disabled = true;
        btn.textContent = "SELECT STATS ABOVE";
    } else {
        btn.disabled = false;
        btn.textContent = `ADD: ${currentArchetype.name} + ${currentSpark.toUpperCase()}`;
    }
}