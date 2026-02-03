// --- CONFIGURATION ---
const API_KEY = "aa53f073572f4396a5b63bcee158e99f"; 
// ---------------------

let lastSavedString = "";

// 1. Listen for clicks (DIM & D2Foundry)
document.addEventListener("click", () => {
    setTimeout(async () => {
        try {
            const text = await navigator.clipboard.readText();
            
            // Check for DIM Wishlist format
            if (text.startsWith("dimwishlist:") && text !== lastSavedString) {
                lastSavedString = text;
                showToast("Fetching weapon info...");
                processRoll(text);
            }
        } catch (err) { /* Ignore */ }
    }, 200);
});

async function processRoll(dimString) {
    const params = new URLSearchParams(dimString.split('dimwishlist:')[1]);
    const rawHash = params.get('item');
    
    // 2. THE 500 ERROR FIX (Bitwise Shift)
    // Forces the ID into a 32-bit Signed Integer (required by Bungie)
    const safeHash = (Number(rawHash) >> 0).toString();

    let weaponName = "Unknown Weapon";

    try {
        if (!API_KEY || API_KEY.includes("PASTE_YOUR_KEY")) {
            throw new Error("Please open content.js and paste your API Key.");
        }
        weaponName = await fetchWeaponName(safeHash);
    } catch (e) {
        console.error("Ahamkara Wishes Error:", e);
        weaponName = "API Error"; 
        showToast("Error connecting to Bungie");
    }

    saveToActiveList(dimString, rawHash, weaponName);
}

// HELPER: Query Bungie
async function fetchWeaponName(hash) {
    const url = `https://www.bungie.net/Platform/Destiny2/Manifest/DestinyInventoryItemDefinition/${hash}/`;
    
    const response = await fetch(url, {
        method: 'GET',
        headers: { 'X-API-Key': API_KEY }
    });

    if (!response.ok) {
        throw new Error(`Bungie Status: ${response.status}`);
    }

    const data = await response.json();
    return data.Response?.displayProperties?.name || "Unknown Item";
}

// HELPER: Save to Storage
function saveToActiveList(rawString, hash, name) {
    const newEntry = {
        id: Date.now(),
        raw: rawString,
        date: new Date().toLocaleTimeString()
    };

    chrome.storage.local.get(['dimData'], (result) => {
        let data = result.dimData || { activeId: 'default', lists: { 'default': { name: 'Main Wishlist', items: {} } } };
        const activeList = data.lists[data.activeId];

        if (!activeList.items) activeList.items = {};
        
        // Initialize bucket or update name
        if (!activeList.items[hash]) {
            activeList.items[hash] = { name: name, hash: hash, rolls: [] };
        } else if (name !== "API Error" && !name.includes("Unknown")) {
            activeList.items[hash].name = name;
        }

        activeList.items[hash].rolls.push(newEntry);

        chrome.storage.local.set({ dimData: data }, () => {
            if (name !== "API Error") showToast(`Saved: ${name}`);
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