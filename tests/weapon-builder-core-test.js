// Weapon builder rules: painting combo colours (a perk may wear several), the one-perk-
// per-colour-per-column rule, the cap, and that what it builds is what the saved wish and
// the matcher already read.
const fs = require('fs');
const path = require('path');
global.window = global;
for (const f of ['weapon-wish-core.js', 'weapon-builder-core.js']) eval(fs.readFileSync(path.resolve(__dirname, '..', f), 'utf8'));
const B = window.AWWeaponBuilder;

let failures = 0;
function check(label, cond, detail) { console.log(`${cond ? 'PASS' : 'FAIL'}: ${label}${cond || !detail ? '' : `  (${detail})`}`); if (!cond) failures++; }

const COLORS = ['red', 'blue', 'green', 'orange'];
const perk = (hash, name, extra) => Object.assign({ hash, name, icon: `/i/${hash}.jpg`, stats: [] }, extra);
const pair = (hash, name, enh) => ({ base: perk(hash, name), enhanced: enh ? perk(enh, `${name}+`, { isEnhanced: true, stats: [{ hash: 1, value: 10 }, { hash: 2, value: -5, conditional: true }] }) : null });
const columns = [
  { socketIndex: 1, pairs: [pair(11, 'Smallbore'), pair(12, 'Arrowhead')] },
  { socketIndex: 2, pairs: [pair(21, 'Tactical'), pair(22, 'Extended')] },
  { socketIndex: 3, pairs: [pair(31, 'Rampage', 131), pair(32, 'Outlaw'), pair(33, 'Kill Clip')] },
  { socketIndex: 4, pairs: [pair(41, 'Frenzy'), pair(42, 'Rapid Hit')] }
];
const paint = (st, col, hash, brush, cap) => B.paint(st, columns, col, hash, brush, COLORS, cap);

// --- painting
let st = B.emptyState(columns);
check('a fresh state picks nothing', B.isEmpty(st));
let r = paint(st, 2, 31, 'red');
check('painting a colour picks the perk, base and enhanced', r.changed && r.picked && st[2].acceptable.has(31) && st[2].acceptable.has(131) && st[2].colors.get('red') === 31);
r = paint(st, 2, 31, 'blue');
check('one perk can wear two combo colours', JSON.stringify(B.coloursOf(st[2], 31, COLORS)) === '["red","blue"]' && r.colours.length === 2);
r = paint(st, 2, 31, 'red');
check('tapping a colour it wears takes just that colour off', JSON.stringify(B.coloursOf(st[2], 31, COLORS)) === '["blue"]' && B.isPicked(st[2], columns[2].pairs[0]));
paint(st, 2, 31, 'blue');
check('taking off its last colour takes the perk off, enhanced hash too', st[2].acceptable.size === 0 && st[2].colors.size === 0);

// --- one perk per colour per column
paint(st, 2, 31, 'red');
r = paint(st, 2, 32, 'red');
check('a colour another perk holds moves to the tapped perk', st[2].colors.get('red') === 32 && r.moved === 31);
check('the perk that lost it stays picked (nothing silently dropped)', st[2].acceptable.has(31) && B.coloursOf(st[2], 31, COLORS).length === 0);
check('a column never holds a colour twice', [...st[2].colors.values()].filter((h) => h === 31).length === 0 && st[2].colors.size === 1);

// --- the "any" brush
st = B.emptyState(columns);
paint(st, 0, 11, 'any');
check('"any" picks a plain perk, in no combo', st[0].acceptable.has(11) && st[0].colors.size === 0);
paint(st, 0, 11, 'any');
check('"any" again takes it off', st[0].acceptable.size === 0);
paint(st, 0, 11, 'red'); paint(st, 0, 11, 'any');
check('"any" on a coloured perk takes it off with its colours', st[0].acceptable.size === 0 && st[0].colors.size === 0);

// --- the cap
st = B.emptyState(columns);
r = paint(st, 2, 31, 'any', 2); paint(st, 2, 32, 'any', 2); r = paint(st, 2, 33, 'any', 2);
check('the cap refuses a new perk, with a reason', !r.changed && r.reason === 'cap' && B.pickedCount(st[2], columns[2]) === 2);
r = paint(st, 2, 32, 'red', 2);
check('the cap does not stop recolouring a perk already picked', r.changed);
check('bad input never throws', !paint(st, 9, 1, 'red').changed && !paint(st, 0, 999, 'red').changed && !paint(st, 0, 11, 'purple').changed);

