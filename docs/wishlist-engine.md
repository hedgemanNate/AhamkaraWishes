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
- Matching rules (legacy / uncoloured wishes): wishlist `mustHave` must be a subset of `rolledPerkSet`; `matchScore` = (#desired ∩ rolled) / #desired.

Perk combos
-----------

A weapon wish can group its perks into up to four combos, authored in the craft
page by clicking a perk through the colour cycle (red → blue → green → orange →
selected → deselected). A column holds at most one perk per colour, so a colour
found in two or more columns names a **concrete perk tuple** rather than a set
of alternatives.

Matching, once a wish defines any combo:

- An owned roll matches if it satisfies **at least one whole combo** — every
  member colour present in its own socket — AND passes the plain any-of rule for
  every column no colour touches.
- A column holding a colour is governed by its combos alone. Plain-selected
  perks sitting beside a coloured one no longer open a match path of their own.
- A colour appearing in only one column is degenerate and ignored.
- Combos are independent: three combos may be covered by three different
  weapons, and no single roll is expected to carry them all. `matchScore` is the
  fraction of combos covered anywhere in the inventory.

Wishes with no combos keep the previous behaviour unchanged, including the
pooled columns-3-and-4 rule — that rule can wave through rolls satisfying no
combo, so it is skipped entirely once combos exist.

Fields written per wish: `comboMatches` ({colour: instanceIds}), `matchedCombos`
(colours with at least one owned match), alongside the existing `received`,
`receivedInstances`, `matchScore` and `matchedPerkHashes`.

Storage: `config.perkColumnsData[].colors` maps a colour to that column's perk
as `[baseHash, enhancedHash?]` — either form counts as a hit. `config.perkColumns[].color`
carries the same for card rendering. The colour signature is folded into the
wish's `raw` string so two wishes with identical perks but different combos are
not treated as duplicates by `saveItem()` or by cross-browser sync.
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
