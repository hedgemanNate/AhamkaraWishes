// --- IMPORTS ---
// All manifest loading, caching, and searching handled by destiny-manifest.js
// This file uses: ensureInventoryItemDefsReady, ensureEquippableItemSetDefsReady, searchArmorLocally, getArmorSetLookup, buildNameIndexIfNeeded, ensureWatermarkLookupReady, BUCKET_HASHES, BUNGIE_ROOT

// --- CONFIGURATION ---

const ARCHETYPES = [
    { id: 'siege',     name: 'SIEGEBREAKER',  stats: ['Health', 'Grenade'] },
    { id: 'grenadr',   name: 'GRENADIER',     stats: ['Grenade', 'Super'] },
    { id: 'colossus',  name: 'COLOSSUS',      stats: ['Super', 'Health'] },
    { id: 'brawler',   name: 'BRAWLER',       stats: ['Melee', 'Health'] },
    { id: 'paragon',   name: 'PARAGON',       stats: ['Super', 'Melee'] },
    { id: 'powerhs',   name: 'POWERHOUSE',    stats: ['Weapons', 'Super'] },
    { id: 'skirmsh',   name: 'SKIRMISHER',    stats: ['Melee', 'Weapons'] },
    { id: 'reaver',    name: 'REAVER',        stats: ['Class', 'Melee'] },
    { id: 'special',   name: 'SPECIALIST',    stats: ['Class', 'Weapons'] },
    { id: 'gunner',    name: 'GUNNER',        stats: ['Weapons', 'Grenade'] },
    { id: 'demo',      name: 'DEMOLITIONIST', stats: ['Grenade', 'Class'] },
    { id: 'bulwark',   name: 'BULWARK',       stats: ['Health', 'Class'] }
];

// 'Weapons' replaces 'Mobility' in the Renegades expansion meta.
const STATS = ['Weapons', 'Health', 'Class', 'Grenade', 'Super', 'Melee'];


// --- INITIALIZATION ---
// Reflects the last built OwnedIndex summary in the Menu > Utility section.
function renderOwnedIndexSummary(summary) {
    const el = document.getElementById('owned-index-summary');
    if (!el) return;
    if (!summary || typeof summary.totalInstances !== 'number') {
        el.textContent = 'No inventory data yet.';
        return;
    }
    const when = summary.fetchedAt ? new Date(summary.fetchedAt).toLocaleTimeString() : '';
    el.textContent = when ? `Synced ${when}` : 'Synced';
}

// --- FEED (newly-obtained wishlist rolls) ---
const FEED_MAX_ENTRIES = 20;
const FEED_INTERVAL_MS = 60 * 1000; // 1 minute, only while Feed is toggled on

let _feedEnabled = false;

// Snapshots which (list, item, wish) triples are currently `received: true`,
// taken right before a matchWishlist() pass so we can tell what NEWLY flipped
// to true after the pass — i.e. what the user just obtained.
function snapshotReceivedState(dimData) {
    const map = new Map();
    if (!dimData || !dimData.lists) return map;
    for (const listId of Object.keys(dimData.lists)) {
        const list = dimData.lists[listId];
        if (!list || !list.items) continue;
        for (const itemHash of Object.keys(list.items)) {
            const item = list.items[itemHash];
            if (!item || !Array.isArray(item.wishes)) continue;
            item.wishes.forEach((wish, idx) => {
                map.set(`${listId}|${itemHash}|${idx}`, !!wish.received);
            });
        }
    }
    return map;
}

// Compares a pre-match snapshot against the just-updated dimData and returns
// feed entries for every wish that went from not-received to received.
function diffFeedEntries(beforeMap, dimData) {
    const newEntries = [];
    if (!dimData || !dimData.lists) return newEntries;
    for (const listId of Object.keys(dimData.lists)) {
        const list = dimData.lists[listId];
        if (!list || !list.items) continue;
        for (const itemHash of Object.keys(list.items)) {
            const item = list.items[itemHash];
            if (!item || !Array.isArray(item.wishes)) continue;
            item.wishes.forEach((wish, idx) => {
                const key = `${listId}|${itemHash}|${idx}`;
                const wasReceived = beforeMap.get(key) || false;
                if (!wasReceived && wish.received) {
                    newEntries.push({
                        itemName: item.static?.name || 'Unknown Item',
                        iconUrl: item.static?.icon || '',
                        listName: list.name || listId,
                        timestamp: Date.now()
                    });
                }
            });
        }
    }
    return newEntries;
}

// Locks every item instance that newly matched a wishlist wish since beforeSnapshot.
// Reads activeMembership from chrome.storage for the API call; silently skips if
// membership info is missing (e.g. not signed in) or if a lock call fails.
async function autoLockNewlyMatched(beforeSnapshot, dimData, ownedIndex) {
    if (!beforeSnapshot || !dimData?.lists || !ownedIndex) return;

    const newInstanceIds = new Set();
    for (const listId of Object.keys(dimData.lists)) {
        const list = dimData.lists[listId];
        if (!list?.items) continue;
        for (const itemHash of Object.keys(list.items)) {
            const item = list.items[itemHash];
            if (!Array.isArray(item?.wishes)) continue;
            item.wishes.forEach((wish, idx) => {
                const key = `${listId}|${itemHash}|${idx}`;
                if (!beforeSnapshot.get(key) && wish.received) {
                    (wish.receivedInstances || []).forEach(iid => newInstanceIds.add(iid));
                }
            });
        }
    }
    if (newInstanceIds.size === 0) return;

    const res = await new Promise(r => chrome.storage.local.get(['activeMembership'], r));
    const mem = res?.activeMembership;
    if (!mem?.membershipType || !mem?.membershipId || !mem?.characterIds?.length) {
        console.warn('[AutoLock] No membership info cached; skipping auto-lock');
        return;
    }
    const { membershipType, membershipId, characterIds } = mem;
    const fallbackCharId = characterIds[0];

    for (const iid of newInstanceIds) {
        const owned = ownedIndex.byInstanceId?.get(String(iid));
        const characterId = owned?.characterId || fallbackCharId;
        try {
            await window.bungieAuth.setItemLockState(iid, characterId, membershipType, membershipId, true);
            console.log('[AutoLock] Locked', iid);
        } catch (e) {
            console.warn('[AutoLock] Failed to lock', iid, e.message);
        }
    }
}

async function transferNewlyMatchedToVault(beforeSnapshot, dimData, ownedIndex) {
    if (!beforeSnapshot || !dimData?.lists || !ownedIndex) return;

    const newInstanceIds = new Set();
    for (const listId of Object.keys(dimData.lists)) {
        const list = dimData.lists[listId];
        if (!list?.items) continue;
        for (const itemHash of Object.keys(list.items)) {
            const item = list.items[itemHash];
            if (!Array.isArray(item?.wishes)) continue;
            item.wishes.forEach((wish, idx) => {
                const key = `${listId}|${itemHash}|${idx}`;
                if (!beforeSnapshot.get(key) && wish.received) {
                    (wish.receivedInstances || []).forEach(iid => newInstanceIds.add(iid));
                }
            });
        }
    }
    if (newInstanceIds.size === 0) return;

    const res = await new Promise(r => chrome.storage.local.get(['activeMembership'], r));
    const mem = res?.activeMembership;
    if (!mem?.membershipType || !mem?.membershipId || !mem?.characterIds?.length) {
        console.warn('[VaultTransfer] No membership info cached; skipping vault transfer');
        return;
    }

    const { membershipType, membershipId, characterIds } = mem;
    const fallbackCharId = characterIds[0];

    for (const iid of newInstanceIds) {
        const owned = ownedIndex.byInstanceId?.get(String(iid));
        if (!owned) continue;
        // No characterId means it's already sitting in the vault (see
        // buildOwnedIndex, which only assigns characterId for items on a
        // character's inventory/equipment) — nothing to transfer.
        if (!owned.characterId) {
            console.log('[VaultTransfer] Already in vault, skipping', iid);
            continue;
        }
        const characterId = owned.characterId || fallbackCharId;
        try {
            await window.bungieAuth.transferItemToVault(iid, owned.itemHash, characterId, membershipType, membershipId);
            console.log('[VaultTransfer] Sent to vault', iid);
        } catch (e) {
            console.warn('[VaultTransfer] Failed to transfer', iid, e.message);
        }
    }
}

async function appendFeedEntries(newEntries) {
    if (!newEntries || newEntries.length === 0) return;
    const res = await new Promise((r) => chrome.storage.local.get(['feedEntries'], r));
    let entries = Array.isArray(res?.feedEntries) ? res.feedEntries : [];
    entries = entries.concat(newEntries);
    if (entries.length > FEED_MAX_ENTRIES) entries = entries.slice(entries.length - FEED_MAX_ENTRIES);
    await new Promise((r) => chrome.storage.local.set({ feedEntries: entries }, r));
    renderFeedList(entries);
}

function formatFeedTime(ts) {
    const diff = Date.now() - ts;
    if (diff < 60_000) return 'Just now';
    if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
    if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
    return new Date(ts).toLocaleDateString();
}

