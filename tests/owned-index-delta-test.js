const fs = require('fs');
const path = require('path');
const assert = require('assert');

// Load the browser-oriented file into Node by evaluating it with a simulated window/global
const modulePath = path.resolve(__dirname, '..', 'owned-inventory-index.js');
const code = fs.readFileSync(modulePath, 'utf8');
global.window = global;
try { eval(code); } catch (e) { console.error('Failed to eval module:', e); process.exit(2); }

if (!global.OwnedInventoryIndex) { console.error('OwnedInventoryIndex not found'); process.exit(2); }

// Initial profile with inst1 and inst2 (real GetProfile component shape)
const profile1 = {
  profileInventory: { data: { version: 'v1', items: [
    { itemInstanceId: 'inst1', itemHash: 1000 },
    { itemInstanceId: 'inst2', itemHash: 1001 }
  ] } },
  itemComponents: {
    sockets: { data: {
      'inst1': { sockets: [ { plugHash: 101 } ] },
      'inst2': { sockets: [ { plugHash: 201 } ] }
    } },
    instances: { data: {
      'inst1': { state: 0 },
      'inst2': { state: 0 }
    } }
  }
};

(async () => {
const idx1 = await global.OwnedInventoryIndex.buildOwnedIndex(profile1);
assert(idx1.byInstanceId.has('inst1'));
assert(idx1.byInstanceId.has('inst2'));

// New profile: remove inst1, keep inst2, add inst3
const profile2 = {
  profileInventory: { data: { version: 'v2', items: [
    { itemInstanceId: 'inst2', itemHash: 1001 },
    { itemInstanceId: 'inst3', itemHash: 1002 }
  ] } },
  itemComponents: {
    sockets: { data: {
      'inst2': { sockets: [ { plugHash: 201 } ] },
      'inst3': { sockets: [ { plugHash: 301 } ] }
    } },
    instances: { data: {
      'inst2': { state: 0 },
      'inst3': { state: 0 }
    } }
  }
};

// Update existing index from new profile (should compute delta and apply)
const idxUpdated = await global.OwnedInventoryIndex.updateFromProfile(profile2);
assert(!idxUpdated.byInstanceId.has('inst1'), 'inst1 should have been removed');
assert(idxUpdated.byInstanceId.has('inst2'), 'inst2 should still exist');
assert(idxUpdated.byInstanceId.has('inst3'), 'inst3 should have been added');

// Now test applyProfileDelta directly: add inst4 and remove inst2
// Ensure lastProfile contains inst4 data so applyProfileDelta can build it
profile2.itemComponents.sockets.data['inst4'] = { sockets: [ { plugHash: 401 } ] };
profile2.itemComponents.instances.data['inst4'] = { state: 0 };
profile2.profileInventory.data.items.push({ itemInstanceId: 'inst4', itemHash: 1003 });
await global.OwnedInventoryIndex.updateFromProfile(profile2);

const before = global.OwnedInventoryIndex.getCachedIndex();
assert(before.byInstanceId.has('inst2'));

global.OwnedInventoryIndex.applyProfileDelta({ addedInstanceIds: ['inst4'], removedInstanceIds: ['inst2'] }, before);

const after = global.OwnedInventoryIndex.getCachedIndex();
assert(!after.byInstanceId.has('inst2'), 'inst2 should be removed after delta');
assert(after.byInstanceId.has('inst4'), 'inst4 should be added after delta');

console.log('Delta tests passed');
process.exit(0);
})().catch((e) => { console.error(e); process.exit(2); });
