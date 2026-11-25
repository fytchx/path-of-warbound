# MASTER DIRECTIVE — Path of Warbound

End-to-end game and engineering blueprint. Normative: where code and this document disagree, fix the code or amend this document in the same change. Verified baseline numbers come from `npm run validate` and `npm test` at the Phase 2 checkpoint.

## 1. Vision and identity

**An intimidating monster in the background, simple for a solo developer to build without scope creep, deeply stimulating for theorycrafters, and effortless for the average player.**

The player is a disembodied Soul-Spark bound into Warbound Armaments. There are **zero human faces or character portraits anywhere**. The header emblem is always `fx_soulspark` inside `#w-medal`. The body is implied by the 3×3 equipment grid; the "character" is the gear.

Presentation:

- Portrait-only frame, `390px`–`420px`, centred and letterboxed on desktop.
- Five bottom tabs, all unlocked from boot: `COMBAT`, `ALTAR`, `TREE`, `BAG`, `FORGE`.
- Every interactive target ≥ `44px × 44px`.
- Frosted obsidian surfaces: `rgba(11, 14, 22, 0.84)` + `backdrop-filter: blur(8px)`, `1px solid rgba(212, 175, 55, 0.35)`.

## 2. Attributes (four vectors)

| Attribute | Vector 1 | Vector 2 | Vector 3 | Vector 4 |
| --- | --- | --- | --- | --- |
| **Might** | Weapon base damage | Ability power | Crit multiplier `+0.5%` per point | Armor break |
| **Agility** | Attack speed | Double-hit chance `min(0.75, Agi/(Agi+250))`, echo at `70%` damage | DoT tick speed | Dodge rating |
| **Wisdom** | Cast/channel speed | Max mana and regen | Max ward | Ailment potency |
| **Fortitude** | Max HP | HP regen | Armor | Thorns |

## 3. Damage schools and signature ailments

| School | Ailment | Behaviour |
| --- | --- | --- |
| Physical | **Bleed** | Stacking physical DoT |
| Fire | **Ignite** | High-magnitude burning DoT |
| Frost | **Chill / Freeze** | Action-speed slow; freezes the action bar at max stacks |
| Lightning | **Shock** | `+10%` to `+40%` increased damage taken |
| Void | **Corruption** | Armor-bypassing DoT and `-35%` enemy healing/ward recharge |

## 4. Stat pipeline

```
Final(X) = (Base(X) + Sum(Flat(X))) * (1 + Sum(Increased%(X))/100) * Product(1 + More%(X)/100)
```

Two-pass, forward-only DAG conversions, evaluated once per stat recompute:

- **Pass 1 (attributes and defence):** `Might → Agility → Wisdom → Fortitude`, then `Armor → Max Ward → Dodge Rating`.
- **Pass 2 (schools):** `Physical → Fire → Frost → Lightning → Void`.

No circular dependencies, no mutation shortcuts, no re-entrant conversion.

## 5. Defence and ailment math

- **Dodge (entropy-assisted):** `entropyCounter` accumulates dodge chance per incoming hit; when it crosses 1 the hit is dodged and 1 is subtracted. Deterministic in expectation, never streaky.
- **Armor mitigation:** `Armor / (Armor + 45 * Level)`, capped at `80%`.
- **Resistances:** soft-punished at `1 - 0.80 * min(0.75, Res)`, so 75% resistance yields 60% mitigation.
- **Ward:** absorbs damage before HP. Recharge delay `2.0s` reduced by Wisdom; recharge rate `20%` max ward per second.
- **Ailment DPS (anti-double-dipping):** `BaseAilmentDamage * (1 + Wisdom/120) * (1 + Agility/150)`.

## 6. Execution model

`100ms` ticks, four tiers evaluated in order:

1. **Reservations** — auras and persistent buffs reserved from mana.
2. **Instant cooldowns** — instant skills fire the moment they are off cooldown.
3. **Event/energy triggers** — evaluated in snake socket order across the slot hierarchy.
4. **Active cast loop** — one cast at a time on the dedicated cast bar.

Weapon auto-attacks run on their own timer, independent of the cast loop, and hit **one enemy** unless a gem or keystone adds area damage.

Rotation:

- **AUTO:** dynamic utility score `S_i = (B_i * U_i * M_econ * M_synergy * W_doctrine) - C_waste`.
- **MANUAL:** ranked skill list edited through the `[ROT]` pill, gated by unlocked Priority Verbs. Discipline streak `+6%` per stack, cap 4, active only with `>= 2` usable active skills. `payoff` hit scaling `+15%` per active target ailment/Exposure, cap `+45%`.
- **Doctrines:** `Tactician`, `Blitz`, `Bastion`, `Weaver`, `Entropy`.

## 7. Progression and content

### Equipment

- Main hand `2x1`, up to 6 sockets; off hand `1x1`, up to 3 sockets, locked while a two-hander is equipped.
- `3x3` grid: `Amulet` / `Helmet` / `Trinket`, `Gloves` / `Chest` / `Ring 1`, `Boots` / `Legs` / `Ring 2`.
- Sockets are universal. `Bar I / II` swap actives; buffs, wards and DoTs persist across the swap.
- Rarities: `Common`, `Magic`, `Rare`, `Mythic`. Materials: `mat_scrap`, `mat_flux`, `mat_thread`, `mat_essence`.

