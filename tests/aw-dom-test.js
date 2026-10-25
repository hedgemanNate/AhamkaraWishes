// aw-dom.js: the escape-by-default builders new UI code uses (html``, h(),
// render(), isSafeUrl). Runs under Node with a minimal fake DOM, just enough to
// see what h() creates: which strings became text and which attributes were set.
const fs = require('fs');
const path = require('path');

const doc = {
  createElement: (tag) => new FakeElement(tag),
  createTextNode: (text) => new FakeText(text)
};
class FakeNode {
  constructor(type) { this.nodeType = type; this.childNodes = []; this.ownerDocument = doc; }
  appendChild(n) { this.childNodes.push(n); return n; }
}
class FakeText extends FakeNode {
  constructor(t) { super(3); this.data = t; }
  get textContent() { return this.data; }
}
class FakeElement extends FakeNode {
  constructor(tag) {
    super(1); this.tagName = tag.toUpperCase(); this.attributes = {}; this.dataset = {}; this.listeners = {};
    this.style = { props: {}, setProperty(k, v) { this.props[k] = v; } };
  }
  setAttribute(k, v) { this.attributes[k] = String(v); }
  getAttribute(k) { return k in this.attributes ? this.attributes[k] : null; }
  addEventListener(t, f) { (this.listeners[t] = this.listeners[t] || []).push(f); }
  insertAdjacentHTML(pos, markup) { this.childNodes.push({ nodeType: 99, markup }); }
  set textContent(v) { this.childNodes = [new FakeText(String(v))]; }
  get textContent() { return this.childNodes.map((c) => c.textContent || '').join(''); }
  set innerHTML(v) { this._html = v; }
  get innerHTML() { return this._html; }
}

global.window = global;
global.document = doc;
eval(fs.readFileSync(path.resolve(__dirname, '..', 'aw-dom.js'), 'utf8'));
const { html, raw, render, h, isSafeUrl, SafeHTML } = window.AWDom;

let failures = 0;
function check(label, cond) { console.log(`${cond ? 'PASS' : 'FAIL'}: ${label}`); if (!cond) failures++; }
const evil = '"><img src=x onerror="alert(1)">';
const warn = console.warn; console.warn = () => {}; // h() warns when it refuses a URL

// --- html``
const t = html`<b title="${evil}">${evil}</b>`;
check('html`` returns SafeHTML', t instanceof SafeHTML);
check('interpolations are escaped in text and in quoted attributes', !t.markup.includes('<img') && !/title="[^"]*"[^>]*onerror/.test(t.markup) && t.markup.includes('&quot;&gt;&lt;img'));
check('nested html`` is inserted as markup', html`<ul>${html`<li>${'a'}</li>`}</ul>`.markup === '<ul><li>a</li></ul>');
check('arrays of html`` are joined', html`<ul>${['x', 'y'].map((v) => html`<li>${v}</li>`)}</ul>`.markup === '<ul><li>x</li><li>y</li></ul>');
check('arrays of plain strings are still escaped', html`${['<b>', '<i>']}`.markup === '&lt;b&gt;&lt;i&gt;');
check('null, undefined and false render as nothing', html`a${null}b${undefined}c${false}d`.markup === 'abcd');
check('numbers render', html`${0}/${42}`.markup === '0/42');
check('raw() marks our own markup as trusted', html`${raw('<svg></svg>')}`.markup === '<svg></svg>');

// --- render()
const box = doc.createElement('div');
let threw = false; try { render(box, '<b>plain string</b>'); } catch (e) { threw = true; }
check('render() refuses a plain string', threw);
render(box, html`<b>${evil}</b>`);
check('render() writes SafeHTML', box.innerHTML.startsWith('<b>&quot;'));

// --- h(): text is always text
const p = h('p', { class: 'x' }, 'Hello ', evil, 3);
check('string children become text nodes, never markup', p.childNodes.length === 3 && p.childNodes.every((c) => c.nodeType === 3) && p.childNodes[1].data === evil);
check('props can be omitted', h('span', 'only text').textContent === 'only text');
check('a node as first argument is a child, not props', h('div', h('span', 'a')).childNodes[0].tagName === 'SPAN');
check('text prop sets textContent', h('b', { text: evil }).textContent === evil);
check('null / false / true children are skipped', h('i', null, false, true, 'k').childNodes.length === 1);
check('nested arrays are flattened', h('ul', [h('li', 'a'), [h('li', 'b'), null]]).childNodes.length === 2);
check('SafeHTML children are inserted as markup', h('div', raw('<svg/>')).childNodes[0].markup === '<svg/>');

