// --- CONFIGURATION ---
const API_KEY = "fee720e84d6c4239aeb7d442b4d39f38"; 
// ---------------------

let currentMode = 'pve'; // Default to PvE

// =========================================================
// 1. D2FOUNDRY INJECTOR (With Toggle)
// =========================================================
const observer = new MutationObserver((mutations) => {
    const anchorBtn = document.querySelector('button[aria-label="Copy DIM Wishlist Item"]');
    const inputContainer = anchorBtn ? anchorBtn.parentNode : null;

    if (inputContainer && !document.getElementById("ahamkara-wrapper")) {
        injectControls(inputContainer);
    }
    // Also attempt to inject a Wish button next to the site's Enhance button
    ensureEnhanceWishInjected();
});

observer.observe(document.body, { childList: true, subtree: true });

// Try to find the D2Foundry "Enhance" button and insert a matching "Wish" button beside it.
function ensureEnhanceWishInjected() {
    try {
        // Look for common markers for the Enhance button; fallback to scanning text
        let enhanceBtn = document.querySelector('button[class*="RollToolbar_enhanceLeft"], button[class*="enhanceLeft"], button[aria-label="Enhance"], button[title*="Enhance"]');
        if (!enhanceBtn) {
            const allButtons = Array.from(document.querySelectorAll('button'));
            enhanceBtn = allButtons.find(b => (b.innerText || '').trim().toLowerCase().includes('enhance'));
        }

        if (!enhanceBtn) return;
        const parent = enhanceBtn.parentNode;
        if (!parent) return;

        // Avoid inserting duplicates; require both spacer and button to be absent
        if (document.getElementById('ahamkara-wish-btn') || document.getElementById('ahamkara-wish-spacer')) return;

        // Create a small spacer element (reliable even if site CSS overrides margins)
        const spacer = document.createElement('span');
        spacer.id = 'ahamkara-wish-spacer';
        spacer.style.display = 'inline-block';
        spacer.style.width = '12px';
        spacer.style.height = '1px';
        spacer.style.lineHeight = '0';

        // Create the Wish button and copy visual classes from Enhance for consistency
        const wishBtn = document.createElement('button');
        wishBtn.id = 'ahamkara-wish-btn';
        try { wishBtn.className = enhanceBtn.className || ''; } catch (e) { wishBtn.className = ''; }
        wishBtn.textContent = 'Ahamkara Wish';
        wishBtn.setAttribute('aria-label', 'Wish');
        // Ensure gold lettering is visible even if classes override color
        wishBtn.style.setProperty('color', '#d4af37', 'important');
        // Make it inline-block and keyboard-friendly
        wishBtn.style.display = 'inline-block';
        wishBtn.style.verticalAlign = 'middle';
        wishBtn.style.cursor = 'pointer';

        // Insert spacer then wish button after the enhance button
        const next = enhanceBtn.nextSibling;
        parent.insertBefore(spacer, next);
        parent.insertBefore(wishBtn, spacer.nextSibling);

        // Emit custom event for wishlist integration
        wishBtn.addEventListener('click', (ev) => {
            ev.preventDefault();
            ev.stopPropagation();
            const evt = new CustomEvent('ahamkara:wishClicked', { detail: { source: 'd2foundry', time: Date.now() } });
            document.dispatchEvent(evt);
        });

        // Keyboard activation (Enter/Space) for accessibility
        wishBtn.addEventListener('keydown', (ev) => {
            if (ev.key === 'Enter' || ev.key === ' ') {
                ev.preventDefault();
                wishBtn.click();
            }
        });
    } catch (e) {
        console.warn('Wish injection failed', e);
    }
}

// Also try once on initial load in case the observer misses an early render
document.addEventListener('DOMContentLoaded', () => ensureEnhanceWishInjected());

// --- Wish crafting mode: selection of perks inside PerkSection ---
// Temporary store for selected perks during crafting
window.ahamkaraWishSelection = new Set();
window.ahamkaraWishMode = false;

