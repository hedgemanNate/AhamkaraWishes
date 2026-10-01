// Native weapon crafting UI: search -> select weapon -> select perks -> live stats -> save wish.
// Uses destiny-manifest.js (searchWeaponsLocally, getWeaponPerkColumns, getWeaponDisplayStats,
// interpolateStatValue, WEAPON_STAT_HASHES, loadInventoryItemDefsToMemory, BUNGIE_ROOT) and
// oracle-engine-bridge.js (window.oracleEngineReady) for derived numbers (falloff/reload/TTK),
// and manager.js (saveItem) to persist the wish.

let currentCraftWeapon = null;   // { hash, name, icon, def, columns, displayStats, plugByHash, statNames }
let currentCraftMode = 'pve';
// perkState[colIndex] = { acceptable: Set<hash>, colors: Map<colorName, baseHash> }
// acceptable includes both base and enhanced hashes for each selected perk.
// colors maps a combo colour to the ONE perk wearing it in this column — a
// column can never hold two reds, so the map itself enforces that rule.
let perkState = [];
let activePerkTab = 0;
// Which combo the live stats panel is previewing: a colour name, or null for
// "no combo selected" (panel shows the weapon's base stats).
let activeComboColor = null;
// Set only when the current craft session was loaded from an existing saved
// roll via double-click (loadWishIntoWeaponCraft). Drives whether EDIT WISH
// is shown, and which wish it overwrites.
let currentEditContext = null; // { hash, index }

// The four combos a single wish can express. A colour appearing in two or more
// columns is a combo — a concrete perk tuple that an owned roll must satisfy in
// full. Order here is the click-cycle order. Owned by owned-inventory-index.js,
// which loads first and does the matching against these.
const COMBO_COLORS = window.OwnedInventoryIndex.COMBO_COLORS;

// Four combo slots plus room for a couple of uncoloured "any of these" picks.
const WEAPON_ACCEPTABLE_CAP = WeaponWish.ACCEPTABLE_CAP;
const PERK_STAT_BAR_MAX = 40;      // delta bar in the hover panel maxes at +/-40
const STAT_ANIM_MS = 600;


let _weaponSearchDebounce = null;
// Bumped by every weapon pick and by clearWeaponCraft(). selectWeaponForCraft is
// async (manifest + oracle loads), so a load that was superseded — or cleared by
// emptying the search box while it was still running — must not re-open the
// craft view when it finally resolves.
let _craftSession = 0;

function initWeaponCraft() {
    const input = document.getElementById('weapon-query');
    const clearBtn = document.getElementById('weapon-query-clear');
    if (input) {
        input.addEventListener('input', (e) => {
            if (clearBtn) clearBtn.classList.toggle('hidden', !e.target.value);
            clearTimeout(_weaponSearchDebounce);
            const q = e.target.value;
            // An empty box means "no weapon": drop whatever is being crafted too.
            if (!q.trim()) { clearWeaponCraft(); return; }
            _weaponSearchDebounce = setTimeout(() => runWeaponSearch(q), 250);
        });
    }
    if (clearBtn) {
        clearBtn.addEventListener('click', () => {
            clearTimeout(_weaponSearchDebounce);
            if (input) input.value = '';
            clearBtn.classList.add('hidden');
            clearWeaponCraft();
            if (input) input.focus();
        });
    }

    const modeToggle = document.getElementById('weapon-mode-toggle');
    if (modeToggle) {
        modeToggle.onclick = () => {
            currentCraftMode = (currentCraftMode === 'pve') ? 'pvp' : 'pve';
            modeToggle.className = `toggle-container ${currentCraftMode}`;
            if (currentCraftWeapon) refreshStats();
        };
    }

    const saveBtn = document.getElementById('weapon-save-new-btn');
    if (saveBtn) {
        saveBtn.onclick = saveWeaponWish;
    }

    const editBtn = document.getElementById('weapon-edit-wish-btn');
    if (editBtn) {
        editBtn.onclick = editWeaponWish;
    }

    // The Integrated Websites links still open their site in a new tab as usual;
    // the panel also jumps to Weapons > List, so the wishlist is in view beside
    // the site while rolls get added from it.
    // Registered after initGodrollLink so a click it intercepts (to show the
    // access explainer instead of opening the site) is skipped here; the
    // explainer switches to the list itself once the site really opens.
    initGodrollLink();
    document.querySelectorAll('.craft-link-btn').forEach((link) => {
        link.addEventListener('click', (e) => {
            if (e.defaultPrevented) return;
            showWeaponList();
        });
    });
}

function showWeaponList() {
    document.getElementById('weapons-nav-list')?.click();
}

