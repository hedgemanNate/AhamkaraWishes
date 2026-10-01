// Content script injected into godroll.tv. Adds an "Ahamkara Wish" split button
// to the weapon page's floating action bar, styled like the site's own
// "Add to Compare" pill: the main button adds the picked perks to the active
// wishlist, and the chevron opens a menu of the user's wishlists to choose from.
// The roll is saved by the service worker (godroll-add.js) straight into the
// chosen list — there is no detour through the craft view.
// Depends on godroll-roll-core.js (loaded first by the manifest).

(function () {
  const { readRoll, countSelected, readMode } = window.GodrollRoll;
  const WRAP_ID = 'ahamkara-wish-wrap';
  const BTN_ID = 'ahamkara-wish-btn';
  const TOAST_ID = 'ahamkara-wish-toast';

  const WISH_ICON = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polygon points="12 2 15 9 22 9.5 16.5 14.5 18 22 12 18 6 22 7.5 14.5 2 9.5 9 9"></polygon></svg>';
  const CHEVRON = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="6 9 12 15 18 9"></polyline></svg>';

  function toast(msg, isError) {
    document.getElementById(TOAST_ID)?.remove();
    const el = document.createElement('div');
    el.id = TOAST_ID;
    el.className = 'ahamkara-wish-toast' + (isError ? ' ahamkara-wish-toast-error' : '');
    el.textContent = msg;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 4000);
  }

  // The user's wishlists as [{ id, name, active }]. Falls back to the single
  // default list a fresh install starts with (the service worker creates it).
  function readLists() {
    return new Promise((resolve) => {
      try {
        chrome.storage.local.get(['dimData'], (res) => {
          const data = res && res.dimData;
          const entries = data && data.lists ? Object.entries(data.lists) : [];
          if (!entries.length) { resolve([{ id: 'default', name: 'Main Wishlist', active: true }]); return; }
          const activeId = data.lists[data.activeId] ? data.activeId : entries[0][0];
          resolve(entries.map(([id, l]) => ({ id, name: (l && l.name) || 'Wishlist', active: id === activeId })));
        });
      } catch (e) { resolve(null); }
    });
  }

  function closeMenu(wrap) {
    wrap.querySelector('.save-dropdown-menu')?.remove();
    const toggle = wrap.querySelector('.save-dropdown-toggle');
    toggle.classList.remove('active');
    toggle.setAttribute('aria-expanded', 'false');
  }

  async function addToList(wrap, listId) {
    const roll = readRoll(document, location.pathname);
    if (!roll) return;
    if (countSelected(roll) === 0) {
      toast('Select some perks first, then add them to a wishlist.', true);
      return;
    }

    const btn = wrap.querySelector('#' + BTN_ID);
    btn.disabled = true;
    const done = () => { btn.disabled = false; };
    try {
      chrome.runtime.sendMessage({
        type: 'ahamkara:add-godroll-roll',
        itemHash: roll.itemHash,
        columns: roll.columns,
        listId,
        mode: readMode(document)
      }, (res) => {
        done();
        if (chrome.runtime.lastError || !res) {
          toast('Could not reach Ahamkara Wishes — reload this page and try again.', true);
        } else if (!res.ok) {
          toast(res.error, true);
        } else {
          const mode = res.mode === 'pvp' ? 'PvP' : 'PvE';
          toast(res.status === 'duplicate'
            ? `Already in “${res.listName}” (${mode}).`
            : `Added ${res.name} to “${res.listName}” (${mode}).`);
        }
      });
    } catch (e) {
      // Thrown when the extension was reloaded/updated under an open tab.
      done();
      toast('Ahamkara Wishes was updated — reload this page and try again.', true);
    }
  }

  async function openMenu(wrap) {
    const lists = await readLists();
    if (!lists) { toast('Ahamkara Wishes was updated — reload this page and try again.', true); return; }
    closeMenu(wrap);

    const menu = document.createElement('div');
    menu.className = 'save-dropdown-menu ahamkara-wish-menu';
    lists.forEach((l) => {
      const item = document.createElement('button');
      item.type = 'button';
      item.className = 'save-dropdown-item';
      const label = document.createElement('span');
      label.textContent = l.name;
      item.appendChild(label);
      if (l.active) {
        const tag = document.createElement('span');
        tag.className = 'comparison-menu-count';
        tag.textContent = 'active';
        item.appendChild(tag);
      }
      item.addEventListener('click', (ev) => { ev.stopPropagation(); closeMenu(wrap); addToList(wrap, l.id); });
      menu.appendChild(item);
    });
    wrap.appendChild(menu);

    const toggle = wrap.querySelector('.save-dropdown-toggle');
    toggle.classList.add('active');
    toggle.setAttribute('aria-expanded', 'true');
  }

  function build() {
    const wrap = document.createElement('div');
    wrap.id = WRAP_ID;
    // The site's own classes — including weapon-compare-actions, because its
    // CSS for the joined pill (flat right edge on the main button, chevron
    // sizing and colours, menu width) is all scoped under that wrapper class.
    // They are styling hooks only; the site's behaviour is bound to its own elements.
    wrap.className = 'save-button-container has-dropdown weapon-compare-actions ahamkara-wish-actions';

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.id = BTN_ID;
    btn.className = 'floating-preview-button floating-compare-button ahamkara-wish-btn';
    btn.setAttribute('aria-label', 'Add selected perks to the active Ahamkara Wishes wishlist');
    const tip = document.createElement('span');
    tip.className = 'floating-button-tooltip';
    tip.textContent = 'Add these perks to your active wishlist';
    const icon = document.createElement('span');
    icon.className = 'preview-icon';
    icon.innerHTML = WISH_ICON; // static markup, no page or user data
    const label = document.createElement('span');
    label.className = 'preview-label';
    label.textContent = 'Ahamkara Wish';
    btn.append(tip, icon, label);
    btn.addEventListener('click', async (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      closeMenu(wrap);
      const lists = await readLists();
      const target = lists && (lists.find((l) => l.active) || lists[0]);
      if (!target) { toast('Ahamkara Wishes was updated — reload this page and try again.', true); return; }
      addToList(wrap, target.id);
    });

    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'save-dropdown-toggle';
    toggle.setAttribute('aria-label', 'Choose a wishlist');
    toggle.setAttribute('aria-expanded', 'false');
    toggle.innerHTML = CHEVRON; // static markup
    toggle.addEventListener('click', (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      if (wrap.querySelector('.save-dropdown-menu')) closeMenu(wrap);
      else openMenu(wrap);
    });

    wrap.append(btn, toggle);
    return wrap;
  }

  function inject() {
    const bar = document.querySelector('.floating-action-buttons');
    if (!bar || bar.querySelector('#' + WRAP_ID)) return;
    if (!/^\/\d+(\/|$)/.test(location.pathname)) return;

    const wrap = build();
    // Land before Save when the bar has the usual shape, else just append.
    const anchor = bar.querySelector('.weapon-compare-actions:not(.ahamkara-wish-actions)');
    if (anchor && anchor.nextSibling) bar.insertBefore(wrap, anchor.nextSibling);
    else bar.appendChild(wrap);
  }

  // Click outside or Escape closes an open menu, like the site's own dropdown.
  document.addEventListener('click', (ev) => {
    const wrap = document.getElementById(WRAP_ID);
    if (wrap && !wrap.contains(ev.target)) closeMenu(wrap);
  });
  document.addEventListener('keydown', (ev) => {
    if (ev.key !== 'Escape') return;
    const wrap = document.getElementById(WRAP_ID);
    if (wrap) closeMenu(wrap);
  });

  // The site is a client-rendered app: the bar appears after load and React can
  // re-render it (dropping our button) on navigation, so keep it present.
  // Coalesced to one check per frame — the observer fires constantly on this page.
  let scheduled = false;
  new MutationObserver(() => {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => { scheduled = false; inject(); });
  }).observe(document.body, { childList: true, subtree: true });
  inject();
})();
