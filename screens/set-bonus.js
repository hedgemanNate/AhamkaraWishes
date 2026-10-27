// Ahamkara Wishes — the armor set bonus block (D15): what wearing 2 and 4 pieces
// does, with the real names and descriptions from the game data. Shared by the
// Wishes detail and the armor builder so both say the same thing.
//
//   AWSetBonus.block(setHash, { fold })
//                               an element that fills itself in once the text loads;
//                               "No set bonus" for armor that has none. `fold` makes it a
//                               collapsed line (names only) that opens to the descriptions,
//                               for screens where the bonus is context, not the task.
//
// Needs aw-dom and destiny-manifest.js (getArmorSetBonuses).

(function (root) {
  'use strict';

  const D = root.AWDom, doc = root.document;
  const { h } = D;
  const cache = new Map();   // setHash -> bonuses[] | Promise
  doc.addEventListener('awManifestReady', () => cache.clear());

  function load(setHash) {
    if (!cache.has(setHash)) {
      cache.set(setHash, root.getArmorSetBonuses(setHash).then(
        (b) => { cache.set(setHash, b); return b; },
        () => { cache.set(setHash, []); return []; }));
    }
    const v = cache.get(setHash);
    return Array.isArray(v) ? Promise.resolve(v) : v;
  }

  function icon(url) {
    const src = D.safeImageUrl(url);
    return src ? h('img', { class: 'ui-itemicon', src, alt: '', loading: 'lazy' }) : null;
  }

  function items(bonuses) {
    return bonuses.map((b) => h('div', { class: 'ui-bonus__item' }, b.icon ? icon(b.icon) : null,
      h('div', null,
        h('div', { class: 'ui-bonus__name' }, `${b.name} `, h('span', { class: 'ui-bonus__count' }, `${b.count} pieces`)),
        h('div', { class: 'ui-bonus__desc' }, b.description))));
  }

  function paint(el, bonuses, fold) {
    if (!bonuses.length) { el.className = 'ui-bonus ui-bonus--none'; el.replaceChildren(fold ? h('summary', null, 'No set bonus') : 'No set bonus'); return; }
    if (fold) {
      el.className = 'ui-bonus ui-bonus--fold';
      el.replaceChildren(h('summary', null, h('span', { class: 'ui-bonus__title' }, 'Set bonus'), ` · ${bonuses.map((b) => b.name).join(', ')}`), ...items(bonuses));
      return;
    }
    el.className = 'ui-bonus';
    el.replaceChildren(h('div', { class: 'ui-bonus__title' }, 'Set bonus'), ...items(bonuses));
  }

  function block(setHash, { fold = false } = {}) {
    const el = h(fold ? 'details' : 'div', { class: 'ui-bonus' });
    if (!setHash || typeof root.getArmorSetBonuses !== 'function') { paint(el, [], fold); return el; }
    const cached = cache.get(setHash);
    if (Array.isArray(cached)) { paint(el, cached, fold); return el; }
    el.replaceChildren(...(fold ? [h('summary', null, h('span', { class: 'ui-bonus__title' }, 'Set bonus'), ' · loading…')]
      : [h('div', { class: 'ui-bonus__title' }, 'Set bonus'), h('div', { class: 'ui-bonus__desc' }, 'Loading…')]));
    load(setHash).then((b) => { if (el.isConnected !== false) paint(el, b, fold); });
    return el;
  }

  root.AWSetBonus = { block };
})(typeof window !== 'undefined' ? window : globalThis);
