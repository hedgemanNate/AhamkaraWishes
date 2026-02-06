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
};

/**
 * Initialize weapon crafting UI: attach event listeners, setup state.
 */
function initWeaponCraft() {
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
      refreshWeaponList(); // Load list view
    });
  }

  // Collapsible sections
  const collapsibleHeaders = document.querySelectorAll('.weapon-section.collapsible .section-header');
  collapsibleHeaders.forEach((header) => {
    header.addEventListener('click', () => {
      toggleCollapsible(header);
    });
  });

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
function triggerWeaponSearch(query, type = null) {
  if (!query || query.length < 2) {
    const resultsDiv = document.getElementById('w-search-results');
    if (resultsDiv) {
      resultsDiv.innerHTML = '';
    }
    return;
  }

  // Search using manifest function from Phase 1
  const weapons = window.__manifest__.searchWeaponsLocally(query, type);
  renderWeaponSearchResults(weapons);
}

/**
 * Render search results as clickable weapon cards.
 *
 * @param {Array} weapons - Array of weapon definitions from manifest
 */
function renderWeaponSearchResults(weapons) {
  const resultsDiv = document.getElementById('w-search-results');
  if (!resultsDiv) return;

  if (!weapons || weapons.length === 0) {
    resultsDiv.innerHTML = '<div style="text-align: center; color: #666; padding: 20px;">No weapons found</div>';
    return;
  }

  resultsDiv.innerHTML = weapons
    .slice(0, 15) // Limit to 15 results
    .map((weapon) => {
      const icon = window.__manifest__.DestinyInventoryItemDefinition[weapon.hash]?.displayProperties?.icon || '';
      const type = window.__manifest__.DestinyInventoryItemDefinition[weapon.hash]?.itemTypeDisplayName || 'Unknown';
      const rarity =
        window.__manifest__.DestinyInventoryItemDefinition[weapon.hash]?.inventory?.rarity || 'Common';

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
function selectWeapon(weaponHash) {
  const weaponManifest = window.__manifest__ || {};
  const weaponDef = weaponManifest.DestinyInventoryItemDefinition?.[weaponHash];

  if (!weaponDef) {
    d2log(`Weapon ${weaponHash} not found in manifest`, 'weapon-ui', 'error');
    return;
  }

  // Load weapon data
  const stats = window.__manifest__.getWeaponStats(weaponHash);
  const sockets = window.__manifest__.getWeaponSockets(weaponHash);

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

  // Render weapon stats (base values only; Phase 6 adds delta calculation)
  renderWeaponStats();

  // Render perk slots (Phase 6: add perk selection UI)
  renderWeaponSockets();

  // Clear search results and focus on perks
  const resultsDiv = document.getElementById('w-search-results');
  if (resultsDiv) {
    resultsDiv.innerHTML = '';
  }

  // Enable save button
  const saveBtn = document.getElementById('w-save-btn');
  if (saveBtn) {
    saveBtn.disabled = false;
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
    const finalValue = baseValue; // Phase 6: add perk deltas
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
 * Toggle collapsible section (section header click).
 *
 * @param {HTMLElement} header - The section header element
 */
function toggleCollapsible(header) {
  const section = header.closest('.weapon-section');
  if (!section) return;

  section.classList.toggle('open');
  const arrow = header.querySelector('.toggle-arrow');
  if (arrow) {
    const isOpen = section.classList.contains('open');
    header.classList.toggle('open', isOpen);
  }

  d2log(`✅ Collapsible toggled`, 'weapon-ui');
}

/**
 * Refresh weapon list view and populate with saved wishes.
 * Phase 8 will implement full list rendering.
 */
function refreshWeaponList() {
  d2log('📋 Loading weapon list...', 'weapon-ui');

  // Phase 8: Implement full list rendering with filters
  // For now, just stub it out
  const listContainer = document.getElementById('w-weapon-list');
  if (listContainer) {
    listContainer.innerHTML = '<div style="text-align: center; color: #666; padding: 40px;">Weapon list - Phase 6/8 implementation</div>';
  }
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
 * Handle delete button click - Phase 7 will fully implement this.
 * Stub for now.
 */
async function handleDeleteWeapon(weaponHash, wishIndex) {
  // Phase 7: Call weaponManager.deleteWeaponWish()
  d2log('🗑️ Delete weapon - Phase 7 implementation pending', 'weapon-ui');
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
  toggleCollapsible,
  refreshWeaponList,
  handleSaveWeaponWish,
  handleDeleteWeapon,
  renderWeaponSearchResults,
  renderWeaponStats,
  renderWeaponSockets,
  weaponState,
};

// Auto-initialize when DOM ready
document.addEventListener('DOMContentLoaded', () => {
  initWeaponCraft();
  d2log('✅ Weapon UI module loaded', 'weapon-ui');
});
