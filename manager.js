// --- IMPORTS ---
// All manifest loading, caching, and searching handled by destiny-manifest.js
// This file uses: ensureInventoryItemDefsReady, ensureEquippableItemSetDefsReady, searchArmorLocally, getArmorSetLookup, BUCKET_HASHES, BUNGIE_ROOT

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
    
    setupTabs();
    
    // Wrap loadLists to hide the overlay when it completes
    const originalLoadLists = loadLists;
    loadLists = function() {
        originalLoadLists();
        // Manifest preflight: download/cache item defs and armor set defs
        Promise.all([
            ensureInventoryItemDefsReady({ force: false }),
            ensureEquippableItemSetDefsReady({ force: false }),
            getArmorSetLookup()
        ]).then(() => {
            // Hide loading overlay once all manifest data is ready (fade animation is 1.3s)
            if (loadingOverlay) {
                loadingOverlay.classList.add('hidden');
            }
        }).catch(err => {
            console.warn("[D2MANIFEST] Preflight failed:", err);
            // Hide overlay even on error
            if (loadingOverlay) {
                loadingOverlay.classList.add('hidden');
            }
        });
    };
    
    loadLists();
});

// --- LIVE UPDATE LISTENER ---
// Triggers whenever data changes (e.g. from Content Script or internal save)
chrome.storage.onChanged.addListener((changes, namespace) => {
    if (namespace === 'local' && changes.dimData) {
        loadLists();
    }
});

// Sidepanel version of saveItem (content.js has its own copy; it is NOT available here)
// Sidepanel version of saveItem (content.js has its own copy; it is NOT available here)
function saveItem(hash, name, type, rawString, keyId, config, mode = "pve", icon = null, classType = null, bucketHash = null, slotName = null, setName = null, setHash = null) {
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

    // Duplicate check (same raw + same mode tag)
    const isDuplicate = existingWishes.some(
      (w) => w?.raw === rawString && (w?.tags || []).includes(mode)
    );
    if (isDuplicate) return;

    // Add new wish
    existingWishes.push({
      tags: [mode],          // ['pve'] or ['pvp']
      config,               // your armor/weapon config
      raw: rawString,       // original string
      added: Date.now()
    });

    chrome.storage.local.set({ dimData: data }, () => {
      loadLists(); // refresh UI
    });
  });
}

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

