# Wishlist Engine (Owned Inventory Index) — v1.0

Summary
-------

This document describes the `OwnedInventoryIndex` service used to match Destiny 2 wishlist entries against a user's owned weapon instances. It is a Phase 1 implementation focusing on instance-level socket inspection via `ItemSockets` and `ItemInstances` returned by `Destiny2.GetProfile`.

Key Concepts
------------

- OwnedIndex: an in-memory structure with `byInstanceId: Map<string, OwnedWeapon>` and `byItemHash: Map<number, string[]>` for quick lookup.
- OwnedWeapon: { instanceId, itemHash, rolledPerkSet: Set<number>, location, characterId, isCrafted }
- WishlistEntry: annotated with `received` (boolean), `receivedInstances` (string[]), and `matchScore` (0..1).

Limitations
-----------

- Phase 1: crafted weapons may only expose currently equipped plugs in `reusablePlugHashes`. This can cause false negatives for crafted roll detection. Phase 2 will implement `plugSet` lookups using `DestinyPlugSetDefinition`.

Implementation Notes
--------------------

- File: `owned-inventory-index.js` — provides `buildOwnedIndex(profile)` and `matchWishlist(dimData, ownedIndex)`.
- Socket extraction: reads `profile.itemSockets.data[instanceId].sockets`, adding `plugHash` and all `reusablePlugHashes` into `rolledPerkSet`.
- Matching rules: wishlist `mustHave` must be a subset of `rolledPerkSet`; `matchScore` = (#desired ∩ rolled) / #desired.
- Filtering: Phase 1 uses raw sockets; Future work will consult manifest `DestinySocketCategoryDefinition` and plug item categories to exclude shaders/trackers.

Developer Guidelines
--------------------

- The module exports a simple cache so `OwnedIndex` is rebuilt only when the profile version changes.
- All functions include JSDoc; prefer small, testable functions.
- Add tests for `buildRolledPerkSet` using sample `ItemSockets` fixtures.

How to use
----------

1. Call `OwnedInventoryIndex.buildOwnedIndex(profileResponse)` with the `GetProfile` payload containing `ItemSockets` and `ItemInstances`.
2. Retrieve the resulting index and call `OwnedInventoryIndex.matchWishlist(dimData, ownedIndex)` to annotate wishlist entries.

Next Steps (Phase 2)
--------------------

- Add manifest-driven socket filtering.
- Implement `plugSet`/`DestinyPlugSetDefinition` expansion for crafted weapons.
- Wire `bungie-auth.js` to provide `fetchProfileWithComponents()` and call `buildOwnedIndex` during profile refresh.
