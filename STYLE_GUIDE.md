# Ahamkara Wishes — Style Guide

How the redesigned UI is built, so every screen looks and behaves the same. It covers the design system (`styles/`, `aw-ui.js`, `aw-nav.js`, `aw-dom.js`) and the screens built on it (`screens/`).

See the components live: `npm run preview`, then open `http://127.0.0.1:8765/gallery`.

## Principles

1. **Small screens first.** Everything must work from **320px** wide (D2). Wider panels add room, never features.
2. **No hover.** A future mobile app must be possible, so nothing is reachable only by hover, and every action has a visible control. Tooltips may repeat a label but never carry the only copy of it.
3. **Gold means "act here" or "you own this"** (D7). Use `--ui-accent` for the primary action, the current selection, and ownership. Never use it as decoration.
4. **Dark only** (D7).
5. **Untrusted text stays text.** Wishlists come from other people (files, Discover). Render with `AWDom.h` / `AWDom.html`, never by concatenating strings into `innerHTML`.
6. **Say what happened, offer the next step.** Status copy has no jargon ("error", "failed to fetch"). Empty and error states name the next action.

## Files and cascade layers

`sidepanel.html` links one stylesheet, `styles/app.css`, which sets the layer order:

```
tokens < base < components < views < utilities
```

| Layer | File | What goes there |
|---|---|---|
| `tokens` | `styles/tokens.css` | All design tokens. **The only file where raw colours belong.** |
| — | `styles/fonts.css` | IBM Plex `@font-face`; files are bundled in `vendor/fonts/ibm-plex` (SIL OFL) |
| `base` | `styles/base.css` | Element defaults, scoped to `.ui-root` |
| `components` | `styles/components.css` | `.ui-*` building blocks |
| `views` | `styles/views.css` | Layout of the redesigned screens (`screens/*.js`); compose components, don't restyle them |
| `utilities` | `styles/utilities.css` | `.ui-sr-only`, `[hidden]`, and other single-purpose helpers |

Because the layers are ordered, a later layer wins without `!important` or extra specificity. **Don't add `!important`**: the lint ratchet counts it.

New UI lives inside an element with class `.ui-root`. Base styles never reach outside it. `.ui-root` is the container query container (`container-name: panel`), so components adapt to the **panel's** width:

```css
@container panel (min-width: 540px) { .ui-sheet { /* centred dialog instead of a bottom sheet */ } }
```

## Screens (`screens/`)

The screens live in `screens/` and are drawn with `AWDom` and `AWUI`. They read what the engine stores and listen for its events; none of them calls Bungie. The engine is `manager.js` (game data, sync, matching, lock/vault/log, saving and editing wishes), `bungie-auth.js` (who is signed in), `admin.js` (the owner check) and the `*-core.js` files (pure rules, each with a test).

| File | Role |
|---|---|
| `screens/shell.js` (`AWShell`) | App bar (list name → Lists, sync chip → Sync sheet, **+ Wish**, avatar → Account), banner, tab bar, and the sheets |
| `screens/wishes.js` (`AWWishes`) | The Wishes tab. The list is calm: one row per weapon or armor set, search, one filter button. Tapping a row opens the detail screen: a weapon's rolls with large, named perks, or an armor set's bonus and pieces. Delete with Undo |

A screen is `create(ctx)` returning `{ el }`. `ctx` gives it `nav`, `toast`, `addSheet(name, title, onOpen, { footer })` (a bottom sheet registered with AWNav, outside the inert region), `addScreen(name, title, onOpen, { canClose, onClose })` (a full screen with a Back button that opens over the tabs), `startWish(kind)`, `editWish(params)` and `startFromOwned(input)`.

**Register a full-screen layer after the screen it opens from.** Layers stack in page order, so a builder created before the Wishes screen would open underneath its detail screen. Class names are global: prefix them per screen (a `.ui-stat` in the weapon builder once broke the armor chips on another screen).

**Product shape:** this is a companion to Godroll.tv and DIM. Rolls are mostly chosen there and refined here, so the list stays quiet and the detail screen gives perks room. Design for a comfortable 360 to 480px panel (16px side padding, 44px perk icons, 76px rows); 320px must still work but never sets the density. Screens read `chrome.storage.local` and re-render on `chrome.storage.onChanged`; writes go through `AWStore.update`.

