/* ============================================================
   WEAPON-MANAGER.JS - Phase 4: Weapon Wish Data Persistence
   ============================================================ */

/**
 * Save a weapon wish configuration to Chrome storage.
 * Follows exact pattern of armor manager for consistency.
 *
 * @param {number} weaponHash - Destiny 2 weapon inventory item hash
 * @param {Object} config - Perk configuration
 *   - frame: weapon frame type (e.g., "Linear Fusion Rifle")
 *   - perks: array of perk hashes [slot0Hash, slot1Hash, slot2Hash, slot3Hash]
 *   - selectedPerks: object mapping socketIndex to perk hash {0: hash, 1: hash, ...}
 * @param {Array<string>} tags - User-defined tags (e.g., ["pvp", "favorite"])
 * @param {string} displayString - Human-readable config summary (e.g., "Arrowhead Brake + Ricochet Rounds + Rampage")
 * @param {Object} options - Additional metadata
 *   - mode: "pve" or "pvp"
 *   - addedDate: timestamp (auto-filled if not provided)
 * @returns {Promise<Object>} Returns {success: bool, message: string, wish: Object}
 */
async function saveWeaponWish(weaponHash, config, tags, displayString, options = {}) {
  try {
    // Validate inputs
    if (!weaponHash || typeof weaponHash !== 'number') {
      throw new Error('Invalid weaponHash');
    }
    if (!config) {
      throw new Error('Invalid config structure');
    }
    if (!displayString) {
      throw new Error('displayString required for wish identification');
    }

    // Get current storage
    const { dimData = {} } = await chrome.storage.local.get('dimData');
    const activeId = dimData.activeListId || 'default';
    const lists = dimData.lists || {};
    const activeList = lists[activeId] || { items: {} };

    // Get weapon static data from manifest
    const weaponCache = window.__manifest__ || {};
    const weaponDefs = weaponCache.DestinyInventoryItemDefinition || {};
    const weaponDef =
      weaponDefs?.get?.(String(weaponHash)) ||
      weaponDefs?.[weaponHash] ||
      weaponDefs?.[String(weaponHash)];

    if (!weaponDef) {
      throw new Error(`Weapon ${weaponHash} not found in manifest`);
    }

    // Initialize weapon item container if not exists
    if (!activeList.items[weaponHash]) {
      activeList.items[weaponHash] = {
        static: {
          hash: weaponHash,
          name: weaponDef.displayProperties?.name || 'Unknown Weapon',
          icon: weaponDef.displayProperties?.icon || '',
          type: weaponDef.itemTypeDisplayName || 'Weapon',
          damageType:
            (Array.isArray(weaponDef.damageTypeHashes) && weaponDef.damageTypeHashes[0]) ||
            weaponDef.defaultDamageTypeHash ||
            null,
          rarity: weaponDef.inventory?.rarity || 'Common',
          slot: weaponDef.equipment?.slotTypeHash || null,
        },
        wishes: [],
      };
    }

    // Check for duplicate (same displayString + mode = duplicate)
    const mode = options.mode || 'pve';
    const isDuplicate = activeList.items[weaponHash].wishes.some(
      (wish) => wish.displayString === displayString && wish.mode === mode
    );

    if (isDuplicate) {
      return {
        success: false,
        message: `Duplicate wish: "${displayString}" already saved for ${mode.toUpperCase()}`,
      };
    }

    // Create wish entry
    const wish = {
      tags: tags || [],
      config: config,
      displayString: displayString,
      mode: mode,
      added: options.addedDate || Date.now(),
    };

    // Add to wishes array
    activeList.items[weaponHash].wishes.push(wish);

    // Update storage
    dimData.lists = dimData.lists || {};
    dimData.lists[activeId] = activeList;
    await chrome.storage.local.set({ dimData });

    d2log(`✅ Weapon wish saved: ${weaponDef.displayProperties?.name} - ${displayString}`, 'weapon-manager');

    return {
      success: true,
      message: `Saved ${displayString}`,
      wish: wish,
    };
  } catch (error) {
    d2log(`❌ Error saving weapon wish: ${error.message}`, 'weapon-manager', 'error');
    return {
      success: false,
      message: `Error: ${error.message}`,
    };
  }
}

