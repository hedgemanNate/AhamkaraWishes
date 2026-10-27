// Weapon wish consistency test: verifies content-script (DIM) saved wishes —
// which store config.perks as a comma-separated string — normalize into real
// desired/mustHave hashes, and that the matcher no longer counts ANY owned
// copy as a match for them (the empty-mustHave false positive).
const fs = require('fs');
const path = require('path');
const assert = require('assert');

global.window = global;

// In-memory mock storage + minimal DOM so the modules evaluate in Node
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
global.document = {
  addEventListener: () => {},
  getElementById: () => null,
  querySelectorAll: () => [],
  createElement: () => ({ setAttribute: () => {}, appendChild: () => {}, classList: { add: () => {}, remove: () => {} }, innerHTML: '' }),
  body: { classList: { add: () => {}, remove: () => {} }, appendChild: () => {} }
};

for (const f of ['wishlist-normalize.js', 'owned-inventory-index.js']) {
  const code = fs.readFileSync(path.resolve(__dirname, '..', f), 'utf8');
  try { eval(code); } catch (e) { console.error(`Failed to eval ${f}:`, e); process.exit(2); }
}

const normalize = global.WishlistNormalize.normalizeWishlistData;

// --- Part 1: normalization of a content-script (DIM) style wish ---
// Exactly what content.js used to persist: perks as the raw URL param string.
const dimData = { lists: { default: { name: 'Main', items: {
  '700': { static: { name: 'DIM Weapon', type: 'weapon' },
           wishes: [ { tags: ['pve'], config: { perks: '1001,2002' }, raw: 'dimwishlist:item=700&perks=1001,2002' } ] }
} } } };

assert.strictEqual(normalize(dimData), true, 'normalization should mutate');
const wish = dimData.lists.default.items['700'].wishes[0];
assert.deepStrictEqual(wish.desired, [1001, 2002], 'desired parsed from perks string');
assert.deepStrictEqual(wish.mustHave, [1001, 2002], 'mustHave defaults to desired');

// Re-normalizing an entry that was ALREADY persisted broken (desired/mustHave
// saved as empty arrays by the old code) must repair it too.
const brokenData = { lists: { default: { name: 'Main', items: {
  '700': { static: { name: 'DIM Weapon', type: 'weapon' },
           wishes: [ { tags: ['pve'], config: { perks: '1001,2002' }, desired: [], mustHave: [],
                       receivedInstances: [], received: false } ] }
} } } };
normalize(brokenData);
const repaired = brokenData.lists.default.items['700'].wishes[0];
assert.deepStrictEqual(repaired.desired, [1001, 2002], 'previously-broken desired repaired');
assert.deepStrictEqual(repaired.mustHave, [1001, 2002], 'previously-broken empty mustHave repaired');

// --- Part 2: the matcher no longer false-positives ---
// Owned: one copy of the weapon WITHOUT the wished perks, one WITH them.
function makeOwned(instanceId, itemHash, perkHashes) {
  return { instanceId, itemHash, rolledPerkSet: new Set(perkHashes), perkSockets: [],
           location: 'inventory', characterId: null, isCrafted: false };
}
const idx = {
  byInstanceId: new Map([
    ['w1', makeOwned('w1', 700, [9998, 9999])],   // wrong roll
    ['w2', makeOwned('w2', 700, [1001, 2002, 3003])] // wished roll
  ]),
  byItemHash: new Map([[700, new Set(['w1', 'w2'])]])
};

const summary = global.OwnedInventoryIndex.matchWishlist(dimData, idx);
assert.strictEqual(wish.received, true, 'wished roll owned -> received');
assert.deepStrictEqual(wish.receivedInstances, ['w2'], 'ONLY the correct roll matches — not every copy');
assert.strictEqual(summary.receivedCount, 1);

// And when NO owned copy has the perks, received must be false (this is the
// case that used to false-positive when perks stayed an unparsed string).
const idxWrongOnly = {
  byInstanceId: new Map([['w1', makeOwned('w1', 700, [9998, 9999])]]),
  byItemHash: new Map([[700, new Set(['w1'])]])
};
global.OwnedInventoryIndex.matchWishlist(dimData, idxWrongOnly);
assert.strictEqual(wish.received, false, 'wrong roll only -> NOT received (no false positive)');
assert.deepStrictEqual(wish.receivedInstances, []);

// --- Part 3: linkedHashes union works for weapons in the legacy path ---
// Owned copy lives under a reissue sibling hash (701), wish saved under 700.
dimData.lists.default.items['700'].static.linkedHashes = [701];
const idxSibling = {
  byInstanceId: new Map([['w3', makeOwned('w3', 701, [1001, 2002])]]),
  byItemHash: new Map([[701, new Set(['w3'])]])
};
global.OwnedInventoryIndex.matchWishlist(dimData, idxSibling);
assert.strictEqual(wish.received, true, 'owned under sibling hash -> received');
assert.deepStrictEqual(wish.receivedInstances, ['w3']);

console.log('Weapon wish consistency test passed');
process.exit(0);
