// Shared wish logic (weapon-wish-core.js): the payload built from picked perks
// and the add-to-list duplicate/backfill rules. Used by both the side panel
// (craft view, saveItem) and the service worker (godroll.tv button), so the two
// must agree byte-for-byte on a wish's `raw` identity string.
const fs = require('fs');
const path = require('path');

global.window = global;
// Same load order as the panel and the service worker: the duplicate rule uses
// WishlistSync.wishKey, so the two can never disagree about "the same wish".
eval(fs.readFileSync(path.resolve(__dirname, '..', 'wishlist-sync-core.js'), 'utf8'));
eval(fs.readFileSync(path.resolve(__dirname, '..', 'weapon-wish-core.js'), 'utf8'));
const W = window.WeaponWish;

let failures = 0;
function check(label, cond) {
  console.log(`${cond ? 'PASS' : 'FAIL'}: ${label}`);
  if (!cond) failures++;
}

const mk = (b, e, name) => ({ base: { hash: b, name: name || `perk${b}`, icon: `/i/${b}.png` }, enhanced: e ? { hash: e } : null });
const columns = [
  { socketIndex: 1, pairs: [mk(1, 11), mk(2, 12)] },
  { socketIndex: 2, pairs: [mk(3, 13), mk(4, 14)] },
  { socketIndex: 3, pairs: [mk(5, 15), mk(6, 16)] }
];
const state = () => columns.map(() => ({ acceptable: new Set(), colors: new Map() }));
const COLORS = ['red', 'blue', 'green', 'orange'];

// --- payload: plain picks ---
let ps = state();
ps[0].acceptable.add(1); ps[0].acceptable.add(11);
ps[2].acceptable.add(5); ps[2].acceptable.add(15); ps[2].acceptable.add(6); ps[2].acceptable.add(16);
let p = W.buildWeaponWishPayload(columns, ps, COLORS);
check('hasAny true when something is picked', p.hasAny === true);
check('raw is the JSON of per-column hashes (no colour suffix when uncoloured)', p.rawString === '[[1,11],[],[5,15,6,16]]');
check('perks array mirrors raw', JSON.stringify(p.config.perks) === '[[1,11],[],[5,15,6,16]]');
check('perkColumnsData skips empty columns and keeps socket/col index',
  JSON.stringify(p.config.perkColumnsData) === JSON.stringify([
    { socketIndex: 1, colIndex: 0, hashes: [1, 11] },
    { socketIndex: 3, colIndex: 2, hashes: [5, 15, 6, 16] }
  ]));
check('perkColumns lists display data for picked perks only', p.config.perkColumns.length === 2 && p.config.perkColumns[1].length === 2);
check('plain picks carry color null', p.config.perkColumns[0][0].color === null);
check('base and enhanced hash both recorded for display', p.config.perkColumns[0][0].hash === 1 && p.config.perkColumns[0][0].enhancedHash === 11);

// --- payload: nothing picked ---
check('hasAny false when nothing is picked', W.buildWeaponWishPayload(columns, state(), COLORS).hasAny === false);

// --- payload: combos change identity ---
ps = state();
ps[0].acceptable.add(1); ps[0].acceptable.add(11); ps[0].colors.set('red', 1);
ps[2].acceptable.add(5); ps[2].acceptable.add(15); ps[2].colors.set('red', 5);
const colored = W.buildWeaponWishPayload(columns, ps, COLORS);
ps = state();
ps[0].acceptable.add(1); ps[0].acceptable.add(11);
ps[2].acceptable.add(5); ps[2].acceptable.add(15);
const plain = W.buildWeaponWishPayload(columns, ps, COLORS);
check('same perks with a combo have a different raw (never collapse)', colored.rawString !== plain.rawString && colored.rawString.includes('|'));
check('combo colours are recorded with base+enhanced', JSON.stringify(colored.config.perkColumnsData[0].colors) === '{"red":[1,11]}');
check('combo members report their colour', colored.config.perkColumns[0][0].color === 'red');
check('no combo colours => payload identical when comboColors is empty',
  W.buildWeaponWishPayload(columns, ps, []).rawString === plain.rawString);