function renderFeedList(entries) {
    const listEl = document.getElementById('feed-list');
    const emptyEl = document.getElementById('feed-empty');
    const clearBtn = document.getElementById('feed-clear-btn');
    if (!listEl) return;
    if (!entries || entries.length === 0) {
        listEl.innerHTML = '';
        if (emptyEl) emptyEl.classList.remove('hidden');
        if (clearBtn) clearBtn.classList.add('hidden');
        return;
    }
    if (emptyEl) emptyEl.classList.add('hidden');
    if (clearBtn) clearBtn.classList.remove('hidden');
    // Displayed newest-first, but the delete button carries the entry's index
    // in the underlying (oldest-first) stored array, so removeFeedEntry can
    // splice the right one regardless of display order.
    listEl.innerHTML = entries.slice().reverse().map((e, displayIdx) => {
        const storedIndex = entries.length - 1 - displayIdx;
        return `
        <div class="mt-feed-item">
            <img class="mt-feed-icon" src="${escapeHtml(AWDom.safeImageUrl(e.iconUrl) || 'icons/unnamed.jpg')}" alt="">
            <div class="mt-feed-text">
                <span class="mt-feed-name">${escapeHtml(e.itemName)}</span>
                <span class="mt-feed-list-name">${escapeHtml(e.listName)}</span>
            </div>
            <span class="mt-feed-time">${formatFeedTime(e.timestamp)}</span>
            <button class="mt-feed-del-btn" data-feed-index="${storedIndex}" title="Remove this entry" aria-label="Remove this entry">&#x2715;</button>
        </div>
    `;
    }).join('');
}

async function removeFeedEntry(index) {
    const res = await new Promise((r) => chrome.storage.local.get(['feedEntries'], r));
    const entries = Array.isArray(res?.feedEntries) ? res.feedEntries : [];
    if (index < 0 || index >= entries.length) return;
    entries.splice(index, 1);
    await new Promise((r) => chrome.storage.local.set({ feedEntries: entries }, r));
    renderFeedList(entries);
}

async function clearAllFeedEntries() {
    if (!confirm('Clear the entire Feed? This cannot be undone.')) return;
    await new Promise((r) => chrome.storage.local.set({ feedEntries: [] }, r));
    renderFeedList([]);
}

function wireFeedListActions() {
    const listEl = document.getElementById('feed-list');
    if (listEl) {
        listEl.addEventListener('click', (e) => {
            const btn = e.target.closest('.mt-feed-del-btn');
            if (!btn) return;
            removeFeedEntry(Number(btn.dataset.feedIndex));
        });
    }
    const clearBtn = document.getElementById('feed-clear-btn');
    if (clearBtn) clearBtn.addEventListener('click', clearAllFeedEntries);
}

function renderFeedToggleUI() {
    document.body.classList.toggle('feed-on', _feedEnabled);
    const btn = document.getElementById('feed-toggle-btn');
    if (!btn) return;
    const label = btn.querySelector('.btn-text') || btn;
    label.textContent = _feedEnabled ? 'Turn Off Feed' : 'Turn On Feed';
    btn.classList.toggle('active', _feedEnabled);
    btn.setAttribute('aria-pressed', _feedEnabled ? 'true' : 'false');
}

async function loadFeedState() {
    const res = await new Promise((r) => chrome.storage.local.get(['feedEnabled', 'feedEntries'], r));
    _feedEnabled = !!res?.feedEnabled;
    renderFeedToggleUI();
    renderFeedList(res?.feedEntries || []);
}

function wireFeedToggle() {
    const btn = document.getElementById('feed-toggle-btn');
    if (!btn) return;
    btn.addEventListener('click', async () => {
        _feedEnabled = !_feedEnabled;
        await new Promise((r) => chrome.storage.local.set({ feedEnabled: _feedEnabled }, r));
        renderFeedToggleUI();
        // Re-pace the sync loop: while the panel is hidden, Feed polls every
        // minute instead of every 5
        startAutoRefresh();
    });
}

// --- SECTION INFO POPUPS ---
const MENU_SECTION_INFO = {
    wishlists: {
        title: 'Wishlists',
        body: [
            "Type a name and hit Create to start a new wishlist. Each wishlist is its own separate collection, so you can keep something like \"PvE Rolls\" and \"PvP Rolls\" totally apart from each other.",
            "Tap any wishlist pill below to switch to it. Whichever one is highlighted gold is the one currently active, meaning that's where new wishes get saved when you craft a weapon or armor piece.",
            "Duplicate makes a copy of the wishlist you're currently on, in case you want to branch off and try different combos without losing the original. Merge lets you fold other wishlists into the one you're on right now. Delete removes the active wishlist for good, so double check before you tap it."
        ]
    },
    feed: {
        title: 'Feed',
        body: [
            "Turn this on and the app will check your inventory every minute instead of the usual five. When something from one of your wishlists actually drops for you, it shows up right here with the item's name and which wishlist it matched.",
            "This is meant for active grinding sessions, like farming a raid or a lost sector for a specific roll. Since it checks so often, it's best to switch it back off when you're done for the day so you're not syncing more than you need to.",
            "Entries stick around here even after you turn Feed off, so you can always look back and see what you picked up."
        ]
    },
    utility: {
        title: 'Utility',
        body: [
            "This section pulls real data straight from your Bungie account. Hit Refresh anytime you want to force an update instead of waiting for the next scheduled sync. The timestamp next to it tells you how recent your data actually is.",
            "Use the search bar to look up anything in your owned inventory by name, or tap the slot chips to just browse everything in a slot without typing. Tap any result to expand it and see the actual rolled perks on every copy you own.",
            "Rolls that already satisfy one of your saved wishes get a green check with the wishlist's name on them, and those items float to the top of the results. It's a quick way to spot that you're already holding the roll you've been chasing."
        ]
    }
};

function showMenuSectionInfo(key) {
    const info = MENU_SECTION_INFO[key];
    if (!info) return;
    const existing = document.getElementById('mt-info-overlay');
    if (existing) existing.remove();

    const overlay = document.createElement('div');
    overlay.id = 'mt-info-overlay';
    overlay.className = 'mt-info-overlay';
    overlay.innerHTML = `
        <div class="mt-info-dialog" role="dialog" aria-modal="true">
            <div class="mt-info-title">${escapeHtml(info.title)}</div>
            <div class="mt-info-body">
                ${info.body.map((p) => `<p>${escapeHtml(p)}</p>`).join('')}
            </div>
            <button class="mt-info-close">Got it</button>
        </div>
    `;
    document.body.appendChild(overlay);

    const close = () => overlay.remove();
    overlay.querySelector('.mt-info-close').addEventListener('click', close);
    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) close();
    });
    document.addEventListener('keydown', function escHandler(e) {
        if (e.key === 'Escape') {
            close();
            document.removeEventListener('keydown', escHandler);
        }
    });
}

function wireMenuSectionInfo() {
    document.querySelectorAll('.mt-info-icon[data-info]').forEach((btn) => {
        btn.addEventListener('click', () => showMenuSectionInfo(btn.dataset.info));
    });
}

document.addEventListener('DOMContentLoaded', async () => {
    const loadingOverlay = document.getElementById('loading-overlay');

    setupTabs();
    initWeaponListSearch();
    wireFeedToggle();
    wireFeedListActions();
    wireMenuSectionInfo();
    await loadFeedState();
    chrome.storage.local.get(['ownedIndexSummary'], (res) => renderOwnedIndexSummary(res?.ownedIndexSummary));
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
        // Pre-warm weapon search indexes so the first search is instant
        buildNameIndexIfNeeded();
        ensureWatermarkLookupReady();
        // Hide loading overlay once all manifest data is ready (fade animation is 1.3s)
        if (loadingOverlay) {
            loadingOverlay.classList.add('hidden');
        }
        // Now load and display the wishlist UI
        loadLists();
        backfillArmorSets();
        // Attempt a background OwnedIndex update from any cached Bungie profile
        try {
          chrome.storage.local.get(['lastBungieProfile'], async (res) => {
            const lastProfile = res?.lastBungieProfile;
            // The live sync started on load may already have landed (or be
            // building) — a stale cached snapshot must not overwrite it.
            if (_lastProfileMintedAt || _syncInFlight) return;
            if (lastProfile && window.OwnedInventoryIndex && window.OwnedInventoryIndex.updateFromProfile) {
              try {
                const idx = await window.OwnedInventoryIndex.updateFromProfile(lastProfile);
                if (_lastProfileMintedAt) return;
                // A live fetch returning this same snapshot then has nothing to redo.
                _lastProfileMintedAt = Date.parse(lastProfile.responseMintedTimestamp) || 0;
                const totalInstances = idx.byInstanceId ? idx.byInstanceId.size : 0;
                const uniqueItems = idx.byItemHash ? idx.byItemHash.size : 0;
                const ownedIndexSummary = { totalInstances, uniqueItems, fetchedAt: Date.now() };
                await new Promise((r) => chrome.storage.local.set({ ownedIndexSummary }, r));
                renderOwnedIndexSummary(ownedIndexSummary);
                // Run lightweight wishlist sync with updated index. The wishlist is
                // read inside matchWishlistPass, after the index build above, so
                // a wish saved while the index was building isn't overwritten.
                if (window.OwnedInventoryIndex.matchWishlist) {
                  try {
                    const pass = await matchWishlistPass(idx, { backfill: true });
                    if (pass) {
                      await autoLockNewlyMatched(pass.beforeSnapshot, pass.dimData, idx);
                      await transferNewlyMatchedToVault(pass.beforeSnapshot, pass.dimData, idx);
                      if (_feedEnabled) await appendFeedEntries(diffFeedEntries(pass.beforeSnapshot, pass.dimData));
                    }
                    console.log('[Manager] Background OwnedIndex update & wishlist sync complete');
                  } catch (e) { console.warn('[Manager] background matchWishlist failed', e); }
                }
              } catch (e) { console.warn('[Manager] updateFromProfile background update failed', e); }
            }
          });
        } catch (e) { /* ignore */ }
    }).catch(err => {
        console.warn("[D2MANIFEST] Preflight failed:", err);
        // Hide overlay even on error
        if (loadingOverlay) {
            loadingOverlay.classList.add('hidden');
        }
        // Try to load UI anyway
        loadLists();
    });

    // Wire utility button for manual profile refresh
    try {
      const utilBtn = document.getElementById('utility-refresh-profile');
      if (utilBtn) {
        utilBtn.addEventListener('click', async () => {
          const labelEl = utilBtn.querySelector('.btn-text') || utilBtn;
          try {
            utilBtn.disabled = true;
            const prev = labelEl.textContent;
            labelEl.textContent = 'Refreshing…';
            const err = await runSync(true);
            if (err) throw err;
            labelEl.textContent = 'Done';
            setTimeout(() => { labelEl.textContent = prev; }, 2000);
          } catch (e) {
            console.error('[Manager] utility refresh failed', e);
            labelEl.textContent = 'Failed';
            const summaryEl = document.getElementById('owned-index-summary');
            if (summaryEl) summaryEl.textContent = 'Error: ' + (e?.message || String(e));
            setTimeout(() => { labelEl.textContent = 'Refresh'; }, 2500);
          } finally {
            utilBtn.disabled = false;
          }
        });
      }
    } catch (e) { /* no-op */ }

    // Wire inventory search (Utility section) — verifies the OwnedIndex actually
    // reflects the signed-in account's real items.
    try {
      const invInput = document.getElementById('inventory-search-input');
      if (invInput) {
        let debounce = null;
        invInput.addEventListener('input', (e) => {
          clearTimeout(debounce);
          const q = e.target.value;
          debounce = setTimeout(() => renderInventorySearch(q), 250);
        });
      }
      renderInventoryFilterChips();
    } catch (e) { /* no-op */ }

    startAutoRefresh();
});

