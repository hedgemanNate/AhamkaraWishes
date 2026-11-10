// Ahamkara Wishes — validation for wishlists that arrive from outside.
//
// A list reaches us from a .awwish file or a Discover download, i.e. from
// someone else, and is then stored and rendered. sanitizeList() rebuilds it
// from known fields only, so unknown keys, wrong types and oversized values
// never reach storage. Rendering still escapes everything (aw-dom.js); this is
// the second layer, and it also stops one malformed entry from taking down a
// whole list view.
//
// Deliberately shape-only: it does not know the armor archetype names, so a
// list from a newer version with a new archetype still imports. The armor card
// renderer copes with names it doesn't recognise.
//
// Runtime annotations (received, matchScore, ...) are dropped here: they are
// recomputed from the player's own inventory, never imported.

(function (root) {
  'use strict';

  const MAX_ITEMS = 10000;
  const MAX_WISHES_PER_ITEM = 200;
  const MAX_COLUMNS = 12;
  const MAX_PERKS_PER_COLUMN = 40;
  const MAX_LINKED_HASHES = 50;
  const MAX_MASTERWORK_HASHES = 40; // one stat has ~13: tiers 1-10 plus the fully masterworked plugs
  const MAX_RAW = 8000;
  const MAX_UINT32 = 4294967295;
  const COMBO_COLORS = ['red', 'blue', 'green', 'orange'];

  const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

  /** Printable text, trimmed and length-capped, or null when not a string. */
  function text(v, max) {
    if (typeof v !== 'string') return null;
    return v.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, max);
  }

  function hash(v) {
    return Number.isInteger(v) && v >= 0 && v <= MAX_UINT32 ? v : null;
  }

  function hashList(v, max) {
    if (!Array.isArray(v)) return [];
    const out = [];
    for (const h of v.slice(0, max)) {
      const clean = hash(h);
      if (clean !== null) out.push(clean);
    }
    return out;
  }

  function smallInt(v, max) {
    return Number.isInteger(v) && v >= 0 && v <= max ? v : null;
  }

  /** Keeps an icon only when the renderer would actually load it. */
  function icon(v) {
    const safe = root.AWDom && root.AWDom.safeImageUrl;
    // Fail closed if the helper isn't loaded: no icon beats an unchecked one.
    return typeof v === 'string' && safe && safe(v) ? v.trim() : null;
  }

  function sanitizeStatic(s) {
    if (!isPlainObject(s)) return null;
    if (s.type !== 'weapon' && s.type !== 'armor') return null;
    const out = {
      name: text(s.name, 120) || '(unknown)',
      type: s.type,
      set: null,
      icon: icon(s.icon),
      classType: s.classType === 0 || s.classType === 1 || s.classType === 2 ? s.classType : null,
      bucketHash: hash(s.bucketHash),
      slotName: text(s.slotName, 40),
      setName: text(s.setName, 120),
      setHash: hash(s.setHash),
      linkedHashes: hashList(s.linkedHashes, MAX_LINKED_HASHES),
      ammoType: smallInt(s.ammoType, 10),
      itemTypeDisplayName: text(s.itemTypeDisplayName, 60),
      damageTypeHash: hash(s.damageTypeHash)
    };
    if (s.linkedHashesChecked === true) out.linkedHashesChecked = true;
    return out;
  }

  function sanitizePerkColumns(cols) {
    if (!Array.isArray(cols)) return [];
    return cols.slice(0, MAX_COLUMNS).map((col) => {
      if (!Array.isArray(col)) return [];
      return col.slice(0, MAX_PERKS_PER_COLUMN).filter(isPlainObject).map((p) => ({
        name: text(p.name, 120) || '',
        icon: icon(p.icon),
        hash: hash(p.hash),
        enhancedHash: hash(p.enhancedHash),
        color: COMBO_COLORS.includes(p.color) ? p.color : null,
        // A perk may wear several combo colours (planned); keep them if present.
        ...(Array.isArray(p.colors) ? { colors: p.colors.filter((x, i, all) => COMBO_COLORS.includes(x) && all.indexOf(x) === i) } : {})
      }));
    }).filter((col) => col.length > 0);
  }

  function sanitizePerkColumnsData(cols) {
    if (!Array.isArray(cols)) return [];
    return cols.slice(0, MAX_COLUMNS).filter(isPlainObject).map((c) => {
      const entry = {
        socketIndex: smallInt(c.socketIndex, 64),
        hashes: hashList(c.hashes, MAX_PERKS_PER_COLUMN)
      };
      // Older saves have no colIndex; manager.js backfills it, so leave it off.
      const colIndex = smallInt(c.colIndex, 64);
      if (colIndex !== null) entry.colIndex = colIndex;
      if (isPlainObject(c.colors)) {
        const colors = {};
        for (const color of COMBO_COLORS) {
          const members = hashList(c.colors[color], 2);
          if (members.length) colors[color] = members;
        }
        if (Object.keys(colors).length) entry.colors = colors;
      }
      return entry;
    });
  }

  /**
   * A weapon wish's optional masterwork: the stat it names and every plug hash
   * that counts as a match. Anything unusable is dropped, which reads as "any
   * masterwork" — the wish still imports. The key is a Bungie plug category
   * identifier, so it is held to that character set.
   */
  function sanitizeMasterwork(m) {
    if (!isPlainObject(m)) return null;
    if (typeof m.key !== 'string' || !/^[A-Za-z0-9_.]{1,80}$/.test(m.key)) return null;
    const hashes = hashList(m.hashes, MAX_MASTERWORK_HASHES).filter((h) => h > 0);
    if (!hashes.length) return null;
    return { key: m.key, name: text(m.name, 40) || '', icon: icon(m.icon) || '', hashes };
  }

  function sanitizeConfig(type, c) {
    if (!isPlainObject(c)) return null;
    if (type === 'armor') {
      const archetype = text(c.archetype, 40);
      if (!archetype) return null;
      // Files and Discover lists from before the Tertiary/Spark split stored
      // the Tertiary as `spark`; a `tertiary` key marks the current shape.
      // Both are optional (D9): absent stays null rather than "".
      const current = Object.prototype.hasOwnProperty.call(c, 'tertiary');
      const tertiary = text(current ? c.tertiary : c.spark, 20) || null;
      const spark = current ? (text(c.spark, 20) || null) : null;
      return { archetype, tertiary, spark };
    }
    const out = {};
    if (typeof c.perks === 'string') {
      // Legacy saves from the DIM content script keep perks as "1,2,3".
      out.perks = /^[\d,\s]{0,4000}$/.test(c.perks) ? c.perks : '';
    } else {
      out.perks = Array.isArray(c.perks)
        ? c.perks.slice(0, MAX_COLUMNS).map((col) => hashList(col, MAX_PERKS_PER_COLUMN))
        : [];
    }
    out.perkColumns = sanitizePerkColumns(c.perkColumns);
    out.perkColumnsData = sanitizePerkColumnsData(c.perkColumnsData);
    const masterwork = sanitizeMasterwork(c.masterwork);
    if (masterwork) out.masterwork = masterwork;
    return out;
  }

  function sanitizeWish(w, type) {
    if (!isPlainObject(w)) return null;
    if (typeof w.raw !== 'string' || w.raw.length > MAX_RAW) return null;
    const config = sanitizeConfig(type, w.config);
    if (!config) return null;
    const tags = (Array.isArray(w.tags) ? w.tags : [])
      .filter((t, i, all) => (t === 'pve' || t === 'pvp') && all.indexOf(t) === i)
      .slice(0, 2);
    const out = {
      tags: tags.length ? tags : ['pve'],
      config,
      raw: w.raw,
      added: Number.isFinite(w.added) && w.added >= 0 ? w.added : Date.now()
    };
    // Persistent (non-runtime) legacy matching fields; normalizeWishlistEntry
    // rebuilds them when absent.
    if (Array.isArray(w.desired)) out.desired = hashList(w.desired, 400);
    if (Array.isArray(w.mustHave)) out.mustHave = hashList(w.mustHave, 400);
    return out;
  }

  /**
   * @param {object} list  untrusted { name, items } from a file or the server
   * @returns {{name:string, items:object, itemCount:number, droppedItems:number, droppedWishes:number}|null}
   *          null when `list` isn't a list at all
   */
  function sanitizeList(list) {
    if (!isPlainObject(list)) return null;
    const items = {};
    let itemCount = 0;
    let droppedItems = 0;
    let droppedWishes = 0;

    const source = isPlainObject(list.items) ? list.items : {};
    for (const key of Object.keys(source)) {
      // A hash key is the only thing that ever indexes items, so a key that
      // isn't a plain integer (including __proto__) is never copied across.
      if (!/^\d{1,10}$/.test(key) || Number(key) > MAX_UINT32) { droppedItems++; continue; }
      if (itemCount >= MAX_ITEMS) { droppedItems++; continue; }
      const item = source[key];
      const stat = isPlainObject(item) ? sanitizeStatic(item.static) : null;
      if (!stat) { droppedItems++; continue; }

      const wishes = [];
      const rawWishes = Array.isArray(item.wishes) ? item.wishes : [];
      for (const w of rawWishes.slice(0, MAX_WISHES_PER_ITEM)) {
        const clean = sanitizeWish(w, stat.type);
        if (clean) wishes.push(clean); else droppedWishes++;
      }
      droppedWishes += Math.max(0, rawWishes.length - MAX_WISHES_PER_ITEM);
      if (!wishes.length) { droppedItems++; continue; }

      items[key] = { static: stat, wishes };
      itemCount++;
    }

    return {
      name: text(list.name, 80) || 'Imported Wishlist',
      items,
      itemCount,
      droppedItems,
      droppedWishes
    };
  }

  root.WishlistValidate = { sanitizeList };
})(typeof window !== 'undefined' ? window : globalThis);
