// ===============================
// Destiny 2 Manifest Loader & Utilities
// DIM-style local manifest loader with gzip decompression support
// Fetches & caches DestinyInventoryItemDefinition and DestinyEquippableItemSetDefinition
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
let _damageTypeDefs = null;   // Map<damageTypeHash, defObject>
let _statDefs = null;         // Map<statHash, defObject>
let _manifestVersion = null;  // string

function d2log(...args) { console.log("[D2MANIFEST]", ...args); }
function d2warn(...args) { console.warn("[D2MANIFEST]", ...args); }
function d2err(...args) { console.error("[D2MANIFEST]", ...args); }

function resetManifestMemory() {
  _invItemDefs = null;
  _armorSetDefs = null;
  _nameIndex = null;
  _armorSetLookup = null;
  _damageTypeDefs = null;
  _statDefs = null;
  _manifestVersion = null;
}

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

// Download DestinyInventoryItemDefinition component JSON and cache it.
async function ensureInventoryItemDefsReady({ force = false } = {}) {
  console.groupCollapsed("[D2MANIFEST] ensureInventoryItemDefsReady");

  try {
    const meta = await fetchManifestMeta();
    const liveVersion = meta.version;
    _manifestVersion = liveVersion;
    d2log("Live manifest version:", liveVersion);

    const cachedVersion = await idbGet("manifestVersion", STORE_META);
    d2log("Cached manifest version:", cachedVersion);

    const haveCachedBlob = await idbGet("DestinyInventoryItemDefinition", STORE_BLOBS);
    const needsDownload = force || !haveCachedBlob || !cachedVersion || cachedVersion !== liveVersion;

    if (!needsDownload) {
      d2log("Manifest cache is up-to-date. Skipping download.");
      return true;
    }

    const lang = "en";
    const comp = meta.jsonWorldComponentContentPaths?.[lang]?.DestinyInventoryItemDefinition;
    const world = meta.jsonWorldContentPaths?.[lang];

    let path = comp || world;
    if (!path) {
      d2warn("Manifest meta did not include expected JSON paths. Keys:", Object.keys(meta || {}));
      throw new Error("No usable JSON manifest path found (jsonWorldComponentContentPaths / jsonWorldContentPaths).");
    }
    if (!path.startsWith("http")) path = `${BUNGIE_ROOT}${path}`;
    d2log("Downloading manifest content from:", path, "| component?", !!comp);

    const r = await fetch(path, { headers: { "Accept": "application/json" } });
    if (!r.ok) {
      const t = await r.text().catch(() => "");
      throw new Error(`Manifest download failed HTTP ${r.status}. Body: ${t.slice(0, 200)}`);
    }
    const buf = await r.arrayBuffer();
    d2log("Downloaded bytes:", buf.byteLength);

    const text = await bytesToTextMaybeGzip(buf, r.headers.get("content-type") || "");
    d2log("Decoded text length:", text.length);

    const parsed = JSON.parse(text);

    const itemDefs = comp ? parsed : parsed?.DestinyInventoryItemDefinition;
    if (!itemDefs) {
      const keys = Object.keys(parsed || {});
      d2warn("Parsed manifest keys (sample):", keys.slice(0, 30));
      throw new Error("Downloaded JSON did not contain DestinyInventoryItemDefinition data.");
    }

    await idbSet("DestinyInventoryItemDefinition", itemDefs, STORE_BLOBS);
    await idbSet("manifestVersion", liveVersion, STORE_META);

    _invItemDefs = null;
    _nameIndex = null;

    d2log("Manifest cache updated successfully.");
    return true;
  } catch (e) {
    d2err("ensureInventoryItemDefsReady FAILED:", e);
    return false;
  } finally {
    console.groupEnd();
  }
}

