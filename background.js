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
    const clientId = 'YOUR_BUNGIE_CLIENT_ID'; // <-- Replace with your Bungie App's client_id
    const code = message.code;
    const redirectUri = chrome.runtime.getURL('oauth-callback.html');
    const tokenUrl = 'https://www.bungie.net/platform/app/oauth/token/';
    const data = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      client_id: clientId,
      redirect_uri: redirectUri
    });
    fetch(tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: data.toString()
    })
      .then(res => res.json())
      .then(tokenData => {
        if (tokenData.access_token) {
          // Store token
          chrome.storage.local.set({ bungie_oauth: tokenData }, () => {
            sendResponse({ success: true });
            // Optionally, notify UI of login
            chrome.runtime.sendMessage({ type: 'BUNGIE_OAUTH_STATUS', success: true });
          });
        } else {
          sendResponse({ success: false });
        }
      })
      .catch(() => sendResponse({ success: false }));
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
});