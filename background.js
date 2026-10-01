importScripts('supabase-network.js', 'bungie-auth-core.js');

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