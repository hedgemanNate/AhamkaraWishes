// List operations: create, rename, duplicate, delete + Undo, merge + Undo.
const fs = require('fs');
const path = require('path');
global.window = global;
eval(fs.readFileSync(path.resolve(__dirname, '..', 'wishlist-sync-core.js'), 'utf8'));
const W = window.WishlistSync;

let failures = 0;
function check(label, cond, detail) { console.log(`${cond ? 'PASS' : 'FAIL'}: ${label}${cond || !detail ? '' : `  (${detail})`}`); if (!cond) failures++; }

// Real-looking times: the sync core ignores tombstones older than its retention window.
const T0 = Date.now() - 100000;
const wish = (raw, added, mode) => ({ tags: [mode || 'pve'], raw, config: {}, added: T0 + added });
const fresh = () => ({
  activeId: 'default',
  lists: {
    default: { name: 'Main', items: { 1: { static: { name: 'Fatebringer' }, wishes: [wish('a', 100)] } } },
    pve: { name: 'PvE', items: { 1: { static: { name: 'Fatebringer' }, wishes: [wish('a', 150), wish('b', 160)] }, 2: { static: { name: 'Eyasluna' }, wishes: [wish('c', 170)] } } },
    pvp: { name: 'PvP', items: { 3: { static: { name: 'Mindbender' }, wishes: [wish('d', 180)] } } }
  }
});
const wishCount = (list) => Object.values(list.items).reduce((n, it) => n + it.wishes.length, 0);

// --- create / rename / duplicate
let d = fresh();
let r = W.createList(d, '  Raid   rolls ');
check('a new list gets a tidy name, is empty, and becomes active', d.lists[r.id].name === 'Raid rolls' && wishCount(d.lists[r.id]) === 0 && d.activeId === r.id);
check('an empty name is refused', W.createList(d, '   ').error === 'empty' && Object.keys(d.lists).length === 4);
check('a name another list has is refused, whatever its case', W.createList(d, 'pvp').error === 'taken' && Object.keys(d.lists).length === 4);
check('names are capped', W.createList(d, 'x'.repeat(200)).id && Object.values(d.lists).some((l) => l.name.length === W.LIST_NAME_MAX));
check('rename works, and keeping your own name is fine', W.renameList(d, 'pvp', 'Crucible') === 'ok' && W.renameList(d, 'pvp', 'crucible') === 'ok' && d.lists.pvp.name === 'crucible');
check('rename refuses empty, taken and unknown', W.renameList(d, 'pvp', ' ') === 'empty' && W.renameList(d, 'pvp', 'PvE') === 'taken' && W.renameList(d, 'nope', 'x') === 'missing');
d = fresh();
const copy = W.duplicateList(d, 'pve');
check('duplicate copies every roll under a "(copy)" name and activates it', d.lists[copy].name === 'PvE (copy)' && wishCount(d.lists[copy]) === 3 && d.activeId === copy);
d.lists[copy].items[2].wishes.pop();
check('the copy is independent of the original', wishCount(d.lists.pve) === 3);
check('a second duplicate gets a free name', d.lists[W.duplicateList(d, 'pve')].name === 'PvE (copy) (2)');
check('duplicating a missing list does nothing', W.duplicateList(d, 'nope') === null);

// --- delete + Undo
d = fresh(); d.activeId = 'pve';
const T = Date.now() - 10000;
const snap = W.removeList(d, 'pve', T);
check('delete removes the list, falls back to the default, and tombstones it', !d.lists.pve && d.activeId === 'default' && d.tombstones.lists.pve === T && snap.position === 1 && snap.wasActive);
check('the default list can never be deleted', W.removeList(d, 'default') === null && !!d.lists.default);
check('deleting something that is not there does nothing', W.removeList(d, 'nope') === null);
check('Undo puts it back in the same position, active again, tombstone withdrawn', W.restoreList(d, snap, T + 2000) && Object.keys(d.lists).join() === 'default,pve,pvp' && d.activeId === 'pve' && !d.tombstones.lists.pve);
check('restored wishes are newer than the tombstone, in their old order', d.lists.pve.items[1].wishes[0].added >= T + 2000 && d.lists.pve.items[1].wishes[1].added > d.lists.pve.items[1].wishes[0].added);
check('Undo twice does nothing the second time', W.restoreList(d, snap, T + 3000) === false && Object.keys(d.lists).length === 3);
// a browser that saw the delete must not delete it again
const stale = { activeId: 'default', lists: {}, tombstones: { lists: { pve: T }, wishes: {} } };
check('after Undo, merging with a browser that saw the delete keeps the list', !!W.mergeDimData(d, stale).lists.pve);
const gone = fresh(); W.removeList(gone, 'pve', T);
check('without Undo the delete still wins everywhere', !W.mergeDimData(fresh(), gone).lists.pve);

// --- merge + Undo
d = fresh(); d.activeId = 'pve';
const MT = Date.now() - 5000;
const m = W.mergeLists(d, 'default', ['pve', 'pvp', 'default', 'default', 'nope'], MT);
check('merge keeps every roll: the same roll once, different rolls on the same weapon both', wishCount(d.lists.default) === 4 && d.lists.default.items[1].wishes.map((w) => w.raw).sort().join() === 'a,b' && !!d.lists.default.items[2] && !!d.lists.default.items[3], JSON.stringify(Object.values(d.lists.default.items).map((i) => i.wishes.map((w) => w.raw))));
check('merge removes the sources with tombstones, and reports how many rolls it added', Object.keys(d.lists).join() === 'default' && d.tombstones.lists.pve === MT && d.tombstones.lists.pvp === MT && m.added === 3 && m.removed.length === 2);
check('the active list falls back when its list was merged away', d.activeId === 'default');
check('Undo restores the destination exactly and both lists in place', W.undoMerge(d, m, MT + 1000) && Object.keys(d.lists).join() === 'default,pve,pvp' && wishCount(d.lists.default) === 1 && wishCount(d.lists.pve) === 3 && wishCount(d.lists.pvp) === 1 && d.activeId === 'pve');
d = fresh();
check('the default list is never merged away, and nothing to merge returns null', W.mergeLists(d, 'pve', ['default']) === null && !!d.lists.default && W.mergeLists(d, 'pve', []) === null && W.mergeLists(d, 'nope', ['pvp']) === null);
d = fresh();
const into = W.mergeLists(d, 'pvp', ['pve'], MT);
check('merging into another list works the same way', wishCount(d.lists.pvp) === 4 && !d.lists.pve && into.added === 3);

// --- export of wish order stays stable
check('merged wishes of one weapon are ordered by when they were added', (() => { const x = fresh(); W.mergeLists(x, 'default', ['pve'], 1); return x.lists.default.items[1].wishes.map((w) => w.raw).join() === 'a,b'; })());

if (failures) { console.error(`\n${failures} list-ops check(s) failed`); process.exit(1); }
console.log('\nAll list-ops checks passed');
