// Shared by the godroll.tv content script and the service worker (godroll-add.js).
// Pure helpers only: reading a roll off a godroll.tv weapon page, and mapping it
// onto the perk columns built from the Bungie manifest.
//
// godroll.tv's page markup (observed on live pages) is what the DOM readers
// below depend on:
//   /<itemHash>/<slug>[/<roll>]         weapon page; the first path segment is
//                                       the real Bungie itemHash
//   .socket-columns > .socket-column    one per perk column
//   .perk-item[data-hash]               a perk; data-hash is its Bungie plug hash
//   .perk-item.selected                 a perk the visitor has picked
//   .stats-mode-toggle .stats-mode-btn.active   the PvE / PvP stats toggle
// The same .perk-item markup is also used for masterwork and mod picks, so
// those are excluded explicitly.
//
// The roll code in the URL is deliberately NOT parsed: it is an obfuscated
// binary encoding keyed to the weapon, and the DOM already exposes exact hashes.

(function (root) {
  function parseItemHash(pathname) {
    const m = /^\/(\d+)(?:\/|$)/.exec(String(pathname || ''));
    return m ? Number(m[1]) : null;
  }

  // Returns { itemHash, columns: number[][], layoutChanged } or null when this
  // isn't a weapon page. `columns` has one array per perk column, in page
  // order, holding the selected plug hashes (base or enhanced — whichever
  // variant is showing). `layoutChanged` is true when the markup this relies on
  // is gone — no perk columns at all, or picked perks with no readable hash — so
  // the button can say the integration needs an update instead of misleadingly
  // asking the user to pick perks they already picked.
  function readRoll(doc, pathname) {
    const itemHash = parseItemHash(pathname);
    if (itemHash === null) return null;

    const columns = [];
    let unreadable = 0;
    doc.querySelectorAll('.socket-columns .socket-column').forEach((col) => {
      const hashes = [];
      col.querySelectorAll('.perk-item.selected').forEach((el) => {
        if (el.classList.contains('masterwork-item') || el.classList.contains('mod-item-inline')) return;
        const h = el.getAttribute('data-hash');
        if (/^\d+$/.test(h || '')) hashes.push(Number(h));
        else unreadable++;
      });
      columns.push(hashes);
    });
    const found = columns.reduce((n, c) => n + c.length, 0);
    const layoutChanged = columns.length === 0 || (found === 0 && unreadable > 0);
    return { itemHash, columns, layoutChanged };
  }

  function countSelected(roll) {
    return roll ? roll.columns.reduce((n, c) => n + c.length, 0) : 0;
  }

  // 'pve' or 'pvp', from the page's stats toggle — a visitor looking at PvP
  // numbers is almost certainly picking a PvP roll. Defaults to 'pve'.
  function readMode(doc) {
    const btn = doc.querySelector('.stats-mode-toggle .stats-mode-btn.active');
    return btn && /^pvp$/i.test((btn.textContent || '').trim()) ? 'pvp' : 'pve';
  }

  /**
   * Maps godroll.tv's columns onto the craft view's columns.
   *
   * Matching is by hash, not position: each godroll column is assigned to the
   * still-unused craft column that contains the most of its hashes. That keeps
   * the result right even if the two sites order or split columns differently,
   * or when one perk appears in more than one column (some weapons list the
   * same trait in both trait columns).
   *
   * @param {number[][]} rollColumns   selected hashes per godroll column
   * @param {Array<{pairs: Array<{base: {hash:number}, enhanced?: {hash:number}|null}>}>} craftColumns
   * @returns {Array<{colIndex:number, baseHash:number, enhancedHash:number|null}>}
   */
  function assignColumns(rollColumns, craftColumns) {
    const picks = [];
    const used = new Set();

    const pairFor = (col, hash) =>
      col.pairs.find(({ base, enhanced }) => base.hash === hash || (enhanced && enhanced.hash === hash));

    for (const hashes of rollColumns) {
      if (!hashes.length) continue;
      let best = -1;
      let bestScore = 0;
      craftColumns.forEach((col, colIndex) => {
        if (used.has(colIndex)) return;
        const score = hashes.filter((h) => pairFor(col, h)).length;
        if (score > bestScore) { best = colIndex; bestScore = score; }
      });
      if (best < 0) continue;
      used.add(best);
      const seen = new Set();
      for (const h of hashes) {
        const pair = pairFor(craftColumns[best], h);
        if (!pair || seen.has(pair.base.hash)) continue;
        seen.add(pair.base.hash);
        picks.push({ colIndex: best, baseHash: pair.base.hash, enhancedHash: pair.enhanced ? pair.enhanced.hash : null });
      }
    }
    return picks;
  }

  root.GodrollRoll = { parseItemHash, readRoll, countSelected, readMode, assignColumns };
})(typeof window !== 'undefined' ? window : globalThis);
