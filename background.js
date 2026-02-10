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
      if (json && json.Response) {
        const resp = json.Response;
        const profile = {};
        if (resp.bungieNetUser && resp.bungieNetUser.displayName) {
          profile.displayName = resp.bungieNetUser.displayName;
        }
        if (resp.profilePicturePath) profile.profilePicturePath = resp.profilePicturePath;
        if (profile.displayName) {
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
        if (j && j.Response) {
          const profile = {
            displayName: j.Response.displayName || j.Response.display_name,
            profilePicturePath: j.Response.profilePicturePath || j.Response.profile_picture
          };
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
  // Logout handling: remove stored token and notify UI
  if (message.type === 'BUNGIE_OAUTH_LOGOUT') {
    chrome.storage.local.remove('bungie_oauth', () => {
      chrome.runtime.sendMessage({ type: 'BUNGIE_OAUTH_STATUS', success: false });
      sendResponse({ success: true });
    });
    return true;
  }
});