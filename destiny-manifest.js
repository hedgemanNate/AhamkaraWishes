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

// --- EXPORTS ---
// For use in other modules
// All functions and constants are globally available:
// - BUCKET_HASHES
// - ensureInventoryItemDefsReady()
// - ensureEquippableItemSetDefsReady()
// - searchArmorLocally()
// - getArmorSetLookup()
// - getArmorSetName()