// --- INVENTORY SEARCH (Menu > Utility) ---

// Slot chips, so the section can be browsed without typing a name at all.
// The three weapon buckets are inlined because BUCKET_HASHES only covers
// armor — armor search never needed the weapon ones.
const INVENTORY_SLOT_FILTERS = [
    { key: 'kinetic', label: 'Kinetic', bucket: 1498876634 },
    { key: 'energy',  label: 'Energy',  bucket: 2465295065 },
    { key: 'power',   label: 'Power',   bucket: 953998645 },
    { key: 'helmet',  label: 'Helmet',  bucket: BUCKET_HASHES.HELMET },
    { key: 'arms',    label: 'Arms',    bucket: BUCKET_HASHES.GAUNTLETS },
    { key: 'chest',   label: 'Chest',   bucket: BUCKET_HASHES.CHEST },
    { key: 'legs',    label: 'Legs',    bucket: BUCKET_HASHES.LEGS },
    { key: 'class',   label: 'Class',   bucket: BUCKET_HASHES.CLASS_ITEM }
];

// Bucket-based armor detection: an owned instance carries no category info of
// its own, and itemType alone doesn't separate armor from ornaments/mods.
const ARMOR_BUCKET_HASHES = new Set(Object.values(BUCKET_HASHES));

const inventorySlotFilters = new Set();
let inventorySearchQuery = '';

const INVENTORY_RESULT_CAP = 50;

function renderInventoryFilterChips() {
    const container = document.getElementById('inventory-filter-chips');
    if (!container) return;
    container.innerHTML = '';

    INVENTORY_SLOT_FILTERS.forEach(({ key, label }) => {
        const btn = document.createElement('button');
        btn.className = `filter-btn inv-chip${inventorySlotFilters.has(key) ? ' selected' : ''}`;
        btn.dataset.invslot = key;
        btn.textContent = label;
        btn.addEventListener('click', () => {
            if (inventorySlotFilters.has(key)) inventorySlotFilters.delete(key);
            else inventorySlotFilters.add(key);
            btn.classList.toggle('selected', inventorySlotFilters.has(key));
            renderInventorySearch(inventorySearchQuery);
        });
        container.appendChild(btn);
    });
}

/**
 * Reverse view of the wishlist match pass: instanceId -> the wishes this exact
 * owned roll satisfies. Reads receivedInstances, already computed by
 * OwnedInventoryIndex.matchWishlist, so no matching logic is duplicated here.
 */
function buildOwnedMatchLookup(dimData) {
    const map = new Map();
    for (const list of Object.values(dimData?.lists || {})) {
        for (const item of Object.values(list?.items || {})) {
            for (const wish of (item?.wishes || [])) {
                for (const iid of (wish?.receivedInstances || [])) {
                    const key = String(iid);
                    if (!map.has(key)) map.set(key, []);
                    map.get(key).push({
                        listName: list?.name || 'Wishlist',
                        mode: (wish?.tags && wish.tags[0]) || 'pve'
                    });
                }
            }
        }
    }
    return map;
}

// Searches the built OwnedIndex (real Bungie inventory) by name and/or slot,
// showing each owned roll's actual perks and calling out which of them already
// satisfy a saved wish.
async function renderInventorySearch(query) {
    const resultsEl = document.getElementById('inventory-search-results');
    if (!resultsEl) return;

    inventorySearchQuery = String(query || '');
    const q = inventorySearchQuery.trim().toLowerCase();
    const activeBuckets = new Set(
        INVENTORY_SLOT_FILTERS.filter((f) => inventorySlotFilters.has(f.key)).map((f) => f.bucket)
    );

    // Slot chips alone are enough to browse; a name query still needs 2+ chars
    // so a single keystroke doesn't scan the whole inventory.
    if (q.length < 2 && activeBuckets.size === 0) { resultsEl.innerHTML = ''; return; }

    const idx = window.OwnedInventoryIndex && window.OwnedInventoryIndex.getCachedIndex && window.OwnedInventoryIndex.getCachedIndex();
    if (!idx || !idx.byItemHash || idx.byItemHash.size === 0) {
        resultsEl.innerHTML = '<div class="empty-list-text">No inventory data yet. Hit Refresh above to sync.</div>';
        return;
    }

    const defs = await loadInventoryItemDefsToMemory();
    const stored = await new Promise((r) => chrome.storage.local.get(['dimData'], r));
    const matchLookup = buildOwnedMatchLookup(stored?.dimData);

    const matches = [];
    for (const [itemHash, instanceIds] of idx.byItemHash.entries()) {
        const def = defs.get(String(itemHash));
        const name = def?.displayProperties?.name || '';
        if (!name) continue;
        if (q.length >= 2 && !name.toLowerCase().includes(q)) continue;
        if (activeBuckets.size > 0 && !activeBuckets.has(def?.inventory?.bucketTypeHash)) continue;

        // Weapon instances carry every socket (barrel/mag/traits, but also the
        // weapon mod, shader, ornament, tracker sockets) with no category info
        // of their own — restrict to the real perk columns the craft/list pages
        // already show, same as getWeaponPerkColumns. Armor has no equivalent
        // "perks category" in this app, so its sockets are left unfiltered.
        const bucketHash = def?.inventory?.bucketTypeHash ?? null;
        const isWeapon = def?.itemType === 3;
        const perkSocketIndexes = isWeapon ? getWeaponPerkSocketIndexes(def) : null;

        // Resolve each owned instance's rolled perks, grouped by socket column
        // so multi-perk slots show every possible roll, not just the active one.
        // socketIndex/activeHash ride along so a double-click can rebuild this
        // exact roll on the craft page (see startWishFromOwnedRoll).
        const instances = Array.from(instanceIds).map((iid) => {
            const owned = idx.byInstanceId.get(iid);
            const allSockets = Array.isArray(owned?.perkSockets) ? owned.perkSockets : [];
            const perkSockets = perkSocketIndexes
                ? allSockets.filter((s) => perkSocketIndexes.has(s.socketIndex))
                : allSockets;
            const columns = perkSockets
                .map((socket) => ({
                    socketIndex: socket.socketIndex,
                    activeHash: socket.activeHash,
                    perks: socket.options
                        .map((h) => {
                            const pd = defs.get(String(h));
                            if (!pd || !pd.displayProperties?.name || pd.itemType !== 19) return null; // itemType 19 = Plug (perks/mods)
                            return {
                                hash: h,
                                name: pd.displayProperties.name,
                                icon: pd.displayProperties.icon ? `${BUNGIE_ROOT}${pd.displayProperties.icon}` : '',
                                isActive: h === socket.activeHash
                            };
                        })
                        .filter(Boolean)
                }))
                // Drop trinket columns (Kill Tracker etc.) — every option in them
                // matches WEAPON_TRACKER_PLUG_NAME_PATTERN, same skip rule
                // getWeaponPerkColumns applies on the craft page.
                .filter((c) => c.perks.length > 0 && !c.perks.every((p) => WEAPON_TRACKER_PLUG_NAME_PATTERN.test(p.name)));
            return {
                instanceId: iid,
                columns,
                isCrafted: !!owned?.isCrafted,
                wishMatches: matchLookup.get(String(iid)) || [],
                // Pre-computed by owned-inventory-index.js from the piece's true
                // base stat roll — lets the armor craft page open on the real
                // archetype/Tertiary instead of a guess.
                armorArchetype: owned?.armorArchetype || null,
                armorTertiary: owned?.armorTertiary || null
            };
        });

        matches.push({
            hash: itemHash,
            name,
            subtitle: def?.itemTypeDisplayName || '',
            icon: def?.displayProperties?.icon ? `${BUNGIE_ROOT}${def.displayProperties.icon}` : '',
            isWeapon,
            isArmor: ARMOR_BUCKET_HASHES.has(bucketHash),
            classType: def?.classType ?? null,
            setHash: def?.equippingBlock?.equipableItemSetHash ?? null,
            bucketHash,
            instances,
            matchCount: instances.filter((i) => i.wishMatches.length > 0).length
        });
        if (matches.length >= INVENTORY_RESULT_CAP) break;
    }

    // Wishlist-matching items first — the whole point of the callout is to make
    // "I already own the roll I wanted" impossible to scroll past.
    matches.sort((a, b) => {
        if ((b.matchCount > 0) !== (a.matchCount > 0)) return b.matchCount - a.matchCount;
        return a.name.localeCompare(b.name, 'en', { sensitivity: 'base' });
    });

    if (matches.length === 0) {
        resultsEl.innerHTML = '<div class="empty-list-text">No matching items found in your inventory.</div>';
        return;
    }

    resultsEl.innerHTML = '';
    matches.forEach((m) => resultsEl.appendChild(createInventoryCard(m)));
}

