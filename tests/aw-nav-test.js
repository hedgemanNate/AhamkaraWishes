// aw-nav.js: the one navigation controller (tabs, screens, sheets). Runs with
// fake elements that record hidden/inert/aria/focus, so we can check exactly
// what a person (or screen reader) would be able to reach.
const fs = require('fs');
const path = require('path');

const doc = { activeElement: null, listeners: {}, addEventListener(t, f) { (this.listeners[t] = this.listeners[t] || []).push(f); }, dispatchEvent() {} };
function el(name, { focusables = [] } = {}) {
  const e = {
    name, hidden: false, inert: false, attrs: {}, isConnected: true, clicks: [],
    setAttribute(k, v) { this.attrs[k] = String(v); }, removeAttribute(k) { delete this.attrs[k]; },
    getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; }, hasAttribute(k) { return k in this.attrs; },
    focus() { doc.activeElement = this; },
    addEventListener(t, f) { if (t === 'click') this.clicks.push(f); },
    click() { this.clicks.forEach((f) => f()); },
    querySelector(sel) { if (sel === '[autofocus]') return focusables.find((f) => f.autofocus) || null; return focusables[0] || null; }
  };
  return e;
}

global.window = global;
global.document = doc;
const store = {};
global.localStorage = { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); } };
eval(fs.readFileSync(path.resolve(__dirname, '..', 'aw-nav.js'), 'utf8'));

let failures = 0;
function check(label, cond) { console.log(`${cond ? 'PASS' : 'FAIL'}: ${label}`); if (!cond) failures++; }

const base = el('base');
const views = { wishes: el('wishes-view'), drops: el('drops-view') };
const buttons = { wishes: el('wishes-btn'), drops: el('drops-btn') };
const nav = AWNav.create({ base, document: doc, remember: 'aw.tab' });
nav.addTab('wishes', { view: views.wishes, button: buttons.wishes });
nav.addTab('drops', { view: views.drops, button: buttons.drops });

const listsInput = el('lists-search'); listsInput.autofocus = true;
const listsSheet = el('lists-sheet', { focusables: [el('lists-close'), listsInput] });
const deleteBtn = el('delete-btn');
const confirmSheet = el('confirm-sheet', { focusables: [deleteBtn] });
let allowClose = true, opened = null, closed = null;
const builder = el('builder', { focusables: [el('builder-close')] });
nav.addLayer('lists', { el: listsSheet, kind: 'sheet', onOpen: (p) => { opened = p; }, onClose: (p) => { closed = p; } });
nav.addLayer('confirm', { el: confirmSheet, kind: 'dialog' });
nav.addLayer('builder', { el: builder, kind: 'screen', canClose: () => allowClose });

const changes = []; nav.onChange((s) => changes.push(s));

check('layers start hidden', listsSheet.hidden && confirmSheet.hidden && builder.hidden);

// tabs
nav.show('wishes');
check('current tab view shown, others hidden', !views.wishes.hidden && views.drops.hidden);
check('current tab button has aria-current=page', buttons.wishes.getAttribute('aria-current') === 'page' && buttons.drops.getAttribute('aria-current') === null);
buttons.drops.click();
check('clicking a tab button switches tab', nav.state.tab === 'drops' && !views.drops.hidden && views.wishes.hidden);
check('tab is remembered', store['aw.tab'] === 'drops');
check('change listeners fire', changes.length === 2 && changes[1].tab === 'drops');

// sheets: inert, focus in, focus back
const opener = el('title-btn'); opener.focus();
nav.open('lists', { from: 'title' });
check('opened layer is visible', !listsSheet.hidden);
check('everything below is inert and hidden from screen readers', base.inert === true && base.getAttribute('aria-hidden') === 'true');
check('top layer is not inert', listsSheet.inert === false);
check('focus moves to [autofocus] inside the layer', doc.activeElement === listsInput);
check('onOpen gets params', opened && opened.from === 'title');
nav.open('confirm');
check('second layer stacks on top', nav.top === 'confirm' && !confirmSheet.hidden);
check('the layer beneath becomes inert', listsSheet.inert === true && confirmSheet.inert === false);
check('focus moves to the first focusable when no autofocus', doc.activeElement === deleteBtn);
nav.close();
check('close pops only the top', nav.top === 'lists' && confirmSheet.hidden && !listsSheet.hidden);
check('the uncovered layer is interactive again', listsSheet.inert === false);
check('focus returns to where it was before opening', doc.activeElement === listsInput);
nav.close();
check('closing the last layer restores the base', base.inert === false && base.getAttribute('aria-hidden') === null);
check('focus returns to the opener', doc.activeElement === opener);
check('onClose gets params', closed && closed.from === 'title');
check('close with nothing open is a no-op', nav.close() === false);

