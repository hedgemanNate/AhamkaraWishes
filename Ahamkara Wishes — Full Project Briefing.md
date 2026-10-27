# Ahamkara Wishes — Full Project Briefing

_Last updated 2026-10-27 against branch `phase3/flip` (redesign Phase 3 complete: the old screens are removed). If this disagrees with the code, trust the code and fix this file._

## What It Is

Ahamkara Wishes is a Chrome/Chromium Manifest V3 extension: a wishlist manager for Destiny 2 players. A "wish" is a desired item roll: a perk selection on a weapon, or an archetype + Tertiary (and optionally a Spark) on an armor piece. The extension matches wishes against the player's real inventory (via the Bungie API) and can notify them when a wished roll drops.

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
| UI | `styles/` (design tokens + cascade layers, bundled IBM Plex), `aw-ui.js` building blocks, `aw-nav.js` navigation, `aw-dom.js` escape-by-default rendering. See `STYLE_GUIDE.md` |
| Tests | Plain Node scripts, no framework (`npm test`), plus headless-Chrome checks of the real panel (`npm run ui-check`, `ui-gallery`, `visual`) |
| CI | GitHub Actions, Node 22 (`.github/workflows/ci.yml`): `npm test`, `check-build`, `ui-gallery` |

Manifest permissions: `storage`, `sidePanel`, `identity`, `alarms`, `scripting`. Optional host permission: godroll.tv (asked on first click of the panel's Godroll.tv button, so the update adds no install warning). Host permissions: `https://www.bungie.net/*` and the Supabase project. Content scripts: `dim-wishlist-overlay.js/.css` on `https://app.destinyitemmanager.com/*` (manifest). The godroll.tv script (`godroll-roll-core.js` + `godroll-content.js/.css`) is registered at runtime by `godroll-access.js` only while godroll.tv access is granted; `chrome.permissions.onAdded/onRemoved` keep it in sync and newly granted access injects into already-open godroll.tv tabs. CSP: `script-src 'self' 'wasm-unsafe-eval'`, so **no inline scripts** (this is why debug code is its own file).

## Project Structure

```
manifest.json               MV3 manifest
background.js               Service worker: side panel behavior + proactive Bungie token refresh (chrome.alarms, every 45 min)
sidepanel.html              The page: links styles/app.css and loads the scripts. screens/shell.js mounts everything
styles/                     app.css (layer order + imports), tokens.css, fonts.css, base.css, components.css, views.css, utilities.css

Foundations
aw-dom.js                   AWDom: escapeHtml, safeImageUrl (Bungie-only), html`` template + render(), h() element builder, delegate(). Loaded first
aw-store.js                 AWStore.update(mutator): the ONLY write path for dimData, under the `aw-dimdata` Web Lock shared with the service worker
aw-nav.js                   AWNav.create(): tabs, screens and stacked sheets/dialogs; inert background, focus in/back, Escape, remembered tab
aw-ui.js                    AWUI: button, chip, segmented, searchField, textField, row, card, badge, switchRow, banner, progress, emptyState, sheet, confirm, toast, filterSheetBody
sync-status.js              AWSync: describe() turns sync state into chip/sheet/banner copy (D11); nextAutoSyncAt() backoff; classifyError()
supabase-network.js         supabaseFetch(): wraps fetch to explain "Failed to fetch" (paused free-tier project). Also importScripts'd by background.js

Engine (nothing here draws)
manager.js                  Loads the game data, syncs on a schedule, builds the OwnedIndex, matches wishlists, then locks/vaults/logs what dropped (processNewMatches). Owns saveItem/editItemWish. Announces awManifestReady/awManifestFailed/awSyncChanged; window.appManager (syncNow, getSyncSnapshot)
destiny-manifest.js         Bungie manifest loader/cache (IndexedDB), streamed with progress; armor + weapon search, perk columns, display stats, set bonuses
manifest-progress.js        AWManifestProgress: real download percentage (awManifestProgress event)
owned-inventory-index.js    OwnedInventoryIndex: builds the owned index from a profile, matches wishlist entries (incl. combos)
bungie-auth-core.js         BungieAuthCore: sole owner of `bungie_auth`: token exchange, locked refresh, session expiry (shared with background.js)
bungie-auth.js              OAuth flow; getValidAuth(), fetchProfileWithComponents(), setItemLockState/transferItemToVault; announces `bungieAuthChanged`
admin.js                    AWAdmin: the owner check (`ahamkara:adminStatusChanged`) and the moderation calls
admin-sync.js               Admin-only cloud backup/sync of dimData via Supabase (uses WishlistSync merge)
wishlist-normalize.js       WishlistNormalize: brings stored wishes to the shape the matcher reads, and keeps them there
wishlist-io.js              Import/export of the proprietary .awwish format
armor-archetypes.js         ARCHETYPES and STATS
oracle-engine-bridge.js     Loads the WASM module; exposes window.oracleEngineReady

Rules (pure, each with a test)
wishlist-sync-core.js       WishlistSync: wish identity, merge + tombstone rules, list operations (create/rename/duplicate/delete/merge with Undo)
weapon-wish-core.js         Shared (panel + service worker): weapon wish payload / `raw` identity string, addWishToList (duplicate rules)
weapon-builder-core.js      AWWeaponBuilder: what a tap does (combo colours, a perk may wear several), saved picks, stats
armor-builder-core.js       AWArmorBuilder: grouping sets, the optional Tertiary/Spark, what gets saved
drops-core.js               AWDrops: what counts as a drop, the log, Automation defaults
inventory-core.js           AWInventory: searching what you own, which copies match a wish
discover-core.js            AWDiscover: Discover queries, card view, submit rules, the server client
wishlist-validate.js        WishlistValidate.sanitizeList(): rebuilds an untrusted list from known fields. Also used server-side

Screens (screens/, drawn with AWDom + AWUI)
shell.js                    AWShell: app bar, tab bar, banner, sheets (Sync, Account, New wish, Godroll.tv access)
wishes.js drops.js inventory.js discover.js   The four tabs
weapon-builder.js armor-builder.js            + Wish: search, build, save/edit
lists.js                    Wishlists sheet: switch, new, rename, duplicate, export, merge, delete (Undo), import
admin.js                    Account > Admin: creators and moderation (owner only)
set-bonus.js                The armor set bonus block, shared

Browser integrations
dim-wishlist-overlay.js/css Content script: rings DIM tiles whose instance ID matches a wish
godroll-roll-core.js        Shared (content script + service worker) pure helpers: read selected perks + PvE/PvP off a godroll.tv page, map them onto manifest perk columns by hash
godroll-content.js/css      Content script on godroll.tv: injects an "Ahamkara Wish" split button into the floating action bar
godroll-access.js           Optional godroll.tv permission: request (panel, in the click), runtime content-script register/unregister (service worker)
godroll-add.js              Service-worker side: builds a full weapon wish from the picked perks and writes it into the chosen list

oracle-engine/              WASM build + manifest-data (weapon frames, perk hashes, frame damage)
supabase/functions/         bungie-oauth, wishlist-actions, admin-actions (+ _shared helpers)
vendor/dim-watermarks/      DIM's watermark→season/event data (MIT, with LICENSE)
tests/                      Node tests (see Testing)
docs/                       wishlist-engine.md (matching + combos), lethality-perk-chart.md
tools/                      Dev only, never shipped: check-build.js, lint-ratchet.js (+ ratchet.json), sync-edge-shared.js, preview/ (server, Chrome stub, fixtures, headless checks, gallery)
vendor/fonts/ibm-plex/      Bundled IBM Plex woff2 (SIL OFL, LICENSE.txt)
STYLE_GUIDE.md              Design system: tokens, layers, components, rules
PRIVACY_POLICY.md, STORE_LISTING.md   Chrome Web Store material
```

**Script load order in `sidepanel.html` is significant:** foundations first (`aw-dom` → `supabase-network` → `wishlist-sync-core` → `weapon-wish-core` → `aw-store` → `aw-nav` → `aw-ui` → `sync-status`), then the pure rules and small data files, then `manifest-progress` → `destiny-manifest` → `owned-inventory-index` → `manager` → `bungie-auth-core` → `bungie-auth` → `wishlist-io` → `admin` → `admin-sync` → `oracle-engine-bridge` → `godroll-access`, then the screens (`set-bonus`, `wishes`, `inventory`, `lists`, `admin`, `discover`, `drops`, `weapon-builder`, `armor-builder`, and `shell` last).
`weapon-wish-core` needs `wishlist-sync-core` (it throws without it: the duplicate rule is `WishlistSync.wishKey`). The weapon builder reads `window.OwnedInventoryIndex.COMBO_COLORS` at load, so `owned-inventory-index.js` must precede it. **A full-screen layer must be created after the screen it opens from** (layers stack in page order; `shell.js` creates the builders after the Wishes and Inventory screens).
The service worker `importScripts` `supabase-network.js` and `bungie-auth-core.js`, then (in a try/catch so a failure can't stop token refresh) `destiny-manifest.js`, `godroll-roll-core.js`, `wishlist-sync-core.js`, `weapon-wish-core.js`, `aw-store.js`, `godroll-add.js`, and `godroll-access.js`.
`npm run check-build` packages the extension and fails if anything referenced is missing from it.

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
            config: { /* armor */ archetype, tertiary, spark   // spark optional (null)
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

**All writes go through `AWStore.update(mutator)`** (returning `AWStore.SKIP` writes nothing). The lint ratchet fails the build on a direct `chrome.storage.local.set({ dimData })`.

**Wish identity** is `WishlistSync.wishKey(wish)`: mode + perks for weapons, or `mode|armor:<archetype>+<tertiary>[~<spark>]` for armor. Duplicates, tombstones and the cross-browser merge all use it. List rows remember the key as well as the index, so Delete and Edit find the right wish with `WishlistSync.locateWish` even if the list changed meanwhile; an edit into a roll that's already saved is refused.

**Armor config:** `{ archetype, tertiary, spark }`. *Tertiary* is the archetype's third stat. *Spark* is the Tier 5 tuned stat (+5 moved from another stat); it is optional and stored as `null` until matching it is confirmed possible (D9). Wishes saved before this split stored the Tertiary as `spark`; `WishlistSync.migrateArmorConfig` converts them on load (identity unchanged), and `WishlistSync.armorFields(cfg)` reads either shape.

**Armor sets:** `static.setHash` is Bungie's `equipableItemSetHash`. Saved armor that lacks it is backfilled at startup (`WeaponWish.fillArmorSets`). Set names and 2-/4-piece bonuses come from `DestinyEquipableItemSetDefinition` (Bungie spells it with one p) and `DestinySandboxPerkDefinition`: `getArmorSetName`, `getArmorSetBonuses(setHash)` → `[{count, name, description}]`, where `[]` means no set bonus.

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

One screen, four tabs along the bottom (Wishes · Drops · Inventory · Discover) under an app bar: the list name (opens Wishlists), a sync chip (opens Sync), **+ Wish**, and the avatar (opens Account). The banner under the app bar carries the one message that needs attention (sign in, offline, game data downloading with a real progress bar).

- **Wishes**: weapons and armor sets as calm rows; tapping one opens a roomy detail screen (large named perks, combo numbers, owned counts, set bonus, Edit roll). One filter button (PvE/PvP, owned). Delete roll has Undo.
- **+ Wish**: *Weapon wish* (search, then the builder: all perk columns side by side, a combo toolbar where a tap adds a perk to combo 1-4 or as "any", live stats previewing any combo, Save pinned), *Armor wish* (search sets per class; pieces, archetype, optional Tertiary and Spark; one wish per piece), and links to Godroll.tv (with the access explainer) and DIM.
- **Drops**: wished-for rolls that just landed (found while the panel is open), what was done about each (locked, moved to the vault), Automation (lock on, vault off until you say so; offered right after sign-in).
- **Inventory**: search what you own by name, slot or "Matches a wish"; per copy, its perks and the wishes it satisfies; **Start a wish from this roll**.
- **Discover**: browse featured and community lists, search, filters, save one as a new list, submit your active list, delete your submissions.
- **Account**: sign in/out, Automation, Reset game data, Admin (owner only), version. **Wishlists** (the list name): switch, new, rename, duplicate, export, merge, delete (Delete and Merge have Undo), import.

### Armor stats
Armor uses six stats — Weapons, Health, Class, Grenade, Super, Melee — the post-Renegades armor system (Weapons replaces Mobility). There are **12 archetypes**, each covering two stats (SIEGEBREAKER, GRENADIER, COLOSSUS, BRAWLER, PARAGON, POWERHOUSE, SKIRMISHER, REAVER, SPECIALIST, GUNNER, DEMOLITIONIST, BULWARK); see `ARCHETYPES` in `manager.js`. The **Tertiary** is the archetype's third stat. The **Spark** is the Tier 5 tuned stat: the player can move 5 points from another stat into it, so a piece with the right Spark is rarer. It is an optional extra on a wish. (The previous briefing called these stats "fictional"; they are the game's current system as modelled by the code.)

## Main Flows

- **Matching**: `appManager.refreshProfile()` → `bungieAuth.fetchProfileWithComponents()` → `OwnedInventoryIndex.buildOwnedIndex()` → `matchWishlist(dimData, index)` annotates wishes and persists. The index rebuilds only when the profile version changes and supports incremental delta updates (≤200 changed instances).
- **Drops, lock and vault**: after a refresh, `processNewMatches()` compares before/after (`AWDrops.newlyReceived`): newly matched copies are locked (if on), real drops are moved to the vault (if on) and logged to `feedEntries`.
- **godroll.tv add-to-wishlist**: on a godroll.tv weapon page the content script injects a split button styled like the site's own Add to Compare pill (reusing its `.save-button-container.has-dropdown` / `.save-dropdown-*` classes). It reads `.socket-columns .socket-column .perk-item.selected[data-hash]` (real Bungie plug hashes; masterwork/mod picks excluded), the itemHash from the first URL segment, and PvE/PvP from `.stats-mode-toggle .stats-mode-btn.active`. The main button targets the active wishlist; the chevron lists every wishlist from `dimData` and adds to the one picked. It sends `ahamkara:add-godroll-roll` to the service worker, whose `GodrollAdd.addRoll` loads the Bungie manifest from the shared IndexedDB cache, maps godroll's columns onto the weapon's perk columns **by hash, not position**, builds the wish with `WeaponWish.buildWeaponWishPayload` (same code as the craft view, so the `raw` identity string matches) and writes through `WeaponWish.addWishToList` into the chosen list (adds are serialised; read-modify-write of `dimData`). Perks arrive as plain "any of" picks, not combos. It then sets `wishAddedExternally` so an open side panel runs `matchWishlistAgainstCachedIndex()` (the service worker has no owned index). The first add after the service worker has idled takes a few seconds (loading item defs into memory); later ones are fast. If the manifest has never been downloaded the user is told to open the extension once. godroll.tv's URL roll code is an obfuscated binary encoding and is deliberately not parsed. The selectors depend on godroll.tv's markup; if the perk columns vanish (or picks have no readable hash) `readRoll` sets `layoutChanged` and the button says the integration needs an update rather than failing silently.
- **DIM overlay**: the content script reads `dimData` from storage and rings any DIM tile whose element id equals a matched `receivedInstances` entry (class `ahamkara-wish-match`).
- **Import/export**: `.awwish` JSON (`{aw:"wishes", v:2, exportedAt, list}`; v2 = armor `{archetype, tertiary, spark}`, v1 files still import, older builds refuse v2). Every imported list goes through `WishlistValidate.sanitizeList`. Ownership state is stripped on export. Discover's "save" reuses `importFromPayload`, so file import and community save share one validate/normalize/persist path.
- **Cross-browser sync (admin only)**: `admin-sync.js` mirrors `dimData` to the `wishlist_backups` table through `admin-actions` (`backup_get` / `backup_put`). Merging is an **additive union** of lists → items → wishes, filtered by tombstones; pushes are read-merge-write. All delete sites (`manager.js`, `ui-creator.js`, `wishlist.js`) must record tombstones using `wishlist-sync-core.js`'s identity for "which wish is this". Don't add a delete path that skips this.
- **Auth**: PKCE via `launchWebAuthFlow` with the redirect URI derived from the running extension ID (`chrome.identity.getRedirectURL`) — that exact URI must be the Redirect URL registered at Bungie. Code exchange and refresh go through the `bungie-oauth` Edge Function (client secret server-side → 90-day refresh tokens). **All token reads/writes go through `bungie-auth-core.js`**: refresh runs under a Web Lock (`bungie-auth`) shared by the panel and service worker and re-reads storage inside it; writes are read-modify-write via `updateSession`; `invalid_grant` ends the session and sets `bungie_session_expired`; network/5xx keep tokens. The UI renders from `chrome.storage.onChanged`, and `bungieAuthChanged` fires only when the signed-in identity changes. Never write `bungie_auth` directly.

## Supabase

Project ref `tqgewrylrjqfqzqlmmag`. Client code reads public tables with the anon key (RLS) and calls Edge Functions for anything that mutates:

| Function | Actions |
|---|---|
| `bungie-oauth` | Token exchange / refresh proxy |
| `wishlist-actions` | `whoami`, `submit`, `delete` (identity verified against Bungie server-side) |
| `admin-actions` | `check`, `list_creators`, `add/update/remove_creator`, `feature/unfeature_wishlist`, `delete_wishlist`, `backup_get`, `backup_put` (gated by `ADMIN_BUNGIE_MEMBERSHIP_ID` secret) |

`wishlist-actions` `submit` cleans the list with the extension's own `WishlistValidate.sanitizeList` before storing it (`_shared/submission.js`; the client files are byte-identical copies in `_shared/client/`, kept in step by `node tools/sync-edge-shared.js` and checked by `npm test`). **This version is not deployed yet**: `supabase functions deploy wishlist-actions`. Deploy it **after** the extension update that reads armor `{archetype, tertiary, spark}` is live: the server stores lists in that shape, and older builds can't read it.

Tables referenced include `wishlists`, `creators`, `wishlist_backups`. The admin nav button is cosmetic; the real gate is the server-side re-check on every mutating call. Free-tier projects auto-pause after ~1 week idle, which surfaces as a bare "Failed to fetch" — hence `supabaseFetch`.

## Key Globals

| Global | Source | Purpose |
|---|---|---|
| `saveItem()` | manager.js | Save a weapon/armor wish (Promise; dedupes by `raw`) |
| `ARCHETYPES`, `STATS` | armor-archetypes.js | Armor definitions |
| `BUNGIE_ROOT`, `BUCKET_HASHES` | destiny-manifest.js / manager.js | Constants |
| `OwnedInventoryIndex` | owned-inventory-index.js | `buildOwnedIndex()`, `matchWishlist()`, `COMBO_COLORS`, delta updates |
| `WishlistSync` | wishlist-sync-core.js | `wishKey`, `locateWish`, `replaceWish`, `restoreWish` (Undo for a delete), `armorFields`, `migrateArmorConfig`, `mergeDimData`, tombstone helpers |
| `WeaponWish` | weapon-wish-core.js | `buildWeaponWishPayload`, `addWishToList` (the one add/duplicate rule), `fillArmorSets` |
| `AWStore`, `AWDom`, `AWNav`, `AWUI`, `AWSync`, `WishlistValidate` | see Project Structure | Foundations of the redesign |
| `bungieAuth` / `window.bungieAuth` | bungie-auth.js | `signIn`, `signOut`, `getValidAuth`, `fetchProfileWithComponents`, `transferItemToVault`, `equipItem`, `setItemLockState` |
| `supabaseFetch` | supabase-network.js | Fetch wrapper for Supabase calls |
| `window.oracleEngineReady` | oracle-engine-bridge.js | Promise for the initialised WASM module |
| `appManager` | manager.js | `syncNow`, `getSyncSnapshot`, `refreshProfileAndBuildIndex` |
| `AWWeaponBuilder`, `AWArmorBuilder`, `AWDrops`, `AWInventory`, `AWDiscover`, `AWManifestProgress`, `WishlistNormalize`, `AWAdmin` | the `*-core.js` files etc. | The rules behind each screen |

Custom DOM events: `awManifestReady`, `awManifestFailed`, `awManifestProgress`, `awSyncChanged`, `bungieAuthChanged`, `ahamkara:adminStatusChanged`, `wishListChanged`.

## Testing

- `npm test`: every Node test in `tests/` (see `tests/README.md`), then the lint ratchet. Tests `eval()` browser modules in Node with `global.window = global`, or in a `vm` context with fakes (e.g. `manifest-cache-test.js` fakes Bungie and IndexedDB).
- `npm run check-build`: builds the zip and checks every reference resolves inside it.
- `npm run ui-gallery` (CI) / `npm run ui-check` (local; downloads game data on first run): the real panel and every building block in headless Chrome. Covers overflow at 320/360px, hostile lists, tap targets, keyboard and focus, delete/edit after the list shifted, the guest sync loop, and armor set grouping.
- `npm run visual -- capture <dir>` / `compare <a> <b>`: pixel diff of the real screens. Compare captures from the same Chrome version (each capture records it).
- `wishlist-merge-test.html` is browser-only and not part of `npm test`.

When adding a test, prove it can fail: break the code on purpose, watch the test fail, then restore the code **from a backup copy** (not `git checkout`, which also throws away uncommitted work).

## Conventions

- Match existing style: no frameworks, no build step, JSDoc on key functions, comments explain *why*.
- New UI uses `--ui-*` tokens and `.ui-*` components in cascade layers (`STYLE_GUIDE.md`). Raw colours belong only in `styles/tokens.css`.
- Render untrusted text with `AWDom.h` / `AWDom.html`, not string-built `innerHTML` (ratchet-counted).
- Write `dimData` only through `AWStore.update`.
- Every manifest table is cached through `ensureManifestTableReady(name)`: one download however many callers ask at once, and a manifest version per table.
- `dimData` in `chrome.storage.local` is the source of truth; `chrome.storage.onChanged` listeners drive re-renders.
- Runtime annotations (`received`, `matchScore`, …) are never canonical data — they're stripped on export and recomputed.
- No inline scripts (CSP).
- Always route Supabase fetches through `supabaseFetch`.
- Version lives in `manifest.json` (and the `dist/` copy); `package.json` is only for tests (its version is `0.1.0`).

## Security / Hygiene Notes

- Hardcoded in client code: the Bungie API key, OAuth client ID 51511, the Supabase URL and the Supabase **anon** key. These are public-by-design for an extension, but the Bungie client secret must stay only in the Supabase function environment.
- Never commit a Supabase service-role key or the admin membership secret.

## Branches and Recent Work

UI/UX redesign before public launch (decisions D1–D15). Phase 1 (safety hotfixes) is on `hotfix/prelaunch-safety`, not yet merged to `main`. **Phase 2 (foundations)** is on `phase2/foundations`, built on top of it, and not pushed. Merging `phase2/foundations` brings both:
- Preview harness and headless-Chrome checks, build checker, lint ratchet, CI.
- `AWDom` rendering, `AWNav`, design tokens + layers + IBM Plex, `AWUI` building blocks + gallery, `AWSync` status model.
- Armor Tertiary/Spark split (`.awwish` v2), delete/edit by wish identity.
- Armor set data (real names, set bonuses, setHash backfill).
- Manifest: one download per table (startup fetched the 200 MB item table twice), versions per table.
- Sync: no retry loop for guests, backoff on failures.
- Server-side validation of Discover submissions (not deployed).

**Phase 3 (screens)** is on `phase3/screens` (all the new screens, behind a flag at the time) and **`phase3/flip`** (the new design becomes the only one: real first-run download progress, the old screens, stylesheet and scripts removed, `manager.js`/`bungie-auth.js`/`admin.js` reduced to engines). Both are built on `phase2/foundations` and are local only, not pushed. What is left is Phase 4: QA and launch (deploy `wishlist-actions`, a live Bungie sign-in pass, the store listing). `main` is the PR target.

Chrome Web Store submission material (`STORE_LISTING.md`, `PRIVACY_POLICY.md`, icons, `build-extension.sh`) is in progress.
