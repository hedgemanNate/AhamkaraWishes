// ===============================
// Destiny 2 Manifest Loader & Utilities
// DIM-style local manifest loader with gzip decompression support
// Fetches & caches manifest tables (item, armor set, plug set, stat, perk definitions)
// ===============================

// --- CONFIGURATION ---
const API_KEY = "fee720e84d6c4239aeb7d442b4d39f38";
const BUNGIE_ROOT = "https://www.bungie.net";

// IndexedDB config
const D2DB_NAME = "d2_manifest_cache";
const D2DB_VERSION = 1;
const STORE_META = "meta";
const STORE_BLOBS = "blobs";

// In-memory manifest state
let _invItemDefs = null;      // Map<stringHash, defObject>
let _armorSetDefs = null;     // Map<setHash, setDefObject>
let _nameIndex = null;        // Array<{h:string, n:string}>
let _armorSetLookup = null;   // Map<setHash, {name, icon, description}>
let _plugSetDefs = null;      // Map<stringHash, DestinyPlugSetDefinition>
let _smallTables = new Map(); // tableName -> Map<stringHash, def> (stat defs, stat groups)
let _manifestVersion = null;  // string

function d2log(...args) { console.log("[D2MANIFEST]", ...args); }
function d2warn(...args) { console.warn("[D2MANIFEST]", ...args); }
function d2err(...args) { console.error("[D2MANIFEST]", ...args); }

// --- DATABASE OPERATIONS ---
function openD2DB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(D2DB_NAME, D2DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_META)) db.createObjectStore(STORE_META, { keyPath: "key" });
      if (!db.objectStoreNames.contains(STORE_BLOBS)) db.createObjectStore(STORE_BLOBS, { keyPath: "key" });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbGet(key, storeName) {
  const db = await openD2DB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, "readonly");
    const store = tx.objectStore(storeName);
    const req = store.get(key);
    req.onsuccess = () => resolve(req.result ? req.result.value : null);
    req.onerror = () => reject(req.error);
  });
}

