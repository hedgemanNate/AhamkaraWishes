/* ============================================================
   WEAPON-UI.JS - Phase 5: Weapon Crafting UI & Search
   ============================================================ */

/**
 * Global weapon state object - tracks UI state during crafting & list view.
 */
const weaponState = {
  currentWeapon: null, // { weaponHash, name, stats, sockets }
  selectedPerks: {}, // { socketIndex: perkHash }
  currentMode: 'pve', // "pve" or "pvp"
  // ... existing fields ...
  currentFilters: {}, // Search/filter state
  currentPane: 'craft', // "craft" or "list"
  recentSelections: [], // Most recently selected weapons
  showHistory: false,
  // List view filter state
  _weaponTypes: [], // Array of available weapon types
  _damageTypes: new Map(), // Map of damageHash -> damageTypeName
  _selectedType: null, // Currently selected weapon type
  _selectedDamage: null, // Currently selected damage type hash
};

const SOCKET_CATEGORY_HASHES = {
  INTRINSIC_TRAITS: 3956125808,
  WEAPON_PERKS: 4241085061, // Corrected from subagent to the one I researched: 4241085061
  WEAPON_MODS: 2685412949
};

let weaponCraftInitialized = false;

let weaponSearchWorker = null;
let weaponSearchRequestId = 0;

function initWeaponSearchWorker() {
  if (weaponSearchWorker) return;

  try {
    const workerUrl =
      typeof chrome !== 'undefined' && chrome.runtime?.getURL
        ? chrome.runtime.getURL('weapon-search-worker.js')
        : 'weapon-search-worker.js';
    weaponSearchWorker = new Worker(workerUrl);

    weaponSearchWorker.onmessage = (event) => {
      const payload = event.data || {};
      if (payload.type === 'results') {
        if (payload.id !== weaponSearchRequestId) return;
        renderWeaponSearchResults(payload.results);
      } else if (payload.type === 'error') {
        if (payload.id !== weaponSearchRequestId) return;
        d2log(`Search worker error: ${payload.message}`, 'weapon-ui', 'error');
        const resultsDiv = document.getElementById('w-search-results');
        if (resultsDiv) {
          resultsDiv.innerHTML =
            '<div style="text-align: center; color: #c66; padding: 20px;">Manifest unavailable. Please check your internet connection.</div>';
        }
      }
    };

    weaponSearchWorker.onerror = (error) => {
      d2log(`Search worker failed: ${error.message || error}`, 'weapon-ui', 'error');
      weaponSearchWorker = null;
    };

    weaponSearchWorker.postMessage({ type: 'warmup' });
  } catch (error) {
    d2log(`Search worker init failed: ${error.message || error}`, 'weapon-ui', 'error');
    weaponSearchWorker = null;
  }
}

function shutdownWeaponSearchWorker() {
  if (weaponSearchWorker) {
    weaponSearchWorker.terminate();
    weaponSearchWorker = null;
  }
}

function resetWeaponSearchWorker() {
  shutdownWeaponSearchWorker();
  initWeaponSearchWorker();
}

/**
 * Initialize weapon crafting UI: attach event listeners, setup state.
 */
async function initWeaponCraft() {
  if (weaponCraftInitialized) return;
  weaponCraftInitialized = true;

  if (window.weaponStatsService?.initializeWeaponStats) {
    window.weaponStatsService
      .initializeWeaponStats()
      .catch((error) => {
        d2log(`Weapon stats init failed: ${error.message || error}`, 'weapon-ui', 'error');
      });
  } else {
    d2log('Weapon stats service unavailable at init', 'weapon-ui', 'error');
  }

  initWeaponSearchWorker();

  let searchTimeout;

  // Search input (debounced)
  const searchInput = document.getElementById('w-search-input');
  if (searchInput) {
    searchInput.addEventListener('input', (event) => {
      clearTimeout(searchTimeout);
      const query = event.target.value.trim();
      searchTimeout = setTimeout(() => {
        triggerWeaponSearch(query);
      }, 300);
    });
  }

  const historyToggleBtn = document.getElementById('w-history-toggle');
  if (historyToggleBtn) {
    historyToggleBtn.addEventListener('click', () => {
      weaponState.showHistory = !weaponState.showHistory;
      historyToggleBtn.classList.toggle('active', weaponState.showHistory);

      if (weaponState.showHistory) {
        clearTimeout(searchTimeout);
        weaponSearchRequestId += 1;
        if (searchInput) {
          searchInput.value = '';
        }
        renderRecentWeaponSelections();
      } else {
        const resultsDiv = document.getElementById('w-search-results');
        if (resultsDiv) {
          resultsDiv.innerHTML = '';
        }
      }
    });
  }

  const historyClearBtn = document.getElementById('w-history-clear');
  if (historyClearBtn) {
    historyClearBtn.addEventListener('click', () => {
      weaponState.recentSelections = [];
      const currentQuery = searchInput?.value?.trim() || '';
      if (!currentQuery) {
        renderRecentWeaponSelections();
      }
    });
  }

  // Mode toggle buttons
  const pvePveBtn = document.getElementById('w-pve-btn');
  const pvpPvpBtn = document.getElementById('w-pvp-btn');

  if (pvePveBtn) {
    pvePveBtn.addEventListener('click', () => {
      weaponState.currentMode = 'pve';
      toggleModeButton('pve');
    });
  }

  if (pvpPvpBtn) {
    pvpPvpBtn.addEventListener('click', () => {
      weaponState.currentMode = 'pvp';
      toggleModeButton('pvp');
    });
  }

  // Pane navigation (craft ↔ list)
  const navWCraftBtn = document.getElementById('nav-w-craft');
  const navWListBtn = document.getElementById('nav-w-list');

  if (navWCraftBtn) {
    navWCraftBtn.addEventListener('click', () => {
      weaponState.currentPane = 'craft';
      togglePane('craft');
    });
  }

  if (navWListBtn) {
    navWListBtn.addEventListener('click', () => {
      weaponState.currentPane = 'list';
      togglePane('list');
      refreshWeaponList().then(() => {
        attachFilterListeners();
      });
    });
  }

  // Save button (Phase 6)
  const savBtn = document.getElementById('w-save-btn');
  if (savBtn) {
    savBtn.addEventListener('click', handleSaveWeaponWish);
  }

  d2log('✅ Weapon craft UI initialized', 'weapon-ui');
}

