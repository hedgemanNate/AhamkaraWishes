// Ahamkara Wishes — the engine behind the screens.
//
// Nothing here draws. It loads the game data at startup, syncs the inventory
// with Bungie on a schedule (visible: 30 s, hidden: 5 min, 1 min while the Drops
// log is on), builds the OwnedIndex and matches it against the wishlists, then
// looks after what just dropped (lock, vault, log it; see processNewMatches).
// It also owns saving and editing wishes (saveItem, editItemWish) for the builders.
// The screens (screens/*.js) read what it stores and listen for its events:
//   awManifestReady / awManifestFailed   the game data is loaded / couldn't be
//   awSyncChanged                        a sync started or finished
// and call window.appManager (syncNow, getSyncSnapshot).
//
// Uses destiny-manifest.js (data), owned-inventory-index.js (matching),
// bungie-auth.js (sign-in), drops-core.js, aw-store.js and wishlist-sync-core.js.

// --- FEED (newly-obtained wishlist rolls) ---
const FEED_MAX_ENTRIES = 20;
const FEED_INTERVAL_MS = 60 * 1000; // 1 minute, only while Feed is toggled on

let _feedEnabled = false;

// Which wishes just flipped to "received" (a drop) is decided in drops-core.js,
// so locking, vaulting and the Drops log can't disagree about it.
const snapshotReceivedState = (dimData) => AWDrops.snapshotReceivedState(dimData);

/** Cached Destiny membership, or null (with a warning) if it hasn't been fetched yet. */
async function activeMembershipOrNull(what) {
    const res = await new Promise((r) => chrome.storage.local.get(['activeMembership'], r));
    const mem = res?.activeMembership;
    if (!mem?.membershipType || !mem?.membershipId || !mem?.characterIds?.length) {
        console.warn(`[${what}] No membership info cached; skipping`);
        return null;
    }
    return mem;
}

/** Locks each instance in-game so it can't be dismantled by accident. Returns Map id -> true|false. */
async function lockInstances(ids, ownedIndex) {
    const done = new Map();
    const mem = await activeMembershipOrNull('AutoLock');
    if (!mem) return done;
    const { membershipType, membershipId, characterIds } = mem;
    for (const iid of ids) {
        const owned = ownedIndex.byInstanceId?.get(String(iid));
        const characterId = owned?.characterId || characterIds[0];
        try {
            await window.bungieAuth.setItemLockState(iid, characterId, membershipType, membershipId, true);
            done.set(iid, true);
        } catch (e) {
            console.warn('[AutoLock] Failed to lock', iid, e.message);
            done.set(iid, false);
        }
    }
    return done;
}

/** Moves each instance to the vault. Returns Map id -> true|false (already in the vault counts as done). */
async function vaultInstances(ids, ownedIndex) {
    const done = new Map();
    const mem = await activeMembershipOrNull('VaultTransfer');
    if (!mem) return done;
    const { membershipType, membershipId } = mem;
    for (const iid of ids) {
        const owned = ownedIndex.byInstanceId?.get(String(iid));
        if (!owned) continue;
        // No characterId means it's already in the vault (buildOwnedIndex only
        // assigns one to items on a character) - nothing to transfer.
        if (!owned.characterId) { done.set(iid, true); continue; }
        try {
            await window.bungieAuth.transferItemToVault(iid, owned.itemHash, owned.characterId, membershipType, membershipId);
            done.set(iid, true);
        } catch (e) {
            console.warn('[VaultTransfer] Failed to transfer', iid, e.message);
            done.set(iid, false);
        }
    }
    return done;
}

/**
 * Everything that follows a matching pass, once, in order: auto-lock what just
 * matched and auto-vault what just dropped (per the Automation settings; D5),
 * then log it as a Drop. `logDrops` is false when the pass only re-matched what was already
 * owned (a wish was saved), because that is not a drop. The very first sync only
 * records the baseline: everything you already own would otherwise show up as
 * a flood of "drops".
 */
async function processNewMatches(pass, ownedIndex, { logDrops = false } = {}) {
    if (!pass || !ownedIndex) return;
    // The first sync that can log drops only sets the baseline.
    let baseline = false;
    if (logDrops) {
        const state = await AWDrops.load();
        if (!state.baselineAt) { baseline = state.entries.length === 0; await AWDrops.setBaseline(); }
    }
    const drops = AWDrops.newlyReceived(pass.beforeSnapshot, pass.dimData);
    if (!drops.length) return;
    const auto = AWDrops.normalizeAutomation((await new Promise((r) => chrome.storage.local.get(['automation'], r))).automation);
    const ids = [...AWDrops.instanceIdsOf(drops)];
    const results = {};
    const note = (map, field) => map.forEach((ok, id) => { (results[id] = results[id] || {})[field] = ok; });
    // Locking a roll you now want is harmless, so any newly matched copy is locked.
    // Moving it is not: only a real drop goes to the vault, never a copy you were
    // already holding that matched because you saved a wish (or the first sync).
    const isDrop = logDrops && !baseline;
    if (auto.autoLock && ids.length) note(await lockInstances(ids, ownedIndex), 'locked');
    if (auto.autoVault && isDrop && ids.length) note(await vaultInstances(ids, ownedIndex), 'vaulted');
    if (!isDrop || !_feedEnabled) return;
    await appendFeedEntries(AWDrops.buildEntries(drops, results));
}