One pitfall: `el.replaceChildren(null)` writes the text "null". Filter empty values first (the checks fail on stray "null" text).

## Naming

- Tokens: `--ui-*`. Classes: `.ui-*`, with modifiers as `.ui-btn--primary`.

## Tokens

Three tiers. Use the **semantic** tier in components.

| Tier | Examples | Use |
|---|---|---|
| Palette | `--ui-palette-ink-0` … `-ink-5`, `--ui-palette-paper-*`, `--ui-palette-gold` | Raw values. Only `tokens.css` reads them. |
| Semantic | `--ui-bg`, `--ui-surface-1/2/3`, `--ui-line`, `--ui-text`, `--ui-text-muted`, `--ui-text-dim`, `--ui-accent`, `--ui-on-accent`, `--ui-success`, `--ui-warning`, `--ui-danger`, `--ui-info`, `--ui-focus` | Everything. |
| Game | `--ui-combo-1…4`, `--ui-element-*`, `--ui-stat-*`, `--ui-rarity-*`, `--ui-mode-pve/pvp` | Small markers only (a dot, a stripe, a badge), so they don't compete with gold. |

**Surfaces:** `--ui-bg` is the page, `--ui-surface-1` is cards and sheets, `--ui-surface-2` is raised or selected rows, and `--ui-surface-3` is controls, chips and toasts.

### Type

- Body: **IBM Plex Sans** (`--ui-font-body`). Headings and labels in caps: **IBM Plex Sans Condensed** (`--ui-font-display`).
- Sizes: `--ui-text-xs` 11px (**the floor; nothing smaller**), `sm` 12, `md` 13 (body), `lg` 15, `xl` 17, `2xl` 20, `3xl` 24.
- Uppercase labels use `letter-spacing: var(--ui-tracking-caps)`.

### Space and size

- 4px grid: `--ui-space-1` (4) … `--ui-space-8` (32). The panel's side padding is `--ui-gutter` (12px).
- **Touch targets:** `--ui-tap` (44px) for anything tappable. Compact controls such as chips may use `--ui-control` (40px) height, but their hit area must not be smaller. `npm run ui-check` measures this.
- Art: `--ui-item-icon` 44px, `--ui-perk` 28px.

### Shape, elevation, motion, stacking

- Radii `--ui-radius-sm/md/lg/xl/pill`; borders `--ui-border`.
- Shadows `--ui-shadow-1` (raised), `-2` (dialog), `-3` (bottom sheet).
- Motion: `--ui-dur-fast`, `--ui-dur`, `--ui-ease`. Both durations drop to 0 under `prefers-reduced-motion`, so always use the tokens.
- Stacking: `--ui-z-sticky` < `--ui-z-fab` < `--ui-z-sheet` < `--ui-z-dialog` < `--ui-z-toast`.

## Building blocks (`aw-ui.js`)

Create UI through these factories rather than writing markup by hand. Each returns a DOM element (or a Promise for `confirm`) with the right roles, labels and keyboard behaviour built in.

