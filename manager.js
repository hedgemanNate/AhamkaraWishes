// --- CONFIGURATION ---
const API_KEY = "fee720e84d6c4239aeb7d442b4d39f38"; // Using your key
const BUNGIE_ROOT = "https://www.bungie.net";


// ===============================
// DIM-style Manifest (local) loader + local item search
// Focus: make armor search work reliably without Bungie "search endpoints".
// Adds heavy debugging logs to troubleshoot download/decompress/parse/storage.
// ===============================

// Bucket hashes (Inventory buckets)
const BUCKET_HASHES = {
  HELMET: 3448274439,
  GAUNTLETS: 3551918588,
  CHEST: 14239492,
  LEGS: 20886954,
  CLASS_ITEM: 1585787867
};

// IndexedDB config
const D2DB_NAME = "d2_manifest_cache";
const D2DB_VERSION = 1;
const STORE_META = "meta";
const STORE_BLOBS = "blobs";

// In-memory manifest state
let _invItemDefs = null;      // Map<stringHash, defObject>
let _nameIndex = null;        // Array<{h:string, n:string}>
let _manifestVersion = null;  // string

function d2log(...args) { console.log("[D2MANIFEST]", ...args); }
function d2warn(...args) { console.warn("[D2MANIFEST]", ...args); }
function d2err(...args) { console.error("[D2MANIFEST]", ...args); }

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

// Fetch Bungie manifest metadata (version + content paths)
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

// Read arrayBuffer -> maybe gunzip -> string
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
  // Not gzip
  return new TextDecoder("utf-8").decode(u8);
}

// Download DestinyInventoryItemDefinition component JSON and cache it.
async function ensureInventoryItemDefsReady({ force = false } = {}) {
  console.groupCollapsed("[D2MANIFEST] ensureInventoryItemDefsReady");
  console.time("[D2MANIFEST] total");

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

    // Prefer component JSON path (smallest practical download)
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

    console.time("[D2MANIFEST] download");
    const r = await fetch(path, { headers: { "Accept": "application/json" } });
    if (!r.ok) {
      const t = await r.text().catch(() => "");
      throw new Error(`Manifest download failed HTTP ${r.status}. Body: ${t.slice(0, 200)}`);
    }
    const buf = await r.arrayBuffer();
    console.timeEnd("[D2MANIFEST] download");
    d2log("Downloaded bytes:", buf.byteLength);

    console.time("[D2MANIFEST] decode/decompress");
    const text = await bytesToTextMaybeGzip(buf, r.headers.get("content-type") || "");
    console.timeEnd("[D2MANIFEST] decode/decompress");
    d2log("Decoded text length:", text.length);

    console.time("[D2MANIFEST] parse JSON");
    const parsed = JSON.parse(text);
    console.timeEnd("[D2MANIFEST] parse JSON");

    // If we downloaded world content (all defs), extract the item defs table.
    const itemDefs = comp ? parsed : parsed?.DestinyInventoryItemDefinition;
    if (!itemDefs) {
      const keys = Object.keys(parsed || {});
      d2warn("Parsed manifest keys (sample):", keys.slice(0, 30));
      throw new Error("Downloaded JSON did not contain DestinyInventoryItemDefinition data.");
    }

    // Store as a compressed-ish blob (string) in IndexedDB.
    console.time("[D2MANIFEST] cache to IndexedDB");
    await idbSet("DestinyInventoryItemDefinition", itemDefs, STORE_BLOBS);
    await idbSet("manifestVersion", liveVersion, STORE_META);
    console.timeEnd("[D2MANIFEST] cache to IndexedDB");

    // Reset in-memory indices so they rebuild from the new data.
    _invItemDefs = null;
    _nameIndex = null;

    d2log("Manifest cache updated successfully.");
    return true;
  } catch (e) {
    d2err("ensureInventoryItemDefsReady FAILED:", e);
    return false;
  } finally {
    console.timeEnd("[D2MANIFEST] total");
    console.groupEnd();
  }
}

async function loadInventoryItemDefsToMemory() {
  if (_invItemDefs) return _invItemDefs;

  console.groupCollapsed("[D2MANIFEST] loadInventoryItemDefsToMemory");
  console.time("[D2MANIFEST] load defs");
  const blob = await idbGet("DestinyInventoryItemDefinition", STORE_BLOBS);
  if (!blob) {
    d2warn("No cached item defs found. Attempting download...");
    const ok = await ensureInventoryItemDefsReady({ force: false });
    if (!ok) throw new Error("Unable to download/cache manifest; see logs above.");
  }
  const defsObj = await idbGet("DestinyInventoryItemDefinition", STORE_BLOBS);
  if (!defsObj) throw new Error("Item defs still missing after ensureInventoryItemDefsReady.");

  // defsObj is an object: { "<hash>": { ...def... }, ... }
  const map = new Map();
  let count = 0;
  for (const [hashStr, def] of Object.entries(defsObj)) {
    map.set(String(hashStr), def);
    count++;
  }
  _invItemDefs = map;
  console.timeEnd("[D2MANIFEST] load defs");
  d2log("Loaded defs into memory:", count);
  console.groupEnd();
  return _invItemDefs;
}

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
  console.time("[D2MANIFEST] build index");

  const defs = await loadInventoryItemDefsToMemory();
  const idx = [];
  let scanned = 0;

  for (const [h, def] of defs.entries()) {
    const name = def?.displayProperties?.name;
    if (!name) continue;
    idx.push({ h, n: name.toLowerCase() });
    scanned++;
    // Light throttling so we don't freeze UI completely on weaker machines
    if (scanned % 50000 === 0) {
      // eslint-disable-next-line no-await-in-loop
      await new Promise(r => setTimeout(r, 0));
    }
  }

  _nameIndex = idx;
  console.timeEnd("[D2MANIFEST] build index");
  d2log("Name index size:", idx.length);
  console.groupEnd();
  return _nameIndex;
}

