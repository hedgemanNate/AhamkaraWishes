// Weapon combo matching test.
//
// A wish colours perks into combos: a colour appearing in two or more columns
// names a concrete perk tuple. Once a wish defines any combo, an owned roll has
// to satisfy a WHOLE combo to count — which is what stops the per-column
// any-of rule from pairing up perks that were never wished for together.
const fs = require('fs');
const path = require('path');
const assert = require('assert');

global.window = global;
global.document = { addEventListener: () => {} };

const code = fs.readFileSync(path.resolve(__dirname, '..', 'owned-inventory-index.js'), 'utf8');
try { eval(code); } catch (e) { console.error('Failed to eval owned-inventory-index.js:', e); process.exit(2); }

const { matchWishlist, buildCombos } = global.OwnedInventoryIndex;

// Socket layout: col1 -> socket 0, col2 -> socket 1, col3 -> socket 4, col4 -> socket 5.
// Perks: barrel 100/101, mag 200, traits 300/301 (col3) and 400/401 (col4).
function makeOwned(instanceId, itemHash, bySocket) {
  const perkSockets = [];
  for (const [socketIndex, hashes] of Object.entries(bySocket)) {
    perkSockets[Number(socketIndex)] = {
      socketIndex: Number(socketIndex),
      activeHash: hashes[0],
      options: hashes
    };
  }
  return { instanceId, itemHash, rolledPerkSet: new Set(Object.values(bySocket).flat()),
           perkSockets, location: 'inventory', characterId: null, isCrafted: false };
}

function makeIndex(owned) {
  const byInstanceId = new Map(owned.map((o) => [o.instanceId, o]));
  const byItemHash = new Map();
  for (const o of owned) {
    if (!byItemHash.has(o.itemHash)) byItemHash.set(o.itemHash, new Set());
    byItemHash.get(o.itemHash).add(o.instanceId);
  }
  return { byInstanceId, byItemHash };
}

function makeWish(perkColumnsData) {
  return { tags: ['pve'], config: { perkColumnsData } };
}

function makeData(wishes) {
  return { lists: { default: { name: 'Main', items: {
    '700': { static: { name: 'Test Weapon', type: 'weapon' }, wishes }
  } } } };
}

// --- Part 1: combos are built only from colours spanning 2+ columns ---

const twoColumnColors = [
  { socketIndex: 4, colIndex: 2, hashes: [300, 301], colors: { red: [300], blue: [301] } },
  { socketIndex: 5, colIndex: 3, hashes: [400, 401], colors: { red: [400], blue: [401] } }
];
assert.deepStrictEqual(buildCombos(twoColumnColors).map((c) => c.color), ['red', 'blue'],
  'a colour in two columns is a combo');

const loneColor = [
  { socketIndex: 4, colIndex: 2, hashes: [300], colors: { red: [300] } },
  { socketIndex: 5, colIndex: 3, hashes: [400] }
];
assert.deepStrictEqual(buildCombos(loneColor), [],
  'a colour sitting in only one column is degenerate, not a combo');

assert.deepStrictEqual(buildCombos([{ socketIndex: 4, colIndex: 2, hashes: [300] }]), [],
  'no colours at all -> no combos');

// --- Part 2: the cross-product false positive this feature exists to kill ---
// Wish: red = 300 + 400, blue = 301 + 401. The old per-column any-of rule would
// have matched 300 + 401 too, because each column independently had a hit.

const comboData = makeData([makeWish(twoColumnColors)]);
const crossProduct = makeOwned('x1', 700, { 4: [300], 5: [401] });
matchWishlist(comboData, makeIndex([crossProduct]));

let wish = comboData.lists.default.items['700'].wishes[0];
assert.strictEqual(wish.received, false,
  '300 + 401 satisfies no combo — it is the mix-and-match the any-of rule used to wave through');
assert.deepStrictEqual(wish.receivedInstances, []);

// The same two perks, correctly paired, do match.
matchWishlist(comboData, makeIndex([makeOwned('x2', 700, { 4: [300], 5: [400] })]));
wish = comboData.lists.default.items['700'].wishes[0];
assert.strictEqual(wish.received, true, 'red combo fully satisfied -> received');
assert.deepStrictEqual(wish.receivedInstances, ['x2']);
assert.deepStrictEqual(wish.matchedCombos, ['red']);
assert.deepStrictEqual(wish.comboMatches, { red: ['x2'], blue: [] });
assert.strictEqual(wish.matchScore, 0.5, '1 of 2 combos satisfied');

// --- Part 3: combos are independent and may be spread across several guns ---

const spread = makeIndex([
  makeOwned('g1', 700, { 4: [300], 5: [400] }),   // red
  makeOwned('g2', 700, { 4: [301], 5: [401] }),   // blue
  makeOwned('g3', 700, { 4: [301], 5: [400] })    // neither
]);
matchWishlist(comboData, spread);
wish = comboData.lists.default.items['700'].wishes[0];
assert.strictEqual(wish.received, true);
assert.deepStrictEqual(wish.receivedInstances.sort(), ['g1', 'g2'],
  'no single gun needs to carry every combo, and g3 carries none');