// Download DestinyEquippableItemSetDefinition component JSON and cache it.
async function ensureEquippableItemSetDefsReady({ force = false } = {}) {
  console.groupCollapsed("[D2MANIFEST] ensureEquippableItemSetDefsReady");

  try {
    const meta = await fetchManifestMeta();
    const liveVersion = meta.version;
    d2log("Live manifest version:", liveVersion);

    const cachedVersion = await idbGet("manifestVersion", STORE_META);
    const haveCachedBlob = await idbGet("DestinyEquippableItemSetDefinition", STORE_BLOBS);
    const needsDownload = force || !haveCachedBlob || !cachedVersion || cachedVersion !== liveVersion;

    if (!needsDownload) {
      d2log("Armor set defs cache is up-to-date. Skipping download.");
      return true;
    }

    const lang = "en";
    const setDefsPath = meta.jsonWorldComponentContentPaths?.[lang]?.DestinyEquippableItemSetDefinition;
    
    if (!setDefsPath) {
      d2log("DestinyEquippableItemSetDefinition not available in manifest meta; skipping.");
      return false;
    }

    let path = setDefsPath;
    if (!path.startsWith("http")) path = `${BUNGIE_ROOT}${path}`;
    d2log("Downloading armor set definitions from:", path);

    const r = await fetch(path, { headers: { "Accept": "application/json" } });
    if (!r.ok) {
      const t = await r.text().catch(() => "");
      throw new Error(`Armor set defs download failed HTTP ${r.status}. Body: ${t.slice(0, 200)}`);
    }
    const buf = await r.arrayBuffer();
    d2log("Downloaded bytes:", buf.byteLength);

    const text = await bytesToTextMaybeGzip(buf, r.headers.get("content-type") || "");

    const parsed = JSON.parse(text);
    await idbSet("DestinyEquippableItemSetDefinition", parsed, STORE_BLOBS);

    _armorSetDefs = null;
    _armorSetLookup = null;

    d2log("Armor set defs cache updated successfully.");
    return true;
  } catch (e) {
    d2err("ensureEquippableItemSetDefsReady FAILED:", e);
    return false;
  } finally {
    console.groupEnd();
  }
}

// Download DestinyCollectibleDefinition component JSON and cache it.
async function ensureCollectibleDefsReady({ force = false } = {}) {
  console.groupCollapsed("[D2MANIFEST] ensureCollectibleDefsReady");

  try {
    const meta = await fetchManifestMeta();
    const liveVersion = meta.version;
    d2log("Live manifest version:", liveVersion);

    const cachedVersion = await idbGet("manifestVersion", STORE_META);
    const haveCachedBlob = await idbGet("DestinyCollectibleDefinition", STORE_BLOBS);
    const needsDownload = force || !haveCachedBlob || !cachedVersion || cachedVersion !== liveVersion;

    if (!needsDownload) {
      d2log("Collectible defs cache is up-to-date. Skipping download.");
      return true;
    }

    const lang = "en";
    const comp = meta.jsonWorldComponentContentPaths?.[lang]?.DestinyCollectibleDefinition;
    const world = meta.jsonWorldContentPaths?.[lang];

    let path = comp || world;
    if (!path) {
      d2warn("Collectible defs not available in manifest meta; skipping.");
      return false;
    }
    if (!path.startsWith("http")) path = `${BUNGIE_ROOT}${path}`;
    d2log("Downloading collectible definitions from:", path, "| component?", !!comp);

    const r = await fetch(path, { headers: { "Accept": "application/json" } });
    if (!r.ok) {
      const t = await r.text().catch(() => "");
      throw new Error(`Collectible defs download failed HTTP ${r.status}. Body: ${t.slice(0, 200)}`);
    }
    const buf = await r.arrayBuffer();
    d2log("Downloaded bytes:", buf.byteLength);

    const text = await bytesToTextMaybeGzip(buf, r.headers.get("content-type") || "");
    const parsed = JSON.parse(text);

    const collectibleDefs = comp ? parsed : parsed?.DestinyCollectibleDefinition;
    if (!collectibleDefs) {
      const keys = Object.keys(parsed || {});
      d2warn("Parsed manifest keys (sample):", keys.slice(0, 30));
      throw new Error("Downloaded JSON did not contain DestinyCollectibleDefinition data.");
    }

    await idbSet("DestinyCollectibleDefinition", collectibleDefs, STORE_BLOBS);
    d2log("Collectible defs cache updated successfully.");
    return true;
  } catch (e) {
    d2err("ensureCollectibleDefsReady FAILED:", e);
    return false;
  } finally {
    console.groupEnd();
  }
}