// Local search: returns up to 5 armor pieces (one per slot) for currentClass.
async function searchArmorLocally(query, currentClassType) {
  const q = String(query || "").trim().toLowerCase();
  if (q.length < 2) return [];

  console.groupCollapsed("[D2MANIFEST] searchArmorLocally:", q);
  console.time("[D2MANIFEST] search total");

  // Ensure manifest exists
  const ok = await ensureInventoryItemDefsReady({ force: false });
  if (!ok) throw new Error("Manifest not available; see manifest logs.");

  const defs = await loadInventoryItemDefsToMemory();
  const idx = await buildNameIndexIfNeeded();

  // Find candidate hashes by name contains
  console.time("[D2MANIFEST] scan index");
  const hits = [];
  for (const it of idx) {
    if (it.n.includes(q)) hits.push(it.h);
    if (hits.length >= 400) break; // cap for speed; we refine below
  }
  console.timeEnd("[D2MANIFEST] scan index");
  d2log("Name hits:", hits.length);

  // Pull defs + filter to armor + class
  console.time("[D2MANIFEST] filter defs");
  const candidates = [];
  for (const h of hits) {
    const def = defs.get(String(h));
    if (!isRealArmorDef(def)) continue;
    if (def.classType !== currentClassType && def.classType !== 3) continue;
    candidates.push(def);
    if (candidates.length >= 200) break;
  }
  console.timeEnd("[D2MANIFEST] filter defs");
  d2log("Armor candidates:", candidates.length);

  // Slot grouping by bucket hash
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
    bucketHash: item.inventory?.bucketTypeHash
  }));

  console.timeEnd("[D2MANIFEST] search total");
  console.groupEnd();
  return out;
}


const ARCHETYPES = [
    { id: 'paragon', name: 'PARAGON', stats: ['Super', 'Melee'] },
    { id: 'brawler', name: 'BRAWLER', stats: ['Melee', 'Health'] },
    { id: 'gunner',  name: 'GUNNER',  stats: ['Grenade', 'Class'] }, 
    { id: 'special', name: 'SPECIALIST', stats: ['Class', 'Grenade'] },
    { id: 'grenadr', name: 'GRENADIER', stats: ['Grenade', 'Super'] },
    { id: 'bulwark', name: 'BULWARK',   stats: ['Health', 'Class'] } 
];

const STATS = ['Mobility', 'Health', 'Class', 'Grenade', 'Super', 'Melee'];


// --- INITIALIZATION ---
document.addEventListener('DOMContentLoaded', () => {
    setupTabs();
    loadLists();

    // Manifest preflight (DIM-style): download/cache item defs if needed.
    // This is intentionally noisy to make troubleshooting easy.
    ensureInventoryItemDefsReady({ force: false }).then(ok => {
        if (!ok) console.warn("[D2MANIFEST] Preflight failed; searches will fail until fixed.");
    });
});

// --- LIVE UPDATE LISTENER ---
// Triggers whenever data changes (e.g. from Content Script or internal save)
chrome.storage.onChanged.addListener((changes, namespace) => {
    if (namespace === 'local' && changes.dimData) {
        loadLists();
    }
});

// Sidepanel version of saveItem (content.js has its own copy; it is NOT available here)
// Sidepanel version of saveItem (content.js has its own copy; it is NOT available here)
function saveItem(hash, name, type, rawString, keyId, config, mode = "pve", icon = null) {
  chrome.storage.local.get(["dimData"], (result) => {
    let data = result.dimData || {
      activeId: "default",
      lists: { default: { name: "Main Wishlist", items: {} } }
    };

    const activeList = data.lists[data.activeId] || data.lists["default"];
    if (!activeList.items) activeList.items = {};

    // Create container if missing
    if (!activeList.items[hash]) {
      activeList.items[hash] = {
        static: { name, type, set: null, icon: icon || null },
        wishes: []
      };
    } else {
      // Backfill metadata if missing
      if (name && !activeList.items[hash].static?.name) activeList.items[hash].static.name = name;
      if (type && !activeList.items[hash].static?.type) activeList.items[hash].static.type = type;

      // Backfill icon if we now have one
      if (icon && (!activeList.items[hash].static || !activeList.items[hash].static.icon)) {
        activeList.items[hash].static.icon = icon;
      }
    }

    const existingWishes = activeList.items[hash].wishes || [];
    activeList.items[hash].wishes = existingWishes;

    // Duplicate check (same raw + same mode tag)
    const isDuplicate = existingWishes.some(
      (w) => w?.raw === rawString && (w?.tags || []).includes(mode)
    );
    if (isDuplicate) return;

    // Add new wish
    existingWishes.push({
      tags: [mode],          // ['pve'] or ['pvp']
      config,               // your armor/weapon config
      raw: rawString,       // original string
      added: Date.now()
    });

    chrome.storage.local.set({ dimData: data }, () => {
      loadLists(); // refresh UI
    });
  });
}