// re-open and errors
nav.open('lists', { a: 1 }); nav.open('lists', { a: 2 });
check('re-opening the top layer updates params, no duplicate', nav.state.stack.length === 1 && nav.state.stack[0].params.a === 2);
nav.open('confirm');
let threw = false; try { nav.open('lists'); } catch (e) { threw = true; }
check('opening a layer that is already lower in the stack throws', threw);
threw = false; try { nav.open('nope'); } catch (e) { threw = true; }
check('unknown layer throws', threw);
check('close(name) only closes when it is the top', nav.close('lists') === false && nav.top === 'confirm');
nav.closeAll();
check('closeAll empties the stack', nav.state.stack.length === 0);

// Escape
nav.open('lists');
let prevented = false;
doc.listeners.keydown.forEach((f) => f({ key: 'Escape', preventDefault() { prevented = true; } }));
check('Escape closes the top layer', nav.state.stack.length === 0 && prevented);
check('other keys do nothing', nav.handleKey({ key: 'Enter' }) === false);
nav.open('lists');
const inDialog = { closest: (sel) => (sel === 'dialog[open]' ? {} : null) };
check('Escape inside an open <dialog> (confirm) leaves the sheet beneath open', nav.handleKey({ key: 'Escape', target: inDialog }) === false && nav.top === 'lists');
check('Escape already handled elsewhere is ignored', nav.handleKey({ key: 'Escape', defaultPrevented: true }) === false && nav.top === 'lists');
nav.closeAll();

// guards
nav.open('builder');
allowClose = false;
check('a layer can refuse to close (unsaved changes)', nav.close() === false && nav.top === 'builder');
check('switching tab is refused while a layer refuses', nav.show('wishes') === false && nav.state.tab === 'drops');
check('Escape respects the guard', (nav.handleKey({ key: 'Escape' }), nav.top === 'builder'));
check('force closes anyway', nav.close(undefined, { force: true }) === true && nav.state.stack.length === 0);
allowClose = true;
nav.open('builder');
check('switching tab closes open layers when they allow it', nav.show('wishes') === true && nav.state.stack.length === 0 && nav.state.tab === 'wishes');

// explicit return focus, and no "return to <body>"
const other = el('other-btn');
nav.open('lists', {}, { returnFocus: other }); nav.close();
check('explicit returnFocus wins', doc.activeElement === other);
doc.body = el('body'); let bodyFocus = 0; doc.body.focus = () => { bodyFocus++; doc.activeElement = doc.body; };
doc.activeElement = doc.body; nav.open('lists'); nav.close();
check('when nothing had focus, closing does not focus <body> on purpose', bodyFocus === 0);
delete doc.body;

// restore
const nav2 = AWNav.create({ base: el('b2'), document: { addEventListener() {} }, remember: 'aw.tab', bindKeys: false });
nav2.addTab('wishes', { view: el('v1') }); nav2.addTab('drops', { view: el('v2') });
store['aw.tab'] = 'drops'; nav2.restore('wishes');
check('restore picks the remembered tab', nav2.state.tab === 'drops');
store['aw.tab'] = 'gone'; const nav3 = AWNav.create({ document: { addEventListener() {} }, remember: 'aw.tab', bindKeys: false });
nav3.addTab('wishes', { view: el('v3') }); nav3.restore('wishes');
check('restore falls back when the remembered tab no longer exists', nav3.state.tab === 'wishes');

if (failures) { console.error(`\n${failures} aw-nav check(s) failed`); process.exit(1); }
console.log('\nAll aw-nav checks passed');