// --- combos, preview, stats
st = B.emptyState(columns);
paint(st, 0, 11, 'red'); paint(st, 2, 31, 'red'); paint(st, 2, 32, 'blue'); paint(st, 3, 41, 'blue');
check('used colours, in order', JSON.stringify(B.usedColours(st, COLORS)) === '["red","blue"]');
check('a combo says how many columns it spans', B.comboSpan(st, 'red') === 2 && B.comboSpan(st, 'blue') === 2 && B.comboSpan(st, 'green') === 0);
const plugs = B.comboPlugs(columns, st, 'red');
check('a combo previews its perks, enhanced when there is one', plugs.map((p) => p.plug.hash).join() === '11,131');
check('stat changes add up and skip conditional ones', JSON.stringify([...B.statDeltas(plugs)]) === '[[1,10]]');
check('no combo selected previews nothing', B.comboPlugs(columns, st, null).length === 0);

// --- what it builds is what gets saved
const payload = window.WeaponWish.buildWeaponWishPayload(columns, st, COLORS);
check('the saved wish has the same shape the matcher reads', payload.hasAny && payload.config.perkColumnsData.every((c) => 'socketIndex' in c && 'colIndex' in c && Array.isArray(c.hashes)));
const back = B.fromWish(columns, { config: payload.config });
check('editing a saved wish brings back exactly the same picks', JSON.stringify(window.WeaponWish.buildWeaponWishPayload(columns, back, COLORS).config) === JSON.stringify(payload.config));
check('picks in a column that no longer exists are skipped', B.fromWish(columns, { config: { perkColumnsData: [{ colIndex: 9, hashes: [1] }, { colIndex: 0, hashes: [11] }] } })[0].acceptable.has(11));
check('a wish with no picks edits as empty', B.isEmpty(B.fromWish(columns, {})) && B.isEmpty(B.fromWish(columns, null)));

// --- a perk in two combos is saved with both, on the card and in the matching data
const two = B.emptyState(columns);
paint(two, 2, 31, 'red'); paint(two, 2, 31, 'blue'); paint(two, 3, 41, 'red'); paint(two, 3, 42, 'blue');
const twoPayload = window.WeaponWish.buildWeaponWishPayload(columns, two, COLORS);
const card = twoPayload.config.perkColumns.flat().find((p) => p.hash === 31);
check('the saved card lists every combo a perk is in, and keeps the first as `color`', JSON.stringify(card.colors) === '["red","blue"]' && card.color === 'red');
check('a plain pick is saved with no colours', (() => { const t = B.emptyState(columns); paint(t, 0, 11, 'any'); const p = window.WeaponWish.buildWeaponWishPayload(columns, t, COLORS).config.perkColumns[0][0]; return p.color === null && p.colors.length === 0; })());
const data2 = twoPayload.config.perkColumnsData.find((c) => c.colIndex === 2);
check('the matching data has the perk under both colours', JSON.stringify(data2.colors) === JSON.stringify({ red: [31, 131], blue: [31, 131] }), JSON.stringify(data2.colors));

// --- an owned roll lands as combo 1
const owned = B.fromOwned(columns, { 1: 12, 2: 21, 3: 131, 4: 42 }, COLORS);
check('an owned roll is one perk per column, all in combo 1', [0, 1, 2, 3].every((i) => owned[i].colors.get('red')) && owned[2].colors.get('red') === 31);
check('an enhanced owned perk is matched to its pair', owned[2].acceptable.has(31) && owned[2].acceptable.has(131));
check('an owned roll with a missing column leaves it empty', B.isEmpty([B.fromOwned(columns, { 1: 12 }, COLORS)[3]]));

// --- recoil wedge
check('the recoil wedge is a closed path', /^M1,1 L[\d.]+,[\d.]+ A1,1 0 0,1 [\d.]+,[\d.]+ Z$/.test(B.recoilWedgePath(50)) && B.recoilWedgePath(-5) === B.recoilWedgePath(0) && B.recoilWedgePath(500) === B.recoilWedgePath(100));

if (failures) { console.error(`\n${failures} weapon-builder-core check(s) failed`); process.exit(1); }
console.log('\nAll weapon-builder-core checks passed');
