# Ahamkara Wishes — Full Project Briefing

_Last updated 2026-10-01 against branch `ColorCombos` (manifest v0.2.9). If this disagrees with the code, trust the code and fix this file._

## What It Is

Ahamkara Wishes is a Chrome/Chromium Manifest V3 extension: a wishlist manager for Destiny 2 players. A "wish" is a desired item roll — a perk selection on a weapon, or an archetype + spark on an armor piece. The extension matches wishes against the player's real inventory (via the Bungie API) and can notify them when a wished roll drops.

The name references the Ahamkara, the wish-granting dragons of Destiny lore.

It lives in a side panel (`chrome.sidePanel`). In browsers without that API (e.g. Opera GX) the toolbar icon opens `sidepanel.html` in a normal tab instead.

Related external services: Bungie.net (API + OAuth), Destiny Item Manager (DIM — a content script overlays match markers on its inventory tiles), and a Supabase project for community wishlists, OAuth proxying, and admin backup.

## Tech Stack

| Concern | Choice |
|---|---|
| Language | Vanilla JavaScript, HTML5, CSS3 — no framework, no TypeScript |
| Build | None for dev (edit, then reload at `chrome://extensions`). `build-extension.sh` packages a store zip |
| Module system | None. Classic `<script>` tags; everything is a global or attached to `window` |
| Persistence | `chrome.storage.local` (app data), IndexedDB (Bungie manifest cache) |
| Auth | Bungie OAuth 2.0 via `chrome.identity.launchWebAuthFlow`, with token exchange/refresh proxied through a Supabase Edge Function |
| Backend | Supabase (Postgres + RLS, Deno Edge Functions in `supabase/functions/`) |
| Computation | `oracle-engine/` — a Rust/WASM module ("D2Calc") for derived weapon numbers (falloff, reload, TTK) |
| Tests | Plain Node scripts, no framework (`npm test`) |
| CI | GitHub Actions, Node 18 (`.github/workflows/ci.yml`) |

Manifest permissions: `storage`, `sidePanel`, `identity`, `alarms`. Host permissions: `https://www.bungie.net/*` and the Supabase project. Content script: `dim-wishlist-overlay.js/.css` on `https://app.destinyitemmanager.com/*`. CSP: `script-src 'self' 'wasm-unsafe-eval'`, so **no inline scripts** (this is why debug code is its own file).

## Project Structure

```
manifest.json               MV3 manifest
background.js               Service worker: side panel behavior + proactive Bungie token refresh (chrome.alarms, every 45 min)
sidepanel.html / .css       The whole UI shell and a single flat stylesheet (~100 KB)

supabase-network.js         supabaseFetch(): wraps fetch to explain "Failed to fetch" (paused free-tier project). Also importScripts'd by background.js
wishlist-sync-core.js       WishlistSync: pure merge + tombstone rules for cross-browser sync
destiny-manifest.js         Bungie manifest loader/cache (IndexedDB); armor + weapon search, perk columns, display stats, stat interpolation
owned-inventory-index.js    OwnedInventoryIndex: builds owned-weapon index from a profile, matches wishlist entries (incl. combos)
manager.js                  Core: saveItem(), tab wiring, profile refresh, feed, vault transfer, armor/weapon list rendering, owned-roll rows
ui-creator.js               Armor wizard, armor list, weapon list/build card, filters
bungie-auth-core.js         BungieAuthCore: sole owner of `bungie_auth` — token exchange, locked refresh, session expiry (shared with background.js)
bungie-auth.js              OAuth flow + auth UI; getValidAuth(), fetchProfileWithComponents(), setItemLockState/equipItem/transferItemToVault
wishlist.js                 Wishlist CRUD: create / duplicate / delete / merge
wishlist-io.js              Import/export of the proprietary .awwish format
discover.js                 DISCOVER sheet: browse/search/save/submit community & creator wishlists
admin.js                    Admin-only creator management + moderation (nav button injected only after server-side check)
admin-sync.js               Admin-only cloud backup/sync of dimData via Supabase (uses WishlistSync merge)
oracle-engine-bridge.js     Loads the WASM module; exposes window.oracleEngineReady
weapon-craft.js             Native weapon crafting UI: search → pick weapon → pick perks (with combo colours) → live stats → save/edit wish
dim-wishlist-overlay.js/css Content script: rings DIM tiles whose instance ID matches a wish

oracle-engine/              WASM build + manifest-data (weapon frames, perk hashes, frame damage)
supabase/functions/         bungie-oauth, wishlist-actions, admin-actions (+ _shared helpers)
vendor/dim-watermarks/      DIM's watermark→season/event data (MIT, with LICENSE)
tests/                      Node tests (see Testing)
docs/                       wishlist-engine.md (matching + combos), lethality-perk-chart.md
STYLE_GUIDE.md              Visual tokens/components
PRIVACY_POLICY.md, STORE_LISTING.md   Chrome Web Store material
```

