# Phase 10: Integration Testing & Polish - QA Checklist

**Document Version:** 1.0  
**Test Date:** _____________  
**Tester Name:** _____________  
**Chrome Version:** _____________  

---

## TABLE OF CONTENTS
1. [Test Case 1: Search & Selection](#test-case-1-search--selection)
2. [Test Case 2: Perk Selection](#test-case-2-perk-selection)
3. [Test Case 3: Save Wish](#test-case-3-save-wish)
4. [Test Case 4: List View Filtering](#test-case-4-list-view-filtering)
5. [Test Case 5: Delete Weapon](#test-case-5-delete-weapon)
6. [Test Case 6: Mode Switch](#test-case-6-mode-switch)
7. [Test Case 7: Pane Navigation](#test-case-7-pane-navigation)
8. [Test Case 8: Persistence](#test-case-8-persistence)
9. [Stat Calculation Verification](#stat-calculation-verification)
10. [UI Polish Checklist](#ui-polish-checklist)
11. [Error Scenarios](#error-scenarios)
12. [Performance Benchmarks](#performance-benchmarks)
13. [Code Quality Checks](#code-quality-checks)
14. [Troubleshooting Guide](#troubleshooting-guide)

---

## TEST CASE 1: SEARCH & SELECTION

**Objective:** Verify weapon search returns results quickly and weapon detail loads correctly.

**Preconditions:**
- Sidepanel is open
- On the "CRAFT" pane
- Search field is visible and empty
- Internet connection is active

### Step 1.1: Search Input
- [ ] Click on the weapon search input field
- [ ] Type "Ace of Spades" exactly (case-insensitive)
- **Expected Result:** 
  - Field accepts input without errors
  - Text appears in field as typed

### Step 1.2: Search Results Display
- [ ] Observe the results area below the search field
- **Expected Result:**
  - Results appear within 100ms of typing completion
  - "Ace of Spades" weapon appears in results list
  - Result shows weapon name clearly
  - Result shows weapon icon thumbnail

### Step 1.3: Result Details Verification
- [ ] Look at the Ace of Spades result entry
- **Expected Result:**
  - Weapon name: "Ace of Spades" (exact match)
  - Icon displays without broken image
  - Icon has appropriate color (golden/orange-ish for Exotic)
  - Result is clickable (cursor changes to pointer on hover)

### Step 1.4: Click Result
- [ ] Click on the "Ace of Spades" result
- **Expected Result:**
  - Result list closes/hides
  - Search field still shows "Ace of Spades"
  - Weapon detail pane appears below search

### Step 1.5: Weapon Detail Load
- [ ] Wait 1 second after clicking
- [ ] Examine the weapon detail section
- **Expected Result:**
  - Weapon name displays as "Ace of Spades"
  - Base stats table appears with rows: Power, Damage, Stability, Range, Handling, Reload Speed
  - All stats have numeric values (not blank or "N/A")
  - Stat values are reasonable (e.g., 80-150 range for most stats)

### Step 1.6: Perk Slots Populate
- [ ] Scroll down in weapon detail if needed
- [ ] Count the number of perk slot sections
- **Expected Result:**
  - At least 3 perk slot sections visible (e.g., "Column 1 Perks", "Column 2 Perks", etc.)
  - Each slot has a label/title
  - Each slot shows 2-4 perk buttons
  - Perk buttons have names and icons

### Step 1.7: Save Button State
- [ ] Look for the "SAVE WISH" button
- **Expected Result:**
  - Button is visible and enabled (not grayed out)
  - Button is blue (primary color)
  - Text reads "SAVE WISH" exactly

**Common Failure Points:**
- Search takes >100ms to display results (network latency)
- Icon doesn't load (broken image URL)
- Weapon detail doesn't load or shows wrong weapon
- Perk slots are empty or missing
- Save button is disabled

**Mark Test:** ✅ PASS / ❌ FAIL / ⚠️ PARTIAL

---

## TEST CASE 2: PERK SELECTION

**Objective:** Verify perk selection, stat delta calculation, color coding, and deselection work correctly.

**Preconditions:**
- Weapon (e.g., "Ace of Spades") is loaded from Test Case 1
- Perk slots are visible
- Stats are displaying base values (all deltas should be 0)

### Step 2.1: Select First Perk
- [ ] Locate the first perk slot (e.g., "Column 1 Perks")
- [ ] Click on the first available perk button
- **Expected Result:**
  - Button background changes to blue (selected state)
  - Button remains clickable
  - No page errors

### Step 2.2: Verify Selected State Styling
- [ ] Observe the selected perk button
- **Expected Result:**
  - Button has a distinct blue background (dark/bright as per design)
  - Button text is readable (good contrast)
  - Button has a subtle outline or shadow (visual depth)

### Step 2.3: Check Stat Deltas Appear
- [ ] Look at the stats table
- [ ] Compare with step 1.5 stats
- **Expected Result:**
  - Stats table now shows delta columns (e.g., "Base" | "Delta" | "Total")
  - At least one stat has a delta value (not 0)
  - Deltas appear to the right of base values
  - Delta is a numeric value with +/- sign (e.g., "+7" or "-2")

### Step 2.4: Verify Stat Delta Accuracy (Example: Arrowhead Brake)
- [ ] If available, select "Arrowhead Brake" perk (note: actual perk name may vary)
- [ ] Look up expected stats for this perk (from Destiny database or manifest)
  - Example: Arrowhead Brake → +15 recoilDirection, +7 handling
- **Expected Result:**
  - Recoil/Direction stat shows delta of +15
  - Handling stat shows delta of +7
  - Other stats show delta of 0 or no change
  - Values match manifest data exactly

### Step 2.5: Verify Color Coding
- [ ] Observe delta values in stats table
- **Expected Result:**
  - Positive deltas (+) are displayed in GREEN color
  - Negative deltas (-) are displayed in RED color
  - Zero deltas (0) are displayed in GRAY color
  - Colors are consistent across all stat rows

### Step 2.6: Verify Final Stats Calculation
- [ ] Take the base value of one stat (e.g., Handling = 50)
- [ ] Take the delta value shown (e.g., +7)
- [ ] Calculate: 50 + 7 = 57
- [ ] Look at the "Total" column for that stat
- **Expected Result:**
  - Total value shows 57 (exactly)
  - All visible stats follow formula: Total = Base + Delta
  - No math errors across all rows

### Step 2.7: Select Second Perk
- [ ] Click on a perk from a different slot (e.g., Column 2)
- **Expected Result:**
  - Second perk button shows blue selected state
  - First perk button remains blue (both selected)
  - Stats update with combined deltas
  - If Perk B has Reload +18, that delta adds to Reload total

### Step 2.8: Verify Multi-Perk Delta Sum
- [ ] Select Perk A with Reload +15 and Perk B with Reload +18
- [ ] Check Reload stat delta
- **Expected Result:**
  - Reload delta shows +33 (15 + 18 combined)
  - All other stats include both perks' contributions
  - No stat calculation errors

### Step 2.9: Deselect Perk
- [ ] Click on the same blue perk button again (toggle off)
- **Expected Result:**
  - Button background returns to default color (not blue)
  - Button appears unselected/inactive
  - Stats update immediately

### Step 2.10: Verify Stats Recalculate After Deselect
- [ ] After deselecting the perk from step 2.9
- [ ] Check the stats that were affected by that perk
- **Expected Result:**
  - Deltas recalculate correctly
  - Stat shows original delta from remaining selected perks
  - Or shows 0 if all perks deselected
  - No console errors

**Common Failure Points:**
- Selected button styling doesn't change
- Stat deltas don't update when perk selected/deselected
- Color coding is wrong (red/green reversed)
- Math calculation errors in delta sum
- Multiple-perk math doesn't combine correctly
- Button doesn't toggle off on second click

**Mark Test:** ✅ PASS / ❌ FAIL / ⚠️ PARTIAL

---

## TEST CASE 3: SAVE WISH

**Objective:** Verify weapon + perk combo saves correctly, toast shows confirmation, and list updates.

**Preconditions:**
- Weapon is loaded (from Test Case 1 or 2)
- At least 3 perks are selected from different slots
- Example combo: Arrowhead Brake + Ricochet Rounds + Rampage
- Stats are displaying correctly

### Step 3.1: Prepare Weapon Combo
- [ ] Confirm you have selected exactly 3 perks from 3 different columns
- [ ] Note the weapon name and selected perk names
- [ ] Verify stats show correct deltas for all selected perks
- **Expected Result:**
  - All 3 perk buttons show blue selected state
  - Stats update reflects all 3 perks
  - No error messages appear

### Step 3.2: Click SAVE WISH Button
- [ ] Locate the blue "SAVE WISH" button
- [ ] Click it once
- **Expected Result:**
  - Button is clickable
  - Page doesn't crash or refresh
  - A modal/dialog appears (likely a tag input dialog)

### Step 3.3: Enter Tags
- [ ] In the modal that appears, look for an input field for tags/labels
- [ ] Type in tags: "pvp,favorite"
- **Expected Result:**
  - Input field accepts text
  - Text appears as typed
  - Tags separated by commas (no spaces)

### Step 3.4: Confirm Save
- [ ] Look for a "Confirm", "Save", or "OK" button
- [ ] Click it
- **Expected Result:**
  - Modal closes
  - Page returns to craft pane view
  - No errors appear

### Step 3.5: Toast Notification Appears
- [ ] Watch the bottom-right corner of the sidepanel (or notification area)
- **Expected Result:**
  - A toast notification appears
  - Toast shows checkmark icon (✅)
  - Toast text starts with "Saved:" and includes the weapon name
  - Example: "✅ Saved: Ace of Spades | Arrowhead Brake + Ricochet Rounds + Rampage"
  - Toast is visible for 2-3 seconds then auto-dismisses
  - Toast doesn't block other UI elements

### Step 3.6: Verify Stats Reset
- [ ] After toast dismisses, look at the stats table
- **Expected Result:**
  - All stat deltas show 0 or gray color
  - All perk buttons are no longer blue (deselected)
  - Stats reset to base values only
  - Search field may still show weapon name (acceptable)

### Step 3.7: Switch to List Pane
- [ ] Click the "LIST" navigation button
- [ ] Wait 1 second for pane transition
- **Expected Result:**
  - Smooth animation slides view to the right/left
  - List pane appears showing weapons
  - No crashes or blank screens

### Step 3.8: Verify New Weapon in List
- [ ] Look at the weapons list
- [ ] Search for the weapon you just saved (e.g., "Ace of Spades")
- **Expected Result:**
  - The saved weapon appears in the list
  - Weapon shows correct name: "Ace of Spades"
  - Weapon shows correct perk names: "Arrowhead Brake", "Ricochet Rounds", "Rampage"
  - Weapon shows tags you entered: "pvp, favorite"
  - Weapon shows a mode badge ("PVE MODE" default, or "PVP MODE" if PvP was selected)

### Step 3.9: Verify Weapon Card Details
- [ ] Examine the weapon card more closely
- **Expected Result:**
  - Weapon icon displays
  - Weapon name and type are readable
  - All perk names are visible (may truncate with "..." if long)
  - Mode badge is clearly visible
  - Delete button is clickable and visible

**Common Failure Points:**
- Toast doesn't appear or auto-dismiss
- Weapon doesn't appear in list after save
- Perk names are wrong in list view
- Stats don't reset after save
- Tags don't save or display
- Mode badge missing from list card

**Mark Test:** ✅ PASS / ❌ FAIL / ⚠️ PARTIAL

---

## TEST CASE 4: LIST VIEW FILTERING

**Objective:** Verify all filtering options work independently and in combination.

**Preconditions:**
- In LIST pane (from Test Case 3 Step 3.7)
- At least 5 weapons are saved (with varied weapon types, damage types)
- Filtering controls are visible

### Step 4.1: Verify Filters Exist
- [ ] Look at the list pane header
- **Expected Result:**
  - Filter by weapon type dropdown exists (e.g., "Weapon Type")
  - Filter by damage type dropdown exists (e.g., "Damage Type")
  - Search text input exists
  - "CLEAR" button exists

### Step 4.2: Filter by Weapon Type
- [ ] Click on "Weapon Type" dropdown
- [ ] Select "Auto Rifle" from the list
- **Expected Result:**
  - Dropdown closes
  - Filter visibly activates
  - Weapons list updates
  - Only Auto Rifles remain visible
  - Other weapon types disappear

### Step 4.3: Verify Weapon Type Filter Accuracy
- [ ] Count visible weapons
- [ ] Look at each weapon's type/category
- **Expected Result:**
  - All visible weapons are clearly Auto Rifles
  - No Hand Cannons, Sniper Rifles, etc. visible
  - If no Auto Rifles exist, show "No weapons match" message

### Step 4.4: Filter by Damage Type
- [ ] Click on "Damage Type" dropdown
- [ ] While weapon type = "Auto Rifle", select "Solar"
- **Expected Result:**
  - Filter combines with previous filter
  - Weapons list shows only Auto Rifles that deal Solar damage
  - Other damage types (Arc, Void) disappear

### Step 4.5: Verify Combined Filters Work
- [ ] Observe the filtered list
- **Expected Result:**
  - All visible weapons are Auto Rifles AND Solar damage
  - No Void or Arc Auto Rifles visible
  - List updates instantly (no loading delay)

### Step 4.6: Search Text Filter
- [ ] Click the search text input at the top
- [ ] Type "Ace"
- **Expected Result:**
  - Search text appears in field
  - Weapons list filters in real-time
  - Only weapons with "Ace" in the name show

### Step 4.7: Verify Text Filter Precision
- [ ] Check all visible weapons
- **Expected Result:**
  - All visible weapons contain "Ace" in name (e.g., "Ace of Spades")
  - Partial matches count (e.g., "Peace" would match "Ace")
  - Case-insensitive search works

### Step 4.8: Test Filter Combinations
- [ ] Current state: Weapon Type = "Auto Rifle", Damage = "Solar", Search = "Ace"
- [ ] Verify weapons matching ALL THREE filters show
- **Expected Result:**
  - Only weapons that are Auto Rifles AND Solar AND contain "Ace" in name
  - Very narrow result set (may be 0-2 weapons)
  - No false positives

### Step 4.9: Clear Filters
- [ ] Click the "CLEAR" button
- **Expected Result:**
  - All dropdowns reset to neutral/empty state
  - Search field clears
  - Weapons list refreshes to show all weapons
  - Original full list reappears

### Step 4.10: Verify Complete Reset
- [ ] Check that all filters are truly cleared
- **Expected Result:**
  - No weapon type is selected
  - No damage type is selected
  - Search field is empty
  - Full list displays (all saved weapons visible)

**Common Failure Points:**
- Filters don't combine correctly (AND vs OR logic)
- List doesn't update after filter selection
- Clear button doesn't reset all filters
- Search is case-sensitive when it shouldn't be
- Filter dropdown doesn't show all options

**Mark Test:** ✅ PASS / ❌ FAIL / ⚠️ PARTIAL

---

## TEST CASE 5: DELETE WEAPON

**Objective:** Verify weapon deletion with confirmation and persistence.

**Preconditions:**
- In LIST pane with weapons visible
- At least 2 weapons are saved
- Test Case 3 weapon is still visible in list

### Step 5.1: Locate Delete Button
- [ ] Find the weapon card you saved in Test Case 3 (e.g., Ace of Spades)
- [ ] Look for a delete button/icon on the card (usually trash icon or "Delete")
- **Expected Result:**
  - Delete button is visible on the weapon card
  - Button is clearly clickable (color contrast, cursor change)
  - Delete button doesn't accidentally trigger on hover

### Step 5.2: Click Delete
- [ ] Click the delete button on the weapon card
- **Expected Result:**
  - A confirmation dialog appears
  - Dialog asks to confirm deletion (text like "Are you sure?" or "Delete this wish?")
  - Dialog has "Cancel" and "Delete"/"Confirm" buttons

### Step 5.3: Confirm Deletion
- [ ] Click the "Delete" or "Confirm" button in the dialog
- **Expected Result:**
  - Dialog closes
  - Toast notification appears

### Step 5.4: Toast Notification Verification
- [ ] Check the toast in the bottom-right
- **Expected Result:**
  - Toast shows trash/delete icon (🗑️)
  - Toast text reads: "🗑️ Deleted weapon wish" or similar
  - Toast is visible for 2-3 seconds
  - Toast doesn't block interaction with remaining weapons

### Step 5.5: Verify Card Removed from List
- [ ] After toast dismisses, look at the weapons list
- **Expected Result:**
  - The deleted weapon card is no longer visible
  - Other weapons remain in list
  - List count decreased by 1 (visible if count is shown)

### Step 5.6: Verify Deletion Persists
- [ ] Close the sidepanel completely (close extension popup in Chrome)
- [ ] Wait 2 seconds
- [ ] Click extension icon to reopen sidepanel
- [ ] Navigate to LIST pane if not already there
- **Expected Result:**
  - Deleted weapon does NOT reappear in list
  - All other weapons still visible with correct data
  - Deletion data persisted to Chrome storage

### Step 5.7: Test Delete Cancellation (Optional)
- [ ] Click delete on another weapon
- [ ] In confirmation dialog, click "Cancel"
- **Expected Result:**
  - Dialog closes
  - No toast appears
  - Weapon remains in list (not deleted)

**Common Failure Points:**
- Delete button doesn't show or is hard to find
- Confirmation dialog doesn't appear
- Weapon deleted without confirmation
- Deleted weapon reappears on sidepanel reload
- Wrong weapon gets deleted

**Mark Test:** ✅ PASS / ❌ FAIL / ⚠️ PARTIAL

---

## TEST CASE 6: MODE SWITCH

**Objective:** Verify PvE/PvP mode selection persists to saved weapons.

**Preconditions:**
- In CRAFT pane
- Weapon is loaded (or can load a new one)
- Mode toggle/buttons are visible

### Step 6.1: Verify Mode Buttons Exist
- [ ] Look for "PvE" and "PvP" buttons (usually near top of CRAFT pane)
- **Expected Result:**
  - Both buttons are visible
  - One button shows "active" state (different color, e.g., gold/orange)
  - Default active button should be "PvE"

### Step 6.2: Check Default Mode
- [ ] Observe which mode button is highlighted/active
- **Expected Result:**
  - "PvE" mode is active by default (gold/highlighted background)
  - "PvP" mode is inactive (default/gray background)

### Step 6.3: Switch to PvP Mode
- [ ] Click the "PvP" button
- **Expected Result:**
  - "PvP" button background changes to gold/highlighted (active state)
  - "PvE" button background returns to default/gray (inactive)
  - No page errors or flicker

### Step 6.4: Load Weapon in PvP Mode
- [ ] Search for and load a weapon (e.g., "Jade Rabbit")
- [ ] Select perks (e.g., Full Auto + Zen Moment)
- [ ] Click "SAVE WISH"
- [ ] Confirm save with tags
- **Expected Result:**
  - Weapon saves without error
  - Toast appears
  - Stats reset

### Step 6.5: Check Mode Badge in List
- [ ] Click "LIST" button
- [ ] Find the weapon you just saved in PvP mode
- **Expected Result:**
  - Weapon card displays "PVP MODE" badge (or "PvP Mode")
  - Badge shows in clear, distinct color/styling
  - Badge location is consistent with other cards

### Step 6.6: Switch Back to PvE
- [ ] Click "CRAFT" button
- [ ] Click "PvE" button to switch back
- **Expected Result:**
  - "PvE" button becomes active again (gold)
  - "PvP" button becomes inactive

### Step 6.7: Save Same Weapon in PvE Mode
- [ ] Clear search or search for same weapon (Jade Rabbit)
- [ ] Select different perks (e.g., Firefly + Outlaw)
- [ ] Click "SAVE WISH"
- [ ] Confirm save
- **Expected Result:**
  - Weapon saves successfully
  - Toast appears
  - No conflicts or overwrite messages

### Step 6.8: Verify Two Mode Versions in List
- [ ] Click "LIST"
- [ ] Look for saved weapon (Jade Rabbit)
- **Expected Result:**
  - Two weapon cards for "Jade Rabbit" exist
  - One card shows "PVE MODE" badge
  - One card shows "PVP MODE" badge
  - Both cards show their respective perks (different perk combos)
  - Both cards are independent (deleting one doesn't affect the other)

### Step 6.9: Test Mode-Based Filtering (Optional)
- [ ] If a "Mode" filter exists, filter by "PvE"
- **Expected Result:**
  - Only weapons with "PVE MODE" badge show
  - PvP weapons are hidden
  - Filter can be cleared to show both again

**Common Failure Points:**
- Mode button doesn't visually change when clicked
- Saved weapon doesn't show correct mode badge
- Weapon overwrites when saving in different mode
- Mode badge missing or incorrect
- Can't save same weapon with different modes

**Mark Test:** ✅ PASS / ❌ FAIL / ⚠️ PARTIAL

---

## TEST CASE 7: PANE NAVIGATION

**Objective:** Verify smooth transitions between CRAFT and LIST panes.

**Preconditions:**
- Sidepanel is open
- At least 1 weapon is saved for list view

### Step 7.1: Start in CRAFT Pane
- [ ] Observe the sidepanel layout
- **Expected Result:**
  - CRAFT pane is currently active/visible
  - LIST pane is hidden
  - Navigation buttons are visible at top ("CRAFT", "LIST", or similar)

### Step 7.2: Verify Navigation Button States
- [ ] Look at "CRAFT" and "LIST" buttons
- **Expected Result:**
  - "CRAFT" button is highlighted/active (different styling)
  - "LIST" button is inactive/normal
  - Both buttons are clickable

### Step 7.3: Click LIST Navigation
- [ ] Click the "LIST" button
- **Expected Result:**
  - Smooth slide/transition animation occurs
  - CRAFT pane slides out
  - LIST pane slides in from the right/left
  - Animation completes within 300-500ms
  - No flicker or visual glitches

### Step 7.4: Verify LIST Pane Active
- [ ] After animation completes, observe the pane
- **Expected Result:**
  - LIST pane is now fully visible
  - CRAFT pane is hidden
  - "LIST" button is now highlighted/active
  - "CRAFT" button is now inactive
  - Weapons list is visible and interactive

### Step 7.5: Click CRAFT Navigation
- [ ] Click the "CRAFT" button
- **Expected Result:**
  - Smooth slide/transition animation occurs
  - LIST pane slides out
  - CRAFT pane slides back in from same direction
  - Animation is smooth and comparable to previous animation
  - No flickering

### Step 7.6: Verify CRAFT Pane Restored
- [ ] After animation completes
- **Expected Result:**
  - CRAFT pane is visible again
  - "CRAFT" button is highlighted again
  - "LIST" button is inactive
  - Previous search/weapon may still be loaded (acceptable)

### Step 7.7: Rapid Navigation Test (Stress Test)
- [ ] Click "LIST" → "CRAFT" → "LIST" → "CRAFT" rapidly (5 times quickly)
- **Expected Result:**
  - App handles rapid clicking smoothly
  - No broken animations
  - No crashes or console errors
  - Most recent click wins (pane matches active button)

### Step 7.8: Navigation from Detailed View
- [ ] Load a weapon in CRAFT pane
- [ ] Click "LIST"
- [ ] Click back to "CRAFT"
- **Expected Result:**
  - Weapon detail is still loaded (previous state preserved)
  - Stats/perks are as you left them (if continuing from same session)
  - Or weapon detail is cleared (acceptable for new session)

**Common Failure Points:**
- Animation is janky or slow (>500ms)
- Pane content doesn't update with button state
- Navigation freezes app
- Active button state doesn't update
- Can't click button multiple times in succession

**Mark Test:** ✅ PASS / ❌ FAIL / ⚠️ PARTIAL

---

## TEST CASE 8: PERSISTENCE

**Objective:** Verify saved weapons persist across sidepanel sessions.

**Preconditions:**
- Multiple weapons saved in list (at least 3 weapons)
- Varied perk combinations saved
- Mix of PvE and PvP weapons (from Test Case 6) if applicable

### Step 8.1: Save Test Weapons
- [ ] In CRAFT pane, save 3 different weapons with distinct perk combos
- [ ] Examples:
  - Weapon A: "Trinity Ghoul" with Perks: Lightning Rod + Energy Array
  - Weapon B: "Ace of Spades" with Perks: Arrowhead Brake + Ricochet Rounds + Rampage
  - Weapon C: "Rat King" with Perks: Zen Moment + Drop Mag
- [ ] Verify each saves successfully (toast appears)
- **Expected Result:**
  - All 3 weapons save without errors
  - List view shows all 3 weapons

### Step 8.2: Note Weapon Details
- [ ] In LIST view, note the exact names, perks, and mode badges for each weapon
- [ ] Example snapshot:
  - Trinity Ghoul | Lightning Rod + Energy Array | PVE MODE
  - Ace of Spades | Arrowhead Brake + Ricochet Rounds + Rampage | PVE MODE
  - Rat King | Zen Moment + Drop Mag | PVE MODE
- **Expected Result:**
  - All details are clearly visible
  - No data truncation or missing perk names

### Step 8.3: Close Sidepanel Completely
- [ ] Click the AhamkaraWishes extension icon to close the sidepanel
- [ ] Observe sidepanel closes
- **Expected Result:**
  - Sidepanel disappears completely
  - No residual UI elements remain
  - Chrome appears normal

### Step 8.4: Wait for Storage Sync
- [ ] Wait 2-3 seconds
- [ ] This allows Chrome Local Storage to fully flush
- **Expected Result:**
  - No errors in Chrome console (open DevTools to verify)

### Step 8.5: Reopen Sidepanel
- [ ] Click the AhamkaraWishes extension icon again
- [ ] Sidepanel reopens
- **Expected Result:**
  - Sidepanel appears without errors
  - No loading spinner or blank screen
  - UI renders normally

### Step 8.6: Navigate to LIST View
- [ ] If not already in LIST pane, click "LIST" button
- [ ] Wait 1-2 seconds for list to populate
- **Expected Result:**
  - List loads without errors
  - No spinner or "Loading..." appears (or if it does, dismisses within 2 seconds)

### Step 8.7: Verify All Weapons Persisted
- [ ] Check the list for all 3 weapons saved in Step 8.1
- **Expected Result:**
  - "Trinity Ghoul" is visible
  - "Ace of Spades" is visible
  - "Rat King" is visible
  - All 3 weapons present (count = 3 if starting fresh)

### Step 8.8: Verify Weapon Details Intact
- [ ] For each weapon, compare with snapshot from Step 8.2
- **Expected Result:**
  - Trinity Ghoul shows: "Lightning Rod", "Energy Array", "PVE MODE"
  - Ace of Spades shows: "Arrowhead Brake", "Ricochet Rounds", "Rampage", "PVE MODE"
  - Rat King shows: "Zen Moment", "Drop Mag", "PVE MODE"
  - Order of perks is preserved
  - No data corruption or truncation

### Step 8.9: Check Tags Persisted (If Applicable)
- [ ] If you saved weapons with tags in previous tests, verify tags still show
- **Expected Result:**
  - Tags display correctly on weapon cards
  - Tags are readable
  - No tag formatting errors

### Step 8.10: Verify Independence of Weapons
- [ ] Delete one weapon from TEST (e.g., Trinity Ghoul)
- [ ] Other weapons remain unaffected
- [ ] Close and reopen sidepanel again
- **Expected Result:**
  - Trinity Ghoul is gone after close/reopen
  - Other 2 weapons still present
  - Persistence works both ways (add and delete)

**Common Failure Points:**
- Weapons don't appear after reopen
- Perk names are corrupted or wrong
- Weapons appear but in wrong order
- Tags are lost
- Mode badges are wrong
- Chrome storage errors in console

**Mark Test:** ✅ PASS / ❌ FAIL / ⚠️ PARTIAL

---

## STAT CALCULATION VERIFICATION

**Objective:** Validate stat mathematics match manifest data and perk combinations.

**Preconditions:**
- Weapon loaded in CRAFT pane
- At least one perk selected
- Stats table visible

### Verification 8.1: Single Perk Math
**Test Data:** Select "Arrowhead Brake" perk  
**Expected Manifest Data:**
- Recoil Direction: +15
- Handling: +7

**Test Steps:**
- [ ] Select "Arrowhead Brake" perk
- [ ] Check stats table for Recoil Direction delta
  - Expected: +15 (shown in green)
- [ ] Check Handling delta
  - Expected: +7 (shown in green)
- [ ] Verify no other stats changed (all 0 or gray)

**Pass Criteria:** ✅ Both stat deltas match manifest exactly

---

### Verification 8.2: Two-Perk Combination Math
**Test Data:** Select "Rampage" + "Ricochet Rounds"

**Expected Manifest Data:**
- Rampage → Reload: +15
- Ricochet Rounds → Reload: +18
- Combined Reload delta: +33 (15 + 18)

**Test Steps:**
- [ ] Select both perks from different columns
- [ ] Observe Reload stat delta
- [ ] Verify calculation: shows +33
- [ ] Check that other stats show appropriate combinations

**Pass Criteria:** ✅ Reload delta = +33, other stats correct

---

### Verification 8.3: Negative Delta Verification
**Test Data:** Select a perk with a negative stat (if available)

**Example Perks (if they exist in manifest):**
- "Feeding Frenzy" may have -5 Range
- "Rampage" may have -10 Stability

**Test Steps:**
- [ ] Select a perk known to reduce a stat
- [ ] Find that stat in stats table
- [ ] Verify delta shows as negative (e.g., "-10")
- [ ] Verify color is RED (not green or gray)

**Pass Criteria:** ✅ Negative values shown in red, math correct

---

### Verification 8.4: Zero Delta Recognition
**Test Data:** Any perk selected

**Test Steps:**
- [ ] Select any perk (e.g., "Arrowhead Brake")
- [ ] Look at stats NOT affected by this perk (e.g., Zoom might be unaffected)
- [ ] Verify unaffected stats show delta = 0
- [ ] Verify color is GRAY (not green or red)

**Pass Criteria:** ✅ Zero deltas shown in gray

---

### Verification 8.5: Multi-Column Perk Sum
**Test Data:** Select 3 perks from 3 different columns

**Steps:**
- [ ] Select one perk from Column 1, one from Column 2, one from Column 3
- [ ] Manually add up the deltas for one stat (e.g., Stability)
  - Perk 1 Stability delta: +5
  - Perk 2 Stability delta: +3
  - Perk 3 Stability delta: -2
  - Expected total: +5 +3 -2 = +6
- [ ] Verify stats table shows +6 for Stability

**Pass Criteria:** ✅ Multi-perk math correct across all stats

---

## UI POLISH CHECKLIST

### Visual Alignment & Readability

#### Stats Table Layout
- [ ] Numbers in each stat column are right-aligned (not left-aligned)
- [ ] Columns have clear headers (Base | Delta | Total)
- [ ] Header row is distinguishable (darker background or bold text)
- [ ] Stat rows alternate colors slightly for easy scanning (optional)
- [ ] Numbers are easy to read (good contrast, readable font size)
- [ ] Decimal points or rounding is consistent (no random precision)

#### Perk Button Layout
- [ ] Perk buttons are not cramped (good padding around text)
- [ ] Button text is fully visible (not truncated unless very long names)
- [ ] Button icons display without distortion
- [ ] Icon + text alignment is clean (icon left, text right, or centered)
- [ ] Buttons have proper spacing between them (not touching)
- [ ] Buttons are large enough to click comfortably (min 40px height)

#### Color Scheme
- [ ] Background colors follow dark theme (dark gray/black)
- [ ] Text colors have good contrast on backgrounds (WCAG AA minimum)
- [ ] Primary buttons are blue (or design color) and clearly clickable
- [ ] Selected perk buttons are visually distinct (blue or highlighted)
- [ ] Inactive buttons are grayed out (not full opacity)
- [ ] Delta colors are consistent: Green (+), Red (-), Gray (0)

### Empty States

#### No Weapons Saved Message
- [ ] When no weapons in list, message displays prominently
- [ ] Message text is clear and helpful (e.g., "No weapons saved yet. Start by searching and saving a new wish!")
- [ ] Message is centered on the page
- [ ] Text color is visible (not too light or too dark)
- [ ] Message doesn't block any functionality

#### No Search Results
- [ ] When search has no matches, message appears (e.g., "No weapons found")
- [ ] Message is clear and suggests next action (e.g., "Try different search term")
- [ ] Message doesn't crash the UI

### Toast Notifications

#### Appearance
- [ ] Toast appears in bottom-right corner of sidepanel
- [ ] Toast has icon (✅ checkmark, 🗑️ trash, ⚠️ warning) appropriate to message
- [ ] Toast text is readable on background
- [ ] Toast has subtle shadow or border for visibility

#### Timing
- [ ] Toast shows for 2-3 seconds
- [ ] Toast auto-dismisses without user clicking
- [ ] Toast doesn't disappear too quickly (<1 sec) or too slow (>5 sec)

#### Non-Blocking
- [ ] Toast doesn't cover buttons or important UI elements
- [ ] User can interact with UI while toast is visible
- [ ] If multiple toasts appear, they stack or queue properly

### Loading Feedback

#### Weapon List Load Time
- [ ] Weapon list loads within 500ms normally
- [ ] If load takes >1 second:
  - [ ] Loading spinner appears
  - OR "Loading..." text appears
  - [ ] Spinner/message is centered
  - [ ] Spinner animation is smooth (not janky)

#### Search Results Load
- [ ] Manifest search completes <100ms
- [ ] Results appear instantly (no loading spinner needed normally)
- [ ] If network is slow, spinner appears after 300ms delay

### Scrollbar Styling

#### Dark Theme Scrollbars
- [ ] Scrollbars use dark theme colors (dark gray or transparent)
- [ ] Scrollbars are not too thick (8-12px width is good)
- [ ] Scrollbars don't interfere with content
- [ ] Hover state on scrollbar shows subtle highlight
- [ ] Scrollbar tracks are barely visible (minimal contrast)

### Layout Responsiveness

#### Sidepanel Width (350px reference)
- [ ] All text is readable at 350px width (no horizontal scroll needed)
- [ ] Buttons stack vertically if needed (no cramping)
- [ ] Tables don't overflow (columns scale or truncate gracefully)
- [ ] Icons scale down properly (no distortion)

#### Mobile/Narrow Widths
- [ ] Test at 300px width (extreme case)
- [ ] Test at 480px width (typical mobile)
- [ ] UI doesn't break, elements remain accessible
- [ ] Typography remains readable
- [ ] Buttons remain clickable (touch targets 44px+ height)

#### Overflow Handling
- [ ] Long weapon names don't break buttons (truncate with "...")
- [ ] Long perk names are readable (full name visible on hover tooltip, optional)
- [ ] Long stats labels don't overflow (label | value format maintained)

### Animation Polish

#### Pane Transitions
- [ ] Transition duration is 300-500ms (not too slow, not too instant)
- [ ] Animation uses smooth easing (ease-in-out preferred)
- [ ] No content flickering during transition
- [ ] No console errors during animation

#### Button Interactions
- [ ] Buttons have hover state (subtle color change or shadow)
- [ ] Buttons have active/click state (brief visual feedback)
- [ ] Perk selection button change is instant (no animation lag)
- [ ] No unintended animations (buttons shouldn't animate on load)

### Typography

#### Font Sizes
- [ ] Headings are clearly larger than body text
- [ ] Body text is readable (14px-16px is good)
- [ ] Labels are slightly smaller (12px-13px)
- [ ] All text is readable at 350px width

#### Font Weight
- [ ] Headings use bold or heavier weight
- [ ] Body text uses normal weight
- [ ] Critical info (stat values) may be slightly bolder

#### Line Height
- [ ] Line height provides good readability (1.4-1.6 ratio)
- [ ] Long text blocks aren't cramped
- [ ] Doesn't add unnecessary vertical space

---

## ERROR SCENARIOS

### Scenario 1: Manifest Data Unavailable (Offline)

**Setup:**
- Disable internet or use Chrome DevTools to simulate offline
- Sidepanel is open

**Test Steps:**
- [ ] In CRAFT pane, try to search for a weapon (e.g., "Ace of Spades")
- [ ] Observe the results area

**Expected Behavior:**
- [ ] Search field accepts input
- [ ] Results area shows clear error message
- Message text: "Manifest unavailable. Please check your internet connection." (or similar)
- [ ] Message is visible and readable
- [ ] App doesn't crash or hang
- [ ] Search field remains usable for retry

**Pass Criteria:** ✅ User-friendly error message, no crash

---

### Scenario 2: Chrome Storage Write Failure

**Setup:**
- This requires manual testing or mocking (difficult without code modification)
- Requires temporarily corrupting Chrome storage or filling disk space

**Test Steps:**
- [ ] Save a weapon
- [ ] Trigger condition where Chrome storage.local.set() fails
- Observe the UI response

**Expected Behavior:**
- [ ] Toast appears (if storage mock allows)
- [ ] Error toast text: "Failed to save weapon. Please try again." (or similar)
- [ ] Error icon appears (⚠️ or ❌)
- [ ] App doesn't crash
- [ ] User can retry save

**Pass Criteria:** ✅ Graceful error handling, user notified

---

### Scenario 3: Duplicate Save Attempt

**Setup:**
- Save a weapon with exact perks and name
- Immediately try to save again without changing anything

**Test Steps:**
- [ ] Load "Ace of Spades" with perks: Arrowhead Brake + Ricochet Rounds
- [ ] Click "SAVE WISH", confirm with tags "pvp"
- [ ] Weapon saves successfully
- [ ] Without reloading or changing, try to save same combo again exactly

**Expected Behavior:**
- Option A (Allowed): Allows duplicate, saves as separate entry (acceptable)
- Option B (Prevented): Shows warning toast
  - Toast text: "This weapon combo already exists. No duplicate saved."
  - Toast shows ⚠️ icon
  - Weapon is NOT saved again

**Pass Criteria:** ✅ App handles duplicate gracefully (either way)

---

### Scenario 4: Corrupted Chrome Storage Data

**Setup:**
- Manually access Chrome DevTools → Application → Stored Data
- Edit or corrupt weapon data in Chrome Local Storage
- Example: Remove a perk name field, or set stats to "invalid"

**Test Steps:**
- [ ] Reopen sidepanel after corruption
- [ ] Navigate to LIST pane
- [ ] Observe the corrupted weapon entry

**Expected Behavior:**
- [ ] App starts without crashing
- [ ] LIST pane loads without hanging
- [ ] Corrupted weapon either:
  - Shows partial information with "?" or warning icon
  - OR is skipped and warning logged (invisible to user)
  - OR shows error message in weapon card place
- [ ] Other non-corrupted weapons display normally
- [ ] App doesn't crash or go to blank state

**Pass Criteria:** ✅ App doesn't crash, graceful degradation

---

### Scenario 5: Missing Manifest Perk Data

**Setup:**
- Select a weapon
- Manifest server returns incomplete perk data (missing stat values)

**Test Steps:**
- [ ] Load weapon (if manifest has gaps)
- [ ] Select a perk that has missing stat info

**Expected Behavior:**
- [ ] Perk still selectable
- [ ] Stats that have no data show "—" or "N/A" instead of number
- [ ] Stats with data show correctly
- [ ] App doesn't crash
- [ ] Error logged in console (visible in DevTools)

**Pass Criteria:** ✅ Graceful handling of incomplete data

---

### Scenario 6: Missing Weapon Icon

**Setup:**
- Weapon or perk icon URL is broken or doesn't exist

**Test Steps:**
- [ ] Load the weapon with broken icon URL
- [ ] Observe search results and detail area

**Expected Behavior:**
- [ ] Broken image icon appears (standard browser image broken icon)
- OR placeholder image is shown (if implemented)
- [ ] Weapon name and other info still display correctly
- [ ] App doesn't crash
- [ ] Broken icon doesn't prevent interaction

**Pass Criteria:** ✅ Broken images don't crash app

---

## PERFORMANCE BENCHMARKS

### Target Metrics

| Operation | Target Time | Maximum Time | Check |
|-----------|-------------|--------------|-------|
| Search results render | <100ms | 150ms | Time from typing completion to results appearing |
| Perk selection (stat recalc) | <50ms | 100ms | Time from perk click to stats update visually |
| List render (5 weapons) | <200ms | 300ms | Time from LIST button click to list visible |
| List render (20+ weapons) | <500ms | 750ms | Loading 20 or more weapons in list |
| Sidepanel open on extension click | <500ms | 1000ms | From clicking extension icon to UI ready |
| Weapon load (detail view) | <200ms | 400ms | From search result click to detail visible |

### Performance Test Checklist

#### Search Performance
- [ ] Open DevTools (Chrome F12) → Performance tab
- [ ] Record (click red circle)
- [ ] Type slowly "Ace of Spades" in search field
- [ ] Stop recording
- [ ] Check timeline: results should render within 100ms of final keystroke
- [ ] **Result:** ✅ <100ms / ⚠️ 100-150ms / ❌ >150ms

#### Perk Selection Response
- [ ] With DevTools Performance tab open
- [ ] Record performance
- [ ] Click a perk button to select it
- [ ] Stop recording
- [ ] Check: stat table should update within 50ms of click
- [ ] **Result:** ✅ <50ms / ⚠️ 50-100ms / ❌ >100ms

#### List Rendering with 5 Weapons
- [ ] Open LIST view with 5 saved weapons
- [ ] Record performance
- [ ] Click "CLEAR" to reset any filters
- [ ] Stop recording
- [ ] Check render time (time until all weapon cards painted)
- [ ] **Result:** ✅ <200ms / ⚠️ 200-300ms / ❌ >300ms

#### List Rendering with 20+ Weapons
- [ ] Create/save 20-30 weapons in various modes
- [ ] Open LIST view
- [ ] Record performance
- [ ] Check render time
- [ ] **Result:** ✅ <500ms / ⚠️ 500-750ms / ❌ >750ms

#### Memory Stability
- [ ] Open Chrome DevTools → Memory tab
- [ ] Take heap snapshot (baseline)
- [ ] Note memory usage (e.g., 15 MB)
- [ ] Switch between CRAFT and LIST panes 10 times rapidly
- [ ] Take another heap snapshot
- [ ] Compare memory
- [ ] **Expected:** Memory within 2-3 MB of baseline, no runaway increase
- [ ] **Result:** ✅ Stable / ⚠️ 3-5 MB increase / ❌ >5 MB increase

#### Console Errors on Load
- [ ] Open Chrome DevTools → Console tab
- [ ] Clear console
- [ ] Open/reload sidepanel
- [ ] After UI is fully loaded, check console
- [ ] **Expected:** No errors (warnings OK)
- [ ] **Result:** ✅ No errors / ⚠️ 1-2 warnings / ❌ Errors present

---

## CODE QUALITY CHECKS

### weapon-ui.js Function Verification

**Check all Phase 1-8 functions exist and work:**
- [ ] `initWeaponUI()` - runs on sidepanel open
- [ ] `searchWeapons()` - manifests search query
- [ ] `selectWeapon()` - loads weapon detail
- [ ] `selectPerk()` - toggles perk selection
- [ ] `calculatedStats()` - calculates stat deltas
- [ ] `formatStats()` - displays stats in table
- [ ] `saveWish()` - saves weapon to storage
- [ ] `deleteWish()` - removes weapon from storage
- [ ] `loadWeaponList()` - populates LIST pane
- [ ] `filterWeapons()` - applies filter logic
- [ ] Navigation between panes works

**For each function:**
- [ ] Function runs without throwing errors
- [ ] Function returns expected data type
- [ ] Function doesn't log unnecessary debug info to console

### Event Listener Verification

**Test event listener duplication:**
- [ ] Load weapon and select a perk
- [ ] In DevTools Console, note how many times the perk click fires
- [ ] Expected: 1 time (one click = one event)
- [ ] Repeat perk selection 5 times and verify consistent 1:1 mapping

**Result:** ✅ No duplication / ⚠️ Occasional duplication / ❌ Multiple events per click

### Logging Quality

**Check d2log() calls:**
- [ ] Open DevTools Console
- [ ] Perform various actions (search, save, delete, filter)
- [ ] Observe console logs
- [ ] Expected format:
  ```
  [weapon-ui] [Phase 6] Weapon loaded: Ace of Spades
  [weapon-ui] [Phase 6] Perk selected: Arrowhead Brake
  ```
- [ ] Check: All logs have context (file name + phase)
- [ ] Check: Logs are informative (show what happened)
- [ ] Check: No excessive logging (doesn't spam console)

**Result:** ✅ Good logging / ⚠️ Minor issues / ❌ No logging or spam

### Memory Leak Detection

**Test for listener/reference leaks:**
- [ ] Open DevTools → Memory tab
- [ ] Take heap snapshot before testing
- [ ] For 5 minutes, repeatedly:
  - Load weapon
  - Select perks
  - Switch between CRAFT/LIST
  - Delete weapon
- [ ] Take another heap snapshot
- [ ] Compare: Detached DOM nodes should be minimal
- [ ] Memory growth should be <5 MB over 5 minutes

**Result:** ✅ No leaks / ⚠️ Minor growth <3 MB / ❌ Significant growth >5 MB

### Error Boundary Testing

**Check app survives edge cases:**
- [ ] Try selecting weapon with null stats
- [ ] Try saving weapon with empty name
- [ ] Try clicking buttons rapidly
- [ ] Try searching with special characters: @#$%
- [ ] Try deleting same weapon twice in succession

**Expected:** No unhandled exceptions, app remains responsive

**Result:** ✅ All cases handled / ⚠️ Minor issues / ❌ Crashes occur

---

## TROUBLESHOOTING GUIDE

### Issue: Search Results Don't Appear

**Possible Causes:**

1. **Manifest Not Loaded**
   - [ ] Check DevTools Console for manifest fetch errors
   - [ ] Verify internet connection is active
   - [ ] Solution: Reload sidepanel

2. **Search String Incorrect**
   - [ ] Verify weapon name in Destiny database
   - [ ] Try exact name: "Ace of Spades" vs "ace of spades"
   - [ ] Solution: Use correct weapon name from manifest

3. **Search Index Not Built**
   - [ ] Check if manifest initialization completed
   - [ ] Solution: Wait 2 seconds after sidepanel opens, try again

**Troubleshooting Steps:**
```
1. Open DevTools (F12)
2. Check Console for messages about manifest loading
3. Look for error messages starting with "ERROR:" or "MANIFEST:"
4. If error found, note the exact message and report
5. If no errors, verify search string against actual Destiny database
```

---

### Issue: Stats Don't Update After Perk Selection

**Possible Causes:**

1. **Stat Calculation Function Failed**
   - [ ] Check Console for stat calculation errors
   - [ ] Verify the perk data includes stat deltas
   - [ ] Solution: Reload weapon, try again

2. **DOM Not Refreshing**
   - [ ] Stats calculated but display not updated
   - [ ] Solution: Switch pane and back, then select perk again

3. **Perk Data Missing Stat Info**
   - [ ] Perk exists but has no associated stats in manifest
   - [ ] Solution: Select a different perk with stat data

**Troubleshooting Steps:**
```
1. Open DevTools Console
2. Select a perk and watch for console output
3. Look for output like: "Stat delta calculated: +7 Handling"
4. If no output, function may not be executing
5. Check browser console for JavaScript errors
```

---

### Issue: Weapon Doesn't Save

**Possible Causes:**

1. **Save Button Not Enabled**
   - [ ] At least one perk must be selected
   - [ ] Solution: Select perks before clicking SAVE

2. **Chrome Storage Full or Blocked**
   - [ ] Browser storage quota exceeded
   - [ ] Solution: Clear extension data in Chrome settings, try again

3. **Modal Dialog Not Responding**
   - [ ] Tag input modal appeared but buttons not clickable
   - [ ] Solution: Reload sidepanel

**Troubleshooting Steps:**
```
1. Verify at least 3 perks are selected (blue state)
2. Click SAVE WISH button
3. Verify modal dialog appears
4. Enter tags and click Confirm
5. Watch for success toast
6. If toast doesn't appear, check DevTools Console for errors
```

---

### Issue: Saved Weapon Doesn't Appear in List

**Possible Causes:**

1. **Success Toast Appeared But Save Failed**
   - [ ] Toast was false positive, storage actually failed
   - [ ] Solution: Close and reopen sidepanel, check if weapon persisted

2. **Filter is Hiding Weapon**
   - [ ] Weapon type or damage type filter is active
   - [ ] Solution: Click CLEAR to reset all filters

3. **Wrong Pane**
   - [ ] Viewing CRAFT pane instead of LIST pane
   - [ ] Solution: Click LIST button

**Troubleshooting Steps:**
```
1. After save toast appears, click LIST button
2. Verify weapon appears in list
3. If not visible, click CLEAR to reset filters
4. If still not visible, close and reopen sidepanel
5. If still missing, storage may have failed — check Console for errors
```

---

### Issue: List Takes Too Long to Load

**Possible Causes:**

1. **Many Weapons Saved (20+)**
   - [ ] UI rendering 20+ weapon cards is slow
   - [ ] Expected: up to 500-750ms is acceptable
   - [ ] Solution: If <1 second, performance is acceptable

2. **Network Latency**
   - [ ] List may be fetching data from server
   - [ ] Solution: Verify internet connection is fast

3. **Browser Performance Issue**
   - [ ] Device or browser is slow
   - [ ] Solution: Close other browser tabs, try again

**Troubleshooting Steps:**
```
1. Open DevTools Performance tab
2. Record while clicking LIST button
3. Note total time until list is fully visible
4. If >500ms, check if rendering time is slow or network call
5. Review console for slow async operations
```

---

### Issue: Delete Confirmation Doesn't Appear

**Possible Causes:**

1. **Modal Dialog Not Rendering**
   - [ ] Delete button clicked but modal doesn't show
   - [ ] Solution: Reload sidepanel

2. **JavaScript Error**
   - [ ] Delete click handler has an error
   - [ ] Solution: Check Console for exceptions

**Troubleshooting Steps:**
```
1. Right-click delete button, check if event is firing
2. Open Console, click delete button
3. Look for any error messages
4. If error found, note the exact error text
5. Reload sidepanel and try again
```

---

### Issue: Mode Badge Missing or Wrong

**Possible Causes:**

1. **Mode Not Selected Before Save**
   - [ ] Default is PvE, but if mode button state not matching
   - [ ] Solution: Verify "PvE" button shows active (gold) before saving

2. **Mode Data Not Saved**
   - [ ] Weapon saved without mode information
   - [ ] Solution: Delete and re-save weapon while in correct mode

3. **Display Logic Error**
   - [ ] Mode saved correctly but badge doesn't show
   - [ ] Solution: Close and reopen sidepanel

**Troubleshooting Steps:**
```
1. Verify "PvE" or "PvP" button shows active state (gold/highlighted)
2. Select perks and save
3. Go to LIST pane
4. Look at saved weapon card for mode badge
5. If badge missing, check Console for badge rendering errors
```

---

### Issue: Animation Stutters Between Panes

**Possible Causes:**

1. **Slow Device**
   - [ ] Animation plays at <30 fps
   - [ ] Solution: Close other apps, try again

2. **JavaScript Blocking**
   - [ ] Heavy computation during transition
   - [ ] Solution: Reload sidepanel

3. **CSS Animation Issue**
   - [ ] Transition CSS property missing or wrong
   - [ ] Solution: Check DevTools Element Inspector for CSS

**Troubleshooting Steps:**
```
1. Open DevTools Performance tab
2. Record while clicking LIST/CRAFT buttons
3. Check for JavaScript execution during animation
4. If JavaScript blocking detected, file performance bug
5. Animation should be pure CSS (no JS during transition)
```

---

### Issue: Console Shows Error Messages

**Common Error Patterns:**

```
ERROR: [weapon-ui] Manifest data unavailable
→ Cause: Network issue or manifest URL is wrong
→ Solution: Check internet, verify manifest URL in code

ERROR: [weapon-manager] Failed to save weapon
→ Cause: Chrome storage API error or quota exceeded
→ Solution: Clear extension data, reload sidepanel

TypeError: Cannot read property 'stats' of undefined
→ Cause: Weapon data structure missing expected fields
→ Solution: Verify weapon comes from valid manifest

ReferenceError: d2log is not defined
→ Cause: Logger function not imported
→ Solution: Check imports at top of weapon-ui.js file
```

**Troubleshooting Steps:**
```
1. Note exact error message and where it appears
2. If error starts with "ERROR:", it's logged by app code (expected sometimes)
3. If error is a JavaScript exception (TypeError, ReferenceError), it's a bug
4. Reload sidepanel, reproduce the error step
5. Note exact sequence of actions that triggers the error
6. Report with error message and reproduction steps
```

---

## TEST EXECUTION SUMMARY

### Test Session Log Template

```
Test Date: _______________
Tester: ___________________
Chrome Version: ___________
Extension Version: ________

Test Case 1: Search & Selection
  Status: ☐ PASS ☐ FAIL ☐ PARTIAL
  Notes: _____________________________

Test Case 2: Perk Selection
  Status: ☐ PASS ☐ FAIL ☐ PARTIAL
  Notes: _____________________________

Test Case 3: Save Wish
  Status: ☐ PASS ☐ FAIL ☐ PARTIAL
  Notes: _____________________________

Test Case 4: List Filtering
  Status: ☐ PASS ☐ FAIL ☐ PARTIAL
  Notes: _____________________________

Test Case 5: Delete
  Status: ☐ PASS ☐ FAIL ☐ PARTIAL
  Notes: _____________________________

Test Case 6: Mode Switch
  Status: ☐ PASS ☐ FAIL ☐ PARTIAL
  Notes: _____________________________

Test Case 7: Navigation
  Status: ☐ PASS ☐ FAIL ☐ PARTIAL
  Notes: _____________________________

Test Case 8: Persistence
  Status: ☐ PASS ☐ FAIL ☐ PARTIAL
  Notes: _____________________________

Overall Status: ☐ ALL PASS ☐ MINOR ISSUES ☐ MAJOR ISSUES
```

---

## SIGN-OFF

**Test Plan Approved By:** _________________________  
**Date Approved:** _________________________  

**Test Execution Completed By:** _________________________  
**Date Completed:** _________________________  

**Overall Result:** ☐ PASS ☐ FAIL ☐ PASS WITH NOTES  

**Known Issues to Fix Before Release:**
1. _________________________________
2. _________________________________
3. _________________________________