async function idbSet(key, value, storeName) {
  const db = await openD2DB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, "readwrite");
    const store = tx.objectStore(storeName);
    store.put({ key, value });
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// Empties the cached game data so the next load downloads it afresh. Clears
// the stores instead of deleting the database: openD2DB() leaves connections
// open, and deleteDatabase() would sit blocked behind them.
async function clearD2ManifestCache() {
  const db = await openD2DB();
  try {
    await new Promise((resolve, reject) => {
      const tx = db.transaction([STORE_META, STORE_BLOBS], "readwrite");
      tx.objectStore(STORE_META).clear();
      tx.objectStore(STORE_BLOBS).clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

// --- MANIFEST DOWNLOAD & PARSE ---
async function fetchManifestMeta() {
  const url = `${BUNGIE_ROOT}/Platform/Destiny2/Manifest/`;
  d2log("Fetching manifest meta:", url);
  const r = await fetch(url, { headers: { "X-API-Key": API_KEY, "Accept": "application/json" } });
  if (!r.ok) {
    const t = await r.text().catch(() => "");
    throw new Error(`GetDestinyManifest failed HTTP ${r.status}. Body: ${t.slice(0, 200)}`);
  }
  const j = await r.json();
  if (!j?.Response) throw new Error("GetDestinyManifest returned no Response");
  return j.Response;
}

async function bytesToTextMaybeGzip(buf, contentTypeHint = "") {
  const u8 = new Uint8Array(buf);
  const isGzip = u8.length >= 2 && u8[0] === 0x1f && u8[1] === 0x8b;
  if (isGzip) {
    d2log("Detected gzip content, attempting DecompressionStream('gzip')...");
    if (typeof DecompressionStream === "undefined") {
      throw new Error("DecompressionStream is not available in this context. Can't gunzip manifest.");
    }
    const ds = new DecompressionStream("gzip");
    const decompressed = await new Response(new Blob([u8]).stream().pipeThrough(ds)).arrayBuffer();
    return new TextDecoder("utf-8").decode(decompressed);
  }
  return new TextDecoder("utf-8").decode(u8);
}

// Bungie's table name really is "Equipable" (one p).
const ARMOR_SET_TABLE = "DestinyEquipableItemSetDefinition";

// How long one GetDestinyManifest answer is reused. Every table checks it at
// startup; one request serves them all.
const MANIFEST_META_TTL_MS = 5 * 60 * 1000;
let _metaPromise = null;
let _metaFetchedAt = 0;
const _tableDownloads = new Map(); // tableName -> Promise<boolean> while one runs

function getManifestMeta() {
  if (!_metaPromise || Date.now() - _metaFetchedAt > MANIFEST_META_TTL_MS) {
    _metaFetchedAt = Date.now();
    _metaPromise = fetchManifestMeta().catch((e) => { _metaPromise = null; throw e; });
  }
  return _metaPromise;
}

// Each table remembers the manifest version it was downloaded from. They used
// to share one "manifestVersion" key, so after a Bungie update the first table
// to refresh marked every other table current and they stayed stale.
function tableVersionKey(tableName) { return `version:${tableName}`; }

async function cachedTableVersion(tableName) {
  const own = await idbGet(tableVersionKey(tableName), STORE_META);
  if (own) return own;
  // Caches written before per-table versions shared one key. Trust it only for
  // the ~200 MB item table, which every startup refreshed first; the smaller
  // tables re-check (and re-download if stale) once.
  return tableName === "DestinyInventoryItemDefinition" ? idbGet("manifestVersion", STORE_META) : null;
}

// Bumped whenever the item or set table is replaced, so a lookup or parse that
// started on the old copy can't store its result over the new one.
let _manifestGen = 0;

// What each table invalidates in memory when a new copy is stored.
// The armor set lookup is rebuilt in the background rather than dropped:
// getArmorSetName() is synchronous and keeps answering from the old copy
// until the new one is ready.
const TABLE_MEMORY = {
  DestinyInventoryItemDefinition: () => { _manifestGen++; _invItemDefs = null; _invItemDefsLoading = null; _nameIndex = null; rebuildArmorSetLookup(); },
  [ARMOR_SET_TABLE]: () => { _manifestGen++; _armorSetDefs = null; rebuildArmorSetLookup(); },
  DestinyPlugSetDefinition: () => { _plugSetDefs = null; },
};

// Tables already confirmed usable this session. Later callers (perk columns
// during a matching pass, which runs under the dimData lock) get an answer
// without another network round trip. A Bungie update mid-session is picked
// up on the next panel open.
const _tablesConfirmed = new Set();

/**
 * Makes sure one manifest table is cached in IndexedDB at the current
 * manifest version. Resolves true when a usable copy is cached (including an
 * older copy while Bungie is unreachable), false when none could be had.
 * Concurrent callers share one download: the item table is ~200 MB, and
 * startup used to fetch it twice when two modules asked at once.
 */
function ensureManifestTableReady(tableName, { force = false } = {}) {
  if (!force && _tablesConfirmed.has(tableName)) return Promise.resolve(true);
  const running = _tableDownloads.get(tableName);
  if (running && !force) return running;
  const job = downloadTableIfStale(tableName, force).then((ok) => {
    if (ok) _tablesConfirmed.add(tableName);
    return ok;
  }).finally(() => {
    if (_tableDownloads.get(tableName) === job) _tableDownloads.delete(tableName);
  });
  _tableDownloads.set(tableName, job);
  return job;
}

async function downloadTableIfStale(tableName, force) {
  console.groupCollapsed(`[D2MANIFEST] ensure ${tableName}`);
  try {
    const haveCachedBlob = await idbGet(tableName, STORE_BLOBS);
    let meta;
    try {
      meta = await getManifestMeta();
    } catch (e) {
      if (haveCachedBlob && !force) {
        d2warn(`Cannot reach Bungie; using cached ${tableName}:`, e.message);
        return true;
      }
      throw e;
    }
    if (tableName === "DestinyInventoryItemDefinition") _manifestVersion = meta.version;
    if (haveCachedBlob && !force && meta.version === await cachedTableVersion(tableName)) {
      d2log(`${tableName} is up to date.`);
      return true;
    }

    let path = meta.jsonWorldComponentContentPaths?.en?.[tableName];
    if (!path) {
      d2warn(`${tableName} is not in the manifest; skipping.`);
      return !!haveCachedBlob;
    }
    if (!path.startsWith("http")) path = `${BUNGIE_ROOT}${path}`;
    d2log(`Downloading ${tableName} (manifest ${meta.version}) from:`, path);

    const r = await fetch(path, { headers: { "Accept": "application/json" } });
    if (!r.ok) {
      const t = await r.text().catch(() => "");
      throw new Error(`${tableName} download failed HTTP ${r.status}. Body: ${t.slice(0, 200)}`);
    }
    // Streamed when the progress reader is loaded (the panel), so first run can show a real percentage.
    const buf = typeof AWManifestProgress !== 'undefined'
      ? await AWManifestProgress.readWithProgress(r, (got, total) => AWManifestProgress.report(tableName, got, total))
      : await r.arrayBuffer();
    d2log("Downloaded bytes:", buf.byteLength);
    const parsed = JSON.parse(await bytesToTextMaybeGzip(buf, r.headers.get("content-type") || ""));
    if (!parsed || typeof parsed !== "object") throw new Error(`${tableName} download was not a table.`);

    await idbSet(tableName, parsed, STORE_BLOBS);
    await idbSet(tableVersionKey(tableName), meta.version, STORE_META);
    (TABLE_MEMORY[tableName] || (() => _smallTables.delete(tableName)))();
    d2log(`${tableName} cache updated.`);
    return true;
  } catch (e) {
    d2err(`ensure ${tableName} FAILED:`, e);
    return false;
  } finally {
    console.groupEnd();
  }
}

// Named entry points kept for the modules that call them.
function ensureInventoryItemDefsReady(opts) { return ensureManifestTableReady("DestinyInventoryItemDefinition", opts); }
function ensureEquippableItemSetDefsReady(opts) { return ensureManifestTableReady(ARMOR_SET_TABLE, opts); }
// Resolves a weapon socket's perk pool (reusablePlugSetHash / randomizedPlugSetHash).
function ensurePlugSetDefsReady(opts) { return ensureManifestTableReady("DestinyPlugSetDefinition", opts); }

// --- MEMORY LOADING ---
function tableToMap(blob) {
  const map = new Map();
  for (const [hashStr, def] of Object.entries(blob)) map.set(String(hashStr), def);
  return map;
}

// Several modules ask for the item defs at startup; parse the ~200 MB table once.
let _invItemDefsLoading = null;
function loadInventoryItemDefsToMemory() {
  if (_invItemDefs) return Promise.resolve(_invItemDefs);
  if (!_invItemDefsLoading) {
    const gen = _manifestGen;
    const job = (async () => {
      let blob = await idbGet("DestinyInventoryItemDefinition", STORE_BLOBS);
      if (!blob) {
        d2warn("No cached item defs found. Attempting download...");
        if (!await ensureInventoryItemDefsReady()) throw new Error("Unable to download/cache manifest; see logs above.");
        blob = await idbGet("DestinyInventoryItemDefinition", STORE_BLOBS);
      }
      if (!blob) throw new Error("Item defs still missing after ensureInventoryItemDefsReady.");
      const map = tableToMap(blob);
      if (gen === _manifestGen) _invItemDefs = map; // else a newer copy landed meanwhile
      d2log("Loaded item defs into memory:", map.size);
      return map;
    })().finally(() => { if (_invItemDefsLoading === job) _invItemDefsLoading = null; });
    _invItemDefsLoading = job;
  }
  return _invItemDefsLoading;
}

/** Armor set definitions (name, pieces, 2-/4-piece perks), or null if unavailable. */
async function loadArmorSetDefsToMemory() {
  if (_armorSetDefs) return _armorSetDefs;
  const gen = _manifestGen;
  let blob = await idbGet(ARMOR_SET_TABLE, STORE_BLOBS);
  if (!blob && await ensureEquippableItemSetDefsReady()) blob = await idbGet(ARMOR_SET_TABLE, STORE_BLOBS);
  if (!blob) {
    d2warn("No armor set defs available.");
    return null;
  }
  const map = tableToMap(blob);
  if (gen === _manifestGen) _armorSetDefs = map;
  d2log("Loaded armor set defs into memory:", map.size);
  return map;
}

async function loadPlugSetDefsToMemory() {
  if (_plugSetDefs) return _plugSetDefs;

  console.groupCollapsed("[D2MANIFEST] loadPlugSetDefsToMemory");
  const blob = await idbGet("DestinyPlugSetDefinition", STORE_BLOBS);
  if (!blob) {
    d2warn("No cached plug set defs found.");
    console.groupEnd();
    return null;
  }

  const map = new Map();
  let count = 0;
  for (const [hashStr, def] of Object.entries(blob)) {
    map.set(String(hashStr), def);
    count++;
  }
  _plugSetDefs = map;
  d2log("Loaded plug set defs into memory:", count);
  console.groupEnd();
  return _plugSetDefs;
}

async function getPlugSetDef(hash) {
  const defs = await loadPlugSetDefsToMemory();
  if (!defs) return null;
  return defs.get(String(hash)) || null;
}

async function loadManifestTableToMemory(tableName) {
  if (_smallTables.has(tableName)) return _smallTables.get(tableName);

  let blob = await idbGet(tableName, STORE_BLOBS);
  if (!blob) {
    const ok = await ensureManifestTableReady(tableName, { force: false });
    if (!ok) return null;
    blob = await idbGet(tableName, STORE_BLOBS);
    if (!blob) return null;
  }

  const map = new Map();
  for (const [hashStr, def] of Object.entries(blob)) {
    map.set(String(hashStr), def);
  }
  _smallTables.set(tableName, map);
  d2log(`Loaded ${tableName} into memory:`, map.size);
  return map;
}

// --- ARMOR STAT HASHES ---
// The Renegades armor system has 6 named stats (Weapons/Health/Class/Grenade/Super/Melee),
// each represented by 2 hashes in DestinyStatDefinition (12 total). We group them
// by display name so matching can check any hash for a given stat name.
let _armorStatHashesByName = null; // Map<statName, number[]>

async function loadArmorStatHashesByName() {
  if (_armorStatHashesByName) return _armorStatHashesByName;
  const statDefs = await loadManifestTableToMemory('DestinyStatDefinition');
  if (!statDefs) return null;
  const ARMOR_STAT_NAMES = new Set(['Weapons', 'Health', 'Class', 'Grenade', 'Super', 'Melee']);
  const map = new Map();
  for (const [hashStr, def] of statDefs.entries()) {
    const name = def?.displayProperties?.name;
    if (!name || !ARMOR_STAT_NAMES.has(name)) continue;
    if (!map.has(name)) map.set(name, []);
    map.get(name).push(Number(hashStr));
  }
  _armorStatHashesByName = map;
  return map;
}

// --- WEAPON DISPLAY STATS ---
// Builds the light.gg-style displayed stat list for a weapon, dynamically from
// the weapon's DestinyStatGroupDefinition (which stats show, bar vs numeric,
// display maximum, investment->display interpolation curve) and
// DestinyStatDefinition (display names). Works for any weapon family: rockets
// get Blast Radius/Velocity, bows get Draw Time, etc.

const RECOIL_DIRECTION_STAT_HASH = 2715839340;

// Stats that exist on the item but are not part of the inspect-screen stat
// block (power/attack levels).
const WEAPON_DISPLAY_STAT_EXCLUDE = new Set([
  1480404414, // Attack
  1935470627, // Power
]);

// Always shown as a plain number regardless of stat-group flags (matches
// in-game/light.gg presentation).
const WEAPON_STAT_FORCE_NUMERIC = new Set([
  4284893193, // Rounds Per Minute
  3871231066, // Magazine
  1931675084, // Inventory Size
]);

// Canonical display order (matches in-game/light.gg inspection order). Stats
// not listed here (new/unusual ones) are appended after, ordered by the stat
// definition's own index, so nothing is ever dropped.
const WEAPON_DISPLAY_STAT_ORDER = [
  4043523819, // Impact
  3614673599, // Blast Radius
  2523465841, // Velocity
  1240592695, // Range
  1591432999, // Accuracy
  2837207746, // Swing Speed
  155624089,  // Stability
  943549884,  // Handling
  4188031367, // Reload Speed
  1345609583, // Aim Assistance
  3555269338, // Zoom
  2714457168, // Airborne Effectiveness
  2715839340, // Recoil Direction
  4284893193, // Rounds Per Minute
  2961396640, // Charge Time
  447667954,  // Draw Time
  3871231066, // Magazine
  1931675084, // Inventory Size
];

// Piecewise-linear interpolation of a raw investment value through a stat
// group displayInterpolation curve, with banker's rounding (matches the game
// and DIM). Returns the raw value untouched when there is no curve.
function interpolateStatValue(value, interpolation) {
  if (!Array.isArray(interpolation) || interpolation.length === 0) return value;

  const first = interpolation[0];
  const last = interpolation[interpolation.length - 1];
  if (value <= first.value) return first.weight;
  if (value >= last.value) return last.weight;

  let endIndex = interpolation.findIndex((p) => p.value > value);
  if (endIndex < 0) return last.weight;
  const start = interpolation[endIndex - 1];
  const end = interpolation[endIndex];

  const range = end.value - start.value;
  if (range === 0) return start.weight;
  const t = (value - start.value) / range;
  const raw = start.weight + t * (end.weight - start.weight);

  // Banker's rounding: .5 rounds to the nearest even integer
  const floor = Math.floor(raw);
  const frac = raw - floor;
  if (Math.abs(frac - 0.5) < 1e-9) return floor % 2 === 0 ? floor : floor + 1;
  return Math.round(raw);
}

// Returns ordered rows:
// { statHash, name, base (raw investment), interpolation, displayMaximum,
//   isBar, isNumeric, isRecoil }
async function getWeaponDisplayStats(def) {
  const [statDefs, statGroupDefs] = await Promise.all([
    loadManifestTableToMemory("DestinyStatDefinition"),
    loadManifestTableToMemory("DestinyStatGroupDefinition"),
  ]);

  const statGroup = statGroupDefs?.get(String(def?.stats?.statGroupHash)) || null;
  const scaledByHash = new Map((statGroup?.scaledStats || []).map((s) => [s.statHash, s]));

  // Raw investment values (pre-interpolation); perk deltas add into this space.
  const investment = new Map();
  for (const s of def.investmentStats || []) {
    if (!s.isConditionallyActive) investment.set(s.statTypeHash, s.value);
  }

  const rows = [];
  for (const [hashStr, statEntry] of Object.entries(def.stats?.stats || {})) {
    const statHash = Number(hashStr);
    if (WEAPON_DISPLAY_STAT_EXCLUDE.has(statHash)) continue;

    const statDef = statDefs?.get(hashStr);
    const name = statDef?.displayProperties?.name || "";
    if (!name) continue; // unnamed stats are internal/hidden

    const scaled = scaledByHash.get(statHash) || null;
    const isRecoil = statHash === RECOIL_DIRECTION_STAT_HASH;
    const isNumeric = WEAPON_STAT_FORCE_NUMERIC.has(statHash)
      || !!scaled?.displayAsNumeric
      || (!scaled && !isRecoil);

    rows.push({
      statHash,
      name,
      index: statDef?.index ?? 99999,
      base: investment.has(statHash) ? investment.get(statHash) : (statEntry.value ?? 0),
      interpolation: scaled?.displayInterpolation || null,
      displayMaximum: scaled?.maximumValue ?? 100,
      isRecoil,
      isNumeric: isNumeric && !isRecoil,
      isBar: !isRecoil && !isNumeric,
    });
  }

  const orderPos = new Map(WEAPON_DISPLAY_STAT_ORDER.map((h, i) => [h, i]));
  rows.sort((a, b) => {
    const pa = orderPos.has(a.statHash) ? orderPos.get(a.statHash) : 1000 + a.index;
    const pb = orderPos.has(b.statHash) ? orderPos.get(b.statHash) : 1000 + b.index;
    return pa - pb;
  });

  return rows;
}

// --- LOOKUP TABLES ---
// Map<setHash, { name, items, perks }>. Names come from Bungie's set table
// ("Techsec", "AION Renewal"); guessing from the pieces' shared words is only
// a fallback for when that table couldn't be loaded.
let _armorSetLookupLoading = null;
let _armorSetLookupGen = -1;
function getArmorSetLookup() {
  if (_armorSetLookup && _armorSetLookupGen === _manifestGen) return Promise.resolve(_armorSetLookup);
  if (!_armorSetLookupLoading) {
    const gen = _manifestGen;
    const job = buildArmorSetLookup().then((lookup) => {
      // A lookup from a replaced table is still better than none; its old
      // generation makes the next call rebuild it.
      if (gen === _manifestGen || !_armorSetLookup) { _armorSetLookup = lookup; _armorSetLookupGen = gen; }
      return lookup;
    }).finally(() => { if (_armorSetLookupLoading === job) _armorSetLookupLoading = null; });
    _armorSetLookupLoading = job;
  }
  return _armorSetLookupLoading;
}

/** After a table update: build a fresh lookup if one was in use, keeping the old meanwhile. */
function rebuildArmorSetLookup() {
  const inUse = _armorSetLookup || _armorSetLookupLoading;
  _armorSetLookupLoading = null;
  if (inUse) getArmorSetLookup().catch((e) => d2warn("Armor set lookup rebuild failed:", e));
}

async function buildArmorSetLookup() {
  const [defs, setDefs] = await Promise.all([
    loadInventoryItemDefsToMemory(),
    loadArmorSetDefsToMemory().catch((e) => { d2warn("Armor set names unavailable:", e); return null; })
  ]);
  const setsByHash = new Map(); // setHash -> pieces
  for (const [hash, def] of defs.entries()) {
    if (!isRealArmorDef(def)) continue;
    const setHash = def.equippingBlock?.equipableItemSetHash;
    if (!setHash) continue;
    const key = String(setHash);
    if (!setsByHash.has(key)) setsByHash.set(key, []);
    setsByHash.get(key).push({
      hash,
      name: def.displayProperties?.name || "",
      icon: def.displayProperties?.icon || "",
      classType: def.classType,
      bucketHash: def.inventory?.bucketTypeHash
    });
  }

  const lookup = new Map();
  for (const [key, items] of setsByHash.entries()) {
    const setDef = setDefs?.get(key);
    lookup.set(key, {
      name: setDef?.displayProperties?.name || extractCommonSetName(items.map((it) => it.name)),
      items,
      perks: Array.isArray(setDef?.setPerks) ? setDef.setPerks : []
    });
  }
  d2log("Built armor set lookup:", lookup.size, "sets", setDefs ? "(official names)" : "(names guessed)");
  return lookup;
}

/**
 * The bonuses a set grants, smallest first: [{ count, name, description }]
 * where count is how many pieces must be worn (2, 4) and icon is a Bungie
 * path ("" when the perk has none). Pure, for tests.
 */
function describeSetBonuses(setPerks, perkDefs) {
  if (!Array.isArray(setPerks) || !perkDefs) return [];
  return setPerks
    .map((sp) => {
      const dp = perkDefs.get(String(sp?.sandboxPerkHash))?.displayProperties;
      return dp?.name ? {
        count: Number(sp.requiredSetCount) || 0, name: dp.name, description: dp.description || "",
        icon: dp.hasIcon && dp.icon ? dp.icon : ""
      } : null;
    })
    .filter(Boolean)
    .sort((a, b) => a.count - b.count);
}

/**
 * Set bonuses for a piece's set (D15). Resolves [] when the piece has no set
 * ("No set bonus") or the perk text can't be loaded. Loads the ~2.5 MB perk
 * table on first use only.
 */
async function getArmorSetBonuses(setHash) {
  if (!setHash) return [];
  const sets = await loadArmorSetDefsToMemory();
  const setPerks = sets?.get(String(setHash))?.setPerks;
  if (!setPerks?.length) return [];
  return describeSetBonuses(setPerks, await loadManifestTableToMemory("DestinySandboxPerkDefinition"));
}

/** The set an armor piece belongs to, from its item definition (null if none). */
async function getArmorSetHashForItem(itemHash) {
  const defs = await loadInventoryItemDefsToMemory();
  return defs.get(String(itemHash))?.equippingBlock?.equipableItemSetHash || null;
}

// Extract common set name from array of item names
// e.g., ["Exodus Down Helmet", "Exodus Down Gauntlets"] → "Exodus Down"
function extractCommonSetName(itemNames) {
  if (itemNames.length === 0) return "Unknown Set";
  if (itemNames.length === 1) return itemNames[0];

  // Split each name into words
  const allNames = itemNames.map(name =>
    name.toLowerCase().split(/\s+/).filter(w => w.length > 0)
  );

  // Find words that appear in ALL item names
  const commonWords = allNames[0].filter(word => 
    allNames.every(nameWords => nameWords.includes(word))
  );

  if (commonWords.length === 0) {
    // No common words, return first item name
    return itemNames[0];
  }

  // Preserve original case by finding the first occurrence in any item name
  const commonWordsLower = new Set(commonWords);
  const originalCommon = [];
  
  for (const word of itemNames[0].split(/\s+/)) {
    if (commonWordsLower.has(word.toLowerCase())) {
      originalCommon.push(word);
    }
  }

  return originalCommon.join(" ");
}

function getArmorSetName(setHash) {
  if (!_armorSetLookup || !setHash) return null;
  return _armorSetLookup.get(String(setHash))?.name || null;
}

// --- SEARCH & FILTERS ---
function isRealArmorDef(def) {
  return (
    def &&
    def.itemType === 2 &&
    def.equippable === true &&
    !!def.inventory?.bucketTypeHash
  );
}

async function buildNameIndexIfNeeded() {
  if (_nameIndex) return _nameIndex;

  console.groupCollapsed("[D2MANIFEST] buildNameIndex");

  const defs = await loadInventoryItemDefsToMemory();
  const idx = [];
  let scanned = 0;

  for (const [h, def] of defs.entries()) {
    const name = def?.displayProperties?.name;
    if (!name) continue;
    idx.push({ h, n: name.toLowerCase() });
    scanned++;
    if (scanned % 50000 === 0) {
      await new Promise(r => setTimeout(r, 0));
    }
  }

  _nameIndex = idx;
  d2log("Name index size:", idx.length);
  console.groupEnd();
  return _nameIndex;
}

// Bucket hashes for armor slot filtering
const BUCKET_HASHES = {
  HELMET: 3448274439,
  GAUNTLETS: 3551918588,
  CHEST: 14239492,
  LEGS: 20886954,
  CLASS_ITEM: 1585787867
};

async function searchArmorLocally(query, currentClassType) {
  const q = String(query || "").trim().toLowerCase();
  if (q.length < 2) return [];

  console.groupCollapsed("[D2MANIFEST] searchArmorLocally:", q);

  const ok = await ensureInventoryItemDefsReady({ force: false });
  if (!ok) throw new Error("Manifest not available; see manifest logs.");

  const defs = await loadInventoryItemDefsToMemory();
  const idx = await buildNameIndexIfNeeded();

  const hits = [];
  for (const it of idx) {
    if (it.n.includes(q)) hits.push(it.h);
    if (hits.length >= 400) break;
  }
  d2log("Name hits:", hits.length);

  const candidates = [];
  for (const h of hits) {
    const def = defs.get(String(h));
    if (!isRealArmorDef(def)) continue;
    if (def.classType !== currentClassType && def.classType !== 3) continue;
    candidates.push(def);
    if (candidates.length >= 200) break;
  }
  d2log("Armor candidates:", candidates.length);

  // If we have candidates, check if they belong to an armor set
  // If so, load ALL pieces from that set instead of Just one per slot
  if (candidates.length > 0) {
    const firstItem = candidates[0];
    const setHash = firstItem.equippingBlock?.equipableItemSetHash;
    
    if (setHash) {
      d2log("Found armor set hash:", setHash, "- loading all pieces from this set");
      
      // Find ALL pieces in this set that match the class
      const setMembers = [];
      for (const [h, def] of defs.entries()) {
        if (!isRealArmorDef(def)) continue;
        const defSetHash = def.equippingBlock?.equipableItemSetHash;
        if (defSetHash !== setHash) continue;
        if (def.classType !== currentClassType && def.classType !== 3) continue;
        setMembers.push(def);
      }
      
      d2log("Set members for", setHash, ":", setMembers.length);
      
      // Build output, one per slot
      const armorSet = { helmet: null, gauntlets: null, chest: null, legs: null, classItem: null };
      for (const item of setMembers) {
        const bucketHash = item.inventory?.bucketTypeHash;
        if (bucketHash === BUCKET_HASHES.HELMET && !armorSet.helmet) armorSet.helmet = item;
        else if (bucketHash === BUCKET_HASHES.GAUNTLETS && !armorSet.gauntlets) armorSet.gauntlets = item;
        else if (bucketHash === BUCKET_HASHES.CHEST && !armorSet.chest) armorSet.chest = item;
        else if (bucketHash === BUCKET_HASHES.LEGS && !armorSet.legs) armorSet.legs = item;
        else if (bucketHash === BUCKET_HASHES.CLASS_ITEM && !armorSet.classItem) armorSet.classItem = item;
      }
      
      const out = Object.values(armorSet).filter(Boolean).map(item => ({
        hash: item.hash,
        name: item.displayProperties?.name || "",
        icon: item.displayProperties?.icon ? `${BUNGIE_ROOT}${item.displayProperties.icon}` : "",
        classType: item.classType,
        bucketHash: item.inventory?.bucketTypeHash,
        setHash: item.equippingBlock?.equipableItemSetHash || null
      }));
      
      console.groupEnd();
      return out;
    }
  }

  // Fallback: pick one per slot from search candidates (no set found)
  const armorSet = { helmet: null, gauntlets: null, chest: null, legs: null, classItem: null };

  for (const item of candidates) {
    const bucketHash = item.inventory?.bucketTypeHash;
    if (bucketHash === BUCKET_HASHES.HELMET && !armorSet.helmet) armorSet.helmet = item;
    else if (bucketHash === BUCKET_HASHES.GAUNTLETS && !armorSet.gauntlets) armorSet.gauntlets = item;
    else if (bucketHash === BUCKET_HASHES.CHEST && !armorSet.chest) armorSet.chest = item;
    else if (bucketHash === BUCKET_HASHES.LEGS && !armorSet.legs) armorSet.legs = item;
    else if (bucketHash === BUCKET_HASHES.CLASS_ITEM && !armorSet.classItem) armorSet.classItem = item;

    if (armorSet.helmet && armorSet.gauntlets && armorSet.chest && armorSet.legs && armorSet.classItem) break;
  }

  const out = Object.values(armorSet).filter(Boolean).map(item => ({
    hash: item.hash,
    name: item.displayProperties?.name || "",
    icon: item.displayProperties?.icon ? `${BUNGIE_ROOT}${item.displayProperties.icon}` : "",
    classType: item.classType,
    bucketHash: item.inventory?.bucketTypeHash,
    setHash: item.equippingBlock?.equipableItemSetHash || null
  }));

  console.groupEnd();
  return out;
}

// Find every OTHER manifest hash that is the same physical armor piece — same
// display name, same slot bucket, same class — regardless of tier or season
// reissue (those siblings differ only by iconWatermark). Owned drops can carry
// any sibling hash, so armor wishes store these as linkedHashes and inventory
// matching unions instances across all of them (same mechanism weapons use).
// Returns numeric hashes, excluding the input hash itself.
async function findArmorSiblingHashes(hash) {
  const defs = await loadInventoryItemDefsToMemory();
  if (!defs) return [];
  const def = defs.get(String(hash));
  if (!isRealArmorDef(def)) return [];
  const name = def.displayProperties?.name;
  if (!name) return [];
  const bucketHash = def.inventory?.bucketTypeHash;
  const classType = def.classType;

  const siblings = [];
  for (const [h, d] of defs.entries()) {
    if (h === String(hash)) continue;
    if (!isRealArmorDef(d)) continue;
    if (d.displayProperties?.name !== name) continue;
    if (d.inventory?.bucketTypeHash !== bucketHash) continue;
    if (d.classType !== classType) continue;
    siblings.push(Number(h));
  }
  return siblings;
}

// Weapon counterpart of findArmorSiblingHashes: every OTHER manifest hash
// with the same display name among real weapon defs. Same identity rule
// searchWeaponsLocally uses when it auto-populates linkedHashes on search
// results; this standalone lookup exists for backfilling wishes saved
// without them (e.g. from the DIM/D2Foundry content script).
async function findWeaponSiblingHashes(hash) {
  const defs = await loadInventoryItemDefsToMemory();
  if (!defs) return [];
  const def = defs.get(String(hash));
  if (!isRealWeaponDef(def)) return [];
  const name = def.displayProperties?.name;
  if (!name) return [];

  const siblings = [];
  for (const [h, d] of defs.entries()) {
    if (h === String(hash)) continue;
    if (!isRealWeaponDef(d)) continue;
    if (d.displayProperties?.name !== name) continue;
    siblings.push(Number(h));
  }
  return siblings;
}

// --- WEAPON CRAFTING SUPPORT ---
// Stable, well-known Bungie socket category hashes (same ones DIM/D2Foundry
// hardcode) - safe to hardcode since the game is permanently frozen post
// Monument of Triumph (no more manifest changes, ever).
const INTRINSIC_TRAITS_CATEGORY_HASH = 3956125808; // weapon frame, not user-selectable
const WEAPON_PERKS_CATEGORY_HASH = 4241085061;     // barrel/mag/trait columns (+ trinkets, filtered below)
const WEAPON_COSMETICS_CATEGORY_HASH = 2048875504; // ornaments/keepsakes, not needed
const WEAPON_MODS_CATEGORY_HASH = 2685412949;      // combat mods + masterwork tier, out of scope for now

// Weapon investment stat hashes needed for oracle_engine's setStats() call
// (list confirmed against oracle_engine's own sample script).
const WEAPON_STAT_HASHES = [
  1591432999, 1345609583, 3614673599, 447667954, 943549884, 1931675084,
  3871231066, 1240592695, 2715839340, 4188031367, 1842278586, 155624089,
  2523465841, 3555269338
];

// Trinket-only plugs (kill trackers etc.) that show up in the WEAPON PERKS
// category but aren't real build perks. Only used to skip a column when
// EVERY candidate plug matches - if a column is ambiguous, it's kept as-is
// (see plan's fallback rule: never hide/crash on unusual weapon layouts).
const WEAPON_TRACKER_PLUG_NAME_PATTERN = /tracker$/i;

// Set of socketIndexes on a weapon def that are real build perks (barrel/mag/
// trait/origin trait columns) — excludes the weapon mod socket, masterwork,
// shaders, ornaments, and trackers. Used to filter an owned instance's raw
// socket list (which has no category info of its own) down to just the
// columns getWeaponPerkColumns/the craft page would show.
function getWeaponPerkSocketIndexes(def) {
  const perksCategory = def?.sockets?.socketCategories?.find(
    (c) => c.socketCategoryHash === WEAPON_PERKS_CATEGORY_HASH
  );
  return new Set(perksCategory?.socketIndexes || []);
}

function countOriginTraits(def, itemDefs) {
  if (!def?.sockets?.socketCategories || !def?.sockets?.socketEntries) return 0;
  const perksCategory = def.sockets.socketCategories.find(
    (c) => c.socketCategoryHash === WEAPON_PERKS_CATEGORY_HASH
  );
  if (!perksCategory) return 0;
  let total = 0;
  for (const socketIndex of perksCategory.socketIndexes) {
    const socket = def.sockets.socketEntries[socketIndex];
    if (!socket) continue;
    const plugHashes = (socket.reusablePlugItems || []).map((p) => p.plugItemHash);
    if (plugHashes.length === 0 && socket.singleInitialItemHash) plugHashes.push(socket.singleInitialItemHash);
    if (plugHashes.length === 0) continue;
    const firstDef = itemDefs.get(String(plugHashes[0]));
    if (firstDef?.itemTypeDisplayName === 'Origin Trait') {
      total += plugHashes.filter((h) => {
        const d = itemDefs.get(String(h));
        return !/^Enhanced\b/.test(d?.itemTypeDisplayName || '') &&
               !(d?.displayProperties?.name || '').startsWith('Enhanced ');
      }).length;
    }
  }
  return total;
}

function isRealWeaponDef(def) {
  return (
    def &&
    def.itemType === 3 &&
    def.equippable === true &&
    !!def.sockets
  );
}

// --- WATERMARK -> SEASON LOOKUP ---
// Distinguishes same-named weapon duplicates (reissues, curated/fixed rolls,
// world drops vs. seasonal versions) by season of origin, since Bungie's own
// manifest never joins an item's iconWatermark path to a season name.
//
// watermark-to-season.json is vendored from DestinyItemManager/d2-additional-info
// (MIT licensed, see vendor/dim-watermarks/LICENSE.md) - maps icon path -> season
// number, built by DIM via manual observation since the API doesn't expose this.
// Since Destiny 2 is permanently frozen, this mapping never needs updating again.
let _watermarkToSeason = null; // Map<iconPath, seasonNumber>

// Full mapping of every season/episode number present in the vendored
// watermark-to-season.json (1-28, covering base game through Lawless).
// Any number outside this table falls back to a generic "Season N" label
// rather than a guessed name.
const SEASON_NUMBER_TO_NAME = {
  1: "Red War (Base Game)",
  2: "Curse of Osiris",
  3: "Warmind",
  4: "Season of the Outlaw",
  5: "Season of the Forge",
  6: "Season of the Drifter",
  7: "Season of Opulence",
  8: "Season of the Undying",
  9: "Season of Dawn",
  10: "Season of the Worthy",
  11: "Season of Arrivals",
  12: "Season of the Hunt",
  13: "Season of the Chosen",
  14: "Season of the Splicer",
  15: "Season of the Lost",
  16: "Season of the Risen",
  17: "Season of the Haunted",
  18: "Season of Plunder",
  19: "Season of the Seraph",
  20: "Season of Defiance",
  21: "Season of the Deep",
  22: "Season of the Witch",
  23: "Season of the Wish",
  24: "Episode 1: Echoes",
  25: "Episode 2: Revenant",
  26: "Episode 3: Heresy",
  27: "Season: Reclamation",
  28: "Season: Lawless"
};

async function ensureWatermarkLookupReady() {
  if (_watermarkToSeason) return _watermarkToSeason;
  try {
    const url = chrome.runtime.getURL("vendor/dim-watermarks/watermark-to-season.json");
    const res = await fetch(url);
    const json = await res.json();
    _watermarkToSeason = new Map(Object.entries(json));
  } catch (e) {
    console.error("[D2MANIFEST] failed to load watermark-to-season.json", e);
    _watermarkToSeason = new Map();
  }
  return _watermarkToSeason;
}

function getSeasonLabelForWatermark(iconWatermark, watermarkMap) {
  if (!iconWatermark || !watermarkMap) return null;
  const seasonNum = watermarkMap.get(iconWatermark);
  if (seasonNum == null) return null;
  const name = SEASON_NUMBER_TO_NAME[seasonNum];
  return name ? `Season ${seasonNum}: ${name}` : `Season ${seasonNum}`;
}

async function searchWeaponsLocally(query) {
  const q = String(query || "").trim().toLowerCase();
  if (q.length < 2) return [];

  console.groupCollapsed("[D2MANIFEST] searchWeaponsLocally:", q);

  const defs = await loadInventoryItemDefsToMemory();
  const idx = await buildNameIndexIfNeeded();
  const watermarkMap = await ensureWatermarkLookupReady();

  const hits = [];
  for (const it of idx) {
    if (it.n.includes(q)) hits.push(it.h);
    if (hits.length >= 400) break;
  }
  d2log("Name hits:", hits.length);

  // Some weapons exist twice in the manifest under different hashes with an
  // otherwise identical name/season (a leftover duplicate definition — usually
  // only one of the two actually drops in-game). Group ALL hits (not just the
  // page shown to the user) by exact name so every sibling hash is known,
  // letting the wishlist auto-link them for matching purposes.
  const nameToHashes = new Map();
  for (const h of hits) {
    const def = defs.get(String(h));
    if (!isRealWeaponDef(def)) continue;
    const name = def.displayProperties?.name || "";
    if (!name) continue;
    if (!nameToHashes.has(name)) nameToHashes.set(name, []);
    nameToHashes.get(name).push(def.hash);
  }

  const out = [];
  for (const h of hits) {
    const def = defs.get(String(h));
    if (!isRealWeaponDef(def)) continue;
    const name = def.displayProperties?.name || "";
    out.push({
      hash: def.hash,
      name,
      icon: def.displayProperties?.icon ? `${BUNGIE_ROOT}${def.displayProperties.icon}` : "",
      itemSubType: def.itemSubType,
      damageTypeHash: def.defaultDamageTypeHash,
      ammoType: def.equippingBlock?.ammoType,
      itemTypeDisplayName: def.itemTypeDisplayName || "",
      watermarkIcon: def.iconWatermark ? `${BUNGIE_ROOT}${def.iconWatermark}` : "",
      seasonLabel: getSeasonLabelForWatermark(def.iconWatermark, watermarkMap),
      linkedHashes: (nameToHashes.get(name) || []).filter((sibHash) => sibHash !== def.hash),
      originTraitCount: countOriginTraits(def, defs)
    });
    if (out.length >= 50) break;
  }
  // Group identical names together so duplicates (reissues/curated rolls)
  // sit adjacent and are easy to visually compare via their season badge.
  out.sort((a, b) => a.name.localeCompare(b.name));
  d2log("Weapon candidates:", out.length);

  console.groupEnd();
  return out;
}

// Splits a weapon def's WEAPON PERKS socket category into ordered perk
// columns, resolving each socket's plug pool (reusable or randomized plug
// set) to real display names. Skips a column only when EVERY candidate plug
// is a known trinket (kill/crucible tracker) - otherwise keeps it, even if
// mislabeled, so unusual weapon layouts (exotics/bows/glaives) degrade
// gracefully instead of breaking crafting entirely.
async function getWeaponPerkColumns(def) {
  const rawColumns = [];
  if (!def?.sockets?.socketCategories || !def?.sockets?.socketEntries) return rawColumns;

  const perksCategory = def.sockets.socketCategories.find(
    (c) => c.socketCategoryHash === WEAPON_PERKS_CATEGORY_HASH
  );
  if (!perksCategory) return rawColumns;

  await ensurePlugSetDefsReady({ force: false });
  const itemDefs = await loadInventoryItemDefsToMemory();

  for (const socketIndex of perksCategory.socketIndexes) {
    const socket = def.sockets.socketEntries[socketIndex];
    if (!socket) continue;

    const plugSetHash = socket.randomizedPlugSetHash || socket.reusablePlugSetHash;
    let plugHashes = [];

    if (plugSetHash) {
      const plugSetDef = await getPlugSetDef(plugSetHash);
      if (plugSetDef?.reusablePlugItems) {
        plugHashes = plugSetDef.reusablePlugItems.map((p) => p.plugItemHash);
      }
    } else if (Array.isArray(socket.reusablePlugItems) && socket.reusablePlugItems.length) {
      plugHashes = socket.reusablePlugItems.map((p) => p.plugItemHash);
    } else if (socket.singleInitialItemHash) {
      plugHashes = [socket.singleInitialItemHash];
    }

    if (plugHashes.length === 0) continue;

    const seenPlugHashes = new Set();
    const plugs = [];
    for (const h of plugHashes) {
      if (seenPlugHashes.has(h)) continue; // plug sets can repeat a hash across craft levels
      seenPlugHashes.add(h);
      const plugDef = itemDefs.get(String(h));
      const stats = (plugDef?.investmentStats || [])
        .filter((s) => s.value !== 0)
        .map((s) => ({ hash: s.statTypeHash, value: s.value, conditional: !!s.isConditionallyActive }));
      plugs.push({
        hash: h,
        name: plugDef?.displayProperties?.name || `Unknown (${h})`,
        description: plugDef?.displayProperties?.description || '',
        icon: plugDef?.displayProperties?.icon ? `${BUNGIE_ROOT}${plugDef.displayProperties.icon}` : "",
        stats,
        tier: plugDef?.inventory?.tierType ?? 0,
        // Modern (post-Edge of Fate) enhanced plugs keep the SAME display name
        // as their base version - the marker is itemTypeDisplayName ("Enhanced
        // Trait", "Enhanced Barrel", ...). Older crafted-weapon enhanced traits
        // instead prefix the display name itself ("Enhanced Outlaw"). Some
        // (origin traits) carry neither marker; those are caught by the
        // tier-comparison fallback during pairing below.
        isEnhanced: /^Enhanced\b/.test(plugDef?.itemTypeDisplayName || '')
          || (plugDef?.displayProperties?.name || '').startsWith('Enhanced ')
      });
    }

    const allTrackers = plugs.length > 0 && plugs.every((p) => WEAPON_TRACKER_PLUG_NAME_PATTERN.test(p.name));
    if (allTrackers) continue;

    rawColumns.push({ socketIndex, plugs });
  }

  // Crafted weapons put enhanced traits in their own socket, separate from the
  // base trait socket (not mixed into one plug pool) - so pairing has to
  // happen ACROSS columns, not within a single socket's plug list. Enhanced
  // and base columns can appear in either order, so resolve all-enhanced
  // columns first, then match each base column against them.
  const isAllEnhanced = (col) => col.plugs.length > 0 && col.plugs.every((p) => p.isEnhanced);
  const consumed = new Set();
  const columns = new Array(rawColumns.length).fill(null);

  rawColumns.forEach((col, colIndex) => {
    if (isAllEnhanced(col)) return; // handled by its matching base column below

    const baseNames = new Set(col.plugs.map((p) => p.name));
    let enhancedColIndex = -1;
    for (let i = 0; i < rawColumns.length; i++) {
      if (consumed.has(i) || i === colIndex) continue;
      const candidate = rawColumns[i];
      if (!isAllEnhanced(candidate)) continue;
      const overlap = candidate.plugs.some((p) => baseNames.has(p.name.replace(/^Enhanced /, '')));
      if (overlap) { enhancedColIndex = i; break; }
    }

    // Group every candidate plug (this socket's plugs + any cross-column
    // enhanced plugs) by display name, stripped of the legacy "Enhanced "
    // prefix. Each group resolves to one { base, enhanced } pair.
    const groups = new Map();
    const addToGroup = (p) => {
      const key = p.name.replace(/^Enhanced /, '');
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(p);
    };
    col.plugs.forEach(addToGroup);
    (enhancedColIndex >= 0 ? rawColumns[enhancedColIndex].plugs : []).forEach(addToGroup);

    const pairs = [];
    for (const group of groups.values()) {
      const enhancedCandidates = group.filter((p) => p.isEnhanced);
      let baseCandidates = group.filter((p) => !p.isEnhanced);

      // Tier fallback: enhanced origin traits carry no "Enhanced" marker at
      // all - within a same-name group the higher inventory tier is the
      // enhanced version. Same-tier repeats are true duplicates (kept once).
      if (enhancedCandidates.length === 0 && baseCandidates.length >= 2) {
        baseCandidates.sort((a, b) => (a.tier || 0) - (b.tier || 0));
        const hi = baseCandidates[baseCandidates.length - 1];
        if ((hi.tier || 0) > (baseCandidates[0].tier || 0)) {
          enhancedCandidates.push(hi);
          baseCandidates = baseCandidates.slice(0, -1);
        }
      }

      const base = baseCandidates[0] || enhancedCandidates.shift();
      const enhanced = baseCandidates.length ? (enhancedCandidates[0] || null) : null;
      pairs.push({ base, enhanced });
    }

    if (enhancedColIndex >= 0) consumed.add(enhancedColIndex);
    columns[colIndex] = { socketIndex: col.socketIndex, pairs };
  });

  // Any all-enhanced column never claimed by a base column stands on its own
  rawColumns.forEach((col, colIndex) => {
    if (columns[colIndex] || consumed.has(colIndex)) return;
    if (isAllEnhanced(col)) {
      columns[colIndex] = { socketIndex: col.socketIndex, pairs: col.plugs.map((enh) => ({ base: enh, enhanced: null })) };
    }
  });

  return columns.filter(Boolean);
}

// --- EXPORTS ---
// For use in other modules
// All functions and constants are globally available:
// - BUCKET_HASHES
// - ensureInventoryItemDefsReady()
// - ensureEquippableItemSetDefsReady()
// - ensurePlugSetDefsReady()
// - searchArmorLocally()
// - searchWeaponsLocally()
// - getWeaponPerkColumns()
// - getArmorSetLookup()
// - getArmorSetName()
// - getArmorSetBonuses() / describeSetBonuses()
// - getArmorSetHashForItem()