// godroll.tv access is optional (godroll-access.js). Chrome's permission prompt
// can't be reworded, so the first click on the Godroll.tv link (without access)
// opens our own explainer instead of the site. "Allow access" then shows
// Chrome's prompt (that click is the user gesture it requires) and opens the
// site; "Just open Godroll.tv" opens it without the integration. Once access is
// held the link behaves normally. Whether access is held is cached because
// chrome.permissions.request() must run synchronously inside the click.
function initGodrollLink() {
    const link = document.querySelector('.craft-link-btn[aria-label*="Godroll"]');
    const overlay = document.getElementById('godroll-access-modal-overlay');
    if (!link || !overlay || !window.GodrollAccess || !chrome.permissions) return;

    let granted = false;
    const refresh = () => GodrollAccess.has().then((v) => { granted = v; }, () => {});
    refresh();
    chrome.permissions.onAdded.addListener(refresh);
    chrome.permissions.onRemoved.addListener(refresh);

    const close = () => overlay.classList.add('hidden');
    const openSite = () => { chrome.tabs.create({ url: link.href }); showWeaponList(); };

    link.addEventListener('click', (e) => {
        if (granted) return; // normal link behaviour
        e.preventDefault();
        overlay.classList.remove('hidden');
        document.getElementById('godroll-access-allow')?.focus();
    });

    document.getElementById('godroll-access-allow')?.addEventListener('click', () => {
        close();
        GodrollAccess.request()
            .then((ok) => ok
                ? chrome.runtime.sendMessage({ type: 'ahamkara:sync-godroll-access' }).then(() => ok)
                : ok)
            .catch(() => false)
            .then((ok) => {
                openSite();
                if (!ok) {
                    window.awWishlistIO?.showToast('Opened Godroll.tv without the Ahamkara Wish button. You can allow access next time.');
                }
            });
    });
    document.getElementById('godroll-access-skip')?.addEventListener('click', () => { close(); openSite(); });

    // Backdrop click or Escape dismisses without opening anything.
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && !overlay.classList.contains('hidden')) close();
    });
}

// Resets the craft view to its blank starting state: no weapon, no perk picks,
// no edit in progress. Called when the weapon search box is emptied (typed empty
// or via the clear button). PvE/PvP is a preference, not part of the weapon, so
// it is left alone.
function clearWeaponCraft() {
    clearTimeout(_weaponSearchDebounce);
    _craftSession++;

    currentCraftWeapon = null;
    perkState = [];
    activePerkTab = 0;
    activeComboColor = null;
    currentEditContext = null;
    updateEditButtonVisibility();

    const resultsEl = document.getElementById('weapon-search-results');
    if (resultsEl) resultsEl.innerHTML = '';
    document.getElementById('weapon-craft-main')?.classList.add('hidden');
    document.getElementById('weapon-save-section')?.classList.add('hidden');
    document.getElementById('pp-combo-toggle')?.classList.add('hidden');
    document.getElementById('weapon-perk-detail')?.classList.add('hidden');
    // Emptied too, so a stale weapon can never flash when the next one loads.
    for (const id of ['weapon-live-stats', 'weapon-season-tabs', 'pp-tabs', 'pp-grid']) {
        const el = document.getElementById(id);
        if (el) el.innerHTML = '';
    }
}

function updateEditButtonVisibility() {
    const editBtn = document.getElementById('weapon-edit-wish-btn');
    if (editBtn) editBtn.classList.toggle('hidden', !currentEditContext);
}

async function runWeaponSearch(query) {
    const resultsEl = document.getElementById('weapon-search-results');
    if (!resultsEl) return;
    resultsEl.innerHTML = '';

    const q = String(query || '').trim();
    if (q.length < 2) return;

    let results;
    try {
        results = await searchWeaponsLocally(q);
    } catch (e) {
        console.error('[WEAPON-CRAFT] search failed', e);
        return;
    }

    // Cross-reference against the OwnedIndex so duplicate-name reissue variants
    // (same weapon name, different itemHash per season) are disambiguated —
    // picking the wrong variant silently breaks wishlist/inventory matching.
    const ownedIdx = window.OwnedInventoryIndex && window.OwnedInventoryIndex.getCachedIndex && window.OwnedInventoryIndex.getCachedIndex();

    results.forEach((w) => {
        const ownedCount = ownedIdx?.byItemHash?.get(w.hash)?.size || 0;

        const row = document.createElement('div');
        row.className = 'weapon-search-result-item';
        row.innerHTML = `
            <span class="weapon-result-icon-wrap">
                ${w.icon ? `<img src="${w.icon}" alt="">` : ''}
                ${w.watermarkIcon ? `<img class="weapon-result-watermark" src="${w.watermarkIcon}" alt="">` : ''}
            </span>
            <span class="weapon-result-text">
                <span class="name">${w.name}</span>
                <span class="weapon-result-subtitle">${[w.itemTypeDisplayName, w.seasonLabel].filter(Boolean).join(' – ')}</span>
            </span>
            <span class="weapon-result-badges">
                ${w.originTraitCount > 0 ? `<span class="weapon-result-origin-badge" title="${w.originTraitCount} origin trait${w.originTraitCount !== 1 ? 's' : ''}">${w.originTraitCount} Origin</span>` : ''}
                ${ownedCount > 0 ? `<span class="weapon-result-owned-badge" title="You own ${ownedCount} of this exact variant">OWNED x${ownedCount}</span>` : ''}
            </span>
        `;
        row.onclick = () => selectWeaponForCraft(w.hash, w.name, w.linkedHashes);
        resultsEl.appendChild(row);
    });
}

