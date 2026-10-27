# Preview tools

Dev-only tools for seeing and checking the side panel outside the extension. Nothing in `tools/` ships: `build-extension.sh` copies an explicit file list, and `tools/check-build.js` fails if anything from here ends up in the build.

## Preview server

```bash
npm run preview            # http://127.0.0.1:8765/sidepanel.html
npm run preview -- 9000    # another port
```

Serves the repo as-is and injects `chrome-stub.js` into `sidepanel.html` right before its first `<script>`, so the real page runs in a normal tab. Nothing is copied, so the preview can't drift from what ships. Every response is sent `Cache-Control: no-store`, because a cached copy of an edited script makes you test old code.

The server listens on `127.0.0.1` only, and refuses paths outside the repo or inside `.git`.

### Fixtures

Add `?fixture=<name>` to replace storage with `fixtures/<name>.json` on load:

| Fixture | What it is |
|---|---|
| `demo` | Realistic lists: five real weapons (combo colours included) and armor across two lists. Generated with the app's own `WeaponWish` code, so it has exactly the shape the extension writes. |
| `hostile` | Malicious and malformed stored data: injection strings in names, off-site icons, an unknown archetype, an item with no `static`. The panel must show it as inert text and keep working. |
| `owned` | `demo` plus owned rolls: counts, per-combo counts, matched perks, and one perk wearing two combo colours. For the redesigned Wishes screen. |
| `empty` | A fresh install. |

Without `?fixture`, storage persists in `localStorage` between reloads. From the console, `__awPreview.seed(obj)` and `__awPreview.dump()` read and replace it.

### What the stub can't do

Bungie sign-in (it fails the way a cancelled sign-in does), `runtime.sendMessage` to the service worker, and godroll.tv permissions. Bungie's game data does load, straight from bungie.net. Discover's Supabase data usually doesn't, because of CORS from `127.0.0.1`.

## Headless checks

```bash
npm run ui-check
```

Starts the server and a private headless Chrome (`headless.js`), then loads the real panel with each fixture at 320 and 360 px and checks that lists render, nothing overflows, nothing throws, and hostile data stays inert (no script runs, no off-site image loads). Screenshots land in `.out/`.

`headless.js` drives Chrome over the DevTools Protocol with Node's built-in WebSocket (Node 22+), so there are no dependencies. It uses its own profile in `.chrome-profile/` and never touches your normal Chrome. Set `CHROME_PATH` if Chrome isn't in a standard place.

It isn't part of `npm test` or CI because it needs Chrome and downloads Bungie's game data (~200 MB) on its first run. Later runs reuse the cached copy and take well under a minute.

## Visual snapshots

```bash
npm run visual -- capture /tmp/before     # on the old code
npm run visual -- capture /tmp/after      # on the new code
npm run visual -- compare /tmp/before /tmp/after
```

Captures a fixed set of real screens (the Wishes lists, a weapon and an armor set's detail, the filter and lists sheets) from the `demo` fixture and compares them pixel by pixel, reporting where anything changed. Clocks, animations and the caret are frozen and Chrome renders in software, so two captures of the same code are identical. It was used to prove that moving `sidepanel.css` into the `legacy` cascade layer changed nothing on screen.

Both captures must come from the same Chrome version: an update changes text anti-aliasing everywhere. Each capture writes `browser.txt`, and `compare` warns when the two differ. If Chrome updated since your baseline, re-capture the baseline from the old commit.
