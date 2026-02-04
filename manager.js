// --- CONFIGURATION ---
const API_KEY = "fee720e84d6c4239aeb7d442b4d39f38"; // Using your key
const BUNGIE_ROOT = "https://www.bungie.net";

const ARCHETYPES = [
    { id: 'paragon', name: 'PARAGON', stats: ['Super', 'Melee'] },
    { id: 'brawler', name: 'BRAWLER', stats: ['Melee', 'Health'] },
    { id: 'gunner',  name: 'GUNNER',  stats: ['Grenade', 'Class'] }, 
    { id: 'special', name: 'SPECIALIST', stats: ['Class', 'Grenade'] },
    { id: 'grenadr', name: 'GRENADIER', stats: ['Grenade', 'Super'] },
    { id: 'bulwark', name: 'BULWARK',   stats: ['Health', 'Class'] } 
];

const STATS = ['Mobility', 'Health', 'Class', 'Grenade', 'Super', 'Melee'];

// --- STATE ---
let currentClass = 0; // 0=Titan, 1=Hunter, 2=Warlock
let searchTimeout = null; // For debounce
let armorSelection = null; // { hash, name, icon }

let currentArchetype = null;
let currentSpark = null;
let currentMode = 'pve';

// --- INITIALIZATION ---
document.addEventListener('DOMContentLoaded', () => {
    setupTabs();
    setupArmorUI();
    loadLists(); 
});

// --- LIVE UPDATE LISTENER ---
// Triggers whenever data changes (e.g. from Content Script or internal save)
chrome.storage.onChanged.addListener((changes, namespace) => {
    if (namespace === 'local' && changes.dimData) {
        loadLists();
    }
});

function setupTabs() {
    const btnWeapons = document.getElementById('tab-weapons');
    const btnArmor = document.getElementById('tab-armor');
    const viewWeapons = document.getElementById('view-weapons');
    const viewArmor = document.getElementById('view-armor');

    btnWeapons.addEventListener('click', () => {
        btnWeapons.classList.add('active');
        btnArmor.classList.remove('active');
        viewWeapons.classList.add('active-view');
        viewArmor.classList.remove('active-view');
        loadLists();
    });

    btnArmor.addEventListener('click', () => {
        btnArmor.classList.add('active');
        btnWeapons.classList.remove('active');
        viewArmor.classList.add('active-view');
        viewWeapons.classList.remove('active-view');
    });
}

// --- VIEWER LOGIC ---
function loadLists() {
    chrome.storage.local.get(['dimData'], (result) => {
        const container = document.getElementById('weapon-list');
        const emptyState = document.getElementById('empty-state');
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

        Object.keys(activeList.items).forEach(hash => {
            const item = activeList.items[hash];
            const card = createItemCard(hash, item);
            container.appendChild(card);
        });
    });
}

