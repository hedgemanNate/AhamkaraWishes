// Safe rendering (aw-dom.js) and import validation (wishlist-validate.js).
//
// Wishlists arrive from other people (Discover, .awwish files) and are shown in
// the panel. This is the standing regression check for that: the hostile
// fixture below must never reach storage in a form that can inject markup or
// load a resource from a server of the author's choosing.
const fs = require('fs');
const path = require('path');
const assert = require('assert');

global.window = global;
for (const f of ['aw-dom.js', 'wishlist-validate.js']) {
  eval(fs.readFileSync(path.resolve(__dirname, '..', f), 'utf8'));
}
const { escapeHtml, safeImageUrl } = window.AWDom;
const { sanitizeList } = window.WishlistValidate;

let failures = 0;
function check(label, cond) {
  console.log(`${cond ? 'PASS' : 'FAIL'}: ${label}`);
  if (!cond) failures++;
}

// --- escapeHtml ---
check('escapes the five HTML-significant characters', escapeHtml(`<a href="x" onclick='y'>&`) === '&lt;a href=&quot;x&quot; onclick=&#39;y&#39;&gt;&amp;');
check('escaped text cannot break out of a double-quoted attribute', !escapeHtml('" onerror="alert(1)').includes('"'));
check('escaped text cannot break out of a single-quoted attribute', !escapeHtml("' onerror='alert(1)").includes("'"));
check('null and undefined render as empty', escapeHtml(null) === '' && escapeHtml(undefined) === '');
check('numbers are stringified', escapeHtml(42) === '42');
check('exposed as a global for the other scripts', typeof global.escapeHtml === 'function');

// --- safeImageUrl ---
const OK = 'https://www.bungie.net/common/destiny2_content/icons/abc.jpg';
check('Bungie https URL passes', safeImageUrl(OK) === OK);
check('Bungie-relative path gets the origin', safeImageUrl('/common/destiny2_content/icons/abc.jpg') === OK);
for (const bad of [
  'http://www.bungie.net/x.jpg',
  'https://evil.example/track.gif',
  'https://www.bungie.net.evil.example/x.jpg',
  'https://www.bungie.net@evil.example/x.jpg',
  'https://user:pw@www.bungie.net/x.jpg',
  'https://www.bungie.net:8443/x.jpg',
  '//evil.example/x.gif',
  'javascript:alert(1)',
  'data:image/svg+xml,<svg onload=alert(1)>',
  '/x.jpg" onerror="alert(1)',
  "/x.jpg' onerror='alert(1)",
  '/x.jpg\\evil',
  '',
  '   ',
  null,
  undefined,
  42,
  {}
]) {
  check(`refuses ${JSON.stringify(bad)}`, safeImageUrl(bad) === '');
}

// --- sanitizeList: a legitimate list survives intact ---
const goodList = {
  name: 'Raid & Dungeon',
  items: {
    '1234567890': {
      static: {
        name: 'Fatebringer', type: 'weapon', set: null, icon: OK, classType: null, bucketHash: 1498876634,
        slotName: null, setName: null, setHash: null, linkedHashes: [111, 222], ammoType: 1,
        itemTypeDisplayName: 'Hand Cannon', damageTypeHash: 3454344768
      },
      wishes: [{
        tags: ['pvp'],
        config: {
          perks: [[1, 2], [3]],
          perkColumns: [[{ name: 'Outlaw', icon: OK, hash: 1, enhancedHash: 11, color: 'red' }], [{ name: 'Rapid Hit', icon: OK, hash: 3, enhancedHash: null, color: null }]],
          perkColumnsData: [
            { socketIndex: 3, colIndex: 0, hashes: [1, 2], colors: { red: [1, 11] } },
            { socketIndex: 4, colIndex: 1, hashes: [3] }
          ],
          masterwork: { key: 'v400.plugs.weapons.masterworks.stat.handling', name: 'Handling', icon: OK, hashes: [101, 102, 103] }
        },
        raw: '[[1,2],[3]]|mw:v400.plugs.weapons.masterworks.stat.handling',
        added: 1700000000000
      }]
    },
    '555': {
      static: { name: 'Iron Helm', type: 'armor', icon: '/common/x.jpg', classType: 0, setName: 'Iron', setHash: 9 },
      wishes: [{ tags: ['pve'], config: { archetype: 'GUNNER', spark: 'Weapons' }, raw: 'armor-wish:555', added: 5 }]
    }
  }
};
const cleaned = sanitizeList(goodList);
check('good list keeps its name', cleaned.name === 'Raid & Dungeon');
check('good list keeps both items', cleaned.itemCount === 2 && cleaned.droppedItems === 0 && cleaned.droppedWishes === 0);
const w = cleaned.items['1234567890'].wishes[0];
check('weapon wish identity (raw) is untouched', w.raw === '[[1,2],[3]]|mw:v400.plugs.weapons.masterworks.stat.handling');
check('weapon mode, perks and combos are preserved', w.tags[0] === 'pvp' && JSON.stringify(w.config.perks) === '[[1,2],[3]]' &&
  w.config.perkColumnsData[0].colors.red.join() === '1,11' && w.config.perkColumns[0][0].color === 'red');
