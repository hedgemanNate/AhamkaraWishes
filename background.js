importScripts('supabase-network.js', 'bungie-auth-core.js');

// godroll.tv "add to wishlist" button support. Loaded defensively: a failure
// here must never stop the service worker registering, or the token-refresh
// alarm below would die with it.
try {
  importScripts('destiny-manifest.js', 'godroll-roll-core.js', 'wishlist-sync-core.js', 'weapon-wish-core.js', 'aw-store.js', 'godroll-add.js');
} catch (e) {
  console.error('[BG] godroll add support failed to load:', e);
}

// godroll.tv site access is optional (see godroll-access.js); keep the
// runtime-registered content script in step with the permission. Separate
// try so it works even if the add-roll code above failed to load.
try {
  importScripts('godroll-access.js');
} catch (e) {
  console.error('[BG] godroll access support failed to load:', e);
}
function syncGodrollAccess() {
  if (!self.GodrollAccess) return Promise.resolve(false);
  return self.GodrollAccess.syncContentScript().catch((e) => {
    console.error('[BG] godroll content script sync failed:', e);
    return false;
  });
}
chrome.runtime.onInstalled.addListener(syncGodrollAccess);
chrome.runtime.onStartup.addListener(syncGodrollAccess);
// Also covers access granted or revoked from Chrome's own extension settings.
chrome.permissions.onAdded.addListener(syncGodrollAccess);
chrome.permissions.onRemoved.addListener(syncGodrollAccess);

// Allows users to open the side panel by clicking the action toolbar icon.
// Browsers without the chrome.sidePanel API (e.g. Opera GX) have no side
// panel surface at all, so fall back to opening the UI in a normal tab —
// referencing chrome.sidePanel directly here would throw and crash the
// service worker before the alarm/token-refresh logic below ever runs.
if (chrome.sidePanel && chrome.sidePanel.setPanelBehavior) {
  chrome.sidePanel
    .setPanelBehavior({ openPanelOnActionClick: true })
    .catch((error) => console.error(error));
} else {
  chrome.action.onClicked.addListener(() => {
    chrome.tabs.create({ url: chrome.runtime.getURL('sidepanel.html') });
  });
}

// The godroll.tv content script asks us to add a picked roll to a wishlist.
// The reply is async, hence `return true`; errors become a message the page
// can show rather than a silent failure.
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  // The side panel just got godroll.tv access granted and waits for the content
  // script to be registered before opening the site.
  if (msg && msg.type === 'ahamkara:sync-godroll-access') {
    syncGodrollAccess().then((ok) => sendResponse({ ok }));
    return true;
  }
  if (!msg || msg.type !== 'ahamkara:add-godroll-roll') return;
  if (!self.GodrollAdd) {
    sendResponse({ ok: false, error: 'Ahamkara Wishes could not start \u2014 try reloading the extension.' });
    return;
  }
  self.GodrollAdd.addRoll(msg).then(sendResponse, (e) => {
    console.error('[BG] add godroll roll failed:', e);
    sendResponse({ ok: false, error: 'Something went wrong adding the roll.' });
  });
  return true;
});

// --- PROACTIVE TOKEN REFRESH ---
// MV3 service workers terminate after inactivity, so there is no persistent
// process to keep the Bungie access token alive. chrome.alarms wakes the
// service worker on a schedule to keep the session rolling while the panel is
// closed. It is not load-bearing: getValidSession() also refreshes on demand,
// so an expired access token at panel-open time is handled there.

// Refresh goes through bungie-auth-core.js, the same code the side panel
// uses, under a Web Lock shared with the panel, so the alarm and the panel can
// never refresh with the same (single-use) refresh token at once.
async function bgRefreshTokenIfNeeded() {
  try {
    await self.BungieAuthCore.getValidSession();
  } catch (e) {
    // NOT_SIGNED_IN is normal; SESSION_EXPIRED already cleared the session
    // (the panel shows why); TRANSIENT is retried on the next alarm.
    if (e && e.code !== 'NOT_SIGNED_IN') console.warn('[BG] Token refresh:', e.code, e.message);
  }
}

function ensureTokenRefreshAlarm() {
  chrome.alarms.get('token-refresh', (alarm) => {
    if (!alarm) chrome.alarms.create('token-refresh', { periodInMinutes: 45 });
  });
}

chrome.runtime.onInstalled.addListener(() => {
  console.log("Ahamkara Wishes installed.");
  ensureTokenRefreshAlarm();
});

chrome.runtime.onStartup.addListener(() => {
  ensureTokenRefreshAlarm();
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'token-refresh') bgRefreshTokenIfNeeded();
});