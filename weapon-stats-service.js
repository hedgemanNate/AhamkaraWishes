/* ============================================================
   WEAPON-STATS-SERVICE.JS - Cache + State Management
   ============================================================ */

const WEAPON_STATS_CACHE_KEY = "weapon-stats-cache-v1";
const WEAPON_STATS_CACHE_VERSION = 1;
const ONE_DAY_MS = 24 * 60 * 60 * 1000;

let weaponStatsCache = null;
let weaponStatsInitPromise = null;

function setWeaponStatsStatus(message) {
  window.__weaponStatsStatus = message || "";
}

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

function clearWeaponStatsCache() {
  weaponStatsCache = null;
  weaponStatsInitPromise = null;
  try {
    localStorage.removeItem(WEAPON_STATS_CACHE_KEY);
  } catch (error) {
    weaponStatsServiceWarn("Failed to clear weapon stats cache.", error);
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

async function initializeWeaponStats({ force = false } = {}) {
  if (weaponStatsInitPromise && !force) return weaponStatsInitPromise;

  if (force) {
    weaponStatsInitPromise = null;
  }

  weaponStatsInitPromise = (async () => {
    if (!window.weaponStatsApi?.fetchWeaponStatsData) {
      weaponStatsServiceError("Weapon stats API module not available.");
    }
    if (!window.weaponStatsProcessor?.buildPerkStatMap) {
      weaponStatsServiceError("Weapon stats processor module not available.");
    }

    const cached = loadCacheFromStorage();
    if (!force && cached?.perks && isCacheValid(cached)) {
      weaponStatsCache = cached.perks;
      weaponStatsServiceLog("Loaded weapon stats from cache.");
      setWeaponStatsStatus("");
      return weaponStatsCache;
    }

    const staleCache = cached?.perks ? cached : null;

    try {
      if (!window.weaponStatsApi?.fetchWeaponStatsData || !window.weaponStatsProcessor?.buildPerkStatMap) {
        throw new Error("Weapon stats modules are not ready.");
      }

      const clarityPromise = window.weaponStatsClarityService?.initializeWeaponStatsClarity
        ? window.weaponStatsClarityService.initializeWeaponStatsClarity({ force })
        : null;

      const perkDefs = await window.weaponStatsApi.fetchWeaponStatsData();
      const perkMap = window.weaponStatsProcessor.buildPerkStatMap(perkDefs);
      const clarityMap = clarityPromise ? await clarityPromise : window.weaponStatsClarityService?.getClarityMap?.();

      if (clarityMap && typeof clarityMap === "object") {
        Object.entries(clarityMap).forEach(([hashStr, clarityEntry]) => {
          if (!clarityEntry) return;
          if (!perkMap[hashStr]) {
            perkMap[hashStr] = {
              hash: Number(hashStr) || clarityEntry.hash,
              name: clarityEntry.name || "Unknown Perk",
              description: clarityEntry.description || "",
              icon: "",
              static: {},
              conditional: {},
              isConditional: !!clarityEntry.isConditional,
              clarity: clarityEntry,
            };
            return;
          }

          perkMap[hashStr].clarity = clarityEntry;
          if (clarityEntry.description && !perkMap[hashStr].description) {
            perkMap[hashStr].description = clarityEntry.description;
          }
          if (clarityEntry.isConditional) {
            perkMap[hashStr].isConditional = true;
          }
        });
      }

      const payload = {
        version: WEAPON_STATS_CACHE_VERSION,
        timestamp: Date.now(),
        perks: perkMap,
      };

      localStorage.setItem(WEAPON_STATS_CACHE_KEY, JSON.stringify(payload));
      weaponStatsCache = perkMap;
      weaponStatsServiceLog("Weapon stats cache updated from API.");
      setWeaponStatsStatus("");
      return weaponStatsCache;
    } catch (error) {
      weaponStatsServiceError("Weapon stats API fetch failed.", error);
      if (staleCache?.perks) {
        weaponStatsCache = staleCache.perks;
        setWeaponStatsStatus("Using cached weapon stats (refresh failed).");
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

function buildPerkVariants(perkList) {
  const list = Array.isArray(perkList) ? perkList.slice() : [];
  if (list.length === 0) {
    return { regular: [], enhanced: [], hasEnhanced: false };
  }

  const groups = new Map();
  list.forEach((perk) => {
    const name = String(perk?.perkName || "").trim();
    if (!groups.has(name)) {
      groups.set(name, []);
    }
    groups.get(name).push(perk);
  });

  const hasDuplicates = Array.from(groups.values()).some((group) => group.length > 1);

  if (!hasDuplicates) {
    list.forEach((perk) => {
      const perkData = getPerkData(perk?.perkHash);
      perk.isEnhanced = !!perkData?.clarity?.isEnhanced;
    });
    return { regular: list, enhanced: list, hasEnhanced: false };
  }

  const regular = [];
  let enhanced = [];
  let hasEnhanced = false;

  groups.forEach((group) => {
    if (group.length < 2) return;
    group.forEach((perk) => {
      const perkData = getPerkData(perk?.perkHash);
      const isEnhanced = !!perkData?.clarity?.isEnhanced;
      perk.isEnhanced = isEnhanced;
      if (isEnhanced) {
        enhanced.push(perk);
        hasEnhanced = true;
      } else {
        regular.push(perk);
      }
    });
  });

  if (!hasEnhanced) {
    enhanced = regular.slice();
  }

  return { regular, enhanced, hasEnhanced };
}

window.weaponStatsService = {
  initializeWeaponStats,
  clearWeaponStatsCache,
  ensureReady,
  getPerkData,
  getStaticBonuses,
  getConditionalBonuses,
  isConditionalPerk,
  buildPerkVariants,
};
