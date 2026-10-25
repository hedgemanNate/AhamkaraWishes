// Ahamkara Wishes — UI building blocks for the redesigned panel.
//
// Small factories that return DOM elements, built with AWDom.h so any data
// they show stays text. Styles live in styles/components.css (.ui-* classes).
// Each block owns its accessibility: roles, labels, keyboard, focus.
//
//   const save = AWUI.button({ label: 'Save', variant: 'primary', onClick });
//   AWUI.toast('Roll deleted.', { undo: () => restore() });
//   if (await AWUI.confirm({ title: 'Remove from Discover?', danger: true })) ...
//
// Rules the blocks follow (from the Phase 1 decisions):
//   - every interactive element is at least 44px tall or has a 44px hit area (D2)
//   - restorable actions use an Undo toast; only irreversible ones confirm (D6)
//   - nothing relies on hover; everything works with a tap or the keyboard (D2)

(function (root) {
  'use strict';

  const D = root.AWDom;
  if (!D) throw new Error('aw-ui.js needs aw-dom.js loaded first');
  const { h, raw } = D;

  // Our own icons (trusted markup). currentColor so they follow text colour.
  const ICON = {
    close: raw('<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" focusable="false"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="2" stroke-linecap="round" fill="none"/></svg>'),
    search: raw('<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false"><circle cx="11" cy="11" r="6.5" stroke="currentColor" stroke-width="2" fill="none"/><path d="M16 16l4.5 4.5" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>'),
    more: raw('<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" focusable="false"><circle cx="5" cy="12" r="1.8" fill="currentColor"/><circle cx="12" cy="12" r="1.8" fill="currentColor"/><circle cx="19" cy="12" r="1.8" fill="currentColor"/></svg>'),
    check: raw('<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" focusable="false"><path d="M5 12.5l4.5 4.5L19 7" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" fill="none"/></svg>'),
    chevron: raw('<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false"><path d="M9 6l6 6-6 6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" fill="none"/></svg>'),
    filter: raw('<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false"><path d="M4 6h16M7 12h10M10 18h4" stroke="currentColor" stroke-width="2" stroke-linecap="round" fill="none"/></svg>')
  };

  let uid = 0;
  const nextId = (p) => `${p}-${++uid}`;

  // ---- buttons ---------------------------------------------------------------

  /**
   * @param {{label:string, variant?:'primary'|'secondary'|'ghost'|'danger', size?:'md'|'lg',
   *          icon?:object, block?:boolean, disabled?:boolean, type?:string, onClick?:Function, aria?:object}} o
   */
  function button(o) {
    return h('button', {
      type: o.type || 'button',
      class: ['ui-btn', `ui-btn--${o.variant || 'secondary'}`, o.size === 'lg' && 'ui-btn--lg', o.block && 'ui-btn--block'],
      disabled: !!o.disabled,
      aria: o.aria,
      on: o.onClick ? { click: o.onClick } : undefined
    }, o.icon ? h('span', { class: 'ui-btn__icon' }, o.icon) : null, h('span', { class: 'ui-btn__label' }, o.label));
  }

  /** Icon-only button with a required accessible name and a 44px target. */
  function iconButton(o) {
    if (!o.label) throw new Error('AWUI.iconButton needs a label for screen readers');
    return h('button', {
      type: 'button', class: ['ui-icon-btn', o.className], aria: Object.assign({ label: o.label }, o.aria),
      title: o.title || undefined, disabled: !!o.disabled, on: o.onClick ? { click: o.onClick } : undefined
    }, o.icon || ICON.more);
  }

  // ---- chips -----------------------------------------------------------------

  /** Toggle chip (aria-pressed) or removable chip (onRemove). */
  function chip(o) {
    const el = h('button', {
      type: 'button',
      class: ['ui-chip', o.selected && 'is-selected', o.onRemove && 'ui-chip--removable'],
      aria: o.onRemove ? { label: `Remove filter ${o.label}` } : { pressed: !!o.selected },
      on: { click: (e) => { if (o.onRemove) o.onRemove(e); else if (o.onClick) o.onClick(e); } }
    }, o.icon ? h('span', { class: 'ui-chip__icon' }, o.icon) : null, h('span', null, o.label),
    o.count != null ? h('span', { class: 'ui-chip__count' }, String(o.count)) : null,
    o.onRemove ? h('span', { class: 'ui-chip__x', aria: { hidden: true } }, '×') : null);
    return el;
  }

  /** Horizontally scrolling row of chips. */
  function chipRow(chips, { label } = {}) {
    return h('div', { class: 'ui-chip-row', role: 'group', aria: label ? { label } : undefined }, chips);
  }

  // ---- segmented control -------------------------------------------------------

  /**
   * One choice from 2-4 options (Weapons | Armor, PvE | PvP). A radio group:
   * arrow keys move the choice, only the selected option is in the tab order.
   * @param {{options:Array<{value:string,label:string,badge?:string|number}>, value:string, label:string, onChange:Function}} o
   */
  function segmented(o) {
    let value = o.value;
    const group = h('div', { class: 'ui-seg', role: 'radiogroup', aria: { label: o.label } });
    const buttons = o.options.map((opt) => h('button', {
      type: 'button', role: 'radio', class: 'ui-seg__opt', data: { value: opt.value },
      on: { click: () => select(opt.value, true) }
    }, h('span', null, opt.label), opt.badge != null ? h('span', { class: 'ui-seg__badge' }, String(opt.badge)) : null));
    buttons.forEach((b) => group.appendChild(b));

    function paint() {
      buttons.forEach((b) => {
        const on = b.dataset.value === value;
        b.setAttribute('aria-checked', String(on));
        b.tabIndex = on ? 0 : -1;
        b.classList.toggle('is-selected', on);
      });
    }
    function select(v, fromUser) {
      if (v === value) return;
      value = v; paint();
      if (fromUser && o.onChange) o.onChange(v);
    }
    group.addEventListener('keydown', (e) => {
      const keys = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 };
      if (!(e.key in keys) && e.key !== 'Home' && e.key !== 'End') return;
      e.preventDefault();
      const i = o.options.findIndex((x) => x.value === value);
      const n = e.key === 'Home' ? 0 : e.key === 'End' ? o.options.length - 1 : (i + keys[e.key] + o.options.length) % o.options.length;
      select(o.options[n].value, true);
      buttons[n].focus();
    });
    paint();
    group.setValue = (v) => select(v, false);
    group.getValue = () => value;
    return group;
  }

  // ---- search ----------------------------------------------------------------

  /** Search input with a visible label for screen readers and a clear button. */
  function searchField(o) {
    const id = o.id || nextId('ui-search');
    const input = h('input', { id, type: 'search', class: 'ui-search__input', placeholder: o.placeholder || 'Search', value: o.value || '', autocomplete: 'off', spellcheck: 'false' });
    const clear = iconButton({ label: 'Clear search', icon: ICON.close, className: 'ui-search__clear', onClick: () => { input.value = ''; sync(); if (o.onInput) o.onInput(''); input.focus(); } });
    function sync() { clear.hidden = !input.value; }
    input.addEventListener('input', () => { sync(); if (o.onInput) o.onInput(input.value); });
    input.addEventListener('keydown', (e) => { if (e.key === 'Escape' && input.value) { e.stopPropagation(); clear.click(); } });
    sync();
    return h('div', { class: 'ui-search', role: 'search' },
      h('label', { for: id, class: 'ui-sr-only' }, o.label || o.placeholder || 'Search'),
      h('span', { class: 'ui-search__icon', aria: { hidden: true } }, ICON.search), input, clear);
  }

  // ---- rows, cards, badges ---------------------------------------------------------

  /**
   * A list row. With onClick the whole row is one button (a big target, D2).
   * @param {{leading?:Node, title:string|Node, subtitle?:string|Node, trailing?:Node, onClick?:Function, label?:string}} o
   */
  function row(o) {
    const body = [
      o.leading ? h('span', { class: 'ui-row__lead' }, o.leading) : null,
      h('span', { class: 'ui-row__text' },
        h('span', { class: 'ui-row__title' }, o.title),
        o.subtitle != null ? h('span', { class: 'ui-row__sub' }, o.subtitle) : null),
      o.trailing ? h('span', { class: 'ui-row__trail' }, o.trailing) : null
    ];
    return o.onClick
      ? h('button', { type: 'button', class: ['ui-row', 'ui-row--action', o.className], aria: o.label ? { label: o.label } : undefined, on: { click: o.onClick } }, body)
      : h('div', { class: ['ui-row', o.className] }, body);
  }

  function card(...children) { return h('div', { class: 'ui-card' }, children); }

  /** Small status label. tone: accent | muted | success | warning | danger | pve | pvp */
  function badge(label, tone = 'muted') { return h('span', { class: ['ui-badge', `ui-badge--${tone}`] }, label); }

  // ---- switch ----------------------------------------------------------------------

  /** On/off setting with label and optional description; role="switch". */
  function switchRow(o) {
    let on = !!o.checked;
    const id = nextId('ui-switch');
    const sw = h('button', { type: 'button', role: 'switch', class: 'ui-switch', aria: { labelledby: `${id}-label`, describedby: o.description ? `${id}-desc` : undefined } });
    const paint = () => { sw.setAttribute('aria-checked', String(on)); sw.classList.toggle('is-on', on); };
    sw.addEventListener('click', () => { on = !on; paint(); if (o.onChange) o.onChange(on); });
    paint();
    const el = h('div', { class: 'ui-switch-row' },
      h('span', { class: 'ui-switch-row__text' },
        h('span', { id: `${id}-label`, class: 'ui-switch-row__label' }, o.label),
        o.description ? h('span', { id: `${id}-desc`, class: 'ui-switch-row__desc' }, o.description) : null),
      sw);
    el.setChecked = (v) => { on = !!v; paint(); };
    return el;
  }

  // ---- status ------------------------------------------------------------------------

  /** Inline status message under the app bar. tone: info | warning | danger | success */
  function banner(o) {
    return h('div', { class: ['ui-banner', `ui-banner--${o.tone || 'info'}`], role: o.tone === 'danger' ? 'alert' : 'status' },
      h('span', { class: 'ui-banner__text' }, o.text),
      o.action ? button({ label: o.action.label, variant: 'ghost', onClick: o.action.onClick }) : null);
  }

  /** Determinate progress bar with an accessible name. */
  function progress(o) {
    const pct = Math.max(0, Math.min(100, Math.round((o.value / (o.max || 100)) * 100)));
    return h('div', { class: 'ui-progress', role: 'progressbar', aria: { valuenow: pct, valuemin: 0, valuemax: 100, label: o.label } },
      h('span', { class: 'ui-progress__bar', style: { width: pct + '%' } }));
  }

  /** Empty / error state: says what's going on and offers the next action. */
  function emptyState(o) {
    return h('div', { class: 'ui-empty' },
      o.icon ? h('div', { class: 'ui-empty__art', aria: { hidden: true } }, o.icon) : null,
      h('p', { class: 'ui-empty__title' }, o.title),
      o.body ? h('p', { class: 'ui-empty__body' }, o.body) : null,
      (o.actions || []).length ? h('div', { class: 'ui-empty__actions' }, o.actions) : null);
  }

  // ---- sheets ------------------------------------------------------------------------

  /**
   * Bottom sheet, shown and hidden by AWNav (register it with nav.addLayer).
   * Tapping the scrim or the close button calls onClose (usually nav.close).
   * @returns {HTMLElement} the layer element (scrim + sheet)
   */
  function sheet(o) {
    const id = nextId('ui-sheet');
    const panel = h('section', { class: 'ui-sheet', role: 'dialog', aria: { modal: true, labelledby: `${id}-title` } },
      h('div', { class: 'ui-sheet__grab', aria: { hidden: true } }),
      h('header', { class: 'ui-sheet__head' },
        h('h2', { id: `${id}-title`, class: 'ui-sheet__title' }, o.title),
        iconButton({ label: 'Close', icon: ICON.close, onClick: () => o.onClose && o.onClose() })),
      h('div', { class: 'ui-sheet__body' }, o.body),
      o.footer ? h('footer', { class: 'ui-sheet__foot' }, o.footer) : null);
    const layer = h('div', { class: 'ui-layer', hidden: true },
      h('div', { class: 'ui-scrim', on: { click: () => o.onClose && o.onClose() } }), panel);
    layer.setTitle = (t) => { panel.querySelector('.ui-sheet__title').textContent = t; };
    return layer;
  }

  // ---- confirm dialog ---------------------------------------------------------------------

  /**
   * Asks before something that can't be undone (D6). Native <dialog>: top
   * layer, focus kept inside, Escape cancels. Resolves true only on confirm.
   * The confirm button isn't focused first, so a stray Enter can't destroy data.
   */
  function confirm(o) {
    const doc = root.document;
    return new Promise((resolve) => {
      const id = nextId('ui-dialog');
      const returnTo = doc.activeElement;
      let done = false;
      let watcher = null;
      // Resolves exactly once, from whichever path ends the dialog. The buttons
      // and Escape resolve directly instead of waiting for the 'close' event:
      // Chrome sometimes skips that event for a dialog opened after another
      // was dismissed with Escape, which would leave the promise hanging.
      const finish = (value) => {
        if (done) return;
        done = true;
        if (watcher) watcher.disconnect();
        if (dlg.open) dlg.close();
        dlg.remove();
        if (returnTo && returnTo.isConnected && typeof returnTo.focus === 'function') returnTo.focus();
        resolve(value);
      };
      const cancelBtn = button({ label: o.cancelLabel || 'Cancel', variant: 'secondary', onClick: () => finish(false) });
      const okBtn = button({ label: o.confirmLabel || 'Confirm', variant: o.danger ? 'danger' : 'primary', onClick: () => finish(true) });
      const dlg = h('dialog', { class: 'ui-dialog', aria: { labelledby: `${id}-t`, describedby: o.body ? `${id}-b` : undefined } },
        h('h2', { id: `${id}-t`, class: 'ui-dialog__title' }, o.title),
        o.body ? h('p', { id: `${id}-b`, class: 'ui-dialog__body' }, o.body) : null,
        h('div', { class: 'ui-dialog__actions' }, cancelBtn, okBtn));
      dlg.addEventListener('cancel', (e) => { e.preventDefault(); finish(false); }); // Escape
      dlg.addEventListener('close', () => finish(false));                          // any other close
      (o.container || doc.querySelector('.ui-root') || doc.body).appendChild(dlg);
      dlg.showModal();
      cancelBtn.focus();
      // If the screen holding the dialog is re-rendered, Chrome drops the
      // dialog without a 'close' event; settle as "no" instead of hanging.
      if (root.MutationObserver) {
        watcher = new root.MutationObserver(() => { if (!dlg.isConnected) finish(false); });
        watcher.observe(doc.documentElement || doc.body, { childList: true, subtree: true });
      }
    });
  }

  // ---- toast ------------------------------------------------------------------------------

  let toastEl = null, toastTimer = null, toastRegion = null;

  /** The single polite live region every toast is announced through. */
  function region() {
    const doc = root.document;
    if (toastRegion && toastRegion.isConnected) return toastRegion;
    toastRegion = h('div', { class: 'ui-toasts', aria: { live: 'polite' } });
    (doc.querySelector('.ui-root') || doc.body).appendChild(toastRegion);
    return toastRegion;
  }

  /**
   * Short message above the tab bar. One at a time; a new toast replaces the old.
   * With `undo`, shows an Undo button and stays longer (D6: restorable actions).
   * @returns {{dismiss:Function}}
   */
  function toast(message, o = {}) {
    dismiss();
    const action = o.undo ? { label: 'Undo', onClick: o.undo } : o.action;
    toastEl = h('div', { class: 'ui-toast' },
      h('span', { class: 'ui-toast__text' }, message),
      action ? button({ label: action.label, variant: 'ghost', onClick: () => { dismiss(); action.onClick(); } }) : null);
    region().appendChild(toastEl);
    toastTimer = setTimeout(dismiss, o.duration || (action ? 6000 : 3000));
    return { dismiss };
  }
  function dismiss() {
    clearTimeout(toastTimer);
    if (toastEl) { toastEl.remove(); toastEl = null; }
  }

  // ---- filter sheet body --------------------------------------------------------------------

  /**
   * Content for a filter sheet: sections of toggle chips plus a live result count
   * on the apply button ("Show 18 wishes"). State is a { sectionKey: Set } map.
   * @param {{sections:Array<{key:string,title:string,options:Array<{value:string,label:string}>}>,
   *          selected:Object<string,Set>, count:(sel:Object)=>number, noun:[string,string],
   *          onApply:Function, onReset:Function}} o
   */
  function filterSheetBody(o) {
    const sel = {};
    o.sections.forEach((s) => { sel[s.key] = new Set(o.selected && o.selected[s.key] ? o.selected[s.key] : []); });
    const applyBtn = button({ label: '', variant: 'primary', size: 'lg', block: true, onClick: () => o.onApply && o.onApply(sel) });
    const paintCount = () => {
      const n = o.count(sel);
      applyBtn.querySelector('.ui-btn__label').textContent = `Show ${n} ${n === 1 ? o.noun[0] : o.noun[1]}`;
    };
    const sections = o.sections.map((s) => h('section', { class: 'ui-filter-section' },
      h('h3', { class: 'ui-filter-section__title' }, s.title),
      chipRow(s.options.map((opt) => {
        const c = chip({ label: opt.label, selected: sel[s.key].has(opt.value), onClick: () => {
          if (sel[s.key].has(opt.value)) sel[s.key].delete(opt.value); else sel[s.key].add(opt.value);
          c.classList.toggle('is-selected', sel[s.key].has(opt.value));
          c.setAttribute('aria-pressed', String(sel[s.key].has(opt.value)));
          paintCount();
        } });
        return c;
      }), { label: s.title })));
    const reset = button({ label: 'Reset', variant: 'secondary', onClick: () => {
      Object.values(sel).forEach((set) => set.clear());
      sections.forEach((sec) => sec.querySelectorAll('.ui-chip').forEach((c) => { c.classList.remove('is-selected'); c.setAttribute('aria-pressed', 'false'); }));
      paintCount();
      if (o.onReset) o.onReset();
    } });
    paintCount();
    return { body: h('div', { class: 'ui-filter-body' }, sections), footer: [reset, applyBtn], selection: sel };
  }

  root.AWUI = {
    ICON, button, iconButton, chip, chipRow, segmented, searchField, row, card, badge,
    switchRow, banner, progress, emptyState, sheet, confirm, toast, dismissToast: dismiss, filterSheetBody
  };
})(typeof window !== 'undefined' ? window : globalThis);