async function appendFeedEntries(newEntries) {
    if (!newEntries || newEntries.length === 0) return;
    const res = await new Promise((r) => chrome.storage.local.get(['feedEntries'], r));
    const entries = AWDrops.appendEntries(res?.feedEntries, newEntries, FEED_MAX_ENTRIES);
    await new Promise((r) => chrome.storage.local.set({ feedEntries: entries }, r));
}

async function loadFeedState() {
    const res = await new Promise((r) => chrome.storage.local.get(['feedEnabled'], r));
    _feedEnabled = !!res?.feedEnabled;
}

// The Drops screen switches the log on and off; keep the engine (and the sync
// pace) in step with it.
chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !changes.feedEnabled) return;
    const on = !!changes.feedEnabled.newValue;
    if (on === _feedEnabled) return;
    _feedEnabled = on;
    startAutoRefresh();
});

/**
 * The cached Bungie profile, if any, becomes an OwnedIndex straight away, so
 * ownership shows before the first live sync lands.
 */
function useCachedProfile() {
    chrome.storage.local.get(['lastBungieProfile'], async (res) => {
        const lastProfile = res?.lastBungieProfile;
        // The live sync started on load may already have landed (or be
        // building): a stale cached snapshot must not overwrite it.
        if (_lastProfileMintedAt || _syncInFlight) return;
        if (!lastProfile || !window.OwnedInventoryIndex || !window.OwnedInventoryIndex.updateFromProfile) return;
        try {
            const idx = await window.OwnedInventoryIndex.updateFromProfile(lastProfile);
            if (_lastProfileMintedAt) return;
            // A live fetch returning this same snapshot then has nothing to redo.
            _lastProfileMintedAt = Date.parse(lastProfile.responseMintedTimestamp) || 0;
            const ownedIndexSummary = {
                totalInstances: idx.byInstanceId ? idx.byInstanceId.size : 0,
                uniqueItems: idx.byItemHash ? idx.byItemHash.size : 0,
                fetchedAt: Date.now()
            };
            await new Promise((r) => chrome.storage.local.set({ ownedIndexSummary }, r));
            // The wishlist is read inside matchWishlistPass, after the index build
            // above, so a wish saved while the index was building isn't overwritten.
            if (window.OwnedInventoryIndex.matchWishlist) {
                const pass = await matchWishlistPass(idx, { backfill: true });
                if (pass) await processNewMatches(pass, idx, { logDrops: true });
                console.log('[Manager] Background OwnedIndex update & wishlist sync complete');
            }
        } catch (e) { console.warn('[Manager] cached profile update failed', e); }
    });
}

// The game data's state, for screens that start after it is known:
// 'loading' -> 'ready' | 'failed'. The events say the same as it changes.
window.AWManifestState = 'loading';
function announceManifest(state) {
    window.AWManifestState = state;
    document.dispatchEvent(new CustomEvent(state === 'ready' ? 'awManifestReady' : 'awManifestFailed'));
}

document.addEventListener('DOMContentLoaded', async () => {
    await loadFeedState();

    // Load the game data once at startup (the panel is usable while it downloads).
    Promise.all([
        ensureInventoryItemDefsReady({ force: false }),
        ensureEquippableItemSetDefsReady({ force: false }),
        getArmorSetLookup()
    ]).then(([itemsReady]) => {
        // ensureInventoryItemDefsReady resolves false when it has nothing cached and couldn't download.
        if (!itemsReady) { announceManifest('failed'); return; }
        // Pre-warm weapon search indexes so the first search is instant
        buildNameIndexIfNeeded();
        ensureWatermarkLookupReady();
        announceManifest('ready');
        backfillArmorSets();
        useCachedProfile();
    }).catch((err) => {
        console.warn('[D2MANIFEST] Preflight failed:', err);
        announceManifest('failed');
    });

    startAutoRefresh();
});