async function selectWeaponForCraft(hash, name, linkedHashes) {
    // A fresh weapon pick (search result click) always starts a new wish,
    // never an edit — loadWishIntoWeaponCraft sets currentEditContext itself
    // after this function returns.
    currentEditContext = null;
    updateEditButtonVisibility();
    const session = ++_craftSession;

    const input = document.getElementById('weapon-query');
    if (input && name) input.value = name;
    const clearBtn = document.getElementById('weapon-query-clear');
    if (clearBtn) clearBtn.classList.toggle('hidden', !(input && input.value));
    const resultsEl = document.getElementById('weapon-search-results');
    if (resultsEl) resultsEl.innerHTML = '';

    const defs = await loadInventoryItemDefsToMemory();
    if (session !== _craftSession) return;
    const def = defs.get(String(hash));
    if (!def) {
        console.error('[WEAPON-CRAFT] no def found for hash', hash);
        return;
    }

    const [columns, displayStats] = await Promise.all([
        getWeaponPerkColumns(def),
        getWeaponDisplayStats(def)
    ]);
    if (session !== _craftSession) return;

    // Flat lookup of every plug (base + enhanced) for stat math and hover details
    const plugByHash = new Map();
    columns.forEach((col) => {
        col.pairs.forEach(({ base, enhanced }) => {
            plugByHash.set(base.hash, base);
            if (enhanced) plugByHash.set(enhanced.hash, enhanced);
        });
    });

    const statNames = new Map(displayStats.map((r) => [r.statHash, r.name]));

    const screenshotPath = def.displayProperties?.screenshot || def.screenshot;
    const screenshotUrl = screenshotPath
        ? (screenshotPath.startsWith('http') ? screenshotPath : `${BUNGIE_ROOT}${screenshotPath}`)
        : '';

    currentCraftWeapon = {
        hash: def.hash,
        name: def.displayProperties?.name || '',
        icon: def.displayProperties?.icon ? `${BUNGIE_ROOT}${def.displayProperties.icon}` : '',
        screenshot: screenshotUrl,
        def,
        columns,
        displayStats,
        plugByHash,
        statNames,
        // Sibling itemHashes sharing this exact name (duplicate manifest defs —
        // usually only one variant actually drops). Auto-linked at save time so
        // inventory matching checks owned items under any of these hashes too.
        linkedHashes: Array.isArray(linkedHashes) ? linkedHashes : []
    };

    activePerkTab = 0;
    activeComboColor = null;
    perkState = columns.map(() => ({ acceptable: new Set(), colors: new Map() }));

    buildStatsPanel();
    renderPerkPicker();

    const D2Calc = await window.oracleEngineReady;
    if (session !== _craftSession) return;
    initOracleWeapon(D2Calc, def);

    document.getElementById('weapon-craft-main')?.classList.remove('hidden');
    document.getElementById('weapon-save-section')?.classList.remove('hidden');

    await refreshStats();
}

// Called on double-click of a saved roll in the weapon list (manager.js createWeaponCard).
// Loads that weapon + that exact roll's perks into the craft page and switches
// the EDIT WISH button on, so the user can tweak and overwrite that specific wish
// instead of only ever appending new ones.
async function loadWishIntoWeaponCraft(hash, index, item, wish) {
    document.getElementById('weapons-nav-craft')?.click();

    const linkedHashes = item?.static?.linkedHashes || [];
    await selectWeaponForCraft(hash, item?.static?.name || '', linkedHashes);
    if (!currentCraftWeapon || String(currentCraftWeapon.hash) !== String(hash)) return;

    const perkColumnsData = wish?.config?.perkColumnsData || [];

    perkColumnsData.forEach((entry) => {
        const state = perkState[entry.colIndex];
        if (!state) return;
        state.acceptable = new Set(entry.hashes);
        state.colors = new Map();
        // colors[c] holds [baseHash] or [baseHash, enhancedHash]; the base hash
        // is always first and is what perkState keys colours by.
        for (const [color, hashes] of Object.entries(entry.colors || {})) {
            if (Array.isArray(hashes) && hashes.length > 0) state.colors.set(color, hashes[0]);
        }
    });

    // Preview the first combo the wish actually defines, so reopening a saved
    // roll shows real numbers instead of a bare base-stat panel.
    activeComboColor = getUsedComboColors()[0] ?? null;

    currentCraftMode = (wish?.tags && wish.tags[0]) || 'pve';
    const modeToggle = document.getElementById('weapon-mode-toggle');
    if (modeToggle) modeToggle.className = `toggle-container ${currentCraftMode}`;

    currentEditContext = { hash, index };
    updateEditButtonVisibility();

    renderPerkPicker();
    await refreshStats();
}

// Called on double-click of an owned roll in Menu > Utility inventory search.
// Loads the weapon and pre-selects the perks actually equipped on that copy, as
// a starting point for a brand-new wish.
// `activeBySocketIndex` maps the weapon def's socket index -> equipped plug hash.
async function loadOwnedRollIntoWeaponCraft(itemHash, name, activeBySocketIndex) {
    document.getElementById('tab-weapons')?.click();
    document.getElementById('weapons-nav-craft')?.click();

    // linkedHashes are left empty here: an owned instance doesn't carry its
    // sibling reissue hashes, and backfillLinkedHashes() in manager.js fills
    // them in on the saved wish afterwards anyway.
    await selectWeaponForCraft(itemHash, name, []);
    if (!currentCraftWeapon || String(currentCraftWeapon.hash) !== String(itemHash)) return;

    currentCraftWeapon.columns.forEach((col, colIndex) => {
        const activeHash = activeBySocketIndex[col.socketIndex];
        if (!activeHash) return;
        const pair = col.pairs.find(({ base, enhanced }) =>
            base.hash === activeHash || (enhanced && enhanced.hash === activeHash));
        const state = perkState[colIndex];
        if (!pair || !state) return;
        // An owned roll is one concrete perk per column — exactly the shape of a
        // combo — so it lands as combo 1 rather than as loose picks. That also
        // gives the stats panel something to preview straight away.
        applyPerkColor(colIndex, pair.base.hash, pair.enhanced?.hash ?? null, COMBO_COLORS[0]);
    });

    activeComboColor = getUsedComboColors()[0] ?? null;

    // selectWeaponForCraft already cleared currentEditContext, so EDIT WISH
    // stays hidden — this is a new wish, not an edit of a saved one.
    renderPerkPicker();
    await refreshStats();
}