// Mirrors createWeaponCard's markup so owned rolls read the same as wishlist
// rolls — including the .wc-perk-icon-wrap[data-name] hover tooltips.
function createInventoryCard(m) {
    const card = document.createElement('div');
    card.className = 'wc-card inv-card';

    const header = document.createElement('div');
    header.className = 'wc-header inv-card-header';

    if (m.icon) {
        const img = document.createElement('img');
        img.className = 'wc-icon';
        img.src = m.icon;
        img.alt = '';
        header.appendChild(img);
    } else {
        const ph = document.createElement('div');
        ph.className = 'wc-icon wc-icon-placeholder';
        header.appendChild(ph);
    }

    const info = document.createElement('div');
    info.className = 'wc-header-info';
    const nameEl = document.createElement('div');
    nameEl.className = 'wc-name';
    nameEl.textContent = m.name;
    info.appendChild(nameEl);
    const subEl = document.createElement('div');
    subEl.className = 'wc-roll-count';
    subEl.textContent = [m.subtitle, `${m.instances.length} OWNED`].filter(Boolean).join(' · ');
    info.appendChild(subEl);
    header.appendChild(info);

    if (m.matchCount > 0) {
        const badge = document.createElement('span');
        badge.className = 'wc-badge wc-badge-owned';
        badge.textContent = `★ ${m.matchCount}`;
        badge.title = `${m.matchCount} owned roll${m.matchCount !== 1 ? 's' : ''} match a saved wish`;
        header.appendChild(badge);
    }

    const caret = document.createElement('span');
    caret.className = 'inv-caret';
    caret.textContent = '▾';
    header.appendChild(caret);

    const rolls = document.createElement('div');
    rolls.className = 'wc-rolls inv-rolls';

    m.instances.forEach((inst, i) => {
        const row = document.createElement('div');
        row.className = `wc-roll-row${inst.wishMatches.length ? ' wc-roll-owned' : ''}`;

        const label = document.createElement('span');
        label.className = 'inv-roll-label';
        label.textContent = `#${i + 1}${inst.isCrafted ? ' ✦' : ''}`;
        if (inst.isCrafted) label.title = 'Crafted';
        row.appendChild(label);

        // One badge per wish this roll satisfies, tagged with its wishlist name.
        inst.wishMatches.forEach(({ listName, mode }) => {
            const badge = document.createElement('span');
            badge.className = `wc-badge wc-badge-${mode}`;
            badge.textContent = `✓ ${listName}`;
            badge.title = `Matches a ${mode.toUpperCase()} wish in "${listName}"`;
            row.appendChild(badge);
        });

        const groups = document.createElement('div');
        groups.className = 'wc-perk-groups';

        if (inst.columns.length > 0) {
            inst.columns.forEach((col, colIdx) => {
                if (colIdx > 0) {
                    const div = document.createElement('span');
                    div.className = 'wc-col-divider';
                    groups.appendChild(div);
                }
                const colEl = document.createElement('div');
                colEl.className = 'wc-perk-col';
                col.perks.forEach((p) => {
                    const wrap = document.createElement('span');
                    wrap.className = 'wc-perk-icon-wrap';
                    wrap.dataset.name = p.name;
                    if (p.icon) {
                        const pimg = document.createElement('img');
                        pimg.src = p.icon;
                        pimg.alt = p.name;
                        pimg.className = `wc-perk-icon${p.isActive ? ' perk-active' : ''}`;
                        wrap.appendChild(pimg);
                    }
                    colEl.appendChild(wrap);
                });
                groups.appendChild(colEl);
            });
        } else {
            const none = document.createElement('span');
            none.className = 'wc-roll-label';
            none.textContent = 'No perk data';
            groups.appendChild(none);
        }

        row.appendChild(groups);

        row.title = 'Double-click to start a wish from this roll';
        row.addEventListener('dblclick', () => startWishFromOwnedRoll(m, inst));

        rolls.appendChild(row);
    });

    header.addEventListener('click', () => {
        const open = card.classList.toggle('inv-open');
        caret.textContent = open ? '▴' : '▾';
    });

    card.appendChild(header);
    card.appendChild(rolls);
    return card;
}

/**
 * Double-clicking an owned roll opens it in the matching craft page, pre-filled,
 * as the starting point for a NEW wish — nothing is saved until the user hits
 * MAKE A NEW WISH there, so this is always safe to trigger by accident.
 */
function startWishFromOwnedRoll(match, instance) {
    if (match.isWeapon) {
        if (typeof loadOwnedRollIntoWeaponCraft !== 'function') return;
        // socketIndex -> the plug actually equipped in it, which is what the
        // craft page re-selects (not the full pool the column could roll).
        const activeBySocketIndex = {};
        for (const col of instance.columns) {
            if (col.activeHash) activeBySocketIndex[col.socketIndex] = col.activeHash;
        }
        loadOwnedRollIntoWeaponCraft(match.hash, match.name, activeBySocketIndex);
        return;
    }

    if (match.isArmor) {
        if (typeof loadOwnedArmorIntoCraft !== 'function') return;
        loadOwnedArmorIntoCraft({
            hash: match.hash,
            classType: match.classType,
            setName: getArmorSetName(match.setHash) || match.name,
            slotName: getBucketName(match.bucketHash),
            archetype: instance.armorArchetype,
            tertiary: instance.armorTertiary
        });
    }
}

// --- LIVE UPDATE LISTENER ---
// Triggers whenever data changes (e.g. from Content Script or internal save)
chrome.storage.onChanged.addListener((changes, namespace) => {
    if (namespace === 'local' && changes.dimData) {
        loadLists();
    }
    // The godroll.tv button adds wishes from the service worker, which has no
    // owned-inventory index — match them here so ownership shows up right away.
    if (namespace === 'local' && changes.wishAddedExternally) {
        matchWishlistAgainstCachedIndex();
    }
});

// Sidepanel version of saveItem (the add/duplicate rules are shared via weapon-wish-core.js)
// Resolves 'added' or 'duplicate' once the storage write (if any) has completed,
// so callers can tell the player what really happened.
async function saveItem(hash, name, type, rawString, keyId, config, mode = "pve", icon = null, classType = null, bucketHash = null, slotName = null, setName = null, setHash = null, linkedHashes = null, weaponMeta = null) {
  let status = 'duplicate';
  await AWStore.update((data) => {
    const listId = AWStore.ensureActiveList(data);
    // Container creation, metadata backfill and the duplicate rules live in
    // weapon-wish-core.js so the godroll.tv button (service worker) shares them.
    status = WeaponWish.addWishToList(data, listId, {
      hash, name, type, rawString, config, mode, icon, classType, bucketHash,
      slotName, setName, setHash, linkedHashes, weaponMeta
    });
    return status === 'duplicate' ? AWStore.SKIP : status;
  });
  // Don't call loadLists here - onChanged listener will handle UI refresh.
  // Immediately check the new wish against any already-fetched inventory,
  // so ownership shows up without requiring a full profile re-fetch.
  if (status === 'added') matchWishlistAgainstCachedIndex();
  return status;
}

// Backfill for wishes saved before linkedHashes existed (or saved via the
// content script, which can't scan the manifest): season reissues give the
// same item several manifest hashes, and without the sibling list an owned
// copy under a reissue hash never matches. Only scans the manifest for items
// whose linkedHashes are still empty and haven't been checked yet.
// Returns true if anything was filled in (caller should persist dimData).
async function backfillLinkedHashes(data) {
  if (!data?.lists) return false;
  let mutated = false;
  for (const list of Object.values(data.lists)) {
    for (const [hash, item] of Object.entries(list?.items || {})) {
      const type = item?.static?.type;
      let finder = null;
      if (type === 'armor' && typeof findArmorSiblingHashes === 'function') finder = findArmorSiblingHashes;
      else if (type === 'weapon' && typeof findWeaponSiblingHashes === 'function') finder = findWeaponSiblingHashes;
      if (!finder) continue;
      if ((item.static.linkedHashes || []).length > 0) continue;
      if (item.static.linkedHashesChecked) continue; // no siblings exist; don't rescan
      try {
        const siblings = await finder(Number(hash));
        item.static.linkedHashes = siblings;
        item.static.linkedHashesChecked = true;
        mutated = true;
      } catch (e) {
        console.warn('[Manager] linkedHashes backfill failed for', hash, e);
      }
    }
  }
  return mutated;
}
window.backfillLinkedHashes = backfillLinkedHashes;