// --- LIVE UPDATE LISTENER ---
// The godroll.tv button adds wishes from the service worker, which has no
// owned-inventory index — match them here so ownership shows up right away.
chrome.storage.onChanged.addListener((changes, namespace) => {
    if (namespace === 'local' && changes.wishAddedExternally) {
        matchWishlistAgainstCachedIndex();
    }
});

// Sidepanel version of saveItem (the add/duplicate rules are shared via weapon-wish-core.js)
// Resolves 'added' or 'duplicate' once the storage write (if any) has completed,
// so callers can tell the player what really happened.
async function saveItem(hash, name, type, rawString, keyId, config, mode = "pve", icon = null, classType = null, bucketHash = null, slotName = null, setName = null, setHash = null, linkedHashes = null, weaponMeta = null) {
  let status = 'duplicate';
  await AWStore.update((data) => {
    const listId = AWStore.ensureActiveList(data);
    // Container creation, metadata backfill and the duplicate rules live in
    // weapon-wish-core.js so the godroll.tv button (service worker) shares them.
    status = WeaponWish.addWishToList(data, listId, {
      hash, name, type, rawString, config, mode, icon, classType, bucketHash,
      slotName, setName, setHash, linkedHashes, weaponMeta
    });
    return status === 'duplicate' ? AWStore.SKIP : status;
  });
  // The screens refresh themselves from the storage change.
  // Immediately check the new wish against any already-fetched inventory,
  // so ownership shows up without requiring a full profile re-fetch.
  if (status === 'added') matchWishlistAgainstCachedIndex();
  return status;
}

// Backfill for wishes saved before linkedHashes existed (or saved via the
// content script, which can't scan the manifest): season reissues give the
// same item several manifest hashes, and without the sibling list an owned
// copy under a reissue hash never matches. Only scans the manifest for items
// whose linkedHashes are still empty and haven't been checked yet.
// Returns true if anything was filled in (caller should persist dimData).
async function backfillLinkedHashes(data) {
  if (!data?.lists) return false;
  let mutated = false;
  for (const list of Object.values(data.lists)) {
    for (const [hash, item] of Object.entries(list?.items || {})) {
      const type = item?.static?.type;
      let finder = null;
      if (type === 'armor' && typeof findArmorSiblingHashes === 'function') finder = findArmorSiblingHashes;
      else if (type === 'weapon' && typeof findWeaponSiblingHashes === 'function') finder = findWeaponSiblingHashes;
      if (!finder) continue;
      if ((item.static.linkedHashes || []).length > 0) continue;
      if (item.static.linkedHashesChecked) continue; // no siblings exist; don't rescan
      try {
        const siblings = await finder(Number(hash));
        item.static.linkedHashes = siblings;
        item.static.linkedHashesChecked = true;
        mutated = true;
      } catch (e) {
        console.warn('[Manager] linkedHashes backfill failed for', hash, e);
      }
    }
  }
  return mutated;
}
window.backfillLinkedHashes = backfillLinkedHashes;

// Backfill for weapon wishes saved before perkColumnsData entries carried
// colIndex (the 0-based column position, needed by the columns-3-and-4
// pooled trait-perk matching rule in owned-inventory-index.js). Re-derives
// each entry's colIndex by calling getWeaponPerkColumns() against the
// weapon's real item definition and mapping real socketIndex values back to
// their position in that canonical column list. Skips weapons whose
// perkColumnsData is already fully tagged, so this is self-terminating per
// wish — no need to run it more than once per item.
// Returns true if anything was filled in (caller should persist dimData).
async function backfillPerkColIndex(data) {
  if (!data?.lists) return false;
  let mutated = false;
  for (const list of Object.values(data.lists)) {
    for (const [hash, item] of Object.entries(list?.items || {})) {
      if (item?.static?.type !== 'weapon') continue;
      if (!Array.isArray(item.wishes)) continue;

      const needsBackfill = item.wishes.some((w) =>
        Array.isArray(w?.config?.perkColumnsData) &&
        w.config.perkColumnsData.some((c) => c.colIndex === undefined)
      );
      if (!needsBackfill) continue;

      let columns = null;
      try {
        if (typeof loadInventoryItemDefsToMemory !== 'function' || typeof getWeaponPerkColumns !== 'function') continue;
        const defs = await loadInventoryItemDefsToMemory();
        const def = defs.get(String(hash));
        if (!def) continue;
        columns = await getWeaponPerkColumns(def);
      } catch (e) {
        console.warn('[Manager] perkColIndex backfill: could not load columns for', hash, e);
        continue;
      }
      if (!columns || columns.length === 0) continue;

      const socketIndexToColIndex = new Map(columns.map((c, i) => [c.socketIndex, i]));

      for (const wish of item.wishes) {
        const pcd = wish?.config?.perkColumnsData;
        if (!Array.isArray(pcd)) continue;
        for (const entry of pcd) {
          if (entry.colIndex !== undefined) continue;
          if (socketIndexToColIndex.has(entry.socketIndex)) {
            entry.colIndex = socketIndexToColIndex.get(entry.socketIndex);
            mutated = true;
          }
        }
      }
    }
  }
  return mutated;
}
window.backfillPerkColIndex = backfillPerkColIndex;

