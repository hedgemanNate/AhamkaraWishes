/* ============================================================
   WEAPON-STATS-SERVICE.JS - Cache + State Management
   ============================================================ */

const WEAPON_STATS_CACHE_KEY = "weapon-stats-cache-v1";
const WEAPON_STATS_CACHE_VERSION = 1;
const ONE_DAY_MS = 24 * 60 * 60 * 1000;

let weaponStatsCache = null;
let weaponStatsInitPromise = null;

function weaponStatsServiceLog(...args) {
  console.log("[WEAPON-STATS-SERVICE]", ...args);
}

function weaponStatsServiceWarn(...args) {
  console.warn("[WEAPON-STATS-SERVICE]", ...args);
}

function weaponStatsServiceError(...args) {
  console.error("[WEAPON-STATS-SERVICE]", ...args);
}

function loadCacheFromStorage() {
  try {
    const raw = localStorage.getItem(WEAPON_STATS_CACHE_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch (error) {
    weaponStatsServiceWarn("Failed to parse weapon stats cache.", error);
    return null;
  }
}

function isCacheValid(cache) {
  if (!cache) return false;
  if (cache.version !== WEAPON_STATS_CACHE_VERSION) return false;
  if (!cache.timestamp) return false;
  const age = Date.now() - cache.timestamp;
  return age >= 0 && age < ONE_DAY_MS;
}

function buildFallbackFromManifest() {
  const fallback = {};
  const manifestBonuses = window.__manifest__?.PERK_STAT_BONUSES || {};

  Object.entries(manifestBonuses).forEach(([hashStr, stats]) => {
    const hash = Number(hashStr);
    if (!Number.isFinite(hash)) return;
    fallback[String(hash)] = {
      hash,
      name: "Unknown Perk",
      description: "",
      icon: "",
      static: { ...stats },
      conditional: {},
      isConditional: false,
    };
  });

  return fallback;
}

async function initializeWeaponStats() {
  if (weaponStatsInitPromise) return weaponStatsInitPromise;

  weaponStatsInitPromise = (async () => {
    if (!window.weaponStatsApi?.fetchWeaponStatsData) {
      weaponStatsServiceError("Weapon stats API module not available.");
    }
    if (!window.weaponStatsProcessor?.buildPerkStatMap) {
      weaponStatsServiceError("Weapon stats processor module not available.");
    }

    const cached = loadCacheFromStorage();
    if (cached?.perks && isCacheValid(cached)) {
      weaponStatsCache = cached.perks;
      weaponStatsServiceLog("Loaded weapon stats from cache.");
      return weaponStatsCache;
    }

    const staleCache = cached?.perks ? cached : null;

    try {
      if (!window.weaponStatsApi?.fetchWeaponStatsData || !window.weaponStatsProcessor?.buildPerkStatMap) {
        throw new Error("Weapon stats modules are not ready.");
      }

      const perkDefs = await window.weaponStatsApi.fetchWeaponStatsData();
      const perkMap = window.weaponStatsProcessor.buildPerkStatMap(perkDefs);

      const payload = {
        version: WEAPON_STATS_CACHE_VERSION,
        timestamp: Date.now(),
        perks: perkMap,
      };

      localStorage.setItem(WEAPON_STATS_CACHE_KEY, JSON.stringify(payload));
      weaponStatsCache = perkMap;
      weaponStatsServiceLog("Weapon stats cache updated from API.");
      return weaponStatsCache;
    } catch (error) {
      weaponStatsServiceError("Weapon stats API fetch failed.", error);
      if (staleCache?.perks) {
        weaponStatsCache = staleCache.perks;
        weaponStatsServiceWarn("Using stale weapon stats cache.");
        return weaponStatsCache;
      }

      const fallback = buildFallbackFromManifest();
      weaponStatsCache = fallback;
      weaponStatsServiceWarn("Using fallback hardcoded perk stats.");
      return weaponStatsCache;
    }
  })();

  return weaponStatsInitPromise;
}

function ensureReady() {
  return weaponStatsInitPromise || initializeWeaponStats();
}

function getPerkData(perkHash) {
  if (!weaponStatsCache) return null;
  return weaponStatsCache[String(perkHash)] || null;
}

function getStaticBonuses(perkHash) {
  const perk = getPerkData(perkHash);
  return perk?.static || {};
}

function getConditionalBonuses(perkHash) {
  const perk = getPerkData(perkHash);
  return perk?.conditional || {};
}

function isConditionalPerk(perkHash) {
  const perk = getPerkData(perkHash);
  return !!perk?.isConditional;
}

window.weaponStatsService = {
  initializeWeaponStats,
  ensureReady,
  getPerkData,
  getStaticBonuses,
  getConditionalBonuses,
  isConditionalPerk,
};