check('weapon static metadata is preserved', cleaned.items['1234567890'].static.linkedHashes.join() === '111,222' &&
  cleaned.items['1234567890'].static.itemTypeDisplayName === 'Hand Cannon');
check('a masterwork choice survives import whole', JSON.stringify(w.config.masterwork) ===
  JSON.stringify({ key: 'v400.plugs.weapons.masterworks.stat.handling', name: 'Handling', icon: OK, hashes: [101, 102, 103] }));

// --- masterwork: optional, and hostile values never reach storage ---
const weaponCfg = (cfg) => sanitizeList({ name: 'x', items: { 5: { static: { name: 'g', type: 'weapon' }, wishes: [{ config: Object.assign({ perks: [[1]] }, cfg), raw: 'r' }] } } }).items[5].wishes[0].config;
const armorOnlyWith = (cfg) => sanitizeList({ name: 'x', items: { 5: { static: { name: 'h', type: 'armor' }, wishes: [{ config: cfg, raw: 'r' }] } } }).items[5].wishes[0].config;
const goodMw = { key: 'v400.plugs.weapons.masterworks.stat.range', name: 'Range', icon: OK, hashes: [201, 203] };
check('a wish with no masterwork imports with none', !('masterwork' in weaponCfg({})));
check('a masterwork is kept alongside the perks', weaponCfg({ masterwork: goodMw }).masterwork.hashes.join() === '201,203' && weaponCfg({ masterwork: goodMw }).perks[0][0] === 1);
check('a masterwork on an armor wish is not carried over', !('masterwork' in armorOnlyWith({ archetype: 'GUNNER', masterwork: goodMw })));
check('a masterwork with no usable key is dropped, the wish stays', !('masterwork' in weaponCfg({ masterwork: { ...goodMw, key: '<img onerror=alert(1)>' } })));
check('a key with spaces, quotes or markup is refused', ['a b', 'a"b', 'a<b', '', 'x'.repeat(81), 12].every((key) => !('masterwork' in weaponCfg({ masterwork: { ...goodMw, key } }))));
check('a masterwork with no usable hashes is dropped', !('masterwork' in weaponCfg({ masterwork: { ...goodMw, hashes: ['x', -1, 0, 1.5, null] } })) && !('masterwork' in weaponCfg({ masterwork: { ...goodMw, hashes: 'nope' } })));
check('only whole positive hashes survive', weaponCfg({ masterwork: { ...goodMw, hashes: [201, 'x', -1, 0, 1.5, 203] } }).masterwork.hashes.join() === '201,203');
check('an oversized hash list is capped', weaponCfg({ masterwork: { ...goodMw, hashes: Array.from({ length: 500 }, (_, i) => i + 1) } }).masterwork.hashes.length === 40);
check('an off-site masterwork icon is blanked, the choice kept', (() => { const m = weaponCfg({ masterwork: { ...goodMw, icon: 'https://evil.example/x.png' } }).masterwork; return m.icon === '' && m.hashes.length === 2; })());
check('masterwork text is cleaned and capped, unknown keys dropped', (() => { const m = weaponCfg({ masterwork: { ...goodMw, name: 'A\u0000'.repeat(60), extra: '<svg>' } }).masterwork; return m.name.length <= 40 && !m.name.includes('\u0000') && !('extra' in m); })());
check('a masterwork that is not an object is dropped', ['Handling', 7, [1, 2], null].every((masterwork) => !('masterwork' in weaponCfg({ masterwork }))));

