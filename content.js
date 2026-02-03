let lastSavedString = "";

// 1. Listen for ANY click
document.addEventListener("click", (e) => {
    
    // 2. Wait 200ms for clipboard to update
    setTimeout(async () => {
        try {
            const text = await navigator.clipboard.readText();
            
            // 3. Check for DIM Wishlist format
            if (text.startsWith("dimwishlist:") && text !== lastSavedString) {
                lastSavedString = text;
                
                // 4. SCRAPE NAME: Use the new Robust Finder
                const weaponName = getWeaponNameFromPopup(text);
                
                // 5. Save with name
                saveRollToActiveList(text, weaponName);
                showToast(`Saved: ${weaponName}`);
            }
        } catch (err) { /* Ignore */ }
    }, 200);
});

// NEW: Robust "Reverse Traversal" Finder
function getWeaponNameFromPopup(clipboardText) {
    // Strategy: Find the exact input on screen that holds the text we just copied.
    // Then walk UP the tree to find the header in the same container.
    
    const inputs = document.querySelectorAll('input[type="text"], textarea');
    let targetInput = null;

    // A. Find the input
    for (const input of inputs) {
        // We check if the input contains the "dimwishlist" tag
        // (Using startsWith is safer than exact match in case of whitespace)
        if (input.value && input.value.startsWith('dimwishlist:')) {
            targetInput = input;
            break;
        }
    }

    // B. Traverse Up looking for a Header
    if (targetInput) {
        let parent = targetInput.parentElement;
        // Search up to 15 levels up (usually it's 3-5 levels up)
        for (let i = 0; i < 15; i++) {
            if (!parent) break;

            // Look for any H2 (standard DIM title) or H1
            // We ignore H3/H4 as those are usually section headers like "Perks"
            const title = parent.querySelector('h2, h1');
            
            if (title) {
                // Verification: Avoid "Perks" or "Stats" headers if they use H2 (rare but possible)
                if (title.innerText.length > 2 && title.innerText !== "Perks") {
                    return title.innerText;
                }
            }
            parent = parent.parentElement;
        }
    }
    
    return "Unknown Weapon";
}

function saveRollToActiveList(dimString, weaponName) {
    // Extract Item Hash from string (dimwishlist:item=123&...)
    const params = new URLSearchParams(dimString.split('dimwishlist:')[1]); // Fixed split logic
    const itemHash = params.get('item');

    const newEntry = {
        id: Date.now(),
        raw: dimString,
        note: "", 
        date: new Date().toLocaleTimeString()
    };

    chrome.storage.local.get(['dimData'], (result) => {
        let data = result.dimData || { activeId: 'default', lists: { 'default': { name: 'Main Wishlist', items: {} } } };
        const activeId = data.activeId;
        const activeList = data.lists[activeId];

        // Ensure "items" object exists
        if (Array.isArray(activeList.items) || !activeList.items) {
            activeList.items = {}; 
        }

        // Initialize Weapon Bucket if new
        if (!activeList.items[itemHash]) {
            activeList.items[itemHash] = {
                name: weaponName,
                hash: itemHash,
                rolls: []
            };
        }

        // Add the roll
        activeList.items[itemHash].rolls.push(newEntry);
        
        // Update Name if it was "Unknown" before
        if (activeList.items[itemHash].name === "Unknown Weapon" && weaponName !== "Unknown Weapon") {
            activeList.items[itemHash].name = weaponName;
        }

        chrome.storage.local.set({ dimData: data });
    });
}

function showToast(message) {
    const existing = document.getElementById("dim-toast");
    if (existing) existing.remove();
    const toast = document.createElement("div");
    toast.id = "dim-toast";
    toast.innerText = message;
    toast.style.cssText = `position: fixed; bottom: 20px; right: 20px; background: #e8a534; color: black; padding: 12px 24px; border-radius: 4px; font-weight: bold; z-index: 9999; font-family: sans-serif; box-shadow: 0 4px 12px rgba(0,0,0,0.5);`;
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 2000);
}