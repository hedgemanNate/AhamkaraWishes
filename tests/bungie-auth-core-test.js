// Tests for bungie-auth-core.js: refresh coordination, session expiry, and
// write safety. Run: node tests/bungie-auth-core-test.js
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const code = fs.readFileSync(path.resolve(__dirname, '..', 'bungie-auth-core.js'), 'utf8');

let store = {};
global.chrome = {
  storage: {
    local: {
      get: (keys, cb) => {
        const out = {};
        for (const k of [].concat(keys)) if (k in store) out[k] = JSON.parse(JSON.stringify(store[k]));
        setTimeout(() => cb(out), 1);
      },
      set: (obj, cb) => { Object.assign(store, JSON.parse(JSON.stringify(obj))); setTimeout(() => cb && cb(), 1); },
      remove: (keys, cb) => { for (const k of [].concat(keys)) delete store[k]; setTimeout(() => cb && cb(), 1); },
    },
  },
};

let fetchImpl = null;
let fetchCalls = 0;
global.supabaseFetch = async (url, opts) => { fetchCalls++; return fetchImpl(JSON.parse(opts.body)); };
const reply = (status, body) => ({ ok: status >= 200 && status < 300, status, text: async () => JSON.stringify(body) });

eval(code);
const Core = globalThis.BungieAuthCore;

const HOUR = 3600 * 1000;
function reset(session) {
  store = session ? { bungie_auth: session } : {};
  fetchCalls = 0;
}
const expired = () => ({ access_token: 'old-a', refresh_token: 'old-r', expires_at: Date.now() - 1000, user: { displayName: 'Guardian' } });

(async () => {
  // 1. Fresh token: no network.
  reset({ access_token: 'a', refresh_token: 'r', expires_at: Date.now() + HOUR });
  fetchImpl = () => { throw new Error('should not fetch'); };
  assert.strictEqual((await Core.getValidSession()).access_token, 'a');
  assert.strictEqual(fetchCalls, 0);

  // 2. Expired token, many parallel callers: exactly one refresh, all get the result,
  //    the rotated refresh token is stored, and unrelated fields survive.
  reset(expired());
  fetchImpl = async (body) => {
    assert.strictEqual(body.refresh_token, 'old-r');
    await new Promise((r) => setTimeout(r, 20));
    return reply(200, { access_token: 'new-a', refresh_token: 'new-r', expires_in: 3600, refresh_expires_in: 7776000 });
  };
  const results = await Promise.all(Array.from({ length: 5 }, () => Core.getValidSession()));
  assert.strictEqual(fetchCalls, 1, 'parallel callers must share one refresh');
  results.forEach((s) => assert.strictEqual(s.access_token, 'new-a'));
  assert.strictEqual(store.bungie_auth.refresh_token, 'new-r');
  assert.strictEqual(store.bungie_auth.user.displayName, 'Guardian');
  assert.ok(store.bungie_auth.refresh_expires_at > Date.now());

  // 3. invalid_grant: session ends, flag set, SESSION_EXPIRED thrown.
  reset(expired());
  fetchImpl = async () => reply(400, { error: 'invalid_grant', error_description: 'AuthorizationRecordExpired' });
  await assert.rejects(Core.getValidSession(), (e) => e.code === 'SESSION_EXPIRED');
  assert.strictEqual(store.bungie_auth, undefined);
  assert.ok(store.bungie_session_expired);

  // 4. Network failure / 5xx: tokens kept, TRANSIENT thrown.
  reset(expired());
  fetchImpl = async () => { throw new TypeError('Failed to fetch'); };
  await assert.rejects(Core.getValidSession(), (e) => e.code === 'TRANSIENT');
  assert.strictEqual(store.bungie_auth.refresh_token, 'old-r');
  fetchImpl = async () => reply(502, { error: 'bad_gateway' });
  await assert.rejects(Core.getValidSession(), (e) => e.code === 'TRANSIENT');
  assert.strictEqual(store.bungie_auth.refresh_token, 'old-r');

  // 5. Proxy misconfigured: CONFIG, tokens kept (not the user's fault).
  fetchImpl = async () => reply(500, { error: 'server_misconfigured' });
  await assert.rejects(Core.getValidSession(), (e) => e.code === 'CONFIG');
  assert.strictEqual(store.bungie_auth.refresh_token, 'old-r');

  // 6. invalid_grant because another context already rotated the token:
  //    keep (and return) the newer session instead of signing out.
  reset(expired());
  fetchImpl = async () => {
    store.bungie_auth = { access_token: 'other-a', refresh_token: 'other-r', expires_at: Date.now() + HOUR };
    return reply(400, { error: 'invalid_grant' });
  };
  assert.strictEqual((await Core.getValidSession()).access_token, 'other-a');
  assert.strictEqual(store.bungie_session_expired, undefined);

  // 7. updateSession merges onto the latest stored session (no stale overwrite).
  reset({ access_token: 'a1', refresh_token: 'r1', expires_at: Date.now() + HOUR });
  store.bungie_auth.refresh_token = 'r2'; // rotated after a caller read its copy
  await Core.updateSession(() => ({ user: { displayName: 'X' } }));
  assert.strictEqual(store.bungie_auth.refresh_token, 'r2');
  assert.strictEqual(store.bungie_auth.user.displayName, 'X');

  // 8. Not signed in.
  reset(null);
  await assert.rejects(Core.getValidSession(), (e) => e.code === 'NOT_SIGNED_IN');
  assert.strictEqual(await Core.updateSession(() => ({ user: {} })), null);
  assert.strictEqual(store.bungie_auth, undefined);

  // 9. exchangeCode stores a session and clears a previous expiry flag;
  //    a rejected code is a failed sign-in, not an expired session.
  reset(null);
  store.bungie_session_expired = { reason: 'x', at: 1 };
  fetchImpl = async (body) => {
    assert.deepStrictEqual(body, { grant_type: 'authorization_code', code: 'c', code_verifier: 'v', redirect_uri: 'https://id.chromiumapp.org/cb' });
    return reply(200, { access_token: 'a', refresh_token: 'r', expires_in: 3600, membership_id: '42' });
  };
  await Core.exchangeCode('c', 'v', 'https://id.chromiumapp.org/cb');
  assert.strictEqual(store.bungie_auth.membership_id, '42');
  assert.strictEqual(store.bungie_session_expired, undefined);
  reset(null);
  fetchImpl = async () => reply(400, { error: 'invalid_grant' });
  await assert.rejects(Core.exchangeCode('c', 'v', 'u'), (e) => e.code === 'TRANSIENT');
  assert.strictEqual(store.bungie_auth, undefined);

  // 10. clearSession removes everything.
  reset({ access_token: 'a', refresh_token: 'r', expires_at: Date.now() + HOUR });
  await Core.clearSession();
  assert.strictEqual(store.bungie_auth, undefined);

  console.log('Bungie auth core test passed');
})().catch((e) => { console.error(e); process.exit(1); });
