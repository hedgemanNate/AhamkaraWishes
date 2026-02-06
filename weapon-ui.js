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
  currentFilters: {}, // Search/filter state
  currentPane: 'craft', // "craft" or "list"
  // List view filter state
  _weaponTypes: [], // Array of available weapon types
  _damageTypes: new Map(), // Map of damageHash -> damageTypeName
  _selectedType: null, // Currently selected weapon type
  _selectedDamage: null, // Currently selected damage type hash
};

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

/**
 * Initialize weapon crafting UI: attach event listeners, setup state.
 */
function initWeaponCraft() {
  initWeaponSearchWorker();

  // Search input (debounced)
  const searchInput = document.getElementById('w-search-input');
  if (searchInput) {
    let searchTimeout;
    searchInput.addEventListener('input', (event) => {
      clearTimeout(searchTimeout);
      const query = event.target.value.trim();
      searchTimeout = setTimeout(() => {
        triggerWeaponSearch(query);
      }, 300);
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
  if (!query || query.length < 2) {
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
  const sockets = await window.__manifest__.getWeaponSockets(weaponHash);

  weaponState.currentWeapon = {
    weaponHash,
    name: weaponDef.displayProperties?.name || 'Unknown',
    icon: weaponDef.displayProperties?.icon || '',
    stats,
    sockets,
  };

  // Reset perks for new weapon
  weaponState.selectedPerks = {};

  d2log(`✅ Selected weapon: ${weaponState.currentWeapon.name}`, 'weapon-ui');

  // Redesign: Populate new header elements
  const headerEl = document.getElementById('w-selected-header');
  const iconEl = document.getElementById('w-selected-icon');
  const nameEl = document.getElementById('w-selected-name');
  const typeEl = document.getElementById('w-selected-type');

  if (headerEl) {
    if (iconEl) iconEl.src = weaponDef.displayProperties?.icon || '';
    if (nameEl) nameEl.textContent = weaponDef.displayProperties?.name || 'Unknown Weapon';
    
    // Construct "Type • Damage" string
    const itemType = weaponDef.itemTypeDisplayName || 'Weapon';
    const damageType = getDamageTypeName(weaponDef.defaultDamageTypeHash);
    if (typeEl) typeEl.textContent = `${itemType} • ${damageType}`;
    
    headerEl.classList.remove('hidden');
  }

  // NOTE: Rendering logic for perks/stats bypassed for UI rework
  /*
  // Render weapon stats (base values only)
  renderWeaponStats();

  // Render perk slots and perks
  renderWeaponSockets();
  await renderWeaponPerks();
  attachPerkClickListeners();

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
  */

  // Clear results if still present
  const resultsDiv = document.getElementById('w-search-results');
  if (resultsDiv) {
    resultsDiv.innerHTML = '';
  }
}

/**
 * Render weapon stats table with base values.
 */
function renderWeaponStats() {
  if (!weaponState.currentWeapon) return;

  const statsTable = document.getElementById('w-stats-table');
  if (!statsTable) return;

  const stats = weaponState.currentWeapon.stats || {};

  const statRow = (name, baseValue) => {
    const finalValue = baseValue;
    const delta = 0;
    const deltaClass = delta > 0 ? 'positive' : delta < 0 ? 'negative' : 'zero';

    return `
      <div class="stat-row">
        <div class="stat-name">${name}</div>
        <div class="stat-value">${baseValue || 0}</div>
        <div class="stat-delta ${deltaClass}">${delta > 0 ? '+' : ''}${delta || 0}</div>
        <div class="stat-final">${finalValue || 0}</div>
      </div>
    `;
  };

  statsTable.innerHTML = `
    ${statRow('Impact', stats.impact || 0)}
    ${statRow('Range', stats.range || 0)}
    ${statRow('Stability', stats.stability || 0)}
    ${statRow('Handling', stats.handling || 0)}
    ${statRow('Reload Speed', stats.reload || 0)}
    ${statRow('Magazine', stats.magazine || 0)}
    ${statRow('Zoom', stats.zoom || 0)}
    ${statRow('Aim Assist', stats.aimAssistance || 0)}
    ${statRow('Recoil Direction', stats.recoilDirection || 0)}
  `;

  d2log('✅ Weapon stats rendered', 'weapon-ui');
}

/**
 * Render perk socket slots (Phase 6 will add perk selection UI).
 */
function renderWeaponSockets() {
  if (!weaponState.currentWeapon) return;

  const perkSlotsContainer = document.getElementById('w-perk-slots');
  if (!perkSlotsContainer) return;

  const sockets = weaponState.currentWeapon.sockets || [];
  if (sockets.length === 0) {
    perkSlotsContainer.innerHTML = '<div style="color: #666; padding: 20px; text-align: center;">No weapon sockets found</div>';
    return;
  }

  const socketNames = ['Barrel', 'Magazine', 'Trait', 'Origin', 'Exotic Perk', 'Enhancement'];
  const slotHTML = sockets
    .map((socket, index) => {
      const socketName = socketNames[index] || `Socket ${index + 1}`;
      return `
        <div class="perk-slot" data-socket-index="${index}">
          <div class="perk-slot-label">${socketName}</div>
          <div class="perk-buttons" id="perk-slot-${index}">
            <!-- Phase 6: populate with available perks -->
          </div>
        </div>
      `;
    })
    .join('');

  perkSlotsContainer.innerHTML = slotHTML;

  // Phase 6: Add perk selection logic here
  d2log(`✅ Rendered ${sockets.length} socket slots`, 'weapon-ui');
}

/**
 * Populate perk slots with clickable perk buttons for each socket.
 * Called after renderWeaponSockets() when weapon is selected.
 *
 * @returns {Promise<void>}
 */
async function renderWeaponPerks() {
  if (!weaponState.currentWeapon) return;

  const weaponHash = weaponState.currentWeapon.weaponHash;
  const sockets = weaponState.currentWeapon.sockets || [];

  for (let socketIndex = 0; socketIndex < sockets.length; socketIndex++) {
    const perkContainer = document.getElementById(`perk-slot-${socketIndex}`);
    if (!perkContainer) continue;

    try {
      const perks = await window.__manifest__.getSocketPerks(weaponHash, socketIndex);

      if (!perks || perks.length === 0) {
        perkContainer.innerHTML = '<div style="color: #666; font-size: 11px; padding: 10px;">No perks available</div>';
        continue;
      }

      const perkHTML = perks
        .map((perk) => {
          const isSelected = weaponState.selectedPerks[socketIndex] === perk.perkHash;
          const displayName = perk.perkName.length > 15 
            ? perk.perkName.substring(0, 12) + '...' 
            : perk.perkName;
          
          const iconStyle = perk.icon 
            ? `background-image: url('${perk.icon}'); background-size: cover; background-position: center;`
            : '';

          return `
            <button 
              class="perk-btn ${isSelected ? 'selected' : ''}" 
              data-perk-hash="${perk.perkHash}" 
              data-socket-index="${socketIndex}"
              title="${perk.perkName}"
              type="button"
            >
              ${iconStyle ? `<div style="${iconStyle}; width: 100%; height: 40px; margin-bottom: 4px; border-radius: 3px;"></div>` : ''}
              <span style="font-size: 8px; line-height: 1.2;">${displayName}</span>
            </button>
          `;
        })
        .join('');

      perkContainer.innerHTML = perkHTML;
    } catch (error) {
      d2log(`Error loading perks for socket ${socketIndex}: ${error.message}`, 'weapon-ui', 'error');
      perkContainer.innerHTML = '<div style="color: #f87171; font-size: 11px; padding: 10px;">Error loading perks</div>';
    }
  }

  d2log(`✅ Rendered perks for ${sockets.length} sockets`, 'weapon-ui');
}

/**
 * Attach click event listeners to all perk buttons.
 * Handles perk selection toggling and stat recalculation.
 */
function attachPerkClickListeners() {
  const perkButtons = document.querySelectorAll('.perk-btn');

  perkButtons.forEach((button) => {
    button.addEventListener('click', async () => {
      const perkHash = parseInt(button.dataset.perkHash);
      const socketIndex = parseInt(button.dataset.socketIndex);

      // Toggle selection logic
      const currentSelection = weaponState.selectedPerks[socketIndex];
      
      if (currentSelection === perkHash) {
        // Deselect if clicking same perk
        delete weaponState.selectedPerks[socketIndex];
        button.classList.remove('selected');
      } else {
        // Select new perk
        weaponState.selectedPerks[socketIndex] = perkHash;
        
        // Remove selected class from other perks in this socket
        const socketContainer = document.getElementById(`perk-slot-${socketIndex}`);
        if (socketContainer) {
          socketContainer.querySelectorAll('.perk-btn').forEach((btn) => {
            btn.classList.remove('selected');
          });
        }
        
        // Add selected class to clicked button
        button.classList.add('selected');
      }

      d2log(`✅ Perk ${perkHash} toggled for socket ${socketIndex}`, 'weapon-ui');

      // Recalculate stats
      await updateWeaponStatDeltas();
    });
  });

  d2log('✅ Perk click listeners attached', 'weapon-ui');
}

/**
 * Calculate and update weapon stats based on selected perks.
 * Applies color coding to stat deltas (green for +, red for -, gray for 0).
 *
 * @returns {Promise<void>}
 */
async function updateWeaponStatDeltas() {
  if (!weaponState.currentWeapon) return;

  const stats = weaponState.currentWeapon.stats || {};
  const perkStatBonuses = window.__manifest__.PERK_STAT_BONUSES || {};

  // Calculate total deltas from all selected perks
  const statDeltas = {
    impact: 0,
    range: 0,
    stability: 0,
    handling: 0,
    reload: 0,
    magazine: 0,
    zoom: 0,
    aimAssistance: 0,
    recoilDirection: 0,
  };

  for (const socketIndex in weaponState.selectedPerks) {
    const perkHash = weaponState.selectedPerks[socketIndex];
    const perkBonuses = perkStatBonuses[perkHash] || {};

    for (const statName in perkBonuses) {
      if (statDeltas.hasOwnProperty(statName)) {
        statDeltas[statName] += perkBonuses[statName];
      }
    }
  }

  // Update stats table with deltas and final values
  const statsTable = document.getElementById('w-stats-table');
  if (!statsTable) return;

  const statRow = (name, baseValue, statKey) => {
    const delta = statDeltas[statKey] || 0;
    const finalValue = baseValue + delta;
    const deltaClass = delta > 0 ? 'positive' : delta < 0 ? 'negative' : 'zero';

    return `
      <div class="stat-row">
        <div class="stat-name">${name}</div>
        <div class="stat-value">${baseValue || 0}</div>
        <div class="stat-delta ${deltaClass}">${delta > 0 ? '+' : ''}${delta || 0}</div>
        <div class="stat-final">${finalValue || 0}</div>
      </div>
    `;
  };

  statsTable.innerHTML = `
    ${statRow('Impact', stats.impact || 0, 'impact')}
    ${statRow('Range', stats.range || 0, 'range')}
    ${statRow('Stability', stats.stability || 0, 'stability')}
    ${statRow('Handling', stats.handling || 0, 'handling')}
    ${statRow('Reload Speed', stats.reload || 0, 'reload')}
    ${statRow('Magazine', stats.magazine || 0, 'magazine')}
    ${statRow('Zoom', stats.zoom || 0, 'zoom')}
    ${statRow('Aim Assist', stats.aimAssistance || 0, 'aimAssistance')}
    ${statRow('Recoil Direction', stats.recoilDirection || 0, 'recoilDirection')}
  `;

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
    if (item.weaponType) uniqueTypes.add(item.weaponType);
    if (item.icon && item.wish) {
      const damageHash = item.damageType || null;
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
  const damageTypeMap = {
    1847026933: 'Kinetic',
    2303181850: 'Arc',
    3469412976: 'Solar',
    2654673791: 'Void',
    3949847137: 'Stasis',
    1461471453: 'Strand',
  };
  return damageTypeMap[damageHash] || 'Unknown';
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
  weaponState,
};

// Auto-initialize when DOM ready
document.addEventListener('DOMContentLoaded', () => {
  initWeaponCraft();
  d2log('✅ Weapon UI module loaded', 'weapon-ui');
});