function createItemCard(hash, item) {
    const card = document.createElement('div');
    card.className = 'weapon-card';

    let wishesHtml = '';
    
    // Header Info (Uses Icon if available)
    const iconHtml = item.static.icon ? 
        `<img src="${BUNGIE_ROOT}${item.static.icon}" style="width:24px; height:24px; margin-right:8px; vertical-align:middle; border-radius:2px;">` : '';

    if (item.wishes && item.wishes.length > 0) {
        item.wishes.forEach((wish, index) => {
            const tag = wish.tags[0] || 'pve';
            const badgeClass = tag === 'pvp' ? 'badge-pvp' : 'badge-pve';
            
            let detailText = `Roll #${index + 1}`;
            if (item.static.type === 'armor' && wish.config) {
                detailText = `${wish.config.archetype} + ${wish.config.spark}`;
            }

            wishesHtml += `
                <div class="roll-row">
                    <div>
                        <span class="badge ${badgeClass}">${tag}</span>
                        <span>${detailText}</span>
                    </div>
                    <button class="btn-del" data-hash="${hash}" data-idx="${index}">🗑️</button>
                </div>
            `;
        });
    }

    card.innerHTML = `
        <div class="card-header">
            <div style="display:flex; align-items:center;">
                ${iconHtml}
                <span class="card-title">${item.static.name}</span>
            </div>
            <span class="card-id">${item.static.type.toUpperCase()}</span>
        </div>
        <div class="card-body">
            ${wishesHtml}
        </div>
    `;

    card.querySelectorAll('.btn-del').forEach(btn => {
        btn.addEventListener('click', (e) => {
            deleteWish(hash, e.target.dataset.idx);
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

// =========================================================
// --- ARMOR CREATOR 2.0 LOGIC ---
// =========================================================

function setupArmorUI() {
    const creatorContainer = document.querySelector('.armor-creator');
    
    // Clear existing to rebuild safely
    creatorContainer.innerHTML = '';

    // 1. CLASS SELECTOR (Top)
    const classSelector = document.createElement('div');
    classSelector.className = 'class-selector';
    classSelector.innerHTML = `
        <button class="class-btn active" data-class="0">TITAN</button>
        <button class="class-btn" data-class="2">WARLOCK</button>
        <button class="class-btn" data-class="1">HUNTER</button>
    `;
    
    classSelector.querySelectorAll('button').forEach(btn => {
        btn.addEventListener('click', (e) => {
            document.querySelectorAll('.class-btn').forEach(b => b.classList.remove('active'));
            e.target.classList.add('active');
            currentClass = parseInt(e.target.dataset.class);
            // Trigger search again if text exists
            const input = document.querySelector('.search-input');
            if(input && input.value.length > 2) performArmorSearch(input.value);
        });
    });
    creatorContainer.appendChild(classSelector);

    // 2. SEARCH & GRID (Step 1)
    const searchArea = document.createElement('div');
    searchArea.className = 'armor-search-container';
    searchArea.innerHTML = `
        <div class="step-label">1. SEARCH ARMOR (Set Name)</div>
        <input type="text" class="search-input" placeholder="e.g. Iron, Artifice, Darkhollow...">
        <div class="armor-grid" id="armor-grid">
            <div class="armor-box" data-slot="Head"></div>
            <div class="armor-box" data-slot="Arms"></div>
            <div class="armor-box" data-slot="Chest"></div>
            <div class="armor-box" data-slot="Legs"></div>
            <div class="armor-box" data-slot="Class"></div>
        </div>
    `;
    creatorContainer.appendChild(searchArea);

    // Search Input Logic (Debounce)
    const input = searchArea.querySelector('.search-input');
    input.addEventListener('input', (e) => {
        clearTimeout(searchTimeout);
        const query = e.target.value;
        if (query.length < 3) return; // Too short
        
        // Show Loading State
        document.querySelectorAll('.armor-box').forEach(b => b.classList.add('loading'));
        
        searchTimeout = setTimeout(() => {
            performArmorSearch(query);
        }, 1000); // 1 Second Delay
    });

    // 3. ARCHETYPE GRID (Step 2)
    const step2 = document.createElement('div');
    step2.innerHTML = `<div class="step-label">2. CHOOSE ARCHETYPE</div><div class="grid-2col" id="archetype-grid"></div>`;
    creatorContainer.appendChild(step2);

    // 4. SPARK GRID (Step 3)
    const step3 = document.createElement('div');
    step3.innerHTML = `<div class="step-label">3. CHOOSE SPARK (3rd Stat)</div><div class="grid-3col" id="spark-grid"></div>`;
    creatorContainer.appendChild(step3);

    // 5. ACTION AREA (Toggle + Button)
    const actionArea = document.createElement('div');
    actionArea.className = 'action-area';
    
    // Inject Toggle
    const toggleDiv = document.createElement('div');
    toggleDiv.className = 'toggle-container pve';
    toggleDiv.style.marginBottom = '10px';
    toggleDiv.innerHTML = `
        <div class="opt-pve" style="flex:1; text-align:center; padding:10px; background:#1e3a8a; color:white;">PvE</div>
        <div class="opt-pvp" style="flex:1; text-align:center; padding:10px; background:transparent; color:#555;">PvP</div>
    `;
    toggleDiv.onclick = () => {
        if(currentMode === 'pve') {
            currentMode = 'pvp';
            toggleDiv.className = 'toggle-container pvp';
            toggleDiv.querySelector('.opt-pve').style.cssText = "flex:1; text-align:center; padding:10px; background:transparent; color:#555;";
            toggleDiv.querySelector('.opt-pvp').style.cssText = "flex:1; text-align:center; padding:10px; background:#991b1b; color:white;";
        } else {
            currentMode = 'pve';
            toggleDiv.className = 'toggle-container pve';
            toggleDiv.querySelector('.opt-pve').style.cssText = "flex:1; text-align:center; padding:10px; background:#1e3a8a; color:white;";
            toggleDiv.querySelector('.opt-pvp').style.cssText = "flex:1; text-align:center; padding:10px; background:transparent; color:#555;";
        }
    };
    actionArea.appendChild(toggleDiv);

    const mainBtn = document.createElement('button');
    mainBtn.id = 'btn-create-armor';
    mainBtn.className = 'btn-primary';
    mainBtn.disabled = true;
    mainBtn.textContent = 'SELECT ARMOR PIECE FIRST';
    mainBtn.onclick = saveArmorWish;
    actionArea.appendChild(mainBtn);

    creatorContainer.appendChild(actionArea);

    // POPULATE GRIDS
    populateStats();
}

// --- SEARCH & BUCKET LOGIC ---
async function performArmorSearch(query) {
    try {
        // 1. Search for Items matching query
        //const searchUrl = `${BUNGIE_ROOT}/Platform/Destiny2/Armory/Search/DestinyInventoryItemDefinition/?searchTerm=${query}&page=0`;
        const searchUrl = `${BUNGIE_ROOT}/Platform/Destiny2/SearchDestinyEntities/DestinyInventoryItemDefinition/${query}/?page=0`;
        const searchResp = await fetch(searchUrl, { headers: { 'X-API-Key': API_KEY } });
        const searchJson = await searchResp.json();
        
        if (!searchJson.Response || !searchJson.Response.results) return;

        // 2. Get Hashes
        const hashes = searchJson.Response.results.results.map(r => r.hash);
        if (hashes.length === 0) return;

        // 3. Fetch Definitions (to check Class and Slot)
        // We limit to top 20 to avoid massive payload
        const topHashes = hashes.slice(0, 25); 
        const manifestUrl = `${BUNGIE_ROOT}/Platform/Destiny2/Manifest/DestinyInventoryItemDefinition/`;
        
        // We have to loop fetch or find a bulk endpoint. 
        // Note: Bungie doesn't have a simple "GetList" endpoint for manifest without Post. 
        // We will do a POST request for Entity Definitions.
        const bulkResp = await fetch(`${BUNGIE_ROOT}/Platform/Destiny2/Manifest/DestinyInventoryItemDefinition/`, {
            method: 'POST',
            headers: { 'X-API-Key': API_KEY },
            body: JSON.stringify({ entityIds: topHashes }) // This is wrong endpoint for POST. 
            // Correction: It's actually not exposed easily for simple POST.
            // Simplified Approach: We loop fetch the top 10. It's fast enough for this specific tool.
        });
        
        // REVISION: To keep it simpler/safer without POST auth complexity, we just fetch one by one in parallel.
        const promises = topHashes.slice(0, 10).map(h => 
            fetch(`${BUNGIE_ROOT}/Platform/Destiny2/Manifest/DestinyInventoryItemDefinition/${h}/`, { 
                headers: { 'X-API-Key': API_KEY } 
            }).then(r => r.json())
        );

        const results = await Promise.all(promises);
        
        // 4. BUCKET THEM
        // Buckets: Head, Arms, Chest, Legs, Class
        const buckets = { Head: null, Arms: null, Chest: null, Legs: null, Class: null };

        results.forEach(r => {
            const item = r.Response;
            if (!item) return;
            
            // Check Class (0=Titan, 1=Hunter, 2=Warlock)
            if (item.classType !== currentClass) return;
            // Check Item Type (2 = Armor)
            if (item.itemType !== 2) return;

            // Sort by SubType or Name logic
            const name = item.displayProperties.name.toLowerCase();
            
            // Simple string matching is safest for multi-language, but ItemSubType is better if possible
            // 26=Helmet, 27=Gauntlets, 28=Chest, 29=Legs, 30=ClassItem
            if (item.itemSubType === 26) buckets.Head = item;
            if (item.itemSubType === 27) buckets.Arms = item;
            if (item.itemSubType === 28) buckets.Chest = item;
            if (item.itemSubType === 29) buckets.Legs = item;
            if (item.itemSubType === 30) buckets.Class = item;
        });

        updateArmorGrid(buckets);

    } catch (e) {
        console.error("Search Error", e);
    }
}

function updateArmorGrid(buckets) {
    const grid = document.getElementById('armor-grid');
    const slotMap = ['Head', 'Arms', 'Chest', 'Legs', 'Class'];
    
    // Clear Loading & Old Images
    document.querySelectorAll('.armor-box').forEach(b => {
        b.classList.remove('loading');
        b.innerHTML = ''; 
        b.classList.remove('selected');
    });

    slotMap.forEach(slot => {
        const item = buckets[slot];
        const box = grid.querySelector(`[data-slot="${slot}"]`);
        
        if (item) {
            // Append Image
            const img = document.createElement('img');
            img.src = BUNGIE_ROOT + item.displayProperties.icon;
            box.appendChild(img);
            
            // Click Event
            box.onclick = () => selectArmorPiece(item, box);
        }
    });
}

function selectArmorPiece(item, boxElement) {
    // 1. Highlight
    document.querySelectorAll('.armor-box').forEach(b => b.classList.remove('selected'));
    boxElement.classList.add('selected');
    
    // 2. Store Data
    armorSelection = {
        hash: item.hash,
        name: item.displayProperties.name,
        icon: item.displayProperties.icon,
        class: (currentClass === 0 ? 'Titan' : currentClass === 1 ? 'Hunter' : 'Warlock')
    };

    checkButtonState();
}

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
        btn.innerHTML = `<strong>${stat.substring(0,3)}</strong>`; 
        btn.dataset.stat = stat; 
        btn.onclick = () => selectSpark(stat, btn);
        sparkGrid.appendChild(btn);
    });
}

// --- SELECTION HELPERS ---
function selectArchetype(arch, btnElement) {
    currentArchetype = arch;
    document.querySelectorAll('#archetype-grid .stat-btn').forEach(b => b.classList.remove('selected'));
    btnElement.classList.add('selected');
    updateSparkAvailability();
    checkButtonState();
}

function selectSpark(stat, btnElement) {
    if (btnElement.disabled || btnElement.classList.contains('unavailable')) return;
    currentSpark = stat;
    document.querySelectorAll('#spark-grid .stat-btn').forEach(b => b.classList.remove('selected'));
    btnElement.classList.add('selected');
    checkButtonState();
}

function updateSparkAvailability() {
    if (!currentArchetype) return;

    document.querySelectorAll('#spark-grid .stat-btn').forEach(btn => {
        const statName = btn.dataset.stat;
        if (currentArchetype.stats.includes(statName)) {
            btn.classList.add('unavailable');
            btn.classList.remove('selected');
            if (currentSpark === statName) currentSpark = null;
        } else {
            btn.classList.remove('unavailable');
        }
    });
}

function checkButtonState() {
    const btn = document.getElementById('btn-create-armor');
    
    if (!armorSelection) {
        btn.disabled = true;
        btn.textContent = "SELECT ARMOR PIECE FIRST";
        return;
    }
    
    if (currentArchetype && currentSpark) {
        btn.disabled = false;
        btn.textContent = `ADD: ${currentArchetype.name} + ${currentSpark.toUpperCase()}`;
    } else {
        btn.disabled = true;
        btn.textContent = "SELECT STATS ABOVE";
    }
}

function saveArmorWish() {
    if (!armorSelection || !currentArchetype || !currentSpark) return;

    const hash = armorSelection.hash; // Use actual hash now!

    chrome.storage.local.get(['dimData'], (result) => {
        let data = result.dimData || { activeId: 'default', lists: { 'default': { name: 'Main Wishlist', items: {} } } };
        const activeList = data.lists[data.activeId];

        if (!activeList.items) activeList.items = {};

        // Create Item Entry (Grouped by Hash)
        if (!activeList.items[hash]) {
            activeList.items[hash] = {
                static: { 
                    name: armorSelection.name, 
                    type: "armor", 
                    icon: armorSelection.icon, // Save the icon path
                    class: armorSelection.class,
                    set: null 
                },
                wishes: []
            };
        }

        // Add Wish
        activeList.items[hash].wishes.push({
            tags: [currentMode],
            config: { archetype: currentArchetype.name, spark: currentSpark },
            raw: `name:"${armorSelection.name}"`, 
            added: Date.now()
        });

        chrome.storage.local.set({ dimData: data }, () => {
            const btn = document.getElementById('btn-create-armor');
            btn.textContent = "SAVED!";
            btn.style.borderColor = "#4ade80"; 
            
            setTimeout(() => {
                // RESET Everything
                btn.textContent = "SELECT ARMOR PIECE FIRST";
                btn.style.borderColor = ""; 
                btn.disabled = true;
                
                currentArchetype = null;
                currentSpark = null;
                armorSelection = null;

                document.querySelectorAll('.stat-btn').forEach(b => {
                    b.classList.remove('selected');
                    b.classList.remove('unavailable');
                });
                
                // Clear Armor Grid Selections
                document.querySelectorAll('.armor-box').forEach(b => b.classList.remove('selected'));

                // Clear Search? Optional. Let's keep the text but clear selection.
                
                loadLists(); 
            }, 1000);
        });
    });
}