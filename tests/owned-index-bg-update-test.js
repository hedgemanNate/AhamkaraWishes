const fs = require('fs');
const path = require('path');
const assert = require('assert');

// Eval the owned-inventory-index module into the Node global/window environment
const modulePath = path.resolve(__dirname, '..', 'owned-inventory-index.js');
const code = fs.readFileSync(modulePath, 'utf8');
global.window = global;
try { eval(code); } catch (e) { console.error('Failed to eval module:', e); process.exit(2); }
if (!global.OwnedInventoryIndex) { console.error('OwnedInventoryIndex not found'); process.exit(2); }

// Mock chrome.storage.local with an in-memory store and async API
const store = {};
global.chrome = { storage: { local: {
  get: (keys, cb) => {
    // keys can be array or single key
    if (Array.isArray(keys)) {
      const out = {};
      for (const k of keys) out[k] = store[k];
      cb(out);
    } else if (typeof keys === 'string') cb({ [keys]: store[keys] });
    else cb(store);
  },
  set: (obj, cb) => { Object.assign(store, obj); if (cb) cb(); }
} } };

// Prepare a lastBungieProfile in storage with two instances
store.lastBungieProfile = {
  profileInventory: { data: { version: 'vb1' } },
  itemSockets: { data: {
    'a1': { sockets: [ { plugHash: 11, reusablePlugHashes: [11] } ] },
    'a2': { sockets: [ { plugHash: 22, reusablePlugHashes: [22] } ] }
  } },
  itemInstances: { data: {
    'a1': { state: 0, itemHash: 900 },
    'a2': { state: 0, itemHash: 901 }
  } },
  items: { data: {
    'a1': { itemHash: 900 },
    'a2': { itemHash: 901 }
  } }
};

// Prepare dimData in storage with a wish for itemHash 900
store.dimData = { lists: { default: { name: 'Main', items: {
  '900': { static: { name: 'Test' }, wishes: [ { itemHash: 900, desiredSet: [11], mustHaveSet: [11] } ] }
} } } };

// Now simulate background update flow: read lastBungieProfile and run updateFromProfile + matchWishlist
chrome.storage.local.get(['lastBungieProfile','dimData'], (res) => {
  const lastProfile = res.lastBungieProfile;
  const dim = res.dimData;
  // call updateFromProfile
  const idx = global.OwnedInventoryIndex.updateFromProfile(lastProfile);
  assert(idx && idx.byInstanceId && idx.byInstanceId.has('a1'), 'index should contain a1');

  // run matchWishlist and persist changes
  const summary = global.OwnedInventoryIndex.matchWishlist(dim, idx);
  global.chrome.storage.local.set({ dimData: dim }, () => {
    // After persist, verify that store.dimData has received annotations
    const saved = store.dimData;
    const wish = saved.lists.default.items['900'].wishes[0];
    assert.strictEqual(wish.received, true, 'wish should be marked received');
    assert(Array.isArray(wish.receivedInstances) && wish.receivedInstances.includes('a1'));
    console.log('Background update test passed:', summary);
    process.exit(0);
  });
});
