// Download progress: the stream reader, and a total that is honest and never dips.
const fs = require('fs');
const path = require('path');
global.window = global;
eval(fs.readFileSync(path.resolve(__dirname, '..', 'manifest-progress.js'), 'utf8'));
const P = window.AWManifestProgress;

let failures = 0;
function check(label, cond, detail) { console.log(`${cond ? 'PASS' : 'FAIL'}: ${label}${cond || !detail ? '' : `  (${detail})`}`); if (!cond) failures++; }

const bytes = (n, fill) => new Uint8Array(n).fill(fill);
const streamOf = (chunks, headers) => new Response(new ReadableStream({ start(c) { chunks.forEach((x) => c.enqueue(x)); c.close(); } }), { headers });

(async () => {
  // --- the stream reader
  const seen = [];
  const buf = await P.readWithProgress(streamOf([bytes(40, 1), bytes(35, 2), bytes(25, 3)], { 'content-length': '100' }), (r, t) => seen.push([r, t]));
  const u8 = new Uint8Array(buf);
  check('it returns every byte, in order', u8.length === 100 && u8[0] === 1 && u8[40] === 2 && u8[99] === 3);
  check('it reports running totals against the Content-Length', JSON.stringify(seen) === '[[40,100],[75,100],[100,100]]', JSON.stringify(seen));
  const noLen = [];
  await P.readWithProgress(streamOf([bytes(10, 1)], {}), (r, t) => noLen.push([r, t]));
  check('with no Content-Length the total is null, not a guess', noLen[0][1] === null);
  const plain = await P.readWithProgress({ headers: new Headers(), arrayBuffer: async () => new ArrayBuffer(7) }, (r, t) => noLen.push([r, t]));
  check('a body that can’t be streamed still arrives whole', plain.byteLength === 7 && noLen[noLen.length - 1][0] === 7);
  check('it works without a progress callback', (await P.readWithProgress(streamOf([bytes(3, 9)], {}))).byteLength === 3);

  // --- the running total
  const t = P.createTracker();
  check('nothing known yet is null, not 0%', t.percent() === null);
  t.update('items', 50, 200);
  check('a half-known download reports its share', t.percent() === 25);
  t.update('items', 200, 200);
  check('it stops at 99 until the caller says it is done', t.percent() === 99);
  const m = P.createTracker();
  m.update('items', 100, 100); m.update('sets', 0, 100);
  check('a table that starts later adds to the whole', m.percent() === 50);
  m.update('perks', 0, 300);
  check('and the number never goes backwards when it does', m.percent() === 50);
  const u = P.createTracker();
  u.update('a', 10, null); u.update('b', 50, 100);
  check('a table of unknown size is left out, not counted', u.percent() === 50);
  const o = P.createTracker();
  o.update('x', 500, 100);
  check('over-reading (a compressed length) can’t pass 99', o.percent() === 99);
  o.reset();
  check('reset starts over', o.percent() === null);

  // --- the event
  const events = [];
  global.document = { dispatchEvent: (e) => events.push(e.detail.percent) };
  global.CustomEvent = class { constructor(type, init) { this.type = type; this.detail = init && init.detail; } };
  P.reset();
  P.report('items', 10, 100); P.report('items', 10, 100); P.report('items', 40, 100); P.report('items', 41, 100);
  check('the event goes out only when the whole number changes', JSON.stringify(events) === '[10,40,41]', JSON.stringify(events));
  check('the shared percent follows', P.percent() === 41);

  if (failures) { console.error(`\n${failures} manifest-progress check(s) failed`); process.exit(1); }
  console.log('\nAll manifest-progress checks passed');
})();
