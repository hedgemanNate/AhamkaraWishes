// Ahamkara Wishes — chrome.* stub for previewing extension pages in a normal tab.
//
// Dev tool only: never shipped (build-extension.sh copies an explicit file list,
// and tools/check-build.js fails the build if anything from tools/ ends up in it).
// The preview server (serve.js) injects this before the page's own scripts, so
// sidepanel.html runs unmodified at http://127.0.0.1:<port>/sidepanel.html.
//
// Storage persists in localStorage between reloads. `?fixture=<name>` replaces
// it with tools/preview/fixtures/<name>.json on load, so a screen can be put in
// a known state (demo data, hostile data, a fresh install).
(function () {
  'use strict';

  const LS_KEY = '__aw_preview_store';
  const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));

  function loadFixture(name) {
    if (!/^[a-z0-9-]+$/.test(name)) throw new Error('Bad fixture name: ' + name);
    // Synchronous on purpose: the page's scripts read storage as soon as they
    // load, so the fixture has to be in place before this script returns.
    const xhr = new XMLHttpRequest();
    xhr.open('GET', '/__preview/fixtures/' + name + '.json', false);
    xhr.send();
    if (xhr.status !== 200) throw new Error('Fixture not found: ' + name);
    return JSON.parse(xhr.responseText);
  }

  let store = {};
  const fixture = new URLSearchParams(location.search).get('fixture');
  if (fixture) {
    store = loadFixture(fixture);
    console.info('[preview] loaded fixture "' + fixture + '"');
  } else {
    try { store = JSON.parse(localStorage.getItem(LS_KEY) || '{}'); } catch (e) { store = {}; }
  }
  const persist = () => { try { localStorage.setItem(LS_KEY, JSON.stringify(store)); } catch (e) { /* private mode */ } };
  persist();

  const listeners = [];
  const emit = (changes) => setTimeout(() => listeners.slice().forEach((l) => l(changes, 'local')), 0);

  function pick(keys) {
    if (keys == null) return clone(store);
    if (typeof keys === 'string') keys = [keys];
    const out = {};
    if (Array.isArray(keys)) keys.forEach((k) => { if (k in store) out[k] = clone(store[k]); });
    else Object.keys(keys).forEach((k) => { out[k] = k in store ? clone(store[k]) : keys[k]; });
    return out;
  }

  // Chrome's storage API takes an optional callback and also returns a Promise.
  const api = (fn) => (arg, cb) => {
    const result = fn(arg);
    const done = new Promise((res) => setTimeout(() => res(result), 0));
    if (typeof cb === 'function') done.then(cb);
    return done;
  };

  const local = {
    get: api(pick),
    set: api((obj) => {
      const changes = {};
      Object.keys(obj).forEach((k) => {
        changes[k] = { oldValue: clone(store[k]), newValue: clone(obj[k]) };
        store[k] = clone(obj[k]);
      });
      persist(); emit(changes);
    }),
    remove: api((keys) => {
      const changes = {};
      [].concat(keys).forEach((k) => { if (k in store) { changes[k] = { oldValue: clone(store[k]) }; delete store[k]; } });
      persist(); emit(changes);
    }),
    clear: api(() => {
      const changes = {};
      Object.keys(store).forEach((k) => { changes[k] = { oldValue: clone(store[k]) }; });
      store = {}; persist(); emit(changes);
    })
  };

  const noEvent = { addListener() {}, removeListener() {}, hasListener() { return false; } };
  const resolved = (value) => (arg, cb) => { if (typeof cb === 'function') setTimeout(() => cb(value), 0); return Promise.resolve(value); };

  window.chrome = {
    storage: { local, onChanged: { addListener: (l) => listeners.push(l), removeListener: (l) => { const i = listeners.indexOf(l); if (i >= 0) listeners.splice(i, 1); } } },
    runtime: {
      id: 'preview',
      lastError: undefined,
      getURL: (p) => '/' + String(p).replace(/^\//, ''),
      getManifest: () => ({ version: 'preview' }),
      sendMessage: (msg, cb) => { console.info('[preview] runtime.sendMessage', msg); if (typeof cb === 'function') setTimeout(() => cb({ ok: false, error: 'Not available in preview' }), 0); return Promise.resolve(); },
      onMessage: noEvent
    },
    identity: {
      getRedirectURL: () => 'https://preview.chromiumapp.org/',
      // Sign-in can't work outside the extension; fail the way a cancelled
      // sign-in does so the UI shows its normal error path.
      launchWebAuthFlow: (opts, cb) => {
        window.chrome.runtime.lastError = { message: 'Sign-in is not available in the preview.' };
        if (typeof cb === 'function') setTimeout(() => { cb(undefined); window.chrome.runtime.lastError = undefined; }, 0);
        return Promise.reject(new Error('Sign-in is not available in the preview.'));
      }
    },
    permissions: { contains: resolved(false), request: resolved(false), onAdded: noEvent, onRemoved: noEvent },
    tabs: { query: resolved([]), create: (o) => { window.open(o && o.url, '_blank', 'noopener'); return Promise.resolve({}); } },
    scripting: {
      registerContentScripts: resolved(undefined), unregisterContentScripts: resolved(undefined),
      getRegisteredContentScripts: resolved([]), executeScript: resolved([]), insertCSS: resolved(undefined)
    }
  };

  // Lets tests and the console put the preview into a known state.
  window.__awPreview = {
    seed(obj) { store = clone(obj || {}); persist(); },
    dump() { return clone(store); },
    fixture
  };
})();