const armorCfg = cleaned.items['555'].wishes[0].config;
check('legacy armor wish (v1: Tertiary saved as spark) imports as tertiary', armorCfg.archetype === 'GUNNER' && armorCfg.tertiary === 'Weapons' && armorCfg.spark === null);
const armorOnly = (cfg) => sanitizeList({ name: 'x', items: { 5: { static: { name: 'h', type: 'armor' }, wishes: [{ config: cfg, raw: 'r' }] } } }).items[5].wishes[0].config;
check('armor wish with only an archetype imports with both optional fields null', (() => { const c = armorOnly({ archetype: 'GUNNER' }); return c.tertiary === null && c.spark === null; })());
check('current-shape armor wish keeps Tertiary and Spark apart', (() => { const c = armorOnly({ archetype: 'GUNNER', tertiary: 'Class', spark: 'Super' }); return c.tertiary === 'Class' && c.spark === 'Super'; })());
check('current shape with a null Tertiary is not re-read as legacy', (() => { const c = armorOnly({ archetype: 'GUNNER', tertiary: null, spark: 'Super' }); return c.tertiary === null && c.spark === 'Super'; })());

// --- sanitizeList: the hostile fixture ---
const evilJs = '<img src=x onerror=alert(1)>';
const hostile = JSON.parse(`{
  "name": "${evilJs.replace(/"/g, '\\"')}\\u0007Evil",
  "items": {
    "__proto__": { "static": { "name": "polluted", "type": "weapon" }, "wishes": [] },
    "constructor": { "static": { "name": "x", "type": "weapon" }, "wishes": [] },
    "12abc": { "static": { "name": "bad key", "type": "weapon" }, "wishes": [{ "raw": "r", "config": {} }] },
    "99999999999": { "static": { "name": "key too big", "type": "weapon" }, "wishes": [{ "raw": "r", "config": {} }] },
    "100": {
      "static": { "name": "${evilJs.replace(/"/g, '\\"')}", "type": "weapon", "icon": "https://evil.example/pixel.gif",
                  "slotName": "<script>alert(1)</script>", "classType": "0", "unexpected": { "deep": true }, "linkedHashes": [1, "2", null, -5, 1.5] },
      "wishes": [
        { "tags": ["<b>pve</b>", "pvp", "pvp"], "raw": "[[1]]", "added": "yesterday",
          "received": true, "receivedInstances": ["1"], "matchScore": 1, "evil": "x",
          "config": { "perks": [[1]], "perkColumns": [[{ "name": "${evilJs.replace(/"/g, '\\"')}", "icon": "javascript:alert(1)", "hash": "7", "color": "purple" }]],
                      "perkColumnsData": [{ "socketIndex": 3, "hashes": [1, "x"], "colors": { "red": [1], "bogus": [2] } }] } },
        { "raw": 12345, "config": {} },
        "not an object",
        { "raw": "[[2]]", "config": "not an object" }
      ]
    },
    "200": { "static": { "name": "wrong type", "type": "<svg onload=alert(1)>" }, "wishes": [{ "raw": "r", "config": {} }] },
    "300": { "static": { "name": "armor", "type": "armor" },
             "wishes": [{ "raw": "armor-wish:300", "config": { "archetype": "${evilJs.replace(/"/g, '\\"')}", "spark": "<i>Weapons</i>" } }] },
    "400": "not an item",
    "500": { "static": { "name": "no wishes", "type": "weapon" }, "wishes": [] }
  }
}`);
const out = sanitizeList(hostile);
check('hostile: control characters are stripped from the list name', !/[\u0000-\u001f]/.test(out.name));
check('hostile: bad keys and invalid items are dropped, not copied across',
  Object.keys(out.items).sort().join() === '100,300');
check('hostile: prototype was not polluted', ({}).polluted === undefined && !Object.prototype.hasOwnProperty.call(out.items, '__proto__'));
check('hostile: drop counts reflect what was refused', out.droppedItems >= 6 && out.droppedWishes >= 3);