function initOracleWeapon(D2Calc, def) {
    const weaponFamily = def.itemSubType;
    const intrinsicSocket = def.sockets?.socketEntries?.[0];
    const weaponSubfamily = intrinsicSocket?.singleInitialItemHash || 0;
    const dmgType = def.defaultDamageTypeHash;
    const weaponAmmo = def.equippingBlock?.ammoType;

    D2Calc.setWeapon(def.hash, weaponFamily, weaponSubfamily, weaponAmmo, dmgType);

    const statsMap = new Map();
    for (const stat of def.investmentStats || []) {
        if (WEAPON_STAT_HASHES.includes(stat.statTypeHash)) {
            statsMap.set(stat.statTypeHash, stat.value);
        }
    }
    D2Calc.setStats(statsMap);
}

// ------------------------------------------------------------------
// Perk picker: column tabs + 4-wide icon grid (3-state click cycle)
// ------------------------------------------------------------------

function renderPerkPicker() {
    renderPerkTabs();
    renderPerkGrid(activePerkTab);
    renderComboToggle();
}

function renderPerkTabs() {
    const tabsEl = document.getElementById('pp-tabs');
    if (!tabsEl || !currentCraftWeapon) return;
    tabsEl.innerHTML = '';

    currentCraftWeapon.columns.forEach((col, colIndex) => {
        const tab = document.createElement('button');
        tab.className = `pp-tab${colIndex === activePerkTab ? ' active' : ''}`;
        tab.dataset.col = String(colIndex);
        tab.innerHTML = `
            <span class="pp-tab-label">COL ${colIndex + 1}</span>
            <span class="pp-tab-badges" id="pp-badges-${colIndex}"></span>
        `;
        tab.addEventListener('click', () => selectPerkTab(colIndex));
        tabsEl.appendChild(tab);
    });

    syncTabBadges();
}

function renderPerkGrid(colIndex) {
    const grid = document.getElementById('pp-grid');
    if (!grid || !currentCraftWeapon) return;
    grid.innerHTML = '';

    const col = currentCraftWeapon.columns[colIndex];
    if (!col) return;

    col.pairs.forEach(({ base, enhanced }) => {
        // `base` is always populated — for perks that only ever exist in an
        // enhanced form (no regular version to pair with), the column builder
        // puts that enhanced plug in the base slot itself. So showing base
        // unconditionally covers every perk with nothing hidden behind a mode.
        const displayPlug = base;

        const cell = document.createElement('div');
        cell.className = 'pp-cell';
        cell.dataset.baseHash = String(base.hash);
        cell.dataset.enhHash = enhanced ? String(enhanced.hash) : '';
        cell.title = displayPlug.name;

        if (displayPlug.icon) {
            const img = document.createElement('img');
            img.src = displayPlug.icon;
            img.alt = displayPlug.name;
            cell.appendChild(img);
        }

        // Combo number (1-4) — the colour alone is not readable for everyone,
        // so the slot is always spelled out as a digit too. syncGridVisuals
        // fills it in and hides it for uncoloured perks.
        const num = document.createElement('span');
        num.className = 'pp-combo-num hidden';
        cell.appendChild(num);

        cell.addEventListener('click', () => cyclePerkState(colIndex, base.hash, enhanced?.hash ?? null));
        cell.addEventListener('mouseenter', () => renderPerkStatDetail(displayPlug, colIndex));
        grid.appendChild(cell);
    });

    syncGridVisuals();
}

function selectPerkTab(colIndex) {
    activePerkTab = colIndex;
    document.querySelectorAll('.pp-tab').forEach((tab, i) => {
        tab.classList.toggle('active', i === colIndex);
    });
    renderPerkGrid(colIndex);
}

// Combo selector for the live stats panel. Each colour is one concrete perk
// tuple (a column can hold only one perk per colour), so a colour maps to
// exactly one gun — no ambiguity about what the numbers describe.
function renderComboToggle() {
    const el = document.getElementById('pp-combo-toggle');
    if (!el) return;

    const used = getUsedComboColors();
    if (used.length === 0) {
        el.innerHTML = '';
        el.classList.add('hidden');
        return;
    }
    el.classList.remove('hidden');

    el.innerHTML = `
        <span class="pp-combo-label">STATS</span>
        <button class="pp-combo-btn${activeComboColor === null ? ' active' : ''}" data-color="">BASE</button>
        ${used.map((c) => `
            <button class="pp-combo-btn pp-combo-btn-${c}${activeComboColor === c ? ' active' : ''}" data-color="${c}">
                ${COMBO_COLORS.indexOf(c) + 1}
            </button>`).join('')}
    `;
    el.querySelectorAll('.pp-combo-btn').forEach((btn) => {
        btn.addEventListener('click', () => selectComboColor(btn.dataset.color || null));
    });
}

