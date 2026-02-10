/*
 * bungie-auth.js
 * Responsible for the UI wiring of Bungie OAuth from the Menu view.
 * All authentication logic is isolated to this file and communicates
 * with the extension background via messages so existing app code is unaffected.
 *
 * IMPORTANT: Replace `BUNGIE_CLIENT_ID` with your Bungie App client id.
 * For production/secure flows, implement PKCE and do not include a client secret.
 */

// CONFIG: replace with your registered Bungie client id
const BUNGIE_CLIENT_ID = '51511';

// DOM ids used in sidepanel.html
const AUTH_STATUS_ID = 'bungie-auth-status';
const AUTH_CONTAINER_ID = 'bungie-auth-container';
const LOGIN_BTN_ID = 'bungie-login-btn';
const LOGOUT_BTN_ID = 'bungie-logout-btn';
const USER_INFO_ID = 'bungie-user-info';

/** Helper: update auth status text in the Menu view. */
function setAuthStatus(text) {
  const el = document.getElementById(AUTH_STATUS_ID);
  if (el) el.textContent = text;
}

/** Helper: show/hide login/logout buttons */
function toggleAuthButtons(loggedIn) {
  const loginBtn = document.getElementById(LOGIN_BTN_ID);
  const logoutBtn = document.getElementById(LOGOUT_BTN_ID);
  if (loginBtn) loginBtn.style.display = loggedIn ? 'none' : '';
  if (logoutBtn) logoutBtn.style.display = loggedIn ? '' : 'none';
}

/** Initialize auth UI: wire up buttons and request current status from background */
function initAuthUI() {
  const loginBtn = document.getElementById(LOGIN_BTN_ID);
  const logoutBtn = document.getElementById(LOGOUT_BTN_ID);

  if (loginBtn) {
    loginBtn.addEventListener('click', (e) => {
      e.preventDefault();
      startLoginFlow();
    });
  }

  if (logoutBtn) {
    logoutBtn.addEventListener('click', (e) => {
      e.preventDefault();
      logout();
    });
  }

  // Listen for status messages from background
  if (chrome && chrome.runtime && chrome.runtime.onMessage) {
    chrome.runtime.onMessage.addListener((message) => {
      if (message && message.type === 'BUNGIE_OAUTH_STATUS') {
        if (message.success) {
          setAuthStatus('Logged in');
          toggleAuthButtons(true);
          // Optionally request more user info here
        } else {
          setAuthStatus('Not logged in');
          toggleAuthButtons(false);
        }
      }
    });
  }

  // Check current login state
  if (chrome && chrome.runtime && chrome.runtime.sendMessage) {
    chrome.runtime.sendMessage({ type: 'BUNGIE_OAUTH_CHECK' }, (resp) => {
      if (resp && resp.loggedIn) {
        setAuthStatus('Logged in');
        toggleAuthButtons(true);
      } else {
        setAuthStatus('Not logged in');
        toggleAuthButtons(false);
      }
    });
  }
}

/** Start the Bungie OAuth flow by opening the authorization URL in a new tab */
function startLoginFlow() {
  if (!BUNGIE_CLIENT_ID || BUNGIE_CLIENT_ID === 'YOUR_BUNGIE_CLIENT_ID') {
    alert('Please set BUNGIE_CLIENT_ID in bungie-auth.js with your Bungie app client id.');
    return;
  }

  const redirectUri = chrome.runtime.getURL('oauth-callback.html');
  const state = Math.random().toString(36).substring(2, 12);
  const authorizeUrl = new URL('https://www.bungie.net/en/OAuth/Authorize');
  authorizeUrl.searchParams.set('client_id', BUNGIE_CLIENT_ID);
  authorizeUrl.searchParams.set('response_type', 'code');
  authorizeUrl.searchParams.set('state', state);
  authorizeUrl.searchParams.set('redirect_uri', redirectUri);

  // NOTE: For improved security, implement PKCE: add code_challenge & code_challenge_method

  window.open(authorizeUrl.toString(), '_blank', 'noopener');
}

/** Logout locally by removing stored token and updating UI */
function logout() {
  if (chrome && chrome.storage && chrome.storage.local) {
    chrome.storage.local.remove('bungie_oauth', () => {
      setAuthStatus('Not logged in');
      toggleAuthButtons(false);
      const userEl = document.getElementById(USER_INFO_ID);
      if (userEl) userEl.textContent = '';
      // Notify background or other parts if necessary
      if (chrome && chrome.runtime && chrome.runtime.sendMessage) {
        chrome.runtime.sendMessage({ type: 'BUNGIE_OAUTH_LOGOUT' });
      }
    });
  }
}

// Initialize when DOM is ready and when inside the sidepanel Menu view
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initAuthUI);
} else {
  initAuthUI();
}

// Exports for testing / external usage (optional)
window.__bungieAuth = { startLoginFlow, logout };
