# PATH OF WARBOUND — GAME DESIGN BIBLE (`v0.1`)

> **Document Purpose:** Complete mechanical, mathematical, and UX specification for *Path of Warbound*. Any code written in `src/engine/` or `src/data/` must match the formulas and rules defined below.

---

## 1. World Lore & Player Identity

* **Setting:** **Khorvath**, a shattered world scarred by a planar cataclysm known as **The Unmaking**, which saturated the atmosphere in raw magic lethal to mortal flesh.
* **Player Premise:** You have no physical body, character sprite, or class restriction. You are a **Soul-Spark** bound directly into **Warbound Armaments** by ancient runic smiths. Your equipped weapons, armor, relics, linked gems, and passive constellation *are* your silhouette and identity.
* **Core Pillars:** **Progress, Power, and Luck** — climb seasonal tiers through steady upgrades, build synergy, and rare drop mutations.
* **Enemy Factions:**
  * **Ashen Warlords:** Mutated survivors encased in cursed iron.
  * **Rift-Spawn:** Planar aberrations tearing through reality breaches.
  * **Hollow Reliquaries:** Rival soul-forged armaments fighting to assimilate stronger gear.

---

## 2. Core Attributes & Damage Schools

### A. The 4 Core Attributes
Every attribute scales **4 distinct combat stats** with zero overlap:

| Attribute | Fantasy | Primary Scaling Effects |
| :--- | :--- | :--- |
| **Might** | Raw Impact & Force | 1. **Weapon Base Damage** (physical & melee/ranged strikes)<br>2. **Ability Power** (flat & % offensive skill scaling)<br>3. **Critical Strike Multiplier** ($+0.5\%$ per point)<br>4. **Armor Break** (ignores a % of enemy Armor) |
| **Agility** | Tempo, Multi-Hit & DoTs | 1. **Attack Speed** (faster weapon auto-attacks & attack skills)<br>2. **Double-Hit Chance** (chance for hits to echo at $70\%$ damage)<br>3. **DoT Tick Speed** (accelerates *Bleed, Ignite, Corruption* tick rate)<br>4. **Dodge Rating** (feeds entropy-assisted evasion) |
| **Wisdom** | Arcane Mastery & Ward | 1. **Cast & Channeling Speed** (faster spells & channeled beams)<br>2. **Max Mana & Mana Regen** (sustains heavy 6-link skill costs)<br>3. **Max Ward** (recharging magical barrier protecting Health)<br>4. **Ailment Potency** (amplifies magnitude of all 5 ailments) |
| **Fortitude** | Endurance & Retaliation | 1. **Max Health** (base life pool)<br>2. **Auto-Heal (HP Regen)** (flat & % life restored per second)<br>3. **Armor** (reduces incoming physical/hit damage)<br>4. **Thorns** (reflects scaled damage back to attackers when hit) |

### B. The 5 Damage Schools & Signature Ailments
Each damage school applies **one** signature status ailment:

1. **Physical $\rightarrow$ Bleed:** Stacking physical Damage over Time (DoT).
2. **Fire $\rightarrow$ Ignite:** High-magnitude single-instance burning DoT.
3. **Frost $\rightarrow$ Chill / Freeze:** Slows enemy Attack/Cast Speed; freezes enemy action bar at maximum Chill stacks.
4. **Lightning $\rightarrow$ Shock:** Target takes $+10\%$ to $+40\%$ increased damage from all sources based on hit severity $\times$ Wisdom Potency.
5. **Void $\rightarrow$ Corruption:** Chaos/Void DoT that bypasses standard Armor and reduces enemy healing and Ward recharge by $35\%$.

---

## 3. Complete Combat & Stat Math Engine

All calculations execute in a deterministic, pure-function pipeline to guarantee zero circular loops or double-dipping bugs.

### 3.1 Master Stat Aggregation Pipeline
Every stat $X$ resolves in 4 sequential layers:
$$X_{\text{final}} = \left( X_{\text{base}} + \sum X_{\text{flat}} \right) \times \left( 1 + \sum \%X_{\text{increased}} \right) \times \prod \left( 1 + \%X_{\text{more}} \right)$$

* **`Increased` Pool (Additive):** Standard gear affixes and minor/notable tree nodes sum together into one multiplier.
* **`More` Pool (Multiplicative):** Reserved for **Support Gems**, **Keystones**, and **Combat Doctrines**.