function setupTabs() {
    const btnWeapons = document.getElementById('tab-weapons');
    const btnArmor = document.getElementById('tab-armor');
    const viewWeapons = document.getElementById('view-weapons');
    const viewArmor = document.getElementById('view-armor');

    btnWeapons.addEventListener('click', () => {
        btnWeapons.classList.add('active');
        btnArmor.classList.remove('active');
        viewWeapons.classList.add('active-view');
        viewArmor.classList.remove('active-view');
        loadLists();
    });

    btnArmor.addEventListener('click', () => {
        btnArmor.classList.add('active');
        btnWeapons.classList.remove('active');
        viewArmor.classList.add('active-view');
        viewWeapons.classList.remove('active-view');
    });
}

// --- VIEWER LOGIC ---
function loadLists() {
    chrome.storage.local.get(['dimData'], (result) => {
        const container = document.getElementById('weapon-list');
        const emptyState = document.getElementById('empty-state');
        container.innerHTML = ''; 

        if (!result.dimData || !result.dimData.lists) {
            if(emptyState) emptyState.classList.remove('hidden');
            return;
        } else {
            if(emptyState) emptyState.classList.add('hidden');
        }

        const activeList = result.dimData.lists['default'];
        if (!activeList || !activeList.items || Object.keys(activeList.items).length === 0) {
            if(emptyState) emptyState.classList.remove('hidden');
            return;
        }

        Object.keys(activeList.items).forEach(hash => {
            const item = activeList.items[hash];
            const card = createItemCard(hash, item);
            container.appendChild(card);
        });
    });
}

function createItemCard(hash, item) {
  const card = document.createElement('div');
  card.className = 'weapon-card';

  const safeName = item?.static?.name || '(unknown)';
  const safeType = (item?.static?.type || 'item').toString();

  // Normalize icon:
  // - if icon is already absolute (starts with http), use as-is
  // - if it's a relative Bungie path, prefix with BUNGIE_ROOT
  const iconValue = item?.static?.icon;
  const iconUrl =
    iconValue
      ? (iconValue.startsWith('http') ? iconValue : `${BUNGIE_ROOT}${iconValue}`)
      : '';

  const iconHtml = iconUrl
    ? `<img src="${iconUrl}" class="card-icon" alt="">`
    : '';

  let wishesHtml = '';
  const wishes = Array.isArray(item?.wishes) ? item.wishes : [];

  wishes.forEach((wish, index) => {
    const tag = (wish?.tags && wish.tags[0]) ? wish.tags[0] : 'pve';
    const badgeClass = tag === 'pvp' ? 'badge-pvp' : 'badge-pve';

    let detailText = `Roll #${index + 1}`;
    if (safeType === 'armor' && wish?.config) {
      const arch = wish.config.archetype || '';
      const spark = wish.config.spark || '';
      detailText = `${arch} + ${spark}`;
    }

    wishesHtml += `
      <div class="roll-row">
        <div>
          <span class="badge ${badgeClass}">${tag}</span>
          <span>${detailText}</span>
        </div>
        <button class="btn-del" data-hash="${hash}" data-idx="${index}" type="button">🗑️</button>
      </div>
    `;
  });

  card.innerHTML = `
    <div class="card-header">
      <div style="display:flex; align-items:center;">
        ${iconHtml}
        <span class="card-title">${safeName}</span>
      </div>
      <span class="card-id">${safeType.toUpperCase()}</span>
    </div>
    <div class="card-body">
      ${wishesHtml}
    </div>
  `;

  // IMPORTANT: use currentTarget so dataset is always correct
  card.querySelectorAll('.btn-del').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const idx = Number(e.currentTarget.dataset.idx);
      deleteWish(hash, idx);
    });
  });

  return card;
}

function deleteWish(hash, index) {
    chrome.storage.local.get(['dimData'], (result) => {
        let data = result.dimData;
        let wishes = data.lists['default'].items[hash].wishes;
        wishes.splice(index, 1);
        if (wishes.length === 0) delete data.lists['default'].items[hash];
        chrome.storage.local.set({ dimData: data }, loadLists);
    });
}

