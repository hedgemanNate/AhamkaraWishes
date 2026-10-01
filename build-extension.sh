#!/usr/bin/env bash
# Produces a clean ahamkara-wishes.zip ready for Chrome Web Store upload.
# Run from the repo root: bash build-extension.sh

set -euo pipefail

DIST="dist/ahamkara-wishes"
ZIP="ahamkara-wishes.zip"

rm -rf dist
mkdir -p "$DIST"

# --- Core JS / CSS / HTML ---
cp sidepanel.html    "$DIST/"
cp sidepanel.css     "$DIST/"
cp background.js     "$DIST/"
cp manifest.json     "$DIST/"
cp bungie-auth.js    "$DIST/"
cp bungie-auth-core.js "$DIST/"
cp destiny-manifest.js "$DIST/"
cp dim-wishlist-overlay.css "$DIST/"
cp dim-wishlist-overlay.js  "$DIST/"
cp discover.js       "$DIST/"
cp godroll-add.js     "$DIST/"
cp godroll-content.css "$DIST/"
cp godroll-content.js  "$DIST/"
cp godroll-roll-core.js "$DIST/"
cp manager.js        "$DIST/"
cp oracle-engine-bridge.js "$DIST/"
cp owned-inventory-index.js "$DIST/"
cp supabase-network.js "$DIST/"
cp ui-creator.js     "$DIST/"
cp weapon-craft.js   "$DIST/"
cp wishlist.js       "$DIST/"
cp wishlist-io.js    "$DIST/"
cp wishlist-sync-core.js "$DIST/"
cp weapon-wish-core.js "$DIST/"
cp admin.js          "$DIST/"
cp admin-sync.js     "$DIST/"

# --- Assets ---
mkdir -p "$DIST/icons" "$DIST/vendor" "$DIST/oracle-engine/manifest-data"
cp icons/icon16.png  "$DIST/icons/"
cp icons/icon48.png  "$DIST/icons/"
cp icons/icon128.png "$DIST/icons/"
cp icons/unnamed.jpg "$DIST/icons/"
cp icons/stat-class.svg  "$DIST/icons/"
cp icons/stat-grenade.svg "$DIST/icons/"
cp icons/stat-health.svg  "$DIST/icons/"
cp icons/stat-melee.svg   "$DIST/icons/"
cp icons/stat-super.svg   "$DIST/icons/"
cp icons/stat-weapons.svg "$DIST/icons/"
cp -r vendor/dim-watermarks "$DIST/vendor/"

# --- Oracle Engine (WASM + data) ---
cp oracle-engine/oracle_engine.js     "$DIST/oracle-engine/"
cp oracle-engine/oracle_engine_bg.wasm "$DIST/oracle-engine/"
cp oracle-engine/manifest-data/weapon-frame-damage.json "$DIST/oracle-engine/manifest-data/"
cp oracle-engine/manifest-data/weapon_frames.csv        "$DIST/oracle-engine/manifest-data/"
cp oracle-engine/manifest-data/weapon_perks_hash.csv    "$DIST/oracle-engine/manifest-data/"

# --- Zip ---
cd dist
zip -r "../$ZIP" ahamkara-wishes
cd ..

echo ""
echo "Built: $ZIP"
du -sh "$ZIP"
echo "Files: $(unzip -l "$ZIP" | tail -1)"
