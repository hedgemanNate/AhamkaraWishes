// The armor Tertiary/Spark split (D9): wishes saved before it stored the
// Tertiary as `spark`. They must migrate without changing their sync identity,
// so existing tombstones and cross-browser merges keep working, and every
// reader must understand both shapes.
const fs = require('fs');
const path = require('path');

global.window = global;
global.document = { addEventListener() {}, getElementById: () => null, querySelectorAll: () => [] };
global.chrome = { storage: { local: { get: (k, cb) => cb({}), set: (o, cb) => cb && cb() }, onChanged: { addListener() {} } } };
for (const f of ['wishlist-sync-core.js', 'weapon-wish-core.js', 'wishlist.js']) {
  eval(fs.readFileSync(path.resolve(__dirname, '..', f), 'utf8'));
}
const WS = window.WishlistSync;

let failures = 0;
function check(label, cond) { console.log(`${cond ? 'PASS' : 'FAIL'}: ${label}`); if (!cond) failures++; }
const T = Date.now() - 3600000; // recent: tombstones older than 90 days are pruned

// --- reading both shapes
const legacy = { archetype: 'GUNNER', spark: 'Class' };
const current = { archetype: 'GUNNER', tertiary: 'Class', spark: 'Super' };
check('legacy: spark is read as the Tertiary', JSON.stringify(WS.armorFields(legacy)) === '{"archetype":"GUNNER","tertiary":"Class","spark":null}');
check('current: Tertiary and Spark read separately', JSON.stringify(WS.armorFields(current)) === '{"archetype":"GUNNER","tertiary":"Class","spark":"Super"}');
check('current with null Tertiary is not mistaken for legacy', WS.armorFields({ archetype: 'GUNNER', tertiary: null, spark: 'Super' }).tertiary === null);
check('empty config reads as all-null', JSON.stringify(WS.armorFields(undefined)) === '{"archetype":null,"tertiary":null,"spark":null}');

// --- migration
const m = { archetype: 'GUNNER', spark: 'Class' };
check('migrating a legacy config reports a change', WS.migrateArmorConfig(m) === true);
check('migrated config has the current shape', m.tertiary === 'Class' && m.spark === null);
check('migrating twice is a no-op', WS.migrateArmorConfig(m) === false);
check('weapon configs are never touched', WS.migrateArmorConfig({ perks: [[1]] }) === false);
check('missing config is a no-op', WS.migrateArmorConfig(null) === false);
check('legacy with no spark migrates to an any-Tertiary wish', (() => { const c = { archetype: 'GUNNER' }; WS.migrateArmorConfig(c); return c.tertiary === null && c.spark === null; })());

// --- identity is unchanged by migration (tombstones and merges depend on it)
const oldKey = 'pve|armor:GUNNER+Class'; // exactly what the previous wishKey produced
const legacyWish = { tags: ['pve'], config: { archetype: 'GUNNER', spark: 'Class' }, raw: 'armor-wish:1', added: T };
const migratedWish = JSON.parse(JSON.stringify(legacyWish)); WS.migrateArmorConfig(migratedWish.config);
check('legacy wish keeps its old key', WS.wishKey(legacyWish) === oldKey);
check('migrated wish has the same key as before', WS.wishKey(migratedWish) === oldKey);
check('a Spark makes it a different wish', WS.wishKey({ tags: ['pve'], config: { archetype: 'GUNNER', tertiary: 'Class', spark: 'Super' } }) === 'pve|armor:GUNNER+Class~Super');
check('any-Tertiary wish has its own key', WS.wishKey({ tags: ['pve'], config: { archetype: 'GUNNER', tertiary: null, spark: null } }) === 'pve|armor:GUNNER+');
check('weapon keys are unchanged', WS.wishKey({ tags: ['pvp'], config: { perks: [[1]] }, raw: '[[1]]' }) === 'pvp|weapon:[[1]]');

// cross-browser: a migrated browser merges with one still holding the legacy shape
const item = (w) => ({ static: { name: 'h', type: 'armor' }, wishes: [w] });
const browserNew = { activeId: 'default', lists: { default: { name: 'M', items: { 1: item(migratedWish) } } } };
const browserOld = { activeId: 'default', lists: { default: { name: 'M', items: { 1: item(legacyWish) } } } };
let merged = WS.mergeDimData(browserNew, browserOld);
check('merging the two shapes keeps one wish, not two', merged.lists.default.items[1].wishes.length === 1);
// a deletion recorded by an OLD build (old key) still removes the migrated wish
const deletedOld = JSON.parse(JSON.stringify(browserOld)); deletedOld.lists.default.items = {};
WS.recordWishTombstone(deletedOld, 'default', 1, legacyWish, T + 1000);
merged = WS.mergeDimData(browserNew, deletedOld);
check('a tombstone recorded before migration still deletes the migrated wish', !merged.lists.default.items[1]);

// --- migration on load is persisted once (wishlist.js normalizer)
const data = { activeId: 'default', lists: { default: { name: 'M', items: { 1: item({ tags: ['pve'], config: { archetype: 'GUNNER', spark: 'Class' }, raw: 'x', added: T }) } } } };
check('normalizer reports the migration so it gets saved', window.awWishlist.normalizeWishlistData(data) === true);
const stored = data.lists.default.items[1].wishes[0].config;
check('normalizer migrated the stored config', stored.tertiary === 'Class' && stored.spark === null);
window.awWishlist.normalizeWishlistData(data);
check('normalizing again leaves the config as it is', stored.tertiary === 'Class' && stored.spark === null);

// --- adding through the shared rule
const d = { activeId: 'a', lists: { a: { name: 'A', items: {} } } };
const add = (config, mode = 'pve') => window.WeaponWish.addWishToList(d, 'a', { hash: 1, name: 'h', type: 'armor', rawString: 'armor-wish:1', config, mode });
add({ archetype: 'GUNNER', tertiary: 'Class', spark: null });
check('legacy-shaped duplicate of a saved wish is refused', add({ archetype: 'GUNNER', spark: 'Class' }) === 'duplicate');

// --- set backfill (armor saved without its set)
const sets = { 11: { hash: 239346083, name: 'Techsec' }, 12: { hash: 239346083, name: 'Techsec' } };
const setOf = (h) => sets[h] || null;
const bf = { activeId: 'a', lists: {
  a: { name: 'A', items: {
    11: { static: { name: 'Techsec Helm', type: 'armor', setName: 'Techsec Helm', setHash: null }, wishes: [] },
    13: { static: { name: 'Iron Forerunner Helm', type: 'armor', setHash: null }, wishes: [] },
    14: { static: { name: 'Gun', type: 'weapon' }, wishes: [] }
  } },
  b: { name: 'B', items: { 12: { static: { name: 'Techsec Plate', type: 'armor', setHash: 5 }, wishes: [] } } }
} };
check('backfill: fills only the armor that was missing its set', window.WeaponWish.fillArmorSets(bf, setOf) === 1);
check('backfill: set hash and real set name stored', bf.lists.a.items[11].static.setHash === 239346083 && bf.lists.a.items[11].static.setName === 'Techsec');
check('backfill: armor with no set stays set-less', bf.lists.a.items[13].static.setHash === null);
check('backfill: weapons untouched', !('setHash' in bf.lists.a.items[14].static));
check('backfill: an existing set hash is never overwritten', bf.lists.b.items[12].static.setHash === 5);
check('backfill: second run changes nothing', window.WeaponWish.fillArmorSets(bf, setOf) === 0);

if (failures) { console.error(`\n${failures} armor-schema check(s) failed`); process.exit(1); }
console.log('\nAll armor-schema checks passed');
