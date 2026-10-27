// Drops: what counts as a drop, what the log says was done about it, and the
// automation defaults (D5: auto-lock on, auto-vault off).
const fs = require('fs');
const path = require('path');

global.window = global;
const store = {};
global.chrome = { storage: { local: {
  get: (keys, cb) => cb(Object.fromEntries((Array.isArray(keys) ? keys : [keys]).filter((k) => k in store).map((k) => [k, store[k]]))),
  set: (obj, cb) => { Object.assign(store, obj); if (cb) cb(); }
} } };
eval(fs.readFileSync(path.resolve(__dirname, '..', 'drops-core.js'), 'utf8'));
const D = window.AWDrops;

let failures = 0;
function check(label, cond) { console.log(`${cond ? 'PASS' : 'FAIL'}: ${label}`); if (!cond) failures++; }

const wish = (received, instances) => ({ tags: ['pve'], config: {}, raw: 'x', received, receivedInstances: instances || [] });
const dim = (a, b) => ({ lists: {
  main: { name: 'Main', items: { 1: { static: { name: 'Fatebringer', icon: '/i/f.jpg' }, wishes: [wish(a, a ? ['10'] : [])] }, 2: { static: { name: 'Eyasluna' }, wishes: [wish(true, ['20']), wish(b, b ? ['21', '22'] : [])] } } },
  raid: { name: 'Raid', items: { 3: { static: { name: 'Vex Mythoclast' }, wishes: [wish(false)] } } }
} });

// --- finding drops
const before = D.snapshotReceivedState(dim(false, false));
check('the snapshot records what is received now', before.get('main|2|0') === true && before.get('main|1|0') === false && before.size === 4);
let drops = D.newlyReceived(before, dim(true, true));
check('only wishes that flipped to received are drops', drops.map((d) => `${d.itemName}#${d.index}`).sort().join() === 'Eyasluna#1,Fatebringer#0', JSON.stringify(drops.map((d) => d.itemName)));
check('a drop carries its list, item and instances', drops.find((d) => d.itemName === 'Eyasluna').listName === 'Main' && drops.find((d) => d.itemName === 'Eyasluna').instanceIds.join() === '21,22');
check('already-owned wishes are not drops', !drops.some((d) => d.index === 0 && d.itemName === 'Eyasluna'));
check('nothing new means no drops', D.newlyReceived(D.snapshotReceivedState(dim(true, true)), dim(true, true)).length === 0);
check('a missing snapshot treats everything received as new', D.newlyReceived(null, dim(true, false)).length === 2);
check('bad data never throws', D.newlyReceived(before, null).length === 0 && D.newlyReceived(before, { lists: { a: { items: { 1: null } } } }).length === 0);
check('instances are collected once each', D.instanceIdsOf([{ instanceIds: ['1', '2'] }, { instanceIds: ['2', '3'] }]).size === 3);

// --- the log says what was done
const t = 1000000;
const fb = drops.find((d) => d.itemName === 'Fatebringer');
const ey = drops.find((d) => d.itemName === 'Eyasluna');
let entries = D.buildEntries([fb, ey], { 10: { locked: true }, 21: { locked: true, vaulted: true }, 22: { locked: false, vaulted: true } }, t);
check('locked and moved: both recorded', JSON.stringify(entries[0].actions) === '["locked"]' && entries[0].timestamp === t);
check('one instance failing to lock is reported as a failure, not a success', entries[1].actions.includes('lock-failed') && !entries[1].actions.includes('locked'));
check('every instance moved: vaulted', entries[1].actions.includes('vaulted'));
check('automation off (not attempted) records no action', D.buildEntries([fb], {}, t)[0].actions.length === 0);
check('entries get unique ids and keep the item hash for opening it', entries[0].id !== entries[1].id && entries[0].itemHash === '1' && entries[0].listName === 'Main');

// --- the log itself
check('the log is capped, newest kept', D.appendEntries(Array.from({ length: 19 }, (_, i) => ({ id: `o${i}` })), [{ id: 'a' }, { id: 'b' }, { id: 'c' }]).map((e) => e.id).join(',').endsWith('a,b,c') && D.appendEntries(Array.from({ length: 19 }, (_, i) => ({ id: `o${i}` })), [{ id: 'a' }, { id: 'b' }, { id: 'c' }]).length === 20);
const log = [{ id: 'a', timestamp: 1, itemName: 'A' }, { id: 'b', timestamp: 2, itemName: 'B' }, { id: 'c', timestamp: 3, itemName: 'C' }];
let r = D.removeEntry(log, { id: 'b' });
check('remove takes out exactly that entry', r.entries.map((e) => e.id).join() === 'a,c' && r.removed.id === 'b' && r.index === 1);
check('Undo puts it back where it was', D.restoreEntry(r.entries, r.removed, r.index).map((e) => e.id).join() === 'a,b,c');
check('Undo twice does not duplicate', D.restoreEntry(D.restoreEntry(r.entries, r.removed, r.index), r.removed, r.index).length === 3);
check('entries from before ids existed are matched by time and name', D.removeEntry([{ timestamp: 5, itemName: 'Old' }, { timestamp: 6, itemName: 'Old' }], { timestamp: 6, itemName: 'Old' }).entries.length === 1);
check('removing something that is not there changes nothing', D.removeEntry(log, { id: 'zzz' }).entries.length === 3 && D.removeEntry(log, { id: 'zzz' }).removed === null);
check('unseen entries are counted from the last visit', D.unseenCount(log, 1) === 2 && D.unseenCount(log, 0) === 3 && D.unseenCount(log, 99) === 0 && D.unseenCount(null, 0) === 0);

// --- grouping the log by day
const noon = new Date(2026, 9, 26, 12).getTime();
check('day labels', D.dayLabel(noon - 3600000, noon) === 'Today' && D.dayLabel(noon - 86400000, noon) === 'Yesterday' && /\d/.test(D.dayLabel(noon - 5 * 86400000, noon)));

// --- automation (D5)
check('defaults: auto-lock on, auto-vault off, not answered', JSON.stringify(D.normalizeAutomation(undefined)) === '{"autoLock":true,"autoVault":false,"answered":false}');
check('only an explicit "true" turns auto-vault on', D.normalizeAutomation({ autoVault: 'yes' }).autoVault === false && D.normalizeAutomation({ autoVault: true }).autoVault === true);
check('auto-lock stays on unless explicitly turned off', D.normalizeAutomation({}).autoLock === true && D.normalizeAutomation({ autoLock: false }).autoLock === false);

// --- storage
(async () => {
  let s = await D.load();
  check('a fresh install: no entries, log choice never made, defaults', s.entries.length === 0 && s.enabled === null && s.seenAt === 0 && s.automation.autoVault === false);
  await D.saveEntries(entries); await D.setEnabled(true); await D.markSeen(55); await D.saveAutomation({ autoVault: true, answered: true });
  s = await D.load();
  check('what was saved is what loads', s.entries.length === 2 && s.enabled === true && s.seenAt === 55 && s.automation.autoVault === true && s.automation.answered === true);
  await D.setEnabled(false);
  check('turning the log off is remembered as off, not as "never chosen"', (await D.load()).enabled === false);

  if (failures) { console.error(`\n${failures} drops-core check(s) failed`); process.exit(1); }
  console.log('\nAll drops-core checks passed');
})();
