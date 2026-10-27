// Ahamkara Wishes — the rules of the weapon builder, without any screen.
//
// A weapon wish is, per perk column, a set of acceptable perks plus "combos":
// a combo colour names the ONE perk in each column that belongs to that combo,
// and an owned roll must have all of them. A perk may wear several colours (it
// is part of more than one combo); a column can never hold the same colour on
// two perks. The state keeps the shape weapon-wish-core.js and the matcher
// already read, so nothing downstream changes:
//
//   state[colIndex] = { acceptable: Set<hash>, colors: Map<colour, baseHash> }
//
// `acceptable` holds both the base and the enhanced hash of every picked perk.
// The builder paints with a "brush": a combo colour, or 'any' (a plain pick that
// is in no combo). Tapping with a colour toggles that colour on the perk.
//
// Pure functions over plain data; tests/weapon-builder-core-test.js.

(function (root) {
  'use strict';

  const emptyState = (columns) => columns.map(() => ({ acceptable: new Set(), colors: new Map() }));

  const pairOf = (column, baseHash) => column.pairs.find((p) => p.base.hash === baseHash) || null;

  const isPicked = (state, pair) =>
    state.acceptable.has(pair.base.hash) || !!(pair.enhanced && state.acceptable.has(pair.enhanced.hash));

  /** The combo colours a perk wears, in click-cycle order. */
  function coloursOf(state, baseHash, comboColors) {
    return comboColors.filter((c) => state.colors.get(c) === baseHash);
  }

  /** Distinct perks picked in a column (base and enhanced count once). */
  function pickedCount(state, column) {
    return column.pairs.filter((p) => isPicked(state, p)).length;
  }

  function addPerk(state, pair) {
    state.acceptable.add(pair.base.hash);
    if (pair.enhanced) state.acceptable.add(pair.enhanced.hash);
  }

  function removePerk(state, pair) {
    state.acceptable.delete(pair.base.hash);
    if (pair.enhanced) state.acceptable.delete(pair.enhanced.hash);
    for (const [color, hash] of [...state.colors]) if (hash === pair.base.hash) state.colors.delete(color);
  }

  /**
   * Applies one tap. Mutates `state[colIndex]` and says what happened:
   *   { changed:false, reason:'cap' }            column already has `cap` perks
   *   { changed:true,  picked, colours, moved }  `moved` = the perk that lost this
   *                                              colour to the tapped one, if any
   * brush === 'any'  toggles a plain pick (taking off any colours it had).
   * brush === colour toggles that colour on the perk; a perk left with no colour
   *                  and no plain pick is off. Painting a colour another perk in
   *                  the column holds moves it here; that perk stays picked.
   */
  function paint(perkState, columns, colIndex, baseHash, brush, comboColors, cap) {
    const state = perkState[colIndex], column = columns[colIndex];
    const pair = state && column && pairOf(column, baseHash);
    if (!pair) return { changed: false, reason: 'unknown' };
    const was = isPicked(state, pair);
    if (!was && cap && pickedCount(state, column) >= cap) return { changed: false, reason: 'cap' };

    let moved = null;
    if (brush === 'any') {
      if (was) removePerk(state, pair); else addPerk(state, pair);
    } else if (!comboColors.includes(brush)) {
      return { changed: false, reason: 'unknown' };
    } else if (state.colors.get(brush) === baseHash) {
      state.colors.delete(brush);
      if (!coloursOf(state, baseHash, comboColors).length) removePerk(state, pair);
    } else {
      const holder = state.colors.get(brush);
      if (holder !== undefined) moved = holder;
      state.colors.set(brush, baseHash);
      addPerk(state, pair);
    }
    return { changed: true, picked: isPicked(state, pair), colours: coloursOf(state, baseHash, comboColors), moved };
  }

  /** Colours worn anywhere on the weapon, in click-cycle order. */
  function usedColours(perkState, comboColors) {
    return comboColors.filter((c) => perkState.some((s) => s && s.colors.has(c)));
  }

  /** How many columns a combo reaches. A combo of one column matches nothing useful. */
  function comboSpan(perkState, color) {
    return perkState.filter((s) => s && s.colors.has(color)).length;
  }

  /** The perks of one combo as [{ colIndex, plug }], the enhanced version when there is one. */
  function comboPlugs(columns, perkState, color) {
    const out = [];
    if (!color) return out;
    columns.forEach((col, colIndex) => {
      const baseHash = perkState[colIndex] && perkState[colIndex].colors.get(color);
      const pair = baseHash === undefined ? null : pairOf(col, baseHash);
      if (pair) out.push({ colIndex, plug: pair.enhanced || pair.base });
    });
    return out;
  }

  /** Sum of the unconditional stat changes of those plugs: Map statHash -> delta. */
  function statDeltas(plugs) {
    const deltas = new Map();
    plugs.forEach(({ plug }) => (plug.stats || []).forEach((s) => {
      if (!s.conditional) deltas.set(s.hash, (deltas.get(s.hash) || 0) + s.value);
    }));
    return deltas;
  }

  /** True when nothing is picked in any column (nothing to save). */
  const isEmpty = (perkState) => perkState.every((s) => !s || s.acceptable.size === 0);

  /** Puts a saved wish's picks into a fresh state (the Edit flow). Unknown columns are skipped. */
  function fromWish(columns, wish) {
    const state = emptyState(columns);
    const data = (wish && wish.config && Array.isArray(wish.config.perkColumnsData)) ? wish.config.perkColumnsData : [];
    data.forEach((entry) => {
      const s = state[entry.colIndex];
      if (!s || !Array.isArray(entry.hashes)) return;
      s.acceptable = new Set(entry.hashes);
      for (const [color, hashes] of Object.entries(entry.colors || {})) {
        if (Array.isArray(hashes) && hashes.length) s.colors.set(color, hashes[0]); // base hash comes first
      }
    });
    return state;
  }

  /**
   * The same picks on another version of the weapon (a season reissue): whatever
   * still exists in its columns carries over, by column and perk; the rest drops.
   */
  function carryPicks(columns, config) {
    const state = fromWish(columns, { config });
    state.forEach((st, c) => {
      const known = new Set();
      columns[c].pairs.forEach((p) => { known.add(p.base.hash); if (p.enhanced) known.add(p.enhanced.hash); });
      st.acceptable = new Set([...st.acceptable].filter((h) => known.has(h)));
      for (const [color, hash] of [...st.colors]) if (!pairOf(columns[c], hash)) st.colors.delete(color);
    });
    return state;
  }

  /**
   * An owned roll is one concrete perk per column, which is exactly a combo, so it
   * lands as combo 1. `activeBySocketIndex` maps a socket index to the equipped plug.
   */
  function fromOwned(columns, activeBySocketIndex, comboColors) {
    const state = emptyState(columns);
    columns.forEach((col, colIndex) => {
      const active = activeBySocketIndex && activeBySocketIndex[col.socketIndex];
      const pair = active && col.pairs.find((p) => p.base.hash === active || (p.enhanced && p.enhanced.hash === active));
      if (pair) paint(state, columns, colIndex, pair.base.hash, comboColors[0], comboColors, 0);
    });
    return state;
  }

  /** Direction pie for the recoil stat: where the shots drift, as an SVG path in a 2x1 box. */
  function recoilWedgePath(value) {
    const v = Math.max(0, Math.min(value, 100));
    const direction = Math.sin((v + 5) * ((2 * Math.PI) / 20)) * ((100 - v) / 100) * (Math.PI / 2);
    const half = Math.max(Math.abs(direction) * 0.75, 0.06);
    const a1 = direction - half, a2 = direction + half;
    const p = (a) => [(1 + Math.sin(a)).toFixed(4), (1 - Math.cos(a)).toFixed(4)];
    const [x1, y1] = p(a1), [x2, y2] = p(a2);
    return `M1,1 L${x1},${y1} A1,1 0 0,1 ${x2},${y2} Z`;
  }

  root.AWWeaponBuilder = {
    emptyState, pairOf, isPicked, coloursOf, pickedCount, paint, usedColours, comboSpan,
    comboPlugs, statDeltas, isEmpty, fromWish, carryPicks, fromOwned, recoilWedgePath
  };
})(typeof window !== 'undefined' ? window : globalThis);