// Backfill for weapon wishes saved before perkColumnsData entries carried
// colIndex (the 0-based column position, needed by the columns-3-and-4
// pooled trait-perk matching rule in owned-inventory-index.js). Re-derives
// each entry's colIndex by calling getWeaponPerkColumns() against the
// weapon's real item definition and mapping real socketIndex values back to
// their position in that canonical column list. Skips weapons whose
// perkColumnsData is already fully tagged, so this is self-terminating per
// wish — no need to run it more than once per item.
// Returns true if anything was filled in (caller should persist dimData).
async function backfillPerkColIndex(data) {
  if (!data?.lists) return false;
  let mutated = false;
  for (const list of Object.values(data.lists)) {
    for (const [hash, item] of Object.entries(list?.items || {})) {
      if (item?.static?.type !== 'weapon') continue;
      if (!Array.isArray(item.wishes)) continue;

      const needsBackfill = item.wishes.some((w) =>
        Array.isArray(w?.config?.perkColumnsData) &&
        w.config.perkColumnsData.some((c) => c.colIndex === undefined)
      );
      if (!needsBackfill) continue;

      let columns = null;
      try {
        if (typeof loadInventoryItemDefsToMemory !== 'function' || typeof getWeaponPerkColumns !== 'function') continue;
        const defs = await loadInventoryItemDefsToMemory();
        const def = defs.get(String(hash));
        if (!def) continue;
        columns = await getWeaponPerkColumns(def);
      } catch (e) {
        console.warn('[Manager] perkColIndex backfill: could not load columns for', hash, e);
        continue;
      }
      if (!columns || columns.length === 0) continue;

      const socketIndexToColIndex = new Map(columns.map((c, i) => [c.socketIndex, i]));

      for (const wish of item.wishes) {
        const pcd = wish?.config?.perkColumnsData;
        if (!Array.isArray(pcd)) continue;
        for (const entry of pcd) {
          if (entry.colIndex !== undefined) continue;
          if (socketIndexToColIndex.has(entry.socketIndex)) {
            entry.colIndex = socketIndexToColIndex.get(entry.socketIndex);
            mutated = true;
          }
        }
      }
    }
  }
  return mutated;
}
window.backfillPerkColIndex = backfillPerkColIndex;

/**
 * One wishlist-matching pass. Reads dimData fresh under the AWStore lock,
 * annotates it from `idx` and writes it back only if something changed. The
 * caller waits on the network (profile fetch, index build) BEFORE calling this,
 * never between a read and the write — matching a stale copy and writing it
 * back is what used to drop saves made in the meantime.
 *
 * `backfill` also fills in linked hashes / column indexes from the manifest
 * (local data only; no network).
 * Resolves { beforeSnapshot, dimData, summary }: what the caller needs to lock,
 * vault and feed newly matched items, which are network calls made after the
 * lock is released.
 */
async function matchWishlistPass(idx, { backfill = false } = {}) {
  if (!idx || !window.OwnedInventoryIndex || !window.OwnedInventoryIndex.matchWishlist) return null;
  return AWStore.update(async (dimData) => {
    if (backfill) {
      await backfillLinkedHashes(dimData);
      await backfillPerkColIndex(dimData);
    }
    const beforeSnapshot = snapshotReceivedState(dimData);
    const summary = window.OwnedInventoryIndex.matchWishlist(dimData, idx);
    return { beforeSnapshot, dimData, summary };
  });
}
window.matchWishlistPass = matchWishlistPass;

