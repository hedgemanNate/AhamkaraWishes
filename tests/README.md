# Tests

Plain Node scripts, no framework. Browser modules are loaded with `eval()` against
a mocked `chrome`/`window`/`document`. Run everything (this is what CI runs):

```bash
npm install
npm test
```

| Test | Covers |
|---|---|
| `owned-index-test.js` | `rolledPerkSet` computation and wishlist matching |
| `owned-index-delta-test.js` | Incremental owned-index updates |
| `owned-index-bg-update-test.js` | Background index update path |
| `normalize-wishlist-test.js` | `normalizeWishlistEntry()` shape migration |
| `weapon-combo-match-test.js` | Perk-combo (colour) matching rules |
| `bungie-auth-core-test.js` | Token refresh coordination, session expiry, write safety |
| `bungie-auth-transfer-test.js` | `buildTransferItemPayload()` |
| `armor-linked-hash-match-test.js` | Armor matching via linked item hashes |
| `weapon-wish-consistency-test.js` | Saved weapon wishes normalize to real `desired`/`mustHave` hashes |
| `godroll-roll-test.js` | godroll.tv roll reading: URL/DOM reading, PvE/PvP mode, column mapping |
| `weapon-wish-core-test.js` | Shared wish payload (raw identity string, combos) and add-to-list duplicate/backfill rules |
| `safe-rendering-test.js` | `escapeHtml` / `safeImageUrl`, and `sanitizeList` against a hostile imported wishlist (keep this fixture: it is the standing check that shared lists can't inject markup or load off-site images) |
| `aw-dom-test.js` | `html``, `h()`, `render()`, `isSafeUrl`: interpolations escaped, text stays text, no inline handlers, unsafe URLs refused (fake DOM, no browser needed) |
| `aw-nav-test.js` | Navigation controller: one tab view shown, everything beneath the top layer inert, focus moves in and back, Escape, close guards, remembered tab |
| `armor-schema-test.js` | Armor Tertiary/Spark split (D9): both config shapes read correctly, migration is idempotent, migrated wishes keep their sync key, old tombstones still apply, merges dedupe. Also the armor set backfill (`fillArmorSets`) |
| `sync-status-test.js` | Sync status model (D11): every state's wording and action, priority order, signed-out users never auto-synced, failure backoff (`nextAutoSyncAt`), error classification |
| `preview-server-test.js` | Preview server never serves outside the repo or `.git`, and injects the chrome stub before the first script |
| `aw-store-test.js` | `AWStore.update` serialisation: slow and fast writers both land, no lost updates under contention, SKIP / unchanged data cause no write |
| `wish-edit-sync-test.js` | Editing a wish tombstones its old identity so cross-browser sync can't resurrect it; `locateWish` finds a row's wish after the list shifted, or nothing |
| `manifest-cache-test.js` | Manifest tables with a fake Bungie and IndexedDB: one download however many callers ask at once, a version per table, offline use, the real set table name, set names and 2-/4-piece bonuses |
| `edge-submission-test.js` | Server-side Discover submission check (`supabase/functions/_shared/submission.js`): hostile, oversized and invalid lists; fails if the edge copies of the client validator drift (`node tools/sync-edge-shared.js` fixes that) |

`wishlist-merge-test.html` is browser-only (cross-browser sync merge/tombstone rules).
Open it in a browser, or headless:

```bash
chrome --headless=new --allow-file-access-from-files --dump-dom file:///<repo>/tests/wishlist-merge-test.html
```

It is not part of `npm test` or CI.

`npm test` ends with the lint ratchet (`tools/lint-ratchet.js`): risky patterns may only decrease.

CI: `.github/workflows/ci.yml` runs `npm install`, `npm test`, `npm run check-build` and
`npm run ui-gallery` on pushes and pull requests to `main`/`master`.

## Adding a test

Prove it can fail: break the code on purpose, watch the test fail, then restore the code
from a backup copy (`cp file /tmp/file.bak` first). Don't restore with `git checkout`:
it also discards any uncommitted work in that file.

## Browser checks

`npm run ui-gallery` drives every AWUI building block in real headless Chrome (keyboard, focus return, Escape on sheets and dialogs, Undo toasts, target sizes, no overflow at 320/360/540 px). It runs in CI too. `npm run ui-check` adds the full side panel with the demo, hostile and empty fixtures, plus: delete/edit after the list shifted, the guest sync loop, and armor set grouping. It downloads Bungie's game data on first run, so it's local only. See `tools/preview/README.md`.