async function selectComboColor(color) {
    activeComboColor = color;
    renderComboToggle();
    await refreshStats();
}

// The perks making up one combo, as { colIndex, plug } in column order. Used
// for the stats preview; the oracle wants the enhanced plug when one exists,
// since that is the version the roll would actually end up with.
function getComboPlugs(color) {
    if (!color || !currentCraftWeapon) return [];
    const out = [];
    currentCraftWeapon.columns.forEach((col, colIndex) => {
        const baseHash = perkState[colIndex]?.colors.get(color);
        if (baseHash === undefined) return;
        const pair = col.pairs.find(({ base }) => base.hash === baseHash);
        if (!pair) return;
        const plug = pair.enhanced ?? pair.base;
        out.push({ colIndex, plug });
    });
    return out;
}

// Update the small selected-perk icon badges inside each tab button
function syncTabBadges() {
    if (!currentCraftWeapon) return;
    currentCraftWeapon.columns.forEach((col, colIndex) => {
        const badgesEl = document.getElementById(`pp-badges-${colIndex}`);
        if (!badgesEl) return;
        badgesEl.innerHTML = '';

        const state = perkState[colIndex];
        if (!state) return;

        col.pairs.forEach(({ base, enhanced }) => {
            const isAcceptable = state.acceptable.has(base.hash) || (enhanced && state.acceptable.has(enhanced.hash));
            if (!isAcceptable) return;

            const color = getPerkColor(colIndex, base.hash);
            const img = document.createElement('img');
            img.src = base.icon || '';
            img.className = `pp-badge-icon${color && color !== 'plain' ? ` pp-badge-${color}` : ''}`;
            img.title = base.name;
            badgesEl.appendChild(img);
        });
    });
}

// The combo colour a perk currently wears in its column: a COMBO_COLORS name,
// 'plain' (selected but in no combo), or null (not selected at all).
function getPerkColor(colIndex, baseHash) {
    const state = perkState[colIndex];
    if (!state) return null;
    for (const color of COMBO_COLORS) {
        if (state.colors.get(color) === baseHash) return color;
    }
    return state.acceptable.has(baseHash) ? 'plain' : null;
}

/**
 * Next state in the click cycle: red -> blue -> green -> orange -> plain -> off.
 * Colours already taken by ANOTHER perk in the same column are skipped rather
 * than stolen, so one click never silently recolours a perk the user did not
 * touch — and a column can only ever hold one of each colour.
 */
function nextPerkColor(colIndex, baseHash) {
    const state = perkState[colIndex];
    const current = getPerkColor(colIndex, baseHash);
    if (current === 'plain') return null;

    const startIdx = current === null ? 0 : COMBO_COLORS.indexOf(current) + 1;
    for (let i = startIdx; i < COMBO_COLORS.length; i++) {
        const holder = state.colors.get(COMBO_COLORS[i]);
        if (holder === undefined || holder === baseHash) return COMBO_COLORS[i];
    }
    return 'plain';
}

// Apply a cycle result: rewrites this perk's colour slot and its acceptable
// hashes. `color` is a COMBO_COLORS name, 'plain', or null to deselect.
function applyPerkColor(colIndex, baseHash, enhancedHash, color) {
    const state = perkState[colIndex];
    if (!state) return;

    for (const c of COMBO_COLORS) {
        if (state.colors.get(c) === baseHash) state.colors.delete(c);
    }

    if (color === null) {
        state.acceptable.delete(baseHash);
        if (enhancedHash) state.acceptable.delete(enhancedHash);
        return;
    }

    state.acceptable.add(baseHash);
    if (enhancedHash) state.acceptable.add(enhancedHash);
    if (color !== 'plain') state.colors.set(color, baseHash);
}

// Colours used anywhere on this weapon, in COMBO_COLORS order. Drives the stats
// combo toggle — note this includes single-column colours, which preview fine
// even though the matcher treats them as degenerate.
function getUsedComboColors() {
    const used = [];
    for (const color of COMBO_COLORS) {
        if (perkState.some((s) => s && s.colors.has(color))) used.push(color);
    }
    return used;
}

// Click cycle per perk: red -> blue -> green -> orange -> selected -> deselected
async function cyclePerkState(colIndex, baseHash, enhancedHash) {
    const state = perkState[colIndex];
    if (!state) return;

    const wasSelected = getPerkColor(colIndex, baseHash) !== null;
    if (!wasSelected && getBaseAcceptableCount(colIndex) >= WEAPON_ACCEPTABLE_CAP) return;

    applyPerkColor(colIndex, baseHash, enhancedHash, nextPerkColor(colIndex, baseHash));

    // A colour can disappear entirely once its last perk is recoloured, which
    // would leave the stats panel previewing a combo that no longer exists.
    if (activeComboColor && !getUsedComboColors().includes(activeComboColor)) {
        activeComboColor = null;
    }

    syncPerkTileVisuals();
    renderComboToggle();
    await refreshStats();
}

// Count distinct base perks (not total hashes) in the acceptable set for a column
function getBaseAcceptableCount(colIndex) {
    const state = perkState[colIndex];
    const col = currentCraftWeapon?.columns[colIndex];
    if (!state || !col) return 0;
    let count = 0;
    for (const { base, enhanced } of col.pairs) {
        if (state.acceptable.has(base.hash) || (enhanced && state.acceptable.has(enhanced.hash))) {
            count++;
        }
    }
    return count;
}