**Script load order in `sidepanel.html` is significant:**
`supabase-network` → `wishlist-sync-core` → `destiny-manifest` → `owned-inventory-index` → `manager` → `ui-creator` → `bungie-auth-core` → `bungie-auth` → `wishlist` → `wishlist-io` → `discover` → `admin` → `admin-sync` → `oracle-engine-bridge` → `weapon-craft`.
(`weapon-craft.js` reads `window.OwnedInventoryIndex.COMBO_COLORS` at load, so `owned-inventory-index.js` must precede it.)

### Repo clutter to know about
- `dist/` and `ahamkara-wishes/` (a stray copy of the build) and `ahamkara-wishes.zip` are **build outputs**, git-ignored and no longer tracked. Regenerate with `bash build-extension.sh`; the root files are the source of truth.
- `build-extension.sh` copies an **explicit file list**. Any new source file must be added there or it won't ship.
- Local-only leftovers (git-ignored, safe to delete): `supabase.exe`, `untitled folder/`, `DIM-master/` (only `.DS_Store` files), `supabase/.temp/`.

## Core Data Model

All user data lives in `chrome.storage.local` under **`dimData`**:

```js
dimData = {
  activeId: "default",
  lists: {
    "default": {
      name: "Main Wishlist",
      items: {
        "<itemHash>": {
          static: { name, type: "weapon"|"armor", icon, classType: 0|1|2|null,
                    bucketHash, slotName, setName, setHash },
          wishes: [{
            tags: ["pve"|"pvp"],
            config: { /* armor */ archetype, spark
                      /* weapon */ perks, perkColumns, perkColumnsData },
            raw: string,        // canonical string; includes combo colour signature (used for dedupe)
            added: number,
            // runtime annotations from matchWishlist(), not canonical:
            received, receivedInstances, matchScore, matchedPerkHashes,
            comboMatches, matchedCombos
          }]
        }
      }
    }
  },
  tombstones: { ... }           // deletion records for sync; pruned after 90 days
}
```

Other storage keys: `bungie_auth` (`access_token`, `refresh_token`, `expires_at`, `refresh_expires_at`, `membership_id`, `user`, `destinyMemberships` — owned by bungie-auth-core.js), `bungie_session_expired`, `activeMembership`, `lastBungieProfile`, `ownedIndexSummary`, `feedEnabled`, `feedEntries` (max 20), `ahamkara_backup_synced_at`.

`normalizeWishlistEntry()` migrates old shapes on load and writes back if it mutated. `manager.js` also backfills `colIndex` onto older weapon `perkColumnsData` entries.

### Weapon combos (the current feature area)
A weapon wish can colour perks red → blue → green → orange (click-cycle: red → blue → green → orange → selected → deselected). A column holds at most one perk per colour, so a colour appearing in ≥2 columns names a **concrete perk tuple**, not a set of alternatives. Up to 4 combos per wish.
- An owned roll matches if it fully satisfies **at least one combo** AND passes the plain any-of rule for every column no colour touches.
- A column holding a colour is governed by its combos alone.
- A colour in only one column is ignored (degenerate).
- Combos are independent; `matchScore` = fraction of combos covered anywhere in the inventory.
- Wishes with no combos keep the legacy behaviour, including the pooled columns-3-and-4 rule (skipped entirely once combos exist).
- Storage: `config.perkColumnsData[].colors` maps colour → `[baseHash, enhancedHash?]`; either hash counts.
Full spec: [docs/wishlist-engine.md](docs/wishlist-engine.md).

## The UI

Header tabs: **WEAPONS**, **MENU** (icon, centre), **ARMOR**. Each of Weapons/Armor has a bottom nav CRAFT / LIST.

