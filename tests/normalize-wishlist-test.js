const fs = require('fs');
const path = require('path');
const assert = require('assert');

// Load wishlist.js into Node environment and mock chrome.storage
const modulePath = path.resolve(__dirname, '..', 'wishlist.js');
const code = fs.readFileSync(modulePath, 'utf8');
global.window = global;

// In-memory mock storage
const store = {};
global.chrome = { storage: { local: {
  get: (keys, cb) => {
    if (Array.isArray(keys)) {
      const out = {};
      for (const k of keys) out[k] = store[k];
      cb(out);
    } else if (typeof keys === 'string') cb({ [keys]: store[keys] });
    else cb(store);
  },
  set: (obj, cb) => { Object.assign(store, obj); if (cb) cb(); }
} } };

// Minimal DOM mock so wishlist.js can evaluate in Node
global.document = {
  addEventListener: (ev, fn) => { if (ev === 'DOMContentLoaded') try { fn(); } catch (e) {} },
  getElementById: () => null,
  querySelectorAll: () => [],
  createElement: () => ({ setAttribute: () => {}, appendChild: () => {}, classList: { add: () => {}, remove: () => {} }, innerHTML: '' }),
  body: { classList: { add: () => {}, remove: () => {} }, appendChild: () => {} }
};

try { eval(code); } catch (e) { console.error('Failed to eval wishlist.js:', e); process.exit(2); }

if (!global.awWishlist || !global.awWishlist.normalizeWishlistEntry) {
  console.error('normalizeWishlistEntry not exposed');
  process.exit(2);
}

// Prepare dimData with a wish missing mustHave and received fields
const dimData = { lists: { default: { name: 'Main', items: {
  '500': { static: { name: 'Test Weapon' }, wishes: [ { itemHash: 500, desired: [1001,3001] } ] }
} } } };

const changed = global.awWishlist.normalizeWishlistData(dimData);
assert.strictEqual(changed, true, 'Normalization should flag persisted change (mustHave added)');

const wish = dimData.lists.default.items['500'].wishes[0];
assert.deepStrictEqual(wish.desired, [1001,3001]);
assert.deepStrictEqual(wish.mustHave, [1001,3001]);
assert.ok(wish.desiredSet instanceof Set, 'desiredSet should be a Set');
assert.ok(wish.mustHaveSet instanceof Set, 'mustHaveSet should be a Set');
assert.strictEqual(Array.isArray(wish.receivedInstances), true);
assert.strictEqual(typeof wish.received, 'boolean');

console.log('Wishlist normalization test passed');
process.exit(0);
