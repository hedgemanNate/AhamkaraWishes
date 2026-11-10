// Masterwork choices for the weapon builder (destiny-manifest.js):
// - one option per masterwork stat, holding every tier plus the fully
//   masterworked plugs, even ones the weapon's own plug set never lists
// - options are cut to the stats the weapon has (a hand cannon's plug set
//   offers Draw Time and Charge Time too)
// - kill trackers share the masterwork category prefix but are not masterworks
// - weapons with no stat-masterwork socket (exotics) get no options
const fs = require('fs');
const path = require('path');
const vm = require('vm');

let failures = 0;
function check(label, cond) { console.log(`${cond ? 'PASS' : 'FAIL'}: ${label}`); if (!cond) failures++; }

const quiet = { log() {}, warn() {}, error() {}, groupCollapsed() {}, groupEnd() {} };
const source = fs.readFileSync(path.resolve(__dirname, '..', 'destiny-manifest.js'), 'utf8');

const HANDLING = 943549884, RANGE = 1240592695, DRAW_TIME = 447667954, CHARGE_TIME = 2961396640;
const MW_CAT = (stat) => `v400.plugs.weapons.masterworks.stat.${stat}`;
const plug = (hash, name, cat, stats, icon) => ({
  hash, displayProperties: { name, icon: icon || '' }, plug: { plugCategoryIdentifier: cat },
  investmentStats: stats.map(([statTypeHash, value]) => ({ statTypeHash, value }))
});

// Handling: tiers 1-2, a fully masterworked plug in the pool, and a second
// fully masterworked plug a weapon can drop with that the pool never lists.
// Range: tier 1 and a fully masterworked plug. Draw Time lifts Charge Time too.
const DEFS = [
  plug(101, 'Tier 1: Handling', MW_CAT('handling'), [[HANDLING, 1]]),
  plug(102, 'Tier 2: Handling', MW_CAT('handling'), [[HANDLING, 2]]),
  plug(103, 'Masterworked: Handling', MW_CAT('handling'), [[HANDLING, 10], [RANGE, 3]], '/icons/handling-mw.png'),
  plug(104, 'Masterworked: Handling', MW_CAT('handling'), [[HANDLING, 10]], '/icons/handling-mw.png'),
  plug(201, 'Tier 1: Range', MW_CAT('range'), [[RANGE, 1]], '/icons/range-t1.png'),
  plug(203, 'Masterworked: Range', MW_CAT('range'), [[RANGE, 10]], '/icons/range-mw.png'),
  plug(301, 'Tier 1: Draw Time', MW_CAT('draw_time'), [[DRAW_TIME, 1], [CHARGE_TIME, 1]]),
  plug(401, 'Kill Tracker', 'v400.plugs.weapons.masterworks.trackers', []),
  plug(501, 'Default Shader', 'shader', [])
];
const ITEMS = new Map(DEFS.map((d) => [String(d.hash), d]));
const PLUG_SETS = { 7: { reusablePlugItems: [{ plugItemHash: 101 }, { plugItemHash: 103 }, { plugItemHash: 201 }, { plugItemHash: 301 }, { plugItemHash: 401 }] } };

const MODS = 2685412949;
const weapon = (stats, socketEntries) => ({
  investmentStats: stats.map((statTypeHash) => ({ statTypeHash, value: 10 })),
  sockets: { socketCategories: [{ socketCategoryHash: MODS, socketIndexes: socketEntries.map((_, i) => i) }], socketEntries }
});
const MW_SOCKET = { singleInitialItemHash: 101, reusablePlugSetHash: 7 };

function load() {
  const ctx = { console: quiet, Map, Set, WeakMap, Promise, JSON, Object, Array, String, Number, Math, Date, Error, indexedDB: null };
  vm.createContext(ctx);
  vm.runInContext(source, ctx);
  ctx.__items = ITEMS; ctx.__sets = PLUG_SETS;
  vm.runInContext(`_invItemDefs = __items; ensurePlugSetDefsReady = async () => true; getPlugSetDef = async (h) => __sets[h] || null;`, ctx);
  return ctx;
}

(async () => {
  const ctx = load();
  const names = (r) => r.options.map((o) => o.name).join(',');

  // --- grouping
  const hc = await ctx.getWeaponMasterworkOptions(weapon([HANDLING, RANGE], [{ singleInitialItemHash: 501 }, MW_SOCKET]));
  check('finds the masterwork socket among the mods', hc.socketIndex === 1);
  check('one option per stat the weapon has, sorted by name', names(hc) === 'Handling,Range');
  const handling = hc.options.find((o) => o.name === 'Handling');
  check('the tier prefix is dropped from the name', handling.name === 'Handling');
  check('every tier and fully masterworked plug is in the group', JSON.stringify(handling.hashes) === JSON.stringify([101, 102, 103, 104]));
  check('a plug outside the weapon\'s own plug set (104) still counts', handling.hashes.includes(104));
  check('the icon comes from the fully masterworked plug', handling.icon.endsWith('/icons/handling-mw.png'));
  check('the stat is the one the tier plugs name first', handling.statHash === HANDLING);

  // --- narrowing to the weapon's own stats
  const bow = await ctx.getWeaponMasterworkOptions(weapon([DRAW_TIME, CHARGE_TIME], [MW_SOCKET]));
  check('a stat the weapon lacks is not offered', names(bow) === 'Draw Time');
  const draw = bow.options[0];
  check('a masterwork that also lifts a second stat is named for the first', draw.statHash === DRAW_TIME);

  // --- things that are not stat masterworks
  check('kill trackers and shaders are not offered', !hc.options.some((o) => /tracker|shader/i.test(o.key)));
  const exotic = await ctx.getWeaponMasterworkOptions(weapon([HANDLING], [{ singleInitialItemHash: 501 }]));
  check('a weapon with no stat-masterwork socket gets no options', exotic.options.length === 0 && exotic.socketIndex === -1);
  const noMods = await ctx.getWeaponMasterworkOptions({ investmentStats: [], sockets: { socketCategories: [], socketEntries: [] } });
  check('a weapon with no mods category gets no options', noMods.options.length === 0);
  check('a missing def gets no options', (await ctx.getWeaponMasterworkOptions(null)).options.length === 0);

  // --- an unreadable stat is kept rather than hidden
  const odd = new Map(ITEMS);
  odd.set('601', plug(601, 'Odd Thing', MW_CAT('odd'), []));
  const kept = ctx.buildMasterworkOptions([601], odd, weapon([HANDLING], []));
  check('a stat that cannot be worked out is kept, not hidden', kept.length === 1 && kept[0].statHash === null);

  // --- a re-downloaded table must not reuse the old grouping
  const next = new Map(ITEMS);
  next.set('105', plug(105, 'Tier 3: Handling', MW_CAT('handling'), [[HANDLING, 3]]));
  const regrouped = ctx.buildMasterworkOptions([101], next, weapon([HANDLING], []));
  check('a new copy of the item table is grouped afresh', regrouped[0].hashes.includes(105));

  if (failures) { console.error(`\n${failures} check(s) failed`); process.exit(1); }
  console.log('\nAll weapon masterwork option checks passed');
})();
