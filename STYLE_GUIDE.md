# Ahamkara Wishes — Style Guide

This document captures the visual tokens, component rules, and conventions used across the app so future changes stay consistent and predictable.

## Design Principles
- **Minimal & Focused:** Dark, low-noise interface with clear accents for important controls.
- **Sleek, high-contrast accents:** Use the accent gold sparingly for primary actions and states.
- **Accessibility first:** Ensure readable sizes, sufficient contrast, and visible keyboard focus.

## Tokens (CSS variables)
- **Background (dark):** `--bg-dark: #1e1e24` — page background.
- **Card / panel:** `--bg-card: #2b2b36` — used for panels / cards.
- **Accent (gold):** `--accent-gold: #d4af37` — primary accent for active states.
- **Primary text:** `--text-main: #ffffff` — main copy color.
- **Subtext:** `--text-sub: #aaaaaa` — secondary copy, icons, hints.
- Keep tokens in `:root` (see [sidepanel.css](sidepanel.css)).

## Typography
- **System UI stack:** `Segoe UI, Tahoma, Geneva, Verdana, sans-serif` (falling back to system sans).
- **Scale:**
  - **H1 / App title:** 18px, letter-spacing 2px, uppercase for the header (`.logo-area h1`).
  - **Tab labels:** 11px, bold, uppercase (`.tab-btn`).
  - **Body / control labels:** 11–12px for compact controls.
- **Weight & transform:** Tabs and important labels are bold and uppercase. Body text may be normal.

## Spacing & Layout
- **Base spacing unit:** 4px. Use multiples of 4 for padding/margins.
- **Header padding:** `15px` (keeps header roomy but compact).
- **Tab spacing:** use `gap: 8px` between tabs; tab vertical padding is 8px.
- **Select widths:** header dropdown uses ~140px width to stay centered and compact.

## Components

- **Tabs (`.tab-btn`):**
  - Full-width behavior: each `.tab-btn` uses `flex: 1` except icon-only center tab.
  - Active state: `.tab-btn.active` → `background: var(--accent-gold)`, `color: #000`, border-color matches accent.
  - Padding: `8px` (reduced for tighter header layout).

- **Center icon tab (`#tab-menu`):**
  - Fixed width: `56px` (`flex: 0 0 56px`) and `display: inline-flex; align-items:center; justify-content:center`.
  - Icon-only: use an inline SVG with `fill: currentColor` so colors follow text color rules.