// Sync the visible grid cells and all tab badges
function syncPerkTileVisuals() {
    syncGridVisuals();
    syncTabBadges();
}

function syncGridVisuals() {
    const grid = document.getElementById('pp-grid');
    if (!grid || !perkState[activePerkTab]) return;

    grid.querySelectorAll('.pp-cell').forEach((cell) => {
        const baseHash = Number(cell.dataset.baseHash);
        const color = getPerkColor(activePerkTab, baseHash);

        cell.classList.toggle('acceptable', color === 'plain');
        for (const c of COMBO_COLORS) cell.classList.toggle(`combo-${c}`, color === c);

        const num = cell.querySelector('.pp-combo-num');
        if (num) {
            const slot = COMBO_COLORS.indexOf(color);
            num.classList.toggle('hidden', slot < 0);
            if (slot >= 0) num.textContent = String(slot + 1);
        }
    });
}

// Hover panel: perk name + stat delta bars; description shown for trait columns (3 & 4, index 2+)
function renderPerkStatDetail(plug, colIndex) {
    const panel = document.getElementById('weapon-perk-detail');
    if (!panel || !currentCraftWeapon) return;

    const statRows = (plug.stats || [])
        .filter((s) => currentCraftWeapon.statNames.has(s.hash))
        .map((s) => {
            const pct = Math.min(Math.abs(s.value) / PERK_STAT_BAR_MAX * 100, 100).toFixed(1);
            const sign = s.value > 0 ? 'pos' : 'neg';
            const display = (s.value > 0 ? '+' : '') + s.value;
            return `<div class="psi-row">
                <span class="psi-label">${currentCraftWeapon.statNames.get(s.hash)}</span>
                <span class="psi-track"><span class="psi-fill psi-${sign}" style="width:${pct}%"></span></span>
                <span class="psi-val">${display}</span>
            </div>`;
        }).join('');

    const showDesc = colIndex >= 2 && plug.description;
    panel.innerHTML = `
        <div class="wpd-name">${plug.name}${plug.isEnhanced ? ' <span class="wpd-enh-badge">ENHANCED</span>' : ''}</div>
        ${showDesc ? `<div class="wpd-desc">${plug.description}</div>` : ''}
        ${statRows
            ? `<div class="wpd-stats">${statRows}</div>`
            : `<span class="wpd-no-stats">No stat impact</span>`}
    `;
    panel.classList.remove('hidden');
}

// ------------------------------------------------------------------
// Stats panel (light.gg-style: named rows, bars, recoil pie, derived rows)
// ------------------------------------------------------------------

async function renderSeasonTabs() {
    const tabsEl = document.getElementById('weapon-season-tabs');
    if (!tabsEl || !currentCraftWeapon) return;
    tabsEl.innerHTML = '';

    const allHashes = [currentCraftWeapon.hash, ...currentCraftWeapon.linkedHashes];
    if (allHashes.length <= 1) {
        tabsEl.classList.add('hidden');
        return;
    }
    tabsEl.classList.remove('hidden');

    const defs = await loadInventoryItemDefsToMemory();
    const watermarkMap = await ensureWatermarkLookupReady();

    const mapped = allHashes.map((h) => {
        const def = defs.get(String(h));
        const label = getSeasonLabelForWatermark(def?.iconWatermark, watermarkMap);
        const seasonNum = label ? parseInt(label.match(/\d+/)?.[0], 10) : 0;
        return { hash: h, seasonNum, label: seasonNum ? `Season ${seasonNum}` : '?' };
    }).sort((a, b) => a.seasonNum - b.seasonNum);

    // Deduplicate by season: if two hashes share a season, prefer the active one
    // so the tab shows correctly highlighted. All hashes still flow through
    // allHashes for wishlist grouping.
    const seen = new Map(); // seasonNum → entry
    for (const entry of mapped) {
        if (!seen.has(entry.seasonNum) || entry.hash === currentCraftWeapon.hash) {
            seen.set(entry.seasonNum, entry);
        }
    }
    const tabs = [...seen.values()];

    // Only show tabs if there are distinct seasons after dedup
    if (tabs.length <= 1) {
        tabsEl.classList.add('hidden');
        return;
    }

    tabs.forEach(({ hash, label }) => {
        const btn = document.createElement('button');
        btn.className = 'weapon-season-tab' + (hash === currentCraftWeapon.hash ? ' active' : '');
        btn.textContent = label;
        btn.onclick = () => {
            const siblingHashes = allHashes.filter((h) => h !== hash);
            selectWeaponForCraft(hash, currentCraftWeapon.name, siblingHashes);
        };
        tabsEl.appendChild(btn);
    });
}

