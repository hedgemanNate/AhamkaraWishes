// sync-status.js (D11): every sync state maps to one plain-language description
// and one action, states win in the right priority order, and signed-out users
// are never auto-synced.
const fs = require('fs');
const path = require('path');

global.window = global;
eval(fs.readFileSync(path.resolve(__dirname, '..', 'sync-status.js'), 'utf8'));
const { describe, shouldAutoSync, classifyError, formatAgo } = window.AWSync;

let failures = 0;
function check(label, cond) { console.log(`${cond ? 'PASS' : 'FAIL'}: ${label}`); if (!cond) failures++; }

const now = 1_800_000_000_000;
const base = { signedIn: true, online: true, manifest: 'ready', syncing: false, lastSyncAt: now - 120000, now };
const k = (over) => describe(Object.assign({}, base, over)).key;

// each state
check('synced', k({}) === 'ok');
check('synced chip shows how long ago', describe(base).chip.label === '2m');
check('synced offers Sync now', describe(base).action.kind === 'sync');
check('synced has no banner', describe(base).banner === null);
check('syncing', k({ syncing: true }) === 'syncing');
check('syncing has no action (nothing to do)', describe(Object.assign({}, base, { syncing: true })).action === null);
check('downloading', k({ manifest: 'downloading', manifestProgress: 42.6 }) === 'downloading');
check('downloading shows the percentage', describe(Object.assign({}, base, { manifest: 'downloading', manifestProgress: 42.6 })).chip.label === '43%');
check('no game data', k({ manifest: 'missing' }) === 'nodata');
check('no game data offers the download', describe(Object.assign({}, base, { manifest: 'missing' })).action.kind === 'download');
check('offline', k({ online: false }) === 'offline');
check('session ended (flag)', k({ sessionExpired: true }) === 'expired');
check('session ended (auth error while signed in)', k({ lastError: { name: 'AuthError', message: 'Not signed in to Bungie.' } }) === 'expired');
check('signed out', k({ signedIn: false }) === 'signedout');
check('signed out offers sign-in, not a retry', describe(Object.assign({}, base, { signedIn: false })).action.kind === 'signin');
check('maintenance', k({ lastError: { message: 'Bungie API ErrorCode 5 SystemDisabled' } }) === 'paused');
check('other failures', k({ lastError: new Error('boom') }) === 'error');

// priority order
check('downloading beats offline', k({ manifest: 'downloading', online: false }) === 'downloading');
check('missing data beats offline', k({ manifest: 'missing', online: false }) === 'nodata');
check('offline beats session ended', k({ online: false, sessionExpired: true }) === 'offline');
check('session ended beats signed out', k({ signedIn: false, sessionExpired: true }) === 'expired');
check('signed out beats an old auth error', k({ signedIn: false, lastError: { name: 'AuthError' } }) === 'signedout');
check('syncing beats a previous failure', k({ syncing: true, lastError: new Error('x') }) === 'syncing');

// every state has the full shape, and copy never blames the user
for (const over of [{}, { syncing: true }, { manifest: 'downloading' }, { manifest: 'missing' }, { online: false }, { sessionExpired: true }, { signedIn: false }, { lastError: { code: 5 } }, { lastError: new Error('x') }]) {
  const d = describe(Object.assign({}, base, over));
  check(`state ${d.key} has chip/title/body`, d.chip && d.chip.label && d.chip.tone && d.title && d.body);
  check(`state ${d.key} copy has no "error"/"failed to fetch" jargon`, !/failed to fetch|exception|undefined|null/i.test(d.title + d.body));
}

// auto-sync rule (the signed-out retry bug)
check('auto-sync runs when signed in, online and ready', shouldAutoSync(base) === true);
check('never auto-sync signed out', shouldAutoSync(Object.assign({}, base, { signedIn: false })) === false);
check('never auto-sync with an ended session', shouldAutoSync(Object.assign({}, base, { sessionExpired: true })) === false);
check('never auto-sync offline', shouldAutoSync(Object.assign({}, base, { online: false })) === false);
check('never auto-sync while game data downloads', shouldAutoSync(Object.assign({}, base, { manifest: 'downloading' })) === false);

// error classification
check('AuthError is auth', classifyError({ name: 'AuthError', message: 'x' }) === 'auth');
check('invalid_grant is auth', classifyError({ code: 'invalid_grant' }) === 'auth');
check('ErrorCode 5 is maintenance', classifyError({ ErrorCode: 5 }) === 'maintenance');
check('fetch TypeError is network', classifyError(new TypeError('Failed to fetch')) === 'network');
check('anything else is other', classifyError(new Error('weird')) === 'other');
check('nothing is other', classifyError(null) === 'other');

// time
check('formatAgo just now', formatAgo(3000) === 'Just now');
check('formatAgo seconds', formatAgo(45000) === '45s');
check('formatAgo minutes', formatAgo(3 * 60000) === '3m');
check('formatAgo hours', formatAgo(5 * 3600000) === '5h');
check('formatAgo days', formatAgo(3 * 86400000) === '3d');
check('formatAgo of nothing is empty', formatAgo(undefined) === '' && formatAgo(-5) === '');

if (failures) { console.error(`\n${failures} sync-status check(s) failed`); process.exit(1); }
console.log('\nAll sync-status checks passed');
