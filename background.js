// Allows users to open the side panel by clicking the action toolbar icon
chrome.sidePanel
  .setPanelBehavior({ openPanelOnActionClick: true })
  .catch((error) => console.error(error));

chrome.runtime.onInstalled.addListener(() => {
  console.log("Ahamkara Wishes installed.");
});

// ====== BUNGIE OAUTH MESSAGE HANDLING ======
// Store tokens in chrome.storage.local under 'bungie_oauth'
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // Handle OAuth code from oauth-callback.js
  if (message.type === 'BUNGIE_OAUTH_CODE') {
    // Exchange code for token (must be done from background due to CORS)
    // NOTE: You must fill in your Bungie client_id and client_secret if required
    const clientId = '51511'; // <-- Replace with your Bungie App's client_id
    // Optional: if your Bungie app requires an API key or client secret, set them here.
    // Do NOT commit secrets to source control. Keep client_secret empty for public clients.
    const BUNGIE_API_KEY = ''; // e.g. 'xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx'
    const CLIENT_SECRET = ''; // only if your app requires it (not recommended in extensions)

    const code = message.code;
    const redirectUri = chrome.runtime.getURL('oauth-callback.html');
    const tokenUrl = 'https://www.bungie.net/platform/app/oauth/token/';

    const data = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      client_id: clientId,
      redirect_uri: redirectUri
    });
    if (CLIENT_SECRET) data.set('client_secret', CLIENT_SECRET);

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
  // Logout handling: remove stored token and notify UI
  if (message.type === 'BUNGIE_OAUTH_LOGOUT') {
    chrome.storage.local.remove('bungie_oauth', () => {
      chrome.runtime.sendMessage({ type: 'BUNGIE_OAUTH_STATUS', success: false });
      sendResponse({ success: true });
    });
    return true;
  }
});