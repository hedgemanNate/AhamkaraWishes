// Ahamkara Wishes — Admin wishlist cloud backup/sync.
//
// chrome.storage.local is per-browser-install, so the admin account's wishlists
// otherwise wouldn't follow them to a different machine/browser. This mirrors
// dimData to the wishlist_backups Supabase table (admin-only; gated server-side
// by the same Bungie-membership check as admin-actions' other actions) so it
// can be pulled back down elsewhere.
//
// Every transfer goes through WishlistSync.mergeDimData (wishlist-sync-core.js)
// rather than replacing one side with the other. The original last-write-wins
// design destroyed a wishlist that existed only in one browser, because
// whichever side pushed last overwrote the whole blob. Now:
//   - pushes are read-merge-write, so a push can only ever add to what another
//     browser stored;
//   - startup merges both directions instead of picking a "newer" winner;
//   - deletions survive merging via tombstones recorded at the delete sites.

(function () {
  // Without the merge rules every transfer would fall back to clobbering one
  // side, which is the failure this module exists to prevent — so stay off
  // entirely rather than sync unsafely.
  if (!window.WishlistSync) {
    console.error('[ADMIN-SYNC] wishlist-sync-core.js not loaded; cloud sync disabled.');
    return;
  }

  const SUPABASE_URL = 'https://tqgewrylrjqfqzqlmmag.supabase.co';
  const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRxZ2V3cnlscmpxZnF6cWxtbWFnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODM2NDgxMTEsImV4cCI6MjA5OTIyNDExMX0.BVHPpCkGycZXyj8BmtFITbrE9WqfEwx1zX5CSJ35__Y';
  const ADMIN_ACTIONS_URL = `${SUPABASE_URL}/functions/v1/admin-actions`;
  const SYNCED_AT_KEY = 'ahamkara_backup_synced_at';
  const PUSH_DEBOUNCE_MS = 1500;

  let isAdminUser = false;
  let pushTimer = null;
  let pushInFlight = false;
  let pushQueued = false;
  // Canonical JSON of a dimData this module wrote itself, so the storage
  // listener can tell our own merge write apart from a real user edit.
  let lastSelfWrite = null;

  function storageGet(keys) {
    return new Promise((res) => chrome.storage.local.get(keys, res));
  }
  function storageSet(obj) {
    return new Promise((res) => chrome.storage.local.set(obj, res));
  }

  async function callAdminAction(body) {
    const auth = await window.bungieAuth.getValidAuth();
    const resp = await supabaseFetch(ADMIN_ACTIONS_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${SUPABASE_ANON_KEY}` },
      body: JSON.stringify({ ...body, bungie_access_token: auth.access_token }),
    });
    const parsed = await resp.json().catch(() => ({}));
    if (!resp.ok) throw new Error(parsed.error || 'Request failed');
    return parsed;
  }

  async function selfWrite(dimData) {
    lastSelfWrite = window.WishlistSync.stableStringify(dimData);
    await storageSet({ dimData });
  }

  async function fetchRemote() {
    const resp = await callAdminAction({ action: 'backup_get' });
    return resp.dim_data || null;
  }

  async function putRemote(dimData) {
    const resp = await callAdminAction({ action: 'backup_put', dim_data: dimData });
    const syncedAt = new Date(resp.updated_at).getTime() || Date.now();
    await storageSet({ [SYNCED_AT_KEY]: syncedAt });
  }

  /**
   * Read-merge-write. Pulling immediately before writing means this push can
   * only add to whatever another browser stored in the meantime; the race
   * window shrinks from "the whole session" to this one round trip.
   */
  async function pushDimData() {
    if (!isAdminUser) return;
    if (pushInFlight) { pushQueued = true; return; }
    pushInFlight = true;

    try {
      const { dimData: local } = await storageGet(['dimData']);
      if (!local) return;

      let remote;
      try {
        remote = await fetchRemote();
      } catch (e) {
        // Pushing without knowing the remote state is exactly the operation
        // that lost data before. Skip; startup sync (or the next edit) retries.
        console.warn('[ADMIN-SYNC] pre-push fetch failed, skipping push:', e);
        return;
      }

      const merged = remote ? window.WishlistSync.mergeDimData(local, remote) : local;
      const mergedJson = window.WishlistSync.stableStringify(merged);

      if (mergedJson !== window.WishlistSync.stableStringify(local)) {
        await selfWrite(merged);
      }
      await putRemote(merged);
      console.log('[ADMIN-SYNC] pushed merged dimData to backup');
    } catch (e) {
      console.warn('[ADMIN-SYNC] push failed:', e);
    } finally {
      pushInFlight = false;
      if (pushQueued) { pushQueued = false; scheduleDebouncedPush(); }
    }
  }

  function scheduleDebouncedPush() {
    clearTimeout(pushTimer);
    pushTimer = setTimeout(() => { pushTimer = null; pushDimData(); }, PUSH_DEBOUNCE_MS);
  }

  async function syncOnBecomeAdmin() {
    try {
      const remote = await fetchRemote();
      const { dimData: local } = await storageGet(['dimData']);

      // Always merge. The old rule ("pull if remote looks newer, else push")
      // had to guess which side was authoritative, and guessing wrong silently
      // deleted whichever lists only existed on the losing side.
      const merged = window.WishlistSync.mergeDimData(local, remote);
      const mergedJson = window.WishlistSync.stableStringify(merged);

      if (mergedJson !== window.WishlistSync.stableStringify(local)) {
        await selfWrite(merged);
        console.log('[ADMIN-SYNC] merged cloud backup into local wishlists');
      }
      if (!remote || mergedJson !== window.WishlistSync.stableStringify(remote)) {
        await putRemote(merged);
        console.log('[ADMIN-SYNC] pushed merged wishlists to cloud backup');
      }
    } catch (e) {
      console.warn('[ADMIN-SYNC] initial sync failed:', e);
    }
  }

  document.addEventListener('ahamkara:adminStatusChanged', (e) => {
    isAdminUser = !!(e.detail && e.detail.isAdmin);
    if (isAdminUser) syncOnBecomeAdmin();
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !changes.dimData || !isAdminUser) return;
    // Ignore the merge result we just wrote ourselves, which would otherwise
    // bounce straight back into another push.
    if (lastSelfWrite && window.WishlistSync.stableStringify(changes.dimData.newValue) === lastSelfWrite) {
      lastSelfWrite = null;
      return;
    }
    scheduleDebouncedPush();
  });

  // Closing the side panel mid-debounce would otherwise drop the pending push.
  // This is best-effort (the round trip rarely finishes during teardown) — the
  // real guarantee is that the next startup merges local into the cloud, so an
  // unpushed edit is delayed rather than lost.
  window.addEventListener('pagehide', () => {
    if (!pushTimer) return;
    clearTimeout(pushTimer);
    pushTimer = null;
    pushDimData();
  });
})();