/**
 * One wishlist-matching pass. Reads dimData fresh under the AWStore lock,
 * annotates it from `idx` and writes it back only if something changed. The
 * caller waits on the network (profile fetch, index build) BEFORE calling this,
 * never between a read and the write — matching a stale copy and writing it
 * back is what used to drop saves made in the meantime.
 *
 * `backfill` also fills in linked hashes / column indexes from the manifest.
 * The manifest is made ready BEFORE taking the lock (it can mean a download);
 * inside the lock the backfill then reads memory and IndexedDB only, and is
 * skipped when the manifest isn't available.
 * Resolves { beforeSnapshot, dimData, summary }: what the caller needs to lock,
 * vault and feed newly matched items, which are network calls made after the
 * lock is released.
 */
/** Loads what the backfills read, outside any lock. Resolves false if unavailable. */
async function warmManifestForBackfill() {
  try {
    const [defs, plugSets] = await Promise.all([loadInventoryItemDefsToMemory(), ensurePlugSetDefsReady()]);
    return !!defs && plugSets === true;
  } catch (e) {
    console.warn('[Manager] manifest not ready; skipping wish backfill this pass', e);
    return false;
  }
}

async function matchWishlistPass(idx, { backfill = false } = {}) {
  if (!idx || !window.OwnedInventoryIndex || !window.OwnedInventoryIndex.matchWishlist) return null;
  const canBackfill = backfill && await warmManifestForBackfill();
  return AWStore.update(async (dimData) => {
    if (canBackfill) {
      await backfillLinkedHashes(dimData);
      await backfillPerkColIndex(dimData);
    }
    const beforeSnapshot = snapshotReceivedState(dimData);
    const summary = window.OwnedInventoryIndex.matchWishlist(dimData, idx);
    return { beforeSnapshot, dimData, summary };
  });
}
window.matchWishlistPass = matchWishlistPass;

// Re-runs wishlist matching against whatever OwnedIndex is already cached in
// memory (from the last profile refresh this session) and persists results.
async function matchWishlistAgainstCachedIndex() {
  try {
    const idx = window.OwnedInventoryIndex && window.OwnedInventoryIndex.getCachedIndex && window.OwnedInventoryIndex.getCachedIndex();
    if (!idx) return;
    const pass = await matchWishlistPass(idx);
    if (!pass) return;
    await processNewMatches(pass, idx); // re-matching what's already owned: not a drop
  } catch (e) { console.warn('[Manager] matchWishlistAgainstCachedIndex failed', e); }
}

// Overwrites a specific existing wish in place (used by the weapon craft page's
// EDIT WISH button) instead of appending a new entry the way saveItem does.
/**
 * Overwrites one saved wish. `key` is the wish's WishlistSync.wishKey from when
 * it was loaded for editing, so an edit can't land on a different wish if the
 * list changed meanwhile. Resolves { result, key }: result is 'updated',
 * 'duplicate' (another saved wish already is exactly this roll, so nothing
 * changed) or 'missing' (the wish was deleted elsewhere); key is the wish's
 * key after the edit, for a follow-up edit.
 */
async function editItemWish(hash, index, rawString, config, mode = "pve", key) {
  const next = { tags: [mode], config, raw: rawString };
  const nextKey = window.WishlistSync.wishKey(next);
  let result = 'missing';
  await AWStore.update((data) => {
    const listId = AWStore.ensureActiveList(data);
    const wishes = data.lists[listId].items[hash]?.wishes;
    const at = window.WishlistSync.locateWish(wishes, index, key);
    if (at < 0) { result = 'missing'; return AWStore.SKIP; }
    if (wishes.some((w, i) => i !== at && window.WishlistSync.wishKey(w) === nextKey)) {
      result = 'duplicate';
      return AWStore.SKIP;
    }
    next.added = wishes[at].added || Date.now();
    // replaceWish tombstones the old wish if the edit changed its sync identity
    // (perks, or archetype + Tertiary), so cloud sync can't bring it back.
    result = window.WishlistSync.replaceWish(data, listId, hash, at, next) ? 'updated' : 'missing';
    if (result !== 'updated') return AWStore.SKIP;
  });
  if (result === 'updated') matchWishlistAgainstCachedIndex();
  return { result, key: result === 'updated' ? nextKey : key };
}