// Inject styles for selected perk visual
function injectWishStyles() {
    if (document.getElementById('ahamkara-wish-styles')) return;
    const s = document.createElement('style');
    s.id = 'ahamkara-wish-styles';
    s.textContent = `
    .ahamkara-perk-selected {
        border: 2px solid #d4af37 !important;
        box-shadow: 0 0 8px rgba(212,175,55,0.12) !important;
    }
    /* Only target individual perk elements: prefer data attributes, avoid PerkSection/perkGrid containers */
    .ahamkara-wish-mode [data-perk-hash],
    .ahamkara-wish-mode [data-plug-hash],
    .ahamkara-wish-mode [class*="perk"]:not([class*="PerkSection"]):not([class*="perkGrid"]) {
        cursor: pointer !important;
    }
    /* Active Ahamkara Wish button styling */
    #ahamkara-wish-btn.active {
        outline: none !important;
        box-shadow: 0 0 0 2px rgba(212,175,55,0.08), 0 0 8px rgba(212,175,55,0.12) !important;
        border: 2px solid #d4af37 !important;
        color: #d4af37 !important;
    }
    `;
    document.head.appendChild(s);
}

function enterWishMode() {
    injectWishStyles();
    window.ahamkaraWishSelection = new Set();
    window.ahamkaraWishMode = true;
    document.body.classList.add('ahamkara-wish-mode');
    const btn = document.getElementById('ahamkara-wish-btn');
    if (btn) btn.classList.add('active');
}

function exitWishMode() {
    window.ahamkaraWishMode = false;
    document.body.classList.remove('ahamkara-wish-mode');
    const btn = document.getElementById('ahamkara-wish-btn');
    if (btn) btn.classList.remove('active');
}

function findPerkElement(el) {
    // Walk up to find an element that looks like an individual perk: prefer data attributes
    let cur = el;
    while (cur && cur !== document.body) {
        if (cur.getAttribute) {
            if (cur.hasAttribute('data-perk-hash') || cur.hasAttribute('data-plug-hash')) return cur;
        }
        const cls = (cur.className || '').toString();
        // If class looks like an individual perk (contains 'perk') but explicitly avoid
        // matching PerkSection containers or perkGrid wrappers.
        if (/perk/i.test(cls) && !/PerkSection|perkGrid/i.test(cls)) return cur;
        cur = cur.parentNode;
    }
    return null;
}

function togglePerkSelection(el) {
    if (!el) return;
    // Attempt to derive an identifier
    const id = el.getAttribute('data-perk-hash') || el.getAttribute('data-plug-hash') || el.getAttribute('data-hash') || el.dataset?.hash || el.dataset?.perkHash || (el.getAttribute('aria-label') || el.textContent || '').trim();
    if (!id) return;
    const set = window.ahamkaraWishSelection || new Set();
    if (set.has(id)) {
        set.delete(id);
        el.classList.remove('ahamkara-perk-selected');
    } else {
        set.add(id);
        el.classList.add('ahamkara-perk-selected');
    }
    window.ahamkaraWishSelection = set;
    document.dispatchEvent(new CustomEvent('ahamkara:wishSelectionChanged', { detail: { selection: Array.from(set) } }));
}

// Global click handler for perk toggling when in wish mode
document.addEventListener('click', (ev) => {
    if (!window.ahamkaraWishMode) return;
    const target = ev.target;
    const perkEl = findPerkElement(target);
    if (perkEl) {
        ev.preventDefault();
        ev.stopPropagation();
        togglePerkSelection(perkEl);
    }
}, true);

// Listen for the Ahamkara Wish button custom event to toggle wish mode
document.addEventListener('ahamkara:wishClicked', (e) => {
    // toggle mode
    if (window.ahamkaraWishMode) {
        exitWishMode();
    } else {
        enterWishMode();
    }
});

