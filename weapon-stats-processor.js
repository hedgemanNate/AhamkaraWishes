/* ============================================================
   WEAPON-STATS-PROCESSOR.JS - Weapon Stat Data Transformation
   ============================================================ */

const WEAPON_STATS_PROCESSOR_BUNGIE_ROOT = "https://www.bungie.net";

const STAT_HASH_TO_KEY = {
  4284049017: "impact",
  1240592695: "range",
  155624089: "stability",
  943549884: "handling",
  4188031246: "reload",
  3871231066: "magazine",
  2996146976: "zoom",
  1345867579: "aimAssistance",
  4043523819: "recoilDirection",
};

const CONDITIONAL_HINTS = /(while|after|on\s|kills?|precision|rapid|reload|final blow|aiming|sprint|slide|airborne|crouch|nearby|surrounded)/i;

function resolveBungieIcon(iconPath) {
  if (!iconPath) return "";
  if (iconPath.startsWith("http")) return iconPath;
  if (iconPath.startsWith("//")) return `https:${iconPath}`;
  if (iconPath.startsWith("/")) return `${WEAPON_STATS_PROCESSOR_BUNGIE_ROOT}${iconPath}`;
  return iconPath;
}

function parseStatBonuses(perkDef) {
  const investmentStats = Array.isArray(perkDef?.investmentStats) ? perkDef.investmentStats : [];
  const staticBonuses = {};

  investmentStats.forEach((statEntry) => {
    const statHash = Number(statEntry?.statTypeHash);
    const statKey = STAT_HASH_TO_KEY[statHash];
    if (!statKey) return;
    const value = Number(statEntry?.value || 0);
    if (!Number.isFinite(value) || value === 0) return;
    staticBonuses[statKey] = (staticBonuses[statKey] || 0) + value;
  });

  const description = perkDef?.displayProperties?.description || "";
  const isConditional = CONDITIONAL_HINTS.test(description);

  return {
    static: staticBonuses,
    conditional: {},
    isConditional,
  };
}

function isPerkLike(def) {
  if (!def) return false;
  if (!def.displayProperties?.name) return false;
  if (!def.plug) return false;
  return true;
}

function buildPerkStatMap(perkDefs) {
  const perkMap = {};

  for (const [hashStr, def] of Object.entries(perkDefs || {})) {
    if (!isPerkLike(def)) continue;

    const hash = Number(hashStr);
    if (!Number.isFinite(hash)) continue;

    const display = def.displayProperties || {};
    const bonuses = parseStatBonuses(def);
    const iconPath = display.icon || "";

    perkMap[String(hash)] = {
      hash,
      name: display.name || "Unknown Perk",
      description: display.description || "",
      icon: resolveBungieIcon(iconPath),
      static: bonuses.static,
      conditional: bonuses.conditional,
      isConditional: bonuses.isConditional,
    };
  }

  return perkMap;
}

window.weaponStatsProcessor = {
  parseStatBonuses,
  buildPerkStatMap,
};
