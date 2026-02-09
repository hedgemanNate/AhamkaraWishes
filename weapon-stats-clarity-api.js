/* ============================================================
   WEAPON-STATS-CLARITY-API.JS - Clarity Data Fetching
   ============================================================ */

const WEAPON_STATS_CLARITY_URL =
  "https://raw.githubusercontent.com/Database-Clarity/Live-Clarity-Database/refs/heads/live/descriptions/dim.json";

function weaponStatsClarityLog(...args) {
  console.log("[WEAPON-STATS-CLARITY]", ...args);
}

function weaponStatsClarityError(...args) {
  console.error("[WEAPON-STATS-CLARITY]", ...args);
}

async function fetchClarityData() {
  weaponStatsClarityLog("Fetching Clarity data...");
  const response = await fetch(WEAPON_STATS_CLARITY_URL, { cache: "no-store" });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`Clarity fetch failed HTTP ${response.status}. ${text.slice(0, 200)}`);
  }
  const data = await response.json();
  weaponStatsClarityLog("Clarity data fetched.");
  return data;
}

window.weaponStatsClarityApi = {
  fetchClarityData,
};
