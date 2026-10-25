# Chrome Web Store Listing -- Ahamkara Wishes

---

## Name

```
Ahamkara Wishes
```

---

## Summary
(132 characters max -- shown in search results)

```
Build weapon and armor wishlists for Destiny 2. See which god rolls you own, catch new drops, and share lists with the community.
```

---

## Description
(Full listing -- paste into the Chrome Web Store description field)

```
Ahamkara Wishes is a wishlist manager built for serious Destiny 2 players. Open the sidebar, build a wish, and never miss a god roll again.

WEAPONS
- Search any weapon by name and browse its full perk pool
- Pick perks column by column to define your ideal roll
- Color-code perk combos (up to four per wish) when only an exact pairing will do
- See stat changes live as you select perks, in PvE or PvP
- Save separate PvE and PvP wishes for the same weapon
- The extension checks your vault and characters and marks wishes you already own

ARMOR
- Search armor sets by name
- Choose an archetype (stat pairing) and its tertiary stat
- Optionally add a Spark (the Tier 5 tuned stat) when you're hunting the rarest rolls
- Save wishes for each class and slot
- Owned rolls are highlighted automatically

WHEN A WISH DROPS
- While the side panel is open, it checks your inventory and shows each wishlisted roll as it lands
- New matching rolls are locked in-game automatically so they can't be dismantled by accident
- Optionally have them moved to your vault for you (you choose right after signing in)

WISHLISTS
- Create and name as many wishlists as you want (PvE, PvP, season-specific, etc.)
- Export and import wishlists as files to back them up or share them
- Duplicate or merge wishlists with one click

DISCOVER
- Browse community and creator wishlists
- Save any of them to your own wishlists in one click
- Submit your own wishlist for the community to find

WORKS WITH GODROLL.TV
- Pick perks on any Godroll.tv weapon page and click "Ahamkara Wish"
- Choose which wishlist it goes into. No rebuilding the roll in the app
- PvE or PvP is picked up from the page's stats toggle

WORKS WITH DIM
- Opens as a sidebar alongside Destiny Item Manager
- Wishlist icons appear directly on items in DIM

No ads. No subscription. Yours forever.

Eyes Up Guardian...
```

---

## Category

```
Productivity
```
(Alternative: "Games" -- either is valid. Productivity tends to get broader visibility.)

---

## Language

```
English
```

---

## Single Purpose Statement
(Chrome Web Store review team may ask for this -- keep it one clear sentence)

```
This extension lets Destiny 2 players build, save, and track weapon and armor roll wishlists from a browser sidebar.
```

---

## Permission Justifications
(The Developer Dashboard asks for one per permission under "Privacy practices")

```
storage: Saves the user's wishlists, settings and Bungie sign-in session locally in the browser.
sidePanel: The extension's whole interface lives in the browser side panel.
identity: Signs the user in to Bungie.net with Bungie's official OAuth flow (chrome.identity.launchWebAuthFlow).
alarms: Periodically refreshes the Bungie sign-in token so the session doesn't expire while the panel is closed.
scripting: Adds the "Ahamkara Wish" button to godroll.tv pages, and only after the user has granted godroll.tv access.

Host permission www.bungie.net: Reads the signed-in player's Destiny 2 inventory and game data (manifest) to match it against their wishlists.
Host permission tqgewrylrjqfqzqlmmag.supabase.co: The extension's own backend -- community wishlists and the Bungie OAuth token exchange.
Optional host permission godroll.tv: Requested only when the user clicks the Godroll.tv button in the extension. Lets the extension add an "Ahamkara Wish" button to godroll.tv weapon pages that saves the selected perk roll to the user's wishlist. Nothing is sent to godroll.tv.
Content script on app.destinyitemmanager.com: Highlights items in Destiny Item Manager that match the user's wishlists. Reads the page only; sends nothing.

Remote code: No. All code ships in the package.
```

---

## Privacy Policy URL

Host PRIVACY_POLICY.md at a public URL and paste it here. Options:
- GitHub Pages (free, clean URL)
- Public GitHub Gist (paste the markdown, use the raw URL)
- Any static hosting

Placeholder:
```
https://your-domain.com/privacy
```

---

## Screenshots
(Required: at least 1. Size: 1280x800 or 640x400. PNG or JPEG.)

Recommended shots to capture:

1. **Weapon crafting view** -- weapon selected, perks picked, stat delta visible
2. **Weapon list view** -- several wishes showing owned/not-owned state
3. **Armor crafting view** -- archetype and tertiary selected
4. **Menu / Feed view** -- Feed log showing recent drops
5. **Discover view** -- community wishlists browseable
6. **godroll.tv integration** -- a godroll.tv weapon page with perks picked and the Ahamkara Wish dropdown open, the side panel's weapon list beside it

Tip: take screenshots with the sidebar open next to a real DIM session to show the integration in context. That screenshot will be the most compelling for Destiny players.

---

## Small Promotional Tile
(Optional but recommended: 440x280 PNG)

Suggested content:
- Extension name in the Destiny-style font if available
- One compelling screenshot inset
- Tagline: "Build the perfect roll. Never miss it."

---

## Pricing

```
One-time purchase
Suggested price: $2.99 -- $4.99
```

Set this in the Chrome Web Store Developer Dashboard under "Pricing and Distribution" after uploading the zip.

---

## Mature Content

```
No
```

---

## Distribution

```
All regions
```
