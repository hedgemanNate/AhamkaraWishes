// godroll.tv site access. Access is an *optional* host permission, asked for
// the first time the user clicks the Godroll.tv button in the side panel —
// not at install — so shipping the integration doesn't put a new permission
// warning on every existing user's update (Chrome disables an extension until
// a new warning is accepted). The content script is registered at runtime only
// while access is granted.
//
// Shared by the service worker (importScripts) and the side panel (<script>).

(function (root) {
  const ORIGINS = ['https://godroll.tv/*', 'https://www.godroll.tv/*'];
  const SCRIPT_ID = 'ahamkara-godroll';
  const JS = ['godroll-roll-core.js', 'godroll-content.js'];
  const CSS = ['godroll-content.css'];

  function has() {
    return chrome.permissions.contains({ origins: ORIGINS });
  }

  // Must be called synchronously inside a user gesture (a click handler).
  function request() {
    return chrome.permissions.request({ origins: ORIGINS });
  }

  /**
   * Makes the registered content script match the current permission:
   * registered while granted, removed when not. When it is newly registered,
   * godroll.tv tabs that are already open get it injected straight away, so the
   * button appears without a page reload. Service worker only (needs scripting).
   */
  async function syncContentScript() {
    const granted = await has();
    const existing = await chrome.scripting.getRegisteredContentScripts({ ids: [SCRIPT_ID] });

    if (!granted) {
      if (existing.length) await chrome.scripting.unregisterContentScripts({ ids: [SCRIPT_ID] });
      return false;
    }
    if (existing.length) return true;

    await chrome.scripting.registerContentScripts([{
      id: SCRIPT_ID,
      matches: ORIGINS,
      js: JS,
      css: CSS,
      runAt: 'document_idle',
      persistAcrossSessions: true
    }]);

    const tabs = await chrome.tabs.query({ url: ORIGINS });
    await Promise.all(tabs.map(async (tab) => {
      try {
        await chrome.scripting.insertCSS({ target: { tabId: tab.id }, files: CSS });
        await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: JS });
      } catch (e) {
        // A tab mid-navigation or discarded; it picks the script up on next load.
      }
    }));
    return true;
  }

  root.GodrollAccess = { ORIGINS, has, request, syncContentScript };
})(typeof window !== 'undefined' ? window : self);
