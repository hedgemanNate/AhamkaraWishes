// Bungie PKCE Auth helper for Ahamkara Wishes
// Uses client_id and redirect URI provided by user.

const BUNGIE_OAUTH = {
  client_id: '51511',
  redirect_uri: 'https://kbbcefcmkpkmmalappllbcklhmlcoajc.chromiumapp.org/bungie-oauth-callback.html',
  auth_endpoint: 'https://www.bungie.net/en/oauth/authorize',
  token_endpoint: 'https://www.bungie.net/platform/app/oauth/token'
};

function base64url(buffer) {
  return btoa(String.fromCharCode.apply(null, new Uint8Array(buffer)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function sha256(input) {
  const enc = new TextEncoder();
  const data = enc.encode(input);
  const hash = await crypto.subtle.digest('SHA-256', data);
  return new Uint8Array(hash);
}

function makeVerifier(len = 64) {
  const arr = new Uint8Array(len);
  crypto.getRandomValues(arr);
  return base64url(arr);
}

async function makeChallenge(verifier) {
  const hashed = await sha256(verifier);
  return base64url(hashed);
}

async function launchAuthFlow() {
  const verifier = makeVerifier();
  const challenge = await makeChallenge(verifier);
  const state = Math.random().toString(36).slice(2);

  const params = new URLSearchParams({
    client_id: BUNGIE_OAUTH.client_id,
    response_type: 'code',
    redirect_uri: BUNGIE_OAUTH.redirect_uri,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    state
  });

  // NOTE: Bungie requires scopes to be configured on the application in the
  // Developer Portal. Do not force `scope` here if the app is configured to
  // provide scopes automatically. Leave scope configuration to the app's
  // registration so the server enforces allowed scopes.

  const authUrl = `${BUNGIE_OAUTH.auth_endpoint}?${params.toString()}`;

  // Persist verifier for exchange
  await new Promise((res) => chrome.storage.local.set({ bungie_pkce_verifier: verifier }, res));

  return new Promise((resolve, reject) => {
    if (chrome && chrome.identity && chrome.identity.launchWebAuthFlow) {
        console.log('[BUNGIE-AUTH] launching auth URL', authUrl);
        // Start a short-lived poll that tries to locate the auth popup window
        // and resize it to approximately 1/6 of the monitor area (centered).
        // This does not change the auth flow; it only adjusts the popup window
        // that `launchWebAuthFlow` opens.
        let pollTimer = null;
        const stopPoll = () => { if (pollTimer) { clearInterval(pollTimer); pollTimer = null; } };

        function tryResizeAuthWindow() {
          try {
            chrome.windows.getAll({ populate: true }, (wins) => {
              if (!wins || !wins.length) return;
              for (const w of wins) {
                if (!w.tabs) continue;
                for (const t of w.tabs) {
                  try {
                    const url = t && t.url ? String(t.url) : '';
                    if (url.includes('bungie.net/en/oauth/authorize')) {
                      // Compute size so the popup area is ~1/6 of the screen area
                      const availW = (screen && screen.availWidth) ? screen.availWidth : window.innerWidth || 1280;
                      const availH = (screen && screen.availHeight) ? screen.availHeight : window.innerHeight || 800;
                      const ratio = 1 / Math.sqrt(6); // width and height scale so area ~= 1/6
                      const newW = Math.max(320, Math.round(availW * ratio));
                      const newH = Math.max(360, Math.round(availH * ratio));
                      const left = Math.max(0, Math.round((availW - newW) / 2));
                      const top = Math.max(0, Math.round((availH - newH) / 4));
                      try {
                        chrome.windows.update(w.id, { left, top, width: newW, height: newH }, () => { /* ignore errors */ });
                      } catch (e) { /* ignore update errors */ }
                      stopPoll();
                      return;
                    }
                  } catch (e) { /* ignore per-tab errors */ }
                }
              }
            });
          } catch (e) { /* ignore */ }
        }

        // Start polling shortly before/after launching the flow; stop after 6s if not found
        pollTimer = setInterval(tryResizeAuthWindow, 250);
        setTimeout(stopPoll, 6000);

        chrome.identity.launchWebAuthFlow({ url: authUrl, interactive: true }, (redirectUrl) => {
          stopPoll();
          if (chrome.runtime.lastError) return reject(chrome.runtime.lastError);
          console.log('[BUNGIE-AUTH] launchWebAuthFlow returned redirect URL', redirectUrl);
          resolve(redirectUrl);
        });
    } else {
      // Running outside of Chrome extension context — the registered redirect URI
      // (https://<app-id>.chromiumapp.org/...) is not resolvable from a normal
      // browser window. Provide a clear error so the caller can surface it.
      const err = new Error('chrome.identity.launchWebAuthFlow is not available.\n' +
        'Sign-in must be performed from the Chrome/Chromium extension (load as an unpacked extension) so the OAuth redirect URI is handled by the platform.');
      reject(err);
    }
  });
}

async function exchangeCodeForToken(code) {
  console.log('[BUNGIE-AUTH] exchangeCodeForToken start');
  const obj = await new Promise((res) => chrome.storage.local.get(['bungie_pkce_verifier'], res));
  const verifier = obj.bungie_pkce_verifier;
  if (!verifier) throw new Error('Missing PKCE verifier');

  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    client_id: BUNGIE_OAUTH.client_id,
    code_verifier: verifier,
    redirect_uri: BUNGIE_OAUTH.redirect_uri
  });

  const resp = await fetch(BUNGIE_OAUTH.token_endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'X-API-Key': (typeof API_KEY !== 'undefined') ? API_KEY : ''
    },
    body: body.toString()
  });
  const text = await resp.text();
  console.log('[BUNGIE-AUTH] token endpoint returned status', resp.status);
  let parsed = null;
  try { parsed = JSON.parse(text); } catch (e) { /* not json */ }
  if (!resp.ok) {
    console.error('[BUNGIE-AUTH] token exchange response', resp.status, text);
    const serverMsg = parsed?.error_description || parsed?.error || text;
    throw new Error('Token exchange failed: ' + resp.status + ' - ' + serverMsg);
  }
  return parsed || JSON.parse(text);
}

