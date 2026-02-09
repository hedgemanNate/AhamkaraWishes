/* ============================================================
   WEAPON-STATS-CLARITY-SERVICE.JS - Clarity Cache Management
   ============================================================ */

const WEAPON_STATS_CLARITY_CACHE_KEY = "weapon-stats-clarity-cache-v1";
const WEAPON_STATS_CLARITY_CACHE_VERSION = 1;
const ONE_WEEK_MS = 7 * 24 * 60 * 60 * 1000;

let clarityCache = null;
let clarityInitPromise = null;

function setClarityStatus(message) {
  window.__clarityStatus = message || "";
}

function clarityLog(...args) {
  console.log("[WEAPON-STATS-CLARITY]", ...args);
}

function clarityWarn(...args) {
  console.warn("[WEAPON-STATS-CLARITY]", ...args);
}

function clarityError(...args) {
  console.error("[WEAPON-STATS-CLARITY]", ...args);
}

function loadClarityCache() {
  try {
    const raw = localStorage.getItem(WEAPON_STATS_CLARITY_CACHE_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch (error) {
    clarityWarn("Failed to parse Clarity cache.", error);
    return null;
  }
}

function isClarityCacheValid(cache) {
  if (!cache) return false;
  if (cache.version !== WEAPON_STATS_CLARITY_CACHE_VERSION) return false;
  if (!cache.timestamp) return false;
  const age = Date.now() - cache.timestamp;
  return age >= 0 && age < ONE_WEEK_MS;
}

function clearClarityCache() {
  clarityCache = null;
  clarityInitPromise = null;
  try {
    localStorage.removeItem(WEAPON_STATS_CLARITY_CACHE_KEY);
  } catch (error) {
    clarityWarn("Failed to clear Clarity cache.", error);
  }
}

async function initializeWeaponStatsClarity({ force = false } = {}) {
  if (clarityInitPromise && !force) return clarityInitPromise;

  if (force) {
    clarityInitPromise = null;
  }

  clarityInitPromise = (async () => {
    if (!window.weaponStatsClarityApi?.fetchClarityData) {
      clarityError("Clarity API module not available.");
    }
    if (!window.weaponStatsClarityProcessor?.processClarityData) {
      clarityError("Clarity processor module not available.");
    }

    const cached = loadClarityCache();
    if (!force && cached?.perks && isClarityCacheValid(cached)) {
      clarityCache = cached.perks;
      setClarityStatus("");
      clarityLog("Loaded Clarity data from cache.");
      return clarityCache;
    }

    const staleCache = cached?.perks ? cached : null;

    try {
      if (!window.weaponStatsClarityApi?.fetchClarityData || !window.weaponStatsClarityProcessor?.processClarityData) {
        throw new Error("Clarity modules are not ready.");
      }

      const rawData = await window.weaponStatsClarityApi.fetchClarityData();
      const perkMap = window.weaponStatsClarityProcessor.processClarityData(rawData);

      const payload = {
        version: WEAPON_STATS_CLARITY_CACHE_VERSION,
        timestamp: Date.now(),
        perks: perkMap,
      };

      localStorage.setItem(WEAPON_STATS_CLARITY_CACHE_KEY, JSON.stringify(payload));
      clarityCache = perkMap;
      setClarityStatus("");
      clarityLog("Clarity cache updated.");
      return clarityCache;
    } catch (error) {
      clarityError("Clarity fetch failed.", error);
      if (staleCache?.perks) {
        clarityCache = staleCache.perks;
        setClarityStatus("Using cached Clarity data (refresh failed).");
        clarityWarn("Using stale Clarity cache.");
        return clarityCache;
      }
      clarityCache = null;
      return clarityCache;
    }
  })();

  return clarityInitPromise;
}

function getClarityPerk(perkHash) {
  if (!clarityCache) return null;
  return clarityCache[String(perkHash)] || null;
}

function getClarityMap() {
  return clarityCache || {};
}

window.weaponStatsClarityService = {
  initializeWeaponStatsClarity,
  clearClarityCache,
  getClarityPerk,
  getClarityMap,
};
