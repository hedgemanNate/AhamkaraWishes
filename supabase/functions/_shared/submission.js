// Ahamkara Wishes — server-side check of a community wishlist submission.
//
// A submitted list is downloaded and imported by other players, so the server
// stores only what WishlistValidate.sanitizeList (client/wishlist-validate.js,
// the extension's own import rules) keeps: known fields, sane sizes, Bungie
// images only. Importers sanitize again; this keeps junk out of the database
// and the Discover listing in the first place.
//
// Plain script (no imports/exports) so the extension's Node tests can load it
// the same way as the client modules; it attaches globalThis.AWSubmission.
// Needs client/aw-dom.js and client/wishlist-validate.js loaded first.

(function (root) {
  'use strict';

  const MAX_TITLE = 120;
  const MAX_PAYLOAD_BYTES = 2 * 1024 * 1024; // stored list, after cleaning
  const GAME_MODES = ['pve', 'pvp', 'mixed'];

  function cleanTitle(v) {
    if (typeof v !== 'string') return '';
    return v.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, MAX_TITLE);
  }

  /**
   * @param {{title?:unknown, game_mode?:unknown, payload?:unknown}} body
   * @returns {{ok:true, row:{title:string, game_mode:string, has_weapons:boolean,
   *            has_armor:boolean, payload:{name:string, items:object}, item_count:number},
   *            dropped:number}
   *         | {ok:false, status:number, error:string}}
   */
  function checkSubmission(body) {
    const b = body && typeof body === 'object' ? body : {};
    const title = cleanTitle(b.title);
    if (!title) return { ok: false, status: 400, error: 'missing_title' };
    if (!GAME_MODES.includes(b.game_mode)) return { ok: false, status: 400, error: 'invalid_game_mode' };
    if (!b.payload || typeof b.payload !== 'object' || Array.isArray(b.payload)) {
      return { ok: false, status: 400, error: 'missing_payload' };
    }

    const validate = root.WishlistValidate && root.WishlistValidate.sanitizeList;
    if (typeof validate !== 'function') return { ok: false, status: 500, error: 'validator_missing' };
    const list = validate(b.payload);
    if (!list || list.itemCount === 0) return { ok: false, status: 400, error: 'no_valid_wishes' };

    const payload = { name: list.name, items: list.items };
    if (JSON.stringify(payload).length > MAX_PAYLOAD_BYTES) {
      return { ok: false, status: 413, error: 'payload_too_large' };
    }
    const items = Object.values(list.items);
    return {
      ok: true,
      row: {
        title,
        game_mode: b.game_mode,
        has_weapons: items.some((it) => it.static.type === 'weapon'),
        has_armor: items.some((it) => it.static.type === 'armor'),
        payload,
        item_count: list.itemCount
      },
      dropped: list.droppedItems + list.droppedWishes
    };
  }

  root.AWSubmission = { checkSubmission, MAX_PAYLOAD_BYTES, MAX_TITLE };
})(typeof window !== 'undefined' ? window : globalThis);