/**
 * Gives saved armor that lacks it the set it belongs to (and the set's real
 * name), from the item definitions, so the list groups whole sets and can show
 * their bonuses. Writes only when something was missing.
 */
async function backfillArmorSets() {
    try {
        const defs = await loadInventoryItemDefsToMemory();
        const setOf = (itemHash) => {
            const hash = defs.get(String(itemHash))?.equippingBlock?.equipableItemSetHash;
            return hash ? { hash, name: getArmorSetName(hash) } : null;
        };
        let changed = 0;
        await AWStore.update((data) => {
            changed = window.WeaponWish.fillArmorSets(data, setOf);
            if (!changed) return AWStore.SKIP;
        });
    } catch (e) {
        console.warn('[MANAGER] armor set backfill skipped', e);
    }
}

/**
 * Resolve the Destiny membership to fetch. Reuses the one cached by the last
 * sync when it belongs to the signed-in Bungie account, so a routine sync is a
 * single GetProfile round trip instead of two.
 */
async function resolveDestinyMembership(auth) {
  const cached = (await new Promise((res) => chrome.storage.local.get(['activeMembership'], res)))?.activeMembership;
  if (cached?.membershipId && cached.membershipType !== undefined &&
      cached.bungieMembershipId && cached.bungieMembershipId === auth.membership_id) {
    return { membershipType: cached.membershipType, membershipId: cached.membershipId };
  }

  // Fetch Destiny 2 memberships — GetMembershipsForCurrentUser is the authoritative
  // source; GetBungieNetUser (stored as auth.user) only contains Bungie.net account
  // info and does not include Destiny platform memberships.
  let memberships = [];
  try {
    memberships = await window.bungieAuth.fetchDestinyMemberships(auth.access_token);
  } catch (e) {
    console.warn('[Manager] fetchDestinyMemberships failed, trying stored user fallback:', e);
  }

  // Fallback: memberships stored directly on auth object at sign-in time
  if (!memberships || memberships.length === 0) {
    if (Array.isArray(auth.destinyMemberships) && auth.destinyMemberships.length > 0) {
      memberships = auth.destinyMemberships;
    }
  }

  // Fallback: older sign-in flows that stored memberships on auth.user
  if (!memberships || memberships.length === 0) {
    const user = auth.user || null;
    const fallback = user && (user.destinyMemberships || user.profiles);
    if (Array.isArray(fallback) && fallback.length > 0) memberships = fallback;
  }

  if (!memberships || memberships.length === 0) {
    throw new Error('No Destiny memberships found. Make sure you are signed in and have at least one linked platform.');
  }

  const primary = memberships[0];
  const membershipType = primary.membershipType ?? primary.membership_type;
  const membershipId = primary.membershipId ?? primary.membership_id;
  if (membershipType === undefined || !membershipId) {
    throw new Error('Could not determine membershipType/membershipId from: ' + JSON.stringify(primary));
  }
  return { membershipType, membershipId };
}

// responseMintedTimestamp of the newest profile applied this session. Bungie
// serves GetProfile from a short-lived cache, so a poll can come back with the
// same snapshot (nothing to do) or, across edge nodes, an older one (applying
// it would briefly un-own an item the user just picked up).
let _lastProfileMintedAt = 0;

/**
 * Refresh profile via Bungie API and build the OwnedIndex.
 * - Resolves the Destiny membership (cached after the first sync).
 * - Calls `bungieAuth.fetchProfileWithComponents`; skips everything below when
 *   the response is the same or an older snapshot than the last one applied.
 * - Builds the OwnedIndex via `OwnedInventoryIndex.buildOwnedIndex` and runs a wishlist match pass.
 *
 * @param {string|Array<number|string>} components - components param to pass to GetProfile (comma-separated or array)
 * @returns {Promise<boolean>} whether a newer profile was applied
 */
