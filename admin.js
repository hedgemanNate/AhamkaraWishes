// Ahamkara Wishes — Admin: who the owner is, and the calls moderation makes.
//
// The Admin entry (Account > Admin, screens/admin.js) only appears after
// admin-actions' "check" action confirms the signed-in Bungie membership ID
// matches ADMIN_BUNGIE_MEMBERSHIP_ID (a Supabase secret). That's cosmetic, not
// the real gate: every mutating call here re-sends the Bungie token and the
// Edge Function re-verifies server-side. See supabase/functions/admin-actions.
//
//   window.AWAdmin.isAdmin()   whether the check passed (also announced as the
//                              `ahamkara:adminStatusChanged` event)
//   window.AWAdmin.api         creators, addCreator, removeCreator, wishlists,
//                              feature, remove

(function () {
  const SUPABASE_URL = 'https://tqgewrylrjqfqzqlmmag.supabase.co';
  const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRxZ2V3cnlscmpxZnF6cWxtbWFnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODM2NDgxMTEsImV4cCI6MjA5OTIyNDExMX0.BVHPpCkGycZXyj8BmtFITbrE9WqfEwx1zX5CSJ35__Y';
  const REST_BASE = `${SUPABASE_URL}/rest/v1`;
  const ADMIN_ACTIONS_URL = `${SUPABASE_URL}/functions/v1/admin-actions`;

  let cachedAccessToken = null;

  async function restGet(path) {
    const resp = await supabaseFetch(`${REST_BASE}${path}`, {
      headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` },
    });
    if (!resp.ok) throw new Error('Request failed: ' + resp.status);
    return resp.json();
  }

  async function postAdminAction(body) {
    const resp = await supabaseFetch(ADMIN_ACTIONS_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${SUPABASE_ANON_KEY}` },
      body: JSON.stringify({ ...body, bungie_access_token: cachedAccessToken }),
    });
    const parsed = await resp.json().catch(() => ({}));
    if (!resp.ok) throw new Error(parsed.error || 'Request failed');
    return parsed;
  }

  // --- who is the admin ---

  let isAdmin = false;
  function setAdmin(v) {
    isAdmin = !!v;
    document.dispatchEvent(new CustomEvent('ahamkara:adminStatusChanged', { detail: { isAdmin } }));
  }

  async function checkIsAdmin(e) {
    // Signed out: nothing to check. Calling getValidAuth() here would only
    // throw NOT_SIGNED_IN and log a spurious failure on every load.
    if (e && e.detail && !e.detail.auth) { cachedAccessToken = null; setAdmin(false); return; }
    try {
      if (!window.bungieAuth) { console.warn('[ADMIN] window.bungieAuth missing'); setAdmin(false); return; }
      const auth = await window.bungieAuth.getValidAuth();
      cachedAccessToken = auth.access_token;
      const resp = await postAdminAction({ action: 'check' });
      setAdmin(!!resp.is_admin);
    } catch (err) {
      console.warn('[ADMIN] checkIsAdmin failed:', err);
      cachedAccessToken = null;
      setAdmin(false);
    }
  }

  // --- what moderation can do ---

  const api = {
    creators: () => restGet('/creators?select=*&order=display_name'),
    addCreator: (bungie_name, display_name) => postAdminAction({ action: 'add_creator', bungie_name, display_name, verified: true }),
    removeCreator: (bungie_name) => postAdminAction({ action: 'remove_creator', bungie_name }),
    wishlists: (term) => {
      const q = String(term || '').replace(/[,()*]/g, '').trim();
      const search = q ? `&or=(title.ilike.*${encodeURIComponent(q)}*,submitter_bungie_name.ilike.*${encodeURIComponent(q)}*)` : '';
      return restGet(`/wishlists?select=id,title,submitter_bungie_name,featured,item_count,created_at${search}&order=created_at.desc&limit=50`);
    },
    feature: (id, on) => postAdminAction({ action: on ? 'feature_wishlist' : 'unfeature_wishlist', wishlist_id: id }),
    remove: (id) => postAdminAction({ action: 'delete_wishlist', wishlist_id: id })
  };

  window.AWAdmin = { isAdmin: () => isAdmin, api };

  // No direct checkIsAdmin() call at load: bungie-auth.js dispatches 'bungieAuthChanged'
  // once on every load (signed in or not), which this listens to. Calling both would
  // double the Bungie API round-trip on every page load.
  document.addEventListener('bungieAuthChanged', checkIsAdmin);
})();
