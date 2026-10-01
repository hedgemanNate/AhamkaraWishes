const fs = require('fs');
const path = require('path');

// Load the browser-oriented file into Node by evaluating it with a simulated window/global
const modulePath = path.resolve(__dirname, '..', 'owned-inventory-index.js');
const code = fs.readFileSync(modulePath, 'utf8');

// Ensure global/window exists
global.window = global;

try {
  eval(code);
} catch (e) {
  console.error('Failed to evaluate owned-inventory-index.js:', e);
  process.exit(2);
}

if (!global.OwnedInventoryIndex) {
  console.error('OwnedInventoryIndex not found after eval');
  process.exit(2);
}

// Build a minimal fake profile fixture (real GetProfile component shape:
// sockets/instances live under itemComponents, and instanceId->itemHash
// comes from the profileInventory items array).
const profile = {
  profileInventory: { data: { version: 'v1', items: [
    { itemInstanceId: 'inst1', itemHash: 500 },
    { itemInstanceId: 'inst2', itemHash: 500 }
  ] } },
  itemComponents: {
    sockets: { data: {
      'inst1': { sockets: [ { plugHash: 1001 }, { plugHash: 2001 } ] },
      'inst2': { sockets: [ { plugHash: 1002 }, { plugHash: 3001 } ] }
    } },
    reusablePlugs: { data: {
      'inst1': { plugs: { '0': [ { plugItemHash: 1001 }, { plugItemHash: 1002 } ], '1': [ { plugItemHash: 2001 } ] } },
      'inst2': { plugs: { '1': [ { plugItemHash: 3001 }, { plugItemHash: 3002 } ] } }
    } },
    instances: { data: {
      'inst1': { state: 16 },
      'inst2': { state: 0 }
    } }
  }
};

const assert = require('assert');

(async () => {
  const idx = await global.OwnedInventoryIndex.buildOwnedIndex(profile);
  console.log('Index summary: instances=', idx.byInstanceId.size, 'uniqueHashes=', idx.byItemHash.size);
  assert.strictEqual(idx.byInstanceId.size, 2, 'both instances indexed');
  assert.strictEqual(idx.byItemHash.size, 1, 'one unique item hash');

  // Prepare a dimData fixture
  const dimData = { lists: { default: { name: 'Main Wishlist', items: {
    '500': { static: { name: 'Test Weapon', type: 'weapon' }, wishes: [ { itemHash: 500, desiredSet: [1001,3001], mustHaveSet: [1001] } ] }
  } } } };

  const summary = global.OwnedInventoryIndex.matchWishlist(dimData, idx);
  console.log('Match summary:', summary);
  const wish = dimData.lists.default.items['500'].wishes[0];
  console.log('Wish after match:', JSON.stringify(wish, null, 2));
  assert.strictEqual(wish.received, true, 'mustHave perk 1001 is on inst1');
  assert(wish.receivedInstances.includes('inst1'));

  console.log('Owned index test passed');
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(2); });
