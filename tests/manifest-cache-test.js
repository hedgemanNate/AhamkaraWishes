// Manifest caching (destiny-manifest.js) against a fake Bungie and a fake
// IndexedDB:
// - concurrent callers share one download (startup used to fetch the ~200 MB
//   item table twice: once directly, once via getArmorSetLookup)
// - each table keeps its own manifest version, so one table refreshing can't
//   mark the others current
// - the armor set table is found under Bungie's real name ("Equipable")
// - set names and 2-/4-piece bonuses come from Bungie's set and perk tables
const fs = require('fs');
const path = require('path');
const vm = require('vm');

let failures = 0;
function check(label, cond) { console.log(`${cond ? 'PASS' : 'FAIL'}: ${label}`); if (!cond) failures++; }

const quiet = { log() {}, warn() {}, error() {}, groupCollapsed() {}, groupEnd() {} };
const source = fs.readFileSync(path.resolve(__dirname, '..', 'destiny-manifest.js'), 'utf8');

const ARMOR = (hash, name, setHash) => ({
  hash, itemType: 2, equippable: true, classType: 0, inventory: { bucketTypeHash: 3448274439 },
  displayProperties: { name, icon: '' }, equippingBlock: setHash ? { equipableItemSetHash: setHash } : {}
});
const TABLES = {
  DestinyInventoryItemDefinition: {
    // Piece names share more than the set's name, so guessing from them
    // ("Techsec Command") gives a different answer than Bungie's table.
    1: ARMOR(1, 'Helm of Techsec Command', 239346083),
    2: ARMOR(2, 'Techsec Command Plate', 239346083),
    3: ARMOR(3, 'Iron Forerunner Helm', null)
  },
  DestinyEquipableItemSetDefinition: {
    239346083: { hash: 239346083, displayProperties: { name: 'Techsec' }, setItems: [1, 2],
      setPerks: [{ requiredSetCount: 4, sandboxPerkHash: 11 }, { requiredSetCount: 2, sandboxPerkHash: 10 }] }
  },
  DestinySandboxPerkDefinition: {
    10: { displayProperties: { name: 'Wrecker', description: 'More Kinetic damage to shields.', hasIcon: true, icon: '/common/destiny2_content/icons/wrecker.png' } },
    11: { displayProperties: { name: 'Concussive Rounds', description: 'Breaking a shield releases a shockwave.' } }
  },
  DestinyPlugSetDefinition: { 5: { reusablePlugItems: [] } }
};

// v2 of the game data adds a third Techsec piece, so a rebuilt lookup is visible.
const VERSIONED = { v2: { DestinyInventoryItemDefinition: { ...TABLES.DestinyInventoryItemDefinition, 4: ARMOR(4, 'Techsec Command Gauntlets', 239346083) } } };

/** A fresh copy of the module with its own fake network and database. */
function load({ version = 'v1', offline = false, idb = new Map() } = {}) {
  const net = { version, offline, downloads: [], metaCalls: 0 };
  const ctx = {
    console: quiet, TextDecoder, Response, Blob, Map, Set, Promise, JSON, Date, Object, Array, String, Number, Error, Math, Uint8Array,
    indexedDB: null,
    fetch: async (url) => {
      if (net.hang) return new Promise(() => {}); // Bungie never answers
      if (net.offline) throw new Error('offline');
      if (url.includes('/Platform/Destiny2/Manifest/')) {
        net.metaCalls++;
        const paths = {};
        for (const t of Object.keys(TABLES)) paths[t] = `/content/${net.version}/${t}.json`;
        return { ok: true, json: async () => ({ Response: { version: net.version, jsonWorldComponentContentPaths: { en: paths } } }) };
      }
      const [, , ver, file] = url.split('/').slice(-4);
      const table = file.replace('.json', '');
      net.downloads.push(table);
      await new Promise((r) => setTimeout(r, 5)); // let concurrent callers overlap
      const body = Buffer.from(JSON.stringify((VERSIONED[ver] || {})[table] || TABLES[table]));
      return { ok: true, headers: { get: () => 'application/json' }, arrayBuffer: async () => body };
    }
  };
  vm.createContext(ctx);
  vm.runInContext(source, ctx);
  // Swap IndexedDB for a Map: { "<store>:<key>" -> value }.
  ctx.__idb = idb;
  vm.runInContext(`
    idbGet = async (key, store) => (__idb.has(store + ':' + key) ? __idb.get(store + ':' + key) : null);
    idbSet = async (key, value, store) => { __idb.set(store + ':' + key, value); };
  `, ctx);
  return { ctx, net, idb };
}

