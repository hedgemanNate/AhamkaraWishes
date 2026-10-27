// Bungie sign-in, auth UI, and Bungie API calls for the side panel.
//
// Token storage and refresh are NOT handled here — they live in
// bungie-auth-core.js (window.BungieAuthCore), which background.js shares.
// This file only: runs the OAuth flow, renders the signed-in state, and makes
// authenticated Bungie API calls via getValidAuth().

// The redirect URI must be https://<this extension's ID>.chromiumapp.org/...
// or launchWebAuthFlow can never intercept the redirect and fails with
// "Authorization page could not be loaded". The ID depends on the manifest
// `key` / the store-assigned ID, so derive it from the running extension
// rather than hardcoding one. Whatever it resolves to must be the Redirect URL
// registered for the app in the Bungie Developer Portal.
const BUNGIE_OAUTH = {
  client_id: '51511',
  redirect_path: 'bungie-oauth-callback.html',
  auth_endpoint: 'https://www.bungie.net/en/oauth/authorize',
  get redirect_uri() {
    return chrome.identity.getRedirectURL(this.redirect_path);
  }
};

function base64url(buffer) {
  return btoa(String.fromCharCode.apply(null, new Uint8Array(buffer)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function sha256(input) {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return new Uint8Array(hash);
}

function randomToken(len = 64) {
  const arr = new Uint8Array(len);
  crypto.getRandomValues(arr);
  return base64url(arr);
}

function launchWebAuthFlow(url) {
  return new Promise((resolve, reject) => {
    if (!(chrome && chrome.identity && chrome.identity.launchWebAuthFlow)) {
      return reject(new Error('Sign-in must be run from the installed Chrome/Chromium extension.'));
    }
    chrome.identity.launchWebAuthFlow({ url, interactive: true }, (redirectUrl) => {
      if (chrome.runtime.lastError) {
        return reject(new Error(chrome.runtime.lastError.message || String(chrome.runtime.lastError)));
      }
      resolve(redirectUrl);
    });
  });
}

// Turn launchWebAuthFlow's terse errors into something actionable.
// Returns null for "user closed the window", which is not an error.
function describeLaunchError(message, redirectUri) {
  if (/did not approve|cancel/i.test(message)) return null;
  if (/could not be loaded/i.test(message)) {
    return 'Bungie\'s sign-in page could not be loaded. Check that bungie.net is reachable ' +
      '(it may be down for maintenance) and try again. If it keeps failing, the Redirect URL ' +
      'registered for this app at Bungie must be exactly: ' + redirectUri;
  }
  return message + ' (redirect URI: ' + redirectUri + ')';
}

async function fetchBungieUser(accessToken) {
  const resp = await fetch('https://www.bungie.net/platform/User/GetBungieNetUser/', {
    headers: { 'Authorization': `Bearer ${accessToken}`, 'X-API-Key': (typeof API_KEY !== 'undefined') ? API_KEY : '' }
  });
  const text = await resp.text();
  let parsed = null;
  try { parsed = JSON.parse(text); } catch (e) { /* not json */ }
  if (!resp.ok) {
    const serverMsg = parsed?.Message || parsed?.error_description || parsed?.error || text;
    throw new Error('GetBungieNetUser failed: ' + resp.status + ' - ' + serverMsg);
  }
  return (parsed && typeof parsed === 'object') ? (parsed.Response || parsed) : null;
}

// Best-effort profile info for display and membership lookup. Never fails
// sign-in: the tokens are what matter, and these are re-fetched later if missing.
async function loadProfileInfo() {
  try {
    const auth = await getValidAuth();
    const [user, destinyMemberships] = await Promise.all([
      fetchBungieUser(auth.access_token).catch(() => null),
      fetchDestinyMemberships(auth.access_token).catch(() => null)
    ]);
    const patch = {};
    if (user) patch.user = user;
    if (destinyMemberships && destinyMemberships.length) patch.destinyMemberships = destinyMemberships;
    if (Object.keys(patch).length) await BungieAuthCore.updateSession(() => patch);
  } catch (e) {
    console.warn('[BUNGIE-AUTH] could not load profile info', e);
  }
}

let _signInInFlight = null;

/**
 * Run the OAuth flow and store a new session.
 * Resolves to the session, or null if the user closed the sign-in window.
 * Concurrent calls share one flow.
 */
function signIn() {
  if (_signInInFlight) return _signInInFlight;
  _signInInFlight = (async () => {
    const redirectUri = BUNGIE_OAUTH.redirect_uri;
    // The verifier and state stay in memory for this one attempt — nothing
    // in storage for a second attempt to overwrite.
    const verifier = randomToken(64);
    const state = randomToken(16);
    const params = new URLSearchParams({
      client_id: BUNGIE_OAUTH.client_id,
      response_type: 'code',
      redirect_uri: redirectUri,
      code_challenge: base64url(await sha256(verifier)),
      code_challenge_method: 'S256',
      state
    });

    let redirect;
    try {
      redirect = await launchWebAuthFlow(`${BUNGIE_OAUTH.auth_endpoint}?${params}`);
    } catch (e) {
      const msg = describeLaunchError(e.message, redirectUri);
      if (msg === null) return null;
      throw new Error(msg);
    }
    if (!redirect) throw new Error('Sign-in returned no redirect.');

    const u = new URL(redirect);
    const q = u.searchParams.has('code') || u.searchParams.has('error')
      ? u.searchParams
      : new URLSearchParams(u.hash.replace(/^#/, ''));
    if (q.get('error')) throw new Error('Bungie refused sign-in: ' + (q.get('error_description') || q.get('error')));
    // Bungie echoes `state`; reject a redirect that carries a different one.
    if (q.has('state') && q.get('state') !== state) throw new Error('Sign-in response did not match this request. Please try again.');
    const code = q.get('code');
    if (!code) throw new Error('Sign-in returned no authorization code.');

    const session = await BungieAuthCore.exchangeCode(code, verifier, redirectUri);
    await loadProfileInfo();
    return session;
  })().finally(() => { _signInInFlight = null; });
  return _signInInFlight;
}

async function signOut() {
  await BungieAuthCore.clearSession();
}

/**
 * The one way other modules get a usable access token.
 * Refreshes when needed (coordinated across all extension contexts).
 * Throws BungieAuthCore.AuthError; err.code is 'NOT_SIGNED_IN',
 * 'SESSION_EXPIRED', 'TRANSIENT' or 'CONFIG'.
 */
function getValidAuth() {
  return BungieAuthCore.getValidSession();
}

// --- announcing who is signed in ---------------------------------------------
// Driven by chrome.storage.onChanged, so it follows the session no matter which
// context changed it (sign-in here, refresh or expiry in background.js). The
// screens draw the signed-in state themselves; this announces it. It never
// writes storage except through loadProfileInfo().

let _lastAuthIdentity; // undefined until first announcement

function announceAuth(session) {
  // Profile info can be missing if Bungie hiccuped during sign-in.
  if (session && !session.user) loadProfileInfo();

  // Tell listeners (sync, admin, Discover, Drops) only when the signed-in identity
  // changes, not on every token refresh. The first call always announces, signed
  // in or not: it is how they find out the state at startup.
  const identity = session ? (session.membership_id || 'signed-in') : null;
  if (identity !== _lastAuthIdentity) {
    _lastAuthIdentity = identity;
    document.dispatchEvent(new CustomEvent('bungieAuthChanged', { detail: { auth: session } }));
  }
}

async function refreshAuthUI() {
  const obj = await new Promise((res) => chrome.storage.local.get([BungieAuthCore.STORAGE_KEY], res));
  const session = obj[BungieAuthCore.STORAGE_KEY];
  announceAuth(session && session.access_token ? session : null);
}

if (typeof document !== 'undefined') {
  document.addEventListener('DOMContentLoaded', () => {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local') return;
      if (changes[BungieAuthCore.STORAGE_KEY]) refreshAuthUI();
    });
    refreshAuthUI();
  });
}

/**
 * Fetch Destiny 2 memberships for the currently authenticated user.
 * Uses /User/GetMembershipsForCurrentUser/ which returns destinyMemberships
 * with proper platformMembershipType and membershipId for use with GetProfile.
 */
async function fetchDestinyMemberships(accessToken) {
  const resp = await fetch('https://www.bungie.net/Platform/User/GetMembershipsForCurrentUser/', {
    headers: { 'Authorization': `Bearer ${accessToken}`, 'X-API-Key': (typeof API_KEY !== 'undefined') ? API_KEY : '' }
  });
  const text = await resp.text();
  let parsed = null;
  try { parsed = JSON.parse(text); } catch (e) { /* not json */ }
  if (!resp.ok) {
    const serverMsg = parsed?.Message || parsed?.error_description || text;
    throw new Error('GetMembershipsForCurrentUser failed: ' + resp.status + ' - ' + serverMsg);
  }
  return (parsed?.Response?.destinyMemberships) || [];
}


/**
 * Fetch Destiny2.GetProfile with selected components.
 * @param {number|string} membershipType
 * @param {string|number} membershipId
 * @param {string|Array<number|string>} components - comma-separated string or array of component ids
 */
async function fetchProfileWithComponents(membershipType, membershipId, components) {
  const auth = await getValidAuth();

  let compParam = components;
  if (Array.isArray(components)) compParam = components.join(',');
  if (!compParam) compParam = '';

  const url = `https://www.bungie.net/Platform/Destiny2/${membershipType}/Profile/${membershipId}/?components=${encodeURIComponent(compParam)}`;
  const resp = await fetch(url, { headers: { 'Authorization': `Bearer ${auth.access_token}`, 'X-API-Key': (typeof API_KEY !== 'undefined') ? API_KEY : '' } });
  const text = await resp.text();
  let parsed = null;
  try { parsed = JSON.parse(text); } catch (e) { /* ignore */ }
  if (!resp.ok) {
    const serverMsg = parsed?.Message || parsed?.error_description || parsed || text;
    throw new Error('GetProfile failed: ' + resp.status + ' - ' + serverMsg);
  }

  // Persist last raw profile response so the next panel open can show owned
  // state before its own fetch lands. The profile runs to megabytes, so the
  // write isn't awaited — the caller shouldn't wait on disk to start indexing.
  const toStore = { lastBungieProfile: parsed?.Response || parsed, lastBungieProfileFetchedAt: Date.now() };
  chrome.storage.local.set(toStore, () => {
    if (chrome.runtime.lastError) console.warn('[BUNGIE-AUTH] could not cache profile:', chrome.runtime.lastError.message);
  });
  return parsed?.Response || parsed;
}

/**
 * Lock or unlock a single item instance via Destiny2 SetLockState.
 * @param {string} instanceId - item instance ID (string form of int64)
 * @param {string} characterId - owning character ID (any character for vault items)
 * @param {number} membershipType - Destiny membership type (1=Xbox, 2=PSN, 3=Steam, etc.)
 * @param {string} membershipId - Destiny membership ID
 * @param {boolean} [state=true] - true to lock, false to unlock
 */
async function setItemLockState(instanceId, characterId, membershipType, membershipId, state = true) {
  const auth = await getValidAuth();
  const resp = await fetch('https://www.bungie.net/Platform/Destiny2/Actions/Items/SetLockState/', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${auth.access_token}`,
      'X-API-Key': API_KEY,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      state,
      itemId: String(instanceId),
      characterId: String(characterId),
      membershipType: Number(membershipType)
    })
  });
  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    throw new Error(`SetLockState failed ${resp.status}: ${text.slice(0, 200)}`);
  }
  return resp.json();
}

/**
 * Equip an item instance on a character. The item must already be in the
 * character's inventory (not the vault); transfer it first if needed.
 * @param {string} instanceId
 * @param {string} characterId - character that owns the item
 * @param {number} membershipType
 * @param {string} membershipId
 */
async function equipItem(instanceId, characterId, membershipType, membershipId) {
  const auth = await getValidAuth();
  const resp = await fetch('https://www.bungie.net/Platform/Destiny2/Actions/Items/EquipItem/', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${auth.access_token}`,
      'X-API-Key': API_KEY,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      itemId: String(instanceId),
      characterId: String(characterId),
      membershipType: Number(membershipType)
    })
  });
  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    throw new Error(`EquipItem failed ${resp.status}: ${text.slice(0, 200)}`);
  }
  return resp.json();
}

function buildTransferItemPayload(instanceId, itemReferenceHash, characterId, membershipType, transferToVault, stackSize = 1) {
  return {
    itemReferenceHash: Number(itemReferenceHash),
    stackSize,
    transferToVault: !!transferToVault,
    itemId: String(instanceId),
    characterId: String(characterId),
    membershipType: Number(membershipType)
  };
}

async function transferItemToVault(instanceId, itemReferenceHash, characterId, membershipType, membershipId) {
  const auth = await getValidAuth();
  const resp = await fetch('https://www.bungie.net/Platform/Destiny2/Actions/Items/TransferItem/', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${auth.access_token}`,
      'X-API-Key': API_KEY,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(buildTransferItemPayload(instanceId, itemReferenceHash, characterId, membershipType, true))
  });
  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    throw new Error(`TransferItem failed ${resp.status}: ${text.slice(0, 200)}`);
  }
  return resp.json();
}

// Expose for other modules
window.bungieAuth = { signIn, signOut, getValidAuth, fetchProfileWithComponents, fetchDestinyMemberships, setItemLockState, equipItem, transferItemToVault, buildTransferItemPayload };