async function fetchBungieUser(accessToken) {
  const resp = await fetch('https://www.bungie.net/platform/User/GetBungieNetUser/', {
    headers: { 'Authorization': `Bearer ${accessToken}`, 'X-API-Key': (typeof API_KEY !== 'undefined') ? API_KEY : '' }
  });
  const text = await resp.text();
  let parsed = null;
  try { parsed = JSON.parse(text); } catch (e) { /* not json */ }
  console.debug('[BUNGIE-AUTH] GetBungieNetUser status:', resp.status, 'body:', parsed || text);
  if (!resp.ok) {
    console.error('[BUNGIE-AUTH] GetBungieNetUser failed', resp.status, text);
    const serverMsg = parsed?.Message || parsed?.error_description || parsed?.error || text;
    // If Bungie indicates a missing application scope, include instructions
    if (parsed && parsed.ErrorStatus === 'AccessNotPermittedByApplicationScope' && parsed.MessageData && parsed.MessageData.RequiredScope) {
      const required = parsed.MessageData.RequiredScope;
      const msg = `Access not permitted by application scope. The application must be authorized for the '${required}' scope in the Bungie Developer Portal.`;
      throw new Error('GetBungieNetUser failed: ' + resp.status + ' - ' + msg + ' (server: ' + serverMsg + ')');
    }
    throw new Error('GetBungieNetUser failed: ' + resp.status + ' - ' + serverMsg);
  }
  // If we got a valid response object, return Response; otherwise return parsed raw
  if (parsed && typeof parsed === 'object') {
    return parsed.Response || parsed;
  }
  return null;
}