### 3.2 Two-Pass One-Way DAG Conversions
Conversions execute once per stat refresh in two strict forward-only directed acyclic graphs (DAGs):
* **Pass 1 (Attributes & Defenses):**
  $$\text{Might} \rightarrow \text{Agility} \rightarrow \text{Wisdom} \rightarrow \text{Fortitude}$$
  $$\text{Armor} \rightarrow \text{Ward} \rightarrow \text{Dodge}$$
* **Pass 2 (Damage Schools):**
  $$\text{Physical} \rightarrow \text{Fire} \rightarrow \text{Frost} \rightarrow \text{Lightning} \rightarrow \text{Void}$$

### 3.3 Hit Damage, Crit & Double-Hit
1. **Raw Hit Roll:**
   $$D_{\text{raw}} = \text{Roll}(D_{\min}, D_{\max}) \times \text{SkillEffectiveness} \times \left(1 + \frac{\text{Might}}{100}\right)$$
2. **Critical Strike Check:** Roll against $\text{CritChance}$ (capped at $100\%$). On Crit:
   $$D_{\text{crit}} = D_{\text{raw}} \times \left(1.50 + \text{BonusCritMulti} + \frac{\text{Might}}{200}\right)$$
3. **Double-Hit Check (Agility):**
   $$P_{\text{double}} = \min\left(0.75, \frac{\text{Agility}}{\text{Agility} + 250}\right)$$
   On success, the strike echoes immediately at **$70\%$ damage** and triggers on-hit effects/ailments.

### 3.4 Defense, Ward & Soft-Punishment Resistances
* **Entropy-Assisted Dodge:** Maintain an `entropyCounter` starting at `0`. Each incoming hit adds $\text{DodgeChance}$ (`0–75`). When `entropyCounter >= 100`, the hit is Dodged and `entropyCounter -= 100`.
* **Armor Mitigation (vs. Enemy Zone Level $L_{\text{enemy}}$):**
  $$\text{DR}_{\text{armor}} = \frac{\text{Armor}}{\text{Armor} + 45 \times L_{\text{enemy}}} \quad (\text{Capped at } 80\%)$$
* **Soft-Punishment Elemental & Void Resistances:** Baseline resistance starts at $0\%$ and caps at $75\%$ (mitigating up to $60\%$ of damage):
  $$D_{\text{after\_res}} = D_{\text{incoming}} \times \left(1 - 0.80 \times \min(0.75, \text{Res})\right)$$
* **Ward Barrier:** Absorbs post-mitigation damage before Health. Begins recharging after **$2.0\text{s}$** without taking hit damage (delay reduced by Wisdom), recovering **$20\%$ Max Ward per second**.

### 3.5 Ailment & DoT Scaling (Anti-Double-Dipping)
Base ailment damage ($D_{\text{base\_ailment}}$) is derived from the **pre-mitigation Base Hit** and scaled independently by Wisdom and Agility:
$$\text{DPS}_{\text{DoT}} = D_{\text{base\_ailment}} \times \left(1 + \frac{\text{Wisdom}}{120}\right) \times \left(1 + \frac{\text{Agility}}{150}\right)$$

### 3.6 Gearscore Formula
Displayed in the Equipment Header as an accessible progression metric:
$$\text{Gearscore}_{\text{item}} = \left(\text{ItemLevel} \times 10\right) + \sum_{k=1}^{n} \left(\text{AffixTier}_k \times 15\right) + \left(\text{LinkedSockets} \times 25\right)$$

---

## 4. Equipment, Weapons & Gem Links

### 4.1 Loadout Slots & Socket Caps
* **Column 1 (Weapon Pillar):**
  * **Main-Hand Weapon (`2x1` tall):** Up to **6 Sockets** (2H) or **3 Sockets** (1H). Equipping a 2H Weapon visually spans and locks the Offhand slot.
  * **Offhand (`1x1`):** Up to **3 Sockets** (*Shield*: Block + Thorns; *Focus*: Max Ward + Cast Speed; *Dual Wield 1H*: $+15\%$ Attack Speed & Double-Hit).
