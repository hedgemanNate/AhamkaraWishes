/*
 * oauth-callback.js
 * Runs inside oauth-callback.html — parses the redirect URL for the authorization
 * code and forwards it to the background service worker to exchange for tokens.
 * This page is intentionally minimal and only used as the redirect URI.
 */

function parseQuery() {
  return new URLSearchParams(window.location.search);
}

function finish(statusText) {
  const el = document.getElementById('status');
  if (el) el.textContent = statusText;
}

function main() {
  const params = parseQuery();
  const code = params.get('code');
  const state = params.get('state');

  if (!code) {
    finish('No authorization code found in callback URL.');
    return;
  }

  // Send the code to background.js which performs the token exchange.
  if (chrome && chrome.runtime && chrome.runtime.sendMessage) {
    chrome.runtime.sendMessage({ type: 'BUNGIE_OAUTH_CODE', code, state }, (resp) => {
      // Provide detailed error information to aid debugging
      if (resp && resp.success) {
        finish('Login successful — you may close this tab.');
      } else {
        // Prefer structured error info when available
        let details = 'Unknown error';
        try {
          if (resp && resp.error) {
            details = typeof resp.error === 'string' ? resp.error : JSON.stringify(resp.error);
          } else if (resp && resp.status) {
            details = `HTTP ${resp.status}` + (resp.error ? `: ${JSON.stringify(resp.error)}` : '');
          }
        } catch (e) {
          details = String(resp?.error || resp) || 'Unknown error';
        }
        console.error('[OAUTH CALLBACK] Token exchange failed:', resp);
        finish('Login failed during token exchange — ' + details);
      }
      // Optionally auto-close the window after a short delay
      setTimeout(() => {
        try { window.close(); } catch (e) {}
      }, 2200);
    });
  } else {
    finish('Unable to contact extension runtime.');
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', main);
} else {
  main();
}
