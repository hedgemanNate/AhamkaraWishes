// Editing a wish and cross-browser sync (wishlist-sync-core.js replaceWish).
//
// An edit that changes a wish's identity (its perks, or archetype+spark) is
// really "delete the old wish, add a new one". If the old one isn't
// tombstoned, merging with a browser that still has it brings it back next to
// the edited wish.
const fs = require('fs');
const path = require('path');

global.window = global;
eval(fs.readFileSync(path.resolve(__dirname, '..', 'wishlist-sync-core.js'), 'utf8'));
const WS = window.WishlistSync;

let failures = 0;
function check(label, cond) {
  console.log(`${cond ? 'PASS' : 'FAIL'}: ${label}`);
  if (!cond) failures++;
}

const clone = (o) => JSON.parse(JSON.stringify(o));
const weaponWish = (raw, added) => ({ tags: ['pve'], config: { perks: [] }, raw, added });
const armorWish = (arch, spark, added) => ({ tags: ['pve'], config: { archetype: arch, spark }, raw: 'armor-wish:9', added });
const dataWith = (hash, wishes) => ({ activeId: 'default', lists: { default: { name: 'Main', items: { [hash]: { static: { name: 'x', type: 'weapon' }, wishes } } } } });
const wishesOf = (d, hash) => d.lists.default.items[hash].wishes;
// Recent on purpose: the sync core prunes tombstones older than 90 days.
const T0 = Date.now() - 60 * 60 * 1000;

// --- weapon: perks changed ---
let browserA = dataWith(100, [weaponWish('[[1]]', T0)]);
const browserB = clone(browserA);                        // another browser still has the old wish

const next = weaponWish('[[2]]', T0);
check('replaceWish reports success', WS.replaceWish(browserA, 'default', 100, 0, next, T0 + 1000) === true);
check('the edit replaced the wish in place', wishesOf(browserA, 100).length === 1 && wishesOf(browserA, 100)[0].raw === '[[2]]');
check('changing identity gives the edit a fresh timestamp', wishesOf(browserA, 100)[0].added === T0 + 1000);
check('changing identity tombstones the old wish', Object.keys(browserA.tombstones?.wishes?.default?.[100] || {}).length === 1);

let merged = WS.mergeDimData(browserA, browserB);
check('merge with a browser holding the old wish does NOT resurrect it', wishesOf(merged, 100).length === 1 && wishesOf(merged, 100)[0].raw === '[[2]]');
merged = WS.mergeDimData(browserB, browserA);
check('same result from the other direction', wishesOf(merged, 100).length === 1 && wishesOf(merged, 100)[0].raw === '[[2]]');

// --- editing back to an earlier identity must survive its own tombstone ---
WS.replaceWish(browserA, 'default', 100, 0, weaponWish('[[1]]', T0), T0 + 5000);
check('editing back gets a newer timestamp than the tombstone it must outlive', wishesOf(browserA, 100)[0].added === T0 + 5000);
merged = WS.mergeDimData(browserA, browserB);
check('a wish edited back to its original identity survives the merge', wishesOf(merged, 100).some((w) => w.raw === '[[1]]'));

// --- an edit that keeps the same identity is not a delete ---
const keep = dataWith(100, [weaponWish('[[1]]', T0)]);
const same = weaponWish('[[1]]', T0);
same.tags = ['pve'];
WS.replaceWish(keep, 'default', 100, 0, same, T0 + 9000);
check('same identity: no tombstone', !keep.tombstones);
check('same identity: original timestamp kept', wishesOf(keep, 100)[0].added === T0);

// --- mode change is an identity change (identity is scoped to PvE/PvP) ---
const modeData = dataWith(100, [weaponWish('[[1]]', T0)]);
const pvp = weaponWish('[[1]]', T0);
pvp.tags = ['pvp'];
WS.replaceWish(modeData, 'default', 100, 0, pvp, T0 + 1);
check('switching PvE to PvP tombstones the PvE wish', !!modeData.tombstones?.wishes?.default?.[100]?.['pve|weapon:[[1]]']);

// --- armor: archetype/spark change ---
const armorA = dataWith(9, [armorWish('GUNNER', 'Weapons', T0)]);
const armorB = clone(armorA);
WS.replaceWish(armorA, 'default', 9, 0, armorWish('GUNNER', 'Grenade', T0), T0 + 1000);
check('armor spark change tombstones the old archetype+spark', !!armorA.tombstones?.wishes?.default?.[9]?.['pve|armor:GUNNER+Weapons']);
merged = WS.mergeDimData(armorA, armorB);
check('armor: old wish is not resurrected by sync', wishesOf(merged, 9).length === 1 && wishesOf(merged, 9)[0].config.spark === 'Grenade');

