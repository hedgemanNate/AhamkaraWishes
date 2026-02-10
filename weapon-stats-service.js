/* ============================================================
   WEAPON-STATS-SERVICE.JS - Cache + State Management
   ============================================================ */

const WEAPON_STATS_CACHE_KEY = "weapon-stats-cache-v1";
const WEAPON_STATS_CACHE_VERSION = 2;
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
      isEnhancedBungie: false,
      isEnhanced: false,
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
              isEnhancedBungie: false,
              isEnhanced: !!clarityEntry.isEnhanced,
              clarity: clarityEntry,
            };
            return;
          }

          perkMap[hashStr].clarity = clarityEntry;
          if (clarityEntry.isEnhanced !== undefined) {
            perkMap[hashStr].isEnhanced = !!clarityEntry.isEnhanced;
          }
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

  // Use the "isEnhanced" flag directly from the source (JSON/Manifest)
  const regular = [];
  const enhanced = [];
  let hasEnhanced = false;

  // Group by base name to pair regular/enhanced versions if needed
  // But PRIMARILY rely on isEnhanced flag
  const groups = new Map();
  
  list.forEach((perk) => {
    // Ensure isEnhanced is set from data source if not already on object
    if (perk.isEnhanced === undefined) {
      const perkData = getPerkData(perk.perkHash);
      perk.isEnhanced = !!perkData?.isEnhanced;
    }

    // Always add to appropriate list
    if (perk.isEnhanced) {
      enhanced.push(perk);
      hasEnhanced = true;
    } else {
      regular.push(perk);
    }

    // Also group by name to find pairs
    const name = String(perk.perkName || "").trim();
    if (!groups.has(name)) groups.set(name, []);
    groups.get(name).push(perk);
  });

  // If a perk has NO enhanced variant, it should appear in the enhanced view too
  // (unless it's strictly a toggle between "base only" vs "enhanced only")
  // The UI typically wants: 
  // - regular view: shows base perks
  // - enhanced view: shows enhanced perks (replacing base) + base perks (if no enhanced exists)
  
  // Post-process to ensure enhanced view is complete
  const finalEnhanced = [];
  
  // Add all enhanced perks first
  enhanced.forEach(p => finalEnhanced.push(p));

  // Add regular perks that DON'T have an enhanced counterpart in this list
  regular.forEach(p => {
    const name = String(p.perkName || "").trim();
    const group = groups.get(name) || [];
    const hasEnhancedVariant = group.some(gp => gp.isEnhanced);
    
    if (!hasEnhancedVariant) {
      finalEnhanced.push(p);
    }
  });

  // Sort by hash or name to keep order stable if needed, but usually list order is fine
  
  return { 
    regular: regular, 
    enhanced: finalEnhanced, 
    hasEnhanced: hasEnhanced 
  };
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
