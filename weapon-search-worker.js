const D2DB_NAME = "d2_manifest_cache";
const D2DB_VERSION = 1;
const STORE_BLOBS = "blobs";
const BUNGIE_ROOT = "https://www.bungie.net";

let itemDefs = null;
let collectibleDefs = null;
let nameIndex = null;
let buildPromise = null;

function openD2DB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(D2DB_NAME, D2DB_VERSION);
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

async function loadItemDefs() {
  if (itemDefs) return itemDefs;
  const defsObj = await idbGet("DestinyInventoryItemDefinition", STORE_BLOBS);
  if (!defsObj) {
    throw new Error("Manifest cache missing");
  }
  itemDefs = defsObj;
  return itemDefs;
}

async function loadCollectibleDefs() {
  if (collectibleDefs) return collectibleDefs;
  const defsObj = await idbGet("DestinyCollectibleDefinition", STORE_BLOBS);
  if (!defsObj) return null;
  collectibleDefs = defsObj;
  return collectibleDefs;
}

function isRealWeaponDef(def, bucketHash) {
  if (!def) return false;
  const categories = Array.isArray(def.itemCategoryHashes)
    ? def.itemCategoryHashes
    : Array.isArray(def.itemCategory)
      ? def.itemCategory
      : null;
  if (!categories || !categories.some((h) => h === 1)) return false;
  if (def.displayProperties?.name?.includes("DEPRECATED")) return false;
  const bucket = def.inventory?.bucketTypeHash;
  if (!bucket) return false;
  if (bucketHash && bucket !== bucketHash) return false;
  return true;
}

async function buildNameIndex() {
  if (nameIndex) return nameIndex;
  if (buildPromise) return buildPromise;

  buildPromise = (async () => {
    const defs = await loadItemDefs();
    const idx = [];
    let scanned = 0;
    const yieldEvery = 5000;

    for (const [h, def] of Object.entries(defs)) {
      const name = def?.displayProperties?.name;
      if (!name) continue;
      idx.push({ h, n: name.toLowerCase() });
      scanned++;
      if (scanned % yieldEvery === 0) {
        await new Promise((r) => setTimeout(r, 0));
      }
    }

    nameIndex = idx;
    buildPromise = null;
    return nameIndex;
  })();

  return buildPromise;
}

async function searchWeapons(query, bucketHash) {
  const q = String(query || "").trim().toLowerCase();
  if (q.length < 2) return [];

  const defs = await loadItemDefs();
  const collectibles = await loadCollectibleDefs();
  const idx = await buildNameIndex();

  const hits = [];
  for (const it of idx) {
    if (it.n.includes(q)) hits.push(it.h);
    if (hits.length >= 400) break;
  }

  const results = [];
  for (const h of hits) {
    const def = defs[h];
    if (!isRealWeaponDef(def, bucketHash)) continue;
    const icon = def.displayProperties?.icon ? `${BUNGIE_ROOT}${def.displayProperties.icon}` : "";
    const collectibleHash = def.collectibleHash;
    const sourceString =
      collectibles && collectibleHash
        ? collectibles[String(collectibleHash)]?.sourceString || ""
        : "";
    results.push({
      hash: def.hash,
      name: def.displayProperties?.name || "",
      icon,
      type: def.itemTypeDisplayName || "Weapon",
      rarity: def.inventory?.rarity || "Common",
      damageType: Array.isArray(def.damageTypeHashes) ? def.damageTypeHashes[0] : null,
      sourceString,
    });
    if (results.length >= 100) break;
  }

  return results;
}

self.onmessage = async (event) => {
  const data = event.data || {};
  if (data.type === "warmup") {
    try {
      await buildNameIndex();
      self.postMessage({ type: "warmup-done" });
    } catch (error) {
      self.postMessage({ type: "error", id: data.id, message: error.message || String(error) });
    }
    return;
  }

  if (data.type === "search") {
    try {
      const results = await searchWeapons(data.query, data.bucketHash || null);
      self.postMessage({ type: "results", id: data.id, results });
    } catch (error) {
      self.postMessage({ type: "error", id: data.id, message: error.message || String(error) });
    }
  }
};