const item = out.items['100'];
check('hostile: off-site icon is removed', item.static.icon === null);
check('hostile: unknown static fields are not carried', !('unexpected' in item.static));
check('hostile: non-numeric classType becomes null', item.static.classType === null);
check('hostile: linkedHashes keeps only valid hashes', item.static.linkedHashes.join() === '1');
check('hostile: only the one valid wish survives', item.wishes.length === 1);
const hw = item.wishes[0];
check('hostile: junk tags become a valid mode list', hw.tags.join() === 'pvp');
check('hostile: runtime annotations and unknown wish fields are dropped',
  !('received' in hw) && !('receivedInstances' in hw) && !('matchScore' in hw) && !('evil' in hw));
check('hostile: non-numeric added is replaced with a number', typeof hw.added === 'number' && Number.isFinite(hw.added));
check('hostile: javascript: perk icon removed', hw.config.perkColumns[0][0].icon === null);
check('hostile: unknown combo colour removed', hw.config.perkColumns[0][0].color === null);
check('hostile: string perk hash becomes null', hw.config.perkColumns[0][0].hash === null);
check('hostile: bogus combo colour key is not kept', !('bogus' in (hw.config.perkColumnsData[0].colors || {})) && hw.config.perkColumnsData[0].colors.red.join() === '1');
check('hostile: non-numeric hash in a column is dropped', hw.config.perkColumnsData[0].hashes.join() === '1');

// Text fields are still strings (the renderer escapes them); what matters here
// is that nothing but known fields and capped text survives.
const json = JSON.stringify(out);
check('hostile: no off-site URL survives anywhere in the output', !/evil\.example/.test(json));
check('hostile: no javascript: URL survives anywhere in the output', !/javascript:/i.test(json));
check('hostile: escaping the surviving names neutralises them',
  !escapeHtml(item.static.name).includes('<') && !escapeHtml(out.items['300'].wishes[0].config.archetype).includes('<'));

// --- sanitizeList: bounds and edge cases ---
check('not-a-list input returns null', sanitizeList(null) === null && sanitizeList('x') === null && sanitizeList([]) === null);
check('empty list is fine', sanitizeList({ name: 'Empty', items: {} }).itemCount === 0);
check('missing items is fine', sanitizeList({ name: 'No items' }).itemCount === 0);
check('missing name gets a default', sanitizeList({ items: {} }).name === 'Imported Wishlist');
check('overlong name is capped', sanitizeList({ name: 'x'.repeat(500), items: {} }).name.length === 80);
const many = {};
for (let i = 1; i <= 10050; i++) many[i] = { static: { name: 'n', type: 'weapon' }, wishes: [{ raw: 'r', config: {} }] };
check('item count is capped', sanitizeList({ name: 'big', items: many }).itemCount === 10000);
const tooManyWishes = { static: { name: 'n', type: 'weapon' }, wishes: Array.from({ length: 250 }, (_, i) => ({ raw: 'r' + i, config: {} })) };
check('wishes per item are capped', sanitizeList({ name: 'x', items: { 1: tooManyWishes } }).items[1].wishes.length === 200);
check('legacy comma-separated perks string is kept when numeric',
  sanitizeList({ name: 'x', items: { 1: { static: { name: 'n', type: 'weapon' }, wishes: [{ raw: 'r', config: { perks: '1,2,3' } }] } } }).items[1].wishes[0].config.perks === '1,2,3');
check('legacy perks string with markup is blanked',
  sanitizeList({ name: 'x', items: { 1: { static: { name: 'n', type: 'weapon' }, wishes: [{ raw: 'r', config: { perks: '1,<b>' } }] } } }).items[1].wishes[0].config.perks === '');

// Fails closed when the URL helper isn't loaded
const savedDom = window.AWDom;
delete window.AWDom;
check('without the URL helper, icons are dropped rather than trusted', sanitizeList(goodList).items['555'].static.icon === null);
window.AWDom = savedDom;

if (failures) {
  console.error(`\n${failures} safe-rendering check(s) failed`);
  process.exit(1);
}
console.log('\nAll safe-rendering checks passed');