- **WEAPONS › CRAFT** (`weapon-craft.js`): weapon search → perk picker by column with combo colours → live stats panel (manifest stats plus oracle-engine numbers, with PvE/PvP toggle and per-perk hover deltas) → "MAKE A NEW WISH" / "EDIT WISH".
- **WEAPONS › LIST**: saved weapon wishes as cards, with search + collapsible filters and an inventory sync bar. **Double-clicking a roll row loads that wish back into the craft view for editing**; owned-roll rows double-click to start a wish from that owned roll.
- **ARMOR › CRAFT**: 3-step wizard (set → archetype → spark) with PvE/PvP toggle and "MAKE WISH". Sliding dual-pane via CSS `translateX`.
- **ARMOR › LIST**: wishes grouped by set, collapsible; filters by archetype/class/name; sync bar.
- **MENU**: Bungie sign-in/out; Wishlists (create, duplicate, merge, delete, export, import); **Feed** (toggle; polls ~1/min while on; logs wishes that went not-received → received; "Clear all"); Utility (refresh profile & rebuild index, index summary); **DISCOVER** button opens the Discover slide sheet; an admin nav slot appears only for the admin.
- **DISCOVER** sheet: search/filter chips, featured, community, "my submissions" (capped), save to local list, submit own list.

### Armor stats
Armor uses six stats — Weapons, Health, Class, Grenade, Super, Melee — the post-Renegades armor system (Weapons replaces Mobility). There are **12 archetypes**, each covering two stats (SIEGEBREAKER, GRENADIER, COLOSSUS, BRAWLER, PARAGON, POWERHOUSE, SKIRMISHER, REAVER, SPECIALIST, GUNNER, DEMOLITIONIST, BULWARK); see `ARCHETYPES` in `manager.js`. The spark is a single bonus stat. (The previous briefing called these stats "fictional"; they are the game's current system as modelled by the code.)

## Main Flows

- **Matching**: `appManager.refreshProfile()` → `bungieAuth.fetchProfileWithComponents()` → `OwnedInventoryIndex.buildOwnedIndex()` → `matchWishlist(dimData, index)` annotates wishes and persists. The index rebuilds only when the profile version changes and supports incremental delta updates (≤200 changed instances).
- **Feed + vault transfer**: after a refresh, `diffFeedEntries()` compares before/after; new matches are appended to `feedEntries`, and `transferNewlyMatchedToVault()` moves newly obtained matching items to the vault via `bungieAuth.transferItemToVault`.
- **DIM overlay**: the content script reads `dimData` from storage and rings any DIM tile whose element id equals a matched `receivedInstances` entry (class `ahamkara-wish-match`).
- **Import/export**: `.awwish` JSON (`{aw:"wishes", v:1, exportedAt, list}`). Ownership state is stripped on export. Discover's "save" reuses `importFromPayload`, so file import and community save share one validate/normalize/persist path.
- **Cross-browser sync (admin only)**: `admin-sync.js` mirrors `dimData` to the `wishlist_backups` table through `admin-actions` (`backup_get` / `backup_put`). Merging is an **additive union** of lists → items → wishes, filtered by tombstones; pushes are read-merge-write. All delete sites (`manager.js`, `ui-creator.js`, `wishlist.js`) must record tombstones using `wishlist-sync-core.js`'s identity for "which wish is this". Don't add a delete path that skips this.
- **Auth**: PKCE via `launchWebAuthFlow` with the redirect URI derived from the running extension ID (`chrome.identity.getRedirectURL`) — that exact URI must be the Redirect URL registered at Bungie. Code exchange and refresh go through the `bungie-oauth` Edge Function (client secret server-side → 90-day refresh tokens). **All token reads/writes go through `bungie-auth-core.js`**: refresh runs under a Web Lock (`bungie-auth`) shared by the panel and service worker and re-reads storage inside it; writes are read-modify-write via `updateSession`; `invalid_grant` ends the session and sets `bungie_session_expired`; network/5xx keep tokens. The UI renders from `chrome.storage.onChanged`, and `bungieAuthChanged` fires only when the signed-in identity changes. Never write `bungie_auth` directly.

## Supabase

Project ref `tqgewrylrjqfqzqlmmag`. Client code reads public tables with the anon key (RLS) and calls Edge Functions for anything that mutates:

| Function | Actions |
|---|---|
| `bungie-oauth` | Token exchange / refresh proxy |
| `wishlist-actions` | `whoami`, `submit`, `delete` (identity verified against Bungie server-side) |
| `admin-actions` | `check`, `list_creators`, `add/update/remove_creator`, `feature/unfeature_wishlist`, `delete_wishlist`, `backup_get`, `backup_put` (gated by `ADMIN_BUNGIE_MEMBERSHIP_ID` secret) |

Tables referenced include `wishlists`, `creators`, `wishlist_backups`. The admin nav button is cosmetic; the real gate is the server-side re-check on every mutating call. Free-tier projects auto-pause after ~1 week idle, which surfaces as a bare "Failed to fetch" — hence `supabaseFetch`.

## Key Globals

| Global | Source | Purpose |
|---|---|---|
| `saveItem()` | manager.js | Save a weapon/armor wish (Promise; dedupes by `raw`) |
| `ARCHETYPES`, `STATS` | manager.js | Armor definitions |
| `BUNGIE_ROOT`, `BUCKET_HASHES` | destiny-manifest.js / manager.js | Constants |
| `OwnedInventoryIndex` | owned-inventory-index.js | `buildOwnedIndex()`, `matchWishlist()`, `COMBO_COLORS`, delta updates |
| `WishlistSync` | wishlist-sync-core.js | `mergeDimData`, tombstone helpers |
| `bungieAuth` / `window.bungieAuth` | bungie-auth.js | `signIn`, `signOut`, `getValidAuth`, `fetchProfileWithComponents`, `transferItemToVault`, `equipItem`, `setItemLockState` |
| `supabaseFetch` | supabase-network.js | Fetch wrapper for Supabase calls |
| `loadWishIntoWeaponCraft` | weapon-craft.js | Open an existing wish in the craft view for edit |
| `window.oracleEngineReady` | oracle-engine-bridge.js | Promise for the initialised WASM module |
| `appManager`, `uiCreator`, `awWishlist` | manager / ui-creator / wishlist | Init + renderers + list CRUD |

Custom DOM events: `ahamkara:adminStatusChanged`, `bungieAuthChanged`, `wishListChanged`.

## Testing

`npm test` runs, in order: `owned-index-test.js`, `owned-index-delta-test.js`, `owned-index-bg-update-test.js`, `normalize-wishlist-test.js`, `weapon-combo-match-test.js`, `bungie-auth-core-test.js` `bungie-auth-transfer-test.js`, `armor-linked-hash-match-test.js`, `weapon-wish-consistency-test.js` (all passing as of this update). Tests `eval()` browser modules inside Node with `global.window = global`.

`wishlist-merge-test.html` is browser-only (sync merge/tombstone rules) and is not part of `npm test` or CI. Everything else in `tests/` runs under `npm test`; see `tests/README.md`.

## Conventions

- Match existing style: no frameworks, no build step, JSDoc on key functions, comments explain *why*.
- One flat stylesheet (`sidepanel.css`); tokens in `:root` per `STYLE_GUIDE.md` (dark UI, gold `#d4af37` accent, 4px spacing unit).
- `dimData` in `chrome.storage.local` is the source of truth; `chrome.storage.onChanged` listeners drive re-renders.
- Runtime annotations (`received`, `matchScore`, …) are never canonical data — they're stripped on export and recomputed.
- No inline scripts (CSP).
- Always route Supabase fetches through `supabaseFetch`.
- Version lives in `manifest.json` (and the `dist/` copy); `package.json` is only for tests (its version is `0.1.0`).

## Security / Hygiene Notes

- Hardcoded in client code: the Bungie API key, OAuth client ID 51511, the Supabase URL and the Supabase **anon** key. These are public-by-design for an extension, but the Bungie client secret must stay only in the Supabase function environment.
- Never commit a Supabase service-role key or the admin membership secret.

## Branches and Recent Work

Current branch: **`ColorCombos`** (HEAD `a80addc`, working tree clean). Many other feature branches exist (e.g. `AdminsWIshlists`, `Armor`, `Armor-filter-order`, `Clarity-Tools`, `Craft-UI`, `DIMFeatures`, `Foundary`, `LethalityFeature`, `Menu*`, `Masterwork-Icons`) — check for overlap before starting something new; `main` is the PR target.

Recent commits, newest first:
- Refactor/cleanup pass for readability.
- Wishlist import/export (`.awwish`) and sync rules.
- Feed "clear all" and max-entries adjustment.
- Weapon combo matching and combo stats UI (the core of this branch).
- Double-click on owned rolls to start a wish (armor and weapon).
- Cross-browser wishlist sync with merge + tombstones.
- Inventory search with filter chips; item transfer to vault; edit existing weapon wishes.
- Admin-only wishlist backup via Supabase; pooled trait-perk matching.

Chrome Web Store submission material (`STORE_LISTING.md`, `PRIVACY_POLICY.md`, icons, `build-extension.sh`) is in progress.