async function refreshProfileAndBuildIndex(components) {
  // getValidAuth() refreshes an expired access token first; reading the raw
  // stored token here would send an expired one to GetMembershipsForCurrentUser.
  const auth = await window.bungieAuth.getValidAuth();
  const { membershipType, membershipId } = await resolveDestinyMembership(auth);

  const profile = await window.bungieAuth.fetchProfileWithComponents(membershipType, membershipId, components);
  if (!profile) throw new Error('fetchProfileWithComponents returned no data.');

  const mintedAt = Date.parse(profile.responseMintedTimestamp) || 0;
  if (mintedAt && mintedAt <= _lastProfileMintedAt) return false;

  // Build owned index
  if (!window.OwnedInventoryIndex || !window.OwnedInventoryIndex.buildOwnedIndex) {
    throw new Error('OwnedInventoryIndex not available (owned-inventory-index.js failed to load).');
  }
  const idx = await window.OwnedInventoryIndex.buildOwnedIndex(profile);
  if (mintedAt) _lastProfileMintedAt = mintedAt;
  const totalInstances = idx.byInstanceId ? idx.byInstanceId.size : 0;
  const uniqueItems = idx.byItemHash ? idx.byItemHash.size : 0;
  const ownedIndexSummary = { totalInstances, uniqueItems, fetchedAt: Date.now() };
  const characterIds = Object.keys(profile?.characters?.data || {});
  const activeMembership = { membershipType, membershipId, characterIds, bungieMembershipId: auth.membership_id || null };
  await new Promise((res) => chrome.storage.local.set({ ownedIndexSummary, activeMembership }, res));
  console.log('[Manager] OwnedIndex built:', totalInstances, 'instances,', uniqueItems, 'unique item hashes');

  // Run wishlist matching pass using the built index. Every dimData write
  // re-renders all three views and queues a cloud push, so AWStore only writes
  // when matching actually changed something. The onChanged listener
  // re-renders the lists as soon as it lands — before the lock/transfer calls
  // below, which are one request per item.
  if (window.OwnedInventoryIndex.matchWishlist) {
    const pass = await matchWishlistPass(idx, { backfill: true });
    if (pass) {
      await processNewMatches(pass, idx, { logDrops: true });
      console.log('[Manager] Wishlist matching complete:', pass.summary);
    }
  }
  return true;
}

// Expose to console for manual triggering
window.appManager = window.appManager || {};
window.appManager.refreshProfileAndBuildIndex = refreshProfileAndBuildIndex;

// --- AUTO-REFRESH & SYNC BAR ---
// GetProfile component IDs (numeric — GetProfile rejects names):
// 102=ProfileInventory, 200=Characters, 201=CharacterInventories,
// 205=CharacterEquipment, 305=ItemSockets, 310=ItemReusablePlugs (full
// per-socket roll pool, not just the active plug). Each extra item component
// adds a block per instance to an already multi-megabyte response, so only
// what the OwnedIndex reads is requested.
const SYNC_COMPONENTS = '102,200,201,205,305,310';
const VISIBLE_REFRESH_INTERVAL_MS = 30 * 1000;  // panel open — DIM's cadence
const AUTO_REFRESH_INTERVAL_MS = 5 * 60 * 1000; // panel hidden
const MANUAL_REFRESH_COOLDOWN_MS = 15 * 1000;   // 15s floor (Bungie's requested minimum)

let _autoRefreshTimer = null;
let _lastSyncAt = null;
let _syncCooldownUntil = 0;
let _syncInFlight = null;
let _syncFailures = 0;      // failed syncs in a row
let _syncErrorKind = null;  // AWSync.classifyError() of the last failure
let _lastSyncError = null;  // the error itself, for the sync status sheet
let _lastSuccessAt = null;  // when a sync last worked (_lastSyncAt also moves on failures, to pace retries)

// Screens that show sync state (the status chip) listen for this instead of
// reaching into these variables.
function announceSyncChange() { document.dispatchEvent(new CustomEvent('awSyncChanged')); }
window.appManager = window.appManager || {};
window.appManager.getSyncSnapshot = () => ({
  syncing: !!_syncInFlight,
  lastSyncAt: _lastSuccessAt,
  lastError: _syncFailures ? _lastSyncError : null,
  failures: _syncFailures
});
window.appManager.syncNow = (manual = true) => runSync(manual);

function getAutoRefreshIntervalMs() {
  if (document.visibilityState === 'visible') return VISIBLE_REFRESH_INTERVAL_MS;
  return _feedEnabled ? FEED_INTERVAL_MS : AUTO_REFRESH_INTERVAL_MS;
}

// Schedules the next auto-sync relative to the last one, so the cadence
// follows panel visibility instead of a fixed setInterval. After failures it
// backs off, and a signed-out user isn't retried at all (AWSync.nextAutoSyncAt).
function scheduleNextSync() {
  if (_autoRefreshTimer) clearTimeout(_autoRefreshTimer);
  _autoRefreshTimer = null;
  const due = window.AWSync.nextAutoSyncAt({
    lastAttemptAt: _lastSyncAt, intervalMs: getAutoRefreshIntervalMs(),
    failures: _syncFailures, errorKind: _syncErrorKind
  });
  if (due === null) return; // resumes on sign-in or Sync now
  _autoRefreshTimer = setTimeout(() => runSync(false), Math.max(0, due - Date.now()));
}

