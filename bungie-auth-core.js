// Ahamkara Wishes — Bungie session core (no DOM).
//
// Single owner of the `bungie_auth` storage key. Loaded by sidepanel.html AND
// by background.js (importScripts), so the side panel and the service worker
// go through exactly the same token logic.
//
// Why this exists — the previous design had several independent writers:
// the alarm in background.js, getValidAuth() in the panel (called in parallel
// by admin.js, admin-sync.js, discover.js and the profile refresh), and
// updateAuthUI() writing back a stale copy of the whole object. Bungie rotates
// the refresh token on every refresh, so two concurrent refreshes, or a stale
// write-back, could leave a dead refresh token in storage. The UI then showed
// "signed in" while every call failed. The rules here:
//
//   1. Every refresh runs under one Web Lock ('bungie-auth'), shared by all
//      extension contexts (same origin), and re-reads storage inside the lock,
//      so only the first caller actually hits Bungie; the rest reuse its result.
//   2. Every write is a read-modify-write under that same lock (updateSession).
//   3. A refresh the server definitively rejects (invalid_grant) ends the
//      session: tokens are removed and `bungie_session_expired` is set so the
//      UI can say why. Network/5xx failures keep the tokens and are retried.

(function (global) {
  'use strict';

  const STORAGE_KEY = 'bungie_auth';
  const EXPIRED_KEY = 'bungie_session_expired';
  const LOCK_NAME = 'bungie-auth';
  const PROXY_URL = 'https://tqgewrylrjqfqzqlmmag.supabase.co/functions/v1/bungie-oauth';
  const PROXY_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRxZ2V3cnlscmpxZnF6cWxtbWFnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODM2NDgxMTEsImV4cCI6MjA5OTIyNDExMX0.BVHPpCkGycZXyj8BmtFITbrE9WqfEwx1zX5CSJ35__Y';

  // Refresh this long before the access token actually expires.
  const REFRESH_BUFFER_MS = 10 * 60 * 1000;

  class AuthError extends Error {
    // code: 'NOT_SIGNED_IN' | 'SESSION_EXPIRED' | 'TRANSIENT' | 'CONFIG'
    constructor(code, message) {
      super(message);
      this.name = 'AuthError';
      this.code = code;
    }
  }

  // --- storage ---------------------------------------------------------------

  function storageGet(keys) {
    return new Promise((res) => chrome.storage.local.get(keys, res));
  }
  function storageSet(obj) {
    return new Promise((res) => chrome.storage.local.set(obj, res));
  }
  function storageRemove(keys) {
    return new Promise((res) => chrome.storage.local.remove(keys, res));
  }

  async function readSession() {
    const obj = await storageGet([STORAGE_KEY]);
    const s = obj && obj[STORAGE_KEY];
    return s && s.access_token ? s : null;
  }

  // --- locking ---------------------------------------------------------------

  // In-context fallback queue, used only where the Web Locks API is missing
  // (Node tests). Chrome has navigator.locks in both pages and service workers.
  let _localChain = Promise.resolve();

  function withLock(fn) {
    const locks = global.navigator && global.navigator.locks;
    if (locks && typeof locks.request === 'function') {
      return locks.request(LOCK_NAME, fn);
    }
    const run = _localChain.then(fn, fn);
    _localChain = run.catch(() => {});
    return run;
  }

  // --- token endpoint (via Supabase proxy) ------------------------------------

  async function postToProxy(body) {
    const doFetch = typeof global.supabaseFetch === 'function' ? global.supabaseFetch : fetch;
    let resp;
    try {
      resp = await doFetch(PROXY_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${PROXY_ANON_KEY}` },
        body: JSON.stringify(body),
      });
    } catch (e) {
      throw new AuthError('TRANSIENT', 'Could not reach the sign-in server: ' + (e && e.message ? e.message : e));
    }
    const text = await resp.text();
    let parsed = null;
    try { parsed = JSON.parse(text); } catch (e) { /* not json */ }
    return { ok: resp.ok, status: resp.status, body: parsed, text };
  }

  // Classify a failed token-endpoint response.
  function classifyTokenFailure(r) {
    const err = (r.body && r.body.error) || '';
    const desc = (r.body && (r.body.error_description || r.body.detail)) || r.text || '';
    if (err === 'invalid_grant') return new AuthError('SESSION_EXPIRED', 'Bungie session expired: ' + desc);
    if (err === 'invalid_client' || err === 'unauthorized_client' || err === 'server_misconfigured') {
      return new AuthError('CONFIG', `Sign-in server misconfigured (${err}): ${desc}`);
    }
    return new AuthError('TRANSIENT', `Token request failed (${r.status}): ${err || desc}`.slice(0, 300));
  }

  function sessionFromTokenResponse(t, base) {
    const now = Date.now();
    return {
      ...(base || {}),
      access_token: t.access_token,
      // Bungie rotates the refresh token; keep the old one only if none came back.
      refresh_token: t.refresh_token || (base && base.refresh_token) || null,
      expires_at: now + Number(t.expires_in || 3600) * 1000,
      refresh_expires_at: t.refresh_expires_in
        ? now + Number(t.refresh_expires_in) * 1000
        : (base && base.refresh_expires_at) || null,
      membership_id: t.membership_id || (base && base.membership_id) || null,
    };
  }

  async function endSession(reason) {
    await storageRemove([STORAGE_KEY]);
    await storageSet({ [EXPIRED_KEY]: { reason: String(reason || ''), at: Date.now() } });
  }

  // --- public operations -------------------------------------------------------

  /** Exchange an authorization code and store a brand new session. */
  async function exchangeCode(code, codeVerifier, redirectUri) {
    const r = await postToProxy({
      grant_type: 'authorization_code',
      code,
      code_verifier: codeVerifier,
      redirect_uri: redirectUri,
    });
    if (!r.ok || !r.body || !r.body.access_token) {
      const e = classifyTokenFailure(r);
      // A rejected code is not an expired session — it's a failed sign-in.
      if (e.code === 'SESSION_EXPIRED') e.code = 'TRANSIENT';
      throw e;
    }
    const session = sessionFromTokenResponse(r.body, null);
    await withLock(async () => {
      await storageSet({ [STORAGE_KEY]: session });
      await storageRemove([EXPIRED_KEY]);
    });
    return session;
  }

  /**
   * Return a session whose access token is valid for at least REFRESH_BUFFER_MS,
   * refreshing if needed. Throws AuthError.
   * @param {{force?: boolean}} [opts] force: refresh even if not near expiry
   */
  async function getValidSession(opts) {
    const force = !!(opts && opts.force);
    const pre = await readSession();
    if (!pre) throw new AuthError('NOT_SIGNED_IN', 'Not signed in to Bungie.');
    if (!force && pre.expires_at && Date.now() < pre.expires_at - REFRESH_BUFFER_MS) return pre;

    return withLock(async () => {
      // Re-read inside the lock: another context may have refreshed already.
      const s = await readSession();
      if (!s) throw new AuthError('NOT_SIGNED_IN', 'Not signed in to Bungie.');
      const fresh = s.expires_at && Date.now() < s.expires_at - REFRESH_BUFFER_MS;
      if (fresh && (!force || s.access_token !== pre.access_token)) return s;

      if (!s.refresh_token) {
        await endSession('no refresh token');
        throw new AuthError('SESSION_EXPIRED', 'Bungie session expired. Please sign in again.');
      }

      const r = await postToProxy({ grant_type: 'refresh_token', refresh_token: s.refresh_token });
      if (r.ok && r.body && r.body.access_token) {
        const updated = sessionFromTokenResponse(r.body, s);
        await storageSet({ [STORAGE_KEY]: updated });
        return updated;
      }

      const e = classifyTokenFailure(r);
      if (e.code === 'SESSION_EXPIRED') {
        // Only end the session if storage still holds the token we just sent.
        // Without Web Locks another context could have rotated it meanwhile.
        const now = await readSession();
        if (now && now.refresh_token !== s.refresh_token) return now;
        await endSession(e.message);
      }
      throw e;
    });
  }

  /** Read-modify-write the stored session under the lock. No-op if signed out. */
  async function updateSession(mutator) {
    return withLock(async () => {
      const s = await readSession();
      if (!s) return null;
      const next = { ...s, ...(mutator(s) || {}) };
      await storageSet({ [STORAGE_KEY]: next });
      return next;
    });
  }

  async function clearSession() {
    await withLock(() => storageRemove([STORAGE_KEY, EXPIRED_KEY, 'bungie_pkce_verifier']));
  }

  global.BungieAuthCore = {
    AuthError,
    STORAGE_KEY,
    EXPIRED_KEY,
    REFRESH_BUFFER_MS,
    readSession,
    exchangeCode,
    getValidSession,
    updateSession,
    clearSession,
  };
})(typeof self !== 'undefined' ? self : globalThis);