* **Columns 2–4 (`3x3` Grid):**
  * **Row 1:** Amulet (`1` Socket) | Helmet (`4` Sockets) | Trinket (`1` Socket)
  * **Row 2:** Gloves (`4` Sockets) | Chest (`6` Sockets) | Ring 1 (`1` Socket)
  * **Row 3:** Boots (`4` Sockets) | Legs (`4` Sockets) | Ring 2 (`1` Socket)
* **Trinket Rule:** Trinkets never roll generic flat stats; every Trinket grants a unique rule-bending passive.

### 4.2 Weapon Auto-Attack Implicits
Your equipped Main-Hand weapon drives the dedicated **Auto-Attack Bar** below the 5-slot skill bar, generating base Mana on hit and triggering archetype implicits:

| Archetype | Handedness | Base Speed | Signature Auto-Attack Implicit |
| :--- | :--- | :--- | :--- |
| **Dagger** | 1H | `1.6 / s` | **50% chance** to apply 1 stack of **Corruption/Poison**; $+25\%$ Crit Chance. |
| **Sword** | 1H / 2H | `1.3 / s` | Every 3rd swing cleaves up to **3 enemies** and grants $+10\%$ Attack Speed for `3s`. |
| **Mace / Hammer** | 1H / 2H | `1.0 / s` | **30% chance** to **Daze** target ($-20\%$ enemy Attack Speed & Damage for `3s`). |
| **Axe** | 1H / 2H | `1.2 / s` | Inflicts **Bleed** on critical strikes; deals $+25\%$ damage to Bleeding targets. |
| **Wand / Scepter** | 1H | `1.4 / s` | Restores **4% Max Mana** per hit and applies minor **Elemental Exposure**. |
| **Staff** | 2H | `1.05 / s` | Refreshes **1.0s** of active DoTs/Debuffs on hit and accelerates **Ward Recharge**. |

### 4.3 Universal Sockets & Gem Progression
* **No Color RNG:** All sockets are universal; any Active or Support Gem fits any socket.
* **Gem XP (`Lv. 1–20`):** Socketed gems gain passive combat XP. Duplicate gem drops auto-salvage into **Gem Dust** used to level or quality-boost gems.
* **Dual Swappable Bars (`Bar I` & `Bar II`):** Players assign socketed Active Gems to **Bar I**, **Bar II**, or **Both**, and tap to swap mid-fight. Active Buffs, Wards, and DoTs continue ticking for their full remaining duration after a bar swap.

---

## 5. Automated Combat Engine & Doctrines

### 5.1 Four Execution Tiers
1. **Persistent Reservations:** Auras, Heralds, and Aspects reserve Mana/Spirit pre-combat.
2. **Instant Cooldown Automation:** Zero-cast-time buffs/warcries trigger immediately off cooldown.
3. **Condition & Energy Triggers:** Event triggers (*Cast on Crit, Cast when Damage Taken, Mark on Hit, Hextouch*) and Energy-accumulation triggers fire linked spells asynchronously. A gem may have at most **one** trigger source, though triggers can chain.
4. **Active Cast Loop:** Non-triggered Active Gems on the active Bar compete for animation ticks via the **Dynamic Utility Score ($S_i$)**.

### 5.2 Deterministic Tie-Breaker Priority
When multiple triggers fire on the same tick, resolve **Socket 1** across all gear before **Socket 2** (snake order `1 -> 2 -> 4 -> 3 -> 5 -> 6`) in strict slot priority:
`Chest -> Left Ring -> Main Hand -> Right Ring -> Offhand -> Helmet -> Amulet -> Gloves -> Boots -> Legs -> Trinket`.

### 5.3 Dynamic Utility Score Formula ($S_i$)
On every available action tick, evaluate each ready non-triggered Active Gem $i$ on the active bar:
$$S_i = \left( B_i \times U_i \times M_{\text{econ}} \times M_{\text{synergy}} \times W_{\text{doctrine}} \right) - C_{\text{waste}}$$