// Resolves to the error when the sync failed (null on success), so callers
// that report failures can surface it without the loop ever rejecting.
function runSync(isManual = false) {
  // Auto and manual syncs share one request rather than racing each other.
  if (_syncInFlight) return _syncInFlight;
  // Bungie asks for a 15 s floor between manual refreshes; inside it, Sync now does nothing.
  if (isManual && Date.now() < _syncCooldownUntil) return Promise.resolve(null);
  _syncInFlight = (async () => {
    announceSyncChange();
    try {
      await refreshProfileAndBuildIndex(SYNC_COMPONENTS);
      _lastSyncAt = Date.now();
      _syncFailures = 0;
      _syncErrorKind = null;
      _lastSyncError = null;
      _lastSuccessAt = _lastSyncAt;
      return null;
    } catch (e) {
      _syncErrorKind = window.AWSync.classifyError(e);
      _lastSyncError = e;
      _syncFailures++;
      if (_syncErrorKind === 'auth') console.info('[AutoRefresh] not syncing until sign-in:', e?.message || e);
      else console.error('[AutoRefresh] sync failed:', e);
      _lastSyncAt = Date.now();
      return e;
    } finally {
      // The 15s floor applies after failures too, or reopening the panel
      // would retry a failing sync every time.
      _syncCooldownUntil = Date.now() + MANUAL_REFRESH_COOLDOWN_MS;
      _syncInFlight = null;
      scheduleNextSync();
      announceSyncChange();
    }
  })();
  return _syncInFlight;
}

function startAutoRefresh() {
  if (!startAutoRefresh._wired) {
    startAutoRefresh._wired = true;
    // Reopening the panel syncs straight away (subject to the 15s floor) and
    // switches to the fast cadence; hiding it drops back to the slow one.
    // A failing sync keeps its backoff instead.
    document.addEventListener('visibilitychange', () => {
      if (_syncInFlight) return;
      if (document.visibilityState === 'visible' && !_syncFailures && Date.now() >= _syncCooldownUntil) runSync(false);
      else scheduleNextSync();
    });
    // Signing in syncs at once (signing out stops: the next sync finds no session).
    // (It also fires once per load; a sync that's already fine is left alone.)
    document.addEventListener('bungieAuthChanged', (e) => {
      if (!e.detail?.auth || _syncInFlight || (_lastSyncAt && !_syncFailures)) return;
      _syncFailures = 0;
      _syncErrorKind = null;
      runSync(false);
    });
    // Coming back online retries a sync that failed for lack of a connection.
    window.addEventListener('online', () => {
      if (_syncErrorKind === 'network' && !_syncInFlight) runSync(false);
    });
  }

  // First call syncs immediately; later calls (Feed toggle) just re-pace.
  if (_lastSyncAt || _syncInFlight) scheduleNextSync();
  else runSync(false);
}

