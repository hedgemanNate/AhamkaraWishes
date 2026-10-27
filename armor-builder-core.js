// Ahamkara Wishes — the rules of the armor builder, without any screen.
//
// An armor wish is one piece of a set plus the stat roll wanted on it:
//   archetype  required: the two main stats (e.g. GUNNER = Weapons + Grenade)
//   tertiary   optional: the third-highest stat; empty accepts any (D9)
//   spark      optional: the stat a Tier 5 piece was tuned to raise. Saved with the
//              wish; matching on it is not active yet (the game data doesn't show
//              it in inventory), and the builder says so.
// Choosing several pieces saves one wish per piece, all with the same roll.
//
// Pure functions over plain data; tests/armor-builder-core-test.js.

(function (root) {
  'use strict';

  const SLOTS = ['Head', 'Arms', 'Chest', 'Legs', 'Class'];
  const SLOT_LABEL = { Head: 'Helmet', Arms: 'Gauntlets', Chest: 'Chest', Legs: 'Legs', Class: 'Class item' };
  const CLASS_NAMES = { 0: 'Titan', 1: 'Hunter', 2: 'Warlock' };

  /** 'Head' | 'Arms' | ... for a bucket hash, given { HELMET, GAUNTLETS, CHEST, LEGS, CLASS_ITEM }. */
  function slotOf(bucketHash, buckets) {
    if (bucketHash === buckets.HELMET) return 'Head';
    if (bucketHash === buckets.GAUNTLETS) return 'Arms';
    if (bucketHash === buckets.CHEST) return 'Chest';
    if (bucketHash === buckets.LEGS) return 'Legs';
    if (bucketHash === buckets.CLASS_ITEM) return 'Class';
    return null;
  }

  const SLOT_WORDS = /\b(Mask|Vest|Grips|Strides|Cloak|Gauntlets|Plate|Helm|Helmet|Greaves|Mark|Gloves|Robes|Bond|Boots)\b/gi;
  /** "Techsec Helm" -> "Techsec": a set-like name for pieces the game puts in no set. */
  const stemOf = (name) => String(name || '').replace(SLOT_WORDS, '').replace(/\s+/g, ' ').trim() || String(name || '');

  /**
   * Groups armor pieces into sets, one piece per slot (the first seen wins; season
   * reissues are found again at save time). Pieces: [{hash,name,icon,classType,bucketHash,setHash}].
   * @returns {Array<{key:string, setHash:number|null, name:string, pieces:Object<string,object>, count:number}>}
   */
  function groupArmorSets(pieces, { buckets, setNameOf }) {
    const sets = new Map();
    (pieces || []).forEach((p) => {
      const slot = slotOf(p.bucketHash, buckets);
      if (!slot) return;
      const name = (p.setHash && setNameOf && setNameOf(p.setHash)) || stemOf(p.name);
      const key = p.setHash ? `set-${p.setHash}` : `name-${name.toLowerCase()}`;
      if (!sets.has(key)) sets.set(key, { key, setHash: p.setHash || null, name, pieces: {}, count: 0 });
      const set = sets.get(key);
      if (!set.pieces[slot]) { set.pieces[slot] = p; set.count++; }
    });
    return [...sets.values()].sort((a, b) => a.name.localeCompare(b.name, 'en', { sensitivity: 'base' }));
  }

  /** The stats still free to be the tertiary once an archetype is chosen. */
  function tertiaryChoices(archetypes, stats, archetypeName) {
    const a = archetypes.find((x) => x.name === archetypeName);
    return stats.filter((s) => !(a && a.stats.includes(s)));
  }

  /**
   * Tidies a pick: unknown values drop out, and a tertiary the archetype already
   * covers is cleared (it can't be the third stat).
   */
  function normalizePick(pick, archetypes, stats) {
    const p = pick || {};
    const archetype = archetypes.some((a) => a.name === p.archetype) ? p.archetype : null;
    const spark = stats.includes(p.spark) ? p.spark : null;
    const tertiary = archetype && tertiaryChoices(archetypes, stats, archetype).includes(p.tertiary) ? p.tertiary : null;
    return { archetype, tertiary, spark };
  }

  /** The config saved on a wish. Always carries every key, so it is the current shape. */
  const configFor = (pick) => ({ archetype: pick.archetype, tertiary: pick.tertiary || null, spark: pick.spark || null });

  /** What stops Save, as a short sentence, or null when ready. */
  function missing(selectedCount, pick) {
    if (!selectedCount) return 'Choose at least one piece.';
    if (!pick.archetype) return 'Choose an archetype.';
    return null;
  }

  /** One entry per piece to save: what saveItem needs. */
  function planSaves(pieces, pick, { buckets, setName }) {
    return pieces.map((p) => ({
      hash: p.hash, name: p.name, icon: p.icon, classType: p.classType, bucketHash: p.bucketHash,
      slotName: slotOf(p.bucketHash, buckets) || 'Unknown', setName: setName || p.name, setHash: p.setHash || null,
      rawString: `armor-wish:${p.hash}`, config: configFor(pick)
    }));
  }

  /** The toast after saving: honest about what was and wasn't added. */
  function saveSummary({ added, duplicate, failed }) {
    const w = (n) => `${n} ${n === 1 ? 'wish' : 'wishes'}`;
    if (failed && !added) return 'Couldn’t save. Please try again.';
    if (added && !duplicate && !failed) return `${w(added)} added.`;
    if (!added && duplicate && !failed) return duplicate === 1 ? 'That wish is already on your list.' : 'Those wishes are already on your list.';
    return `${w(added)} added. ${duplicate + failed} not saved (${duplicate ? `${duplicate} already there` : ''}${duplicate && failed ? ', ' : ''}${failed ? `${failed} failed` : ''}).`;
  }

  /** The label of the main button. */
  function saveLabel(count, edit) {
    if (edit) return 'Update roll';
    return count > 1 ? `Save ${count} wishes` : 'Save wish';
  }

  root.AWArmorBuilder = {
    SLOTS, SLOT_LABEL, CLASS_NAMES, slotOf, stemOf, groupArmorSets, tertiaryChoices, normalizePick,
    configFor, missing, planSaves, saveSummary, saveLabel
  };
})(typeof window !== 'undefined' ? window : globalThis);
