// Ahamkara Wishes — DIM wishlist match overlay.
// Content script injected into app.destinyitemmanager.com. Reads the same
// `dimData` object the side panel maintains (owned-inventory-index.js already
// computes `wish.receivedInstances` — owned item instance IDs matching a
// saved wish — and persists it to chrome.storage.local) and tags any DIM
// item tile whose element id equals a matched instance ID with the
// `ahamkara-wish-match` class (see dim-wishlist-overlay.css for the ring).
// DIM renders each tile as a <div id="<instanceId>"> (currently wrapped in
// an ".item-drag-container" class, but that class name has already drifted
// once from what DIM's own GitHub source implied — the id is the only hook
// trusted here, since instance IDs are unique Bungie int64 strings and won't
// collide with unrelated ids elsewhere on the page).
(function () {
  const MATCH_CLASS = 'ahamkara-wish-match';
  let matchedIds = new Set();

  function collectMatchedInstanceIds(dimData) {
    const ids = new Set();
    const lists = dimData && dimData.lists;
    if (!lists) return ids;
    for (const listId of Object.keys(lists)) {
      const items = lists[listId] && lists[listId].items;
      if (!items) continue;
      for (const itemHash of Object.keys(items)) {
        const wishes = items[itemHash].wishes || [];
        for (const wish of wishes) {
          for (const iid of wish.receivedInstances || []) ids.add(String(iid));
        }
      }
    }
    return ids;
  }

  function applyBorders() {
    document.querySelectorAll('.' + MATCH_CLASS).forEach((el) => {
      if (!matchedIds.has(el.id)) el.classList.remove(MATCH_CLASS);
    });
    matchedIds.forEach((iid) => {
      const el = document.getElementById(iid);
      if (el && !el.classList.contains(MATCH_CLASS)) el.classList.add(MATCH_CLASS);
    });
  }

  // DIM changes the DOM in bursts (a scroll or filter can fire hundreds of
  // mutations in one frame). Coalesce them so the page is scanned once per
  // frame instead of once per mutation.
  let applyQueued = false;
  function scheduleApply() {
    if (applyQueued) return;
    applyQueued = true;
    requestAnimationFrame(() => {
      applyQueued = false;
      applyBorders();
    });
  }

  function refreshFromStorage() {
    chrome.storage.local.get(['dimData'], (res) => {
      matchedIds = collectMatchedInstanceIds(res && res.dimData);
      scheduleApply();
    });
  }

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.dimData) refreshFromStorage();
  });

  // DIM is a React SPA with virtualized/re-rendered item lists, so tiles
  // mount and unmount continuously as the user scrolls, filters, or switches
  // characters — re-tag on every DOM change rather than once at load.
  const observer = new MutationObserver(scheduleApply);
  observer.observe(document.body, { childList: true, subtree: true });

  refreshFromStorage();
})();
