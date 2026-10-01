const fs = require('fs');
const path = require('path');
const assert = require('assert');

const modulePath = path.resolve(__dirname, '..', 'owned-inventory-index.js');
global.window = global;
try { eval(fs.readFileSync(modulePath, 'utf8')); } catch (e) { console.error('Failed to eval module:', e); process.exit(2); }

const POSTMASTER = 215593132;
const sockets = (ids) => Object.fromEntries(ids.map((id) => [id, { sockets: [{ plugHash: 1 }] }]));

// inst1 sits on character A and is crafted (DestinyItemState.Crafted = 8, on
// the inventory item itself); inst2 is in the vault; inst3 is at the postmaster.
const profile1 = {
  responseMintedTimestamp: '2026-10-01T00:00:00Z',
  profileInventory: { data: { items: [{ itemInstanceId: 'inst2', itemHash: 20, bucketHash: 1 }] } },
  characterInventories: { data: { charA: { items: [
    { itemInstanceId: 'inst1', itemHash: 10, bucketHash: 1, state: 8 | 1 },
    { itemInstanceId: 'inst3', itemHash: 30, bucketHash: POSTMASTER }
  ] } } },
  itemComponents: { sockets: { data: sockets(['inst1', 'inst2', 'inst3']) } }
};

(async () => {
  const OI = global.OwnedInventoryIndex;
  const idx = await OI.buildOwnedIndex(profile1);
  assert.strictEqual(idx.byInstanceId.get('inst1').characterId, 'charA');
  assert.strictEqual(idx.byInstanceId.get('inst1').isCrafted, true, 'crafted read from item.state');
  assert.strictEqual(idx.byInstanceId.get('inst2').characterId, null, 'vault item has no character');
  assert.strictEqual(idx.byInstanceId.get('inst2').isCrafted, false);
  assert.strictEqual(idx.byInstanceId.get('inst3').location, 'postmaster', 'postmaster on a character inventory');

  // Same snapshot again: cached index is returned untouched.
  assert.strictEqual(await OI.buildOwnedIndex(JSON.parse(JSON.stringify(profile1))), idx);

  // inst1 moved to the vault, inst2 pulled to character B — same instance IDs,
  // so the add/remove delta alone would leave both characterIds stale.
  const profile2 = {
    responseMintedTimestamp: '2026-10-01T00:00:30Z',
    profileInventory: { data: { items: [{ itemInstanceId: 'inst1', itemHash: 10, bucketHash: 1, state: 8 }] } },
    characterInventories: { data: { charB: { items: [
      { itemInstanceId: 'inst2', itemHash: 20, bucketHash: 1 },
      { itemInstanceId: 'inst3', itemHash: 30, bucketHash: 1 }
    ] } } },
    itemComponents: { sockets: { data: sockets(['inst1', 'inst2', 'inst3']) } }
  };
  const idx2 = await OI.updateFromProfile(profile2);
  assert.strictEqual(idx2.byInstanceId.get('inst1').characterId, null, 'moved to vault');
  assert.strictEqual(idx2.byInstanceId.get('inst2').characterId, 'charB', 'moved to character');
  assert.strictEqual(idx2.byInstanceId.get('inst3').location, 'inventory', 'picked up from postmaster');

  console.log('Owned index location test passed');
})().catch((e) => { console.error(e); process.exit(1); });
