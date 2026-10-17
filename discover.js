// Ahamkara Wishes — Discover: browse, search, save, and submit community &
// creator wishlists. Backed by the `wishlists`/`creators` tables (public
// read via anon key + RLS) and the `wishlist-actions` Edge Function (submit/
// delete/whoami — all identity-verified server-side against Bungie).
//
// Saving a browsed wishlist reuses wishlist-io.js's importFromPayload, so a
// browsed list and a downloaded .awwish file go through the exact same
// validate/normalize/persist path.

(function () {
  const SUPABASE_URL = 'https://tqgewrylrjqfqzqlmmag.supabase.co';
  const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRxZ2V3cnlscmpxZnF6cWxtbWFnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODM2NDgxMTEsImV4cCI6MjA5OTIyNDExMX0.BVHPpCkGycZXyj8BmtFITbrE9WqfEwx1zX5CSJ35__Y';
  const REST_BASE = `${SUPABASE_URL}/rest/v1`;
  const WISHLIST_ACTIONS_URL = `${SUPABASE_URL}/functions/v1/wishlist-actions`;
  const PAGE_SIZE = 20;
  const LIST_COLUMNS = 'id,title,game_mode,has_weapons,has_armor,item_count,submitter_membership_id,submitter_bungie_name,featured,save_count,created_at';

  let creatorsMap = new Map();
  let currentFilter = 'all';
  let currentSearch = '';
  let communityOffset = 0;
  let resultsOffset = 0;
  let whoamiCache = null;
  let pendingSubmitPayload = null;

  // --- low-level fetch helpers ---

  async function restGet(path) {
    const resp = await supabaseFetch(`${REST_BASE}${path}`, {
      headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` },
    });
    if (!resp.ok) throw new Error('Request failed: ' + resp.status);
    return resp.json();
  }

  async function postWishlistAction(body) {
    const resp = await supabaseFetch(WISHLIST_ACTIONS_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${SUPABASE_ANON_KEY}` },
      body: JSON.stringify(body),
    });
    const parsed = await resp.json().catch(() => ({}));
    if (!resp.ok) throw new Error(parsed.error || 'Request failed');
    return parsed;
  }

  async function getBungieAuthOrNull() {
    try {
      if (!window.bungieAuth) return null;
      return await window.bungieAuth.getValidAuth();
    } catch {
      return null;
    }
  }

  function filterParams(filter) {
    if (filter === 'pve') return 'game_mode=eq.pve';
    if (filter === 'pvp') return 'game_mode=eq.pvp';
    if (filter === 'weapons') return 'has_weapons=eq.true';
    if (filter === 'armor') return 'has_armor=eq.true';
    return '';
  }

  async function fetchFeatured() {
    const qs = ['featured=eq.true', filterParams(currentFilter), `select=${LIST_COLUMNS}`, 'order=created_at.desc']
      .filter(Boolean).join('&');
    return restGet(`/wishlists?${qs}`);
  }

  async function fetchCommunityPage(offset) {
    const qs = ['featured=eq.false', filterParams(currentFilter), `select=${LIST_COLUMNS}`, 'order=created_at.desc', `limit=${PAGE_SIZE}`, `offset=${offset}`]
      .filter(Boolean).join('&');
    return restGet(`/wishlists?${qs}`);
  }

  async function fetchSearchPage(offset) {
    const q = currentSearch.replace(/[,()]/g, '');
    const orClause = `or=(title.ilike.*${encodeURIComponent(q)}*,submitter_bungie_name.ilike.*${encodeURIComponent(q)}*)`;
    const qs = [orClause, filterParams(currentFilter), `select=${LIST_COLUMNS}`, 'order=featured.desc,created_at.desc', `limit=${PAGE_SIZE}`, `offset=${offset}`]
      .filter(Boolean).join('&');
    return restGet(`/wishlists?${qs}`);
  }

  async function refreshCreatorsCache() {
    try {
      const rows = await restGet('/creators?select=bungie_name,display_name,verified');
      creatorsMap = new Map(rows.map((r) => [r.bungie_name, r]));
    } catch {
      creatorsMap = new Map();
    }
  }

  function resolveAuthor(row) {
    const creator = creatorsMap.get(row.submitter_bungie_name);
    return { name: creator ? creator.display_name : row.submitter_bungie_name, verified: !!creator?.verified };
  }

  // --- card rendering ---

  async function saveWishlist(row, btn, countEl) {
    btn.disabled = true;
    const original = btn.textContent;
    btn.textContent = 'Saving...';
    try {
      const full = await restGet(`/wishlists?id=eq.${row.id}&select=payload`);
      const payload = full?.[0]?.payload;
      if (!payload) throw new Error('Wishlist no longer exists.');
      window.awWishlistIO.importFromPayload({ aw: 'wishes', v: 1, list: payload });
      btn.textContent = 'Saved';
      btn.classList.add('saved');
      supabaseFetch(`${REST_BASE}/rpc/increment_wishlist_save_count`, {
        method: 'POST',
        headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ wishlist_id: row.id }),
      }).then(() => {
        row.save_count = (row.save_count || 0) + 1;
        countEl.textContent = row.save_count + ' saved';
      }).catch(() => {});
    } catch (e) {
      btn.disabled = false;
      btn.textContent = original;
      window.awWishlistIO.showToast('Could not save: ' + e.message, true);
    }
  }

  async function deleteOwnWishlist(id, cardEl) {
    const auth = await getBungieAuthOrNull();
    if (!auth) return;
    try {
      await postWishlistAction({ action: 'delete', bungie_access_token: auth.access_token, wishlist_id: id });
      document.querySelectorAll(`.aw-wl-card[data-id="${id}"]`).forEach((el) => el.remove());
      if (whoamiCache) {
        whoamiCache.submittedCount = Math.max(0, whoamiCache.submittedCount - 1);
        const capEl = document.getElementById('discover-mine-cap');
        if (capEl) capEl.textContent = `(${whoamiCache.submittedCount} of ${whoamiCache.cap} used)`;
      }
      window.awWishlistIO.showToast('Wishlist deleted.');
    } catch (e) {
      window.awWishlistIO.showToast('Could not delete: ' + e.message, true);
    }
    void cardEl; // card is removed via the shared data-id query above (may appear in multiple lists)
  }

  function renderWishlistCard(row, opts = {}) {
    const card = document.createElement('div');
    card.className = 'aw-wl-card' + (row.featured ? ' featured' : '');
    card.dataset.id = row.id;

    const main = document.createElement('div');
    main.className = 'aw-wl-card-main';

    const titleEl = document.createElement('div');
    titleEl.className = 'aw-wl-title';
    titleEl.textContent = row.title;
    main.appendChild(titleEl);

    const author = resolveAuthor(row);
    const metaEl = document.createElement('div');
    metaEl.className = 'aw-wl-meta';
    metaEl.innerHTML =
      `<span class="aw-wl-author">${escapeHtml(author.name)}</span>` +
      (author.verified ? '<span class="aw-wl-verified-badge" title="Verified creator">&#10003;</span>' : '') +
      (row.featured ? '<span class="aw-wl-featured-tag">&#9733; FEATURED</span>' : '') +
      `<span>&middot; ${Number(row.item_count) || 0} item${Number(row.item_count) === 1 ? '' : 's'}</span>`;
    main.appendChild(metaEl);

    // Rows come from the server and anyone can submit one, so only known modes
    // reach the markup (and the class name).
    const gameMode = ['pve', 'pvp', 'mixed'].includes(row.game_mode) ? row.game_mode : 'mixed';
    const tagsEl = document.createElement('div');
    tagsEl.className = 'aw-wl-tags';
    tagsEl.innerHTML =
      `<span class="aw-wl-tag aw-wl-tag-${gameMode}">${gameMode}</span>` +
      (row.has_weapons ? '<span class="aw-wl-tag">weapons</span>' : '') +
      (row.has_armor ? '<span class="aw-wl-tag">armor</span>' : '');
    main.appendChild(tagsEl);

    card.appendChild(main);

    const actions = document.createElement('div');
    actions.className = 'aw-wl-actions';

    const countEl = document.createElement('span');
    countEl.className = 'aw-wl-save-count';
    countEl.textContent = (row.save_count || 0) + ' saved';

    if (opts.showDelete) {
      const delBtn = document.createElement('button');
      delBtn.className = 'aw-wl-delete-btn';
      delBtn.textContent = 'Delete';
      delBtn.addEventListener('click', () => deleteOwnWishlist(row.id, card));
      actions.appendChild(delBtn);
    } else {
      const saveBtn = document.createElement('button');
      saveBtn.className = 'aw-wl-save-btn';
      saveBtn.textContent = 'Save';
      saveBtn.addEventListener('click', () => saveWishlist(row, saveBtn, countEl));
      actions.appendChild(saveBtn);
    }

    actions.appendChild(countEl);
    card.appendChild(actions);
    return card;
  }

  // --- section refresh ---

  async function refreshFeatured() {
    const section = document.getElementById('discover-featured-section');
    const list = document.getElementById('discover-featured-list');
    list.innerHTML = '';
    try {
      const rows = await fetchFeatured();
      if (!rows.length) { section.classList.add('hidden'); return; }
      section.classList.remove('hidden');
      rows.forEach((row) => list.appendChild(renderWishlistCard(row)));
    } catch {
      section.classList.add('hidden');
    }
  }

  async function refreshCommunity(reset) {
    if (reset) communityOffset = 0;
    const list = document.getElementById('discover-community-list');
    const loadMoreBtn = document.getElementById('discover-community-load-more');
    const emptyEl = document.getElementById('discover-community-empty');
    if (reset) list.innerHTML = '';
    try {
      const rows = await fetchCommunityPage(communityOffset);
      rows.forEach((row) => list.appendChild(renderWishlistCard(row)));
      communityOffset += rows.length;
      loadMoreBtn.classList.toggle('hidden', rows.length < PAGE_SIZE);
      emptyEl.classList.toggle('hidden', list.children.length > 0);
    } catch {
      emptyEl.classList.toggle('hidden', list.children.length > 0);
    }
  }

  async function refreshResults(reset) {
    if (reset) resultsOffset = 0;
    const list = document.getElementById('discover-results-list');
    const loadMoreBtn = document.getElementById('discover-results-load-more');
    const emptyEl = document.getElementById('discover-results-empty');
    if (reset) list.innerHTML = '';
    try {
      const rows = await fetchSearchPage(resultsOffset);
      rows.forEach((row) => list.appendChild(renderWishlistCard(row)));
      resultsOffset += rows.length;
      loadMoreBtn.classList.toggle('hidden', rows.length < PAGE_SIZE);
      emptyEl.classList.toggle('hidden', list.children.length > 0);
    } catch {
      emptyEl.classList.toggle('hidden', list.children.length > 0);
    }
  }

  function updateModeVisibility() {
    const searching = currentSearch.trim().length > 0;
    document.getElementById('discover-results-section').classList.toggle('hidden', !searching);
    document.getElementById('discover-featured-section').classList.toggle('hidden', searching);
    document.getElementById('discover-community-section').classList.toggle('hidden', searching);
  }

  function refreshBrowseOrSearch() {
    updateModeVisibility();
    if (currentSearch.trim()) {
      refreshResults(true);
    } else {
      refreshFeatured();
      refreshCommunity(true);
    }
  }

  async function refreshMine() {
    const section = document.getElementById('discover-mine-section');
    const list = document.getElementById('discover-mine-list');
    const capEl = document.getElementById('discover-mine-cap');
    list.innerHTML = '';

    const auth = await getBungieAuthOrNull();
    if (!auth) { section.classList.add('hidden'); whoamiCache = null; return; }

    try {
      const resp = await postWishlistAction({ action: 'whoami', bungie_access_token: auth.access_token });
      whoamiCache = resp;
      capEl.textContent = `(${resp.submittedCount} of ${resp.cap} used)`;
      section.classList.remove('hidden');

      const rows = await restGet(`/wishlists?submitter_membership_id=eq.${encodeURIComponent(resp.membershipId)}&select=${LIST_COLUMNS}&order=created_at.desc`);
      rows.forEach((row) => list.appendChild(renderWishlistCard(row, { showDelete: true })));
    } catch {
      section.classList.add('hidden');
    }
  }

  // --- submit flow ---

  function wireSubmitFlow() {
    const fab = document.getElementById('discover-submit-fab');
    const overlay = document.getElementById('discover-submit-modal-overlay');
    const titleInput = document.getElementById('discover-submit-title');
    const modeSelect = document.getElementById('discover-submit-mode');
    const infoEl = document.getElementById('discover-submit-info');
    const cancelBtn = document.getElementById('discover-submit-cancel');
    const confirmBtn = document.getElementById('discover-submit-confirm');

    fab.addEventListener('click', async () => {
      const auth = await getBungieAuthOrNull();
      if (!auth) {
        window.awWishlistIO.showToast('Sign in first to submit a wishlist.', true);
        return;
      }
      window.awWishlistIO.getActiveListPayload((payload) => {
        const itemCount = payload ? Object.keys(payload.items || {}).length : 0;
        if (!payload || itemCount === 0) {
          window.awWishlistIO.showToast('Your active wishlist is empty — add some wishes first.', true);
          return;
        }
        pendingSubmitPayload = payload;
        titleInput.value = payload.name || '';

        const items = Object.values(payload.items);
        let pveCount = 0, pvpCount = 0;
        items.forEach((it) => (it.wishes || []).forEach((w) => {
          if ((w.tags || []).includes('pve')) pveCount++;
          if ((w.tags || []).includes('pvp')) pvpCount++;
        }));
        modeSelect.value = pvpCount > pveCount ? 'pvp' : (pveCount > 0 ? 'pve' : 'mixed');

        const capNote = whoamiCache ? `${whoamiCache.submittedCount} of ${whoamiCache.cap} submissions used.` : '';
        infoEl.textContent = `${itemCount} item${itemCount === 1 ? '' : 's'} in "${payload.name}". ${capNote}`;
        overlay.classList.remove('hidden');
      });
    });

    cancelBtn.addEventListener('click', () => {
      overlay.classList.add('hidden');
      pendingSubmitPayload = null;
    });

    confirmBtn.addEventListener('click', async () => {
      if (!pendingSubmitPayload) return;
      const title = titleInput.value.trim();
      if (!title) { window.awWishlistIO.showToast('Give your wishlist a title.', true); return; }

      const auth = await getBungieAuthOrNull();
      if (!auth) { window.awWishlistIO.showToast('Sign in first to submit a wishlist.', true); return; }

      confirmBtn.disabled = true;
      confirmBtn.textContent = 'Submitting...';
      try {
        await postWishlistAction({
          action: 'submit',
          bungie_access_token: auth.access_token,
          title,
          game_mode: modeSelect.value,
          payload: pendingSubmitPayload,
        });
        overlay.classList.add('hidden');
        pendingSubmitPayload = null;
        window.awWishlistIO.showToast('Wishlist submitted!');
        refreshMine();
        refreshBrowseOrSearch();
      } catch (e) {
        const msg = e.message === 'submission_cap_reached'
          ? `Submission limit reached (${whoamiCache?.cap ?? 'max'}). Delete one to submit a new one.`
          : ('Submit failed: ' + e.message);
        window.awWishlistIO.showToast(msg, true);
      } finally {
        confirmBtn.disabled = false;
        confirmBtn.textContent = 'Submit';
      }
    });
  }

  // --- open/close + wiring ---

  function openDiscover() {
    const sheet = document.getElementById('discover-view');
    sheet.classList.add('open');
    sheet.setAttribute('aria-hidden', 'false');
    refreshCreatorsCache().then(refreshBrowseOrSearch);
    refreshMine();
  }

  function closeDiscover() {
    const sheet = document.getElementById('discover-view');
    sheet.classList.remove('open');
    sheet.setAttribute('aria-hidden', 'true');
  }

  function wireChips() {
    document.querySelectorAll('#discover-chips .aw-chip').forEach((chip) => {
      chip.addEventListener('click', () => {
        document.querySelectorAll('#discover-chips .aw-chip').forEach((c) => c.classList.remove('active'));
        chip.classList.add('active');
        currentFilter = chip.dataset.filter;
        refreshBrowseOrSearch();
      });
    });
  }

  function wireSearch() {
    const input = document.getElementById('discover-search');
    let debounce = null;
    input.addEventListener('input', () => {
      clearTimeout(debounce);
      debounce = setTimeout(() => {
        currentSearch = input.value.trim();
        refreshBrowseOrSearch();
      }, 300);
    });
  }

  document.addEventListener('DOMContentLoaded', () => {
    const navBtn = document.getElementById('nav-discover');
    if (navBtn) navBtn.addEventListener('click', openDiscover);
    document.getElementById('discover-close').addEventListener('click', closeDiscover);
    document.getElementById('discover-community-load-more').addEventListener('click', () => refreshCommunity(false));
    document.getElementById('discover-results-load-more').addEventListener('click', () => refreshResults(false));
    wireChips();
    wireSearch();
    wireSubmitFlow();
  });

  document.addEventListener('bungieAuthChanged', () => {
    const sheet = document.getElementById('discover-view');
    if (sheet && sheet.classList.contains('open')) refreshMine();
  });
})();