assert.deepStrictEqual(wish.matchedCombos, ['red', 'blue']);
assert.strictEqual(wish.matchScore, 1, 'both combos covered, across two weapons');

// One gun satisfying both combos is counted once, against both.
matchWishlist(comboData, makeIndex([makeOwned('g4', 700, { 4: [300, 301], 5: [400, 401] })]));
wish = comboData.lists.default.items['700'].wishes[0];
assert.deepStrictEqual(wish.receivedInstances, ['g4'], 'listed once as an owned instance');
assert.deepStrictEqual(wish.comboMatches, { red: ['g4'], blue: ['g4'] }, 'credited to both combos');

// --- Part 4: enhanced hashes count as the same perk ---

const enhancedData = makeData([makeWish([
  { socketIndex: 4, colIndex: 2, hashes: [300, 350], colors: { red: [300, 350] } },
  { socketIndex: 5, colIndex: 3, hashes: [400, 450], colors: { red: [400, 450] } }
])]);
matchWishlist(enhancedData, makeIndex([makeOwned('e1', 700, { 4: [350], 5: [400] })]));
assert.strictEqual(enhancedData.lists.default.items['700'].wishes[0].received, true,
  'the enhanced form of a combo perk satisfies that combo member');

// --- Part 5: uncoloured columns still apply, as an AND alongside the combo ---

const mixedData = makeData([makeWish([
  { socketIndex: 0, colIndex: 0, hashes: [100, 101] },                       // uncoloured: any-of
  { socketIndex: 4, colIndex: 2, hashes: [300], colors: { red: [300] } },
  { socketIndex: 5, colIndex: 3, hashes: [400], colors: { red: [400] } }
])]);

matchWishlist(mixedData, makeIndex([makeOwned('m1', 700, { 0: [999], 4: [300], 5: [400] })]));
assert.strictEqual(mixedData.lists.default.items['700'].wishes[0].received, false,
  'combo satisfied but the uncoloured barrel column is not -> no match');

matchWishlist(mixedData, makeIndex([makeOwned('m2', 700, { 0: [101], 4: [300], 5: [400] })]));
assert.strictEqual(mixedData.lists.default.items['700'].wishes[0].received, true,
  'uncoloured column takes any of its perks, combo takes the exact tuple');

// --- Part 6: a plain perk beside a coloured one opens no path of its own ---

const plainBesideData = makeData([makeWish([
  // 301 is selected in col3 but wears no colour; it must not match on its own.
  { socketIndex: 4, colIndex: 2, hashes: [300, 301], colors: { red: [300] } },
  { socketIndex: 5, colIndex: 3, hashes: [400], colors: { red: [400] } }
])]);
matchWishlist(plainBesideData, makeIndex([makeOwned('p1', 700, { 4: [301], 5: [400] })]));
assert.strictEqual(plainBesideData.lists.default.items['700'].wishes[0].received, false,
  'a column holding a colour is governed by its combos alone');

// --- Part 7: wishes with no combos are untouched by any of this ---
// Same shape as before combos existed: per-column any-of, ANDed across columns.

const legacyData = makeData([makeWish([
  { socketIndex: 4, colIndex: 2, hashes: [300, 301] },
  { socketIndex: 5, colIndex: 3, hashes: [400, 401] }
])]);
matchWishlist(legacyData, makeIndex([makeOwned('l1', 700, { 4: [300], 5: [401] })]));
const legacyWish = legacyData.lists.default.items['700'].wishes[0];
assert.strictEqual(legacyWish.received, true,
  'no combos -> the old cross-product behaviour is preserved exactly');
assert.strictEqual(legacyWish.comboMatches, null, 'and no combo state is reported');
assert.deepStrictEqual(legacyWish.matchedCombos, []);

// --- Part 8: stale combo results are cleared when combos are removed ---

const editedData = makeData([makeWish(twoColumnColors)]);
matchWishlist(editedData, makeIndex([makeOwned('s1', 700, { 4: [300], 5: [400] })]));
assert.deepStrictEqual(editedData.lists.default.items['700'].wishes[0].matchedCombos, ['red']);

// User edits the wish, dropping the colours; the next match must not keep them.
editedData.lists.default.items['700'].wishes[0].config.perkColumnsData = [
  { socketIndex: 4, colIndex: 2, hashes: [300, 301] },
  { socketIndex: 5, colIndex: 3, hashes: [400, 401] }
];
matchWishlist(editedData, makeIndex([makeOwned('s1', 700, { 4: [300], 5: [400] })]));
const edited = editedData.lists.default.items['700'].wishes[0];
assert.strictEqual(edited.comboMatches, null, 'combo results cleared on re-match');
assert.deepStrictEqual(edited.matchedCombos, []);

console.log('Weapon combo match test passed');
process.exit(0);