### Skill tree

Segmented four-sector radial tree, one sector per attribute:

| Sector | Colour | Fantasy |
| --- | --- | --- |
| MIGHT | Crimson `#e05252` | Melee, weapon damage, crit, armor break |
| AGILITY | Emerald `#3eb489` | Attack speed, DoT speed, double-hit, dodge |
| WISDOM | Sapphire `#4a7be0` | Cast speed, spell power, ward, mana |
| FORTITUDE | Gold `#D4AF37` | Max HP, regen, armor, thorns |

Eight mutually exclusive keystones in four pairs: `ks_pendulum` vs `ks_hollow_fist`, `ks_lattice_skin` vs `ks_ghostframe`, `ks_festering_wound` vs `ks_void_tithe`, `ks_crowd_sovereign` vs `ks_zealots_mandate`.

### Zones

Three zones, ten tiers each, pack size `1–5`, offline progress capped at 8 hours:

| Zone id | Name | Backdrop asset |
| --- | --- | --- |
| `zone_ashen_graveyard` | Ashen Graveyard | `bg_ashen_graveyard` |
| `zone_ember_canyon` | Ember Canyon | `bg_ember_canyon` |
| `zone_frozen_cathedral` | Frozen Cathedral | `bg_frozen_cathedral` |

### Start, bosses and drops

- A new save and Reset Progress both produce a true blank slate: level 1, 0 XP/gold/materials/keys, empty bag, no demo armour, Zone 1 Tier 1, `packSize: 1`, `autoAdvanceBoss: false`. The starter weapon and one level-1 active gem are granted only through the Soul-Spark Awakening choice.
- No random or automatic boss spawns. A zone boss spawns only when the player holds 3 `key_rift` and taps **Summon Zone Boss**.
- XP curve: `XP_Required(Level) = floor(250 * Level^1.45)`, so level 2 costs 250 XP (roughly 10–12 Tier 1 kills).
- Tier 1 normal mobs sit near 75 HP and 2–3 DPS against roughly 110 starter HP.
- Tier 1 zone boss: roughly 950 HP, 26 DPS, telegraphed heavy hits.
- Drop unlocks by milestone, tracked in `SaveState`:

| Stage | Unlock condition | New drops |
| --- | --- | --- |
| 1 | Start | Gold `3–7`; basic one-stat Common gear (~15%) |
| 2 | `>= 5` kills and `>= 1` dropped gear equipped | `mat_scrap`; single-target support gems |
| 3 | `>= 30s` played at `packSize >= 2` | Cleave/AoE actives and supports; pack size `3–5` after trying `2` |
| 4 | Player HP dropped below 45% at least once | Defensive/guard actives; ward and mitigation supports |
| 5 | `level >= 3`, `>= 1` support gem linked, `>= 1` forge upgrade | `key_rift` (~22% per kill) |

## 8. UI contract

- Combat: enemy ovals with school-coloured floating damage numbers, hit flash, visible ailments with stacks and timers, auto-attack bar, dedicated cast bar (icon, name, fill `0.0s → castTime` scaled by cast speed), HP/ward/mana vials animated at `150ms ease-out`.
- Bars are clamped to `[0, 1]`; transitions are suppressed for one frame when a cycle resets to `0%`, so a bar never animates backwards.
- Tree: quadrant labels and colours drawn on the canvas, starter branch highlighted, tap-to-preview node card with one **Allocate** button.
- Modals, inspect cards and dropdowns: frosted obsidian, close on outside tap (with `stopPropagation()` inside the card), `Escape`, or a `>= 44px` `×`.
- Milestone unlocks appear as top toast pills, maximum 2, auto-fade `3.5s`, dismiss on tap, upward swipe (`dy < -24`) or horizontal swipe (`|dx| > 48`).
- Motion respects `prefers-reduced-motion` and the in-app reduced-motion setting.

## 9. Engineering rules

- `src/engine/` has no DOM, `window`, CSS or browser globals.
- Content is JSON in `src/data/`, validated by `npm run validate`.
- Art is never modified; reference it by `AssetId` from `assets/manifest.json`.
- Every content entry (active gem, support gem, weapon archetype, trinket, keystone, doctrine) carries a plain-English `description` rendered in inspect modals.
- Tests: Vitest. New behaviour gets a regression test in an existing test file.

## 10. Acceptance criteria for the overhaul

1. Reset and first boot reach the Awakening modal; each of the three starters produces the specified weapon and gem.
2. Auto-attack and cast bars advance independently; clamping is covered by tests.
3. Drops before each milestone match the stage table; no key drops before stage 5; no automatic boss spawn.
4. `npm run validate`, `npm test`, `npm run sim`, `npm run build` all pass with output quoted in the handover.
5. Browser check at 390 px and 1280 px with no overflow, clipping or console errors.

## 11. Implementation status

Updated at the end of Phase 3 (see the task handover). At the Phase 2 checkpoint the baseline was the `v0.2` slice: 154 assets, 25 bases, 30 affixes, 18 gems, 12 monsters, 3 zones, 91 nodes, 106 edges, 55 tests.
