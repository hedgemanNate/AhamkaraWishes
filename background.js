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

        // Helper: classify a single item object
        function classifyItem(item, contextPath) {
          // Heuristic: many Destiny item objects include `itemType` where
          // 3 === Weapon in common mappings. Armor types vary; we check a
          // few likely values. This heuristic may need refinement with
          // mapping from the manifest for perfect accuracy.
          const itype = item && (item.itemType || item.itemTypeId || item.type || null);
          const isWeapon = (itype === 3);
          const isArmor = (itype === 2 || itype === 4 || itype === 5);

          if (isWeapon) totalWeapons++;
          if (isArmor) totalArmor++;

          // Determine if this item comes from a character (inventory) or profile (vault)
          const path = (contextPath || '').toLowerCase();
          const isCharacter = path.includes('character') || path.includes('characterinventories') || path.includes('characterequipment');
          if (isCharacter && isWeapon) inventoryWeapons++;
          if (isCharacter && isArmor) inventoryArmor++;
        }

        // Generic recursive scanner that looks for arrays of objects that look like items
        function scanForItems(obj, path) {
          if (!obj || typeof obj !== 'object') return;
          if (Array.isArray(obj)) {
            // possible item array
            for (const el of obj) {
              if (el && (el.itemHash || el.itemInstanceId || el.itemId)) {
                classifyItem(el, path);
              } else {
                scanForItems(el, path);
              }
            }
            return;
          }
          // Object: traverse properties
          for (const k of Object.keys(obj)) {
            const v = obj[k];
            const childPath = path ? path + '/' + k : k;
            scanForItems(v, childPath);
          }
        }

        // For each destiny membership, fetch a broad profile payload that
        // includes profile and character inventories to cover vault + inventory.
        // NOTE: the `components` numeric mask may be tuned to reduce payload.
        for (const m of destinyMemberships) {
          const membershipType = m.membershipType;
          const membershipId = m.membershipId;
          const profileUrl = `https://www.bungie.net/Platform/Destiny2/${membershipType}/Profile/${membershipId}/?components=204,205,300,301,302,304,305`;
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
              scanForItems(pJson.Response, 'response');
            }
          } catch (e) {
            console.warn('Profile fetch failed for membership', m, e);
          }
        }

        sendResponse({ success: true, counts: {
          weapons: totalWeapons,
          armor: totalArmor,
          inventoryWeapons,
          inventoryArmor
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