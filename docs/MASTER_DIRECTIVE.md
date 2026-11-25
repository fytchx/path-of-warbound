# MASTER DIRECTIVE — Path of Warbound (v1.0 full-send build)

> Single source of truth for the shipped game, its numbers and its engineering rules.
> `STARTHERE.md` holds repository safety; `docs/ACTIVE_INSTRUCTIONS.md` holds the working checklist.
> This document supersedes every earlier phase checklist. Nothing here is "parked".

## 1. Vision & identity

You are a disembodied **Soul-Spark** bound into **Warbound Armaments**, fighting monstrous horrors across darkened realms. The fantasy is intimidation and quiet power: an intimidating monster in the background, a game simple enough for one developer to finish, deep enough for theorycrafters, effortless for the average player.

**Zero human faces or character portraits anywhere.** The header emblem is always `fx_soulspark` inside `#w-medal`. Enemy art is monster-only.

Layout is **portrait-only mobile-first**: `390px`–`420px`, letterboxed on desktop. All five bottom tabs (**COMBAT**, **ALTAR**, **TREE**, **BAG**, **FORGE**) are unlocked from boot with `>= 44px × 44px` touch targets.

### Hard technical guardrails

1. Never modify or regenerate `assets/` or `warbound-sprite.svg`. Reference only `AssetId` keys from `assets/manifest.json` (154 validated assets). Socket colours, link bars, slash arcs, cast bars and telegraphs are CSS/SVG/Canvas overlays.
2. `src/engine/` is 100% pure headless TypeScript: no DOM, `window`, `document` or CSS. Combat, timers, drops, gates and rotation AI run deterministically on a **100 ms tick** (10 ticks/sec).
3. `scripts/validate-data.ts` stays in sync. New data fields are typed in `src/data/types.ts` and validated by `npm run validate`.
4. Never commit or push without explicit approval.

## 2. Combat feel

### Independent auto-attack and cast bar

- **Weapon Auto-Attack Bar** hits **one** enemy (no default cleave) on its own progress bar. Base rates: `weapon_dagger 1.6/s`, `weapon_sword 1.3/s`, `weapon_staff 1.05/s`, scaled by attack speed. Reset snaps to `0%` for one frame with transitions suppressed so it never animates backwards.
- **Dedicated Cast Bar** for any active gem with `castTime > 0`: gem icon, gem name, school glow, exact timer (`0.0s -> 1.5s`) scaled by cast speed. The weapon bar keeps ticking and swinging while the spell charges.
- Instant skills (`castTime === 0`) fire immediately off cooldown.

### Telegraphing

- Every weapon swing flashes a directional slash arc over the struck enemy oval plus a `120 ms` hit-recoil micro-shake.
- Instant melee skills flash a golden-crimson crescent; timed spells launch a school-coloured pulse from the cast bar into the target; AoE skills pulse every living enemy oval.
- **Floating combat text** by school: Physical `#f0ece1`, Fire `#ff7b29`, Frost `#5ce1e6`, Lightning `#ffe047`, Void `#b87aff`, Poison/DoT `#4be37a` (compact). Critical hits are `1.35x`, bold, suffixed `!`, with a golden flare.
- Every enemy oval shows sprite, name, tier badge, HP bar, ailment badges (icon + stacks + duration ring), and an **enemy attack bar** that flashes amber before a swing.
- Every monster and zone boss owns at least one **telegraphed heavy ability** with a `1.2s–1.8s` wind-up, a pulsing crimson/gold oval border and a warning banner (`⚠ TELEGRAPH: CRUSHING SLAM — 1.4s`). Guard, Dodge, Ward and the `Telegraph punish` verb answer it.
- Arena atmosphere: drifting CSS embers/ash/frost motes over `#w-backdrop`, dark vignette, and a cyan Ward shell around the health/ward vials while `currentWard > 0`.

## 3. Gem & socket colour system

### Colours and attributes

| Colour | Attribute | Identity |
| --- | --- | --- |
| Crimson `red` | Might | Melee, slams, physical, bleed, armour-break, warcries, guard/thorns, melee/life supports |
| Emerald `green` | Agility | Fast daggers, poison, projectiles/chains, dodge/attack-speed/DoT supports |
| Sapphire `blue` | Wisdom | Spells, cast-bar nukes, elemental/void magic, curses, ward, cast/ailment supports |
| Prismatic `white` | Universal | Wildcard socket accepts any gem; white gem fits any socket |

### Socket rules