// Build the panel DOM once per weapon; updateStatsPanel() mutates values in
// place so CSS transitions / rAF tweens animate between states.
function buildStatsPanel() {
    const container = document.getElementById('weapon-live-stats');
    if (!container || !currentCraftWeapon) return;
    container.innerHTML = '';

    renderSeasonTabs();

    // Screenshot background with dark overlay for readability
    if (currentCraftWeapon.screenshot) {
        container.style.backgroundImage =
            `linear-gradient(rgba(12,12,18,0.82), rgba(12,12,18,0.82)), url('${currentCraftWeapon.screenshot}')`;
        container.style.backgroundSize = 'cover';
        container.style.backgroundPosition = 'right center';
    } else {
        container.style.backgroundImage = '';
    }

    const header = document.createElement('div');
    header.className = 'wstat-header';
    header.textContent = currentCraftWeapon.name;
    if (currentCraftWeapon.seasonLabel) {
        const seasonSub = document.createElement('div');
        seasonSub.className = 'wstat-season';
        seasonSub.textContent = currentCraftWeapon.seasonLabel;
        header.appendChild(seasonSub);
    }
    container.appendChild(header);

    currentCraftWeapon.displayStats.forEach((stat) => {
        const row = document.createElement('div');
        row.className = 'wstat-row';
        row.dataset.statHash = String(stat.statHash);

        if (stat.isRecoil) {
            row.innerHTML = `
                <span class="wstat-label">${stat.name}</span>
                <span class="wstat-recoil">
                    <svg viewBox="0 0 2 1" class="recoil-svg">
                        <path d="M0,1 A1,1 0 0,1 2,1 Z" fill="rgba(0,0,0,0.55)"></path>
                        <path class="recoil-wedge" d="" fill="#ffffff"></path>
                    </svg>
                </span>
                <span class="wstat-num" data-cur="0">0</span>
            `;
        } else if (stat.isBar) {
            row.innerHTML = `
                <span class="wstat-label">${stat.name}</span>
                <span class="wstat-track">
                    <span class="wstat-fill-base" style="width:0%"></span>
                    <span class="wstat-fill-delta" style="left:0%;width:0%"></span>
                </span>
                <span class="wstat-num" data-cur="0">0</span>
            `;
        } else {
            row.innerHTML = `
                <span class="wstat-label">${stat.name}</span>
                <span class="wstat-text wstat-num-plain" data-cur="0">0</span>
            `;
        }

        container.appendChild(row);
    });

    const readout = document.createElement('div');
    readout.className = 'weapon-ttk-readout';
    readout.id = 'wstat-ttk';
    container.appendChild(readout);
}

// Sum of the previewed combo's investment stat deltas across all columns
function getActivePerkStatDeltas() {
    const deltas = new Map();
    for (const { plug } of getComboPlugs(activeComboColor)) {
        for (const s of plug.stats || []) {
            if (s.conditional) continue;
            deltas.set(s.hash, (deltas.get(s.hash) || 0) + s.value);
        }
    }
    return deltas;
}

// Re-sync the oracle engine with the previewed combo, then animate the panel
async function refreshStats() {
    if (!currentCraftWeapon) return;

    const D2Calc = await window.oracleEngineReady;
    D2Calc.resetTraits();
    for (const { plug } of getComboPlugs(activeComboColor)) {
        const statMap = new Map(
            (plug.stats || []).filter((s) => !s.conditional).map((s) => [s.hash, s.value])
        );
        D2Calc.addTrait(statMap, 1, plug.hash);
    }

    updateStatsPanel(D2Calc);
}

function updateStatsPanel(D2Calc) {
    const container = document.getElementById('weapon-live-stats');
    if (!container || !currentCraftWeapon) return;

    const deltas = getActivePerkStatDeltas();

    currentCraftWeapon.displayStats.forEach((stat) => {
        const row = container.querySelector(`.wstat-row[data-stat-hash="${stat.statHash}"]`);
        if (!row) return;

        const total = stat.base + (deltas.get(stat.statHash) || 0);
        const display = interpolateStatValue(total, stat.interpolation);

        if (stat.isRecoil) {
            animateRecoil(row.querySelector('.recoil-wedge'), display);
            animateNumber(row.querySelector('.wstat-num'), display);
        } else if (stat.isBar) {
            const delta = deltas.get(stat.statHash) || 0;
            const baseDisplay = interpolateStatValue(stat.base, stat.interpolation);
            const max = stat.displayMaximum;
            const clamp = (v) => Math.max(0, Math.min(v, 100));
            const basePct  = clamp(baseDisplay / max * 100);
            const totalPct = clamp(display / max * 100);

            const baseEl  = row.querySelector('.wstat-fill-base');
            const deltaEl = row.querySelector('.wstat-fill-delta');

            if (delta > 0) {
                // Gray fills to base, green segment extends to total
                baseEl.style.width  = `${basePct}%`;
                deltaEl.style.left  = `${basePct}%`;
                deltaEl.style.width = `${totalPct - basePct}%`;
                deltaEl.className = 'wstat-fill-delta wstat-delta-pos';
            } else if (delta < 0) {
                // Gray fills to reduced total, red segment shows what was removed
                baseEl.style.width  = `${totalPct}%`;
                deltaEl.style.left  = `${totalPct}%`;
                deltaEl.style.width = `${basePct - totalPct}%`;
                deltaEl.className = 'wstat-fill-delta wstat-delta-neg';
            } else {
                baseEl.style.width  = `${basePct}%`;
                deltaEl.style.left  = '0%';
                deltaEl.style.width = '0%';
                deltaEl.className = 'wstat-fill-delta';
            }

            animateNumber(row.querySelector('.wstat-num'), display);
        } else {
            animateNumber(row.querySelector('.wstat-num-plain'), display);
        }
    });

    // TTK readout
    try {
        const ttk = D2Calc.getWeaponTtk(0);
        const ttkEl = document.getElementById('wstat-ttk');
        const base = Array.isArray(ttk) ? ttk[0] : null;
        if (ttkEl && base?.optimalTtk) {
            ttkEl.textContent = `TTK: ${base.optimalTtk.headshots}H / ${base.optimalTtk.bodyshots}B in ${base.optimalTtk.timeTaken.toFixed(3)}s`;
        }
    } catch (e) {
        console.error('[WEAPON-CRAFT] TTK calc failed', e);
    }
}

