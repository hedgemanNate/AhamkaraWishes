# Wishlist Manager

Overview

This document describes the Wishlist Manager UI and data model for Ahamkara Wishes. The wishlist manager is accessible under the Menu tab and provides dynamic tabs (one per user-created list), plus toolbar controls for Create / Merge / Delete / Import / Export.

Key points

- Storage key: `chrome.storage.local.dimData`
- Canonical structure:

```
{
  activeListId: "default",
  lists: {
    "default": {
      name: "Main Wishlist",
      items: {
        "123456": {
          static: { name, icon, type, hash, ... },
          wishes: [ { displayString, tags, mode, slot1, slot2, ... , _key, added } ]
        }
      }
    }
  }
}
```

Files

- `sidepanel.html` — contains the Wishlist Manager markup inside `.menu-panel`.
- `menu-sidepanel.css` — contains small scoped styles for the wishlist manager.
- `list-manager.js` — lightweight list manager that implements create/delete/merge/import/export.

Implementation notes

- Export: reuses `weaponManager.exportWeapons()` to export the active list as JSON. The exported JSON is a flat array of wishes.
- Import: `list-manager.js` reuses `weaponManager.saveWeaponWish(...)` to import wishes so deduplication and canonical key generation are shared with existing code.
- Merge: `list-manager.mergeLists(sourceId, destId)` temporarily sets the active list to the destination, then saves each wish through `weaponManager.saveWeaponWish`. The user is prompted to either MOVE (merge and delete source) or COPY (merge and keep source).

Migration

- There are legacy references to `dimData.activeId` in some files. `list-manager.js` reads/writes `dimData.activeListId`. Consider adding a short migration in `manager.js` to normalize keys on startup.

Testing checklist

- Create a new list via the toolbar — a new tab appears and becomes active.
- Save a wish via the existing Weapon UI — verify the wish appears under the active list.
- Export a list, inspect JSON, then import it into another list and verify dedupe.
- Merge two lists and validate final contents and deletion behaviour.

API (window.listManager)

- `loadLists()` — refresh UI tabs and list view
- `createList(name)` — create a named list and set active
- `deleteList(listId)` — delete a list
- `mergeLists(sourceId, destId)` — merge source into dest (with move/copy option)
- `setActiveList(listId)` — set active
- `exportList(listId)` — export specified list using weaponManager
- `importIntoList(listId)` — import JSON into target list (prompt-based)

