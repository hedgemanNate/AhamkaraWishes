/* ============================================================
   WEAPON-STATS-API.JS - Bungie API Fetching for Weapon Stats
   ============================================================ */

const WEAPON_STATS_API_KEY = "fee720e84d6c4239aeb7d442b4d39f38";
const WEAPON_STATS_BUNGIE_ROOT = "https://www.bungie.net";

function weaponStatsLog(...args) {
  console.log("[WEAPON-STATS-API]", ...args);
}

function weaponStatsWarn(...args) {
  console.warn("[WEAPON-STATS-API]", ...args);
}

function weaponStatsError(...args) {
  console.error("[WEAPON-STATS-API]", ...args);
}

async function fetchManifestMeta() {
  const url = `${WEAPON_STATS_BUNGIE_ROOT}/Platform/Destiny2/Manifest/`;
  const response = await fetch(url, {
    headers: {
      "X-API-Key": WEAPON_STATS_API_KEY,
      "Accept": "application/json",
    },
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`Manifest meta failed HTTP ${response.status}. ${text.slice(0, 200)}`);
  }

  const payload = await response.json();
  if (!payload?.Response) {
    throw new Error("Manifest meta returned no Response.");
  }

  return payload.Response;
}

async function bytesToTextMaybeGzip(buffer) {
  const bytes = new Uint8Array(buffer);
  const isGzip = bytes.length >= 2 && bytes[0] === 0x1f && bytes[1] === 0x8b;

  if (!isGzip) {
    return new TextDecoder("utf-8").decode(bytes);
  }

  if (typeof DecompressionStream === "undefined") {
    throw new Error("DecompressionStream is not available; cannot gunzip manifest.");
  }

  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"));
  const decompressed = await new Response(stream).arrayBuffer();
  return new TextDecoder("utf-8").decode(decompressed);
}

async function fetchWeaponStatsData() {
  weaponStatsLog("Fetching weapon stats data from Bungie API...");

  const meta = await fetchManifestMeta();
  const lang = "en";
  const componentPath = meta.jsonWorldComponentContentPaths?.[lang]?.DestinyInventoryItemDefinition;
  const worldPath = meta.jsonWorldContentPaths?.[lang];
  let path = componentPath || worldPath;

  if (!path) {
    throw new Error("No manifest path found for DestinyInventoryItemDefinition.");
  }

  if (!path.startsWith("http")) {
    path = `${WEAPON_STATS_BUNGIE_ROOT}${path}`;
  }

  const response = await fetch(path, { headers: { "Accept": "application/json" } });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`Manifest download failed HTTP ${response.status}. ${text.slice(0, 200)}`);
  }

  const buffer = await response.arrayBuffer();
  const text = await bytesToTextMaybeGzip(buffer);
  const parsed = JSON.parse(text);

  const defs = componentPath ? parsed : parsed?.DestinyInventoryItemDefinition;
  if (!defs) {
    weaponStatsWarn("Parsed manifest missing DestinyInventoryItemDefinition.");
    throw new Error("Manifest parsing failed for DestinyInventoryItemDefinition.");
  }

  weaponStatsLog("Weapon stats data fetched successfully.");
  return defs;
}

window.weaponStatsApi = {
  fetchWeaponStatsData,
};
