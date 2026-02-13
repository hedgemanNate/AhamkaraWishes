/*
 * bungie-inventory-api.js
 * Client-side wrapper for requesting inventory/vault counts from the background
 * script. The background performs authenticated requests to Bungie (contains
 * the API key and stored OAuth token) to avoid CORS and token exposure.
 *
 * Exports a small promise-based API:
 *  - requestInventoryCounts(): Promise<{ total:number, weapons:number, armor:number, inventoryWeapons:number, inventoryArmor:number }>
 *
 * NOTE: This file only performs messaging to the background service which does
 * the actual Bungie API fetches. The background implementation is responsible
 * for choosing the appropriate Destiny components and for parsing results.
 */

function requestInventoryCounts() {
  return new Promise((resolve, reject) => {
    if (typeof chrome === 'undefined' || !chrome.runtime || !chrome.runtime.sendMessage) {
      reject(new Error('chrome.runtime unavailable'));
      return;
    }

    chrome.runtime.sendMessage({ type: 'BUNGIE_REQUEST_INVENTORY_COUNTS' }, (resp) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      if (!resp) return resolve(null);
      if (resp.success) {
        resolve(resp.counts);
      } else {
        reject(new Error(resp.error || 'Unknown error'));
      }
    });
  });
}

// Expose globally for convenience
window.__bungieInventoryApi = { requestInventoryCounts };

