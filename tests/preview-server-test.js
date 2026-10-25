// The preview server (tools/preview/serve.js) is dev-only, but it must never
// serve files outside the repo or from .git, and it must inject the chrome.*
// stub before the page's first script so no app code runs without it.
const path = require('path');
const assert = require('assert');
const { injectStub, safeJoin } = require('../tools/preview/serve.js');

const base = path.resolve(__dirname, '..');
assert.strictEqual(safeJoin(base, '/sidepanel.html'), path.join(base, 'sidepanel.html'));
assert.strictEqual(safeJoin(base, '/icons/icon16.png'), path.join(base, 'icons', 'icon16.png'));
for (const bad of ['/../etc/passwd', '/..%2F..%2Fetc%2Fpasswd', '/.git/config', '/icons/../../x', '/.git']) {
  assert.strictEqual(safeJoin(base, bad), null, 'must refuse ' + bad);
}

const html = '<html><head><link rel="stylesheet" href="a.css"></head><body><p>x</p><script src="one.js"></script><script src="two.js"></script></body></html>';
const out = injectStub(html);
assert.ok(out.indexOf('chrome-stub.js') < out.indexOf('one.js'), 'stub goes before the first script');
assert.strictEqual((out.match(/chrome-stub\.js/g) || []).length, 1, 'injected exactly once');
assert.throws(() => injectStub('<html><body>no scripts</body></html>'));

console.log('Preview server test passed');
