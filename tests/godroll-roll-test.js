// godroll.tv roll reading: URL parsing, DOM reading (against a minimal DOM stub
// shaped like godroll.tv's perk markup), and mapping godroll's columns onto the
// craft view's columns by hash.
const fs = require('fs');
const path = require('path');

const code = fs.readFileSync(path.resolve(__dirname, '..', 'godroll-roll-core.js'), 'utf8');
global.window = global;
eval(code);
const G = window.GodrollRoll;

let failures = 0;
function check(label, cond) {
  console.log(`${cond ? 'PASS' : 'FAIL'}: ${label}`);
  if (!cond) failures++;
}

// --- parseItemHash ---
check('parses hash from weapon path', G.parseItemHash('/877384/the-martlet') === 877384);
check('parses hash when a roll code follows', G.parseItemHash('/877384/the-martlet/GK4RfrA') === 877384);
check('parses bare /<hash>', G.parseItemHash('/877384') === 877384);
check('rejects non-weapon pages', G.parseItemHash('/weapons/browse') === null && G.parseItemHash('/') === null);

// --- readRoll against a stub DOM ---
function perk(hash, classes) {
  const cls = new Set(['perk-item'].concat(classes));
  return { classList: { contains: (c) => cls.has(c) }, getAttribute: (n) => (n === 'data-hash' ? String(hash) : null) };
}
function column(perks) {
  // The stub mimics the real selector: only `.perk-item.selected` descendants.
  return { querySelectorAll: () => perks.filter((p) => p.classList.contains('selected')) };
}
function docWith(columns) {
  return { querySelectorAll: () => columns };
}

const doc = docWith([
  column([perk(839105230, []), perk(3661387068, ['selected'])]),
  column([perk(3142289711, ['selected', 'active'])]),
  column([perk(460017080, ['selected']), perk(776531651, ['selected']), perk('empty_masterwork', ['selected'])]),
  column([perk(2323986101, ['selected', 'mod-item-inline']), perk(9, ['masterwork-item', 'selected'])]),
  column([])
]);
const roll = G.readRoll(doc, '/877384/the-martlet/abc');
check('reads item hash', roll.itemHash === 877384);
check('reads selected perks per column', JSON.stringify(roll.columns) === JSON.stringify([[3661387068], [3142289711], [460017080, 776531651], [], []]));
check('skips non-numeric hashes (empty_masterwork)', !roll.columns.flat().includes(NaN));
check('skips mod and masterwork picks', !roll.columns.flat().includes(2323986101) && !roll.columns.flat().includes(9));
check('countSelected totals all columns', G.countSelected(roll) === 4);
check('readRoll returns null off weapon pages', G.readRoll(doc, '/weapons') === null);
check('countSelected handles null', G.countSelected(null) === 0);

// --- assignColumns ---
const mk = (b, e) => ({ base: { hash: b }, enhanced: e ? { hash: e } : null });
const craftColumns = [
  { pairs: [mk(1, 11), mk(2, 12)] },        // barrel
  { pairs: [mk(3, 13), mk(4, 14)] },        // magazine
  { pairs: [mk(5, 15), mk(6, 16), mk(7, 17)] },  // trait 1
  { pairs: [mk(5, 15), mk(8, 18)] }         // trait 2 (also offers perk 5)
];

let picks = G.assignColumns([[1], [14], [6, 7], [8]], craftColumns);
check('maps each godroll column to its craft column', JSON.stringify(picks.map((p) => p.colIndex)) === JSON.stringify([0, 1, 2, 2, 3]));
check('resolves enhanced hash to its base', picks[1].baseHash === 4 && picks[1].enhancedHash === 14);
check('keeps base+enhanced pair for a base hash', picks[0].baseHash === 1 && picks[0].enhancedHash === 11);

// A perk offered in two craft columns goes to the column that fits the whole group.
picks = G.assignColumns([[6, 5]], craftColumns);
check('ambiguous perk resolves to best-scoring column', picks.every((p) => p.colIndex === 2));

// Two godroll columns can't both claim one craft column.
picks = G.assignColumns([[5], [5]], craftColumns);
check('a craft column is only claimed once', JSON.stringify(picks.map((p) => p.colIndex)) === JSON.stringify([2, 3]));

check('unknown hashes are dropped', G.assignColumns([[999]], craftColumns).length === 0);
check('empty godroll columns are skipped', G.assignColumns([[], [2]], craftColumns).length === 1);

picks = G.assignColumns([[1, 11]], craftColumns);
check('base and enhanced of the same perk collapse to one pick', picks.length === 1);

// --- readMode ---
const toggle = (activeLabel) => ({
  querySelector: (sel) => (sel === '.stats-mode-toggle .stats-mode-btn.active' && activeLabel ? { textContent: ` ${activeLabel} ` } : null)
});
check('readMode reads PvP from the stats toggle', G.readMode(toggle('PvP')) === 'pvp');
check('readMode reads PvE from the stats toggle', G.readMode(toggle('PvE')) === 'pve');
check('readMode defaults to pve when the toggle is missing', G.readMode(toggle(null)) === 'pve');

if (failures) {
  console.error(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log('\nAll godroll roll checks passed');
