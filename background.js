// Allows users to open the side panel by clicking the action toolbar icon
chrome.sidePanel
  .setPanelBehavior({ openPanelOnActionClick: true })
  .catch((error) => console.error(error));

chrome.runtime.onInstalled.addListener(() => {
  console.log("Ahamkara Wishes installed.");
});
// Optional: set your Bungie API key here (from https://www.bungie.net/en/Application)
// This key is required by Bungie's API for many endpoints and is safe to include
// as a public API key (do not include client secrets here).
const BUNGIE_API_KEY = 'fee720e84d6c4239aeb7d442b4d39f38';
/**
 * Attempt to fetch basic Bungie profile information and persist it to storage.
 * Returns a Promise that resolves when profile is stored (or null if unavailable).
 */
function fetchAndStoreProfile(accessToken) {
  if (!accessToken) return Promise.resolve(null);
  const headers = Object.assign({ 'Authorization': `Bearer ${accessToken}` }, BUNGIE_API_KEY ? { 'X-API-Key': BUNGIE_API_KEY } : {});

  const membershipsUrl = 'https://www.bungie.net/Platform/User/GetMembershipsForCurrentUser/';
  return fetch(membershipsUrl, { headers })
    .then(res => res.json())
    .then((json) => {
      // Debug: log membership response to help locate picture field
      console.debug('[BUNGIE OAUTH] memberships response', json);
      if (json && json.Response) {
        const resp = json.Response;
        const profile = {};
        // display name may live under bungieNetUser
        if (resp.bungieNetUser && resp.bungieNetUser.displayName) {
          profile.displayName = resp.bungieNetUser.displayName;
        }
        // picture may be in a few places; try known fields
        if (resp.profilePicturePath) profile.profilePicturePath = resp.profilePicturePath;
        if (!profile.profilePicturePath && resp.bungieNetUser && resp.bungieNetUser.profilePicturePath) {
          profile.profilePicturePath = resp.bungieNetUser.profilePicturePath;
        }
        if (!profile.profilePicturePath && resp.bungieNetUser && resp.bungieNetUser.profilePicture) {
          profile.profilePicturePath = resp.bungieNetUser.profilePicture;
        }
        if (profile.displayName || profile.profilePicturePath) {
          // normalize picture path if relative
          if (profile.profilePicturePath && profile.profilePicturePath.startsWith('/')) {
            profile.profilePicturePath = 'https://www.bungie.net' + profile.profilePicturePath;
          }
          return new Promise((resolve) => {
            chrome.storage.local.set({ bungie_profile: profile }, () => {
              chrome.runtime.sendMessage({ type: 'BUNGIE_PROFILE', profile });
              resolve(profile);
            });
          });
        }
      }
      const currentUserUrl = 'https://www.bungie.net/Platform/User/GetBungieNetUser/';
      return fetch(currentUserUrl, { headers }).then(r => r.json()).then((j) => {
        console.debug('[BUNGIE OAUTH] GetBungieNetUser response', j);
        if (j && j.Response) {
          const profile = {
            displayName: j.Response.displayName || j.Response.display_name || j.Response.displayNameCode,
            profilePicturePath: j.Response.profilePicturePath || j.Response.profile_picture || j.Response.profilePicture
          };
          if (profile.profilePicturePath && profile.profilePicturePath.startsWith('/')) {
            profile.profilePicturePath = 'https://www.bungie.net' + profile.profilePicturePath;
          }
          return new Promise((resolve) => {
            chrome.storage.local.set({ bungie_profile: profile }, () => {
              chrome.runtime.sendMessage({ type: 'BUNGIE_PROFILE', profile });
              resolve(profile);
            });
          });
        }
        return null;
      });
    })
    .catch(err => {
      console.warn('[BUNGIE OAUTH] Profile fetch failed:', err);
      return null;
    });
}

