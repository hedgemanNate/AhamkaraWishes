// Ahamkara Wishes — Discover without any screen: how lists are asked for, how a
// row from the server becomes something safe to show, the submit rules, and a
// small client for the `wishlists`/`creators` tables (public read, anon key) and
// the `wishlist-actions` Edge Function (submit, delete, whoami: each re-verified
// against Bungie on the server).
//
// Rows come from a public table and anyone can submit one, so everything shown
// goes through cardView: text stays text, unknown modes become "mixed".
//
// Pure functions plus createClient({ fetch, anonKey, getAuth }); the screen is
// screens/discover.js, the tests tests/discover-core-test.js. The classic
// discover.js (the old sheet) keeps its own copy until the new design replaces it.

(function (root) {
  'use strict';

  const BASE_URL = 'https://tqgewrylrjqfqzqlmmag.supabase.co';
  const ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRxZ2V3cnlscmpxZnF6cWxtbWFnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODM2NDgxMTEsImV4cCI6MjA5OTIyNDExMX0.BVHPpCkGycZXyj8BmtFITbrE9WqfEwx1zX5CSJ35__Y';
  const PAGE_SIZE = 20;
  const COLUMNS = 'id,title,game_mode,has_weapons,has_armor,item_count,submitter_membership_id,submitter_bungie_name,featured,save_count,created_at';
  const MODES = ['pve', 'pvp', 'mixed'];
  const FILTERS = [
    { key: 'all', label: 'All' }, { key: 'pve', label: 'PvE' }, { key: 'pvp', label: 'PvP' },
    { key: 'weapons', label: 'Weapons' }, { key: 'armor', label: 'Armor' }
  ];

  // ---- asking for lists ------------------------------------------------------------------

  function filterParam(filter) {
    if (filter === 'pve') return 'game_mode=eq.pve';
    if (filter === 'pvp') return 'game_mode=eq.pvp';
    if (filter === 'weapons') return 'has_weapons=eq.true';
    if (filter === 'armor') return 'has_armor=eq.true';
    return '';
  }

  const join = (parts) => parts.filter(Boolean).join('&');

  /** Featured lists, newest first. */
  const featuredPath = (filter) => `/wishlists?${join(['featured=eq.true', filterParam(filter), `select=${COLUMNS}`, 'order=created_at.desc'])}`;

  /** One page of the community lists. */
  const communityPath = (filter, offset) =>
    `/wishlists?${join(['featured=eq.false', filterParam(filter), `select=${COLUMNS}`, 'order=created_at.desc', `limit=${PAGE_SIZE}`, `offset=${offset || 0}`])}`;

  /** One page of results for a title or creator search (featured first). */
  function searchPath(text, filter, offset) {
    const q = encodeURIComponent(String(text || '').replace(/[,()*]/g, '').trim());
    const or = `or=(title.ilike.*${q}*,submitter_bungie_name.ilike.*${q}*)`;
    return `/wishlists?${join([or, filterParam(filter), `select=${COLUMNS}`, 'order=featured.desc,created_at.desc', `limit=${PAGE_SIZE}`, `offset=${offset || 0}`])}`;
  }

  const minePath = (membershipId) => `/wishlists?submitter_membership_id=eq.${encodeURIComponent(membershipId)}&select=${COLUMNS}&order=created_at.desc`;
  const payloadPath = (id) => `/wishlists?id=eq.${encodeURIComponent(id)}&select=payload`;

  // ---- showing a row ------------------------------------------------------------------------

  /**
   * The creator's chosen display name (and a verified tick) when the submitter is a
   * known creator, otherwise their Bungie name.
   */
  function authorOf(row, creators) {
    const c = creators && creators.get ? creators.get(row && row.submitter_bungie_name) : null;
    return { name: (c && c.display_name) || (row && row.submitter_bungie_name) || 'Unknown', verified: !!(c && c.verified) };
  }

  /** What the card shows, from a server row. Only known modes survive. */
  function cardView(row, creators) {
    const r = row || {};
    return {
      id: String(r.id == null ? '' : r.id),
      title: typeof r.title === 'string' && r.title.trim() ? r.title : 'Untitled',
      author: authorOf(r, creators),
      featured: !!r.featured,
      mode: MODES.includes(r.game_mode) ? r.game_mode : 'mixed',
      hasWeapons: !!r.has_weapons,
      hasArmor: !!r.has_armor,
      items: Number(r.item_count) > 0 ? Number(r.item_count) : 0,
      saves: Number(r.save_count) > 0 ? Number(r.save_count) : 0
    };
  }

  const itemsText = (n) => `${n} ${n === 1 ? 'item' : 'items'}`;

  // ---- submitting ---------------------------------------------------------------------------

  /** The mode to suggest for a list: whichever of PvE/PvP its wishes mostly are. */
  function detectMode(payload) {
    let pve = 0, pvp = 0;
    Object.values((payload && payload.items) || {}).forEach((it) => ((it && it.wishes) || []).forEach((w) => {
      const tags = (w && w.tags) || [];
      if (tags.includes('pve')) pve++;
      if (tags.includes('pvp')) pvp++;
    }));
    return pvp > pve ? 'pvp' : pve > 0 ? 'pve' : 'mixed';
  }

  const itemCountOf = (payload) => Object.keys((payload && payload.items) || {}).length;

  /** "3 of 5 submissions used." */
  const capNote = (who) => (who && Number.isFinite(who.submittedCount) && Number.isFinite(who.cap) ? `${who.submittedCount} of ${who.cap} submissions used.` : '');

  /** The server's error code in plain words. */
  function submitError(code, cap) {
    const known = {
      submission_cap_reached: `You’ve reached the limit${cap ? ` of ${cap}` : ''}. Delete one to submit another.`,
      no_valid_wishes: 'This list has no wishes that can be shared.',
      payload_too_large: 'This list is too big to share. Split it into smaller lists.'
    };
    return known[code] || `Couldn’t submit: ${code || 'something went wrong'}.`;
  }

  // ---- the client ----------------------------------------------------------------------------

  /**
   * @param {{fetch:Function, getAuth:Function, anonKey?:string, baseUrl?:string}} o
   *   fetch(url, init) like window.fetch (the panel passes supabaseFetch);
   *   getAuth() -> { access_token } or null when signed out.
   */
  function createClient(o) {
    const base = o.baseUrl || BASE_URL, key = o.anonKey || ANON_KEY;
    const anonHeaders = { apikey: key, Authorization: `Bearer ${key}` };

    async function get(path) {
      const resp = await o.fetch(`${base}/rest/v1${path}`, { headers: anonHeaders });
      if (!resp.ok) throw new Error(`Request failed: ${resp.status}`);
      return resp.json();
    }

    async function action(body) {
      const resp = await o.fetch(`${base}/functions/v1/wishlist-actions`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` }, body: JSON.stringify(body)
      });
      const parsed = await resp.json().catch(() => ({}));
      if (!resp.ok) { const e = new Error(parsed.error || 'Request failed'); e.code = parsed.error || ''; throw e; }
      return parsed;
    }

    const authed = async () => { const a = await o.getAuth(); if (!a || !a.access_token) { const e = new Error('Not signed in'); e.code = 'not_signed_in'; throw e; } return a; };

    return {
      /** Map<bungie_name, {display_name, verified}>; an empty map when the table can't be read. */
      async creators() {
        try { return new Map((await get('/creators?select=bungie_name,display_name,verified')).map((r) => [r.bungie_name, r])); } catch (e) { return new Map(); }
      },
      featured: (filter) => get(featuredPath(filter)),
      community: (filter, offset) => get(communityPath(filter, offset)),
      search: (text, filter, offset) => get(searchPath(text, filter, offset)),
      /** { who: {membershipId, submittedCount, cap}, rows } for the signed-in person. */
      async mine() {
        const a = await authed();
        const who = await action({ action: 'whoami', bungie_access_token: a.access_token });
        return { who, rows: await get(minePath(who.membershipId)) };
      },
      /** The list's contents, ready for the same import path a downloaded file takes. */
      async payload(id) {
        const rows = await get(payloadPath(id));
        const p = rows && rows[0] && rows[0].payload;
        if (!p) throw new Error('That wishlist no longer exists.');
        return p;
      },
      /** Best effort: counting a save must never stand in the way of the save itself. */
      async countSave(id) {
        try {
          await o.fetch(`${base}/rest/v1/rpc/increment_wishlist_save_count`, {
            method: 'POST', headers: Object.assign({ 'Content-Type': 'application/json' }, anonHeaders), body: JSON.stringify({ wishlist_id: id })
          });
          return true;
        } catch (e) { return false; }
      },
      async submit({ title, mode, payload }) {
        const a = await authed();
        return action({ action: 'submit', bungie_access_token: a.access_token, title, game_mode: mode, payload });
      },
      async remove(id) {
        const a = await authed();
        return action({ action: 'delete', bungie_access_token: a.access_token, wishlist_id: id });
      }
    };
  }

  root.AWDiscover = {
    PAGE_SIZE, FILTERS, MODES, filterParam, featuredPath, communityPath, searchPath, minePath, payloadPath,
    authorOf, cardView, itemsText, detectMode, itemCountOf, capNote, submitError, createClient
  };
})(typeof window !== 'undefined' ? window : globalThis);