/**
 * Load all weapon wishes from Chrome storage for the active list.
 *
 * @param {string} listId - Optional list ID; uses activeListId if not provided
 * @returns {Promise<Array>} Array of { weaponHash, static: {...}, wishes: [...] }
 */
async function loadWeaponWishes(listId) {
  try {
    const { dimData = {} } = await chrome.storage.local.get('dimData');
    const activeId = listId || dimData.activeListId || 'default';

    if (!dimData.lists || !dimData.lists[activeId]) {
      d2log(`No weapons found in list ${activeId}`, 'weapon-manager');
      return [];
    }

    const items = dimData.lists[activeId].items || {};

    // Backfill missing static fields from manifest for existing saved items
    const weaponCache = window.__manifest__ || {};
    const weaponDefs = weaponCache.DestinyInventoryItemDefinition || {};
    let didUpdate = false;

    for (const [hashKey, item] of Object.entries(items)) {
      if (!item?.static) continue;
      const weaponHash = Number(item.static.hash || hashKey);
      const weaponDef =
        weaponDefs?.get?.(String(weaponHash)) ||
        weaponDefs?.[weaponHash] ||
        weaponDefs?.[String(weaponHash)];
      if (!weaponDef) continue;

      if (!item.static.name) {
        item.static.name = weaponDef.displayProperties?.name || 'Unknown Weapon';
        didUpdate = true;
      }
      if (!item.static.icon) {
        item.static.icon = weaponDef.displayProperties?.icon || '';
        didUpdate = true;
      }
      if (!item.static.type) {
        item.static.type = weaponDef.itemTypeDisplayName || 'Weapon';
        didUpdate = true;
      }
      if (!item.static.damageType) {
        item.static.damageType =
          (Array.isArray(weaponDef.damageTypeHashes) && weaponDef.damageTypeHashes[0]) ||
          weaponDef.defaultDamageTypeHash ||
          null;
        didUpdate = true;
      }
      if (!item.static.rarity) {
        item.static.rarity = weaponDef.inventory?.rarity || 'Common';
        didUpdate = true;
      }
      if (!item.static.slot) {
        item.static.slot = weaponDef.equipment?.slotTypeHash || null;
        didUpdate = true;
      }
    }

    if (didUpdate) {
      dimData.lists[activeId].items = items;
      await chrome.storage.local.set({ dimData });
    }

    return Object.values(items).filter((item) => item.wishes && item.wishes.length > 0);
  } catch (error) {
    d2log(`❌ Error loading weapon wishes: ${error.message}`, 'weapon-manager', 'error');
    return [];
  }
}

/**
 * Delete a single weapon wish by index.
 *
 * @param {number} weaponHash - Weapon inventory item hash
 * @param {number} wishIndex - Index in the wishes array
 * @returns {Promise<Object>} {success: bool, message: string}
 */
async function deleteWeaponWish(weaponHash, wishIndex) {
  try {
    const { dimData = {} } = await chrome.storage.local.get('dimData');
    const activeId = dimData.activeListId || 'default';

    if (!dimData.lists?.[activeId]?.items?.[weaponHash]) {
      throw new Error('Weapon not found');
    }

    const wishes = dimData.lists[activeId].items[weaponHash].wishes;
    if (!wishes[wishIndex]) {
      throw new Error('Wish not found');
    }

    const deletedWish = wishes.splice(wishIndex, 1)[0];

    // If no wishes remain, remove the item entirely
    if (wishes.length === 0) {
      delete dimData.lists[activeId].items[weaponHash];
    }

    await chrome.storage.local.set({ dimData });
    d2log(`🗑️ Weapon wish deleted: ${deletedWish.displayString}`, 'weapon-manager');

    return {
      success: true,
      message: 'Wish deleted',
    };
  } catch (error) {
    d2log(`❌ Error deleting weapon wish: ${error.message}`, 'weapon-manager', 'error');
    return {
      success: false,
      message: `Error: ${error.message}`,
    };
  }
}