// ------------------------------------------------------------------
// Animation helpers (ease-out: fast start, slow settle)
// ------------------------------------------------------------------

function easeOutCubic(t) { return 1 - Math.pow(1 - t, 3); }

// Tween the text of a numeric readout from its current shown value
function animateNumber(el, target) {
    if (!el) return;
    const from = Number(el.dataset.cur) || 0;
    const to = Math.round(target);
    el.dataset.cur = String(to);
    if (from === to) { el.textContent = String(to); return; }

    if (el._numAnim) cancelAnimationFrame(el._numAnim);
    const start = performance.now();
    const step = (now) => {
        const t = Math.min((now - start) / STAT_ANIM_MS, 1);
        el.textContent = String(Math.round(from + (to - from) * easeOutCubic(t)));
        if (t < 1) el._numAnim = requestAnimationFrame(step);
    };
    el._numAnim = requestAnimationFrame(step);
}

// DIM-style recoil direction pie: semicircle, wedge tilts away from vertical
// as the stat drops; higher recoil direction = tighter, more vertical wedge.
function recoilWedgePath(value) {
    const clamped = Math.max(0, Math.min(value, 100));
    // Direction in radians off vertical; sign alternates with the Bungie sine pattern
    const direction = Math.sin((clamped + 5) * ((2 * Math.PI) / 20)) * ((100 - clamped) / 100) * (Math.PI / 2);
    const halfSpread = Math.max(Math.abs(direction) * 0.75, 0.06);

    const a1 = direction - halfSpread;
    const a2 = direction + halfSpread;
    const x1 = 1 + Math.sin(a1);
    const y1 = 1 - Math.cos(a1);
    const x2 = 1 + Math.sin(a2);
    const y2 = 1 - Math.cos(a2);

    return `M1,1 L${x1.toFixed(4)},${y1.toFixed(4)} A1,1 0 0,1 ${x2.toFixed(4)},${y2.toFixed(4)} Z`;
}

function animateRecoil(pathEl, target) {
    if (!pathEl) return;
    const from = Number(pathEl.dataset.cur) || 0;
    const to = Math.round(target);
    pathEl.dataset.cur = String(to);
    if (from === to) { pathEl.setAttribute('d', recoilWedgePath(to)); return; }

    if (pathEl._recoilAnim) cancelAnimationFrame(pathEl._recoilAnim);
    const start = performance.now();
    const step = (now) => {
        const t = Math.min((now - start) / STAT_ANIM_MS, 1);
        pathEl.setAttribute('d', recoilWedgePath(from + (to - from) * easeOutCubic(t)));
        if (t < 1) pathEl._recoilAnim = requestAnimationFrame(step);
    };
    pathEl._recoilAnim = requestAnimationFrame(step);
}

// ------------------------------------------------------------------
// Save wish
// ------------------------------------------------------------------

// Shared by saveWeaponWish (append) and editWeaponWish (overwrite in place).
// The payload shape and the `raw` identity string come from weapon-wish-core.js,
// which the godroll.tv button also uses, so both paths save identical wishes.
function buildWeaponWishPayload() {
    return WeaponWish.buildWeaponWishPayload(currentCraftWeapon.columns, perkState, COMBO_COLORS);
}

async function saveWeaponWish() {
    if (!currentCraftWeapon) return;

    const { hasAny, rawString, config } = buildWeaponWishPayload();
    if (!hasAny) {
        console.warn('[WEAPON-CRAFT] no acceptable perks selected, nothing to save');
        return;
    }

    await saveItem(
        currentCraftWeapon.hash,
        currentCraftWeapon.name,
        'weapon',
        rawString,
        rawString,
        config,
        currentCraftMode,
        currentCraftWeapon.icon,
        null, null, null, null, null,
        currentCraftWeapon.linkedHashes,
        {
            ammoType: currentCraftWeapon.def?.equippingBlock?.ammoType ?? null,
            itemTypeDisplayName: currentCraftWeapon.def?.itemTypeDisplayName ?? null,
            damageTypeHash: currentCraftWeapon.def?.defaultDamageTypeHash ?? null
        }
    );

    const saveBtn = document.getElementById('weapon-save-new-btn');
    if (saveBtn) {
        const original = saveBtn.textContent;
        saveBtn.textContent = 'WISH GRANTED!';
        setTimeout(() => { saveBtn.textContent = original; }, 1500);
    }
}

async function editWeaponWish() {
    if (!currentCraftWeapon || !currentEditContext) return;

    const { hasAny, rawString, config } = buildWeaponWishPayload();
    if (!hasAny) {
        console.warn('[WEAPON-CRAFT] no acceptable perks selected, nothing to save');
        return;
    }

    await editItemWish(currentEditContext.hash, currentEditContext.index, rawString, config, currentCraftMode);

    const editBtn = document.getElementById('weapon-edit-wish-btn');
    if (editBtn) {
        const original = editBtn.textContent;
        editBtn.textContent = 'WISH UPDATED!';
        setTimeout(() => { editBtn.textContent = original; }, 1500);
    }
}

document.addEventListener('DOMContentLoaded', initWeaponCraft);
