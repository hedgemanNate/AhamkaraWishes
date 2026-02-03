// --- CONFIGURATION ---
const API_KEY = "aa53f073572f4396a5b63bcee158e99f"; 
// ---------------------

let lastSavedString = "";

// =========================================================
// 1. D2FOUNDRY INJECTOR (UI Updated)
// =========================================================
const observer = new MutationObserver((mutations) => {
    // 1. Find the Anchor (The Copy Button)
    const anchorBtn = document.querySelector('button[aria-label="Copy DIM Wishlist Item"]');

    // 2. Find the Wrapper (The box holding the Input + Copy Button)
    // We want to inject AFTER this box, not inside it.
    const inputContainer = anchorBtn ? anchorBtn.parentNode : null;

    if (inputContainer && !document.getElementById("ahamkara-btn")) {
        injectD2Button(anchorBtn, inputContainer);
    }
});

observer.observe(document.body, { childList: true, subtree: true });

function injectD2Button(anchorBtn, inputContainer) {
    const myBtn = document.createElement("button");
    myBtn.id = "ahamkara-btn";
    myBtn.innerText = "Make Ahamkara Wish"; 
    
    // Copy classes (keeps fonts/sizing consistent)
    myBtn.className = anchorBtn.className.replace(/Share_copyButton__[a-zA-Z0-9]+/, "");
    
    // 1. DEFAULT STATE: Black Background, Gold Text & Border
    Object.assign(myBtn.style, {
        width: "100%",
        marginTop: "10px",
        display: "flex",
        justifyContent: "center",
        alignItems: "center",
        padding: "8px",
        backgroundColor: "black",      // Black
        color: "#FFFFFF",              // White Text
        border: "1px solid #D4AF37",   // Gold Border
        fontWeight: "bold",
        borderRadius: "4px",
        cursor: "pointer",
        transition: "all 0.2s ease"    // Smooth color change
    });

    // 2. HOVER STATE: Charcoal Background, Bright Yellow Border
    myBtn.addEventListener("mouseenter", () => {
        myBtn.style.backgroundColor = "#333333"; // Charcoal
        myBtn.style.borderColor = "#FFD700";     // Bright Yellow
        myBtn.style.color = "#FFD700";           // Text matches border
    });

    // 3. RESET STATE: Back to Black/Gold
    myBtn.addEventListener("mouseleave", () => {
        myBtn.style.backgroundColor = "black";
        myBtn.style.borderColor = "#D4AF37";
        myBtn.style.color = "#FFFFFF";
    });

    // Logic: Grab the input value
    myBtn.addEventListener("click", (e) => {
        e.stopPropagation(); 
        e.preventDefault();

        const inputField = document.getElementById("dim-input");
        if (inputField && inputField.value) {
            showToast("Captured from D2Foundry!");
            processRoll(inputField.value);
        } else {
            showToast("Error: Could not read 'dim-input' field.");
        }
    });

    // INJECTION POINT
    inputContainer.parentNode.insertBefore(myBtn, inputContainer.nextSibling);
}

// =========================================================
// 2. GLOBAL LISTENER (Fallback for DIM)
// =========================================================
document.addEventListener("click", () => {
    setTimeout(async () => {
        try {
            const text = await navigator.clipboard.readText();
            
            if (text.startsWith("dimwishlist:")) {
                if (document.activeElement && document.activeElement.id === "ahamkara-btn") return;

                // showToast("Clipboard detected..."); 
                processRoll(text);
            }
        } catch (err) { /* Ignore */ }
    }, 200);
});

// =========================================================
// 3. CORE LOGIC
// =========================================================
async function processRoll(dimString) {
    const params = new URLSearchParams(dimString.split('dimwishlist:')[1]);
    const rawHash = params.get('item');
    
    // 500 Error Fix
    const safeHash = (Number(rawHash) >> 0).toString();

    let weaponName = "Unknown Weapon";

    try {
        if (!API_KEY || API_KEY.includes("PASTE_YOUR_KEY")) {
            throw new Error("Missing API Key");
        }
        weaponName = await fetchWeaponName(safeHash);
    } catch (e) {
        console.error("Ahamkara Error:", e);
        weaponName = "API Error"; 
        showToast("Error connecting to Bungie");
    }

    saveToActiveList(dimString, rawHash, weaponName);
}

async function fetchWeaponName(hash) {
    const url = `https://www.bungie.net/Platform/Destiny2/Manifest/DestinyInventoryItemDefinition/${hash}/`;
    
    const response = await fetch(url, {
        method: 'GET',
        headers: { 'X-API-Key': API_KEY }
    });

    if (!response.ok) throw new Error(`Status: ${response.status}`);

    const data = await response.json();
    return data.Response?.displayProperties?.name || "Unknown Item";
}

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