/**
 * Trigger weapon search when user types in search input.
 *
 * @param {string} query - Search query (weapon name)
 * @param {string} type - Optional weapon type filter (e.g., "Auto Rifle")
 */
async function triggerWeaponSearch(query, type = null) {
  if (!query) {
    renderRecentWeaponSelections();
    return;
  }

  if (query.length < 2) {
    const resultsDiv = document.getElementById('w-search-results');
    if (resultsDiv) {
      resultsDiv.innerHTML = '';
    }
    return;
  }

  if (weaponSearchWorker) {
    weaponSearchRequestId += 1;
    weaponSearchWorker.postMessage({
      type: 'search',
      id: weaponSearchRequestId,
      query,
      bucketHash: type,
    });
    return;
  }

  // Search using manifest function from Phase 1
  try {
    const weapons = await window.__manifest__.searchWeaponsLocally(query, type);
    renderWeaponSearchResults(weapons);
  } catch (error) {
    d2log(`Search failed: ${error.message || error}`, 'weapon-ui', 'error');
    const resultsDiv = document.getElementById('w-search-results');
    if (resultsDiv) {
      resultsDiv.innerHTML =
        '<div style="text-align: center; color: #c66; padding: 20px;">Manifest unavailable. Please check your internet connection.</div>';
    }
  }
}

/**
 * Render search results as clickable weapon cards.
 *
 * @param {Array} weapons - Array of weapon definitions from manifest
 */
function renderWeaponSearchResults(weapons) {
  const resultsDiv = document.getElementById('w-search-results');
  if (!resultsDiv) return;

  if (!Array.isArray(weapons) || weapons.length === 0) {
    resultsDiv.innerHTML = '<div style="text-align: center; color: #666; padding: 20px;">No weapons found</div>';
    return;
  }

  resultsDiv.innerHTML = weapons
    .slice(0, 15) // Limit to 15 results
    .map((weapon) => {
      const icon = weapon.icon || '';
      const def = window.__manifest__.DestinyInventoryItemDefinition?.get?.(String(weapon.hash));
      const type = def?.itemTypeDisplayName || weapon.type || 'Unknown';
      const rarity = def?.inventory?.rarity || weapon.rarity || 'Common';

      return `
        <div class="weapon-search-result" data-hash="${weapon.hash}">
          <div class="search-result-icon">
            ${icon ? `<img src="${icon}" alt="${weapon.name}" />` : ''}
          </div>
          <div class="search-result-info">
            <div class="search-result-name">${weapon.name}</div>
            <div class="search-result-meta">${type} • ${rarity}</div>
          </div>
        </div>
      `;
    })
    .join('');

  // Add click listeners to results
  resultsDiv.querySelectorAll('.weapon-search-result').forEach((resultEl) => {
    resultEl.addEventListener('click', () => {
      const weaponHash = parseInt(resultEl.dataset.hash);
      selectWeapon(weaponHash);
    });
  });
}

/**
 * Select a weapon and load its stats & socket information.
 *
 * @param {number} weaponHash - Destiny 2 weapon hash
 */
