/* ============================================================
   WEAPON-STATS-CLARITY-PROCESSOR.JS - Clarity Data Processing
   ============================================================ */

const CLARITY_CONDITIONAL_HINTS = /(while|after|on\s|kills?|precision|rapid|reload|final blow|aiming|sprint|slide|airborne|crouch|nearby|surrounded)/i;

function normalizeClarityName(value) {
  return String(value || "").trim();
}

function extractNumericStats(entry) {
  const statSources = [entry?.stats, entry?.statBonuses, entry?.stat_bonus, entry?.statEffects];
  for (const source of statSources) {
    if (!source || typeof source !== "object") continue;
    const output = {};
    let hasValue = false;
    Object.entries(source).forEach(([key, value]) => {
      const num = Number(value);
      if (!Number.isFinite(num) || num === 0) return;
      output[key] = num;
      hasValue = true;
    });
    if (hasValue) return output;
  }
  return null;
}

function extractClarityEntry(hash, entry) {
  const name = normalizeClarityName(entry?.name || entry?.displayName || entry?.title || "");
  const description = normalizeClarityName(entry?.description || entry?.desc || entry?.text || "");
  const notes = normalizeClarityName(entry?.notes || entry?.note || entry?.details || "");
  const source = entry?.source || entry?.sources || entry?.origin || entry?.obtained || null;
  const season = entry?.season || entry?.seasons || entry?.seasonNumber || entry?.release || null;
  const stats = extractNumericStats(entry);

  const combined = `${description} ${notes}`.trim();
  const isConditional = CLARITY_CONDITIONAL_HINTS.test(combined);

  return {
    hash,
    name,
    description,
    notes,
    source,
    season,
    stats,
    isConditional,
  };
}

function processClarityData(rawData) {
  const perkMap = {};
  if (!rawData) return perkMap;

  const entries = rawData?.perks || rawData?.traits || rawData?.entries || rawData;

  if (Array.isArray(entries)) {
    entries.forEach((entry) => {
      const hash = Number(entry?.hash || entry?.perkHash || entry?.itemHash);
      if (!Number.isFinite(hash)) return;
      perkMap[String(hash)] = extractClarityEntry(hash, entry);
    });
    return perkMap;
  }

  if (entries && typeof entries === "object") {
    Object.entries(entries).forEach(([key, entry]) => {
      const hash = Number(entry?.hash || entry?.perkHash || entry?.itemHash || key);
      if (!Number.isFinite(hash)) return;
      perkMap[String(hash)] = extractClarityEntry(hash, entry || {});
    });
  }

  return perkMap;
}

window.weaponStatsClarityProcessor = {
  processClarityData,
};