(async () => {
  // --- one download per table, however many callers ask at once
  let { ctx, net } = load();
  await Promise.all([
    ctx.ensureInventoryItemDefsReady({ force: false }),
    ctx.ensureEquippableItemSetDefsReady({ force: false }),
    ctx.getArmorSetLookup(), // loads the item defs itself when the cache is empty
    ctx.loadInventoryItemDefsToMemory()
  ]);
  const count = (t) => net.downloads.filter((d) => d === t).length;
  check('startup downloads the item table once, not twice', count('DestinyInventoryItemDefinition') === 1);
  check('startup downloads the set table once', count('DestinyEquipableItemSetDefinition') === 1);
  check('one manifest check serves every table', net.metaCalls === 1);

  // --- real set names and bonuses
  const lookup = await ctx.getArmorSetLookup();
  check('set name comes from Bungie\'s set table', ctx.getArmorSetName(239346083) === 'Techsec');
  check('both Techsec pieces are in one set', lookup.get('239346083').items.length === 2);
  check('a piece with no set has no set entry', ![...lookup.values()].some((s) => s.items.some((i) => i.hash === '3')));
  const bonuses = await ctx.getArmorSetBonuses(239346083);
  check('set bonuses: 2-piece then 4-piece', bonuses.length === 2 && bonuses[0].count === 2 && bonuses[1].count === 4);
  check('set bonuses carry name and description', bonuses[0]?.name === 'Wrecker' && /shields/.test(bonuses[0]?.description));
  check('set bonus carries the perk icon path (empty when none)', bonuses[0].icon === '/common/destiny2_content/icons/wrecker.png' && bonuses[1].icon === '');
  check('no set -> no set bonus', (await ctx.getArmorSetBonuses(null)).length === 0);
  check('unknown set -> no set bonus', (await ctx.getArmorSetBonuses(999)).length === 0);
  check('set hash looked up from the item definition', (await ctx.getArmorSetHashForItem(2)) === 239346083);
  check('no set hash for a piece without a set', (await ctx.getArmorSetHashForItem(3)) === null);
  check('bonus perk with no name is skipped', ctx.describeSetBonuses([{ requiredSetCount: 2, sandboxPerkHash: 404 }], new Map()).length === 0);

  // --- up to date: no downloads
  const idb = load().idb; // fresh db
  ({ ctx, net } = load({ idb }));
  await ctx.ensureInventoryItemDefsReady();
  ({ ctx, net } = load({ idb })); // next panel open, same version
  await ctx.ensureInventoryItemDefsReady();
  check('cached and current: nothing downloaded', net.downloads.length === 0);

  // --- Bungie updates: every table refreshes, not just the first one asked
  await ctx.ensurePlugSetDefsReady();
  ({ ctx, net } = load({ idb, version: 'v2' }));
  await ctx.ensurePlugSetDefsReady(); // small table refreshes first...
  await ctx.ensureInventoryItemDefsReady(); // ...and must not mark this one current
  check('after an update the item table still refreshes', net.downloads.includes('DestinyInventoryItemDefinition'));
  check('each table records its own version', idb.get('meta:version:DestinyInventoryItemDefinition') === 'v2' && idb.get('meta:version:DestinyPlugSetDefinition') === 'v2');

  // --- caches from before per-table versions aren't re-downloaded needlessly
  const old = new Map([['meta:manifestVersion', 'v1'], ['blobs:DestinyInventoryItemDefinition', TABLES.DestinyInventoryItemDefinition]]);
  ({ ctx, net } = load({ idb: old }));
  await ctx.ensureInventoryItemDefsReady();
  check('old shared version key is honoured once (no 200 MB re-download)', net.downloads.length === 0);

  // --- a table confirmed this session needs no more network round trips
  // (matching passes ask for perk columns while holding the dimData lock)
  ({ ctx, net } = load({ idb }));
  await ctx.ensurePlugSetDefsReady();
  vm.runInContext('_metaPromise = null;', ctx); // the 5-minute manifest answer has expired
  net.hang = true; // any network use now never finishes
  const answer = await Promise.race([ctx.ensurePlugSetDefsReady(), new Promise((r) => setTimeout(() => r('hung'), 100))]);
  check('confirmed table: answered without the network (no hang under the dimData lock)', answer === true);

  // --- old shared key: trusted for the item table only
  const legacyAll = new Map([['meta:manifestVersion', 'v1'],
    ['blobs:DestinyInventoryItemDefinition', TABLES.DestinyInventoryItemDefinition],
    ['blobs:DestinyPlugSetDefinition', TABLES.DestinyPlugSetDefinition]]);
  ({ ctx, net } = load({ idb: legacyAll }));
  await ctx.ensurePlugSetDefsReady();
  check('old shared key: small tables re-check once (it may have been written by another table)', net.downloads.includes('DestinyPlugSetDefinition'));

  // --- first open after an update, with no lookup built yet: the build that
  // started on the old copy must still leave names (and a rebuild) behind
  const firstOpen = new Map();
  ({ ctx } = load({ idb: firstOpen }));
  await ctx.ensureInventoryItemDefsReady(); // v1 cached, nothing in memory
  ({ ctx, net } = load({ idb: firstOpen, version: 'v2' }));
  await Promise.all([ctx.ensureInventoryItemDefsReady(), ctx.ensureEquippableItemSetDefsReady(), ctx.getArmorSetLookup()]);
  check('first open after an update: set names available', ctx.getArmorSetName(239346083) === 'Techsec');
  await new Promise((r) => setTimeout(r, 50));
  check('first open after an update: rebuilt from the new table', (await ctx.getArmorSetLookup()).get('239346083').items.length === 3);

  // --- a Bungie update during startup must not blank set names
  const stale = new Map();
  ({ ctx } = load({ idb: stale })); // cache everything at v1
  await Promise.all([ctx.ensureInventoryItemDefsReady(), ctx.ensureEquippableItemSetDefsReady(), ctx.getArmorSetLookup()]);
  ({ ctx, net } = load({ idb: stale, version: 'v2' })); // next open: Bungie has v2
  await Promise.all([ctx.ensureInventoryItemDefsReady(), ctx.ensureEquippableItemSetDefsReady(), ctx.getArmorSetLookup()]);
  check('update at startup: set names still answer (old copy kept while rebuilding)', ctx.getArmorSetName(239346083) === 'Techsec');
  await new Promise((r) => setTimeout(r, 50));
  const rebuilt = await ctx.getArmorSetLookup();
  check('update at startup: the lookup is rebuilt from the new item table', rebuilt.get('239346083').items.length === 3 && ctx.getArmorSetName(239346083) === 'Techsec');

  // --- offline
  ({ ctx, net } = load({ idb, offline: true, version: 'v3' }));
  check('offline with a cached copy: usable', (await ctx.ensureInventoryItemDefsReady()) === true);
  ({ ctx, net } = load({ offline: true }));
  check('offline with no copy: not usable', (await ctx.ensureInventoryItemDefsReady()) === false);
  ({ ctx, net } = load({ offline: true }));
  check('offline with nothing cached: the set lookup fails cleanly instead of hanging', await ctx.getArmorSetLookup().then(() => false, () => true));

  // --- a failed download is not remembered as running
  ({ ctx, net } = load({ offline: true }));
  await ctx.ensureEquippableItemSetDefsReady();
  net.offline = false;
  check('retry after a failure downloads', (await ctx.ensureEquippableItemSetDefsReady()) === true);

  if (failures) { console.error(`\n${failures} manifest-cache check(s) failed`); process.exit(1); }
  console.log('\nAll manifest-cache checks passed');
})().catch((e) => { console.error(e); process.exit(1); });