async function signIn() {
  try {
    const redirect = await launchAuthFlow();
    console.log('[BUNGIE-AUTH] auth redirect received:', redirect);
    if (!redirect) throw new Error('No redirect returned from auth flow');
    const u = new URL(redirect);
    let code = u.searchParams.get('code');
    // Some providers return params in the hash fragment instead of search
    if (!code && u.hash) {
      try {
        const hashParams = new URLSearchParams(u.hash.replace(/^#/, ''));
        code = hashParams.get('code') || code;
        if (!code && hashParams.get('error')) {
          const errDesc = hashParams.get('error_description') || hashParams.get('error');
          throw new Error('OAuth error from redirect (hash): ' + (errDesc || hashParams.get('error')));
        }
      } catch (e) {
        console.warn('[BUNGIE-AUTH] failed to parse hash params', e);
      }
    }

    // If still no code, check for an error param in the query string
    if (!code && u.searchParams.get('error')) {
      const err = u.searchParams.get('error_description') || u.searchParams.get('error');
      throw new Error('OAuth error from redirect: ' + err);
    }

    if (!code) {
      throw new Error('No code returned — full redirect: ' + redirect);
    }
      console.log('[BUNGIE-AUTH] authorization code:', code);
      console.log('[BUNGIE-AUTH] beginning token exchange');
      const tokenResp = await exchangeCodeForToken(code);
      console.log('[BUNGIE-AUTH] token exchange response:', tokenResp);
    const access = tokenResp.access_token;
    const refresh = tokenResp.refresh_token;
    const expiry = Date.now() + (Number(tokenResp.expires_in || 3600) * 1000);

    const user = await fetchBungieUser(access).catch(() => null);

    const store = { bungie_auth: { access_token: access, refresh_token: refresh, expires_at: expiry, user } };
    await new Promise((res) => chrome.storage.local.set(store, res));
    updateAuthUI(store.bungie_auth);
    // Toggle Menu view banner signed-in state
    try {
      const doc = (typeof document !== 'undefined') ? document : null;
      if (doc) {
        const view = doc.getElementById('view-menu');
        if (view) view.classList.add('signed-in');
      }
    } catch (e) {
      console.warn('[BUNGIE-AUTH] could not toggle signed-in banner', e);
    }
    return store.bungie_auth;
  } catch (e) {
    console.error('[BUNGIE-AUTH] signIn failed', e);
    throw e;
  }
}

async function signOut() {
  await new Promise((res) => chrome.storage.local.remove(['bungie_auth', 'bungie_pkce_verifier'], res));
  updateAuthUI(null);
}

async function updateAuthUI(auth) {
  const btn = document.getElementById('btn-signin');
  const name = document.getElementById('user-name');
  const avatar = document.getElementById('user-avatar');
  const signout = document.getElementById('btn-signout');
  const view = document.getElementById('view-menu');

  if (!btn || !name || !avatar) return;

  // If we have an auth object but no user payload, try fetching it
  if (auth && !auth.user && auth.access_token) {
    try {
      const fetched = await fetchBungieUser(auth.access_token).catch(() => null);
      if (fetched) {
        auth.user = fetched;
        // persist the user onto the stored auth object
        await new Promise((res) => chrome.storage.local.set({ bungie_auth: auth }, res));
      }
    } catch (e) {
      console.warn('[BUNGIE-AUTH] failed to fetch user during updateAuthUI', e);
    }
  }

  const user = auth && auth.user ? auth.user : null;
  console.debug('[BUNGIE-AUTH] updateAuthUI user:', user);

  if (user) {
    // The Bungie user payload sometimes nests the actual profile under `user.user`.
    const profile = user.user || user;

    // Determine display name from multiple possible fields
    const displayName = profile.displayName || profile.uniqueName || profile.cachedBungieGlobalDisplayName || profile.gamerTag || profile.steamDisplayName || profile.xboxDisplayName || profile.bnetDisplayName || 'You';

    // Determine avatar path from common fields
    let avatarPath = null;
    if (profile.profilePicturePath) avatarPath = profile.profilePicturePath;
    else if (profile.ProfilePicturePath) avatarPath = profile.ProfilePicturePath;
    else if (profile.profile && profile.profile.profilePicturePath) avatarPath = profile.profile.profilePicturePath;
    else if (profile.profile && profile.profile.data && profile.profile.data.userInfo && profile.profile.data.userInfo.profilePicturePath) avatarPath = profile.profile.data.userInfo.profilePicturePath;
    else if (profile.profile && profile.profile.userInfo && profile.profile.userInfo.profilePicturePath) avatarPath = profile.profile.userInfo.profilePicturePath;

    name.textContent = displayName;
    avatar.src = avatarPath ? (`${BUNGIE_ROOT}${avatarPath}`) : 'icons/unnamed.jpg';

    btn.classList.add('hidden');
    if (signout) signout.classList.remove('hidden');
    if (signout) signout.onclick = () => signOut();
    if (view) view.classList.add('signed-in');
  } else {
    // Default guest view on left, show sign-in on right
    name.textContent = 'Guest';
    avatar.src = 'icons/unnamed.jpg';
    btn.classList.remove('hidden');
    if (signout) signout.classList.add('hidden');
    if (view) view.classList.remove('signed-in');
  }
}

// Initialize UI wiring
document.addEventListener('DOMContentLoaded', () => {
  const btn = document.getElementById('btn-signin');
  if (btn) {
    btn.addEventListener('click', async (e) => {
      console.log('[BUNGIE-AUTH] sign-in button clicked');
      try {
        btn.disabled = true;
        const prev = btn.textContent;
        btn.textContent = 'Signing in...';
        await signIn();
        btn.textContent = prev;
      } catch (err) {
        console.error('[BUNGIE-AUTH] signIn failed', err);
        showAuthMessage(err?.message || String(err));
      } finally {
        btn.disabled = false;
      }
    });
  }

  const signout = document.getElementById('btn-signout');
  if (signout) signout.onclick = () => signOut();
  chrome.storage.local.get(['bungie_auth'], (res) => {
    updateAuthUI(res?.bungie_auth || null);
  });

  // auth debug removed: no debug button or pre to wire

  // If chrome.identity.launchWebAuthFlow is not available, show a friendly instruction
  if (!(chrome && chrome.identity && chrome.identity.launchWebAuthFlow)) {
    showAuthMessage('Sign-in requires running as a Chrome/Chromium extension (load unpacked). Click "Open Extensions" for instructions.');
  }
});

function showAuthMessage(text) {
  const area = document.getElementById('menu-user-area') || document.getElementById('btn-signin');
  if (!area) return;
  // Remove existing message
  const existing = area.parentNode.querySelector('.auth-hint');
  if (existing) existing.remove();
  const note = document.createElement('div');
  note.className = 'auth-hint';
  note.innerHTML = `
    <div style="margin-top:8px;padding:10px;background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.02);border-radius:6px;">
      <strong>Sign-in unavailable</strong>
      <div style="margin-top:6px;">${escapeHtml(text)}</div>
      <div style="margin-top:8px;"><button id="open-extensions-btn" class="wishlist-action-btn">Open Extensions</button></div>
    </div>`;
  area.parentNode.insertBefore(note, area.nextSibling);
  const btn = document.getElementById('open-extensions-btn');
  if (btn) btn.onclick = () => { window.open('chrome://extensions'); };
}

function escapeHtml(str) {
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

// Expose for other modules
window.bungieAuth = { signIn, signOut };
