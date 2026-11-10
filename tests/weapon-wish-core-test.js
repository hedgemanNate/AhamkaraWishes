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

// --- masterwork: optional, and part of the wish's identity only when chosen ---
const HANDLING_MW = { key: 'v400.plugs.weapons.masterworks.stat.handling', name: 'Handling', icon: 'https://x/h.png', hashes: [103, 101, 102, 101] };
const RANGE_MW = { key: 'v400.plugs.weapons.masterworks.stat.range', name: 'Range', icon: '', hashes: [201, 203] };
ps = state();
ps[0].acceptable.add(1); ps[0].acceptable.add(11);
ps[2].acceptable.add(5); ps[2].acceptable.add(15);
const noMw = W.buildWeaponWishPayload(columns, ps, COLORS);
const withHandling = W.buildWeaponWishPayload(columns, ps, COLORS, HANDLING_MW);
const withRange = W.buildWeaponWishPayload(columns, ps, COLORS, RANGE_MW);
check('no masterwork leaves a wish byte-identical to before', noMw.rawString === '[[1,11],[],[5,15]]' && !('masterwork' in noMw.config));
check('null and undefined both mean "any masterwork"', W.buildWeaponWishPayload(columns, ps, COLORS, null).rawString === noMw.rawString
  && W.buildWeaponWishPayload(columns, ps, COLORS, undefined).rawString === noMw.rawString);
check('a masterwork is stored with its stat and every hash, sorted and deduped',
  JSON.stringify(withHandling.config.masterwork) === JSON.stringify({ key: HANDLING_MW.key, name: 'Handling', icon: 'https://x/h.png', hashes: [101, 102, 103] }));
check('the masterwork changes the identity', withHandling.rawString !== noMw.rawString && withHandling.rawString.endsWith(`|mw:${HANDLING_MW.key}`));
check('different masterworks are different wishes', withHandling.rawString !== withRange.rawString);
check('perks are unaffected by the masterwork', JSON.stringify(withHandling.config.perks) === JSON.stringify(noMw.config.perks)
  && JSON.stringify(withHandling.config.perkColumnsData) === JSON.stringify(noMw.config.perkColumnsData));
check('picking only a masterwork does not count as picking perks', W.buildWeaponWishPayload(columns, state(), COLORS, HANDLING_MW).hasAny === false);
check('the stored masterwork does not share arrays with the builder state', (() => {
  const mine = { key: 'k', name: 'n', hashes: [5, 6] };
  const stored = W.buildWeaponWishPayload(columns, ps, COLORS, mine).config.masterwork;
  mine.hashes.push(7);
  return stored.hashes.length === 2;
})());
const colored2 = (() => { const s = state(); s[0].acceptable.add(1); s[0].colors.set('red', 1); s[2].acceptable.add(5); s[2].colors.set('red', 5); return s; })();
check('with combos, the masterwork follows the colour signature',
  /^\[\[1\],\[\],\[5\]\]\|\[\[.*\]\]\|mw:/.test(W.buildWeaponWishPayload(columns, colored2, COLORS, HANDLING_MW).rawString));
check('hashes that are not positive whole numbers are dropped', JSON.stringify(W.cleanMasterwork({ key: 'k', hashes: [3, 'x', -1, 0, 2.5, '4'] }).hashes) === '[3,4]');
check('a choice with no usable hashes or no key means any masterwork',
  W.cleanMasterwork({ key: 'k', hashes: [] }) === null && W.cleanMasterwork({ key: 'k', hashes: 'nope' }) === null
  && W.cleanMasterwork({ hashes: [1] }) === null && W.cleanMasterwork('Handling') === null);

// duplicate rule and stored shape
d = freshData();
const mwSpec = (p, over) => spec(Object.assign({ rawString: p.rawString, config: p.config }, over || {}));
check('a wish with a masterwork is added', W.addWishToList(d, 'a', mwSpec(withHandling)) === 'added');
check('the same perks without a masterwork is its own wish', W.addWishToList(d, 'a', mwSpec(noMw)) === 'added');
check('the same perks with another masterwork is its own wish', W.addWishToList(d, 'a', mwSpec(withRange)) === 'added');
check('the same perks and masterwork again is a duplicate', W.addWishToList(d, 'a', mwSpec(withHandling)) === 'duplicate' && d.lists.a.items[877384].wishes.length === 3);
check('the masterwork is saved on the wish config', d.lists.a.items[877384].wishes[0].config.masterwork.hashes.join() === '101,102,103'
  && d.lists.a.items[877384].wishes[1].config.masterwork === undefined);

if (failures) {
  console.error(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log('\nAll weapon-wish-core checks passed');