// Debug helper: run in the sidepanel devtools console as
// await appManager.debugWeaponMatch("Service Revolver")
// Prints every owned itemHash matching the name (catches reissue/duplicate-hash
// mismatches — same display name, different hash, common cause of "not matching"),
// each wish's saved perkColumnsData, and a column-by-column comparison against
// each owned instance's actual socket options.
window.appManager.debugWeaponMatch = async function (nameSubstring) {
  const q = String(nameSubstring || '').trim().toLowerCase();
  const defs = await loadInventoryItemDefsToMemory();
  const idx = window.OwnedInventoryIndex.getCachedIndex();
  const { dimData } = await new Promise((res) => chrome.storage.local.get(['dimData'], res));

  if (!idx) { console.warn('[DEBUG] No OwnedIndex cached — run Refresh Profile & Build Index first.'); return; }

  console.log('--- Owned itemHashes matching name ---');
  const ownedHashes = [];
  for (const [itemHash, instanceIds] of idx.byItemHash.entries()) {
    const def = defs.get(String(itemHash));
    const name = def?.displayProperties?.name || '';
    if (!name.toLowerCase().includes(q)) continue;
    ownedHashes.push(itemHash);
    console.log(`hash=${itemHash} name="${name}" copies=${instanceIds.size}`);
  }
  if (ownedHashes.length === 0) console.log('(none found in owned inventory)');

  console.log('--- Wishlist entries matching name ---');
  const activeId = dimData?.activeId || 'default';
  const list = dimData?.lists?.[activeId] || dimData?.lists?.['default'];
  if (!list) { console.warn('[DEBUG] No active wishlist found.'); return; }

  for (const itemHashStr of Object.keys(list.items || {})) {
    const item = list.items[itemHashStr];
    const name = item?.static?.name || '';
    if (!name.toLowerCase().includes(q)) continue;
    console.log(`WISH ITEM hash=${itemHashStr} name="${name}"`);

    const aliasHashes = Array.isArray(item.static?.linkedHashes) ? item.static.linkedHashes : [];
    const allHashesToCheck = [Number(itemHashStr), ...aliasHashes.map(Number)];
    if (aliasHashes.length) console.log(`  linkedHashes (auto-aliased duplicates): [${aliasHashes.join(', ')}]`);

    const ownsThisHash = allHashesToCheck.some((h) => ownedHashes.includes(h));
    if (!ownsThisHash) {
      console.warn(`  -> You do NOT own anything with this hash or its linked aliases. If this looks wrong, this is likely a reissue/duplicate-name mismatch: pick the search result whose hash matches one printed above.`);
    }

    (item.wishes || []).forEach((wish, i) => {
      console.log(`  wish #${i} (${(wish.tags||[]).join(',')}):`, wish.config?.perkColumnsData || '(legacy, no perkColumnsData)');
      console.log(`    received=${wish.received} receivedInstances=${JSON.stringify(wish.receivedInstances)}`);

      const instanceIds = new Set();
      for (const h of allHashesToCheck) {
        const s = idx.byItemHash.get(h);
        if (s) for (const iid of s) instanceIds.add(iid);
      }
      const combos = wish.config?.perkColumnsData
        ? window.OwnedInventoryIndex.buildCombos(wish.config.perkColumnsData)
        : [];
      if (combos.length > 0) {
        console.log(`    combos: ${combos.map((c) => `${c.color}(${c.members.length} cols)`).join(', ')}`);
        console.log(`    matchedCombos=${JSON.stringify(wish.matchedCombos)} comboMatches=${JSON.stringify(wish.comboMatches)}`);
      } else {
        console.log('    combos: none — this wish uses the plain per-column any-of rule');
      }

      if (instanceIds.size && wish.config?.perkColumnsData) {
        const nameOf = (h) => defs.get(String(h))?.displayProperties?.name || h;

        for (const iid of instanceIds) {
          const owned = idx.byInstanceId.get(iid);
          console.log(`    -- instance ${iid} --`);
          wish.config.perkColumnsData.forEach(({ socketIndex, colIndex, hashes, colors }) => {
            const socket = owned?.perkSockets?.[socketIndex];
            const wantNames = hashes.map(nameOf);
            const haveNames = (socket?.options || []).map(nameOf);
            const matched = socket && hashes.some((h) => socket.options.includes(h));
            const colorTag = Object.keys(colors || {}).length
              ? ` colors={${Object.entries(colors).map(([c, hs]) => `${c}:${nameOf(hs[0])}`).join(', ')}}`
              : '';
            console.log(`      col socketIndex=${socketIndex} colIndex=${colIndex ?? '(untagged)'}${colorTag} want=[${wantNames.join(', ')}] owned_options=[${haveNames.join(', ')}] any_of_matched=${!!matched}`);
          });

          if (combos.length > 0) {
            // With combos present, only a WHOLE combo counts — the any-of
            // results above are informational except on uncoloured columns.
            for (const { color, members } of combos) {
              const parts = members.map(({ socketIndex, hashes }) => {
                const hit = owned?.perkSockets?.[socketIndex]?.options.some((o) => hashes.includes(o));
                return `socket${socketIndex}:${nameOf(hashes[0])}=${hit ? 'HIT' : 'miss'}`;
              });
              const full = members.every(({ socketIndex, hashes }) =>
                owned?.perkSockets?.[socketIndex]?.options.some((o) => hashes.includes(o)));
              console.log(`      combo ${color}: ${parts.join(' + ')} -> ${full ? 'MATCH' : 'no match'}`);
            }
            continue;
          }

          // Columns-3&4 pooled trait-perk rule — only reachable on wishes with
          // no combos, where the legacy rules still apply in full.
          const col3 = wish.config.perkColumnsData.find((c) => c.colIndex === 2);
          const col4 = wish.config.perkColumnsData.find((c) => c.colIndex === 3);
          if (col3 && col4) {
            const s3 = owned?.perkSockets?.[col3.socketIndex];
            const s4 = owned?.perkSockets?.[col4.socketIndex];
            let hits = 0;
            for (const h of col3.hashes) if (s3?.options.includes(h)) hits++;
            for (const h of col4.hashes) if (s4?.options.includes(h)) hits++;
            const total = col3.hashes.length + col4.hashes.length;
            console.log(`      trait-pool (cols 3&4): ${hits}/${total} hit (need >=4) -> ${hits >= 4 ? 'MATCH' : 'no match'}`);
          } else {
            console.log('      trait-pool (cols 3&4): colIndex not tagged yet on this wish (run Refresh Profile & Build Index to backfill)');
          }
        }
      }
    });
  }
};