async function selectWeapon(weaponHash) {
  const weaponManifest = window.__manifest__ || {};
  const weaponDef = weaponManifest.DestinyInventoryItemDefinition?.get?.(String(weaponHash));

  if (!weaponDef) {
    d2log(`Weapon ${weaponHash} not found in manifest`, 'weapon-ui', 'error');
    return;
  }

  // Load weapon data
  const stats = await window.__manifest__.getWeaponStats(weaponHash);
  const detailedSockets = await window.__manifest__.getDetailedWeaponSockets(weaponHash);

  weaponState.currentWeapon = {
    weaponHash,
    name: weaponDef.displayProperties?.name || 'Unknown',
    icon: weaponDef.displayProperties?.icon || '',
    type: weaponDef.itemTypeDisplayName || '',
    damageType:
      (Array.isArray(weaponDef.damageTypeHashes) && weaponDef.damageTypeHashes[0]) ||
      weaponDef.defaultDamageTypeHash ||
      null,
    stats,
    sockets: detailedSockets.sockets,
    socketCategories: detailedSockets.socketCategories,
    socketPerksMap: {}
  };

  d2log(
    `Damage debug: hash=${weaponHash}, damageTypeHashes=${JSON.stringify(
      weaponDef.damageTypeHashes || []
    )}, defaultDamageTypeHash=${weaponDef.defaultDamageTypeHash || null}`,
    'weapon-ui'
  );

  // Reset perks for new weapon
  weaponState.selectedPerks = {};
  addRecentWeaponSelection(weaponDef, weaponHash);

  d2log(`✅ Selected weapon: ${weaponState.currentWeapon.name}`, 'weapon-ui');

  // Populate enhanced header elements
  const headerEl = document.getElementById('w-selected-header');
  const screenshotEl = document.getElementById('w-selected-screenshot');
  const nameEl = document.getElementById('w-selected-name');
  const typeEl = document.getElementById('w-selected-type');
  const damageEl = document.getElementById('w-selected-damage');
  const ammoEl = document.getElementById('w-selected-ammo');
  const frameEl = document.getElementById('w-selected-frame');
  const activityEl = document.getElementById('w-selected-activity');
  const flavorEl = document.getElementById('w-selected-flavor');

  if (headerEl) {
    // Set weapon name
    if (nameEl) nameEl.textContent = weaponDef.displayProperties?.name || 'Unknown Weapon';
    
    // Set weapon type
    const itemType = weaponDef.itemTypeDisplayName || 'Weapon';
    if (typeEl) typeEl.textContent = itemType;
    
    // Set damage type with icon/color context
    const damageHash =
      (Array.isArray(weaponDef.damageTypeHashes) && weaponDef.damageTypeHashes[0]) ||
      weaponDef.defaultDamageTypeHash ||
      null;
    const damageType = getDamageTypeName(damageHash);
    if (damageEl) damageEl.textContent = damageType;
    
    // Set ammo type
    const ammoType = getAmmoTypeName(weaponDef.equippingBlock?.ammoType);
    if (ammoEl) ammoEl.textContent = ammoType;
    
    // Set weapon frame (intrinsic perk)
    const frame = getWeaponFrame(weaponDef);
    if (frameEl) {
      frameEl.innerHTML = '';
      if (frame && frame.name) {
        const frameWrap = document.createElement('div');
        frameWrap.className = 'w-frame-value';

        const iconWrap = document.createElement('div');
        iconWrap.className = 'w-frame-icon';
        const iconUrl = resolveBungieUrl(frame.icon);
        if (iconUrl) {
          iconWrap.style.backgroundImage = `url("${iconUrl}")`;
        } else {
          iconWrap.classList.add('w-frame-icon-empty');
        }

        const textWrap = document.createElement('div');
        textWrap.className = 'w-frame-text';

        const nameNode = document.createElement('div');
        nameNode.className = 'w-frame-name';
        nameNode.textContent = frame.name;

        const descNode = document.createElement('div');
        descNode.className = 'w-frame-desc';
        descNode.textContent = frame.description || '';
        if (!frame.description) {
          descNode.style.display = 'none';
        }

        textWrap.appendChild(nameNode);
        textWrap.appendChild(descNode);
        frameWrap.appendChild(iconWrap);
        frameWrap.appendChild(textWrap);
        frameEl.appendChild(frameWrap);
      } else {
        frameEl.textContent = 'Unknown Frame';
      }
    }
    
    // Set activity drops
    const activity = getActivityDrops(weaponDef) || 'Unknown';
    if (activityEl) activityEl.textContent = activity;
    
    // Set flavor text
    const flavorText = weaponDef.flavorText || '';
    if (flavorEl) {
      flavorEl.textContent = flavorText;
      flavorEl.style.display = flavorText ? 'block' : 'none';
    }
    
    // Set screenshot (only displayProperties.screenshot; no icon fallback)
    const screenshotPath = weaponDef.displayProperties?.screenshot || weaponDef.screenshot || '';
    const screenshotUrl = resolveBungieUrl(screenshotPath);

    if (screenshotEl) {
      screenshotEl.src = screenshotUrl;
      screenshotEl.style.display = screenshotUrl ? 'block' : 'none';
    }
    
    headerEl.classList.remove('hidden');
  }

  // Render weapon stats (base values only)
  renderWeaponStats();

  // Render perk slots and perks
  renderWeaponSockets();
  await renderWeaponPerks();
  // attachPerkClickListeners() handled within render loop now

  // Clear search results and scroll to perks
  const resultsDiv = document.getElementById('w-search-results');
  if (resultsDiv) {
    resultsDiv.innerHTML = '';
  }

  const perkSlotsLabel = document.getElementById('w-perk-slots');
  if (perkSlotsLabel) {
    perkSlotsLabel.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  // Enable save button
  const saveBtn = document.getElementById('w-save-btn');
  if (saveBtn) {
    saveBtn.disabled = false;
  }

  await updateWeaponStatDeltas();

  const searchInput = document.getElementById('w-search-input');
  if (searchInput) {
    searchInput.value = '';
  }

  renderRecentWeaponSelections();
}

function addRecentWeaponSelection(weaponDef, weaponHash) {
  const display = weaponDef?.displayProperties || {};
  const icon = resolveBungieUrl(display.icon || '');
  const entry = {
    hash: weaponHash,
    name: display.name || 'Unknown',
    icon,
    type: weaponDef?.itemTypeDisplayName || 'Unknown',
    rarity: weaponDef?.inventory?.rarity || 'Common',
  };

  const existingIndex = weaponState.recentSelections.findIndex((item) => item.hash === weaponHash);
  if (existingIndex !== -1) {
    weaponState.recentSelections.splice(existingIndex, 1);
  }

  weaponState.recentSelections.unshift(entry);
  weaponState.recentSelections = weaponState.recentSelections.slice(0, 10);
}

function renderRecentWeaponSelections() {
  const resultsDiv = document.getElementById('w-search-results');
  if (!resultsDiv) return;

  if (!weaponState.showHistory) {
    resultsDiv.innerHTML = '';
    return;
  }

  if (!weaponState.recentSelections.length) {
    resultsDiv.innerHTML = '<div style="text-align: center; color: #666; padding: 20px;">No recent weapons</div>';
    return;
  }

  renderWeaponSearchResults(weaponState.recentSelections);
}

/**
 * Render weapon stats table with base values.
 */
function clampStatValue(value) {
  const numeric = Number(value || 0);
  if (!Number.isFinite(numeric)) return 0;
  return numeric;
}

function normalizeStatName(name) {
  return String(name || "")
    .toLowerCase()
    .replace(/[^a-z]/g, "");
}

function buildStatDisplayList(stats) {
  const list = Array.isArray(stats?._list) ? stats._list.slice() : [];
  if (!list.length) return [];

  const labelOverrides = {
    airborneeffectiveness: "Air Effect",
  };

  const preferredOrder = [
    "impact",
    "range",
    "accuracy",
    "stability",
    "handling",
    "reload",
    "magazine",
    "aimAssistance",
    "zoom",
    "recoilDirection",
    "blastRadius",
    "velocity",
    "chargeTime",
    "drawTime",
    "shieldDuration",
    "guardResistance",
    "guardEfficiency",
    "guardEndurance",
  ];

  const orderMap = new Map(preferredOrder.map((key, index) => [key, index]));

  return list
    .filter((entry) => Number.isFinite(Number(entry?.value)) && Number(entry?.value) !== 0)
    .map((entry) => {
      const rawName = entry?.name || "Unknown";
      const normalized = normalizeStatName(rawName);
      return {
        key: entry?.key || null,
        name: labelOverrides[normalized] || rawName,
        value: Number(entry?.value || 0),
      };
    })
    .sort((a, b) => {
      const aIndex = a.key ? orderMap.get(a.key) : undefined;
      const bIndex = b.key ? orderMap.get(b.key) : undefined;
      if (aIndex !== undefined || bIndex !== undefined) {
        return (aIndex ?? 999) - (bIndex ?? 999);
      }
      return normalizeStatName(a.name).localeCompare(normalizeStatName(b.name));
    });
}

function renderWeaponStats(statDeltas = null) {
  if (!weaponState.currentWeapon) return;

  const statsTable = document.getElementById('w-stats-table');
  if (!statsTable) return;

  const stats = weaponState.currentWeapon.stats || {};
  const deltas = statDeltas || {};
  const statList = buildStatDisplayList(stats);

  const statRow = (name, baseValue, statKey) => {
    const base = clampStatValue(baseValue);
    const rawDelta = Number(deltas[statKey] || 0);
    const finalValue = clampStatValue(base + rawDelta);
    const displayDelta = finalValue - base;
    const deltaClass = displayDelta > 0 ? 'delta-positive' : displayDelta < 0 ? 'delta-negative' : 'delta-zero';

    const baseWidth = base;
    const deltaWidth = Math.abs(finalValue - base);
    const deltaLeft = displayDelta >= 0 ? base : finalValue;
    const deltaStyle = deltaWidth > 0
      ? `width: ${deltaWidth}%; left: ${deltaLeft}%;`
      : 'width: 0; left: 0;';

    return `
      <div class="stat-bar-row">
        <div class="stat-bar-name">${name}</div>
        <div class="stat-bar-track">
          <div class="stat-bar-base" style="width: ${baseWidth}%;"></div>
          <div class="stat-bar-delta ${displayDelta >= 0 ? 'positive' : 'negative'}" style="${deltaStyle}"></div>
        </div>
        <div class="stat-bar-values">
          ${base}
          <span class="${deltaClass}">${displayDelta > 0 ? '+' : ''}${displayDelta}</span>
          ${finalValue}
        </div>
      </div>
    `;
  };

  if (!statList.length) {
    statsTable.innerHTML = '<div style="color: #666; padding: 12px; text-align: center;">No stats available</div>';
    return;
  }

  statsTable.innerHTML = statList
    .map((entry) => statRow(entry.name, entry.value, entry.key))
    .join('');

  d2log('✅ Weapon stats rendered', 'weapon-ui');
}

/**
 * Maps detailed sockets to the 7-column layout.
 */
function mapSocketsToColumns(sockets, categories) {
  const columns = new Array(7).fill(null);
  
  if(!categories || !sockets) return columns;

  // Find Categories Definitions
  const perksCat = categories.find(c => c.socketCategoryHash === SOCKET_CATEGORY_HASHES.WEAPON_PERKS);
  const intrinsicCat = categories.find(c => c.socketCategoryHash === SOCKET_CATEGORY_HASHES.INTRINSIC_TRAITS);  
  const modsCat = categories.find(c => c.socketCategoryHash === SOCKET_CATEGORY_HASHES.WEAPON_MODS);

  // Map Weapon Perks (Cols 0-3 and 4)
  if (perksCat && perksCat.socketIndexes) {
    const indexes = perksCat.socketIndexes;
    // Cols 0-3: First 4 perks
    for (let i = 0; i < 4; i++) {
        if (indexes[i] !== undefined) columns[i] = sockets[indexes[i]];
    }
    // Col 4: Origin or 5th Perk
    if (indexes[4] !== undefined) columns[4] = sockets[indexes[4]];
  }

  // Col 5: Intrinsic / Frame
  if (intrinsicCat && intrinsicCat.socketIndexes && intrinsicCat.socketIndexes.length > 0) {
      columns[5] = sockets[intrinsicCat.socketIndexes[0]];
  }

  // Col 6: Mods
  if (modsCat && modsCat.socketIndexes && modsCat.socketIndexes.length > 0) {
      columns[6] = sockets[modsCat.socketIndexes[0]];
  }
  
  return columns;
}

function getSocketLabel(itemType, colIndex) {
  const labels = [
    "Barrel",   // 0
    "Magazine", // 1
    "Perk 1",   // 2
    "Perk 2",   // 3
    "Origin",   // 4
    "Frame",    // 5
    "Mod"       // 6
  ];
  
  if (itemType && itemType.includes("Bow") && colIndex === 0) return "String";
  if (itemType && itemType.includes("Bow") && colIndex === 1) return "Arrow";
  if (itemType && itemType.includes("Sword") && colIndex === 0) return "Blade";
  if (itemType && itemType.includes("Sword") && colIndex === 1) return "Guard";
  if (itemType && (itemType.includes("Glaive")) && colIndex === 0) return "Haft";

  return labels[colIndex] || "Socket";
}

/**
 * Renders the 7-column selector grid.
 */
function renderWeaponSockets() {
  if (!weaponState.currentWeapon) return;

  const container = document.getElementById('w-perk-slots');
  if (!container) return;

  // Clear and setup grid structure
  container.innerHTML = `
    <div class="perk-selector-container">
      <div class="selector-row" id="w-selector-row"></div>
      <div class="options-row" id="w-options-row" style="display:none;"></div>
    </div>
  `;

  const selectorRow = document.getElementById('w-selector-row');
  const columns = mapSocketsToColumns(weaponState.currentWeapon.sockets, weaponState.currentWeapon.socketCategories);
  const weaponType = weaponState.currentWeapon.type || "";

  columns.forEach((socket, colIndex) => {
    const el = document.createElement('div');
    const label = getSocketLabel(weaponType, colIndex);
    el.className = `selector-col ${!socket ? 'disabled' : ''}`;
    el.innerHTML = `
      <div class="selector-label">${label}</div>
      <div class="selector-icon" id="w-socket-display-${colIndex}"></div>
    `;

    if (socket) {
      el.addEventListener('click', () => selectSocketColumn(colIndex, socket.socketIndex));
    }

    selectorRow.appendChild(el);
  });
  
  d2log(`✅ Rendered 7 socket columns`, 'weapon-ui');
}

/**
 * Loads perk data without immediate rendering of buttons.
 */
async function renderWeaponPerks() {
  if (!weaponState.currentWeapon) return;
  const { sockets, weaponHash } = weaponState.currentWeapon;

  if (window.weaponStatsService?.ensureReady) {
    await window.weaponStatsService.ensureReady();
  }
  
  // Identify which sockets we care about
  const columns = mapSocketsToColumns(weaponState.currentWeapon.sockets, weaponState.currentWeapon.socketCategories);

  // Load perks for mapped sockets
  for (const socket of sockets) {
    // Only process if it's in our grid to save API calls
    const isMapped = columns.some(s => s && s.socketIndex === socket.socketIndex);
    if (!isMapped) continue;

    try {
      const perks = await window.__manifest__.getSocketPerks(weaponHash, socket.socketIndex);
      weaponState.socketPerksMap[socket.socketIndex] = perks || [];
      
      // Update the display to show current selection or default
      updateSocketDisplayIcon(socket.socketIndex);
    } catch (e) {
      console.error(`Error loading perks for socket ${socket.socketIndex}`, e);
    }
  }

  // Auto-select first active column (usually col 0) if available
  const firstActive = columns.findIndex(c => c !== null);
  if (firstActive !== -1) {
    selectSocketColumn(firstActive, columns[firstActive].socketIndex);
  }
}

function updateSocketDisplayIcon(socketIndex) {
  const columns = mapSocketsToColumns(weaponState.currentWeapon.sockets, weaponState.currentWeapon.socketCategories);
  const colIndex = columns.findIndex(s => s && s.socketIndex === socketIndex);
  if (colIndex === -1) return;

  const displayEl = document.getElementById(`w-socket-display-${colIndex}`);
  if (!displayEl) return;

  const perks = weaponState.socketPerksMap[socketIndex] || [];
  const selectedHash = weaponState.selectedPerks[socketIndex];
  
  let activePerk = perks.find(p => p.perkHash === selectedHash);
  
  if (!activePerk) {
     const socket = weaponState.currentWeapon.sockets.find(s => s.socketIndex === socketIndex);
     if (socket && socket.singleInitialItemHash) {
         activePerk = perks.find(p => p.perkHash === socket.singleInitialItemHash);
     }
  }
  
  if (!activePerk && perks.length > 0) activePerk = perks[0];

  if (activePerk && activePerk.icon) {
    const safeIcon = activePerk.icon.startsWith('http') ? activePerk.icon : `https://www.bungie.net${activePerk.icon}`;
    displayEl.style.backgroundImage = `url('${safeIcon}')`;
  } else {
    displayEl.style.backgroundImage = 'none';
  }
}

function selectSocketColumn(colIndex, socketIndex) {
  document.querySelectorAll('.selector-col').forEach((el, idx) => {
    el.classList.toggle('active', idx === colIndex);
  });

  const optionsRow = document.getElementById('w-options-row');
  optionsRow.style.display = 'flex';
  renderPerkOptions(socketIndex);
}

function renderPerkOptions(socketIndex) {
  const optionsRow = document.getElementById('w-options-row');
  optionsRow.innerHTML = '';

  const perks = weaponState.socketPerksMap[socketIndex] || [];
  
  if (perks.length === 0) {
    optionsRow.innerHTML = '<div style="color: #888; padding: 10px; font-size: 12px;">No options available</div>';
    return;
  }

  perks.forEach(perk => {
    const btn = document.createElement('div');
    btn.className = 'option-btn';
    if (weaponState.selectedPerks[socketIndex] === perk.perkHash) {
      btn.classList.add('selected');
    }

    const safeIcon = perk.icon && perk.icon.startsWith('http') ? perk.icon : `https://www.bungie.net${perk.icon}`;
    btn.style.backgroundImage = `url('${safeIcon}')`;
    btn.title = perk.perkName;

    btn.addEventListener('click', () => {
       weaponState.selectedPerks[socketIndex] = perk.perkHash;
       updateSocketDisplayIcon(socketIndex);
       updateWeaponStatDeltas();
       renderPerkOptions(socketIndex); 
    });

    optionsRow.appendChild(btn);
  });
}

function attachPerkClickListeners() {
  // Deprecated
}

/**
 * Calculate and update weapon stats based on selected perks.
 * Applies color coding to stat deltas (green for +, red for -, gray for 0).
 *
 * @returns {Promise<void>}
 */
async function updateWeaponStatDeltas() {
  if (!weaponState.currentWeapon) return;

  if (window.weaponStatsService?.ensureReady) {
    await window.weaponStatsService.ensureReady();
  }

  const stats = weaponState.currentWeapon.stats || {};
  const statDeltas = {};
  if (Array.isArray(stats._list)) {
    stats._list.forEach((entry) => {
      if (entry?.key) {
        statDeltas[entry.key] = 0;
      }
    });
  }

  for (const socketIndex in weaponState.selectedPerks) {
    const perkHash = weaponState.selectedPerks[socketIndex];
    const perkBonuses = window.weaponStatsService?.getStaticBonuses(perkHash) || {};

    for (const statName in perkBonuses) {
      if (statDeltas.hasOwnProperty(statName)) {
        statDeltas[statName] += perkBonuses[statName];
      }
    }
  }

  renderWeaponStats(statDeltas);
  d2log('✅ Weapon stat deltas updated', 'weapon-ui');
}


/**
 * Toggle between craft and list panes.
 *
 * @param {string} pane - "craft" or "list"
 */
function togglePane(pane) {
  const slider = document.querySelector('.weapon-view-slider');
  if (!slider) return;

  if (pane === 'craft') {
    slider.style.transform = 'translateX(0)';
  } else if (pane === 'list') {
    slider.style.transform = 'translateX(-50%)';
  }

  // Update nav buttons
  const navWCraftBtn = document.getElementById('nav-w-craft');
  const navWListBtn = document.getElementById('nav-w-list');

  if (navWCraftBtn) navWCraftBtn.classList.toggle('active', pane === 'craft');
  if (navWListBtn) navWListBtn.classList.toggle('active', pane === 'list');

  d2log(`✅ Switched to ${pane} pane`, 'weapon-ui');
}

/**
 * Toggle mode button state.
 *
 * @param {string} mode - "pve" or "pvp"
 */
function toggleModeButton(mode) {
  const pvePveBtn = document.getElementById('w-pve-btn');
  const pvpPvpBtn = document.getElementById('w-pvp-btn');

  if (pvePveBtn) pvePveBtn.classList.toggle('active', mode === 'pve');
  if (pvpPvpBtn) pvpPvpBtn.classList.toggle('active', mode === 'pvp');

  d2log(`✅ Switched to ${mode.toUpperCase()} mode`, 'weapon-ui');
}

/**
 * Refresh weapon list view and populate with saved wishes.
 * Phase 8: Complete list view rendering with live filtering.
 *
 * @returns {Promise<void>}
 */
async function refreshWeaponList() {
  d2log('📋 Loading weapon list...', 'weapon-ui');

  try {
    // Load all wishes for active list
    const wishes = await weaponManager.loadWeaponWishes();

    // Show/hide empty state
    const emptyState = document.getElementById('w-empty-state');
    const listContainer = document.getElementById('w-weapon-list');

    if (!wishes || wishes.length === 0) {
      if (emptyState) emptyState.style.display = 'block';
      if (listContainer) listContainer.innerHTML = '';
      d2log('No weapons found', 'weapon-ui');
      return;
    }

    if (emptyState) emptyState.style.display = 'none';

    // Populate filter toggles with available options
    await populateFilterOptions(wishes);

    // Get filtered wishes and render cards
    await updateListView();

    d2log(`✅ Weapon list loaded (${wishes.length} total)`, 'weapon-ui');
  } catch (error) {
    d2log(`❌ Error loading weapon list: ${error.message}`, 'weapon-ui', 'error');
    const listContainer = document.getElementById('w-weapon-list');
    if (listContainer) {
      listContainer.innerHTML = '<div style="text-align: center; color: #f87171; padding: 40px;">Error loading weapons</div>';
    }
  }
}

/**
 * Populate filter toggle buttons with available weapon types and damage types.
 *
 * @param {Array} wishes - Array of loaded wishes
 * @returns {Promise<void>}
 */
async function populateFilterOptions(wishes) {
  const uniqueTypes = new Set();
  const uniqueDamageTypes = new Map(); // hash -> name

  wishes.forEach((item) => {
    if (item.static?.type) uniqueTypes.add(item.static.type);
    if (item.icon && item.wish) {
      const damageHash = item.static?.damageType || null;
      if (damageHash && !uniqueDamageTypes.has(damageHash)) {
        // Map damage type hash to UI name
        const damageName = getDamageTypeName(damageHash);
        uniqueDamageTypes.set(damageHash, damageName);
      }
    }
  });

  // Update filter toggles
  const filterToggles = document.querySelectorAll('.filter-toggle[data-filter]');
  filterToggles.forEach((toggle) => {
    const filterType = toggle.dataset.filter;

    if (filterType === 'type' && uniqueTypes.size > 0) {
      toggle.innerHTML = `${Array.from(uniqueTypes).length} TYPES`;
      toggle.dataset.optionValue = null; // Will be set on click
    } else if (filterType === 'damage' && uniqueDamageTypes.size > 0) {
      toggle.innerHTML = `${Array.from(uniqueDamageTypes.values()).length} ELEMENTS`;
      toggle.dataset.optionValue = null;
    }
  });

  // Store for later use in filter click handlers
  weaponState._weaponTypes = Array.from(uniqueTypes);
  weaponState._damageTypes = uniqueDamageTypes;
}

/**
 * Map damage type hash to display name.
 *
 * @param {number} damageHash - Destiny 2 damage type hash
 * @returns {string} Display name (Solar, Arc, Void, Stasis, Strand, Kinetic)
 */
function getDamageTypeName(damageHash) {
  const normalizedHash = Number(damageHash);
  if (!Number.isFinite(normalizedHash)) return 'Unknown';
  const damageTypeDefs = window.__manifest__?.DestinyDamageTypeDefinition;
  if (damageTypeDefs && typeof damageTypeDefs.get === 'function') {
    const def = damageTypeDefs.get(String(normalizedHash));
    const name = def?.displayProperties?.name || def?.name || null;
    if (name) return name;
  }
  const damageTypeMap = {
    1847026933: 'Kinetic',
    2303181850: 'Arc',
    3469412976: 'Solar',
    2654673791: 'Void',
    3949847137: 'Stasis',
    1461471453: 'Strand',
  };
  return damageTypeMap[normalizedHash] || 'Unknown';
}

/**
 * Map ammo type to display name.
 *
 * @param {number} ammoType - Destiny 2 ammo type (1 = Primary, 2 = Special, 3 = Heavy)
 * @returns {string} Display name (Primary, Special, Heavy)
 */
function getAmmoTypeName(ammoType) {
  const ammoTypeMap = {
    1: 'Primary',
    2: 'Special',
    3: 'Heavy',
  };
  return ammoTypeMap[ammoType] || 'Unknown';
}

/**
 * Extract weapon frame (intrinsic perk) from weapon definition.
 *
 * @param {Object} weaponDef - Weapon definition object
 * @returns {Object} Frame info with name, description, and icon
 */
function getWeaponFrame(weaponDef) {
  const socketEntries = weaponDef?.sockets?.socketEntries;
  if (!Array.isArray(socketEntries) || socketEntries.length === 0) {
    return buildFrameFallback(weaponDef);
  }

  const itemDefs = window.__manifest__?.DestinyInventoryItemDefinition;
  const candidates = [];

  socketEntries.forEach((socketEntry, index) => {
    const plugHash = socketEntry?.singleInitialItemHash;
    if (!plugHash || !itemDefs || typeof itemDefs.get !== 'function') return;
    const plugDef = itemDefs.get(String(plugHash));
    if (!plugDef) return;
    const score = scoreIntrinsicPlug(plugDef);
    candidates.push({ score, index, plugDef });
  });

  const best = candidates
    .filter((candidate) => candidate.score > 0)
    .sort((a, b) => b.score - a.score)[0];

  const fallback = candidates.sort((a, b) => a.index - b.index)[0];
  const chosen = best || fallback;
  if (!chosen || !chosen.plugDef) {
    return buildFrameFallback(weaponDef);
  }

  const display = chosen.plugDef.displayProperties || {};
  const name = display.name || weaponDef.itemTypeDisplayName || 'Unknown Frame';
  const description = display.description || '';
  const icon = display.icon || '';

  return { name, description, icon };
}

function buildFrameFallback(weaponDef) {
  const name = weaponDef?.itemTypeDisplayName || 'Unknown Frame';
  return { name, description: '', icon: '' };
}

function scoreIntrinsicPlug(plugDef) {
  let score = 0;
  const plugCategory = (plugDef?.plug?.plugCategoryIdentifier || '').toLowerCase();
  const name = (plugDef?.displayProperties?.name || '').toLowerCase();
  const typeName = (plugDef?.itemTypeDisplayName || '').toLowerCase();

  if (plugCategory.includes('intrinsic')) score += 3;
  if (plugCategory.includes('frame')) score += 2;
  if (name.includes('frame')) score += 2;
  if (typeName.includes('frame')) score += 2;

  return score;
}

function resolveBungieUrl(assetPath) {
  if (!assetPath) return '';
  if (
    assetPath.startsWith('http') ||
    assetPath.startsWith('data:') ||
    assetPath.startsWith('blob:') ||
    assetPath.startsWith('chrome-extension:') ||
    assetPath.startsWith('moz-extension:')
  ) {
    return assetPath;
  }
  if (assetPath.startsWith('//')) return `https:${assetPath}`;
  if (assetPath.startsWith('/')) {
    const bungieRoot = typeof BUNGIE_ROOT !== 'undefined' ? BUNGIE_ROOT : 'https://www.bungie.net';
    return `${bungieRoot}${assetPath}`;
  }
  return assetPath;
}

/**
 * Extract activity/source where weapon drops.
 *
 * @param {Object} weaponDef - Weapon definition object
 * @returns {string} Activity name or source
 */
function getActivityDrops(weaponDef) {
  // Check the sourceString first (most reliable)
  if (weaponDef.sourceString) {
    return weaponDef.sourceString;
  }
  
  // Check sources array
  if (weaponDef.sources && Array.isArray(weaponDef.sources) && weaponDef.sources.length > 0) {
    return weaponDef.sources[0]?.displayProperties?.name || 'Various';
  }
  
  // Check description for activity hints
  if (weaponDef.displayProperties?.description) {
    const desc = weaponDef.displayProperties.description;
    // Look for common activity keywords
    if (desc.includes('Nightfall')) return 'Nightfall';
    if (desc.includes('Raid')) return 'Raid';
    if (desc.includes('Crucible')) return 'Crucible';
    if (desc.includes('Gambit')) return 'Gambit';
    if (desc.includes('Strike')) return 'Strikes';
  }
  
  return 'World Drops';
}

/**
 * Build filters object from UI state and apply them.
 *
 * @returns {Promise<Array>} Filtered wishes array
 */
async function applyFilters() {
  const searchInput = document.getElementById('w-list-search');
  const searchText = searchInput?.value?.trim() || '';

  const filters = {};

  // Search text filter
  if (searchText) {
    filters.searchText = searchText;
  }

  // Weapon type filter (string comparison)
  if (weaponState._selectedType) {
    filters.weaponType = weaponState._selectedType;
  }

  // Damage type filter (hash comparison)
  if (weaponState._selectedDamage) {
    filters.damageType = weaponState._selectedDamage;
  }

  // Mode filter (only if not default PvE)
  if (weaponState.currentMode && weaponState.currentMode !== 'pve') {
    filters.mode = weaponState.currentMode;
  }

  const filtered = await weaponManager.applyWeaponFilters(filters);
  return filtered;
}

/**
 * Render weapon cards from filtered wishes array.
 *
 * @param {Array} wishes - Array of filtered wishes
 * @returns {void}
 */
function renderWeaponCards(wishes) {
  const listContainer = document.getElementById('w-weapon-list');
  if (!listContainer) return;

  if (!wishes || wishes.length === 0) {
    listContainer.innerHTML = '<div style="text-align: center; color: #666; padding: 40px;">No weapons match filters</div>';
    return;
  }

  const cardsHTML = wishes
    .map((item, index) => createWeaponCardHTML(item, index))
    .join('');

  listContainer.innerHTML = cardsHTML;

  // Attach event listeners to delete buttons and weapon cards
  attachWeaponCardListeners();
}

/**
 * Create weapon card HTML element.
 *
 * @param {Object} item - Wish item {weaponHash, weaponName, weaponType, icon, wish, damageType}
 * @param {number} index - Index in the wishes array
 * @returns {string} HTML string for weapon card
 */
function createWeaponCardHTML(item, index) {
  const { weaponHash, weaponName, weaponType, icon, wish, damageType } = item;

  // Get perk information
  const perks = getPerkDisplayInfo(wish);
  const perksHTML = perks
    .map((perk) => `<div class="weapon-perk-item"><span class="perk-badge">${perk}</span></div>`)
    .join('');

  // Damage type name
  const damageTypeName = damageType ? getDamageTypeName(damageType) : 'Kinetic';

  // Mode badge
  const modeBadge = wish.mode ? wish.mode.toUpperCase() : 'PVE';

  // Icon URL (handle full URL or CDN path)
  const iconURL = icon && icon.startsWith('http') ? icon : `${icon || ''}`;

  return `
    <div class="weapon-card" data-weapon-hash="${weaponHash}" data-wish-index="${index}">
      <div class="weapon-card-header">
        <div class="weapon-icon">
          ${icon ? `<img src="${iconURL}" alt="${weaponName}" onerror="this.style.display='none'">` : ''}
        </div>
        <div class="weapon-header-text">
          <div class="weapon-name">${weaponName}</div>
          <div class="weapon-type-damage">${weaponType} • ${damageTypeName}</div>
        </div>
        <button class="weapon-card-delete" data-weapon-hash="${weaponHash}" data-wish-index="${index}" type="button">DELETE</button>
      </div>
      <div class="weapon-perks">
        ${perksHTML}
        <div class="weapon-mode-badge">${modeBadge} MODE</div>
      </div>
    </div>
  `;
}

/**
 * Extract perk display info from wish config.
 *
 * @param {Object} wish - Wish object {config, displayString}
 * @returns {Array<string>} Array of perk display strings
 */
function getPerkDisplayInfo(wish) {
  if (!wish || !wish.config) return [];

  // Parse displayString for perk names (e.g., "Arrowhead Brake + Ricochet Rounds + Rampage")
  const displayString = wish.displayString || '';
  if (!displayString) return [];

  // Split by " + " to get individual perk names
  const perkNames = displayString.split(/\s*\+\s*/).slice(0, 5); // Show up to 5 perks
  return perkNames.map((name) => name.trim()).filter((name) => name.length > 0);
}

/**
 * Update list view after filter changes.
 * Called when search or filters change.
 *
 * @returns {Promise<void>}
 */
async function updateListView() {
  try {
    const filtered = await applyFilters();
    renderWeaponCards(filtered);

    // Update empty state visibility
    const emptyState = document.getElementById('w-empty-state');
    const listContainer = document.getElementById('w-weapon-list');

    if (!filtered || filtered.length === 0) {
      if (emptyState) emptyState.style.display = 'block';
    } else {
      if (emptyState) emptyState.style.display = 'none';
    }

    d2log(`Updated list view: ${filtered?.length || 0} weapons shown`, 'weapon-ui');
  } catch (error) {
    d2log(`❌ Error updating list view: ${error.message}`, 'weapon-ui', 'error');
  }
}

/**
 * Attach event listeners to filter toggles, search input, and delete buttons.
 * Uses event delegation for dynamic elements.
 *
 * @returns {void}
 */
function attachFilterListeners() {
  // Search input (debounced)
  const searchInput = document.getElementById('w-list-search');
  if (searchInput) {
    let searchTimeout;
    searchInput.addEventListener('input', () => {
      clearTimeout(searchTimeout);
      searchTimeout = setTimeout(() => {
        updateListView();
      }, 300);
    });
  }

  // Filter toggle buttons
  const filterToggles = document.querySelectorAll('.filter-toggle[data-filter]');
  filterToggles.forEach((toggle) => {
    toggle.addEventListener('click', handleFilterToggleClick);
  });

  // Clear filters button
  const clearFiltersBtn = document.getElementById('w-clear-filters');
  if (clearFiltersBtn) {
    clearFiltersBtn.addEventListener('click', () => {
      // Reset filter state
      weaponState._selectedType = null;
      weaponState._selectedDamage = null;
      weaponState.currentMode = 'pve';

      // Clear search
      const searchInput = document.getElementById('w-list-search');
      if (searchInput) searchInput.value = '';

      // Clear active classes and reset button labels
      filterToggles.forEach((toggle) => {
        toggle.classList.remove('active');
        const filterType = toggle.dataset.filter;
        if (filterType === 'type') {
          toggle.innerHTML = 'ALL TYPES';
        } else if (filterType === 'damage') {
          toggle.innerHTML = 'ALL ELEMENTS';
        } else if (filterType === 'mode') {
          toggle.innerHTML = 'ALL MODES';
        }
      });

      // Update PvE button to active
      const pvePveBtn = document.getElementById('w-pve-btn');
      const pvpPvpBtn = document.getElementById('w-pvp-btn');
      if (pvePveBtn) pvePveBtn.classList.add('active');
      if (pvpPvpBtn) pvpPvpBtn.classList.remove('active');

      // Update list
      updateListView();
    });
  }

  // Weapon card delete buttons (delegated)
  const listContainer = document.getElementById('w-weapon-list');
  if (listContainer) {
    listContainer.addEventListener('click', (event) => {
      const deleteBtn = event.target.closest('.weapon-card-delete');
      if (deleteBtn) {
        const weaponHash = parseInt(deleteBtn.dataset.weaponHash);
        const wishIndex = parseInt(deleteBtn.dataset.wishIndex);
        handleDeleteWeapon(weaponHash, wishIndex);
      }
    });
  }

  d2log('✅ Filter listeners attached', 'weapon-ui');
}

/**
 * Handle filter toggle button clicks.
 * Toggles active state and cycles through available filter options.
 *
 * @param {Event} event - Click event
 * @returns {void}
 */
function handleFilterToggleClick(event) {
  const toggle = event.currentTarget;
  const filterType = toggle.dataset.filter;

  if (filterType === 'type') {
    toggle.classList.toggle('active');
    if (toggle.classList.contains('active') && weaponState._weaponTypes?.length > 0) {
      // Cycle to first available type
      weaponState._selectedType = weaponState._weaponTypes[0];
      toggle.innerHTML = `${weaponState._selectedType.toUpperCase()}`;
    } else {
      weaponState._selectedType = null;
      toggle.innerHTML = 'ALL TYPES';
      toggle.classList.remove('active');
    }
  } else if (filterType === 'damage') {
    toggle.classList.toggle('active');
    if (toggle.classList.contains('active') && weaponState._damageTypes?.size > 0) {
      // Get first available damage type
      const damageEntries = Array.from(weaponState._damageTypes.entries());
      if (damageEntries.length > 0) {
        const [hash, name] = damageEntries[0];
        weaponState._selectedDamage = hash;
        toggle.innerHTML = `${name.toUpperCase()}`;
      }
    } else {
      weaponState._selectedDamage = null;
      toggle.innerHTML = 'ALL ELEMENTS';
      toggle.classList.remove('active');
    }
  }

  updateListView();
}

/**
 * Attach listeners to weapon card elements.
 * Handles card clicks and delete button interactions.
 *
 * @returns {void}
 */
function attachWeaponCardListeners() {
  const cards = document.querySelectorAll('.weapon-card');

  cards.forEach((card) => {
    const deleteBtn = card.querySelector('.weapon-card-delete');

    // Card click (open craft pane with weapon selected) - Phase 9
    card.addEventListener('click', (event) => {
      if (event.target.closest('.weapon-card-delete')) return; // Skip if delete button clicked
      const weaponHash = parseInt(card.dataset.weaponHash);
      selectWeapon(weaponHash);
      togglePane('craft');
    });

    // Delete button styling on hover
    if (deleteBtn) {
      deleteBtn.addEventListener('mousedown', () => {
        deleteBtn.style.opacity = '0.7';
      });
      deleteBtn.addEventListener('mouseup', () => {
        deleteBtn.style.opacity = '1';
      });
    }
  });
}

/**
 * Handle save button click - Phase 6 will fully implement this.
 * Stub for now.
 */
async function handleSaveWeaponWish() {
  if (!weaponState.currentWeapon) {
    d2log('No weapon selected', 'weapon-ui', 'error');
    return;
  }

  // Phase 6: Generate displayString from selectedPerks
  // Phase 6: Call weaponManager.saveWeaponWish()
  
  d2log('💾 Save weapon - Phase 6 implementation pending', 'weapon-ui');
}

/**
 * Handle delete button click - Delete a weapon wish.
 *
 * @param {number} weaponHash - Weapon inventory hash
 * @param {number} wishIndex - Index of wish to delete in the wishes array
 * @returns {Promise<void>}
 */
async function handleDeleteWeapon(weaponHash, wishIndex) {
  try {
    const result = await weaponManager.deleteWeaponWish(weaponHash, wishIndex);

    if (result.success) {
      d2log(`🗑️ ${result.message}`, 'weapon-ui');
      // Refresh list view
      await updateListView();
    } else {
      d2log(`❌ Failed to delete: ${result.message}`, 'weapon-ui', 'error');
    }
  } catch (error) {
    d2log(`❌ Error deleting weapon: ${error.message}`, 'weapon-ui', 'error');
  }
}

/* ============================================================
   PUBLIC INTERFACE & AUTO-INIT
   ============================================================ */

window.weaponUI = {
  initWeaponCraft,
  triggerWeaponSearch,
  selectWeapon,
  togglePane,
  toggleModeButton,
  refreshWeaponList,
  renderWeaponCards,
  updateListView,
  applyFilters,
  attachFilterListeners,
  handleSaveWeaponWish,
  handleDeleteWeapon,
  renderWeaponSearchResults,
  renderWeaponStats,
  renderWeaponSockets,
  renderWeaponPerks,
  attachPerkClickListeners,
  updateWeaponStatDeltas,
  shutdownWeaponSearchWorker,
  resetWeaponSearchWorker,
  weaponState,
};

// Auto-initialize when DOM ready
document.addEventListener('DOMContentLoaded', () => {
  initWeaponCraft().catch((error) => {
    d2log(`Weapon UI init failed: ${error.message || error}`, 'weapon-ui', 'error');
  });
  d2log('✅ Weapon UI module loaded', 'weapon-ui');
});