// Download DestinyDamageTypeDefinition component JSON and cache it.
async function ensureDamageTypeDefsReady({ force = false } = {}) {
  console.groupCollapsed("[D2MANIFEST] ensureDamageTypeDefsReady");

  try {
    const meta = await fetchManifestMeta();
    const liveVersion = meta.version;
    d2log("Live manifest version:", liveVersion);

    const cachedVersion = await idbGet("manifestVersion", STORE_META);
    const haveCachedBlob = await idbGet("DestinyDamageTypeDefinition", STORE_BLOBS);
    const needsDownload = force || !haveCachedBlob || !cachedVersion || cachedVersion !== liveVersion;

    if (!needsDownload) {
      d2log("Damage type defs cache is up-to-date. Skipping download.");
      return true;
    }

    const lang = "en";
    const comp = meta.jsonWorldComponentContentPaths?.[lang]?.DestinyDamageTypeDefinition;
    const world = meta.jsonWorldContentPaths?.[lang];

    let path = comp || world;
    if (!path) {
      d2warn("Damage type defs not available in manifest meta; skipping.");
      return false;
    }
    if (!path.startsWith("http")) path = `${BUNGIE_ROOT}${path}`;
    d2log("Downloading damage type definitions from:", path, "| component?", !!comp);

    const r = await fetch(path, { headers: { "Accept": "application/json" } });
    if (!r.ok) {
      const t = await r.text().catch(() => "");
      throw new Error(`Damage type defs download failed HTTP ${r.status}. Body: ${t.slice(0, 200)}`);
    }
    const buf = await r.arrayBuffer();
    d2log("Downloaded bytes:", buf.byteLength);

    const text = await bytesToTextMaybeGzip(buf, r.headers.get("content-type") || "");
    const parsed = JSON.parse(text);

    const damageTypeDefs = comp ? parsed : parsed?.DestinyDamageTypeDefinition;
    if (!damageTypeDefs) {
      const keys = Object.keys(parsed || {});
      d2warn("Parsed manifest keys (sample):", keys.slice(0, 30));
      throw new Error("Downloaded JSON did not contain DestinyDamageTypeDefinition data.");
    }

    await idbSet("DestinyDamageTypeDefinition", damageTypeDefs, STORE_BLOBS);
    _damageTypeDefs = null;
    d2log("Damage type defs cache updated successfully.");
    return true;
  } catch (e) {
    d2err("ensureDamageTypeDefsReady FAILED:", e);
    return false;
  } finally {
    console.groupEnd();
  }
}