function injectControls(inputContainer) {
    // Wrapper to hold Toggle + Button side-by-side
    const wrapper = document.createElement("div");
    wrapper.id = "ahamkara-wrapper";
    wrapper.style.cssText = "display: flex; align-items: center; margin-top: 10px; gap: 8px;";

    // 1. THE TOGGLE (PvE | PvP)
    const toggle = document.createElement("div");
    toggle.className = "toggle-container pve"; // Default class
    toggle.style.cssText = "display: flex; border: 1px solid #444; border-radius: 4px; background: #000; cursor: pointer; overflow: hidden;";
    
    toggle.innerHTML = `
        <div class="opt-pve" style="padding: 8px 12px; font-weight: bold; font-size: 12px; color: #fff; background: #1e3a8a;">PvE</div>
        <div class="opt-pvp" style="padding: 8px 12px; font-weight: bold; font-size: 12px; color: #555; background: transparent;">PvP</div>
    `;

    // Toggle Click Event
    toggle.addEventListener('click', () => {
        if (currentMode === 'pve') {
            currentMode = 'pvp';
            toggle.className = "toggle-container pvp";
            toggle.querySelector('.opt-pve').style.cssText = "padding: 8px 12px; font-weight: bold; font-size: 12px; color: #555; background: transparent;";
            toggle.querySelector('.opt-pvp').style.cssText = "padding: 8px 12px; font-weight: bold; font-size: 12px; color: #fff; background: #991b1b;";
        } else {
            currentMode = 'pve';
            toggle.className = "toggle-container pve";
            toggle.querySelector('.opt-pve').style.cssText = "padding: 8px 12px; font-weight: bold; font-size: 12px; color: #fff; background: #1e3a8a;";
            toggle.querySelector('.opt-pvp').style.cssText = "padding: 8px 12px; font-weight: bold; font-size: 12px; color: #555; background: transparent;";
        }
    });

    // 2. THE BUTTON
    const btn = document.createElement("button");
    btn.innerText = "MAKE WISH";
    btn.style.cssText = "flex: 1; background: black; color: white; border: 1px solid #d4af37; padding: 8px; font-weight: bold; border-radius: 4px; cursor: pointer;";
    
    btn.addEventListener("click", (e) => {
        e.preventDefault();
        const inputField = document.getElementById("dim-input");
        if (inputField && inputField.value) {
            processRoll(inputField.value);
        } else {
            showToast("Error: No wish string found.");
        }
    });

    wrapper.appendChild(toggle);
    wrapper.appendChild(btn);

    // INJECT
    inputContainer.parentNode.insertBefore(wrapper, inputContainer.nextSibling);
}

// =========================================================
// 2. CORE LOGIC (New Data Structure)
// =========================================================
async function processRoll(dimString) {
    const params = new URLSearchParams(dimString.split('dimwishlist:')[1]);
    const safeHash = params.get('item');
    const perks = params.get('perks'); // Capture perks for config

    let weaponName = "Unknown Weapon";

    try {
        weaponName = await fetchWeaponName(safeHash);
    } catch (e) {
        console.error("API Error", e);
        showToast("Warning: Could not fetch name");
    }

    saveItem(safeHash, weaponName, "weapon", dimString, { perks: perks });
}

async function fetchWeaponName(hash) {
    const response = await fetch(`https://www.bungie.net/Platform/Destiny2/Manifest/DestinyInventoryItemDefinition/${hash}/`, {
        headers: { 'X-API-Key': API_KEY }
    });
    const data = await response.json();
    return data.Response?.displayProperties?.name || "Unknown Item";
}

function saveItem(hash, name, type, rawString, config) {
    chrome.storage.local.get(['dimData'], (result) => {
        // Initialize Structure if missing
        let data = result.dimData || { 
            activeId: 'default', 
            lists: { 'default': { name: 'Main Wishlist', items: {} } } 
        };
        
        const activeList = data.lists[data.activeId];
        if (!activeList.items) activeList.items = {};

        // 1. Create Item Container if missing
        if (!activeList.items[hash]) {
            activeList.items[hash] = {
                static: { name: name, type: type, set: null },
                wishes: []
            };
        }

        // 2. Check for Duplicates: armor compares config, weapons compare raw string
        const existingWishes = activeList.items[hash].wishes;
        const isDuplicate = existingWishes.some((w) => {
            if (!w) return false;
            const sameMode = (w.tags || []).includes(currentMode);
            if (!sameMode) return false;
            if (config?.archetype && config?.spark) {
                return w.config?.archetype === config.archetype &&
                       w.config?.spark === config.spark;
            }
            return w.raw === rawString;
        });

        if (isDuplicate) {
            showToast("Duplicate: You already wished for this!");
            return; // EXIT
        }

        // 3. Add New Wish
        activeList.items[hash].wishes.push({
            tags: [currentMode], // ['pve'] or ['pvp']
            config: config,
            raw: rawString,
            added: Date.now()
        });

        // 4. Save
        chrome.storage.local.set({ dimData: data }, () => {
            showToast(`Saved ${currentMode.toUpperCase()}: ${name}`);
        });
    });
}

function showToast(msg) {
    const existing = document.getElementById("dim-toast");
    if (existing) existing.remove();
    const toast = document.createElement("div");
    toast.id = "dim-toast";
    toast.innerText = msg;
    toast.style.cssText = `position: fixed; bottom: 20px; right: 20px; background: #e8a534; color: black; padding: 12px 24px; border-radius: 4px; font-weight: bold; z-index: 9999; font-family: sans-serif; box-shadow: 0 4px 12px rgba(0,0,0,0.5);`;
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 2500);
}