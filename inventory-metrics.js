/*
 * inventory-metrics.js
 * Responsible for rendering Inventory/Vault metrics into the Menu card body
 * (`#wl-card-body`). This module uses `bungie-inventory-api.js` (messaging to
 * background) to request counts and then updates the DOM. It also subscribes
 * to Bungie auth status messages so metrics refresh when the user logs in.
 *
 * Metrics shown:
 *  1) Total weapons + armor in vault + inventory
 *  2) Weapons in inventory
 *  3) Armor in inventory
 *
 * Usage: This script auto-initializes when loaded on the sidepanel Menu view.
 */

(function () {
  const BODY_ID = 'wl-card-body';

  function setBodyHtml(html) {
    const el = document.getElementById(BODY_ID);
    if (!el) return;
    el.innerHTML = html;
  }

  function showLoading() {
    setBodyHtml('<div class="inv-loading">Loading inventory metrics…</div>');
  }

  function renderCounts(counts) {
    const html = `
      <div class="inv-metrics">
        <div class="inv-metric weapon">
          <div class="inv-metric-icon" aria-hidden="true">⚔️</div>
          <div class="inv-metric-body">
            <div class="inv-metric-label">Weapons (inventory)</div>
            <div class="inv-metric-value">${counts.inventoryWeapons || 0}</div>
          </div>
        </div>
        <div class="inv-metric armor">
          <div class="inv-metric-icon" aria-hidden="true">🛡️</div>
          <div class="inv-metric-body">
            <div class="inv-metric-label">Armor (inventory)</div>
            <div class="inv-metric-value">${counts.inventoryArmor || 0}</div>
          </div>
        </div>
      </div>
    `;
    setBodyHtml(html);
  }

  function showError(err) {
    const reason = err && err.message ? err.message : String(err);
    const html = `
      <div class="inv-error">
        <div class="inv-error-title">Inventory metrics unavailable</div>
        <div class="inv-error-reason">${reason}</div>
      </div>
    `;
    setBodyHtml(html);
  }

  async function refresh() {
    showLoading();
    try {
      if (typeof window === 'undefined' || !window.__bungieInventoryApi || typeof window.__bungieInventoryApi.requestInventoryCounts !== 'function') {
        throw new Error('chrome.runtime unavailable');
      }
      const counts = await window.__bungieInventoryApi.requestInventoryCounts();
      if (!counts) throw new Error('No data');
      renderCounts(counts);
    } catch (err) {
      showError(err);
    }
  }

  function onAuthMessage(msg) {
    if (!msg) return;
    if (msg.type === 'BUNGIE_OAUTH_STATUS' && msg.success) {
      refresh();
    }
  }

  // Initialize when DOM ready
  function init() {
    if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onMessage) {
      chrome.runtime.onMessage.addListener((m) => onAuthMessage(m));
    }
    refresh();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