// Re-runs wishlist matching against whatever OwnedIndex is already cached in
// memory (from the last profile refresh this session) and persists results.
async function matchWishlistAgainstCachedIndex() {
  try {
    const idx = window.OwnedInventoryIndex && window.OwnedInventoryIndex.getCachedIndex && window.OwnedInventoryIndex.getCachedIndex();
    if (!idx) return;
    const pass = await matchWishlistPass(idx);
    if (!pass) return;
    await autoLockNewlyMatched(pass.beforeSnapshot, pass.dimData, idx);
    await transferNewlyMatchedToVault(pass.beforeSnapshot, pass.dimData, idx);
  } catch (e) { console.warn('[Manager] matchWishlistAgainstCachedIndex failed', e); }
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

// --- WEAPON LIST SEARCH & FILTERS ---
let weaponNameSearch = '';

// weaponFilters[category] = Set of selected values
const weaponFilters = { type: new Set(), ammo: new Set(), element: new Set() };
let activeWeaponFilterCategory = 'type';

const AMMO_TYPE_LABELS = { 1: 'Primary', 2: 'Special', 3: 'Heavy' };

const DAMAGE_TYPE_LABELS = {
    3373582085: 'Kinetic',
    2303181850: 'Arc',
    1847026933: 'Solar',
    3454344768: 'Void',
    151347233:  'Stasis',
    3949783978: 'Strand'
};

const DAMAGE_TYPE_COLORS = {
    3373582085: '#c8c8c8',
    2303181850: '#79c7e8',
    1847026933: '#f4a237',
    3454344768: '#9a6dd4',
    151347233:  '#6cb8d4',
    3949783978: '#36c788'
};

function initWeaponListSearch() {
    const input = document.getElementById('weapon-list-search');
    if (input) {
        let debounce = null;
        input.addEventListener('input', (e) => {
            clearTimeout(debounce);
            weaponNameSearch = e.target.value.trim().toLowerCase();
            debounce = setTimeout(loadLists, 250);
        });
    }

    // Funnel toggle
    const toggleBtn = document.getElementById('weapon-filter-toggle-btn');
    const controls = document.getElementById('weapon-filter-controls');
    if (toggleBtn && controls) {
        toggleBtn.addEventListener('click', () => {
            const collapsed = controls.classList.toggle('collapsed');
            toggleBtn.classList.toggle('active', !collapsed);
            toggleBtn.classList.toggle('collapsed', collapsed);
            if (!collapsed) renderWeaponFilterChips();
        });
    }

    // Category tab buttons
    ['type', 'ammo', 'element'].forEach((cat) => {
        const btn = document.getElementById(`wf-btn-${cat}`);
        if (!btn) return;
        btn.addEventListener('click', () => {
            activeWeaponFilterCategory = cat;
            document.querySelectorAll('#weapon-filter-controls .filter-toggle-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            renderWeaponFilterChips();
        });
    });

    // Clear buttons
    document.getElementById('weapon-filter-clear')?.addEventListener('click', () => {
        weaponFilters[activeWeaponFilterCategory].clear();
        renderWeaponFilterChips();
        loadLists();
    });
    document.getElementById('weapon-filter-clear-all')?.addEventListener('click', () => {
        Object.values(weaponFilters).forEach(s => s.clear());
        renderWeaponFilterChips();
        loadLists();
    });
}

// D2 is frozen — all possible weapon types, ammo types, and elements are known.
const WEAPON_TYPE_OPTIONS = [
    'Auto Rifle', 'Bow', 'Combat Bow', 'Fusion Rifle', 'Glaive', 'Grenade Launcher',
    'Hand Cannon', 'Linear Fusion Rifle', 'Machine Gun', 'Pulse Rifle',
    'Rocket Launcher', 'Scout Rifle', 'Shotgun', 'Sidearm',
    'Sniper Rifle', 'Submachine Gun', 'Sword', 'Trace Rifle'
];
const AMMO_TYPE_OPTIONS = [1, 2, 3]; // Primary, Special, Heavy
const ELEMENT_OPTIONS = [3373582085, 2303181850, 1847026933, 3454344768, 151347233, 3949783978];

function buildWeaponFilterOptions() {
    return Promise.resolve({
        types: WEAPON_TYPE_OPTIONS,
        ammos: AMMO_TYPE_OPTIONS,
        elements: ELEMENT_OPTIONS
    });
}

async function renderWeaponFilterChips() {
    const container = document.getElementById('weapon-filter-buttons-container');
    if (!container) return;
    container.innerHTML = '';

    const { types, ammos, elements } = await buildWeaponFilterOptions();
    const cat = activeWeaponFilterCategory;

    // Slug helpers for CSS data-attribute targeting
    const typeSlug = (t) => t.toLowerCase().replace(/[^a-z0-9]/g, '');
    const ammoSlug = (a) => ({ 1: 'primary', 2: 'special', 3: 'heavy' }[a] || `ammo${a}`);
    const elementSlug = (e) => (DAMAGE_TYPE_LABELS[e] || `e${e}`).toLowerCase();

    let entries = [];
    if (cat === 'type')    entries = types.map(t => ({ value: t, label: t, attr: 'data-wtype', slug: typeSlug(t) }));
    if (cat === 'ammo')    entries = ammos.map(a => ({ value: a, label: AMMO_TYPE_LABELS[a] || `Ammo ${a}`, attr: 'data-wammo', slug: ammoSlug(a) }));
    if (cat === 'element') entries = elements.map(e => ({ value: e, label: DAMAGE_TYPE_LABELS[e] || `Element ${e}`, attr: 'data-welement', slug: elementSlug(e) }));

    entries.forEach(({ value, label, attr, slug }) => {
        const btn = document.createElement('button');
        btn.className = 'filter-btn filter-btn-weapon' + (weaponFilters[cat].has(value) ? ' selected' : '');
        btn.textContent = label;
        btn.setAttribute(attr, slug);
        btn.addEventListener('click', () => {
            if (weaponFilters[cat].has(value)) weaponFilters[cat].delete(value);
            else weaponFilters[cat].add(value);
            btn.classList.toggle('selected', weaponFilters[cat].has(value));
            loadLists();
        });
        container.appendChild(btn);
    });
}

// --- VIEWER LOGIC ---
function loadLists() {
    chrome.storage.local.get(['dimData'], (result) => {
        const container = document.getElementById('weapon-list-items');
        const emptyState = document.getElementById('empty-state');
        if (!container) return;
        container.innerHTML = '';

        if (!result.dimData || !result.dimData.lists) {
            if (emptyState) emptyState.classList.remove('hidden');
            return;
        } else {
            if (emptyState) emptyState.classList.add('hidden');
        }

        const data = result.dimData;
        const activeId = data.activeId || 'default';
        const activeList = data.lists[activeId] || data.lists['default'];
        if (!activeList || !activeList.items || Object.keys(activeList.items).length === 0) {
            if (emptyState) emptyState.classList.remove('hidden');
            return;
        }

        const weapons = Object.keys(activeList.items)
            .filter(hash => {
                const item = activeList.items[hash];
                if (item?.static?.type !== 'weapon') return false;
                if (weaponNameSearch) {
                    const name = (item?.static?.name || '').toLowerCase();
                    if (!name.includes(weaponNameSearch)) return false;
                }
                if (weaponFilters.type.size && !weaponFilters.type.has(item.static?.itemTypeDisplayName)) return false;
                if (weaponFilters.ammo.size && !weaponFilters.ammo.has(item.static?.ammoType)) return false;
                if (weaponFilters.element.size && !weaponFilters.element.has(item.static?.damageTypeHash)) return false;
                return true;
            })
            .sort((a, b) => {
                const nameA = (activeList.items[a]?.static?.name || '').toLowerCase();
                const nameB = (activeList.items[b]?.static?.name || '').toLowerCase();
                return nameA.localeCompare(nameB, 'en', { sensitivity: 'base' });
            });

        if (weapons.length === 0) {
            container.innerHTML = '<div class="empty-list-text">No weapon wishes yet.</div>';
            return;
        }

        weapons.forEach(hash => {
            const item = activeList.items[hash];
            const card = createWeaponCard(hash, item);
            container.appendChild(card);
        });
    });
}

function createWeaponCard(hash, item) {
    const COMBO_COLORS = window.OwnedInventoryIndex.COMBO_COLORS;
    const card = document.createElement('div');
    card.className = 'wc-card';

    // Wishlists can come from other people (Discover, .awwish files), so the
    // name is escaped and the icon must be Bungie-hosted art — see aw-dom.js.
    const safeName = escapeHtml(item?.static?.name || '(unknown)');
    const iconUrl = escapeHtml(AWDom.safeImageUrl(item?.static?.icon));

    const wishes = Array.isArray(item?.wishes) ? item.wishes : [];

    // Build roll rows
    const rollsEl = document.createElement('div');
    rollsEl.className = 'wc-rolls';

    wishes.forEach((wish, index) => {
        // Anything but a known mode falls back to PvE rather than reaching a class name.
        const tag = (wish?.tags?.[0] === 'pvp') ? 'pvp' : 'pve';
        const perkColumns = wish?.config?.perkColumns || [];

        const row = document.createElement('div');
        row.className = `wc-roll-row${wish?.received ? ' wc-roll-owned' : ''}`;

        // Mode badge
        const badge = document.createElement('span');
        badge.className = `wc-badge wc-badge-${tag}`;
        badge.textContent = tag.toUpperCase();
        row.appendChild(badge);

        // Owned badge — shows how many owned copies match this specific roll
        if (wish?.received) {
            const ownedCount = Array.isArray(wish.receivedInstances) ? wish.receivedInstances.length : 0;
            const ownedBadge = document.createElement('span');
            ownedBadge.className = 'wc-badge wc-badge-owned';
            ownedBadge.textContent = `OWNED x${ownedCount}`;
            row.appendChild(ownedBadge);
        }

        // Per-combo owned counts. Combos are matched independently — three
        // combos can be covered by three different guns — so a single OWNED
        // count can't say which of them you're still hunting.
        const comboMatches = wish?.comboMatches;
        if (comboMatches && Object.keys(comboMatches).length > 0) {
            const chips = document.createElement('span');
            chips.className = 'wc-combo-chips';
            COMBO_COLORS.forEach((color, slot) => {
                const hits = comboMatches[color];
                if (!Array.isArray(hits)) return;
                const chip = document.createElement('span');
                chip.className = `wc-combo-chip wc-combo-${color}${hits.length === 0 ? ' wc-combo-empty' : ''}`;
                chip.textContent = `${slot + 1}×${hits.length}`;
                chip.title = `Combo ${slot + 1}: ${hits.length} owned`;
                chips.appendChild(chip);
            });
            if (chips.childElementCount > 0) row.appendChild(chips);
        }

        // Perk column groups
        const groupsEl = document.createElement('div');
        groupsEl.className = 'wc-perk-groups';

        const matchedPerkHashes = new Set(Array.isArray(wish?.matchedPerkHashes) ? wish.matchedPerkHashes : []);
        const matchedCombos = new Set(Array.isArray(wish?.matchedCombos) ? wish.matchedCombos : []);

        if (perkColumns.length > 0) {
            perkColumns.forEach((col, colIdx) => {
                if (colIdx > 0) {
                    const div = document.createElement('span');
                    div.className = 'wc-col-divider';
                    groupsEl.appendChild(div);
                }
                const colEl = document.createElement('div');
                colEl.className = 'wc-perk-col';
                col.forEach(({ name, icon, isActive, hash, enhancedHash, color }) => {
                    const wrap = document.createElement('span');
                    wrap.className = 'wc-perk-icon-wrap';
                    wrap.dataset.name = name;
                    const slot = COMBO_COLORS.indexOf(color);
                    // Combo number rides along with the colour so the grouping
                    // survives for anyone who can't separate the four hues.
                    if (slot >= 0) wrap.dataset.combo = String(slot + 1);
                    const iconSrc = AWDom.safeImageUrl(icon);
                    if (iconSrc) {
                        const isMatched = matchedPerkHashes.has(hash) || (enhancedHash && matchedPerkHashes.has(enhancedHash));
                        // A matched perk in a combo is bordered in that combo's
                        // colour, not gold — one weapon often satisfies several
                        // combos at once and the colours are what tell them apart.
                        const matchClass = !isMatched ? ''
                            : (slot >= 0 && matchedCombos.has(color)) ? ` wc-perk-icon-matched wc-perk-matched-${color}`
                            : ' wc-perk-icon-matched';
                        const img = document.createElement('img');
                        img.src = iconSrc;
                        img.alt = name;
                        // isActive only exists on wishes saved before combos; it
                        // marked the perk driving the old stats preview.
                        img.className = `wc-perk-icon${isActive ? ' perk-active' : ''}${matchClass}`;
                        wrap.appendChild(img);
                    }
                    colEl.appendChild(wrap);
                });
                groupsEl.appendChild(colEl);
            });
        } else {
            // Legacy saved wishes without perkColumns
            const label = document.createElement('span');
            label.className = 'wc-roll-label';
            label.textContent = `Roll #${index + 1}`;
            groupsEl.appendChild(label);
        }

        row.appendChild(groupsEl);

        // Delete button
        const delBtn = document.createElement('button');
        delBtn.className = 'wc-del-btn';
        delBtn.title = 'Delete this roll';
        delBtn.innerHTML = '&#x2715;';
        delBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            deleteWish(hash, index, window.WishlistSync.wishKey(wish));
        });
        row.appendChild(delBtn);

        // Double-click loads this exact roll into the weapon craft page for editing.
        row.title = 'Double-click to edit this roll';
        row.addEventListener('dblclick', () => {
            if (typeof loadWishIntoWeaponCraft === 'function') {
                loadWishIntoWeaponCraft(hash, index, item, wish);
            }
        });

        rollsEl.appendChild(row);
    });

    card.innerHTML = `
        <div class="wc-header">
            ${iconUrl ? `<img src="${iconUrl}" class="wc-icon" alt="">` : '<div class="wc-icon wc-icon-placeholder"></div>'}
            <div class="wc-header-info">
                <div class="wc-name">${safeName}</div>
                <div class="wc-roll-count">${wishes.length} ${wishes.length === 1 ? 'ROLL' : 'ROLLS'}</div>
            </div>
        </div>
    `;
    card.appendChild(rollsEl);

    return card;
}

// Legacy — kept for any non-weapon items that might slip through
function createItemCard(hash, item) {
    return createWeaponCard(hash, item);
}

// Overwrites a specific existing wish in place (used by the weapon craft page's
// EDIT WISH button) instead of appending a new entry the way saveItem does.
/**
 * Overwrites one saved wish. `key` is the wish's WishlistSync.wishKey from when
 * it was loaded for editing, so an edit can't land on a different wish if the
 * list changed meanwhile. Resolves { result, key }: result is 'updated',
 * 'duplicate' (another saved wish already is exactly this roll, so nothing
 * changed) or 'missing' (the wish was deleted elsewhere); key is the wish's
 * key after the edit, for a follow-up edit.
 */
async function editItemWish(hash, index, rawString, config, mode = "pve", key) {
  const next = { tags: [mode], config, raw: rawString };
  const nextKey = window.WishlistSync.wishKey(next);
  let result = 'missing';
  await AWStore.update((data) => {
    const listId = AWStore.ensureActiveList(data);
    const wishes = data.lists[listId].items[hash]?.wishes;
    const at = window.WishlistSync.locateWish(wishes, index, key);
    if (at < 0) { result = 'missing'; return AWStore.SKIP; }
    if (wishes.some((w, i) => i !== at && window.WishlistSync.wishKey(w) === nextKey)) {
      result = 'duplicate';
      return AWStore.SKIP;
    }
    next.added = wishes[at].added || Date.now();
    // replaceWish tombstones the old wish if the edit changed its sync identity
    // (perks, or archetype + Tertiary), so cloud sync can't bring it back.
    result = window.WishlistSync.replaceWish(data, listId, hash, at, next) ? 'updated' : 'missing';
    if (result !== 'updated') return AWStore.SKIP;
  });
  if (result === 'updated') matchWishlistAgainstCachedIndex();
  return { result, key: result === 'updated' ? nextKey : key };
}

/**
 * Gives saved armor that lacks it the set it belongs to (and the set's real
 * name), from the item definitions, so the list groups whole sets and can show
 * their bonuses. Writes only when something was missing.
 */
