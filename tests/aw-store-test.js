// AWStore (aw-store.js): the single serialised write path for dimData.
//
// The bug this guards against: several writers each read dimData, waited on
// something (a network call, an index build), then wrote their copy back, so a
// save or delete that landed in between was silently overwritten.
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const code = fs.readFileSync(path.resolve(__dirname, '..', 'aw-store.js'), 'utf8');

let store = {};
let setCalls = 0;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
global.chrome = {
  storage: {
    local: {
      get: (keys, cb) => {
        const out = {};
        for (const k of [].concat(keys)) if (k in store) out[k] = JSON.parse(JSON.stringify(store[k]));
        setTimeout(() => cb(out), 1);
      },
      set: (obj, cb) => { setCalls++; setTimeout(() => { Object.assign(store, JSON.parse(JSON.stringify(obj))); cb && cb(); }, 1); },
    },
  },
};
global.window = global;
eval(code);
const S = window.AWStore;

function reset(data) { store = data ? { dimData: data } : {}; setCalls = 0; }
const listsOf = () => Object.keys(store.dimData.lists).sort().join();

let failures = 0;
function check(label, cond) {
  console.log(`${cond ? 'PASS' : 'FAIL'}: ${label}`);
  if (!cond) failures++;
}

(async () => {
  // 1. The original bug, reproduced the old way: read, wait, write back a copy.
  reset(S.emptyData());
  const oldWayRead = JSON.parse(JSON.stringify(store.dimData));            // writer A reads...
  await S.update((d) => { d.lists.b = { name: 'B', items: {} }; });       // ...writer B saves a list...
  oldWayRead.lists.a = { name: 'A', items: {} };
  store.dimData = oldWayRead;                                              // ...A writes its stale copy back
  check('(control) the old read-wait-write pattern loses the other writer\'s change', !('b' in store.dimData.lists));

  // 2. Same race through AWStore: a slow writer and a fast one, both survive.
  reset(S.emptyData());
  const slow = S.update(async (d) => { await sleep(30); d.lists.a = { name: 'A', items: {} }; });
  await sleep(5);
  const fast = S.update((d) => { d.lists.b = { name: 'B', items: {} }; });
  await Promise.all([slow, fast]);
  check('slow and fast writers both land', listsOf() === 'a,b,default');

  // 3. Mutators always see the previous writer's result (never a stale copy).
  reset(S.emptyData());
  const seen = [];
  await Promise.all(Array.from({ length: 5 }, (_, i) => S.update(async (d) => {
    seen.push(Object.keys(d.lists).length);
    await sleep(Math.random() * 5);
    d.lists['l' + i] = { name: 'L' + i, items: {} };
  })));
  check('each mutator saw every earlier writer\'s list', seen.join() === '1,2,3,4,5');
  check('all five lists were stored', Object.keys(store.dimData.lists).length === 6);

  // 4. Heavy contention: no lost updates.
  reset({ activeId: 'default', lists: { default: { name: 'M', items: {} } }, counter: 0 });
  await Promise.all(Array.from({ length: 60 }, () => S.update(async (d) => { await sleep(Math.random() * 3); d.counter++; })));
  check('60 concurrent increments all counted', store.dimData.counter === 60);

  // 5. SKIP and unchanged data cause no write (each write re-renders every view).
  reset(S.emptyData());
  await S.update(() => S.SKIP);
  check('SKIP does not write', setCalls === 0);
  await S.update(() => {});
  check('an unchanged mutator does not write', setCalls === 0);
  const r = await S.update((d) => { d.activeId = 'default'; return 'value'; });
  check('mutator return value is passed back', r === 'value');
  await S.update((d) => { d.x = 1; });
  check('a change does write once', setCalls === 1);

  // 6. `also` rides along in the same write, but only when the write happens.
  reset(S.emptyData());
  await S.update(() => S.SKIP, { also: { flag: 1 } });
  check('`also` is not written when the mutator skips', setCalls === 0 && !('flag' in store));
  await S.update((d) => { d.y = 1; }, { also: { flag: 2 } });
  check('`also` is written with the data', store.flag === 2 && store.dimData.y === 1 && setCalls === 1);

  // 7. replace() swaps the stored object and still returns a result.
  reset(S.emptyData());
  const rr = await S.update(() => S.replace({ activeId: 'default', lists: { default: { name: 'New', items: {} } } }, 'done'));
  check('replace stores the new object', store.dimData.lists.default.name === 'New');
  check('replace passes its result back', rr === 'done');

  // 8. Shape guarantees.
  reset(null);
  const fresh = await S.read();
  check('missing storage reads as an empty default list', fresh.activeId === 'default' && !!fresh.lists.default);
  check('reading does not write', setCalls === 0);
  const d1 = { activeId: 'gone', lists: { default: { name: 'M', items: {} }, x: { name: 'X' } } };
  check('ensureActiveList falls back to default when the active list is missing', S.ensureActiveList(d1) === 'default');
  const d2 = { activeId: 'x', lists: { default: { name: 'M', items: {} }, x: { name: 'X' } } };
  check('ensureActiveList returns the active list and gives it an items map', S.ensureActiveList(d2) === 'x' && !!d2.lists.x.items);
  const d3 = { activeId: 'default', lists: { x: { name: 'X', items: {} } } };
  check('ensureActiveList creates default when absent', S.ensureActiveList(d3) === 'default' && !!d3.lists.default);
  reset({ foo: 'corrupt' });
  await S.update((d) => { d.lists.q = { name: 'Q', items: {} }; });
  check('malformed stored data is repaired on the next write', !!store.dimData.lists.default && !!store.dimData.lists.q);

  // 9. A failing writer neither writes nor blocks the writers behind it.
  reset(S.emptyData());
  let threw = false;
  const bad = S.update(() => { throw new Error('boom'); }).catch(() => { threw = true; });
  const good = S.update((d) => { d.lists.ok = { name: 'OK', items: {} }; });
  await Promise.all([bad, good]);
  check('a throwing mutator rejects', threw);
  check('writers behind a failure still run', 'ok' in store.dimData.lists);
  let rejected = false;
  await S.update('not a function').catch(() => { rejected = true; });
  check('update() rejects a non-function', rejected);

  // 10. With the Web Locks API present (Chrome, both panel and service worker),
  //     the same guarantee holds through navigator.locks.
  let lockRequests = 0;
  const held = new Map();
  Object.defineProperty(global, 'navigator', {
    configurable: true,
    value: {
      locks: {
        request: (name, fn) => {
          lockRequests++;
          const prev = held.get(name) || Promise.resolve();
          const run = prev.then(() => fn());
          held.set(name, run.catch(() => {}));
          return run;
        },
      },
    },
  });
  reset({ activeId: 'default', lists: { default: { name: 'M', items: {} } }, counter: 0 });
  await Promise.all(Array.from({ length: 20 }, () => S.update(async (d) => { await sleep(Math.random() * 3); d.counter++; })));
  check('uses navigator.locks under the shared lock name when available', lockRequests === 20 && store.dimData.counter === 20);
  check('lock name is the one the service worker also uses', S.LOCK_NAME === 'aw-dimdata');
  delete global.navigator;

  if (failures) {
    console.error(`\n${failures} aw-store check(s) failed`);
    process.exit(1);
  }
  console.log('\nAll aw-store checks passed');
})().catch((e) => { console.error(e); process.exit(1); });