/**
 * Apply filters to weapon wishes and return sorted results.
 *
 * @param {Object} filters - Filter criteria
 *   - weaponType: e.g., "Auto Rifle", "Sniper Rifle" (optional)
 *   - damageType: optional (Solar, Arc, Void)
 *   - mode: "pve" or "pvp" (optional)
 *   - searchText: substring search in displayString (optional, case-insensitive)
 *   - tags: array of tags to match (optional, match ANY tag)
 * @returns {Promise<Array>} Filtered wishes sorted by added date (newest first)
 */
async function applyWeaponFilters(filters = {}) {
  try {
    const wishes = await loadWeaponWishes();

    let filtered = wishes;

    // Filter by weapon type (itemTypeDisplayName)
    if (filters.weaponType) {
      filtered = filtered.filter(
        (item) => item.static.type?.toLowerCase() === filters.weaponType.toLowerCase()
      );
    }

    // Filter by damage type
    if (filters.damageType) {
      filtered = filtered.filter((item) => item.static.damageType === filters.damageType);
    }

    // Flatten wishes and filter by mode / search / tags
    let flatWishes = [];
    filtered.forEach((item) => {
      item.wishes.forEach((wish) => {
        // Mode filter
        if (filters.mode && wish.mode !== filters.mode) {
          return;
        }

        // Search text filter (case-insensitive substring match)
        if (
          filters.searchText &&
          !wish.displayString.toLowerCase().includes(filters.searchText.toLowerCase())
        ) {
          return;
        }

        // Tags filter (match ANY tag)
        if (filters.tags && filters.tags.length > 0) {
          const hasMatchingTag = filters.tags.some((tag) => wish.tags.includes(tag));
          if (!hasMatchingTag) {
            return;
          }
        }

        flatWishes.push({
          weaponHash: item.static.hash,
          weaponName: item.static.name,
          weaponType: item.static.type,
          icon: item.static.icon,
          damageType: item.static.damageType,
          wish: wish,
        });
      });
    });

    // Sort by added date (newest first)
    flatWishes.sort((a, b) => b.wish.added - a.wish.added);

    return flatWishes;
  } catch (error) {
    d2log(`❌ Error applying filters: ${error.message}`, 'weapon-manager', 'error');
    return [];
  }
}

/**
 * Clear all weapons from storage (for testing/reset).
 *
 * @returns {Promise<Object>} {success: bool, message: string}
 */
async function clearAllWeapons() {
  try {
    const { dimData = {} } = await chrome.storage.local.get('dimData');
    const activeId = dimData.activeListId || 'default';

    if (dimData.lists && dimData.lists[activeId]) {
      dimData.lists[activeId].items = {};
      await chrome.storage.local.set({ dimData });
    }

    d2log('🗑️ All weapons cleared', 'weapon-manager');
    return { success: true, message: 'All weapons cleared' };
  } catch (error) {
    d2log(`❌ Error clearing weapons: ${error.message}`, 'weapon-manager', 'error');
    return { success: false, message: `Error: ${error.message}` };
  }
}

/**
 * Export all weapons as JSON for backup.
 *
 * @returns {Promise<string>} JSON string of all weapons
 */
async function exportWeapons() {
  try {
    const wishes = await loadWeaponWishes();
    return JSON.stringify(wishes, null, 2);
  } catch (error) {
    d2log(`❌ Error exporting weapons: ${error.message}`, 'weapon-manager', 'error');
    return '[]';
  }
}

/* ============================================================
   PUBLIC INTERFACE
   ============================================================ */

window.weaponManager = {
  saveWeaponWish,
  loadWeaponWishes,
  deleteWeaponWish,
  applyWeaponFilters,
  clearAllWeapons,
  exportWeapons,
};

d2log('✅ Weapon Manager initialized', 'weapon-manager');
