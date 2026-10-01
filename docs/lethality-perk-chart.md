# Lethality Perk Chart

Source of truth: the perk trait pool actually modeled by `oracle_engine`
(`origin_perks.rs` + `year_1_perks.rs` through `year_7_perks.rs`) — this is the
same pool `weapon-craft.js` pulls perk columns from, so it's the right scope
for the Lethality feature. Armor mods, exotic-armor buffs, subclass verbs, and
exotic-catalyst-only perks (`meta_perks.rs`, `buff_perks.rs`, most of
`other_perks.rs`, `exotic_perks.rs`) are excluded — they're not choices in the
weapon perk-picker UI.

**Ratings:** High / Medium / Low / Situational / None (none = no offensive
value, utility/handling only — still worth tracking for the crafting UI but
shouldn't move either Lethality bar).

Classification method: read each perk's modifier-function registration in the
Rust source (`dmr`=damage, `fmr`=firing/RPM/crit, `rmr`=reload,
`hmr`=handling, `imr`/`mmr`=magazine/reserves, `rsmr`=range, `epr`=explosive%,
`sbr`=stat buff) and whether the closure branches on `pvp` vs `!pvp`. PvP
lethality tracks perks that move **TTK** (damage, crit multiplier, RPM,
range/falloff at duel distance). PvE lethality tracks perks that move
**sustained/burst DPS** (damage vs. enemy tiers, reload economy, mag size,
ammo economy) — TTK-only value doesn't matter against non-minor enemies since
you rarely one-mag anything above a red bar.

---

## Origin Traits (Year 5+, `origin_perks.rs`)

| Perk | PvP | PvE | Why |
|---|---|---|---|
| Alacrity | Low | Medium | Stat bump after readying from breaking crouch — situational handling buff, marginal DPS uptime gain, not a duel-winner. |
| Ambush | Medium | Low | Damage buff for the first shot after ADS-ing while crouched — real in PvP peek-shots, rarely repeatable in sustained PvE DPS. |
| BitterSpite | Low | Medium | Reload/reserves scaling with low health — PvE survivability-adjacent sustain, irrelevant to duel TTK. |
| FluidDynamics | Low | Medium | Airborne effectiveness/handling — matters for PvE mobility builds, negligible TTK impact. |
| HakkeBreach | Medium | Low | Stability/handling after swapping to the weapon — helps duel consistency, not raw DPS. |
| HarmonicResonance | Low | Low | Buffs matching-damage-type weapons after elemental kills — build-support, not a lethality perk itself. |
| HotSwap | Medium | Low | Handling buff after swapping weapons — quick-swap TTK trick in PvP, no PvE DPS value. |
| QuietMoment | Low | Low | ADS-related handling/accuracy — marginal for both. |
| RightHook | Low | Medium | Reload speed on rapid kills — sustain perk, PvE ammo economy. |
| RunnethOver | Low | Medium | Reserves/mag on rapid finishers — ammo economy perk, PvE-leaning. |
| SearchParty | Low | Medium | Reserves on orb pickup — PvE ammo economy, no PvP relevance. |
| SurosSynergy | Medium | Low | Reload/handling on melee kill — PvP flex play, marginal PvE. |
| TexBalancedStock | Medium | Low | Recoil/stability on standing still — duel consistency, not PvE DPS. |
| VeistStinger | Low | Medium | Reload speed on precision kills — PvE ammo economy again. |

**Takeaway:** origin traits are almost entirely handling/economy perks, not
damage perks — none of them should meaningfully move either Lethality bar
past Low/Medium.

---

## Season 1–3 (Year 1, `year_1_perks.rs`)

| Perk | PvP | PvE | Why |
|---|---|---|---|
| Outlaw | Low | High | Reload speed on precision kill — pure sustain, but sustain is most of PvE lethality (keeps DPS uptime up). |
| KillClip | High | High | +damage buff after reloading from a kill — direct `dmr` damage scalar in both modes, the textbook dual-purpose perk. |
| Rampage | High | High | Stacking damage buff per kill — direct `dmr`, scales aggressively in add-clear and multi-kill PvP. |
| BackupPlan | Low | Low | Handling while sliding — mobility, not damage. |
| FieldPrep | Low | Medium | Faster reload for swapped/holstered weapons, +reserves — PvE ammo economy for special/heavy. |
| OpeningShot | High | Medium | Accuracy/range/stability on first ADS shot — huge for opening a duel; less relevant once you're already sustained-firing in PvE. |
| MovingTarget | Medium | Low | Target acquisition/range while moving — helps track PvP targets, minimal PvE DPS value. |
| AmbitiousAssassin | Low | High | Damage stacks per kill without reload, resets on reload — PvE add-clear scaling perk (SMGs/ARs), rarely relevant in a PvP duel's first few shots. |
| ClusterBomb | Low | Medium | Extra explosion on precision/kill for grenade-launcher-style splash — PvE AoE damage, weak PvP value. |
| ExplosivePayload | Medium | Medium | Adds explosive/`epr` damage on impact — flat damage add-on, works in both but outclassed by direct dmr perks. |
| FirmlyPlanted | Low | Low | Stability/range while stationary+ADS — QoL, not damage. |
| FullAutoTrigger | Low | Low | Converts trigger to full-auto — playstyle enabler, doesn't change per-shot damage. |
| HeadSeeker | Low | Low | Precision-hit-based reserve/mag perks (SMGs) — oracle models it as a static/no-op; treat as unrated pending direct testing. |
| HighImpactReserves | Medium | High | Damage buff at low mag — direct `dmr`, strongest in PvE sustained-fire scenarios where you're regularly near-empty. |
| HipFireGrip | Low | Low | Hip-fire accuracy/range — niche playstyle, not a lethality mover. |
| ImpactCasing | Low | Low | Flinch resistance on ADS — defensive, not offensive. |
| PhaseMag | Low | Low | Reload while ADS speed — QoL sustain, small. |
| PulseMonitor | Low | Low | Handling/reload after taking damage — defensive/reactive utility. |
| QuickDraw | High | Low | Faster ready time — decisive in a PvP first-engagement, irrelevant once already firing in PvE. |
| RangeFinder | Medium | Low | ADS range increase — extends effective PvP falloff range, minor PvE value (most PvE ranges are already inside falloff). |
| SlideShot | Low | Low | Accuracy/stability while sliding — mobility tech, not damage. |
| SlideWays | Low | Low | Handling while sliding — same. |
| Snapshot | High | Low | Faster ADS time — big PvP duel-winner (first shot advantage), no PvE DPS value. |
| TapTheTrigger | Low | Low | Stability on first trigger pull — marginal. |
| ThreatDetector | Medium | Low | Handling/stability when target is aiming at you — reactive PvP perk, no PvE analog. |
| TimedPayload | Low | Medium | Bigger explosion radius, delayed — PvE AoE utility, weak PvP (delay hurts duels). |
| TripleTap | Low | High | Ammo refund on 3 consecutive crits — pure PvE sustain/ammo-economy perk (extends mag without reloading), doesn't move PvP TTK at all. |
| UnderPressure | Medium | Low | Stability recovery while sustained-firing/ADS — helps PvP spray control, minor PvE value. |
| Desperado | High | High | Faster fire rate after a precision-kill reload — direct RPM/`fmr` boost, strong in both (chains into higher burst DPS and faster follow-up TTK). |
| DisruptionBreak | Medium | Medium | Extra damage vs. combatants with active shields/champions — situational damage scalar, useful in both depending on target. |
| BoxBreathing | Medium | High | Bonus precision damage after a fully-charged ADS hold — significant `dmr` boost, strongest on snipers/bows for both crit-focused PvP shots and PvE boss damage. |

---

## Season 4–7 (Year 2, `year_2_perks.rs`)

| Perk | PvP | PvE | Why |
|---|---|---|---|
| ArchersTempo | Medium | High | Faster draw after a precision kill (bows) — chains follow-up shots fast, strong PvE DPS uptime, decent PvP follow-up speed. |
| ExplosiveHead | Low | Medium | Explosion on precision hits — PvE AoE add-clear, PvP value muted since it doesn't add direct burst damage to the target that matters (headshot already near-lethal). |
| FeedingFrenzy | Low | High | Stacking reload speed on kills — pure sustain/ammo-economy, PvE DPS-uptime perk. |
| FourthTimesTheCharm | Low | Medium | Ammo refund after 4 hits — PvE ammo economy, similar family to Triple Tap but weaker. |
| RapidHit | Low | High | Stacking reload speed on precision hits — sustain perk, strong PvE DPS uptime. |
| ResevoirBurst | Low | Medium | Explosion on reload-with-full-mag — PvE burst add-clear utility, PvP irrelevant (requires setup). |
| Surrounded | Low | High | Damage buff when surrounded by 3+ enemies — explicitly a PvE add-clear perk, functionally impossible to trigger meaningfully in PvP. |
| AirAssault | Low | Medium | Airborne effectiveness/reserves — PvE mobility-build support, weak PvP relevance. |
| OverFlow | Low | Medium | Mag refills to max (or beyond with mods) on special/heavy pickup — PvE ammo economy. |
| FiringLine | Medium | High | Damage buff when 2+ allies are near the target — reliable in coordinated PvE fireteams (always near-active on bosses), situational in PvP (requires teammates near your target). |
| FullCourt | Low | Medium | Bonus damage the longer a projectile travels — niche for slow grenade launchers, PvE-leaning. |
| KillingTally | Medium | High | Stacking damage per kill, resets on reload — strong PvE add-clear/DPS scaling (similar family to Rampage but bigger per-stack, harder to maintain), decent PvP if you're already winning fights. |
| Demolitionist | Low | Medium | Grenade energy on kill — build-support (ability uptime), not a direct weapon-damage perk; PvE-leaning since ability uptime matters more there. |
| MultikillClip | High | High | Stacking damage per kill without reload — same family as Rampage/KillClip, strong dual-purpose `dmr` perk. |
| Swashbuckler | High | High | Stacking damage on melee or precision/rapid kills, no reload required — comparable to Rampage/MultikillClip, strong in both modes. |
| ExplosiveLight | Low | Medium | Grenade-launcher-style explosive buff after Super — extremely niche, PvE-only relevance. |
| EyeOfTheStorm | Medium | Low | Handling when low health — reactive PvP survivability/handling perk, no PvE damage value. |
| NoDistractions | Medium | Low | ADS stability when not flinched — PvP-specific defensive-offensive hybrid, no PvE relevance. |
| ArchersGambit (Note: enum name is `ArchersGambit` but this is the bow "Snapshot on precision" — verify against current live text) | Medium | Low | Faster ready/handling after precision kill (bows) — PvP follow-up speed tool, minor PvE value. |

---

## Season 9, 11 (Year 3, `year_3_perks.rs`)

| Perk | PvP | PvE | Why |
|---|---|---|---|
| ClownCartridge | Low | Medium | Chance to not consume ammo on reload / bonus reserves — pure PvE ammo-economy perk. |
| ElementalCapacitor | Low | Medium | Rotating buff (one of several element-tied bonuses) — build-support, generally PvE-leaning depending on active buff. |
| Vorpal | Low | High | Bonus damage vs. minibosses/champions/bosses — explicitly boss/miniboss-only in the `dmr` branch, zero PvP relevance, one of the strongest single-target PvE DPS perks in the game. |
| KillingWind | Medium | Low | Range/handling/mobility after a kill — reward-for-a-kill PvP survivability/range perk, minor PvE value. |
| LastingImpression | Low | Medium | Pins/slows on impact — PvE crowd-control utility, situational PvP disruption at best. |
| TrenchBarrel | Low | High | Big shotgun damage buff after any kill — PvE add-clear/DPS scalar (shotgun ammo economy makes this hard to chain in PvP duels). |

---

## Season 12–15 (Year 4, `year_4_perks.rs`)

| Perk | PvP | PvE | Why |
|---|---|---|---|
| DualLoader | Low | Low | Faster reload, smaller mag increments — QoL sustain, small magnitude. |
| OneForAll | High | High | Big damage buff after precision-hitting the same target repeatedly — strong `dmr` scalar in both, especially strong vs. single high-value targets (PvP duels and PvE bosses alike). |
| Recombination | Low | High | Stacking damage on rapid precision/rapid kills that decays over time — PvE add-clear scaling, hard to build stacks fast enough to matter in a short PvP duel. |
| Reconstruction | Low | High | Passive mag refill over time, bonus reserves — pure PvE sustain/ammo-economy, no PvP damage value. |
| Surplus | Low | Medium | Reload/handling/stability that scale with reserve ammo fullness — PvE sustain-adjacent, weak PvP. |
| ImpulseAmplifier | Low | Low | Projectile velocity increase — QoL for travel-time weapons, not a damage perk. |
| Frenzy | Medium | High | Damage/handling/reload buff after sustained combat (10s) — strong PvE sustained-DPS perk (easy to maintain in a boss fight), harder to hold in short PvP engagements but still meaningful. |
| LastingImpression | *(dup, see Year 3)* | | |
| KickStart | Low | Medium | Reload/handling when nearly empty on ability-energy — PvE ability-uptime-adjacent sustain. |
| LastingImpression | Low | Medium | Slows/pins on impact — PvE crowd-control, situational PvP disruption. (Also appears in Year 3; two different intrinsics share this name/hash family across expansions.) |
| Cornered | Medium | High | Damage buff when low on reserve ammo — strong in both but easier to trigger/hold in PvE ammo-scarce boss fights than a fast PvP duel. |
| AdrenalineJunkie | High | High | Stacking damage per grenade-kill-assisted combatant — strong `dmr` scalar, works in both modes when the grenade-kill condition is met. |
| RewindRounds | Low | Medium | Ammo refund on precision/rapid kills — PvE ammo-economy, Triple-Tap-family. |
| HeatingUp | Low | High | Stacking damage/handling on sustained accurate fire, no reload needed — strong PvE sustained-DPS stacking perk, similar to Frenzy/Rampage family. |
| FireFly | Low | Medium | Explosion on precision kill, chains to nearby enemies — PvE add-clear utility, no PvP damage value (target's already dead). |
| DangerZone | Low | Medium | Shotgun blast-radius increase — PvE add-clear utility. |
| TunnelVision | Medium | Low | Target-acquisition/accuracy on ADS — PvP tracking tool, minimal PvE value. |
| Adagio | Medium | Medium | Bonus crit damage at the end of a burst's damage falloff window — rewards patient precision play in both modes; strongest on burst weapons where the timing window is learnable. |
| Ensemble | Low | Low | Handling buff on class-ability-related trigger — build-support, not damage. |
| GoldenTricorn | High | High | Chance for a large bonus-damage proc on rapid/precision kills (upgraded Rampage/Swashbuckler-style) — strong dual-purpose `dmr` perk. |
| Harmony | Low | Medium | Reload/reserves buff (paired with a linked seasonal artifact mod historically) — PvE sustain-leaning, weak standalone PvP value. |
| PerpetualMotion | Low | Low | Handling while moving after a kill — mobility QoL. |
| Pugilist | Low | Low | Melee-charge-rate on kill — ability-uptime support, not weapon damage. |
| PerfectFloat | Low | Low | Airborne accuracy/handling — mobility-build QoL. |
| BluntExecutionRounds | Low | Medium | Slow-on-hit/damage vs. slowed targets — PvE crowd-control-linked damage, situational PvP. |

---

## Season 16–19 (Year 5, `year_5_perks.rs`)

| Perk | PvP | PvE | Why |
|---|---|---|---|
| BaitAndSwitch | Medium | High | Big damage buff after damaging multiple targets with different weapons — classic PvE burst-DPS rotation perk (heavy/special swap combos), situational but real in PvP if you land the setup. |
| CascadePoint | Low | High | Fire-rate ramp after ability-kill-chained damage buffs — PvE DPS-rotation perk (works with exotic build synergies), minimal standalone PvP value. |
| CompulsiveReloader | Low | Medium | Reload speed scaling with missing health — PvE sustain, situational. |
| Encore | Medium | High | Stacking precision damage buff on consecutive precision hits without reload — strong in both, PvE-leaning since sustained precision fire is easier to maintain against stationary enemies. |
| FocusedFury | Medium | High | Damage buff when both you and a teammate/summon are hitting the same target — reliable PvE (teammates always damaging bosses), situational PvP. |
| FragileFocus | Low | Low | Range/handling on precision hits while stationary — QoL, not a damage scalar. |
| GutShot | Low | Low | Hip-fire accuracy/stability — niche playstyle QoL. |
| OffhandStrike | Low | Low | Handling after swapping from a different weapon type — mobility QoL. |
| ShotSwap | Low | Low | Handling on rapid weapon-swap — mobility QoL. |
| SleightOfHand | Low | Medium | Reload/stability scaling with mag fullness — PvE sustain-adjacent. |
| Slickdraw | Medium | Low | Draw/stow speed increase — PvP quick-swap tool, no PvE DPS value. |
| StatsForAll | Low | Low | Stat buffs to nearby allies' weapons on final blows — team-support, not self-damage. |
| SteadyHands | Medium | Low | ADS speed after hip-fire kills — PvP flex-play speed tool. |
| SuccesfulWarmup | Low | Medium | Handling/stability after holding ADS — PvE sustained-aim support. |
| TargetLock | High | High | Ramping damage on continuous precision fire on the same target — strong `dmr` scalar in both, one of the best sustained single-target perks for bosses and duels alike. |
| UnderOver | Low | Low | Accuracy while airborne — mobility QoL. |
| UnstoppableForce | Low | Medium | Damage/handling buff after a Finisher — PvE build-support (Finishers are a PvE mechanic), essentially no PvP relevance. |
| WellRounded | Low | Low | Stability/handling on rapid stance-change kills — niche QoL. |

---

## Season 20–23 (Year 6, `year_6_perks.rs`)

| Perk | PvP | PvE | Why |
|---|---|---|---|
| KeepAway | Medium | Low | Range/accuracy buff at long range from target — rewards PvP disengagement/poke play, weak PvE (most PvE engagements are close-to-mid). |
| ParacausalAffinity | Low | Low | Buff tied to Strand-verb interactions — build-support, minimal direct damage. |
| EnviousAssassin | Low | High | Mag refill scaling with reserve ammo lost — PvE ammo-economy/sustain perk. |
| CollectiveAction | Low | Medium | Damage/handling buff after ability-energy-related trigger — build-support, PvE-leaning. |
| Bipod | Low | Medium | Range/stability while crouched and stationary — PvE turret-play support, weak in mobile PvP duels. |
| ControlledBurst | Medium | Medium | Damage buff on the final round of a burst — rewards precise burst-timing, similar value in both modes on burst weapons. |
| DesperateMeasures | Low | High | Handling/reload/damage buff at low ammo reserves in a boss-damage phase context — PvE-specific damage-phase perk. |
| Discord | Low | Medium | Reload/handling on rapid precision/agile-stance kills — sustain-leaning. |
| EddyCurrent | Low | Medium | Bonus damage on the first hit after handling changes — niche PvE burst-opener. |
| EnlightendAction | Low | Medium | Ability-energy-linked reload buff — build-support, PvE-leaning. |
| EnviousAssassin | *(dup, see above)* | | |
| FieldTested | Medium | Medium | Range/stability/handling that improves through sustained combat — general-purpose consistency buff, similar modest value in both. |
| HeadRush | Medium | Low | Flinch-resistance/handling after dodge — PvP survivability tool, no PvE damage value. |
| HighGround | Medium | Medium | Damage buff on precision hits while at higher elevation than target — situational positional damage in both, more consistently exploitable in PvE (static enemy positions) than PvP. |
| InvisibleHand | Low | Medium | Reload speed after picking up ammo — PvE ammo-economy. |
| LooseChange | Low | Medium | Reload speed on rapid kills with the same weapon — sustain perk. |
| MasterOfArms | High | High | Bonus precision damage after swapping from a weapon that just landed a precision kill — direct `dmr` boost, strong in weapon-swap-heavy builds for both modes. |
| NobleDeeds | Low | Medium | Buff on ally Super use — team-support, PvE-leaning (organized fireteams). |
| Onslaught | Low | High | Reload speed stacking on rapid kills — sustain/DPS-uptime perk, PvE add-clear-leaning. |
| PrecisionInstrument | Medium | Medium | Precision-damage buff that ramps with consecutive precision hits, resets on body shot — rewards accurate play in both, similar mechanism to TargetLock but stricter. |
| SwordLogic | Medium | High | Stacking damage on rapid hits (swords) — strong sustained-DPS stacker, PvE-leaning due to sword's PvE-primary role, still relevant in the rare sword PvP duel. |
| TempestCascade | Low | Medium | Damage/handling buff on rapid precision hits (Arc-linked) — PvE build-support-leaning. |
| UnsatedHunger | Low | Medium | Reload/reserves on melee-then-weapon-kill chain — sustain, PvE-leaning. |

---

## Episodes 1–3 (Year 7, `year_7_perks.rs`)

| Perk | PvP | PvE | Why |
|---|---|---|---|
| ChaosReshaped | Medium | High | Damage buff that ramps the longer you continuously damage without missing — rewards sustained accurate fire, strongest in PvE sustained-boss-DPS, meaningful in longer PvP engagements too. |
| CircleOfLife | Low | Medium | Reload/ability-energy buff on finisher/ability kill — PvE build-support. |
| AirTrigger | Low | Low | Airborne accuracy/stability — mobility QoL. |
| ClosingTime | Medium | Medium | Damage buff that increases as the fight goes on ("last stand" style) — situational scaling damage perk, relevant to both extended duels and extended boss fights. |
| LoneWolf | Medium | High | Damage/handling buff when not near allies — solo-play reward, more consistently active in solo PvE than in team PvP (where you often want to be near allies anyway). |
| SplicerSurge | Low | Medium | Buff tied to Vex-encounter mechanic interactions — extremely niche PvE-only. |
| ElementalHoning | Low | Medium | Reload/handling buff tied to matching subclass element — PvE build-support. |
| TimelostMagazine | Low | Medium | Bonus reserves/mag scaling perk — ammo-economy, PvE-leaning. |

---

## Cross-cutting notes for the scoring model

1. **The clean "PvP perk" vs. "PvE perk" split doesn't really exist.** What
   exists is a spectrum from *pure damage scalar* (Kill Clip, Rampage,
   TargetLock, MultikillClip — these move both bars hard) to *pure sustain/
   economy* (Outlaw, Feeding Frenzy, Reconstruction, Triple Tap — these move
   only the PvE bar, because PvP duels resolve inside one mag and ammo
   economy never comes into play) to *pure duel-speed* (Snapshot, QuickDraw,
   OpeningShot — these move only the PvP bar, because ready/ADS speed doesn't
   change sustained DPS math at all).

2. **A mechanical rule that mostly reproduces the table above:** if a perk's
   Rust closure is registered as `dmr` (damage) or `fmr` (firing/RPM/crit)
   and the buff applies regardless of `pvp` flag → rate it High/High. If the
   `dmr`/`fmr` buff is explicitly gated to `!input.pvp` with an
   `enemy_type` check (miniboss/boss/champion) → PvP None, PvE High (Vorpal
   is the clearest example). If the perk only touches `rmr`/`imr`/`mmr`
   (reload/mag/reserves) → PvE Medium–High, PvP Low–None. If it only touches
   `hmr` (handling: ready/stow/ADS time) → PvP Medium–High, PvE Low. This
   gives you a defensible, code-derived default rating that a human only
   needs to override for genuinely situational perks (Surrounded, Vorpal,
   FiringLine, DesperateMeasures).

3. **Recommendation for the scoring engine:** don't hand-tag perks with a
   PvP/PvE label. Instead, at Lethality-calc time, call `getWeaponFiringData`,
   `getWeaponReloadTimes`, `getWeaponTtk`, etc. with `pvp=true` and `pvp=false`
   and diff the *before/after-perk* results in each mode. The oracle engine
   already encodes exactly the pvp-vs-pve branching above — this table is
   useful for the write-up/manual-QA pass and for building intuition, but the
   actual score should come from the engine's own numbers per weapon+perk
   combination rather than a static per-perk tag, since the same perk's
   effective value shifts by archetype (Desperado's RPM bump matters more on
   a low-RPM frame; Vorpal's boss bonus is meaningless on a PvP-only Sidearm
   archetype, etc).
</content>