// Download DestinyStatDefinition component JSON and cache it.
async function ensureStatDefsReady({ force = false } = {}) {
  console.groupCollapsed("[D2MANIFEST] ensureStatDefsReady");

  try {
    const meta = await fetchManifestMeta();
    const liveVersion = meta.version;
    d2log("Live manifest version:", liveVersion);

    const cachedVersion = await idbGet("manifestVersion", STORE_META);
    const haveCachedBlob = await idbGet("DestinyStatDefinition", STORE_BLOBS);
    const needsDownload = force || !haveCachedBlob || !cachedVersion || cachedVersion !== liveVersion;

    if (!needsDownload) {
      d2log("Stat defs cache is up-to-date. Skipping download.");
      return true;
    }

    const lang = "en";
    const comp = meta.jsonWorldComponentContentPaths?.[lang]?.DestinyStatDefinition;
    const world = meta.jsonWorldContentPaths?.[lang];

    let path = comp || world;
    if (!path) {
      d2warn("Stat defs not available in manifest meta; skipping.");
      return false;
    }
    if (!path.startsWith("http")) path = `${BUNGIE_ROOT}${path}`;
    d2log("Downloading stat definitions from:", path, "| component?", !!comp);

    const r = await fetch(path, { headers: { "Accept": "application/json" } });
    if (!r.ok) {
      const t = await r.text().catch(() => "");
      throw new Error(`Stat defs download failed HTTP ${r.status}. Body: ${t.slice(0, 200)}`);
    }
    const buf = await r.arrayBuffer();
    d2log("Downloaded bytes:", buf.byteLength);

    const text = await bytesToTextMaybeGzip(buf, r.headers.get("content-type") || "");
    const parsed = JSON.parse(text);

    const statDefs = comp ? parsed : parsed?.DestinyStatDefinition;
    if (!statDefs) {
      const keys = Object.keys(parsed || {});
      d2warn("Parsed manifest keys (sample):", keys.slice(0, 30));
      throw new Error("Downloaded JSON did not contain DestinyStatDefinition data.");
    }

    await idbSet("DestinyStatDefinition", statDefs, STORE_BLOBS);
    _statDefs = null;
    d2log("Stat defs cache updated successfully.");
    return true;
  } catch (e) {
    d2err("ensureStatDefsReady FAILED:", e);
    return false;
  } finally {
    console.groupEnd();
  }
}

// --- MEMORY LOADING ---
async function loadInventoryItemDefsToMemory() {
  if (_invItemDefs) return _invItemDefs;

  console.groupCollapsed("[D2MANIFEST] loadInventoryItemDefsToMemory");
  const blob = await idbGet("DestinyInventoryItemDefinition", STORE_BLOBS);
  if (!blob) {
    d2warn("No cached item defs found. Attempting download...");
    const ok = await ensureInventoryItemDefsReady({ force: false });
    if (!ok) throw new Error("Unable to download/cache manifest; see logs above.");
  }
  const defsObj = await idbGet("DestinyInventoryItemDefinition", STORE_BLOBS);
  if (!defsObj) throw new Error("Item defs still missing after ensureInventoryItemDefsReady.");

  const map = new Map();
  let count = 0;
  for (const [hashStr, def] of Object.entries(defsObj)) {
    map.set(String(hashStr), def);
    count++;
  }
  _invItemDefs = map;
  d2log("Loaded defs into memory:", count);
  console.groupEnd();
  return _invItemDefs;
}

async function loadArmorSetDefsToMemory() {
  if (_armorSetDefs) return _armorSetDefs;

  console.groupCollapsed("[D2MANIFEST] loadArmorSetDefsToMemory");
  const blob = await idbGet("DestinyEquippableItemSetDefinition", STORE_BLOBS);
  if (!blob) {
    d2warn("No cached armor set defs found.");
    return null;
  }

  const map = new Map();
  let count = 0;
  for (const [hashStr, def] of Object.entries(blob)) {
    map.set(String(hashStr), def);
    count++;
  }
  _armorSetDefs = map;
  d2log("Loaded armor set defs into memory:", count);
  console.groupEnd();
  return _armorSetDefs;
}

async function loadDamageTypeDefsToMemory() {
  if (_damageTypeDefs) return _damageTypeDefs;

  console.groupCollapsed("[D2MANIFEST] loadDamageTypeDefsToMemory");
  const blob = await idbGet("DestinyDamageTypeDefinition", STORE_BLOBS);
  if (!blob) {
    d2warn("No cached damage type defs found. Attempting download...");
    const ok = await ensureDamageTypeDefsReady({ force: false });
    if (!ok) {
      console.groupEnd();
      return null;
    }
  }
  const defsObj = await idbGet("DestinyDamageTypeDefinition", STORE_BLOBS);
  if (!defsObj) {
    console.groupEnd();
    return null;
  }

  const map = new Map();
  let count = 0;
  for (const [hashStr, def] of Object.entries(defsObj)) {
    map.set(String(hashStr), def);
    count++;
  }
  _damageTypeDefs = map;
  d2log("Loaded damage type defs into memory:", count);
  console.groupEnd();
  return _damageTypeDefs;
}