- A coloured gem fits a **matching-colour socket** or a **Prismatic (`white`) socket**.
- **White socket** accepts `red`, `green`, `blue`, `white`. **White gem** fits any socket colour.
- Linked sockets (`linkGroup`) connect Supports to Actives **regardless of colour**, provided the support's `allowedTags` match the active gem's `tags`.
- Starter weapons always spawn with a matching socket: Sword `Red`, Staff `Blue`, Dagger `Green`.

### Socket generation (attribute-weighted)

- Might base: ~`70%` Red, `12%` Green, `12%` Blue, `6%` White.
- Agility base: ~`70%` Green, `12%` Red, `12%` Blue, `6%` White.
- Wisdom base: ~`70%` Blue, `12%` Red, `12%` Green, `6%` White.
- Fortitude / hybrid: balanced split with ~`8%` White.

### Chromatic crafting (Forge + item inspect)

New material **Chromatic Flux** (`mat_chroma`), dropped by enemies and yielded when salvaging socketed gear.

- **Chromatic Reforge** — `1 mat_chroma`: reroll all socket colours weighted by the base attribute; never repeats the exact same colour sequence.
- **Targeted Colour Craft** — `2 mat_chroma + 3 mat_flux`: force one selected socket to Red, Green or Blue.
- **Prismatic Infusion** — `5 mat_chroma + 2 mat_essence`: convert one selected socket to White.

## 4. Mathematics & combat engine

### Four core attributes (four vectors each)

- **Might:** `+1.5%` weapon base damage/pt, `+1.0%` melee/physical ability power/pt, `+0.5%` crit multiplier/pt, `+1.5` flat armour break/pt.
- **Agility:** `+0.8%` attack speed/pt, double-hit `min(0.75, Agi / (Agi + 250))` echoing at `70%`, `+0.7%` DoT tick speed/pt, `+2.5` flat dodge rating/pt.
- **Wisdom:** `+0.8%` cast speed/pt, `+3` max mana and `+0.25` regen/s/pt, `+4` max ward/pt, `+0.85%` ailment potency/pt.
- **Fortitude:** `+6` max HP/pt, `+0.3` HP regen/s/pt, `+3` flat armour/pt, `+1.5` flat thorns/pt.

### Schools and ailments

| School | Ailment | Rule |
| --- | --- | --- |
| Physical | Bleed | Stacking physical DoT, bonus when the target acts |
| Fire | Ignite | High-magnitude burning DoT |
| Frost | Chill / Freeze | Slows attack and telegraph speed; freezes the action bar at max stacks |
| Lightning | Shock | Target takes `+10%` to `+40%` more damage |
| Void | Corruption | Armour-bypassing void DoT, `-35%` enemy healing/ward recharge |

### Stat pipeline

`Final(X) = (Base(X) + ΣFlat) × (1 + ΣIncreased%/100) × Π(1 + More%/100)`

- **Pass 1:** Might → Agility → Wisdom → Fortitude, and Armor → Max Ward → Dodge Rating.
- **Pass 2:** Physical → Fire → Frost → Lightning → Void. Forward-only; no backward loops.

### Defences

- Entropy Dodge accumulator prevents streak deaths.
- Armour mitigation `Armor / (Armor + 45 × EnemyLevel)`, cap `80%`.
- Resistances `1 - 0.80 × min(0.75, Res)`.
- Ward absorbs before HP, recharges `2.0s` after damage (Wisdom-reduced) at `20%` max ward/s.
- DoT DPS `BaseAilmentDamage × (1 + Wisdom/120) × (1 + Agility/150)`; never double-dips hit multipliers.

### Rotation

- Every socketed active gem on the active bar (Bar I / Bar II) is evaluated each tick. Baseline `100` max mana, `12/s` regen, `+4` mana per weapon auto-attack.
- **AUTO** (default): `S_i = (B_i × U_i × M_econ × M_synergy × W_doctrine) - C_waste`.
- **MANUAL** (`[ROT]` modal): ranked skill order + priority verbs, Discipline Streak (`+6%` per stack, cap 4, needs `>= 2` usable actives), payoff `+15%` more hit damage per target ailment/Exposure (cap `+45%`).

## 5. Progression locks, tiers and keys