async function backfillArmorSets() {
    try {
        const defs = await loadInventoryItemDefsToMemory();
        const setOf = (itemHash) => {
            const hash = defs.get(String(itemHash))?.equippingBlock?.equipableItemSetHash;
            return hash ? { hash, name: getArmorSetName(hash) } : null;
        };
        let changed = 0;
        await AWStore.update((data) => {
            changed = window.WeaponWish.fillArmorSets(data, setOf);
            if (!changed) return AWStore.SKIP;
        });
        if (changed && typeof refreshArmorList === 'function') refreshArmorList();
    } catch (e) {
        console.warn('[MANAGER] armor set backfill skipped', e);
    }
}

/** Deletes one saved wish, found by `key` (its wishKey when the row was drawn). */
function deleteWish(hash, index, key) {
    return AWStore.update((data) => {
        const listId = AWStore.ensureActiveList(data);
        const activeList = data.lists[listId];
        const wishes = activeList.items[hash]?.wishes;
        const at = window.WishlistSync.locateWish(wishes, index, key);
        if (at < 0) return AWStore.SKIP; // already gone: never delete a different wish
        const [removed] = wishes.splice(at, 1);
        // Record the deletion so cross-browser sync can't restore it from a
        // browser still holding the old copy — see wishlist-sync-core.js.
        window.WishlistSync?.recordWishTombstone(data, listId, hash, removed);
        if (wishes.length === 0) delete activeList.items[hash];
    }).then(loadLists);
}

/**
 * Resolve the Destiny membership to fetch. Reuses the one cached by the last
 * sync when it belongs to the signed-in Bungie account, so a routine sync is a
 * single GetProfile round trip instead of two.
 */
async function resolveDestinyMembership(auth) {
  const cached = (await new Promise((res) => chrome.storage.local.get(['activeMembership'], res)))?.activeMembership;
  if (cached?.membershipId && cached.membershipType !== undefined &&
      cached.bungieMembershipId && cached.bungieMembershipId === auth.membership_id) {
    return { membershipType: cached.membershipType, membershipId: cached.membershipId };
  }

  // Fetch Destiny 2 memberships — GetMembershipsForCurrentUser is the authoritative
  // source; GetBungieNetUser (stored as auth.user) only contains Bungie.net account
  // info and does not include Destiny platform memberships.
  let memberships = [];
  try {
    memberships = await window.bungieAuth.fetchDestinyMemberships(auth.access_token);
  } catch (e) {
    console.warn('[Manager] fetchDestinyMemberships failed, trying stored user fallback:', e);
  }

  // Fallback: memberships stored directly on auth object at sign-in time
  if (!memberships || memberships.length === 0) {
    if (Array.isArray(auth.destinyMemberships) && auth.destinyMemberships.length > 0) {
      memberships = auth.destinyMemberships;
    }
  }

  // Fallback: older sign-in flows that stored memberships on auth.user
  if (!memberships || memberships.length === 0) {
    const user = auth.user || null;
    const fallback = user && (user.destinyMemberships || user.profiles);
    if (Array.isArray(fallback) && fallback.length > 0) memberships = fallback;
  }

  if (!memberships || memberships.length === 0) {
    throw new Error('No Destiny memberships found. Make sure you are signed in and have at least one linked platform.');
  }

  const primary = memberships[0];
  const membershipType = primary.membershipType ?? primary.membership_type;
  const membershipId = primary.membershipId ?? primary.membership_id;
  if (membershipType === undefined || !membershipId) {
    throw new Error('Could not determine membershipType/membershipId from: ' + JSON.stringify(primary));
  }
  return { membershipType, membershipId };
}

// responseMintedTimestamp of the newest profile applied this session. Bungie
// serves GetProfile from a short-lived cache, so a poll can come back with the
// same snapshot (nothing to do) or, across edge nodes, an older one (applying
// it would briefly un-own an item the user just picked up).
let _lastProfileMintedAt = 0;

/**
 * Refresh profile via Bungie API and build the OwnedIndex.
 * - Resolves the Destiny membership (cached after the first sync).
 * - Calls `bungieAuth.fetchProfileWithComponents`; skips everything below when
 *   the response is the same or an older snapshot than the last one applied.
 * - Builds the OwnedIndex via `OwnedInventoryIndex.buildOwnedIndex` and runs a wishlist match pass.
 *
 * @param {string|Array<number|string>} components - components param to pass to GetProfile (comma-separated or array)
 * @returns {Promise<boolean>} whether a newer profile was applied
 */
async function refreshProfileAndBuildIndex(components) {
  // getValidAuth() refreshes an expired access token first; reading the raw
  // stored token here would send an expired one to GetMembershipsForCurrentUser.
  const auth = await window.bungieAuth.getValidAuth();
  const { membershipType, membershipId } = await resolveDestinyMembership(auth);

  const profile = await window.bungieAuth.fetchProfileWithComponents(membershipType, membershipId, components);
  if (!profile) throw new Error('fetchProfileWithComponents returned no data.');

  const mintedAt = Date.parse(profile.responseMintedTimestamp) || 0;
  if (mintedAt && mintedAt <= _lastProfileMintedAt) return false;

  // Build owned index
  if (!window.OwnedInventoryIndex || !window.OwnedInventoryIndex.buildOwnedIndex) {
    throw new Error('OwnedInventoryIndex not available (owned-inventory-index.js failed to load).');
  }
  const idx = await window.OwnedInventoryIndex.buildOwnedIndex(profile);
  if (mintedAt) _lastProfileMintedAt = mintedAt;
  const totalInstances = idx.byInstanceId ? idx.byInstanceId.size : 0;
  const uniqueItems = idx.byItemHash ? idx.byItemHash.size : 0;
  const ownedIndexSummary = { totalInstances, uniqueItems, fetchedAt: Date.now() };
  const characterIds = Object.keys(profile?.characters?.data || {});
  const activeMembership = { membershipType, membershipId, characterIds, bungieMembershipId: auth.membership_id || null };
  await new Promise((res) => chrome.storage.local.set({ ownedIndexSummary, activeMembership }, res));
  renderOwnedIndexSummary(ownedIndexSummary);
  console.log('[Manager] OwnedIndex built:', totalInstances, 'instances,', uniqueItems, 'unique item hashes');

  // Run wishlist matching pass using the built index. Every dimData write
  // re-renders all three views and queues a cloud push, so AWStore only writes
  // when matching actually changed something. The onChanged listener
  // re-renders the lists as soon as it lands — before the lock/transfer calls
  // below, which are one request per item.
  if (window.OwnedInventoryIndex.matchWishlist) {
    const pass = await matchWishlistPass(idx, { backfill: true });
    if (pass) {
      await autoLockNewlyMatched(pass.beforeSnapshot, pass.dimData, idx);
      await transferNewlyMatchedToVault(pass.beforeSnapshot, pass.dimData, idx);
      if (_feedEnabled) await appendFeedEntries(diffFeedEntries(pass.beforeSnapshot, pass.dimData));
      console.log('[Manager] Wishlist matching complete:', pass.summary);
    }
  }
  return true;
}

// Expose to console for manual triggering
window.appManager = window.appManager || {};
window.appManager.refreshProfileAndBuildIndex = refreshProfileAndBuildIndex;

// --- AUTO-REFRESH & SYNC BAR ---
// GetProfile component IDs (numeric — GetProfile rejects names):
// 102=ProfileInventory, 200=Characters, 201=CharacterInventories,
// 205=CharacterEquipment, 305=ItemSockets, 310=ItemReusablePlugs (full
// per-socket roll pool, not just the active plug). Each extra item component
// adds a block per instance to an already multi-megabyte response, so only
// what the OwnedIndex reads is requested.
const SYNC_COMPONENTS = '102,200,201,205,305,310';
const VISIBLE_REFRESH_INTERVAL_MS = 30 * 1000;  // panel open — DIM's cadence
const AUTO_REFRESH_INTERVAL_MS = 5 * 60 * 1000; // panel hidden
const MANUAL_REFRESH_COOLDOWN_MS = 15 * 1000;   // 15s floor (Bungie's requested minimum)

let _autoRefreshTimer = null;
let _lastSyncAt = null;
let _syncCooldownUntil = 0;
let _syncTickTimer = null;
let _syncInFlight = null;

function setSyncBarState(state, message) {
  const statusEls = [
    document.getElementById('weapon-sync-status'),
    document.getElementById('armor-sync-status'),
  ];
  const btnEls = [
    document.getElementById('weapon-sync-btn'),
    document.getElementById('armor-sync-btn'),
  ];
  statusEls.forEach(el => {
    if (!el) return;
    el.textContent = message;
    el.className = 'sync-bar-status' + (state === 'syncing' ? ' syncing' : state === 'error' ? ' error' : '');
  });
  btnEls.forEach(el => {
    if (!el) return;
    el.disabled = state === 'syncing';
    el.classList.toggle('spinning', state === 'syncing');
  });
}

function getAutoRefreshIntervalMs() {
  if (document.visibilityState === 'visible') return VISIBLE_REFRESH_INTERVAL_MS;
  return _feedEnabled ? FEED_INTERVAL_MS : AUTO_REFRESH_INTERVAL_MS;
}

function updateSyncBarTime() {
  if (!_lastSyncAt) return;
  const elapsed = Math.floor((Date.now() - _lastSyncAt) / 1000);
  let label;
  if (elapsed < 60) label = elapsed <= 5 ? 'Just synced' : `Synced ${elapsed}s ago`;
  else if (elapsed < 3600) label = `Synced ${Math.floor(elapsed / 60)}m ago`;
  else label = `Synced ${Math.floor(elapsed / 3600)}h ago`;
  const nextIn = Math.max(0, Math.ceil(((_lastSyncAt + getAutoRefreshIntervalMs()) - Date.now()) / 1000));
  const nextLabel = nextIn > 60 ? `${Math.floor(nextIn / 60)}m` : `${nextIn}s`;
  setSyncBarState('idle', `${label} · Auto-sync in ${nextLabel}`);
}