// classes, attributes, aria, data, style, events
check('class from string', h('i', { class: 'a b' }).getAttribute('class') === 'a b');
check('class from array drops falsy', h('i', { class: ['a', false && 'b', 'c'] }).getAttribute('class') === 'a c');
check('class from object keeps truthy keys', h('i', { class: { on: true, off: false } }).getAttribute('class') === 'on');
const b = h('button', { type: 'button', disabled: true, hidden: false, aria: { pressed: true, label: 'Save' }, data: { id: 7 }, style: { minHeight: '44px', '--tone': 'gold' } });
check('true boolean attribute is present', b.getAttribute('disabled') === '');
check('false attribute is absent', b.getAttribute('hidden') === null);
check('aria attributes', b.getAttribute('aria-pressed') === 'true' && b.getAttribute('aria-label') === 'Save');
check('data attributes', b.dataset.id === '7');
check('style props, camelCase and custom', b.style.props['min-height'] === '44px' && b.style.props['--tone'] === 'gold');
let clicked = 0; const c = h('button', { on: { click: () => clicked++ } }, 'x'); c.listeners.click[0]();
check('on: adds listeners', clicked === 1);
let refd = null; const r = h('div', { ref: (el) => { refd = el; } }); check('ref receives the element', refd === r);
threw = false; try { h('a', { onclick: 'alert(1)' }); } catch (e) { threw = true; }
check('inline on* attributes are refused', threw);
threw = false; try { h('a', { onClick: 'alert(1)' }); } catch (e) { threw = true; }
check('inline on* attributes are refused in any case', threw);

// URL attributes
check('https href kept', h('a', { href: 'https://www.bungie.net/x' }).getAttribute('href') === 'https://www.bungie.net/x');
check('relative href kept', h('a', { href: 'PRIVACY_POLICY.html' }).getAttribute('href') === 'PRIVACY_POLICY.html');
check('javascript: href refused', h('a', { href: 'javascript:alert(1)' }).getAttribute('href') === null);
check('JaVaScRiPt: href refused', h('a', { href: ' JaVaScRiPt:alert(1)' }).getAttribute('href') === null);
check('data: href refused', h('a', { href: 'data:text/html,<b>x</b>' }).getAttribute('href') === null);
check('http: href refused', h('a', { href: 'http://example.com' }).getAttribute('href') === null);
check('quote-breaking href refused', h('a', { href: 'x" onmouseover="y' }).getAttribute('href') === null);
check('off-site image refused', h('img', { src: 'https://evil.example/t.gif' }).getAttribute('src') === null);
check('Bungie image kept', h('img', { src: 'https://www.bungie.net/common/a.jpg' }).getAttribute('src') === 'https://www.bungie.net/common/a.jpg');
check('Bungie-relative image gets the origin', h('img', { src: '/common/a.jpg' }).getAttribute('src') === 'https://www.bungie.net/common/a.jpg');
check('local image kept', h('img', { src: 'icons/unnamed.jpg' }).getAttribute('src') === 'icons/unnamed.jpg');
check('protocol-relative image refused', h('img', { src: '//evil.example/x.png' }).getAttribute('src') === null);

// isSafeUrl
for (const [u, ok] of [['https://a.b/c', true], ['icons/x.png', true], ['sidepanel.html#x', true], ['javascript:x', false], ['vbscript:x', false], ['//a.b', false], ['', false], [null, false], ['a b', false], ['ftp://x', false]]) {
  check(`isSafeUrl(${JSON.stringify(u)}) is ${ok}`, isSafeUrl(u) === ok);
}

console.warn = warn;
if (failures) { console.error(`\n${failures} aw-dom check(s) failed`); process.exit(1); }
console.log('\nAll aw-dom checks passed');