// ====== BUNGIE OAUTH MESSAGE HANDLING ======
// Store tokens in chrome.storage.local under 'bungie_oauth'
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // Handle OAuth code from oauth-callback.js
  if (message.type === 'BUNGIE_OAUTH_CODE') {
    // Exchange code for token (must be done from background due to CORS)
    // NOTE: You must fill in your Bungie client_id and client_secret if required
    const clientId = '51511'; // <-- Replace with your Bungie App's client_id
    // Optional: if your Bungie app requires a client secret, set it here.
    // Do NOT commit secrets to source control. Keep client_secret empty for public clients.
    const CLIENT_SECRET = ''; // only if your app requires it (not recommended in extensions)

    const code = message.code;
    const redirectUri = chrome.runtime.getURL('oauth-callback.html');
    const tokenUrl = 'https://www.bungie.net/platform/app/oauth/token/';

    // Build base params for token exchange
    const buildAndSendTokenRequest = (code_verifier) => {
      const data = new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        client_id: clientId,
        redirect_uri: redirectUri
      });
      if (CLIENT_SECRET) data.set('client_secret', CLIENT_SECRET);
      if (code_verifier) data.set('code_verifier', code_verifier);

      const headers = { 'Content-Type': 'application/x-www-form-urlencoded' };
      if (BUNGIE_API_KEY) headers['X-API-Key'] = BUNGIE_API_KEY;

      // Perform the token exchange and provide detailed logging on failure.
      fetch(tokenUrl, {
        method: 'POST',
        headers,
        body: data.toString()
      })
        .then(async (res) => {
          const text = await res.text();
          let parsed;
          try { parsed = JSON.parse(text); } catch (e) { parsed = { raw: text }; }
          if (!res.ok) {
            console.error('[BUNGIE OAUTH] Token exchange failed', res.status, parsed);
            sendResponse({ success: false, status: res.status, error: parsed });
            // Notify UI
            chrome.runtime.sendMessage({ type: 'BUNGIE_OAUTH_STATUS', success: false, error: parsed });
            return;
          }
          // Successful response expected to be JSON with access_token
          return parsed;
        })
        .then((tokenData) => {
          if (!tokenData) return; // previous branch already handled response
          if (tokenData.access_token) {
            // Store token
            chrome.storage.local.set({ bungie_oauth: tokenData }, () => {
              sendResponse({ success: true });
              // Notify UI of login
              chrome.runtime.sendMessage({ type: 'BUNGIE_OAUTH_STATUS', success: true });
                // Attempt to fetch basic profile info using stored token
                try {
                  fetchAndStoreProfile(tokenData.access_token);
                } catch (e) {
                  console.warn('Failed to start profile fetch:', e);
                }
            });
          } else {
            console.error('[BUNGIE OAUTH] Token response missing access_token', tokenData);
            sendResponse({ success: false, error: tokenData });
            chrome.runtime.sendMessage({ type: 'BUNGIE_OAUTH_STATUS', success: false, error: tokenData });
          }
        })
        .catch((err) => {
          console.error('[BUNGIE OAUTH] Token exchange exception', err);
          sendResponse({ success: false, error: String(err) });
          chrome.runtime.sendMessage({ type: 'BUNGIE_OAUTH_STATUS', success: false, error: String(err) });
        });
    };

    // Retrieve PKCE verifier stored at start of flow (if any) and include it in exchange
    chrome.storage.local.get('bungie_pkce', (res) => {
      try {
        const pkceMap = res.bungie_pkce || {};
        const verifier = (message && message.state) ? pkceMap[message.state] : null;
        // If we used the verifier, remove it from storage to avoid reuse
        if (verifier && message && message.state) {
          delete pkceMap[message.state];
          chrome.storage.local.set({ bungie_pkce: pkceMap });
        }
        buildAndSendTokenRequest(verifier);
      } catch (e) {
        console.warn('Error retrieving PKCE verifier:', e);
        buildAndSendTokenRequest(null);
      }
    });
    // Indicate async response
    return true;
  }
  // Check login status
  if (message.type === 'BUNGIE_OAUTH_CHECK') {
    chrome.storage.local.get('bungie_oauth', (result) => {
      if (result.bungie_oauth && result.bungie_oauth.access_token) {
        sendResponse({ loggedIn: true });
      } else {
        sendResponse({ loggedIn: false });
      }
    });
    return true;
  }
  // Provide stored profile or attempt fetch if missing
  if (message.type === 'BUNGIE_PROFILE_REQUEST') {
    chrome.storage.local.get(['bungie_profile', 'bungie_oauth'], (res) => {
      const profile = res.bungie_profile;
      if (profile) {
        sendResponse({ profile });
        return;
      }
      const token = res.bungie_oauth && res.bungie_oauth.access_token;
      if (!token) {
        sendResponse({ profile: null });
        return;
      }
      // Attempt to fetch profile and respond when done
      fetchAndStoreProfile(token).then(() => {
        chrome.storage.local.get('bungie_profile', (r2) => {
          sendResponse({ profile: r2.bungie_profile || null });
        });
      }).catch(() => {
        sendResponse({ profile: null });
      });
    });
    return true;
  }
  // Request inventory/vault counts. The background performs authenticated
  // requests to Bungie using the stored OAuth token and the API key.
  if (message.type === 'BUNGIE_REQUEST_INVENTORY_COUNTS') {
    console.log('[BUNGIE INVENTORY] received request for inventory counts');
    chrome.storage.local.get(['bungie_oauth'], async (res) => {
      const token = res && res.bungie_oauth && res.bungie_oauth.access_token;
      if (!token) {
        sendResponse({ success: false, error: 'Not logged in' });
        return;
      }

      const headers = Object.assign({ 'Authorization': `Bearer ${token}` }, BUNGIE_API_KEY ? { 'X-API-Key': BUNGIE_API_KEY } : {});

      try {
        const membershipsUrl = 'https://www.bungie.net/Platform/User/GetMembershipsForCurrentUser/';
        const msRes = await fetch(membershipsUrl, { headers });
        const msText = await msRes.text();
        let msJson = null;
        try {
          msJson = JSON.parse(msText);
        } catch (e) {
          console.warn('[BUNGIE OAUTH] memberships response not JSON', { status: msRes.status, text: msText.slice(0, 200) });
          msJson = null;
        }
        const destinyMemberships = (msJson && msJson.Response && msJson.Response.destinyMemberships) || [];

        // Counts aggregated across all destiny memberships
        let totalWeapons = 0;
        let totalArmor = 0;
        let inventoryWeapons = 0; // weapons in character inventories (inventory)
        let inventoryArmor = 0;   // armor in character inventories
        let vaultWeapons = 0;     // weapons in the profile/vault
        let vaultArmor = 0;       // armor in the profile/vault

        // We'll collect item entries first, quickly classify when itemType is present,
        // and for unresolved entries try to resolve via manifest lookups using itemHash.
        const itemsToResolve = [];
        const manifestDefCache = new Map();

        function quickClassifyItem(item, contextPath) {
          const itype = item && (item.itemType || item.itemTypeId || item.type || null);
          const path = (contextPath || '').toLowerCase();
          const isCharacter = path.includes('character') || path.includes('characterinventories') || path.includes('characterequipment');
          const isVault = !isCharacter && (path.includes('profile') || path.includes('profileinventory') || path.includes('profileinventories') || path.includes('vault'));
          if (itype !== null && typeof itype !== 'undefined') {
            const isWeapon = (itype === 3);
            const isArmor = (itype === 2 || itype === 4 || itype === 5);
            if (isWeapon) {
              totalWeapons++;
              if (isCharacter) inventoryWeapons++;
              else if (isVault) vaultWeapons++;
            }
            if (isArmor) {
              totalArmor++;
              if (isCharacter) inventoryArmor++;
              else if (isVault) vaultArmor++;
            }
            return true;
          }
          return false;
        }

        // Generic recursive scanner that gathers candidate item objects
        function scanForItems(obj, path) {
          if (!obj || typeof obj !== 'object') return;
          if (Array.isArray(obj)) {
            for (const el of obj) {
              if (el && (el.itemHash || el.itemInstanceId || el.itemId)) {
                // prefer itemHash; keep the raw element + path for later resolution
                itemsToResolve.push({ el, path });
              } else {
                scanForItems(el, path);
              }
            }
            return;
          }
          for (const k of Object.keys(obj)) {
            const v = obj[k];
            const childPath = path ? path + '/' + k : k;
            scanForItems(v, childPath);
          }
        }

        // Storage helpers for manifest cache
        function storageGet(key) {
          return new Promise((resolve) => {
            try {
              chrome.storage.local.get(key, (res) => resolve(res && res[key]));
            } catch (e) { resolve(null); }
          });
        }
        function storageSet(obj) {
          return new Promise((resolve) => {
            try {
              chrome.storage.local.set(obj, () => resolve());
            } catch (e) { resolve(); }
          });
        }

        // Network fetch for a single manifest item definition
        async function fetchManifestDefNetwork(hash) {
          const key = String(hash);
          if (manifestDefCache.has(key)) return manifestDefCache.get(key);
          try {
            const url = `https://www.bungie.net/Platform/Destiny2/Manifest/DestinyInventoryItemDefinition/${key}/`;
            const r = await fetch(url, { headers });
            const text = await r.text();
            let j = null;
            try { j = JSON.parse(text); } catch (e) { j = null; }
            const def = j && j.Response ? j.Response : null;
            manifestDefCache.set(key, def);
            return def;
          } catch (e) {
            manifestDefCache.set(key, null);
            return null;
          }
        }

        function classifyByDef(def) {
          if (!def) return null;
          const itype = def.itemType || def.itemTypeEnum || def.itemTypeHash || null;
          if (itype === 3) return 'weapon';
          if (itype === 2 || itype === 4 || itype === 5) return 'armor';
          const dname = (def.itemTypeDisplayName || '').toLowerCase();
          if (dname.includes('weapon')) return 'weapon';
          if (dname.includes('armor')) return 'armor';
          return null;
        }

        // Fetch profiles and gather items
        for (const m of destinyMemberships) {
          const membershipType = m.membershipType;
          const membershipId = m.membershipId;
          // Request a broader set of components including profile-level inventories
          // to ensure vault/profile items are returned. This may increase payload size.
          const profileUrl = `https://www.bungie.net/Platform/Destiny2/${membershipType}/Profile/${membershipId}/?components=100,101,102,103,200,201,202,204,205,300,301,302,304,305`;
          try {
            const pRes = await fetch(profileUrl, { headers });
            const pText = await pRes.text();
            let pJson = null;
            try {
              pJson = JSON.parse(pText);
            } catch (e) {
              console.warn('[BUNGIE OAUTH] profile response not JSON', { membership: m, status: pRes.status, text: pText.slice(0,200) });
              pJson = null;
            }
            if (pJson && pJson.Response) {
              try {
                console.log('[BUNGIE INVENTORY] profile response keys', Object.keys(pJson.Response));
              } catch (e) { /* ignore logging errors */ }
              scanForItems(pJson.Response, 'response');
            }
          } catch (e) {
            console.warn('Profile fetch failed for membership', m, e);
          }
        }

        // First pass: quickly classify any items that already include an itemType
        const unresolved = [];
        for (const entry of itemsToResolve) {
          const { el, path } = entry;
          const ok = quickClassifyItem(el, path);
          if (!ok) unresolved.push(entry);
        }

        // Build unique list of hashes to fetch
        const hashSet = new Set();
        for (const { el } of unresolved) {
          if (el && el.itemHash) hashSet.add(String(el.itemHash));
        }
        const hashes = Array.from(hashSet);

        // Load any previously cached manifest defs from storage to avoid refetching
        const storedCache = (await storageGet('manifest_item_defs')) || {};
        for (const [k, v] of Object.entries(storedCache)) {
          try { manifestDefCache.set(String(k), v); } catch (e) { /* ignore */ }
        }

        // Determine which hashes still need network fetch
        const toFetch = hashes.filter(h => !manifestDefCache.has(String(h)) || manifestDefCache.get(String(h)) === null);

        // Bounded parallel fetch to avoid long sequential runs that the service worker may not survive
        const CONCURRENCY = 6;
        let idx = 0;
        async function worker() {
          while (idx < toFetch.length) {
            const i = idx++;
            const h = toFetch[i];
            try {
              // eslint-disable-next-line no-await-in-loop
              await fetchManifestDefNetwork(h);
            } catch (e) {
              // ignore individual fetch errors; they'll remain unresolved
            }
          }
        }
        const workers = [];
        for (let i = 0; i < Math.min(CONCURRENCY, toFetch.length); i++) workers.push(worker());
        await Promise.all(workers);

        // Persist updated cache back to chrome.storage.local to speed up future runs
        try {
          const persist = {};
          for (const [k, v] of manifestDefCache.entries()) persist[k] = v;
          await storageSet({ manifest_item_defs: persist });
        } catch (e) {
          console.warn('[BUNGIE INVENTORY] failed to persist manifest cache', e);
        }

        // If many hashes still unresolved, attempt to download the full DestinyInventoryItemDefinition
        // component and extract missing definitions in one shot (more reliable than per-hash endpoints).
        const stillMissing = hashes.filter(h => !manifestDefCache.has(String(h)) || manifestDefCache.get(String(h)) === null);
        if (stillMissing.length > 0) {
          try {
            console.log('[BUNGIE INVENTORY] fetching full manifest component for', stillMissing.length, 'missing hashes');
            // Fetch manifest meta
            const metaRes = await fetch('https://www.bungie.net/Platform/Destiny2/Manifest/', { headers: { 'X-API-Key': BUNGIE_API_KEY, 'Accept': 'application/json' } });
            if (metaRes.ok) {
              const meta = await metaRes.json();
              const lang = 'en';
              const compPath = meta.jsonWorldComponentContentPaths?.[lang]?.DestinyInventoryItemDefinition || meta.jsonWorldContentPaths?.[lang];
              if (compPath) {
                let url = compPath;
                if (!url.startsWith('http')) url = 'https://www.bungie.net' + url;
                const compRes = await fetch(url, { headers: { 'Accept': 'application/json' } });
                if (compRes.ok) {
                  const text = await compRes.text();
                  let parsed = null;
                  try { parsed = JSON.parse(text); } catch (e) { parsed = null; }
                  const defsObj = parsed && parsed.DestinyInventoryItemDefinition ? parsed.DestinyInventoryItemDefinition : parsed;
                  if (defsObj) {
                    let added = 0;
                    for (const h of stillMissing) {
                      const key = String(h);
                      if (defsObj[key]) {
                        manifestDefCache.set(key, defsObj[key]);
                        added++;
                      }
                    }
                    if (added > 0) {
                      console.log('[BUNGIE INVENTORY] added', added, 'defs from manifest component');
                      // persist merged cache
                      const persist2 = {};
                      for (const [k, v] of manifestDefCache.entries()) persist2[k] = v;
                      await storageSet({ manifest_item_defs: persist2 });
                    }
                  }
                } else {
                  console.warn('[BUNGIE INVENTORY] manifest component fetch failed', compRes.status);
                }
              } else {
                console.warn('[BUNGIE INVENTORY] manifest meta did not include expected paths');
              }
            } else {
              console.warn('[BUNGIE INVENTORY] manifest meta fetch failed', metaRes.status);
            }
          } catch (e) {
            console.warn('[BUNGIE INVENTORY] full manifest fetch failed', e);
          }
        }

        // Classify unresolved items using fetched defs
        for (const entry of unresolved) {
          const { el, path } = entry;
          const tpath = (path || '').toLowerCase();
          const isCharacter = tpath.includes('character') || tpath.includes('characterinventories') || tpath.includes('characterequipment');
          const isVault = !isCharacter && (tpath.includes('profile') || tpath.includes('profileinventory') || tpath.includes('profileinventories') || tpath.includes('vault'));
          const hash = el && el.itemHash ? String(el.itemHash) : null;
          const def = hash ? manifestDefCache.get(hash) : null;
          const kind = def ? classifyByDef(def) : null;
          if (kind === 'weapon') {
            totalWeapons++;
            if (isCharacter) inventoryWeapons++;
            else if (isVault) vaultWeapons++;
          } else if (kind === 'armor') {
            totalArmor++;
            if (isCharacter) inventoryArmor++;
            else if (isVault) vaultArmor++;
          }
        }

        // Debugging info: log counts and unresolved sample to help diagnose zero counts
        try {
          const sampleUnresolved = unresolved.slice(0, 10).map(e => ({ hash: e.el && e.el.itemHash ? String(e.el.itemHash) : null, path: e.path }));
          console.log('[BUNGIE INVENTORY] counts', {
            totalWeapons,
            totalArmor,
            inventoryWeapons,
            inventoryArmor,
            vaultWeapons,
            vaultArmor,
            scannedItems: itemsToResolve.length,
            unresolved: unresolved.length,
            sampleUnresolved
          });
        } catch (e) {
          console.warn('[BUNGIE INVENTORY] logging failed', e);
        }

        sendResponse({ success: true, counts: {
          weapons: totalWeapons,
          armor: totalArmor,
          inventoryWeapons,
          inventoryArmor,
          vaultWeapons,
          vaultArmor
        }});
      } catch (err) {
        console.error('Error fetching inventory counts', err);
        sendResponse({ success: false, error: String(err) });
      }
    });
    return true;
  }
  // Logout handling: remove stored token and notify UI
  if (message.type === 'BUNGIE_OAUTH_LOGOUT') {
    chrome.storage.local.remove(['bungie_oauth','bungie_profile'], () => {
      chrome.runtime.sendMessage({ type: 'BUNGIE_OAUTH_STATUS', success: false });
      chrome.runtime.sendMessage({ type: 'BUNGIE_PROFILE', profile: null });
      sendResponse({ success: true });
    });
    return true;
  }
});