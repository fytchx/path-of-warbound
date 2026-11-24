# ACTIVE DEVELOPMENT INSTRUCTIONS — `v0.1` PHASE 1

> **Current Focus:** Build and verify the **100% Headless Math, Skill Tree, and Combat Simulation Engine** (`src/engine/`, `src/data/`, `src/sim/`, `tests/`).
> **Strict Rule:** Do **NOT** create UI components, HTML/CSS layouts, or backend networking code during Phase 1.

---

## Step-by-Step Build Checklist

### Task 1: Project Scaffolding & Core Data Registries (`src/data/`)
1. Initialize a clean TypeScript project (`tsconfig.json` with `"strict": true`, Vitest or Node test runner).
2. Create `src/data/stat_registry.json` containing all canonical stats defined in `docs/DATA_SCHEMAS.md`.
3. Create starter `v0.1` JSON registries:
   - `src/data/gems.json`: 8 Active Skill Gems (covering Physical, Fire, Frost, Lightning, Void, Guard, Curse/Debuff, and Aura) + 10 Support Gems (including *Multistrike*, *School Shift*, *Cast on Crit*, *Cast when Damage Taken*, *Life Leech*, *Ailment Proliferation*).
   - `src/data/items.json` & `src/data/affixes.json`: All 6 Weapon Archetypes with auto-attack implicits, 1–2 base items per slot across the `3x3 + Weapon/Offhand` grid, 3 rule-breaking Trinkets, and Tier 1–5 affixes.
   - `src/data/skill_tree.json`: Seeded radial constellation (~90 nodes: `hub_0`, 2 Petals per attribute sector, all 8 mutually exclusive Keystones, and 6 Jewel Sockets).
   - `src/data/zones.json`: 3 zones (*Ashen Outskirts, Sunken Bastion, Rift-Scarred Wastes*), 10 tiers each, `3` Rift Keys per boss.
4. Create `tests/validateData.test.ts` enforcing all 4 CI validation rules from `docs/DATA_SCHEMAS.md`.

### Task 2: Pure Stat Aggregation & Two-Pass Conversion Engine (`src/engine/stats.ts`)
1. Implement `computePlayerStats(saveState, registries)` as a pure function with zero side effects:
   - Gather base stats, allocated tree mods, equipped item implicits/affixes, active persistent gem reservations, and conditional buffs.
   - Resolve `Base -> Flat -> Increased (additive) -> More (multiplicative)`.
   - Execute **Pass 1** (`Might -> Agility -> Wisdom -> Fortitude` and `Armor -> Max Ward -> Dodge Rating`) and **Pass 2** (`Physical -> Fire -> Frost -> Lightning -> Void`) forward-only conversions.
   - Compute derived combat metrics: Crit Multi, Double-Hit chance, Armor DR vs. enemy level, Soft-Punishment Resistances, DoT Tick Rate, Ailment Potency, and Gearscore.
2. Write unit tests in `tests/stats.test.ts` verifying additive vs. multiplicative stacking, conversion order, and resistance mitigation curves.

### Task 3: Radial Skill Tree Graph Engine (`src/engine/treeGraph.ts`)
1. Build adjacency maps from `skill_tree.json` on load.
2. Implement:
   - `canAllocate(allocated, nodeId, availablePoints)` (checks adjacency, points, and Keystone mutual exclusions).
   - `pathTo(allocated, targetId)` (multi-source BFS returning shortest node path and total point cost).
   - `strandedAfterRemoval(allocated, removeId, rootId)` and `getArticulationPoints(allocated, rootId)` (Tarjan's algorithm).
3. Write unit tests in `tests/treeGraph.test.ts` covering BFS pathing, Keystone mutual exclusion blocks, and safe vs. stranded node refunds.

### Task 4: Tick-Based Combat & Doctrine AI Engine (`src/engine/combatEngine.ts`)
1. Implement a deterministic fixed-timestep combat loop (`100ms` ticks = `10 ticks/sec`):
   - **Wave Spawner:** Spawns `1..5` enemies per player `packSize`, rolling independent Bernoulli Elite checks (`p_elite^5` jackpot support), dropping Rift Keys on kills, and handling Zone Boss summons (`3` keys) plus `-1` tier rollback on player death.
   - **Auto-Attack Bar:** Runs weapon swing timer, applies weapon archetype implicits (Dagger Poison, Mace Daze, Axe Bleed, Sword Cleave, Wand Mana restore, Staff DoT refresh), and rolls Double-Hit.
   - **4-Tier Skill Execution & Bar Swapping:** Resolves Reservations $\rightarrow$ Instant Cooldowns $\rightarrow$ Event/Energy Triggers (with strict Gear/Socket tie-breaker order) $\rightarrow$ Dynamic Utility Score ($S_i$) across `Bar I` / `Bar II` modulated by the active **Combat Doctrine** (*Tactician, Blitz, Bastion, Weaver, Entropy*).
   - **Ailment & Defense Ticks:** Processes Bleed, Ignite, Chill/Freeze, Shock, Corruption (including *Festering Wound* 3-stack Keystone), Entropy Dodge, Ward recharge delay (`2.0s`), HP Regen, and Thorns.

### Task 5: Headless CLI Balance Simulator (`src/sim/runSim.ts`)
1. Build a CLI script (`npm run sim`) that simulates 10,000 combat ticks across sample builds (e.g., *Blitz Dagger Poison*, *Bastion Mace Thorns*, *Pendulum Dual-Bar Caster*) and outputs:
   - Average DPS, Damage Breakdown by source, Ailment uptime, Death rate, Kills/Hr, and Rift Keys/Hr.
2. Verify all unit tests and simulator runs pass cleanly, then **STOP and present a file summary for user approval before any Git commit**.
