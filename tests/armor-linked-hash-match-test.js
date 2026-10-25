// Armor matching test: verifies the two-stage archetype+Tertiary match works,
// including finding owned copies stored under a sibling (reissue) hash via
// linkedHashes — the same alias mechanism weapons use.
const fs = require('fs');
const path = require('path');

const modulePath = path.resolve(__dirname, '..', 'owned-inventory-index.js');
const code = fs.readFileSync(modulePath, 'utf8');

global.window = global;

// matchWishlistImpl's armor branch reads the ARCHETYPES global (set by
// manager.js in the real app).
global.ARCHETYPES = [
  { id: 'paragon', name: 'PARAGON', stats: ['Super', 'Melee'] },
  { id: 'gunner',  name: 'GUNNER',  stats: ['Weapons', 'Grenade'] }
];

try {
  eval(code);
} catch (e) {
  console.error('Failed to evaluate owned-inventory-index.js:', e);
  process.exit(2);
}

let failures = 0;
function check(label, cond) {
  console.log(`${cond ? 'PASS' : 'FAIL'}: ${label}`);
  if (!cond) failures++;
}

// Hand-built OwnedIndex: wish is saved under hash 100; the player's actual
// drops live under sibling hash 200 (a season reissue of the same piece).
// armorArchetype and armorTertiary are pre-computed from the base roll (as
// buildOwnedIndex does via computeArmorRoll + armor_stats socket plugs).
function makeOwned(instanceId, itemHash, archetype, tertiary) {
  return {
    instanceId, itemHash,
    rolledPerkSet: new Set(), perkSockets: [],
    location: 'inventory', characterId: null, isCrafted: false,
    armorArchetype: archetype,
    armorTertiary: tertiary
  };
}

const byInstanceId = new Map([
  // full match under the SIBLING hash: archetype + Tertiary both correct
  ['a1', makeOwned('a1', 200, 'PARAGON', 'Health')],
  // stage-1-only under the sibling hash: right archetype, wrong Tertiary
  ['a2', makeOwned('a2', 200, 'PARAGON', 'Class')],
  // wrong archetype entirely
  ['a3', makeOwned('a3', 200, 'GUNNER', 'Health')],
  // right archetype+Tertiary but under an UNRELATED hash — must not match
  ['a4', makeOwned('a4', 999, 'PARAGON', 'Health')]
]);
const byItemHash = new Map([
  [200, new Set(['a1', 'a2', 'a3'])],
  [999, new Set(['a4'])]
]);
const idx = { byInstanceId, byItemHash };

function makeDim(linkedHashes) {
  return { lists: { default: { name: 'Main', items: {
    '100': {
      static: { name: 'Test Helm', type: 'armor', linkedHashes },
      // Legacy config shape: the Tertiary was saved as `spark`.
      wishes: [{ tags: ['pve'], config: { archetype: 'PARAGON', spark: 'Health' } }]
    }
  } } } };
}

// Case 1: WITHOUT linkedHashes the owned reissue copies are invisible
const dimNoLinks = makeDim([]);
global.OwnedInventoryIndex.matchWishlist(dimNoLinks, idx);
const w0 = dimNoLinks.lists.default.items['100'].wishes[0];
check('no linkedHashes -> not received (reissue hash unreachable)', w0.received === false);

// Case 2: WITH linkedHashes the sibling-hash copies are found
const dim = makeDim([200]);
const summary = global.OwnedInventoryIndex.matchWishlist(dim, idx);
const w = dim.lists.default.items['100'].wishes[0];
check('received is true via sibling hash', w.received === true);
check('stage 2 matches exactly the full-match instance', JSON.stringify(w.receivedInstances) === '["a1"]');
check('stage 1 includes full match + archetype-only match', JSON.stringify(w.stage1Instances) === '["a1","a2"]');
check('stage1Received is true', w.stage1Received === true);
check('wrong-archetype instance excluded from both stages', !w.stage1Instances.includes('a3'));
check('unrelated hash 999 never consulted', !w.receivedInstances.includes('a4') && !w.stage1Instances.includes('a4'));
check('summary counts the received wish', summary.receivedCount === 1 && summary.totalEntries === 1);
check('matchScore is 1 on full match', w.matchScore === 1);

// Case 3: archetype right everywhere but the Tertiary owned nowhere (current config shape)
const dimNoSpark = { lists: { default: { name: 'Main', items: {
  '100': {
    static: { name: 'Test Helm', type: 'armor', linkedHashes: [200] },
    wishes: [{ tags: ['pve'], config: { archetype: 'PARAGON', tertiary: 'Weapons', spark: null } }]
  }
} } } };
global.OwnedInventoryIndex.matchWishlist(dimNoSpark, idx);
const w2 = dimNoSpark.lists.default.items['100'].wishes[0];
check('Tertiary not owned -> received false but stage1 true', w2.received === false && w2.stage1Received === true);

// Case 4: current shape, any Tertiary (D9: optional) -> every right-archetype piece matches
const dimAny = { lists: { default: { name: 'Main', items: {
  '100': { static: { name: 'Test Helm', type: 'armor', linkedHashes: [200] },
    wishes: [{ tags: ['pve'], config: { archetype: 'PARAGON', tertiary: null, spark: null } }] }
} } } };
global.OwnedInventoryIndex.matchWishlist(dimAny, idx);
const w3 = dimAny.lists.default.items['100'].wishes[0];
check('any Tertiary -> both right-archetype pieces match', JSON.stringify(w3.receivedInstances) === '["a1","a2"]' && w3.received === true);

// Case 5: current shape with a Tertiary behaves like the legacy shape
const dimCurrent = { lists: { default: { name: 'Main', items: {
  '100': { static: { name: 'Test Helm', type: 'armor', linkedHashes: [200] },
    wishes: [{ tags: ['pve'], config: { archetype: 'PARAGON', tertiary: 'Health', spark: null } }] }
} } } };
global.OwnedInventoryIndex.matchWishlist(dimCurrent, idx);
check('current shape matches the same piece as the legacy shape', JSON.stringify(dimCurrent.lists.default.items['100'].wishes[0].receivedInstances) === '["a1"]');

// Case 6: a Spark doesn't narrow matching yet (reading it from a piece is unverified, D9)
const dimSpark = { lists: { default: { name: 'Main', items: {
  '100': { static: { name: 'Test Helm', type: 'armor', linkedHashes: [200] },
    wishes: [{ tags: ['pve'], config: { archetype: 'PARAGON', tertiary: 'Health', spark: 'Super' } }] }
} } } };
global.OwnedInventoryIndex.matchWishlist(dimSpark, idx);
check('Spark set -> still matched on archetype + Tertiary only', JSON.stringify(dimSpark.lists.default.items['100'].wishes[0].receivedInstances) === '["a1"]');

process.exit(failures === 0 ? 0 : 1);
