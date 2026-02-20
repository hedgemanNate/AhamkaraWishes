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

// Build a minimal fake profile fixture
const profile = {
  profileInventory: { data: { version: 'v1' } },
  itemSockets: { data: {
    'inst1': { sockets: [ { plugHash: 1001, reusablePlugHashes: [1001, 1002] }, { plugHash: 2001, reusablePlugHashes: [2001] } ] },
    'inst2': { sockets: [ { plugHash: 1002, reusablePlugHashes: [1002] }, { plugHash: 3001, reusablePlugHashes: [3001,3002] } ] }
  } },
  itemInstances: { data: {
    'inst1': { state: 16, itemHash: 500 },
    'inst2': { state: 0, itemHash: 500 }
  } },
  items: { data: {
    'inst1': { itemHash: 500 },
    'inst2': { itemHash: 500 }
  } },
};

const idx = global.OwnedInventoryIndex.buildOwnedIndex(profile);
console.log('Index summary: instances=', idx.byInstanceId.size, 'uniqueHashes=', idx.byItemHash.size);

// Prepare a dimData fixture
const dimData = { lists: { default: { name: 'Main Wishlist', items: {
  '500': { static: { name: 'Test Weapon', type: 'weapon' }, wishes: [ { itemHash: 500, desiredSet: [1001,3001], mustHaveSet: [1001] } ] }
} } } };

const summary = global.OwnedInventoryIndex.matchWishlist(dimData, idx);
console.log('Match summary:', summary);
console.log('Wish after match:', JSON.stringify(dimData.lists.default.items['500'].wishes[0], null, 2));

// Exit success
process.exit(0);
