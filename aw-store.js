// Ahamkara Wishes — the one write path for `dimData`.
//
// dimData is written from the side panel (save, edit, delete, import, matching,
// list management, cloud sync) and from the service worker (the godroll.tv
// button). Each of those used to read a copy, wait on something, then write the
// whole copy back, so a save or delete that landed in between was silently
// overwritten. Now every writer goes through AWStore.update(): it takes a Web
// Lock shared by the panel and the service worker, reads dimData fresh INSIDE
// the lock, runs the writer's mutator on that copy, and writes it back. Two
// writers can no longer interleave, and a mutator never sees stale data.
//
// Rules for mutators:
//   - Change `data` in place (or return AWStore.replace(next) to swap it).
//   - Do local work only. Never wait on the network while holding the lock;
//     fetch first, then call update() with the result.
//   - Never call update() from inside a mutator (it would wait on itself).
//   - Return AWStore.SKIP to abandon the write.
//
// Loaded in the side panel (script tag) and the service worker (importScripts).

(function (root) {
  'use strict';

  const KEY = 'dimData';
  const LOCK_NAME = 'aw-dimdata';

  const SKIP = Symbol('aw-store-skip');
  const REPLACE = Symbol('aw-store-replace');

  const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

  function emptyData() {
    return { activeId: 'default', lists: { default: { name: 'Main Wishlist', items: {} } } };
  }

  // --- storage ---------------------------------------------------------------

  function storageGet(keys) {
    return new Promise((res) => chrome.storage.local.get(keys, res));
  }
  function storageSet(obj) {
    return new Promise((res) => chrome.storage.local.set(obj, res));
  }

  // --- locking ---------------------------------------------------------------

  // In-context fallback queue, used only where the Web Locks API is missing
  // (Node tests). Chrome has navigator.locks in both pages and service workers.
  let _localChain = Promise.resolve();

  function withLock(fn) {
    const locks = root.navigator && root.navigator.locks;
    if (locks && typeof locks.request === 'function') {
      return locks.request(LOCK_NAME, fn);
    }
    const run = _localChain.then(fn, fn);
    _localChain = run.catch(() => {});
    return run;
  }

  // --- helpers ---------------------------------------------------------------

  /** Guarantees the top-level shape every reader assumes. Mutates and returns. */
  function shape(raw) {
    const data = isObject(raw) ? raw : {};
    if (!isObject(data.lists) || Object.keys(data.lists).length === 0) {
      data.lists = { default: { name: 'Main Wishlist', items: {} } };
    }
    if (!data.activeId) data.activeId = 'default';
    return data;
  }

  /**
   * The id of the list that new wishes go to: the active one, or "default" if
   * the active id points at a list that no longer exists. Creates "default"
   * if it is missing, so callers can always index `data.lists[id]`.
   */
  function ensureActiveList(data) {
    const id = data.lists[data.activeId] ? data.activeId : 'default';
    if (!data.lists[id]) data.lists[id] = { name: 'Main Wishlist', items: {} };
    if (!data.lists[id].items) data.lists[id].items = {};
    return id;
  }

  // --- public API ------------------------------------------------------------

  /** A fresh, shaped copy of dimData. For read-only use; to change it, use update(). */
  async function read() {
    const obj = await storageGet([KEY]);
    return shape(obj && obj[KEY]);
  }

  /** Tells update() to store `next` instead of the object that was passed in. */
  function replace(next, result) {
    return { [REPLACE]: { data: next, result } };
  }

  /**
   * Read-modify-write under the shared lock.
   * @param {(data:object) => any|Promise<any>} mutator
   * @param {{also?:object}} [opts]  `also`: extra storage keys written in the same
   *        set() call (only when the write happens)
   * @returns {Promise<any>} whatever the mutator returned (undefined for SKIP).
   *          Nothing is written when the mutator returns SKIP, or when it left
   *          dimData unchanged and `also` is not given — so an idempotent pass
   *          doesn't trigger every view to re-render.
   */
  function update(mutator, opts) {
    if (typeof mutator !== 'function') return Promise.reject(new TypeError('AWStore.update needs a function'));
    const also = opts && opts.also;
    return withLock(async () => {
      const obj = await storageGet([KEY]);
      const data = shape(obj && obj[KEY]);
      const beforeJson = JSON.stringify(data);

      let result = await mutator(data);
      let next = data;
      if (result && result[REPLACE]) {
        next = shape(result[REPLACE].data);
        result = result[REPLACE].result;
      }
      if (result === SKIP) return undefined;

      if (also || JSON.stringify(next) !== beforeJson) {
        await storageSet(Object.assign({}, also, { [KEY]: next }));
      }
      return result;
    });
  }

  root.AWStore = { KEY, LOCK_NAME, SKIP, update, read, replace, ensureActiveList, emptyData };
})(typeof window !== 'undefined' ? window : globalThis);
