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

`wishlist-merge-test.html` is browser-only (cross-browser sync merge/tombstone rules).
Open it in a browser, or headless:

```bash
chrome --headless=new --allow-file-access-from-files --dump-dom file:///<repo>/tests/wishlist-merge-test.html
```

It is not part of `npm test` or CI.

CI: `.github/workflows/ci.yml` runs `npm install` and `npm test` on pushes and pull
requests to `main`/`master`.
