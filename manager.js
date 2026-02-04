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

// --- STATE ---
let currentClass = 0; // 0=Titan, 1=Hunter, 2=Warlock
let searchTimeout = null; // For debounce
let armorSelection = null; // { hash, name, icon }

let currentArchetype = null;
let currentSpark = null;
let currentMode = 'pve';

// --- INITIALIZATION ---
document.addEventListener('DOMContentLoaded', () => {
    setupTabs();
    setupArmorUI();
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

    let wishesHtml = '';
    
    // Header Info (Uses Icon if available)
    const iconHtml = item.static.icon ? 
        `<img src="${BUNGIE_ROOT}${item.static.icon}" style="width:24px; height:24px; margin-right:8px; vertical-align:middle; border-radius:2px;">` : '';

    if (item.wishes && item.wishes.length > 0) {
        item.wishes.forEach((wish, index) => {
            const tag = wish.tags[0] || 'pve';
            const badgeClass = tag === 'pvp' ? 'badge-pvp' : 'badge-pve';
            
            let detailText = `Roll #${index + 1}`;
            if (item.static.type === 'armor' && wish.config) {
                detailText = `${wish.config.archetype} + ${wish.config.spark}`;
            }

            wishesHtml += `
                <div class="roll-row">
                    <div>
                        <span class="badge ${badgeClass}">${tag}</span>
                        <span>${detailText}</span>
                    </div>
                    <button class="btn-del" data-hash="${hash}" data-idx="${index}">🗑️</button>
                </div>
            `;
        });
    }

    card.innerHTML = `
        <div class="card-header">
            <div style="display:flex; align-items:center;">
                ${iconHtml}
                <span class="card-title">${item.static.name}</span>
            </div>
            <span class="card-id">${item.static.type.toUpperCase()}</span>
        </div>
        <div class="card-body">
            ${wishesHtml}
        </div>
    `;

    card.querySelectorAll('.btn-del').forEach(btn => {
        btn.addEventListener('click', (e) => {
            deleteWish(hash, e.target.dataset.idx);
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

// =========================================================
// --- ARMOR CREATOR 2.0 LOGIC ---
// =========================================================

function setupArmorUI() {
    const creatorContainer = document.querySelector('.armor-creator');

    if (!creatorContainer) {
        console.warn('[UI] .armor-creator not found; skipping setupArmorUI()');
        return;
    }
    
    // Clear existing to rebuild safely
    creatorContainer.innerHTML = '';

    // 1. CLASS SELECTOR (Top)
    const classSelector = document.createElement('div');
    classSelector.className = 'class-selector';
    classSelector.innerHTML = `
        <button class="class-btn active" data-class="0">TITAN</button>
        <button class="class-btn" data-class="2">WARLOCK</button>
        <button class="class-btn" data-class="1">HUNTER</button>
    `;
    
    classSelector.querySelectorAll('button').forEach(btn => {
        btn.addEventListener('click', (e) => {
            document.querySelectorAll('.class-btn').forEach(b => b.classList.remove('active'));
            e.target.classList.add('active');
            currentClass = parseInt(e.target.dataset.class);
            // Trigger search again if text exists
            const input = document.querySelector('.search-input');
            if(input && input.value.length > 2) performArmorSearch(input.value);
        });
    });
    creatorContainer.appendChild(classSelector);

    // 2. SEARCH & GRID (Step 1)
    const searchArea = document.createElement('div');
    searchArea.className = 'armor-search-container';
    searchArea.innerHTML = `
        <div class="step-label">1. SEARCH ARMOR (Set Name)</div>
        <input type="text" class="search-input" placeholder="e.g. Iron, Artifice, Darkhollow...">
        <div class="armor-grid" id="armor-grid">
            <div class="armor-box" data-slot="Head"></div>
            <div class="armor-box" data-slot="Arms"></div>
            <div class="armor-box" data-slot="Chest"></div>
            <div class="armor-box" data-slot="Legs"></div>
            <div class="armor-box" data-slot="Class"></div>
        </div>
    `;
    creatorContainer.appendChild(searchArea);

    // Search Input Logic (Debounce)
    const input = searchArea.querySelector('.search-input');
    input.addEventListener('input', (e) => {
        clearTimeout(searchTimeout);
        const query = e.target.value;
        if (query.length < 3) return; // Too short
        
        // Show Loading State
        document.querySelectorAll('.armor-box').forEach(b => b.classList.add('loading'));
        
        searchTimeout = setTimeout(() => {
            performArmorSearch(query);
        }, 1000); // 1 Second Delay
    });

    // 3. ARCHETYPE GRID (Step 2)
    const step2 = document.createElement('div');
    step2.innerHTML = `<div class="step-label">2. CHOOSE ARCHETYPE</div><div class="grid-2col" id="archetype-grid"></div>`;
    creatorContainer.appendChild(step2);

    // 4. SPARK GRID (Step 3)
    const step3 = document.createElement('div');
    step3.innerHTML = `<div class="step-label">3. CHOOSE SPARK (3rd Stat)</div><div class="grid-3col" id="spark-grid"></div>`;
    creatorContainer.appendChild(step3);

    // 5. ACTION AREA (Toggle + Button)
    const actionArea = document.createElement('div');
    actionArea.className = 'action-area';
    
    // Inject Toggle
    const toggleDiv = document.createElement('div');
    toggleDiv.className = 'toggle-container pve';
    toggleDiv.style.marginBottom = '10px';
    toggleDiv.innerHTML = `
        <div class="opt-pve" style="flex:1; text-align:center; padding:10px; background:#1e3a8a; color:white;">PvE</div>
        <div class="opt-pvp" style="flex:1; text-align:center; padding:10px; background:transparent; color:#555;">PvP</div>
    `;
    toggleDiv.onclick = () => {
        if(currentMode === 'pve') {
            currentMode = 'pvp';
            toggleDiv.className = 'toggle-container pvp';
            toggleDiv.querySelector('.opt-pve').style.cssText = "flex:1; text-align:center; padding:10px; background:transparent; color:#555;";
            toggleDiv.querySelector('.opt-pvp').style.cssText = "flex:1; text-align:center; padding:10px; background:#991b1b; color:white;";
        } else {
            currentMode = 'pve';
            toggleDiv.className = 'toggle-container pve';
            toggleDiv.querySelector('.opt-pve').style.cssText = "flex:1; text-align:center; padding:10px; background:#1e3a8a; color:white;";
            toggleDiv.querySelector('.opt-pvp').style.cssText = "flex:1; text-align:center; padding:10px; background:transparent; color:#555;";
        }
    };
    actionArea.appendChild(toggleDiv);

    const mainBtn = document.createElement('button');
    mainBtn.id = 'btn-create-armor';
    mainBtn.className = 'btn-primary';
    mainBtn.disabled = true;
    mainBtn.textContent = 'SELECT ARMOR PIECE FIRST';
    mainBtn.onclick = saveArmorWish;
    actionArea.appendChild(mainBtn);

    creatorContainer.appendChild(actionArea);

    // POPULATE GRIDS
    populateStats();
}

// --- SEARCH & BUCKET LOGIC ---
async function performArmorSearch(query) {
    try {
        const items = await searchArmorLocally(query, currentClass);

        // Convert list -> legacy buckets structure expected by updateArmorGrid
        const buckets = { Head: null, Arms: null, Chest: null, Legs: null, Class: null };

        for (const it of items) {
            if (!it) continue;
            if (it.bucketHash === BUCKET_HASHES.HELMET) buckets.Head = it;
            else if (it.bucketHash === BUCKET_HASHES.GAUNTLETS) buckets.Arms = it;
            else if (it.bucketHash === BUCKET_HASHES.CHEST) buckets.Chest = it;
            else if (it.bucketHash === BUCKET_HASHES.LEGS) buckets.Legs = it;
            else if (it.bucketHash === BUCKET_HASHES.CLASS_ITEM) buckets.Class = it;
        }

        updateArmorGrid(buckets);
    } catch (e) {
        console.error("Armor search failed (local manifest).", e);
    }
}

function updateArmorGrid(buckets) {
    const grid = document.getElementById('armor-grid');
    const slotMap = ['Head', 'Arms', 'Chest', 'Legs', 'Class'];
    
    // Clear Loading & Old Images
    document.querySelectorAll('.armor-box').forEach(b => {
        b.classList.remove('loading');
        b.innerHTML = ''; 
        b.classList.remove('selected');
    });

    slotMap.forEach(slot => {
        const item = buckets[slot];
        const box = grid.querySelector(`[data-slot="${slot}"]`);
        
        if (item) {
            // Append Image
            const img = document.createElement('img');
            img.src = BUNGIE_ROOT + item.displayProperties.icon;
            box.appendChild(img);
            
            // Click Event
            box.onclick = () => selectArmorPiece(item, box);
        }
    });
}

function selectArmorPiece(item, boxElement) {
    // 1. Highlight
    document.querySelectorAll('.armor-box').forEach(b => b.classList.remove('selected'));
    boxElement.classList.add('selected');
    
    // 2. Store Data
    armorSelection = {
        hash: item.hash,
        name: item.displayProperties.name,
        icon: item.displayProperties.icon,
        class: (currentClass === 0 ? 'Titan' : currentClass === 1 ? 'Hunter' : 'Warlock')
    };

    checkButtonState();
}

function populateStats() {
    const archGrid = document.getElementById('archetype-grid');
    const sparkGrid = document.getElementById('spark-grid');

    ARCHETYPES.forEach(arch => {
        const btn = document.createElement('div');
        btn.className = 'stat-btn';
        btn.innerHTML = `<strong>${arch.name}</strong><span class="stat-sub">${arch.stats.join(' + ')}</span>`;
        btn.onclick = () => selectArchetype(arch, btn);
        archGrid.appendChild(btn);
    });

    STATS.forEach(stat => {
        const btn = document.createElement('div');
        btn.className = 'stat-btn';
        btn.innerHTML = `<strong>${stat.substring(0,3)}</strong>`; 
        btn.dataset.stat = stat; 
        btn.onclick = () => selectSpark(stat, btn);
        sparkGrid.appendChild(btn);
    });
}

// --- SELECTION HELPERS ---
function selectArchetype(arch, btnElement) {
    currentArchetype = arch;
    document.querySelectorAll('#archetype-grid .stat-btn').forEach(b => b.classList.remove('selected'));
    btnElement.classList.add('selected');
    updateSparkAvailability();
    checkButtonState();
}

function selectSpark(stat, btnElement) {
    if (btnElement.disabled || btnElement.classList.contains('unavailable')) return;
    currentSpark = stat;
    document.querySelectorAll('#spark-grid .stat-btn').forEach(b => b.classList.remove('selected'));
    btnElement.classList.add('selected');
    checkButtonState();
}

function updateSparkAvailability() {
    if (!currentArchetype) return;

    document.querySelectorAll('#spark-grid .stat-btn').forEach(btn => {
        const statName = btn.dataset.stat;
        if (currentArchetype.stats.includes(statName)) {
            btn.classList.add('unavailable');
            btn.classList.remove('selected');
            if (currentSpark === statName) currentSpark = null;
        } else {
            btn.classList.remove('unavailable');
        }
    });
}

function checkButtonState() {
    const btn = document.getElementById('btn-create-armor');
    
    if (!armorSelection) {
        btn.disabled = true;
        btn.textContent = "SELECT ARMOR PIECE FIRST";
        return;
    }
    
    if (currentArchetype && currentSpark) {
        btn.disabled = false;
        btn.textContent = `ADD: ${currentArchetype.name} + ${currentSpark.toUpperCase()}`;
    } else {
        btn.disabled = true;
        btn.textContent = "SELECT STATS ABOVE";
    }
}

function saveArmorWish() {
    if (!armorSelection || !currentArchetype || !currentSpark) return;

    const hash = armorSelection.hash; // Use actual hash now!

    chrome.storage.local.get(['dimData'], (result) => {
        let data = result.dimData || { activeId: 'default', lists: { 'default': { name: 'Main Wishlist', items: {} } } };
        const activeList = data.lists[data.activeId];

        if (!activeList.items) activeList.items = {};

        // Create Item Entry (Grouped by Hash)
        if (!activeList.items[hash]) {
            activeList.items[hash] = {
                static: { 
                    name: armorSelection.name, 
                    type: "armor", 
                    icon: armorSelection.icon, // Save the icon path
                    class: armorSelection.class,
                    set: null 
                },
                wishes: []
            };
        }

        // Add Wish
        activeList.items[hash].wishes.push({
            tags: [currentMode],
            config: { archetype: currentArchetype.name, spark: currentSpark },
            raw: `name:"${armorSelection.name}"`, 
            added: Date.now()
        });

        chrome.storage.local.set({ dimData: data }, () => {
            const btn = document.getElementById('btn-create-armor');
            btn.textContent = "SAVED!";
            btn.style.borderColor = "#4ade80"; 
            
            setTimeout(() => {
                // RESET Everything
                btn.textContent = "SELECT ARMOR PIECE FIRST";
                btn.style.borderColor = ""; 
                btn.disabled = true;
                
                currentArchetype = null;
                currentSpark = null;
                armorSelection = null;

                document.querySelectorAll('.stat-btn').forEach(b => {
                    b.classList.remove('selected');
                    b.classList.remove('unavailable');
                });
                
                // Clear Armor Grid Selections
                document.querySelectorAll('.armor-box').forEach(b => b.classList.remove('selected'));

                // Clear Search? Optional. Let's keep the text but clear selection.
                
                loadLists(); 
            }, 1000);
        });
    });
}