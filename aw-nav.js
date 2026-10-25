// Ahamkara Wishes — the one navigation controller.
//
// The redesigned panel (D3) has three kinds of place:
//   tabs     Wishes / Drops / Inventory / Discover — one visible at a time
//   screens  full-screen flows on top of the tabs (weapon/armor builder, Account)
//   sheets   bottom sheets and dialogs on top of whatever is showing
// Screens and sheets form a stack. AWNav owns all of it, so no view toggles
// .hidden/.active itself (the old panel had eight hand-wired copies of that):
//   - only the current tab view is shown; everything beneath the top layer is
//     `inert` (not clickable, not focusable, hidden from screen readers)
//   - tab buttons get aria-current="page"
//   - opening a layer moves focus into it; closing returns focus to where it was
//   - Escape closes the top layer
//   - a layer may refuse to close (canClose -> false), e.g. "Discard this wish?"
//
//   const nav = AWNav.create({ base: document.getElementById('app-main') });
//   nav.addTab('wishes', { view, button });
//   nav.addLayer('lists', { el: sheetEl, kind: 'sheet' });
//   nav.show('wishes');  nav.open('lists', { from: 'title' });  nav.close();
//
// Changes are announced on `document` as an `aw:nav` CustomEvent with the state.

(function (root) {
  'use strict';

  const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

  function create(options = {}) {
    const base = options.base || null;                 // element holding tabs + tab bar
    const doc = options.document || root.document;
    const tabs = new Map();                            // name -> { view, button }
    const layers = new Map();                          // name -> { el, kind, canClose, onOpen, onClose }
    const stack = [];                                  // [{ name, params, returnFocus }]
    let tab = null;
    const listeners = new Set();

    const state = () => ({ tab, stack: stack.map((s) => ({ name: s.name, params: s.params })) });

    function emit() {
      const s = state();
      listeners.forEach((fn) => { try { fn(s); } catch (e) { console.error('[AWNav] listener failed', e); } });
      if (doc && typeof root.CustomEvent === 'function' && doc.dispatchEvent) doc.dispatchEvent(new root.CustomEvent('aw:nav', { detail: s }));
    }

    function setInert(el, on) {
      if (!el) return;
      el.inert = !!on;
      if (on) el.setAttribute('aria-hidden', 'true'); else el.removeAttribute('aria-hidden');
    }

    /** Makes the DOM match the state. The only place visibility is changed. */
    function apply() {
      for (const [name, t] of tabs) {
        const on = name === tab;
        if (t.view) t.view.hidden = !on;
        if (t.button) { if (on) t.button.setAttribute('aria-current', 'page'); else t.button.removeAttribute('aria-current'); }
      }
      const open = new Set(stack.map((s) => s.name));
      for (const [name, l] of layers) l.el.hidden = !open.has(name);
      // Everything below the top layer is inert; the top layer never is.
      setInert(base, stack.length > 0);
      stack.forEach((s, i) => setInert(layers.get(s.name).el, i < stack.length - 1));
    }

    function focusInto(el) {
      if (!el || !el.querySelector) return;
      const target = el.querySelector('[autofocus]') || el.querySelector(FOCUSABLE) || el;
      if (target === el && !el.hasAttribute('tabindex')) el.setAttribute('tabindex', '-1');
      if (typeof target.focus === 'function') target.focus();
    }

    const api = {
      /** Registers a tab and its view (and optionally its tab-bar button). */
      addTab(name, { view, button } = {}) {
        tabs.set(name, { view, button });
        if (button && button.addEventListener) button.addEventListener('click', () => api.show(name));
        apply();
        return api;
      },

      /** Registers a screen or sheet. kind is informational ('screen' | 'sheet' | 'dialog'). */
      addLayer(name, { el, kind = 'sheet', canClose, onOpen, onClose } = {}) {
        if (!el) throw new Error(`AWNav.addLayer(${name}) needs an element`);
        layers.set(name, { el, kind, canClose, onOpen, onClose });
        el.hidden = true;
        return api;
      },

      /** Switches tab. Closes any open screens/sheets first (they may refuse). */
      show(name) {
        if (!tabs.has(name)) throw new Error(`AWNav: no tab "${name}"`);
        if (stack.length && !api.closeAll()) return false;
        if (tab === name) return true;
        tab = name;
        apply(); emit();
        if (options.remember) { try { root.localStorage.setItem(options.remember, name); } catch (e) { /* storage blocked */ } }
        return true;
      },

      /** Opens a screen or sheet on top of the stack. Re-opening the top one just updates params. */
      open(name, params = {}) {
        const layer = layers.get(name);
        if (!layer) throw new Error(`AWNav: no layer "${name}"`);
        const top = stack[stack.length - 1];
        if (top && top.name === name) { top.params = params; emit(); return true; }
        if (stack.some((s) => s.name === name)) throw new Error(`AWNav: "${name}" is already open below the top`);
        stack.push({ name, params, returnFocus: doc && doc.activeElement });
        apply();
        if (layer.onOpen) layer.onOpen(params);
        focusInto(layer.el);
        emit();
        return true;
      },

      /**
       * Closes the top layer (or the named one if it's on top). Returns false if the
       * layer refused (its canClose returned false). `force` skips canClose.
       */
      close(name, { force = false } = {}) {
        const top = stack[stack.length - 1];
        if (!top || (name && top.name !== name)) return false;
        const layer = layers.get(top.name);
        if (!force && layer.canClose && layer.canClose(top.params) === false) return false;
        stack.pop();
        apply();
        if (layer.onClose) layer.onClose(top.params);
        const back = top.returnFocus;
        if (back && back.isConnected !== false && typeof back.focus === 'function') back.focus();
        emit();
        return true;
      },

      /** Closes every layer, top first. Stops (returns false) at the first one that refuses. */
      closeAll() {
        while (stack.length) { if (!api.close()) return false; }
        return true;
      },

      /** Escape key: closes the top layer. Returns true if it handled the key. */
      handleKey(e) {
        if (e.key !== 'Escape' || !stack.length) return false;
        api.close();
        if (e.preventDefault) e.preventDefault();
        return true;
      },

      /** Restores the remembered tab, or `fallback`. */
      restore(fallback) {
        let saved = null;
        if (options.remember) { try { saved = root.localStorage.getItem(options.remember); } catch (e) { saved = null; } }
        return api.show(saved && tabs.has(saved) ? saved : fallback);
      },

      onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },
      isOpen(name) { return stack.some((s) => s.name === name); },
      get state() { return state(); },
      get top() { const t = stack[stack.length - 1]; return t ? t.name : null; }
    };

    if (options.bindKeys !== false && doc && doc.addEventListener) doc.addEventListener('keydown', (e) => api.handleKey(e));
    return api;
  }

  root.AWNav = { create };
})(typeof window !== 'undefined' ? window : globalThis);