// Schedules the next auto-sync relative to the last one, so the cadence
// follows panel visibility instead of a fixed setInterval.
function scheduleNextSync() {
  if (_autoRefreshTimer) clearTimeout(_autoRefreshTimer);
  const due = (_lastSyncAt || 0) + getAutoRefreshIntervalMs();
  _autoRefreshTimer = setTimeout(() => runSync(false), Math.max(0, due - Date.now()));
}

// Resolves to the error when the sync failed (null on success), so callers
// that report failures can surface it without the loop ever rejecting.
function runSync(isManual = false) {
  // Auto and manual syncs share one request rather than racing each other.
  if (_syncInFlight) return _syncInFlight;
  if (isManual && Date.now() < _syncCooldownUntil) {
    const wait = Math.ceil((_syncCooldownUntil - Date.now()) / 1000);
    setSyncBarState('idle', `Please wait ${wait}s before syncing again`);
    return Promise.resolve(null);
  }
  setSyncBarState('syncing', 'Syncing inventory...');
  _syncInFlight = (async () => {
    try {
      await refreshProfileAndBuildIndex(SYNC_COMPONENTS);
      _lastSyncAt = Date.now();
      _syncCooldownUntil = _lastSyncAt + MANUAL_REFRESH_COOLDOWN_MS;
      updateSyncBarTime();
      return null;
    } catch (e) {
      console.error('[AutoRefresh] sync failed:', e);
      setSyncBarState('error', 'Sync failed — check sign-in');
      // Retry on the normal cadence rather than hammering a failing endpoint.
      _lastSyncAt = Date.now();
      return e;
    } finally {
      _syncInFlight = null;
      scheduleNextSync();
    }
  })();
  return _syncInFlight;
}

function startAutoRefresh() {
  if (_syncTickTimer) clearInterval(_syncTickTimer);

  // Wire both manual buttons
  ['weapon-sync-btn', 'armor-sync-btn'].forEach(id => {
    const btn = document.getElementById(id);
    if (btn) btn.onclick = () => runSync(true);
  });

  // Tick every 10s to keep the "X min ago / next in Ym" label fresh
  _syncTickTimer = setInterval(updateSyncBarTime, 10_000);

  if (!startAutoRefresh._wired) {
    startAutoRefresh._wired = true;
    // Reopening the panel syncs straight away (subject to the 15s floor) and
    // switches to the fast cadence; hiding it drops back to the slow one.
    document.addEventListener('visibilitychange', () => {
      if (_syncInFlight) return;
      if (document.visibilityState === 'visible' && Date.now() >= _syncCooldownUntil) runSync(false);
      else scheduleNextSync();
    });
  }

  // First call syncs immediately; later calls (Feed toggle) just re-pace.
  if (_lastSyncAt || _syncInFlight) scheduleNextSync();
  else runSync(false);
}

// Debug helper: run in the sidepanel devtools console as
// await appManager.debugWeaponMatch("Service Revolver")
// Prints every owned itemHash matching the name (catches reissue/duplicate-hash
// mismatches — same display name, different hash, common cause of "not matching"),
// each wish's saved perkColumnsData, and a column-by-column comparison against
// each owned instance's actual socket options.
window.appManager.debugWeaponMatch = async function (nameSubstring) {
  const q = String(nameSubstring || '').trim().toLowerCase();
  const defs = await loadInventoryItemDefsToMemory();
  const idx = window.OwnedInventoryIndex.getCachedIndex();
  const { dimData } = await new Promise((res) => chrome.storage.local.get(['dimData'], res));

  if (!idx) { console.warn('[DEBUG] No OwnedIndex cached — run Refresh Profile & Build Index first.'); return; }

  console.log('--- Owned itemHashes matching name ---');
  const ownedHashes = [];
  for (const [itemHash, instanceIds] of idx.byItemHash.entries()) {
    const def = defs.get(String(itemHash));
    const name = def?.displayProperties?.name || '';
    if (!name.toLowerCase().includes(q)) continue;
    ownedHashes.push(itemHash);
    console.log(`hash=${itemHash} name="${name}" copies=${instanceIds.size}`);
  }
  if (ownedHashes.length === 0) console.log('(none found in owned inventory)');

  console.log('--- Wishlist entries matching name ---');
  const activeId = dimData?.activeId || 'default';
  const list = dimData?.lists?.[activeId] || dimData?.lists?.['default'];
  if (!list) { console.warn('[DEBUG] No active wishlist found.'); return; }

  for (const itemHashStr of Object.keys(list.items || {})) {
    const item = list.items[itemHashStr];
    const name = item?.static?.name || '';
    if (!name.toLowerCase().includes(q)) continue;
    console.log(`WISH ITEM hash=${itemHashStr} name="${name}"`);

    const aliasHashes = Array.isArray(item.static?.linkedHashes) ? item.static.linkedHashes : [];
    const allHashesToCheck = [Number(itemHashStr), ...aliasHashes.map(Number)];
    if (aliasHashes.length) console.log(`  linkedHashes (auto-aliased duplicates): [${aliasHashes.join(', ')}]`);

    const ownsThisHash = allHashesToCheck.some((h) => ownedHashes.includes(h));
    if (!ownsThisHash) {
      console.warn(`  -> You do NOT own anything with this hash or its linked aliases. If this looks wrong, this is likely a reissue/duplicate-name mismatch: pick the search result whose hash matches one printed above.`);
    }

    (item.wishes || []).forEach((wish, i) => {
      console.log(`  wish #${i} (${(wish.tags||[]).join(',')}):`, wish.config?.perkColumnsData || '(legacy, no perkColumnsData)');
      console.log(`    received=${wish.received} receivedInstances=${JSON.stringify(wish.receivedInstances)}`);

      const instanceIds = new Set();
      for (const h of allHashesToCheck) {
        const s = idx.byItemHash.get(h);
        if (s) for (const iid of s) instanceIds.add(iid);
      }
      const combos = wish.config?.perkColumnsData
        ? window.OwnedInventoryIndex.buildCombos(wish.config.perkColumnsData)
        : [];
      if (combos.length > 0) {
        console.log(`    combos: ${combos.map((c) => `${c.color}(${c.members.length} cols)`).join(', ')}`);
        console.log(`    matchedCombos=${JSON.stringify(wish.matchedCombos)} comboMatches=${JSON.stringify(wish.comboMatches)}`);
      } else {
        console.log('    combos: none — this wish uses the plain per-column any-of rule');
      }

      if (instanceIds.size && wish.config?.perkColumnsData) {
        const nameOf = (h) => defs.get(String(h))?.displayProperties?.name || h;

        for (const iid of instanceIds) {
          const owned = idx.byInstanceId.get(iid);
          console.log(`    -- instance ${iid} --`);
          wish.config.perkColumnsData.forEach(({ socketIndex, colIndex, hashes, colors }) => {
            const socket = owned?.perkSockets?.[socketIndex];
            const wantNames = hashes.map(nameOf);
            const haveNames = (socket?.options || []).map(nameOf);
            const matched = socket && hashes.some((h) => socket.options.includes(h));
            const colorTag = Object.keys(colors || {}).length
              ? ` colors={${Object.entries(colors).map(([c, hs]) => `${c}:${nameOf(hs[0])}`).join(', ')}}`
              : '';
            console.log(`      col socketIndex=${socketIndex} colIndex=${colIndex ?? '(untagged)'}${colorTag} want=[${wantNames.join(', ')}] owned_options=[${haveNames.join(', ')}] any_of_matched=${!!matched}`);
          });

          if (combos.length > 0) {
            // With combos present, only a WHOLE combo counts — the any-of
            // results above are informational except on uncoloured columns.
            for (const { color, members } of combos) {
              const parts = members.map(({ socketIndex, hashes }) => {
                const hit = owned?.perkSockets?.[socketIndex]?.options.some((o) => hashes.includes(o));
                return `socket${socketIndex}:${nameOf(hashes[0])}=${hit ? 'HIT' : 'miss'}`;
              });
              const full = members.every(({ socketIndex, hashes }) =>
                owned?.perkSockets?.[socketIndex]?.options.some((o) => hashes.includes(o)));
              console.log(`      combo ${color}: ${parts.join(' + ')} -> ${full ? 'MATCH' : 'no match'}`);
            }
            continue;
          }

          // Columns-3&4 pooled trait-perk rule — only reachable on wishes with
          // no combos, where the legacy rules still apply in full.
          const col3 = wish.config.perkColumnsData.find((c) => c.colIndex === 2);
          const col4 = wish.config.perkColumnsData.find((c) => c.colIndex === 3);
          if (col3 && col4) {
            const s3 = owned?.perkSockets?.[col3.socketIndex];
            const s4 = owned?.perkSockets?.[col4.socketIndex];
            let hits = 0;
            for (const h of col3.hashes) if (s3?.options.includes(h)) hits++;
            for (const h of col4.hashes) if (s4?.options.includes(h)) hits++;
            const total = col3.hashes.length + col4.hashes.length;
            console.log(`      trait-pool (cols 3&4): ${hits}/${total} hit (need >=4) -> ${hits >= 4 ? 'MATCH' : 'no match'}`);
          } else {
            console.log('      trait-pool (cols 3&4): colIndex not tagged yet on this wish (run Refresh Profile & Build Index to backfill)');
          }
        }
      }
    });
  }
};

