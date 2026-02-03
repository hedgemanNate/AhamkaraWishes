// --- CONFIG: ARMOR DATA ---
const ARCHETYPES = [
    { id: 'paragon', name: 'PARAGON', stats: ['Intellect', 'Strength'] },
    { id: 'brawler', name: 'BRAWLER', stats: ['Strength', 'Resilience'] },
    { id: 'gunner',  name: 'GUNNER',  stats: ['Discipline', 'Recovery'] },
    { id: 'special', name: 'SPECIALIST', stats: ['Recovery', 'Discipline'] },
    { id: 'grenadr', name: 'GRENADIER', stats: ['Discipline', 'Intellect'] },
    { id: 'bulwark', name: 'BULWARK',   stats: ['Resilience', 'Recovery'] }
];
const STATS = ['Mobility', 'Resilience', 'Recovery', 'Discipline', 'Intellect', 'Strength'];

// --- STATE ---
let currentArchetype = null;
let currentSpark = null;
let currentMode = 'pve'; // Default

// --- INITIALIZATION ---
document.addEventListener('DOMContentLoaded', () => {
    setupTabs();
    setupArmorUI();
    loadLists(); 
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
        loadLists(); // Refresh list on tab switch
    });

    btnArmor.addEventListener('click', () => {
        btnArmor.classList.add('active');
        btnWeapons.classList.remove('active');
        viewArmor.classList.add('active-view');
        viewWeapons.classList.remove('active-view');
    });
}

// --- VIEWER LOGIC (New Structure) ---
function loadLists() {
    chrome.storage.local.get(['dimData'], (result) => {
        const container = document.getElementById('weapon-list');
        const emptyState = document.getElementById('empty-state');
        container.innerHTML = ''; 

        if (!result.dimData || !result.dimData.lists) {
            emptyState.classList.remove('hidden');
            return;
        } else {
            emptyState.classList.add('hidden');
        }

        const activeList = result.dimData.lists['default'];
        if (!activeList || !activeList.items || Object.keys(activeList.items).length === 0) {
            emptyState.classList.remove('hidden');
            return;
        }

        // Loop through Items (Keys)
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
    
    // Generate Rows for each specific wish (PvP/PvE)
    if (item.wishes && item.wishes.length > 0) {
        item.wishes.forEach((wish, index) => {
            const tag = wish.tags[0] || 'pve';
            const badgeClass = tag === 'pvp' ? 'badge-pvp' : 'badge-pve';
            
            // For weapons, show perks? For now just show "Saved Roll"
            wishesHtml += `
                <div class="roll-row">
                    <div>
                        <span class="badge ${badgeClass}">${tag}</span>
                        <span>Roll #${index + 1}</span>
                    </div>
                    <button class="btn-del" data-hash="${hash}" data-idx="${index}">🗑️</button>
                </div>
            `;
        });
    }

    card.innerHTML = `
        <div class="card-header">
            <span class="card-title">${item.static.name}</span>
            <span class="card-id">${item.static.type.toUpperCase()}</span>
        </div>
        <div class="card-body">
            ${wishesHtml}
        </div>
    `;

    // Add Delete Logic
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
        
        wishes.splice(index, 1); // Remove wish
        
        // If no wishes left, remove item entirely
        if (wishes.length === 0) {
            delete data.lists['default'].items[hash];
        }

        chrome.storage.local.set({ dimData: data }, loadLists);
    });
}

// --- ARMOR UI LOGIC ---
function setupArmorUI() {
    const archGrid = document.getElementById('archetype-grid');
    const sparkGrid = document.getElementById('spark-grid');
    const actionArea = document.querySelector('.action-area');

    // 1. INJECT TOGGLE into Action Area (Before the button)
    const toggleDiv = document.createElement('div');
    toggleDiv.className = 'toggle-container pve';
    toggleDiv.style.marginBottom = '10px';
    toggleDiv.style.justifyContent = 'center';
    toggleDiv.innerHTML = `
        <div class="opt-pve" style="flex:1; text-align:center; padding:10px; background:#1e3a8a; color:white;">PvE</div>
        <div class="opt-pvp" style="flex:1; text-align:center; padding:10px; background:transparent; color:#555;">PvP</div>
    `;
    
    // Toggle Logic
    toggleDiv.addEventListener('click', () => {
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
    });

    actionArea.insertBefore(toggleDiv, document.getElementById('btn-create-armor'));

    // 2. Setup Buttons (Existing Logic)
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

    // 3. Save Logic
    document.getElementById('btn-create-armor').addEventListener('click', saveArmorWish);
}

function saveArmorWish() {
    if (!currentArchetype || !currentSpark) return;

    // Use a placeholder name since we don't have a search bar yet
    const armorName = "Armor Wish"; 
    const hash = "armor_" + Date.now(); // Temp unique ID

    chrome.storage.local.get(['dimData'], (result) => {
        let data = result.dimData || { activeId: 'default', lists: { 'default': { name: 'Main Wishlist', items: {} } } };
        const activeList = data.lists[data.activeId];

        if (!activeList.items) activeList.items = {};

        // Create Item Entry
        activeList.items[hash] = {
            static: { name: armorName, type: "armor", set: null },
            wishes: [{
                tags: [currentMode],
                config: { archetype: currentArchetype.name, spark: currentSpark },
                raw: `name:"${armorName}"`, // Placeholder raw string
                added: Date.now()
            }]
        };

        chrome.storage.local.set({ dimData: data }, () => {
            alert(`Saved ${currentMode.toUpperCase()} Armor Wish!`);
            // Reset UI?
        });
    });
}

// Helpers (Same as before)
function selectArchetype(arch, btnElement) {
    currentArchetype = arch;
    document.querySelectorAll('#archetype-grid .stat-btn').forEach(b => b.classList.remove('selected'));
    btnElement.classList.add('selected');
    updateSparkAvailability();
    checkButtonState();
}

function selectSpark(stat, btnElement) {
    if (btnElement.disabled) return;
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
            btn.disabled = true;
            btn.classList.remove('selected');
            if (currentSpark === statName) currentSpark = null;
        } else {
            btn.disabled = false;
        }
    });
}

function checkButtonState() {
    const btn = document.getElementById('btn-create-armor');
    if (currentArchetype && currentSpark) {
        btn.disabled = false;
        btn.textContent = `ADD: ${currentArchetype.name} + ${currentSpark.toUpperCase()}`;
    } else {
        btn.disabled = true;
        btn.textContent = "SELECT STATS ABOVE";
    }
}