* **$B_i$ (Base Role Weight):** `Emergency Recovery` (`95`) > `Curse / Exposure / Mark` (`85`) > `Offensive Buff / Warcry` (`80`) > `Cooldown Nuke` (`75`) > `Primary Clear / Filler` (`55`).
* **$U_i$ (Battlefield Urgency, `0.05 – 3.0`):** `1.2` for missing/expiring (`<1.5s`) debuffs, dropping to `0.05` while active; $+0.25$ per extra enemy for AoE skills; $+0.60$ vs. Elites/Bosses for single-target skills; scales exponentially as EHP approaches the Doctrine's survival threshold.
* **$M_{\text{econ}}$ (Resource Lookahead, `0.2 – 1.2`):** Drops to `0.25` on filler skills if spending Mana would starve a high-priority skill coming off cooldown within `1.2s`.
* **$M_{\text{synergy}}$ (Combo Multiplier, `1.0 – 2.0`):** Boosts payoff skills by $+30\%\text{ to }+80\%$ when targets have *Exposure, Shock, Freeze, or Corruption*, or when player holds max charges.
* **$W_{\text{doctrine}}$ (Playstyle Multiplier, `0.0 – 2.5`):** Set by the active Combat Doctrine.
* **$C_{\text{waste}}$ (Overkill & Telegraph Penalty, `0 – 150`):** Deducts up to `80` points if a long-cooldown nuke's minimum hit exceeds target remaining HP by $>200\%$; deducts points from slow animations if a boss telegraph will land before cast completion.

### 5.4 The 5 Combat Doctrines

| Doctrine | Archetype | Behavioral Overrides & Signature Perk |
| :--- | :--- | :--- |
| **Tactician** | Adaptive Baseline | Balanced AoE/Boss logic; triggers defensive Guards at **45% HP**. |
| **Blitz** | Kill Before Killed | Front-loads offensive buffs; delays Guards until **<20% HP**; ignores $C_{\text{waste}}$ telegraph checks. **Perk:** $+15\%$ Attack/Cast Speed for `3s` on kill. |
| **Bastion** | Defensive / Counter | Predictive Guard casting at **75% HP** or before enemy heavy windups. **Perk:** $+25\%$ Defensive CDR; blocked hits refund `5%` resource. |
| **Weaver** | Patient / DoT | Suppresses DoT payoff skills (`0.2x`) until Curses/Exposure are active; never overwrites DoTs with $>15\%$ duration left. **Perk:** $+20\%$ ailment damage vs. targets with $\ge 3$ debuffs. |
| **Entropy** | Chaos / Cascade | Locks $M_{\text{econ}} = 1.0$; adds $\pm 35\%$ random variance to $S_i$ each tick. **Perk:** Triggered skills have `20%` chance to ignore ICD and fire twice at `0.7x–1.6x` power. |

---

## 6. Segmented Radial Constellation (Skill Tree)

* **Topology:** 4 Attribute Sectors (*Might, Agility, Wisdom, Fortitude*) radiating from central `hub_0` across **3 concentric tiers** (Inner generalist, Mid school/ailment, Outer specialist).
* **Design Unit ("Petal"):** **1 Notable + 2 to 3 Minors**. Any two Notables across a sector border are at most 2 Minors apart.
* **Node Scale:** Full architecture is **~180 nodes** (~75 endgame points); `v0.1` seeds **~90 nodes** (2 petals per sector + all 8 Keystones + 6 Jewel/Relic Sockets, ~40 skill points).
* **Anti-Bloat Rules:** No node under `3%` effective impact; no pure filler travel nodes; every Notable carries semantic tags (`bleed`, `ward`, `swap`, `autoattack`, etc.).
* **Mobile Touch UX (`390px`):** Pan/pinch canvas with `44px` minimum tap targets. **1st Tap** runs multi-source BFS to highlight the shortest path and point cost; **2nd Tap** confirms allocation. **Long-Press** displays stat diff. **Refund Mode** runs Tarjan's articulation-point check to grey out bridge nodes and list stranded nodes before confirming.

### The 8 Mutually Exclusive Keystones

