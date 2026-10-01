// Ahamkara Wishes — Admin: creator management + wishlist moderation.
//
// The nav button is only ever injected into the DOM after admin-actions'
// "check" action confirms the signed-in Bungie membership ID matches
// ADMIN_BUNGIE_MEMBERSHIP_ID (a Supabase secret). That's cosmetic, not the
// real gate — every mutating call here re-sends the Bungie token and the
// Edge Function re-verifies server-side. See supabase/functions/admin-actions.

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

  // --- admin nav button lifecycle ---

  async function checkIsAdmin(e) {
    // Signed out: nothing to check. Calling getValidAuth() here would only
    // throw NOT_SIGNED_IN and log a spurious failure on every load.
    if (e && e.detail && !e.detail.auth) {
      cachedAccessToken = null;
      removeAdminNav();
      document.dispatchEvent(new CustomEvent('ahamkara:adminStatusChanged', { detail: { isAdmin: false } }));
      return;
    }
    try {
      if (!window.bungieAuth) { console.warn('[ADMIN] window.bungieAuth missing'); return removeAdminNav(); }
      const auth = await window.bungieAuth.getValidAuth();
      cachedAccessToken = auth.access_token;
      const resp = await postAdminAction({ action: 'check' });
      console.log('[ADMIN] check response:', resp);
      if (resp.is_admin) ensureAdminNav(); else removeAdminNav();
      document.dispatchEvent(new CustomEvent('ahamkara:adminStatusChanged', { detail: { isAdmin: !!resp.is_admin } }));
    } catch (e) {
      console.warn('[ADMIN] checkIsAdmin failed:', e);
      cachedAccessToken = null;
      removeAdminNav();
      document.dispatchEvent(new CustomEvent('ahamkara:adminStatusChanged', { detail: { isAdmin: false } }));
    }
  }

  function ensureAdminNav() {
    if (document.getElementById('nav-admin')) return;
    const slot = document.getElementById('admin-nav-slot');
    if (!slot) return;
    const btn = document.createElement('button');
    btn.id = 'nav-admin';
    btn.className = 'nav-btn';
    btn.textContent = 'ADMIN';
    btn.addEventListener('click', openAdmin);
    slot.appendChild(btn);
  }

  function removeAdminNav() {
    const btn = document.getElementById('nav-admin');
    if (btn) btn.remove();
    closeAdmin();
  }

  // --- open/close + tabs ---

  function openAdmin() {
    const sheet = document.getElementById('admin-view');
    if (!sheet) return;
    sheet.classList.add('open');
    sheet.setAttribute('aria-hidden', 'false');
    loadCreators();
    loadWishlists();
  }

  function closeAdmin() {
    const sheet = document.getElementById('admin-view');
    if (!sheet) return;
    sheet.classList.remove('open');
    sheet.setAttribute('aria-hidden', 'true');
  }

  function wireTabs() {
    document.querySelectorAll('.aw-admin-tab').forEach((tab) => {
      tab.addEventListener('click', () => {
        document.querySelectorAll('.aw-admin-tab').forEach((t) => t.classList.remove('active'));
        tab.classList.add('active');
        const target = tab.dataset.adminTab;
        document.getElementById('admin-tab-creators').classList.toggle('hidden', target !== 'creators');
        document.getElementById('admin-tab-wishlists').classList.toggle('hidden', target !== 'wishlists');
      });
    });
  }

  // --- creators tab ---

  async function loadCreators() {
    const list = document.getElementById('admin-creators-list');
    list.innerHTML = '';
    try {
      const rows = await restGet('/creators?select=*&order=display_name');
      if (!rows.length) {
        list.innerHTML = '<div class="empty-list-text">No creators added yet.</div>';
        return;
      }
      rows.forEach((c) => list.appendChild(renderCreatorRow(c)));
    } catch (e) {
      list.innerHTML = '<div class="empty-list-text">Failed to load creators.</div>';
    }
  }

  function renderCreatorRow(creator) {
    const row = document.createElement('div');
    row.className = 'aw-creator-row';
    row.dataset.bungieName = creator.bungie_name;

    const main = document.createElement('div');
    main.className = 'aw-creator-row-main';
    const displayEl = document.createElement('div');
    displayEl.className = 'aw-creator-display-name';
    displayEl.textContent = creator.display_name;
    const bungieEl = document.createElement('div');
    bungieEl.className = 'aw-creator-bungie-name';
    bungieEl.textContent = creator.bungie_name;
    main.appendChild(displayEl);
    main.appendChild(bungieEl);
    row.appendChild(main);

    const removeBtn = document.createElement('button');
    removeBtn.className = 'aw-creator-row-remove';
    removeBtn.textContent = 'Remove';
    removeBtn.addEventListener('click', async () => {
      try {
        await postAdminAction({ action: 'remove_creator', bungie_name: creator.bungie_name });
        row.remove();
        window.awWishlistIO.showToast('Creator removed.');
      } catch (e) {
        window.awWishlistIO.showToast('Failed to remove: ' + e.message, true);
      }
    });
    row.appendChild(removeBtn);

    return row;
  }

  function wireAddCreator() {
    const btn = document.getElementById('admin-creator-add');
    const bungieInput = document.getElementById('admin-creator-bungie-name');
    const displayInput = document.getElementById('admin-creator-display-name');

    btn.addEventListener('click', async () => {
      const bungie_name = bungieInput.value.trim();
      const display_name = displayInput.value.trim();
      if (!bungie_name || !display_name) {
        window.awWishlistIO.showToast('Both fields are required.', true);
        return;
      }
      btn.disabled = true;
      try {
        await postAdminAction({ action: 'add_creator', bungie_name, display_name, verified: true });
        bungieInput.value = '';
        displayInput.value = '';
        window.awWishlistIO.showToast('Creator added.');
        loadCreators();
      } catch (e) {
        window.awWishlistIO.showToast('Failed to add: ' + e.message, true);
      } finally {
        btn.disabled = false;
      }
    });
  }

  // --- wishlists (moderation) tab ---

  let wishlistSearchTerm = '';

  async function loadWishlists() {
    const list = document.getElementById('admin-wishlists-list');
    list.innerHTML = '';
    try {
      const q = wishlistSearchTerm.replace(/[,()]/g, '');
      const search = q ? `&or=(title.ilike.*${encodeURIComponent(q)}*,submitter_bungie_name.ilike.*${encodeURIComponent(q)}*)` : '';
      const rows = await restGet(`/wishlists?select=id,title,submitter_bungie_name,featured,item_count,created_at${search}&order=created_at.desc&limit=50`);
      if (!rows.length) {
        list.innerHTML = '<div class="empty-list-text">No wishlists found.</div>';
        return;
      }
      rows.forEach((w) => list.appendChild(renderAdminWishlistRow(w)));
    } catch (e) {
      list.innerHTML = '<div class="empty-list-text">Failed to load wishlists.</div>';
    }
  }

  function renderAdminWishlistRow(w) {
    const row = document.createElement('div');
    row.className = 'aw-admin-wl-row' + (w.featured ? ' featured' : '');
    row.dataset.id = w.id;

    const main = document.createElement('div');
    main.className = 'aw-admin-wl-main';
    const titleEl = document.createElement('div');
    titleEl.className = 'aw-creator-display-name';
    titleEl.textContent = w.title;
    const subEl = document.createElement('div');
    subEl.className = 'aw-creator-bungie-name';
    subEl.textContent = `${w.submitter_bungie_name} · ${w.item_count} item${w.item_count === 1 ? '' : 's'}`;
    main.appendChild(titleEl);
    main.appendChild(subEl);
    row.appendChild(main);

    const featureBtn = document.createElement('button');
    featureBtn.className = 'aw-admin-wl-feature-btn' + (w.featured ? ' featured' : '');
    featureBtn.title = w.featured ? 'Unfeature' : 'Feature';
    featureBtn.innerHTML = '&#9733;';
    featureBtn.addEventListener('click', async () => {
      const nowFeatured = !row.classList.contains('featured');
      try {
        await postAdminAction({ action: nowFeatured ? 'feature_wishlist' : 'unfeature_wishlist', wishlist_id: w.id });
        row.classList.toggle('featured', nowFeatured);
        featureBtn.classList.toggle('featured', nowFeatured);
        featureBtn.title = nowFeatured ? 'Unfeature' : 'Feature';
      } catch (e) {
        window.awWishlistIO.showToast('Failed to update: ' + e.message, true);
      }
    });
    row.appendChild(featureBtn);

    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'aw-admin-wl-delete-btn';
    deleteBtn.textContent = 'Delete';
    deleteBtn.addEventListener('click', async () => {
      if (!confirm(`Delete "${w.title}"? This cannot be undone.`)) return;
      try {
        await postAdminAction({ action: 'delete_wishlist', wishlist_id: w.id });
        row.remove();
        window.awWishlistIO.showToast('Wishlist deleted.');
      } catch (e) {
        window.awWishlistIO.showToast('Failed to delete: ' + e.message, true);
      }
    });
    row.appendChild(deleteBtn);

    return row;
  }

  function wireWishlistSearch() {
    const input = document.getElementById('admin-wishlist-search');
    let debounce = null;
    input.addEventListener('input', () => {
      clearTimeout(debounce);
      debounce = setTimeout(() => {
        wishlistSearchTerm = input.value.trim();
        loadWishlists();
      }, 300);
    });
  }

  // --- wiring ---

  document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('admin-close').addEventListener('click', closeAdmin);
    wireTabs();
    wireAddCreator();
    wireWishlistSearch();
    // No direct checkIsAdmin() call here — bungie-auth.js's updateAuthUI()
    // unconditionally dispatches 'bungieAuthChanged' once on every load
    // (signed in or not), which the listener below already handles. Calling
    // both would double the Bungie API round-trip on every page load.
  });

  document.addEventListener('bungieAuthChanged', checkIsAdmin);
})();
