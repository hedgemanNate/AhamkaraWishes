// Armor builder rules: grouping pieces into sets, the optional Tertiary/Spark,
// and what gets saved.
const fs = require('fs');
const path = require('path');
global.window = global;
eval(fs.readFileSync(path.resolve(__dirname, '..', 'armor-builder-core.js'), 'utf8'));
const A = window.AWArmorBuilder;

let failures = 0;
function check(label, cond, detail) { console.log(`${cond ? 'PASS' : 'FAIL'}: ${label}${cond || !detail ? '' : `  (${detail})`}`); if (!cond) failures++; }

const BUCKETS = { HELMET: 1, GAUNTLETS: 2, CHEST: 3, LEGS: 4, CLASS_ITEM: 5 };
const ARCH = [{ name: 'GUNNER', stats: ['Weapons', 'Grenade'] }, { name: 'BULWARK', stats: ['Health', 'Class'] }];
const STATS = ['Weapons', 'Health', 'Class', 'Grenade', 'Super', 'Melee'];
const piece = (hash, name, bucketHash, setHash) => ({ hash, name, icon: `/i/${hash}.jpg`, classType: 0, bucketHash, setHash: setHash || null });
const setNames = { 900: 'Techsec' };
const opts = { buckets: BUCKETS, setNameOf: (h) => setNames[h] };

// --- slots and names
check('buckets map to slots', A.slotOf(1, BUCKETS) === 'Head' && A.slotOf(5, BUCKETS) === 'Class' && A.slotOf(99, BUCKETS) === null);
check('a slot word is stripped from a piece name', A.stemOf('Techsec Helm') === 'Techsec' && A.stemOf('Iron Forerunner Gauntlets') === 'Iron Forerunner' && A.stemOf('Helm') === 'Helm');

// --- grouping
const pieces = [
  piece(10, 'Techsec Helm', 1, 900), piece(11, 'Techsec Plate', 3, 900), piece(12, 'Techsec Helm', 1, 900), // a reissue
  piece(20, 'Iron Forerunner Helm', 1), piece(21, 'Iron Forerunner Greaves', 4),
  piece(30, 'Odd Thing', 99, 901)
];
const sets = A.groupArmorSets(pieces, opts);
check('pieces group by set, sorted by name', sets.map((s) => s.name).join() === 'Iron Forerunner,Techsec', sets.map((s) => s.name).join());
check('one piece per slot, the first wins (reissues are found again on save)', sets[1].count === 2 && sets[1].pieces.Head.hash === 10);
check('pieces the game puts in no set group by name', sets[0].setHash === null && sets[0].count === 2 && sets[0].pieces.Legs.hash === 21);
check('things that are not armor slots are skipped', !sets.some((s) => s.name === 'Odd Thing') && A.groupArmorSets(null, opts).length === 0);

// --- the roll
check('tertiary choices leave out the archetype’s own stats', A.tertiaryChoices(ARCH, STATS, 'GUNNER').join() === 'Health,Class,Super,Melee' && A.tertiaryChoices(ARCH, STATS, null).length === 6);
check('a tertiary the archetype covers is cleared', A.normalizePick({ archetype: 'GUNNER', tertiary: 'Weapons' }, ARCH, STATS).tertiary === null);
check('a valid tertiary stays, and with no archetype there is none', A.normalizePick({ archetype: 'GUNNER', tertiary: 'Melee' }, ARCH, STATS).tertiary === 'Melee' && A.normalizePick({ tertiary: 'Melee' }, ARCH, STATS).tertiary === null);
check('spark may be any stat, including one the archetype has', A.normalizePick({ archetype: 'GUNNER', spark: 'Weapons' }, ARCH, STATS).spark === 'Weapons');
check('unknown values drop out', JSON.stringify(A.normalizePick({ archetype: 'NOPE', tertiary: 'x', spark: 'y' }, ARCH, STATS)) === '{"archetype":null,"tertiary":null,"spark":null}' && A.normalizePick(null, ARCH, STATS).archetype === null);
check('the saved config always carries every key (current shape)', JSON.stringify(A.configFor({ archetype: 'GUNNER' })) === '{"archetype":"GUNNER","tertiary":null,"spark":null}');

// --- readiness
check('Save says what is missing', A.missing(0, { archetype: 'GUNNER' }) === 'Choose at least one piece.' && A.missing(2, {}) === 'Choose an archetype.' && A.missing(2, { archetype: 'GUNNER' }) === null);

// --- saving
const plan = A.planSaves([sets[1].pieces.Head, sets[1].pieces.Chest], { archetype: 'GUNNER', tertiary: 'Melee', spark: null }, { buckets: BUCKETS, setName: 'Techsec' });
check('one wish per piece, with the same roll', plan.length === 2 && plan.every((p) => p.config.archetype === 'GUNNER' && p.config.tertiary === 'Melee'));
check('each wish is identified by its piece and carries slot and set', plan[0].rawString === 'armor-wish:10' && plan[0].slotName === 'Head' && plan[1].slotName === 'Chest' && plan[0].setName === 'Techsec' && plan[0].setHash === 900);
check('the summary is honest', A.saveSummary({ added: 3, duplicate: 0, failed: 0 }) === '3 wishes added.'
  && A.saveSummary({ added: 1, duplicate: 0, failed: 0 }) === '1 wish added.'
  && A.saveSummary({ added: 0, duplicate: 1, failed: 0 }) === 'That wish is already on your list.'
  && A.saveSummary({ added: 0, duplicate: 0, failed: 2 }).startsWith('Couldn’t save')
  && /2 wishes added\. 1 not saved \(1 already there\)/.test(A.saveSummary({ added: 2, duplicate: 1, failed: 0 })));
check('the button names what it does', A.saveLabel(1, false) === 'Save wish' && A.saveLabel(3, false) === 'Save 3 wishes' && A.saveLabel(1, true) === 'Update roll');

if (failures) { console.error(`\n${failures} armor-builder-core check(s) failed`); process.exit(1); }
console.log('\nAll armor-builder-core checks passed');
