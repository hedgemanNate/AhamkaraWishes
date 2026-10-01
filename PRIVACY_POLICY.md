# Privacy Policy — Ahamkara Wishes

_Last updated: October 1, 2026_

Ahamkara Wishes is a Chrome extension that helps Destiny 2 players build and manage wishlists for weapon rolls and armor sets. This policy explains what data the extension accesses, how it is used, and how it is stored.

---

## What data we access

### Bungie account data
When you sign in, the extension uses Bungie's official OAuth flow to authenticate your account. This grants read access to your Destiny 2 character inventory (weapons, armor, and associated metadata) so the extension can show you which wishlisted items you already own.

Specifically, the extension reads:
- Your Bungie display name and membership ID (used only to display your profile in the extension)
- Your Destiny 2 character inventory (item hashes and instance IDs, used only for wishlist matching)

The extension **never** reads your messages, friends list, financial information, or any data outside of Destiny 2 character inventory.

### Wishlist data
Wishlists you create are stored locally in your browser using Chrome's built-in `storage` API. If you choose to submit a wishlist to the community Discover feed, the title, mode (PvE/PvP/Mixed), and wishlist contents are stored on our server so other users can find and subscribe to them.

### Pages on supported Destiny websites
The extension adds features to two Destiny 2 websites. In both cases it only reads the page in your own browser tab; nothing from these pages is sent to us or to anyone else.

- **godroll.tv** — only if you allow access (the extension asks the first time you use its Godroll.tv button; you can revoke it at any time from Chrome's extension settings). On godroll.tv weapon pages the extension adds an "Ahamkara Wish" button. When you click it, the extension reads which weapon you are viewing, which perks you have selected, and whether the page's stats are set to PvE or PvP, and saves that roll to the wishlist you choose — locally, in your browser.
- **Destiny Item Manager (app.destinyitemmanager.com)** — the extension reads the item tiles on the page to highlight items that match your wishlists.

---

## How data is stored

| Data | Where | Controlled by |
|---|---|---|
| Bungie OAuth tokens | Your browser (chrome.storage.local) | You — cleared on sign-out |
| Your inventory snapshot | Your browser (chrome.storage.local) | You — cleared on sign-out or cache reset |
| Your wishlists | Your browser (chrome.storage.local) | You — deleted when you delete a wishlist |
| Community-submitted wishlists | Supabase (hosted in the US) | Us — deleted on request |

We do not sync your personal inventory data or OAuth tokens to any server. Rolls added from godroll.tv are stored exactly like any other wish: locally, in your browser.

---

## What we do not do

- We do not sell, rent, or share your data with third parties.
- We do not use your data for advertising.
- We do not collect analytics, crash reports, or behavioral telemetry.
- We do not access any Bungie account data beyond what is listed above.

---

## Third-party services

The extension communicates with two external services (godroll.tv and Destiny Item Manager are only read in your own tab, as described above — the extension sends them nothing):

- **Bungie.net API** — to authenticate your account and read your character inventory. Bungie's own privacy policy applies to that communication: https://www.bungie.net/en/Legal/PrivacyPolicy
- **Supabase** — to store and serve community wishlists. Supabase's privacy policy applies to data stored there: https://supabase.com/privacy

---

## Data retention and deletion

You can remove all locally stored data at any time by signing out of the extension or uninstalling it. Chrome will clear the extension's local storage when the extension is uninstalled.

To request deletion of any community wishlist you submitted, contact us at the email below.

---

## Children's privacy

This extension is not directed at children under 13. We do not knowingly collect data from children.

---

## Changes to this policy

If this policy changes materially, we will update the "Last updated" date above and, where possible, notify users via an extension update.

---

## Contact

Questions or deletion requests: **nate.hedgeman@gmail.com**
