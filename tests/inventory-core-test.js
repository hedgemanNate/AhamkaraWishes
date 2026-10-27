// Inventory search: filters, ordering, which copies satisfy a wish, perk columns,
// and what a builder gets when you start a wish from a copy.
const fs = require('fs');
const path = require('path');
global.window = global;
eval(fs.readFileSync(path.resolve(__dirname, '..', 'inventory-core.js'), 'utf8'));
const I = window.AWInventory;

let failures = 0;
function check(label, cond, detail) { console.log(`${cond ? 'PASS' : 'FAIL'}: ${label}${cond || !detail ? '' : `  (${detail})`}`); if (!cond) failures++; }

const dp = (name, icon) => ({ name, icon: icon || `/i/${name}.jpg` });
const defs = new Map([
  ['1', { displayProperties: dp('Fatebringer'), itemType: 3, itemTypeDisplayName: 'Hand Cannon', inventory: { bucketTypeHash: 1498876634 } }],
  ['2', { displayProperties: dp('Eyasluna'), itemType: 3, itemTypeDisplayName: 'Hand Cannon', inventory: { bucketTypeHash: 2465295065 } }],
  ['3', { displayProperties: dp('Techsec Helm'), itemType: 2, itemTypeDisplayName: 'Helmet', classType: 0, inventory: { bucketTypeHash: 3448274439 }, equippingBlock: { equipableItemSetHash: 900 } }],
  ['4', { displayProperties: dp('Nameless') , itemType: 3, inventory: { bucketTypeHash: 953998645 } }],
  ['10', { displayProperties: dp('Outlaw'), itemType: 19 }], ['11', { displayProperties: dp('Rapid Hit'), itemType: 19 }],
  ['12', { displayProperties: dp('Kill Tracker'), itemType: 19 }], ['13', { displayProperties: { name: '' }, itemType: 19 }],
  ['14', { displayProperties: dp('Not a plug'), itemType: 3 }]
]);
defs.get('4').displayProperties.name = '';
const sock = (socketIndex, activeHash, options) => ({ socketIndex, activeHash, options });
const index = {
  byItemHash: new Map([[1, new Set(['a', 'b'])], [2, new Set(['c'])], [3, new Set(['d'])], [4, new Set(['e'])]]),
  byInstanceId: new Map([
    ['a', { perkSockets: [sock(0, 99, [99]), sock(1, 10, [10, 11, 13, 14]), sock(2, 12, [12])], isCrafted: true }],
    ['b', { perkSockets: [sock(1, 11, [10, 11])] }],
    ['c', { perkSockets: [sock(1, 10, [10])] }],
    ['d', { perkSockets: [sock(5, 10, [10])], armorArchetype: 'GUNNER', armorTertiary: 'Melee' }],
    ['e', { perkSockets: [] }]
  ])
};
const dimData = { lists: { main: { name: 'Main', items: { 1: { wishes: [{ tags: ['pve'], receivedInstances: ['a'] }, { tags: ['pvp'], receivedInstances: ['a', 'b'] }] } } }, raid: { name: 'Raid', items: { 3: { wishes: [{ tags: [], receivedInstances: ['d'] }] } } } } };
const helpers = { index, defs, dimData, perkSocketIndexes: () => new Set([1, 2]), isTracker: (n) => /tracker$/i.test(n), iconRoot: 'https://b.net' };
const run = (o) => I.search(Object.assign({}, helpers, o));

// --- nothing typed
check('with no query, slot or filter there is nothing to search yet', I.needsInput('', new Set()) && I.needsInput('a', null) && !I.needsInput('fa', null) && !I.needsInput('', new Set(['helmet'])) && !I.needsInput('', new Set(), true));

// --- filters
check('a name query finds the item', run({ query: 'fate' }).items.map((i) => i.name).join() === 'Fatebringer');
check('a slot chip alone browses that slot', run({ slots: new Set(['energy']) }).items.map((i) => i.name).join() === 'Eyasluna');
check('several slots add up', run({ slots: new Set(['kinetic', 'helmet']) }).items.map((i) => i.name).sort().join() === 'Fatebringer,Techsec Helm');
check('items with no name are skipped', !run({ slots: new Set(['power']) }).items.length);
check('a name and a slot both have to fit', run({ query: 'eya', slots: new Set(['kinetic']) }).items.length === 0);