- **Dropdown (`#wishlist-select` inside `.select-wrap`):**
  - Minimalist: no visible border; centered text; small height (24px).
  - Custom caret via `.select-wrap::after` to match the UI tone.
  # Ahamkara Wishes — Visual Style Guide (Comprehensive)

  This is a professional front-end (visual) style guide for Ahamkara Wishes. It documents the color system, layout tokens, typography, component library, interaction states, accessibility requirements, and implementation snippets based on the current app CSS.

  Purpose
  - Provide a single source of truth for visual decisions.
  - Make UI development predictable, accessible, and easy to maintain.

  Scope
  - Covers header, tabs, dropdowns, buttons, cards, armor views (craft & list), weapon cards, filters, inputs, scrollbars, and loading states.

  ---

  ## 1. Design Tokens
  Put these in `:root` (top of `sidepanel.css` or a dedicated `design-tokens.css`).

  Color tokens
  | Name | Token | Value | Usage |
  |---|---:|:---|:---|
  | Background (app) | `--bg-dark` | `#1e1e24` | Page background and deep panels |
  | Card / panel | `--bg-card` | `#2b2b36` | Cards, panels, content surfaces |
  | Accent (primary) | `--accent-gold` | `#d4af37` | Primary actions, selected states |
  | Text main | `--text-main` | `#ffffff` | Primary copy |
  | Text sub | `--text-sub` | `#aaaaaa` | Secondary copy, hints |
  | Muted | `--muted` | `#777777` | Muted labels, icons |

  Armor stat tokens (semantic color accents)
  | Token | Value | Meaning |
  |---|---:|:---|
  | `--stat-weapons` | `#4a6fa5` | Weapons / attack accent |
  | `--stat-health`  | `#5d7a5d` | Health / defense accent |
  | `--stat-class`   | `#9c7c4a` | Class/archetype accent |
  | `--stat-grenade` | `#a35d41` | Grenade / utility accent |
  | `--stat-super`   | `#6a4a8a` | Super / ultimate accent |
  | `--stat-melee`   | `#8a3a3a` | Melee / physical accent |

  Layout & scale tokens
  - `--space-xs: 4px`
  - `--space-s: 8px`
  - `--space-m: 12px`
  - `--space-l: 16px`
  - `--space-xl: 24px`
  - `--radius-sm: 2px`
  - `--radius-md: 4px`
  - `--border-thin: 1px`
  - `--border-default: 2px`

  Implementation snippet (place near top of main CSS):

    :root {
      --bg-dark: #1e1e24;
      --bg-card: #2b2b36;
      --accent-gold: #d4af37;
      --text-main: #ffffff;
      --text-sub: #aaaaaa;
      --space-s: 8px;
      --radius-sm: 2px;
      --border-default: 2px;
    }

  ---

  ## 2. Typography
  - Font stack: `Segoe UI, Tahoma, Geneva, Verdana, sans-serif`.
  - Display/Brand: `Bellota` is used in the spinner label; reserve for special headings.

  Type scale (recommended):
  - App title: 18px, uppercase, 700, letter-spacing 2px.
  - Tabs: 11px, bold, uppercase.
  - Body/controls: 11–13px.

  Accessibility: prefer >= 12px body text for dense UIs where feasible.

  ---

  ## 3. Layout Rules
  - App container: `display:flex; flex-direction:column; height:100vh;`.
  - Header: `padding: 15px; border-bottom: 2px solid var(--accent-gold); position: sticky; top:0;`.
  - Tabs: `.tab-switcher` uses `display:flex; gap: var(--space-s)`; each `.tab-btn` is `flex:1` except the center icon tab which is fixed width.
  - Internal sliders: use transform transitions for smoothness (`.armor-view-slider` width 200% and translateX states).

  Spacing rules
  - Use tokenized spacing: `var(--space-s)` for small gaps, `var(--space-l)` for internal padding.

  ---

  ## 4. Component Library

  Header & Brand
  - `.logo-area h1` centered, color `var(--accent-gold)`.
  - Wishlist select: `.select-wrap` + `#wishlist-select` — small, borderless, centered, 24px height by default.

  Tabs
  - `.tab-btn`: `border: var(--border-default) solid #444; padding: 8px; font-size: 11px; text-transform:uppercase;`.
  - `.tab-btn.active`: `background: var(--accent-gold); color:#000; border-color:var(--accent-gold);`.
  - Center tab `#tab-menu`: `flex:0 0 56px; display:inline-flex; align-items:center; justify-content:center;`.

  Buttons
  - `.btn-primary`: full-width, `padding:14px`, `background: var(--accent-gold)`, black text, bold, uppercase.
  - `.btn-primary:disabled`: `background:#333; color:#666; cursor:not-allowed;`.

  Filters & Inputs
  - `.filter-search`: compact row with `gap:8px`; inputs: background `#2b2e35`, `border:1px solid #444`, radius `--radius-md`.
  - Filter toggle: `.filter-toggle-btn.active` uses `background: var(--accent-gold); color:#000;`.

  Cards: weapon & armor
  - Card background: `var(--bg-card)` with `border-left` or `border` accents.
  - `.armor-box`: square aspect ratio, `background:#111`, `border:2px solid #333`, hover: `border-color:#555`, selected: `border-color:var(--accent-gold)` + inset glow.

  Loading & Overlays
  - `.loading-overlay`: semi-opaque black with centered spinner; spinner uses `border-top-color: var(--accent-gold)` and `Bellota` label.

  ---

  ## 5. Armor Views (Craft & List) — Detailed

  Craft View (`#pane-craft`)
  - Editor-focused: forms, sliders, per-stat controls.
  - Controls: compact (11–12px); use `--stat-*` tokens for stat chips/badges.
  - Scrolling: `overflow-y:auto` with thin, subdued scrollbar.

  List View (`#pane-list`)
  - Filter header fixed; list below scrolls inside `#armor-list-container`.
  - List rows use `.armor-grid` for layout and `.armor-box` for item cards.

  Interaction rules
  - Slide between craft/list using transform transitions; avoid layout reflows.
  - Selecting an item marks it `.selected` and optionally applies `.dimmed` to others.

  ---

  ## 6. States & Motion
  - Hover: subtle contrast increase (border to `#555` or slight background tint).
  - Active/Selected: use `--accent-gold` for borders and interior inset glow.
  - Disabled: reduce opacity and remove pointer interactions.
  - Transitions: prefer short, smooth easing — `0.2s` for hovers, `0.4s` for larger transforms.

  ---

  ## 7. Accessibility & ARIA
  - Provide `aria-label` for icon-only controls (e.g., `#tab-menu`).
  - Ensure focus styles are visible: use subtle but visible box-shadow or outline.
  - Keyboard: all interactive elements must be reachable and operable via keyboard.
  - Alt text for images or `aria-hidden` if decorative.

  ---

  ## 8. Code Snippets & Examples

  Token block (copy into CSS):

    :root {
      --bg-dark: #1e1e24;
      --bg-card: #2b2b36;
      --accent-gold: #d4af37;
      --text-main: #ffffff;
      --text-sub: #aaaaaa;
      --space-s: 8px;
      --radius-sm: 2px;
    }

  Tab active example:

    .tab-btn.active { background: var(--accent-gold); color: #000; border-color: var(--accent-gold); }

  Armor selected example:

    .armor-box.selected {
      border-color: var(--accent-gold);
      box-shadow: inset 0 0 10px rgba(212,175,55,0.3);
    }

  ---

  ## 9. Contribution Workflow
  - When adding UIs, update tokens first if a new semantic value is needed.
  - Add component CSS close to existing related modules and document new tokens/patterns in this guide.
  - Run contrast checks and keyboard navigation tests before PR.

  ---

  Would you like me to:
  - A) Insert the token block at the top of `sidepanel.css` for immediate usage, and add a `CONTRIBUTING_UI.md` with templates, or
  - B) Create `design-tokens.css` and import it from `sidepanel.css` so tokens are centralized and portable?

  Reply with `A` or `B` and I'll apply the change.
