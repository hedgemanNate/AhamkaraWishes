// Ahamkara Wishes — safe-rendering helpers shared by every view.
//
// Wishlist data is not trusted: Discover lists and .awwish files come from
// other people and are rendered as-is. So the default way to put something on
// screen must be the safe one:
//
//   AWDom.h('div', { class: 'card' }, name)        text is always text
//   AWDom.render(el, AWDom.html`<b>${name}</b>`)   every ${} is escaped
//   AWDom.raw(svgMarkup)                            only for markup we wrote
//
// escapeHtml() and safeImageUrl() remain for legacy string-built views; the
// lint ratchet (tools/lint-ratchet.js) counts innerHTML templates so new code
// uses the helpers above instead. Loaded first in sidepanel.html so every
// other script can rely on these globals.

(function (root) {
  'use strict';

  const BUNGIE_ORIGIN = 'https://www.bungie.net';

  const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

  /** Escapes text for use in HTML content AND inside quoted attribute values. */
  function escapeHtml(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, (c) => ESCAPES[c]);
  }

  const UNSAFE_URL_CHARS = /[\s"'<>\\]/;

  /**
   * Returns an image URL that is safe to load, or '' when it isn't one of ours.
   * Only Bungie-hosted art is ever needed, so anything else — another host, a
   * data:/javascript: URL, a protocol-relative URL — is refused. Otherwise a
   * shared wishlist could make every viewer's panel fetch an image from a
   * server of the author's choosing and learn their IP address.
   * Bungie-relative paths ("/common/destiny2_content/...") get the origin added.
   */
  function safeImageUrl(value) {
    if (typeof value !== 'string') return '';
    const v = value.trim();
    if (!v || v.startsWith('//')) return '';
    if (v.startsWith('/')) {
      return UNSAFE_URL_CHARS.test(v) ? '' : BUNGIE_ORIGIN + v;
    }
    try {
      const u = new URL(v);
      if (u.protocol !== 'https:' || u.hostname !== 'www.bungie.net' || u.port || u.username || u.password) return '';
      return UNSAFE_URL_CHARS.test(u.href) ? '' : u.href;
    } catch (e) {
      return '';
    }
  }

  /**
   * True for a link target we're willing to put in href/src: an https URL, or a
   * path inside the extension ("icons/x.png", "sidepanel.html"). Never
   * javascript:, data:, protocol-relative or anything with quotes/whitespace.
   */
  function isSafeUrl(value) {
    if (typeof value !== 'string') return false;
    const v = value.trim();
    if (!v || UNSAFE_URL_CHARS.test(v) || v.startsWith('//')) return false;
    if (/^[a-z][a-z0-9+.-]*:/i.test(v)) {
      try { return new URL(v).protocol === 'https:'; } catch (e) { return false; }
    }
    return true; // relative to the extension
  }

  // ---- trusted markup -------------------------------------------------------

  /** Markup that is safe to insert as HTML. Only html`` and raw() create it. */
  class SafeHTML {
    constructor(markup) { this.markup = markup; }
    toString() { return this.markup; }
  }

  /**
   * Marks markup we wrote ourselves (icon SVGs, static fragments) as trusted.
   * Never pass anything that contains data from storage, the network or a file.
   */
  function raw(markup) { return new SafeHTML(String(markup)); }

  function interpolate(value) {
    if (value instanceof SafeHTML) return value.markup;
    if (Array.isArray(value)) return value.map(interpolate).join('');
    if (value == null || value === false) return '';
    return escapeHtml(value);
  }

  /**
   * Tagged template that escapes every interpolation:
   *   html`<li title="${name}">${name}</li>`
   * Nested html`` results and arrays of them are inserted as markup; anything
   * else (strings, numbers, data) is escaped, so it's safe in text AND in
   * quoted attributes. Unquoted attributes and URLs still need care: use
   * h() for attributes that take URLs.
   */
  function html(strings, ...values) {
    let out = strings[0];
    for (let i = 0; i < values.length; i++) out += interpolate(values[i]) + strings[i + 1];
    return new SafeHTML(out);
  }

  /** Replaces el's contents with SafeHTML. Refuses plain strings on purpose. */
  function render(el, content) {
    if (!(content instanceof SafeHTML)) throw new TypeError('AWDom.render needs html`` or raw() markup, not a string');
    el.innerHTML = content.markup;
    return el;
  }

  // ---- element builder ------------------------------------------------------

  const URL_ATTRS = new Set(['href', 'src', 'action', 'formaction', 'srcset', 'poster', 'xlink:href']);

  function appendChildren(el, children) {
    for (const c of children) {
      if (c == null || c === false || c === true) continue;
      if (Array.isArray(c)) { appendChildren(el, c); continue; }
      if (c instanceof SafeHTML) { el.insertAdjacentHTML('beforeend', c.markup); continue; }
      if (typeof c === 'object' && typeof c.nodeType === 'number') { el.appendChild(c); continue; }
      el.appendChild(el.ownerDocument.createTextNode(String(c)));
    }
  }

  function classList(value) {
    if (!value) return '';
    if (typeof value === 'string') return value;
    if (Array.isArray(value)) return value.filter(Boolean).join(' ');
    return Object.keys(value).filter((k) => value[k]).join(' ');
  }

  /**
   * Builds an element. Children are text unless they are nodes or SafeHTML.
   *   h('button', { class: ['aw-btn', { 'is-on': on }], type: 'button',
   *                 aria: { pressed: on }, data: { id }, on: { click: fn } }, 'Save')
   * Props:
   *   class      string | array | { name: bool }
   *   text       sets textContent (instead of children)
   *   style      object of CSS properties (custom properties allowed)
   *   data       dataset entries          aria  aria-* attributes
   *   on         event listeners          ref   callback(el) after creation
   *   anything else is an attribute: true -> present, false/null -> absent.
   * on* attributes are refused (no inline handlers), and URL attributes must
   * pass isSafeUrl (img src additionally safeImageUrl unless it's local).
   */
  function h(tag, props, ...children) {
    const doc = root.document;
    if (!doc) throw new Error('AWDom.h needs a document');
    if (props == null || typeof props !== 'object' || Array.isArray(props) || props instanceof SafeHTML || typeof props.nodeType === 'number') {
      children.unshift(props);
      props = {};
    }
    const el = doc.createElement(tag);
    for (const [key, value] of Object.entries(props)) {
      if (value == null || value === false) continue;
      switch (key) {
        case 'class': case 'className': { const c = classList(value); if (c) el.setAttribute('class', c); break; }
        case 'text': el.textContent = String(value); break;
        case 'style': for (const [p, v] of Object.entries(value)) { if (v != null && v !== false) el.style.setProperty(p.startsWith('--') ? p : p.replace(/[A-Z]/g, (m) => '-' + m.toLowerCase()), String(v)); } break;
        case 'data': for (const [k, v] of Object.entries(value)) { if (v != null) el.dataset[k] = String(v); } break;
        case 'aria': for (const [k, v] of Object.entries(value)) { if (v != null && v !== false) el.setAttribute('aria-' + k, v === true ? 'true' : String(v)); } break;
        case 'on': for (const [ev, fn] of Object.entries(value)) { if (typeof fn === 'function') el.addEventListener(ev, fn); } break;
        case 'ref': break;
        default: {
          const name = key.toLowerCase();
          if (name.startsWith('on')) throw new Error(`AWDom.h: use { on: { ${key.slice(2)}: fn } } instead of an inline ${key} attribute`);
          if (URL_ATTRS.has(name)) {
            const v = String(value).trim();
            // A remote (or Bungie-relative "/...") image must be Bungie art; a local
            // image ("icons/x.png") and every other URL attribute must be a safe link.
            const remoteImage = tag === 'img' && name === 'src' && (/^[a-z][a-z0-9+.-]*:/i.test(v) || v.startsWith('/'));
            const safe = remoteImage ? safeImageUrl(v) : (isSafeUrl(v) ? v : '');
            if (!safe) { console.warn(`[AWDom] refused unsafe ${name}:`, v); break; }
            el.setAttribute(name, safe);
            break;
          }
          el.setAttribute(key, value === true ? '' : String(value));
        }
      }
    }
    if (!('text' in props)) appendChildren(el, children);
    if (typeof props.ref === 'function') props.ref(el);
    return el;
  }

  /** Event delegation: one listener on `container` for every `selector` match inside it. */
  function delegate(container, type, selector, handler) {
    const listener = (e) => {
      const target = e.target && e.target.closest ? e.target.closest(selector) : null;
      if (target && container.contains(target)) handler(e, target);
    };
    container.addEventListener(type, listener);
    return () => container.removeEventListener(type, listener);
  }

  root.escapeHtml = escapeHtml;
  root.AWDom = { escapeHtml, safeImageUrl, isSafeUrl, html, raw, render, h, delegate, SafeHTML, BUNGIE_ORIGIN };
})(typeof window !== 'undefined' ? window : globalThis);