1. **Pendulum** *(Excludes: Hollow Fist)* — Bars swap automatically every `5s`. Gain `30%` **more** damage for `3s` after a swap. Manual bar swap disabled.
2. **Hollow Fist** *(Excludes: Pendulum)* — Weapon auto-attack implicits are doubled and deal `40%` **more** damage. Active skills deal `25%` **less** damage and cost `50%` **more** Mana.
3. **Lattice Skin** *(Excludes: Ghostframe)* — Armor no longer mitigates hit damage. Gain Max Ward equal to `60%` of Armor. Ward recharge delay is fixed at `2.0s`.
4. **Ghostframe** *(Excludes: Lattice Skin)* — Dodge Rating cap is doubled. Each Dodge triggers a Thorns burst equal to `15%` of Dodge Rating. Max Health `-40%`.
5. **Festering Wound** *(Excludes: Void Tithe)* — Ailments stack up to `3` simultaneous instances instead of only the strongest. Each instance has `40%` potency; Ailment duration `-30%`.
6. **Void Tithe** *(Excludes: Festering Wound)* — `50%` of Physical damage converted to Void. Corruption potency `+50%`. You take self-Corruption equal to `3%` Max HP every `5s` (absorbable by Ward).
7. **Crowd Sovereign** *(Excludes: Zealot's Mandate)* — Pack Size forced to minimum `4`. Deal `25%` **more** damage per enemy present (max 5) and take `15%` **more** damage per enemy. Elite spawn chance doubled.
8. **Zealot's Mandate** *(Excludes: Crowd Sovereign)* — Locked to your selected Combat Doctrine, doubling its signature perk and weight bonuses. All other 4 Doctrines are disabled.

---

## 7. Progression Loop, Economy & Mobile Portrait UI

### 7.1 Zone Pacing, Pack Size & Rift Keys
* **Zones & Tiers:** 3 zones in `v0.1` (*Ashen Outskirts, Sunken Bastion, Rift-Scarred Wastes*), **10 Tiers** each.
* **Pack Size Control (`1 – 5`):** Player adjusts concurrent enemy spawns (`1` to `5`). Each enemy slot rolls independently for Elite status with probability $p_{\text{elite}} \in [0.12, 0.20]$:
  $$P(\text{All 5 Elites}) = p_{\text{elite}}^5$$
* **Rift Keys & Death Penalty:** Farming zone waves drops **Rift Keys**. Once **3 Rift Keys** are collected, the player can summon the **Zone Boss** (or keep farming to bank extra keys for back-to-back boss runs). **Dying sets the player back 1 Zone Tier.**
* **Offline Progression:** Farms the exact zone, tier, and pack size active at logout, granting **XP, Gold, and abundant basic materials** (never defeats new Zone Bosses offline).

### 7.2 Rarity Tiers & 4 Core Crafting Materials
* **4 Rarity Tiers:** `Common` $\rightarrow$ `Magic` $\rightarrow$ `Rare` $\rightarrow$ `Mythic / Relic`.
* **4 Core Materials (`v0.1`):**
  1. **War-Scrap** *(Abundant)*: Upgrades gear slot level (`+1, +2...`) and rerolls numeric affix values.
  2. **Runic Flux** *(Common)*: Rerolls random affixes on Magic/Rare gear or upgrades Magic $\rightarrow$ Rare.
  3. **Link-Thread** *(Uncommon)*: Adds universal sockets and fuses links up to slot maximum.
  4. **Rift Essence** *(Elite/Boss Drop)*: Locks 1 chosen affix while rerolling the rest, or corrupts a max-rank item/gem for a high-risk implicit mutation.

### 7.3 Mobile Portrait Screen Architecture (`390px` Width)
1. **Combat Screen:** Top Soul-Core header (Title, Doctrine tag, Level/XP bar, Settings) $\rightarrow$ Ornate Combat Viewport (left vertical crimson HP/Ward vial, right vertical sapphire Mana vial, Zone/Tier banner, up to 5 oval enemy cards with floating hits/ailments, 5-slot active skill bar + Bar I/II toggle + Auto-Attack progress bar) $\rightarrow$ Scrollable lower telemetry dashboard (`Damage Meter`, `Timers`, `Stats`, `XP/Gold/Kills/Drops per Hr`, `Combat Log`, `Loot Log`).
2. **Equipment Screen:** Top header (Soul Core, Gearscore, Doctrine dropdown, `[Stats]` button, 4 Primary Attributes) $\rightarrow$ Center Altar (`Weapon [2x1] + Offhand [1x1]` in Column 1 beside `3x3` Armor/Jewelry/Trinket grid). Tapping `[Stats]` or any item opens a frosted translucent glass overlay (`85%` opacity) dismissible by tapping outside.
3. **Skill Tree Screen:** Full-viewport interactive `390px` radial constellation canvas with pan/pinch zoom, tap-to-path preview, refund mode toggle, and unspent point counter.