- Start with `unlockedTierByZone = { zone_ashen_graveyard: 1 }`; Zones 2 and 3 locked. The save keys by zone id (`zone_ashen_graveyard`, `zone_ember_canyon`, `zone_frozen_cathedral`); `bg_*` are their backdrop asset ids.
- Tier `+` cannot exceed `unlockedTierByZone[zoneId]`. At cap it is disabled and toasts *"Defeat the Tier N Zone Boss to unlock Tier N+1."*
- Defeating a zone's Tier `N` boss unlocks Tier `N+1` (cap 10). Zone 1 Tier 1 boss also unlocks Zone 2 (Tier 1); Zone 2 Tier 2 boss unlocks Zone 3 (Tier 1).
- Bosses **never** auto-spawn. At `3/3` keys a glowing **⚔ Summon Tier N Boss** button appears.
- **Rift Key drop:** after `>= 6` normal kills or Level `>= 2`, `28%` per kill with a pity counter guaranteeing one within 5 kills, until `3/3`. Logs `🔑 Rift Key found! (2/3)`.
- Tier 1 normal mobs deal ~`2.5 DPS` against ~`115` starter HP.
- **XP curve:** `XP_Required(Level) = floor(220 × Level^1.45)`.
- **Milestone loot:**
  - 0–3 kills: gold `4–8`, Common 1-stat gear `22%`, `1.4x` starter-archetype bias.
  - 4+ kills: `mat_scrap 35%`, `mat_chroma 18%`, single-target Support Gems `12%`.
  - 6+ kills or Level 2+: `key_rift 28%` + 5-kill pity.
  - 30s+ with Pack Size `>= 2`: Cleave/AoE gems enter the pool; Pack Size `3–5` after Pack Size `2`.
  - Dropped below `50% HP` once: Defensive/Guard/Ward gems enter the pool.

## 6. Content catalog

- **Items (`src/data/items.json`, 28+ bases):** main hand (1H/2H swords, daggers, staves, maces, wands), off hand (shields, focuses, quivers/off-daggers), helmet, chest, gloves, boots, legs, amulet, trinket, ring. Every base has a plain-English `description`.
- **Gems (`src/data/gems.json`, 24+):** 5 Red actives + 3 Red supports, 5 Green actives + 3 Green supports, 5 Blue actives + 3 Blue supports, 1 White Prismatic gem. Every gem has `color` and `description`.
- **Affixes (`src/data/affixes.json`, 36):** attributes, weapon damage, spell power, attack/cast speed, crit, school damage/conversions, HP, armour, ward, dodge, resistances, mana regen.
- **Monsters (`src/data/monsters.json`):** 12 normal/elite across the three zones plus 3 dedicated zone bosses, each with a named `telegraph`.
- **Tree / doctrines / verbs:** 91 radial nodes in 4 colour-coded quadrants (`MIGHT`, `AGILITY`, `WISDOM`, `FORTITUDE`), 8 mutually exclusive keystones, 5 doctrines, 12 priority verbs.

## 7. UI

- **Bag:** pinned currency strip (Gold, Gem Dust, Chromatic Flux, War-Scrap, Aether-Flux, Soul-Thread, Void-Essence) and a `50/50` split: left `GEAR` list, right `GEMS` list, both scrollable, rarity borders and socket colour pips (`R/G/B/W`).
- **Altar:** tap an empty slot → frosted picker of bag items that fit; tap an occupied slot → item inspect with full stats, description, clickable `>= 44px` socket rings and link bars. Empty socket → filtered gem picker (mismatched dimmed with *"Recolor in Forge"*). Filled socket → stats + Unsocket/Swap. Bottom row: Swap Gear, Unequip, Recolor/Upgrade.
- **Forge:** item selector, Upgrade Item Level, Reforge Affixes, Chromatic Reforge, Targeted Socket Colour, Prismatic Infusion.
- **Tree:** four colour-coded sector labels, glowing starter path, tap-to-preview card with one-tap Allocate.
- **Modals:** frosted obsidian `rgba(11, 14, 22, 0.85)` + `backdrop-filter: blur(8px)`, close on backdrop tap, `Escape` or `×` (`>= 44px`). Toasts dismiss on tap or swipe.

## 8. Verification

- `npm run validate`, `npm test`, `npm run sim`, `npm run build` must pass in the session.
- Tests cover: blank reset + awakening starters with matching socket colours; independent cast bar alongside auto attacks and telegraphs; strict tier locking and boss unlocks; rift-key pity and manual summoning; socket colour matching, cross-colour linked supports and deterministic recolouring.
- Browser check at `390px` for all five tabs plus Awakening and slot/socket modals: zero page errors, zero horizontal overflow.
- Finish with the 6-section handover rundown and stop before commit/push.
