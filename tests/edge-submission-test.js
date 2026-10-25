// Server-side check of Discover submissions (supabase/functions/_shared/submission.js),
// run on the same client copies the edge function bundles. Also fails if those
// copies drift from the extension's files (tools/sync-edge-shared.js).
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { stale } = require('../tools/sync-edge-shared');

let failures = 0;
function check(label, cond) { console.log(`${cond ? 'PASS' : 'FAIL'}: ${label}`); if (!cond) failures++; }

check('edge copies match the extension (run tools/sync-edge-shared.js)', stale().length === 0);

// Load like Deno does: a bare global, no window, no document.
const ctx = vm.createContext({ URL, Date, JSON, Object, Array, String, Number, Math, RegExp, Error });
const shared = path.resolve(__dirname, '..', 'supabase', 'functions', '_shared');
for (const f of ['client/aw-dom.js', 'client/wishlist-validate.js', 'submission.js']) {
  vm.runInContext(fs.readFileSync(path.join(shared, f), 'utf8'), ctx, { filename: f });
}
const { checkSubmission, MAX_PAYLOAD_BYTES } = ctx.AWSubmission;

const weapon = { static: { name: 'Fatebringer', type: 'weapon', icon: '/common/destiny2_content/icons/a.jpg' },
  wishes: [{ tags: ['pve'], config: { perks: [[1, 2], [3]] }, raw: '[[1,2],[3]]', added: 1 }] };
const armor = { static: { name: 'Techsec Helm', type: 'armor' },
  wishes: [{ tags: ['pvp'], config: { archetype: 'Gunner', tertiary: 'Class', spark: null }, raw: 'armor-wish:2', added: 1 }] };
const good = { title: '  My PvE rolls ', game_mode: 'pve', payload: { name: 'Mine', items: { 1: weapon, 2: armor } } };

let r = checkSubmission(good);
check('a valid list is accepted', r.ok === true);
check('title is trimmed', r.row.title === 'My PvE rolls');
check('item count and kinds are computed from the cleaned list', r.row.item_count === 2 && r.row.has_weapons && r.row.has_armor);
check('stored payload is just { name, items }', JSON.stringify(Object.keys(r.row.payload)) === '["name","items"]');
check('nothing dropped from a clean list', r.dropped === 0);

// hostile list: junk is removed before it is stored
const evil = JSON.parse(JSON.stringify(good));
evil.payload.extra = 'x'.repeat(100);
evil.payload.items[1].static.icon = 'https://evil.example/track.png';
evil.payload.items[1].static.onerror = 'alert(1)';
evil.payload.items[1].wishes[0].received = true;
// An own "__proto__" key, as JSON.parse of a crafted request produces.
Object.defineProperty(evil.payload.items, '__proto__', { value: weapon, enumerable: true, configurable: true, writable: true });
evil.payload.items.notahash = weapon;
evil.payload.items[3] = { static: { name: 'x', type: 'boat' }, wishes: [] };
r = checkSubmission(evil);
const stored = JSON.stringify(r.row?.payload || {});
check('hostile list: the valid wishes are still accepted', r.ok === true && r.row.item_count === 2);
check('hostile list: off-site image removed', !/evil\.example/.test(stored));
check('hostile list: unknown fields removed', !/onerror|extra|received/.test(stored));
check('hostile list: non-hash keys removed', !/notahash|__proto__/.test(stored));
check('hostile list: drops are counted', r.dropped === 3);

// rejections
const bad = (patch) => checkSubmission({ ...good, ...patch });
check('missing title rejected', bad({ title: '   ' }).error === 'missing_title');
check('control characters alone are not a title', bad({ title: '\u0000\u0007' }).error === 'missing_title');
check('long title is cut to 120', checkSubmission({ ...good, title: 'a'.repeat(500) }).row.title.length === 120);
check('unknown game mode rejected', bad({ game_mode: 'raid' }).error === 'invalid_game_mode');
check('missing payload rejected', bad({ payload: null }).error === 'missing_payload');
check('array payload rejected', bad({ payload: [] }).error === 'missing_payload');
check('list with no valid wishes rejected', bad({ payload: { name: 'x', items: { 1: { static: { name: 'x', type: 'weapon' }, wishes: [] } } } }).error === 'no_valid_wishes');
check('rejections carry an HTTP status', bad({ game_mode: 'raid' }).status === 400);
check('non-object body rejected cleanly', checkSubmission(null).ok === false && checkSubmission('x').ok === false);

// size cap on what is stored
const big = { name: 'Big', items: {} };
for (let i = 1; i <= 2600; i++) {
  big.items[i] = { static: { name: 'n'.repeat(80), type: 'weapon' },
    wishes: [{ tags: ['pve'], config: { perks: [] }, raw: 'r'.repeat(7000), added: 1 }] };
}
r = checkSubmission({ ...good, payload: big });
check(`over ${MAX_PAYLOAD_BYTES / 1048576} MB after cleaning is rejected as too large`, r.ok === false && r.status === 413 && r.error === 'payload_too_large');

// the edge function actually uses this
const fn = fs.readFileSync(path.resolve(__dirname, '..', 'supabase', 'functions', 'wishlist-actions', 'index.ts'), 'utf8');
check('wishlist-actions imports the shared validator', /_shared\/client\/wishlist-validate\.js/.test(fn) && /_shared\/submission\.js/.test(fn));
check('wishlist-actions stores the checked row, not the raw payload', /\.\.\.checked\.row/.test(fn) && !/payload: listPayload/.test(fn));

if (failures) { console.error(`\n${failures} edge-submission check(s) failed`); process.exit(1); }
console.log('\nAll edge-submission checks passed');