// --- addWishToList ---
const freshData = () => ({ activeId: 'a', lists: { a: { name: 'A', items: {} }, b: { name: 'B', items: {} } } });
const spec = (over) => Object.assign({
  hash: 877384, name: 'The Martlet', type: 'weapon', rawString: '[[1]]', config: { perks: [[1]] }, mode: 'pve',
  icon: '/icon.png', classType: null, bucketHash: null, slotName: null, setName: null, setHash: null,
  linkedHashes: [7], weaponMeta: { ammoType: 1, itemTypeDisplayName: 'Pulse Rifle', damageTypeHash: 3 }
}, over || {});

let d = freshData();
check('adds a new wish', W.addWishToList(d, 'b', spec()) === 'added');
check('writes into the chosen list only', d.lists.b.items[877384].wishes.length === 1 && Object.keys(d.lists.a.items).length === 0);
const item = d.lists.b.items[877384];
check('creates item metadata', item.static.name === 'The Martlet' && item.static.icon === '/icon.png' && item.static.ammoType === 1 && item.static.linkedHashes[0] === 7);
check('wish has tags/raw/config/added', item.wishes[0].tags[0] === 'pve' && item.wishes[0].raw === '[[1]]' && typeof item.wishes[0].added === 'number');
check('same raw + same mode is a duplicate', W.addWishToList(d, 'b', spec()) === 'duplicate' && item.wishes.length === 1);
check('same raw in the other mode is a new wish', W.addWishToList(d, 'b', spec({ mode: 'pvp' })) === 'added' && item.wishes.length === 2);
check('different raw is a new wish', W.addWishToList(d, 'b', spec({ rawString: '[[2]]' })) === 'added' && item.wishes.length === 3);
check('same perks may live in another list', W.addWishToList(d, 'a', spec()) === 'added');

// armor duplicate rule: archetype + Tertiary (+ Spark) + mode
d = freshData();
const armor = (over) => spec(Object.assign({ hash: 5, type: 'armor', rawString: 'x', config: { archetype: 'PARAGON', tertiary: 'Super', spark: null } }, over || {}));
check('adds armor', W.addWishToList(d, 'a', armor()) === 'added');
check('armor duplicate ignores raw', W.addWishToList(d, 'a', armor({ rawString: 'different' })) === 'duplicate');
check('armor with another Tertiary is new', W.addWishToList(d, 'a', armor({ config: { archetype: 'PARAGON', tertiary: 'Melee', spark: null } })) === 'added');
check('armor with any Tertiary is its own wish', W.addWishToList(d, 'a', armor({ config: { archetype: 'PARAGON', tertiary: null, spark: null } })) === 'added');
check('the same archetype + Tertiary with a Spark is a different wish', W.addWishToList(d, 'a', armor({ config: { archetype: 'PARAGON', tertiary: 'Super', spark: 'Health' } })) === 'added');
check('armor in the other mode is a new wish', W.addWishToList(d, 'a', armor({ mode: 'pvp' })) === 'added');
// a legacy-shaped config is a duplicate of the same wish in the current shape, and is stored migrated
check('legacy { spark } config duplicates the same current-shape wish', W.addWishToList(d, 'a', armor({ config: { archetype: 'PARAGON', spark: 'Super' } })) === 'duplicate');
d = freshData();
W.addWishToList(d, 'a', armor({ config: { archetype: 'GUNNER', spark: 'Class' } }));
const saved = d.lists.a.items[5].wishes[0].config;
check('armor is always stored in the current shape', saved.tertiary === 'Class' && saved.spark === null);

// metadata backfill on an existing item
d = freshData();
d.lists.a.items[9] = { static: { name: '', type: 'weapon', icon: null, linkedHashes: [] }, wishes: [] };
W.addWishToList(d, 'a', spec({ hash: 9 }));
const bf = d.lists.a.items[9].static;
check('backfills missing name/icon/linkedHashes/meta', bf.name === 'The Martlet' && bf.icon === '/icon.png' && bf.linkedHashes[0] === 7 && bf.itemTypeDisplayName === 'Pulse Rifle');

// list without an items map
d = freshData(); delete d.lists.a.items;
check('creates items map when missing', W.addWishToList(d, 'a', spec()) === 'added' && !!d.lists.a.items[877384]);

check('exposes the per-column cap', W.ACCEPTABLE_CAP === 6);

if (failures) {
  console.error(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log('\nAll weapon-wish-core checks passed');