| Factory | Notes |
|---|---|
| `AWUI.button({ label, variant, size, icon, block, disabled, onClick })` | Variants: `primary` (one per screen), `secondary`, `ghost`, `danger`. |
| `AWUI.iconButton({ label, icon, title, onClick })` | `label` is required; it is the accessible name. 44px target. |
| `AWUI.chip({ label, selected, count, icon, onClick, onRemove })`, `AWUI.chipRow(chips, { label })` | A toggle chip (`selected` → `aria-pressed`) or a removable one (`onRemove`). Rows scroll sideways on narrow panels. |
| `AWUI.segmented({ label, options, value, onChange })` | A radiogroup with arrow-key support. `setValue` / `getValue`. |
| `AWUI.searchField({ label, placeholder, value, onInput })` | Visible-to-screen-reader label plus a clear button. |
| `AWUI.row({ title, subtitle, leading, trailing, onClick })`, `AWUI.card(...children)` | List rows (a button when `onClick` is set) and cards. |
| `AWUI.badge(label, tone)` | Tones: `accent`, `muted`, `success`, `warning`, `danger`, `pve`, `pvp`. |
| `AWUI.switchRow({ label, description, checked, onChange })` | `role="switch"`. |
| `AWUI.banner({ tone, text, action })`, `AWUI.progress({ label, value, max })` | Status under the app bar; e.g. the manifest download (D13). |
| `AWUI.emptyState({ icon, title, body, actions })` | Always offer the next step. |
| `AWUI.sheet({ title, body, footer, onClose })` | Returns a `.ui-layer` to register with `AWNav`. A bottom sheet below 540px, a centred dialog above. |
| `AWUI.confirm({ title, body, confirmLabel, cancelLabel, danger })` → `Promise<boolean>` | **Only for irreversible actions** (D6). Cancel is focused first; Escape cancels. |
| `AWUI.toast(message, { undo, action, duration })` | Announced through one polite live region. Restorable deletes use Undo instead of a confirm (D6). |
| `AWUI.filterSheetBody({ sections, selected, count, noun, onApply, onReset })` | The standard filter layout, with a live result count on Apply. |
| `AWUI.ICON.{close, search, more, check, chevron, filter}` | Inline SVG that inherits `currentColor`. |

## Navigation (`aw-nav.js`)

One controller owns tabs, screens and stacked layers (sheets and dialogs):

```js
const nav = AWNav.create({ remember: 'aw-last-tab' }); // localStorage key for the last tab
nav.addTab('wishes', { view, button });
nav.addLayer('lists', { el: AWUI.sheet({ ... }), kind: 'sheet' });
nav.open('lists', params, { returnFocus: triggerButton });
```

- Opening a layer makes everything behind it `inert` and moves focus in. Closing it returns focus to the trigger (never to `<body>`).
- Escape closes the top layer only.
- `nav.restore('wishes')` reopens the remembered tab (or the fallback) on start.
- Don't toggle `hidden` or `.active` by hand on anything AWNav manages.

## Rendering (`aw-dom.js`)

```js
AWDom.h('div', { class: 'card', data: { hash } }, name)   // text is always text
AWDom.render(el, AWDom.html`<b>${name}</b>`)              // every ${} is escaped
AWDom.raw(svgMarkup)                                      // only for markup we wrote
```

- Inline `on*` attributes throw. Use `on: { click }` or `AWDom.delegate()`.
- URL attributes are checked. A remote `<img src>` must be on `www.bungie.net`, so a shared list can't make the panel fetch from someone's server.

## Data writes

All writes to the wishlist go through `AWStore.update(mutator)`, which holds a Web Lock shared with the service worker. Never call `chrome.storage.local.set({ dimData })` directly; the ratchet counts that.

## Accessibility checklist

- [ ] Works at 320px with no horizontal scroll.
- [ ] Every tappable thing is at least 44px tall, or 40px for chips.
- [ ] Every icon-only control has a label.
- [ ] Visible focus (the global `:focus-visible` outline). Don't remove it.
- [ ] State isn't shown by colour alone: pair it with text or an icon.
- [ ] Sheets and dialogs: focus in, Escape out, focus back to the trigger.
- [ ] Animations use the motion tokens, so reduced motion is respected.

## Guard rails (run before committing)

| Command | Checks |
|---|---|
| `npm test` | Unit tests plus the **lint ratchet** (`tools/lint-ratchet.js`): counts of `innerHTML` templates, raw hex colours outside `tokens.css`, `!important`, direct `dimData` writes, native dialogs and inline styles may only go **down**. |
| `npm run check-build` | The packaged extension contains every file it references, and nothing from `tools/`, `tests/`, `docs/` or `supabase/`. |
| `npm run ui-gallery` | Every building block in headless Chrome at 320/360/540: fonts, overflow, target sizes, keyboard, focus return. |
| `npm run ui-check` | The real panel with the demo, hostile and empty fixtures. |
| `npm run visual -- capture/compare` | Pixel diff of real screens before and after a change. Compare captures from the same Chrome version. |
