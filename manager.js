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
    // Ensure Menu is the default active view on startup
    try {
      const btnMenu = document.getElementById('tab-menu');
      const btnWeapons = document.getElementById('tab-weapons');
      const btnArmor = document.getElementById('tab-armor');
      const viewMenu = document.getElementById('view-menu');
      const viewWeapons = document.getElementById('view-weapons');
      const viewArmor = document.getElementById('view-armor');
      if (btnMenu) btnMenu.classList.add('active');
      if (btnWeapons) btnWeapons.classList.remove('active');
      if (btnArmor) btnArmor.classList.remove('active');
      if (viewMenu) viewMenu.classList.add('active-view');
      if (viewWeapons) viewWeapons.classList.remove('active-view');
      if (viewArmor) viewArmor.classList.remove('active-view');
    } catch (e) {
      console.warn('[MANAGER] Unable to set default Menu view', e);
    }
    
    // Load manifest data ONCE at startup
    Promise.all([
        ensureInventoryItemDefsReady({ force: false }),
        ensureEquippableItemSetDefsReady({ force: false }),
        getArmorSetLookup()
    ]).then(() => {
        // Hide loading overlay once all manifest data is ready (fade animation is 1.3s)
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
});

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

function setupTabs() {
    const btnWeapons = document.getElementById('tab-weapons');
    const btnArmor = document.getElementById('tab-armor');
  const btnMenu = document.getElementById('tab-menu');
    const viewWeapons = document.getElementById('view-weapons');
    const viewArmor = document.getElementById('view-armor');
  const viewMenu = document.getElementById('view-menu');

    btnWeapons.addEventListener('click', () => {
        btnWeapons.classList.add('active');
        btnArmor.classList.remove('active');
      if (btnMenu) btnMenu.classList.remove('active');
        viewWeapons.classList.add('active-view');
        viewArmor.classList.remove('active-view');
      if (viewMenu) viewMenu.classList.remove('active-view');
        loadLists();
    });

    btnArmor.addEventListener('click', () => {
        btnArmor.classList.add('active');
        btnWeapons.classList.remove('active');
        if (btnMenu) btnMenu.classList.remove('active');
        viewArmor.classList.add('active-view');
        viewWeapons.classList.remove('active-view');
        if (viewMenu) viewMenu.classList.remove('active-view');
    });

    if (btnMenu) {
      btnMenu.addEventListener('click', () => {
        btnMenu.classList.add('active');
        btnWeapons.classList.remove('active');
        btnArmor.classList.remove('active');
        if (viewWeapons) viewWeapons.classList.remove('active-view');
        if (viewArmor) viewArmor.classList.remove('active-view');
        if (viewMenu) viewMenu.classList.add('active-view');
      });
    }
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

/**
 * Refresh profile via Bungie API and build the OwnedIndex.
 * - Attempts to locate a Destiny membership from stored `bungie_auth.user`.
 * - Calls `bungieAuth.fetchProfileWithComponents` and persists the response.
 * - Builds the OwnedIndex via `OwnedInventoryIndex.buildOwnedIndex` and runs a wishlist match pass.
 *
 * @param {string|Array<number|string>} components - components param to pass to GetProfile (comma-separated or array)
 */
async function refreshProfileAndBuildIndex(components) {
  try {
    const s = await new Promise((res) => chrome.storage.local.get(['bungie_auth', 'dimData'], res));
    const auth = s?.bungie_auth;
    if (!auth || !auth.access_token) { console.warn('[Manager] No bungie_auth available. Please sign in.'); return; }

    // Ensure we have a user object with memberships
    let user = auth.user || null;
    if (!user) {
      try { user = await fetchBungieUser(auth.access_token); auth.user = user; await new Promise((res) => chrome.storage.local.set({ bungie_auth: auth }, res)); } catch (e) { /* ignore */ }
    }

    // Try common membership locations
    const memberships = (user && (user.destinyMemberships || user.profiles || user.Response?.destinyMemberships)) || [];
    if (!memberships || memberships.length === 0) { console.warn('[Manager] No destiny memberships found on user object'); return; }
    const primary = memberships[0];
    const membershipType = primary.membershipType ?? primary.membership_type ?? primary.membershipTypeValue;
    const membershipId = primary.membershipId ?? primary.membership_id ?? primary.profileId ?? primary.membershipId;
    if (membershipType === undefined || !membershipId) { console.warn('[Manager] Could not determine membershipType/membershipId'); return; }

    console.log('[Manager] fetching profile for', membershipType, membershipId, 'components:', components);
    const profile = await window.bungieAuth.fetchProfileWithComponents(membershipType, membershipId, components);
    if (!profile) { console.warn('[Manager] fetchProfile returned no data'); return; }

    // Build owned index
    if (!window.OwnedInventoryIndex || !window.OwnedInventoryIndex.buildOwnedIndex) {
      console.warn('[Manager] OwnedInventoryIndex not available');
      return;
    }
    const idx = window.OwnedInventoryIndex.buildOwnedIndex(profile);
    // Optionally persist a small summary
    const totalInstances = idx.byInstanceId ? idx.byInstanceId.size : 0;
    const uniqueItems = idx.byItemHash ? idx.byItemHash.size : 0;
    await new Promise((res) => chrome.storage.local.set({ ownedIndexSummary: { totalInstances, uniqueItems, fetchedAt: Date.now() } }, res));
    console.log('[Manager] OwnedIndex built:', totalInstances, 'instances,', uniqueItems, 'unique item hashes');

    // Run wishlist matching pass using the built index
    const dimRes = await new Promise((res) => chrome.storage.local.get(['dimData'], res));
    const dimData = s?.dimData || dimRes?.dimData;
    if (dimData && window.OwnedInventoryIndex.matchWishlist) {
      try {
        const summary = window.OwnedInventoryIndex.matchWishlist(dimData, idx);
        await new Promise((res) => chrome.storage.local.set({ dimData }, res));
        console.log('[Manager] Wishlist matching complete:', summary);
      } catch (e) { console.warn('[Manager] matchWishlist failed', e); }
    }
  } catch (e) {
    console.error('[Manager] refreshProfileAndBuildIndex failed', e);
  }
}

// Expose to console for manual triggering
window.appManager = window.appManager || {};
window.appManager.refreshProfileAndBuildIndex = refreshProfileAndBuildIndex;

