// Discover: the queries, what a card shows, the submit rules, and the client.
const fs = require('fs');
const path = require('path');
global.window = global;
eval(fs.readFileSync(path.resolve(__dirname, '..', 'discover-core.js'), 'utf8'));
const X = window.AWDiscover;

let failures = 0;
function check(label, cond, detail) { console.log(`${cond ? 'PASS' : 'FAIL'}: ${label}${cond || !detail ? '' : `  (${detail})`}`); if (!cond) failures++; }

// --- queries
check('each filter asks the server the right thing', X.filterParam('pve') === 'game_mode=eq.pve' && X.filterParam('pvp') === 'game_mode=eq.pvp' && X.filterParam('weapons') === 'has_weapons=eq.true' && X.filterParam('armor') === 'has_armor=eq.true' && X.filterParam('all') === '');
check('featured is newest first and honours the filter', /^\/wishlists\?featured=eq\.true&game_mode=eq\.pve&select=.*&order=created_at\.desc$/.test(X.featuredPath('pve')) && !/game_mode=eq|has_\w+=eq/.test(X.featuredPath('all')));
check('community pages by offset', /featured=eq\.false/.test(X.communityPath('all', 40)) && /limit=20&offset=40$/.test(X.communityPath('all', 40)) && /offset=0$/.test(X.communityPath('all')));
check('search matches title or creator, featured first, paged', /or=\(title\.ilike\.\*fate\*,submitter_bungie_name\.ilike\.\*fate\*\)/.test(X.searchPath('fate', 'all', 0)) && /order=featured\.desc,created_at\.desc/.test(X.searchPath('fate', 'all', 0)) && /offset=20$/.test(X.searchPath('fate', 'all', 20)));
check('search text cannot break out of the query', !/[,()*]/.test(X.searchPath('a),title.eq.x,(b*', 'all', 0).match(/ilike\.\*(.*?)\*,/)[1]) && /%20|\+|ab/.test(X.searchPath('a b', 'all', 0)) && X.searchPath('x&select=payload', 'all', 0).includes('x%26select%3Dpayload'));
check('my submissions are asked for by membership id, encoded', X.minePath('123/45').includes('submitter_membership_id=eq.123%2F45') && X.payloadPath('a b').includes('id=eq.a%20b&select=payload'));

// --- showing a row
const creators = new Map([['Datto#1', { display_name: 'Datto', verified: true }], ['Plain#2', { display_name: '', verified: false }]]);
check('a known creator shows their chosen name and a tick', X.authorOf({ submitter_bungie_name: 'Datto#1' }, creators).name === 'Datto' && X.authorOf({ submitter_bungie_name: 'Datto#1' }, creators).verified);
check('anyone else shows their Bungie name', X.authorOf({ submitter_bungie_name: 'Nobody#9' }, creators).name === 'Nobody#9' && !X.authorOf({ submitter_bungie_name: 'Nobody#9' }, creators).verified && X.authorOf({ submitter_bungie_name: 'Plain#2' }, creators).name === 'Plain#2');
const card = X.cardView({ id: 7, title: '<img src=x onerror=alert(1)>', game_mode: 'pve', has_weapons: true, has_armor: 0, item_count: '12', save_count: 3, featured: 1, submitter_bungie_name: 'Datto#1' }, creators);
check('a card keeps text as text and numbers as numbers', card.title === '<img src=x onerror=alert(1)>' && card.items === 12 && card.saves === 3 && card.featured === true && card.hasWeapons && !card.hasArmor && card.id === '7');
check('an unknown mode becomes mixed, so it can never be a class name', X.cardView({ game_mode: 'x" onclick="y' }).mode === 'mixed' && X.cardView({ game_mode: 'pvp' }).mode === 'pvp');
check('bad rows never throw', X.cardView(null).title === 'Untitled' && X.cardView({ item_count: -4, save_count: 'x' }).items === 0 && X.cardView({ title: '  ' }).title === 'Untitled' && X.cardView({}).author.name === 'Unknown');
check('item counts read naturally', X.itemsText(1) === '1 item' && X.itemsText(0) === '0 items' && X.itemsText(12) === '12 items');