async function loadStatDefsToMemory() {
  if (_statDefs) return _statDefs;

  console.groupCollapsed("[D2MANIFEST] loadStatDefsToMemory");
  const blob = await idbGet("DestinyStatDefinition", STORE_BLOBS);
  if (!blob) {
    d2warn("No cached stat defs found. Attempting download...");
    const ok = await ensureStatDefsReady({ force: false });
    if (!ok) {
      console.groupEnd();
      return null;
    }
  }
  const defsObj = await idbGet("DestinyStatDefinition", STORE_BLOBS);
  if (!defsObj) {
    console.groupEnd();
    return null;
  }

  const map = new Map();
  let count = 0;
  for (const [hashStr, def] of Object.entries(defsObj)) {
    map.set(String(hashStr), def);
    count++;
  }
  _statDefs = map;
  d2log("Loaded stat defs into memory:", count);
  console.groupEnd();
  return _statDefs;
}

function normalizeStatName(name) {
  return String(name || "")
    .toLowerCase()
    .replace(/[^a-z]/g, "");
}

// --- LOOKUP TABLES ---
async function getArmorSetLookup() {
  if (_armorSetLookup) return _armorSetLookup;

  console.groupCollapsed("[D2MANIFEST] buildArmorSetLookup");

  const defs = await loadInventoryItemDefsToMemory();
  const lookup = new Map();
  const setsByHash = new Map(); // Temporary: hash → array of item names
  let itemCount = 0;

  // First pass: collect all armor items grouped by set hash
  for (const [hash, def] of defs.entries()) {
    if (!isRealArmorDef(def)) continue;

    const setHash = def.equippingBlock?.equipableItemSetHash;
    if (!setHash) continue;

    const setHashStr = String(setHash);
    const itemName = def.displayProperties?.name || "";
    const item = {
      hash,
      name: itemName,
      icon: def.displayProperties?.icon || "",
      classType: def.classType,
      bucketHash: def.inventory?.bucketTypeHash
    };

    if (!setsByHash.has(setHashStr)) {
      setsByHash.set(setHashStr, []);
    }

    setsByHash.get(setHashStr).push(item);
    itemCount++;
  }

  // Second pass: extract set name from common words
  for (const [setHashStr, items] of setsByHash.entries()) {
    if (items.length === 0) continue;

    // Get common words across all item names
    const setName = extractCommonSetName(items.map(it => it.name));

    lookup.set(setHashStr, {
      name: setName,
      items: items
    });
  }

  _armorSetLookup = lookup;
  d2log("Built armor set lookup:", lookup.size, "sets,", itemCount, "items");
  console.groupEnd();
  return _armorSetLookup;
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
  const YIELD_EVERY = 5000;

  for (const [h, def] of defs.entries()) {
    const name = def?.displayProperties?.name;
    if (!name) continue;
    idx.push({ h, n: name.toLowerCase() });
    scanned++;
    if (scanned % YIELD_EVERY === 0) {
      await new Promise((r) => setTimeout(r, 0));
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

// ===============================
// WEAPON CRAFTING SYSTEM - Phase 1 Extension
// ===============================

// --- WEAPON BUCKET HASHES ---
const WEAPON_BUCKET_HASHES = {
  KINETIC: 1498876634,
  SPECIAL: 2048327096,
  HEAVY: 953998645,
};

// --- PERK STAT BONUSES LOOKUP TABLE ---
// Maps perk hash → stat bonuses (static, non-conditional perks only)
// Values are integer deltas (e.g., +5 reload)
const PERK_STAT_BONUSES = {
  // Barrel Perks
  3142371805: { recoilDirection: 15, handling: 7 },           // Arrowhead Brake
  1467527085: { recoilDirection: 10, stability: 4 },          // Chambered Compensator
  2278692867: { stability: 5 },                               // Corkscrew Rifling
  3300014278: { range: 8, stability: 3 },                     // Polygonal Rifling
  3661387068: { handling: 10 },                               // SmallBore
  1985240521: { range: 12 },                                  // Extended Barrel
  1954620775: { handling: 12, stability: -5 },                // Fluted Barrel
  2888870187: { range: 5, handling: 12 },                     // Tactical rig
  3301904760: { stability: 10, handling: -5 },                // Full Bore

  // Magazine Perks
  2916594351: { magazine: 10, reload: -6 },                   // Armor Piercing Rounds
  4071414230: { magazine: 14, reload: -8 },                   // High-Caliber Rounds
  3370581552: { reload: 18 },                                 // Ricochet Rounds
  679112144: { magazine: 12 },                                // Extended Mag
  4152351501: { reload: 12 },                                 // Appended Mag
  3147027646: { reload: 20, magazine: -4 },                   // Flared Magwell
  2888870187: { magazine: 8 },                                // Particle Repeater
  2255544896: { reload: 8 },                                  // Accurized Round

  // Trait Perks (Primary stat effects only - no conditional effects like Rampage x1/x2/x3)
  2652596479: { reload: 15 },                                 // Rampage (base bonus)
  3708227201: { handling: 12 },                               // Kill Clip (base bonus)
  2326428976: { range: 20 },                                  // Outlaw
  1627120122: { stability: 18 },                              // Zen Moment
  1090496154: { reload: 8, handling: 5 },                     // Elemental Time Dilation
  1607674147: { reload: 25 },                                 // Feeding Frenzy
};

/**
 * Search for weapons in the loaded manifest by name.
 *
 * @param {string} query - Search term (weapon name)
 * @param {number} bucketHash - Optional bucket hash filter (KINETIC, SPECIAL, HEAVY)
 * @returns {Array} Array of {hash, name, icon, type}
 */
async function searchWeaponsLocally(query, bucketHash = null) {
  const q = String(query || "").trim().toLowerCase();
  if (q.length < 2) return [];

  d2log("searchWeaponsLocally:", q);

  const ok = await ensureInventoryItemDefsReady({ force: false });
  if (!ok) throw new Error("Manifest not available");

  const defs = await loadInventoryItemDefsToMemory();
  const idx = await buildNameIndexIfNeeded();

  // Name index lookup
  const hits = [];
  for (const it of idx) {
    if (it.n.includes(q)) hits.push(it.h);
    if (hits.length >= 400) break;
  }

  // Filter by weapon criteria
  const candidates = [];
  for (const h of hits) {
    const def = defs.get(String(h));
    if (!isRealWeaponDef(def)) continue;
    if (bucketHash && def.inventory?.bucketTypeHash !== bucketHash) continue;
    candidates.push(def);
    if (candidates.length >= 100) break;
  }

  const out = candidates.map((item) => ({
    hash: item.hash,
    name: item.displayProperties?.name || "",
    icon: item.displayProperties?.icon ? `${BUNGIE_ROOT}${item.displayProperties.icon}` : "",
    type: item.itemTypeDisplayName || "Weapon",
    damageType: item.damageTypeHashes?.[0] || null,
  }));

  return out;
}

/**
 * Helper: Check if a definition is a real weapon.
 * Weapons have itemCategoryHash 1 (Weapon), are not exotic duplicates, etc.
 */
function isRealWeaponDef(def) {
  if (!def) return false;
  const categories = Array.isArray(def.itemCategoryHashes)
    ? def.itemCategoryHashes
    : Array.isArray(def.itemCategory)
      ? def.itemCategory
      : null;
  if (!categories) return false;
  // Item category 1 = Weapon
  if (!categories.some((h) => h === 1)) return false;
  // Skip quest items, dummy items, etc.
  if (def.displayProperties?.name?.includes("DEPRECATED")) return false;
  if (!def.inventory || !def.inventory.bucketTypeHash) return false;
  // Only kinetic, special, heavy
  const bucket = def.inventory.bucketTypeHash;
  if (
    bucket !== WEAPON_BUCKET_HASHES.KINETIC &&
    bucket !== WEAPON_BUCKET_HASHES.SPECIAL &&
    bucket !== WEAPON_BUCKET_HASHES.HEAVY
  ) {
    return false;
  }
  return true;
}

/**
 * Get weapon stats (impact, range, stability, etc.).
 *
 * @param {number} weaponHash - Weapon inventory hash
 * @returns {Object} {impact, range, stability, handling, reload, magazine, zoom, aimAssistance, recoilDirection}
 */
async function getWeaponStats(weaponHash) {
  const defs = await loadInventoryItemDefsToMemory();
  const def = defs.get(String(weaponHash));
  if (!def) return {};

  // Extract stats from definition
  const stats = {};
  const invStats = def.stats?.stats || {};
  const statDefs = await loadStatDefsToMemory();

  const nameToKey = {
    impact: "impact",
    range: "range",
    stability: "stability",
    handling: "handling",
    reloadspeed: "reload",
    reload: "reload",
    magazine: "magazine",
    zoom: "zoom",
    aimassist: "aimAssistance",
    aimassistance: "aimAssistance",
    recoildirection: "recoilDirection",
  };

  for (const [statHash, stat] of Object.entries(invStats)) {
    const statDef = def.stats?.stats[statHash];
    if (!statDef) continue;

    if (statDefs) {
      const defEntry = statDefs.get(String(statHash));
      const displayName = defEntry?.displayProperties?.name || defEntry?.name || "";
      const normalized = normalizeStatName(displayName);
      const key = nameToKey[normalized];
      if (key) {
        stats[key] = statDef.value;
        continue;
      }
    }

    // Map common stat hashes to friendly names
    switch (parseInt(statHash)) {
      case 4284049017:
        stats.impact = statDef.value;
        break; // Impact
      case 1240592695:
        stats.range = statDef.value;
        break; // Range
      case 155624089:
        stats.stability = statDef.value;
        break; // Stability
      case 943549884:
        stats.handling = statDef.value;
        break; // Handling
      case 4188031246:
        stats.reload = statDef.value;
        break; // Reload Speed
      case 3871231066:
        stats.magazine = statDef.value;
        break; // Magazine
      case 2996146976:
        stats.zoom = statDef.value;
        break; // Zoom
      case 1345867579:
        stats.aimAssistance = statDef.value;
        break; // Aim Assistance
      case 4043523819:
        stats.recoilDirection = statDef.value;
        break; // Recoil Direction
    }
  }

  return stats;
}

/**
 * Get weapon socket information (perk slots).
 *
 * @param {number} weaponHash - Weapon inventory hash
 * @returns {Array} Array of {socketIndex, socketTypeHash, reusablePlugSetHash}
 */
async function getWeaponSockets(weaponHash) {
  const defs = await loadInventoryItemDefsToMemory();
  const def = defs.get(String(weaponHash));
  if (!def || !def.sockets || !def.sockets.socketEntries) return [];

  return def.sockets.socketEntries.map((socket, index) => ({
    socketIndex: index,
    socketTypeHash: socket.socketTypeHash,
    reusablePlugSetHash: socket.reusablePlugSetHash,
  }));
}

/**
 * Get available perks for a specific weapon socket.
 *
 * @param {number} weaponHash - Weapon inventory hash
 * @param {number} socketIndex - Socket index (0-4)
 * @returns {Array} Array of {perkHash, perkName, statBonus}
 */
async function getSocketPerks(weaponHash, socketIndex) {
  const defs = await loadInventoryItemDefsToMemory();
  const def = defs.get(String(weaponHash));
  if (!def || !def.sockets || !def.sockets.socketEntries[socketIndex]) return [];

  const socket = def.sockets.socketEntries[socketIndex];
  const plugSetHash = socket.reusablePlugSetHash;

  // Load plug set definition
  const plugSetDef = defs.get(String(plugSetHash));
  if (!plugSetDef || !plugSetDef.reusablePlugItems) return [];

  const perks = [];
  for (const plugItem of plugSetDef.reusablePlugItems) {
    const perkHash = plugItem.plugItemHash;
    const perkDef = defs.get(String(perkHash));
    if (!perkDef) continue;

    const perkName = perkDef.displayProperties?.name || "Unknown Perk";
    const statBonus = window.weaponStatsService?.getStaticBonuses
      ? window.weaponStatsService.getStaticBonuses(perkHash)
      : PERK_STAT_BONUSES[perkHash] || {};

    perks.push({
      perkHash,
      perkName,
      icon: perkDef.displayProperties?.icon ? `${BUNGIE_ROOT}${perkDef.displayProperties.icon}` : "",
      statBonus,
    });
  }

  return perks;
}

/**
 * Get perk name by hash.
 *
 * @param {number} perkHash - Perk hash
 * @returns {string} Perk display name
 */
async function getPerkName(perkHash) {
  const defs = await loadInventoryItemDefsToMemory();
  const def = defs.get(String(perkHash));
  return def?.displayProperties?.name || "Unknown Perk";
}

/**
 * Get damage type definitions.
 *
 * @returns {Promise<Map>} Map of damageTypeHash -> def
 */
async function getDamageTypeDefs() {
  return loadDamageTypeDefsToMemory();
}

// --- EXPORTS ---
// For use in other modules
// All functions and constants are globally available:
// - BUCKET_HASHES
// - WEAPON_BUCKET_HASHES
// - PERK_STAT_BONUSES
// - ensureInventoryItemDefsReady()
// - ensureEquippableItemSetDefsReady()
// - ensureCollectibleDefsReady()
// - ensureDamageTypeDefsReady()
// - resetManifestMemory()
// - searchArmorLocally()
// - searchWeaponsLocally()
// - getArmorSetLookup()
// - getArmorSetName()
// - getWeaponStats()
// - getWeaponSockets()
// - getSocketPerks()
// - getPerkName()
// - getDamageTypeDefs()

// --- GLOBAL NAMESPACE ---
// Expose all manifest functions under window.__manifest__ for easy access
window.__manifest__ = {
  // Initialization
  ensureInventoryItemDefsReady,
  ensureEquippableItemSetDefsReady,
  ensureCollectibleDefsReady,
  ensureDamageTypeDefsReady,
  ensureStatDefsReady,
  resetManifestMemory,
  
  // Armor functions
  searchArmorLocally,
  getArmorSetLookup,
  getArmorSetName,
  BUCKET_HASHES,
  
  // Weapon functions
  searchWeaponsLocally,
  getWeaponStats,
  getWeaponSockets,
  getSocketPerks,
  getPerkName,
  getDamageTypeDefs,
  loadStatDefsToMemory,
  WEAPON_BUCKET_HASHES,
  PERK_STAT_BONUSES,
  
  // Manifest data (will be populated after loading)
  get DestinyInventoryItemDefinition() {
    return _invItemDefs || new Map();
  },
  get DestinyDamageTypeDefinition() {
    return _damageTypeDefs || new Map();
  },
  get DestinyStatDefinition() {
    return _statDefs || new Map();
  }
};

d2log('✅ Manifest module loaded. Access via window.__manifest__');