// --- bad inputs ---
const empty = dataWith(100, [weaponWish('[[1]]', T0)]);
check('no wish at that index: returns false and changes nothing', WS.replaceWish(empty, 'default', 100, 5, weaponWish('[[2]]', T0)) === false && wishesOf(empty, 100)[0].raw === '[[1]]');
check('unknown item: returns false', WS.replaceWish(empty, 'default', 999, 0, weaponWish('[[2]]', T0)) === false);
check('unknown list: returns false', WS.replaceWish(empty, 'nope', 100, 0, weaponWish('[[2]]', T0)) === false);
check('missing replacement: returns false', WS.replaceWish(empty, 'default', 100, 0, null) === false);

// --- locateWish: rows find their wish by identity, not just position ---
// A row drawn from [A, B, C] remembers (index 1, key of B). If C was deleted on
// another browser and A arrived from sync in front, index 1 is now someone else.
const A = weaponWish('[[1]]', T0), B = weaponWish('[[2]]', T0), C = weaponWish('[[3]]', T0);
const keyB = WS.wishKey(B);
check('locateWish: index still right -> that index', WS.locateWish([A, B, C], 1, keyB) === 1);
check('locateWish: list shifted -> finds the wish where it moved', WS.locateWish([B, C], 1, keyB) === 0);
check('locateWish: wish gone -> -1, never a neighbour', WS.locateWish([A, C], 1, keyB) === -1);
check('locateWish: index past the end -> searches', WS.locateWish([C, B], 7, keyB) === 1);
check('locateWish: no key -> trusts the index (old callers)', WS.locateWish([A, B], 1) === 1);
check('locateWish: no key, index out of range -> -1', WS.locateWish([A], 3) === -1);
check('locateWish: missing wishes array -> -1', WS.locateWish(undefined, 0, keyB) === -1);
check('locateWish: same perks in the other mode is a different wish', (() => {
  const pvpB = weaponWish('[[2]]', T0); pvpB.tags = ['pvp'];
  return WS.locateWish([pvpB], 0, keyB) === -1;
})());
check('locateWish: armor wish found in either config shape', (() => {
  const legacy = armorWish('GUNNER', 'Class', T0); // Tertiary still in `spark`
  const key = WS.wishKey({ tags: ['pve'], config: { archetype: 'GUNNER', tertiary: 'Class', spark: null } });
  return WS.locateWish([armorWish('GUNNER', 'Super', T0), legacy], 0, key) === 1;
})());

// --- restoreWish: Undo for a delete
{
  const gone = weaponWish('[[7]]', T0);
  const keep = weaponWish('[[8]]', T0);
  const stat = { name: 'x', type: 'weapon' };
  const mine = dataWith(100, [weaponWish('[[6]]', T0), gone, keep]);
  const other = clone(mine);                        // another browser that hasn't seen the delete
  const [removed] = wishesOf(mine, 100).splice(1, 1);
  WS.recordWishTombstone(mine, 'default', 100, removed, T0 + 1000);
  check('delete: other browser would remove it on merge', wishesOf(WS.mergeDimData(mine, other), 100).length === 2);
  check('restore puts the wish back at its old position', WS.restoreWish(mine, 'default', 100, removed, stat, 1, T0 + 2000) === true && wishesOf(mine, 100)[1].raw === '[[7]]');
  check('restore withdraws the tombstone', !mine.tombstones.wishes.default[100]['pve|weapon:[[7]]']);
  check('restore stamps the wish newer than the delete', wishesOf(mine, 100)[1].added > T0 + 1000);
  check('after Undo, a merge with a browser that saw neither keeps the wish', wishesOf(WS.mergeDimData(mine, other), 100).some((w) => w.raw === '[[7]]'));
  const sawDelete = clone(mine); delete sawDelete.lists.default.items[100].wishes[1];
  sawDelete.lists.default.items[100].wishes = sawDelete.lists.default.items[100].wishes.filter(Boolean);
  WS.recordWishTombstone(sawDelete, 'default', 100, removed, T0 + 1000);
  check('after Undo, a browser still holding the old tombstone does not delete it again', wishesOf(WS.mergeDimData(mine, sawDelete), 100).some((w) => w.raw === '[[7]]'));
  check('restoring a wish that is already there is refused', WS.restoreWish(mine, 'default', 100, clone(removed), stat, 0, T0 + 3000) === false && wishesOf(mine, 100).length === 3);

  // the last wish on an item: the item itself comes back
  const solo = dataWith(200, [weaponWish('[[9]]', T0)]);
  const [last] = wishesOf(solo, 200).splice(0, 1);
  WS.recordWishTombstone(solo, 'default', 200, last, T0 + 500);
  delete solo.lists.default.items[200];
  check('restoring the last wish brings the item back with its details', WS.restoreWish(solo, 'default', 200, last, stat, 0, T0 + 900) === true && solo.lists.default.items[200].static.name === 'x' && wishesOf(solo, 200).length === 1);
  check('restore into a missing list does nothing', WS.restoreWish(solo, 'nope', 200, clone(last), stat, 0) === false);
}

if (failures) {
  console.error(`\n${failures} wish-edit-sync check(s) failed`);
  process.exit(1);
}
console.log('\nAll wish-edit-sync checks passed');