// --- submitting
const w = (tag) => ({ tags: [tag] });
check('the suggested mode follows the wishes', X.detectMode({ items: { 1: { wishes: [w('pve'), w('pve'), w('pvp')] } } }) === 'pve' && X.detectMode({ items: { 1: { wishes: [w('pvp'), w('pvp'), w('pve')] } } }) === 'pvp' && X.detectMode({ items: {} }) === 'mixed' && X.detectMode(null) === 'mixed');
check('items are counted per weapon or set piece, not per roll', X.itemCountOf({ items: { 1: { wishes: [w('pve'), w('pve')] }, 2: { wishes: [w('pve')] } } }) === 2 && X.itemCountOf(null) === 0);
check('the cap note is plain', X.capNote({ submittedCount: 3, cap: 5 }) === '3 of 5 submissions used.' && X.capNote(null) === '' && X.capNote({}) === '');
check('server errors read as sentences', /limit of 5/.test(X.submitError('submission_cap_reached', 5)) && /no wishes/.test(X.submitError('no_valid_wishes')) && /too big/.test(X.submitError('payload_too_large')) && /boom/.test(X.submitError('boom')) && /something went wrong/.test(X.submitError('')));

// --- the client
(async () => {
  const calls = [];
  const reply = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
  let routes = {};
  const client = X.createClient({
    fetch: async (url, init) => { calls.push({ url, init }); const hit = Object.keys(routes).find((k) => url.includes(k)); if (!hit) throw new Error('offline'); const r = routes[hit]; return typeof r === 'function' ? r(url, init) : r; },
    getAuth: async () => (client.signedOut ? null : { access_token: 'tok' })
  });

  routes = { '/creators': reply(200, [{ bungie_name: 'Datto#1', display_name: 'Datto', verified: true }]) };
  const c = await client.creators();
  check('the creator list becomes a lookup, sent with the public key only', c.get('Datto#1').display_name === 'Datto' && calls[0].init.headers.apikey && !/tok/.test(JSON.stringify(calls[0].init.headers)));
  routes = {};
  check('if the creators can’t be read the lists still show', (await client.creators()).size === 0);

  routes = { '/wishlists': reply(200, [{ id: 1 }]) };
  check('browsing asks for the path and returns rows', (await client.featured('pve')).length === 1 && calls[calls.length - 1].url.includes('featured=eq.true') && (await client.community('all', 20)).length === 1 && (await client.search('x', 'all', 0)).length === 1);
  routes = { '/wishlists': reply(500, {}) };
  check('a failed request is an error, not an empty list', await client.featured('all').then(() => false, (e) => /500/.test(e.message)));

  routes = { 'wishlist-actions': (u, init) => reply(200, JSON.parse(init.body).action === 'whoami' ? { membershipId: 'm1', submittedCount: 1, cap: 5 } : {}), '/wishlists': reply(200, [{ id: 9 }]) };
  const mine = await client.mine();
  check('my submissions: who I am, then my rows, by membership id', mine.who.cap === 5 && mine.rows.length === 1 && calls[calls.length - 1].url.includes('submitter_membership_id=eq.m1'));
  const whoamiCall = calls.find((x) => x.url.includes('wishlist-actions'));
  check('the Bungie token goes only to the function, never to the table', JSON.parse(whoamiCall.init.body).bungie_access_token === 'tok' && !/tok/.test(JSON.stringify(calls.filter((x) => x.url.includes('/rest/')).map((x) => x.init.headers))));

  client.signedOut = true;
  check('signed out, anything that needs you fails with a clear code', await client.mine().then(() => false, (e) => e.code === 'not_signed_in') && await client.submit({}).then(() => false, (e) => e.code === 'not_signed_in') && await client.remove('x').then(() => false, (e) => e.code === 'not_signed_in'));
  client.signedOut = false;

  routes = { 'wishlist-actions': reply(400, { error: 'submission_cap_reached' }) };
  check('a refusal carries the server’s code', await client.submit({ title: 't', mode: 'pve', payload: {} }).then(() => false, (e) => e.code === 'submission_cap_reached'));
  routes = { 'wishlist-actions': (u, init) => reply(200, { ok: true, sent: JSON.parse(init.body) }) };
  const sub = await client.submit({ title: 'T', mode: 'pvp', payload: { name: 'n' } });
  check('submit sends title, mode and the list', sub.sent.action === 'submit' && sub.sent.title === 'T' && sub.sent.game_mode === 'pvp' && sub.sent.payload.name === 'n');
  check('delete sends the id', (await client.remove('w1')).sent.wishlist_id === 'w1');

  routes = { '/wishlists': reply(200, [{ payload: { name: 'L', items: {} } }]) };
  check('a list’s contents come back as the payload', (await client.payload('1')).name === 'L');
  routes = { '/wishlists': reply(200, []) };
  check('a list that was removed says so', await client.payload('1').then(() => false, (e) => /no longer exists/.test(e.message)));
  routes = { 'increment_wishlist_save_count': reply(200, {}) };
  check('counting a save works, and failing to count never throws', (await client.countSave('1')) === true && (routes = {}, (await client.countSave('1')) === false));

  if (failures) { console.error(`\n${failures} discover-core check(s) failed`); process.exit(1); }
  console.log('\nAll discover-core checks passed');
})();
