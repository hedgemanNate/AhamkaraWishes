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
});

observer.observe(document.body, { childList: true, subtree: true });

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

        // 2. Check for Duplicates (The "Optimal" Check)
        const existingWishes = activeList.items[hash].wishes;
        const isDuplicate = existingWishes.some(w => w.raw === rawString && w.tags.includes(currentMode));

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