// --- wish matches
const all = run({ slots: new Set(SLOTS_ALL()) }).items;
function SLOTS_ALL() { return I.SLOTS.map((s) => s.key); }
check('items that match a wish come first, then by name', all.map((i) => i.name).join() === 'Fatebringer,Techsec Helm,Eyasluna', all.map((i) => i.name).join());
const fb = all[0];
check('a copy lists every wish it satisfies, with list and mode', fb.instances.find((i) => i.instanceId === 'a').wishMatches.map((m) => `${m.listName}/${m.mode}`).join() === 'Main/pve,Main/pvp');
check('the match count is copies, not wishes', fb.matchCount === 2 && all[2].matchCount === 0);
check('only-matches keeps items with a satisfying copy', run({ slots: new Set(SLOTS_ALL()), onlyMatches: true }).items.map((i) => i.name).join() === 'Fatebringer,Techsec Helm');
check('a wish with no mode tag is PvE', I.matchLookup(dimData).get('d')[0].mode === 'pve');

// --- perks
const a = fb.instances.find((i) => i.instanceId === 'a');
check('weapon perks come from the real perk columns only (not mods, trackers or odd plugs)', a.columns.length === 1 && a.columns[0].perks.map((p) => p.name).join() === 'Outlaw,Rapid Hit', JSON.stringify(a.columns.map((c) => c.perks.map((p) => p.name))));
check('the equipped perk is marked', a.columns[0].perks.find((p) => p.isActive).name === 'Outlaw' && a.columns[0].activeHash === 10);
check('crafted copies are marked', a.isCrafted && !fb.instances.find((i) => i.instanceId === 'b').isCrafted);
check('icons get the game root', a.columns[0].perks[0].icon === 'https://b.net/i/Outlaw.jpg' && fb.icon === 'https://b.net/i/Fatebringer.jpg');
const helm = all[1];
check('armor keeps every socket and its derived archetype and Tertiary', helm.isArmor && helm.instances[0].columns.length === 1 && helm.instances[0].armorArchetype === 'GUNNER' && helm.instances[0].armorTertiary === 'Melee' && helm.setHash === 900 && helm.classType === 0);

// --- one item, and the cap
check('the detail screen can ask for one item regardless of filters', run({ onlyHash: 2, query: 'zzz' }).items.map((i) => i.name).join() === 'Eyasluna');
const big = { byItemHash: new Map(), byInstanceId: new Map() }; const bigDefs = new Map();
for (let n = 100; n < 160; n++) { big.byItemHash.set(n, new Set([`i${n}`])); big.byInstanceId.set(`i${n}`, {}); bigDefs.set(String(n), { displayProperties: dp(`Gun ${n}`), itemType: 3, inventory: { bucketTypeHash: 1498876634 } }); }
const capped = I.search({ index: big, defs: bigDefs, slots: new Set(['kinetic']) });
bigDefs.set('159', { displayProperties: dp('Zzz last'), itemType: 3, inventory: { bucketTypeHash: 1498876634 } });
const withMatch = I.search({ index: big, defs: bigDefs, slots: new Set(['kinetic']), dimData: { lists: { l: { items: { 159: { wishes: [{ receivedInstances: ['i159'] }] } } } } } });
check('a matching item past the cap is still listed, first', withMatch.items[0].name === 'Zzz last' && withMatch.items.length === I.RESULT_CAP);
check('results are capped and say so', capped.items.length === I.RESULT_CAP && capped.capped === true && run({ slots: new Set(['kinetic']) }).capped === false);
check('bad input never throws', I.search({}).items.length === 0 && I.search({ index: { byItemHash: new Map() }, defs }).items.length === 0 && I.matchLookup(null).size === 0);

// --- starting a wish from a copy
const w = I.wishInput(fb, a);
check('a weapon copy hands over the equipped perk per socket', w.kind === 'weapon' && w.hash === 1 && w.name === 'Fatebringer' && JSON.stringify(w.activeBySocketIndex) === '{"1":10}', JSON.stringify(w));
const ar = I.wishInput(helm, helm.instances[0]);
check('an armor copy hands over its real archetype and Tertiary', ar.kind === 'armor' && ar.hash === 3 && ar.archetype === 'GUNNER' && ar.tertiary === 'Melee');
check('anything else cannot start a wish', I.wishInput({ isWeapon: false, isArmor: false }, {}) === null);
check('the row says what it is and how many you own', I.summaryOf(fb) === 'Hand Cannon · 2 owned' && I.summaryOf({ subtitle: '', instances: [1] }) === '1 owned');

if (failures) { console.error(`\n${failures} inventory-core check(s) failed`); process.exit(1); }
console.log('\nAll inventory-core checks passed');
