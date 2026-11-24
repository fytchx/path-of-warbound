# ACTIVE DEVELOPMENT INSTRUCTIONS — `v0.1` Tier 1 → Tier 2 Onboarding Loop & Combat Feel

> **Current Phase:** `v0.1 Tier 1 → Tier 2 Onboarding Loop, Combat Feel & Repo Cleanup`
> **Current Focus:** Deliver a crisp first-boot experience (`zone_ashen_graveyard` Tier 1, `packSize: 1`), deterministic 10-kill starter drop deck, Soul-Spark Whisper guidance, Boss Heavy Slam telegraph, 60fps UI polish, and verified CLI simulator + asset report scripts. Engine code in `src/engine/` remains 100% pure headless TypeScript.

---

## Step-by-Step Build Checklist

### Task 1: Project Scaffolding & Core Data Registries (`src/data/`)
- [x] Initialize TypeScript project (`tsconfig.json` with `"strict": true`, Vitest + Vite).
- [x] Create `src/data/stat_registry.json` containing all canonical stats defined in `docs/DATA_SCHEMAS.md`.
- [x] Create starter `v0.1` JSON registries (`gems.json`, `items.json`, `affixes.json`, `skill_tree.json`, `zones.json`, `monsters.json`, `doctrines.json`, `progression.json`).
- [x] Validate all registries via `scripts/validate-data.ts` and `tests/data.test.ts`.

### Task 2: Pure Stat Aggregation & Two-Pass Conversion Engine (`src/engine/stats.ts`)
- [x] Implement `computePlayerStats(save)` as a pure function with zero side effects, respecting `linkedSockets` and `save.skillSlots`.
- [x] Verify additive vs. multiplicative stacking, two-pass conversions, and resistance mitigation curves in `tests/stats.test.ts`.

### Task 3: Radial Skill Tree Graph Engine (`src/engine/treeGraph.ts`)
- [x] Build adjacency maps from `skill_tree.json` with BFS shortest-path allocation (`canAllocate`, `pathTo`) and Tarjan articulation point refund guards (`getArticulationPoints`, `strandedAfterRemoval`).
- [x] Verify in `tests/treeGraph.test.ts`.

### Task 4: Tick-Based Combat, Onboarding Pacing & Doctrine AI (`src/engine/combatEngine.ts`)
- [x] Deterministic `100ms` tick loop with Tier 1 (`~70–90 HP`) → Tier 1 Boss (`850 HP`, Heavy Slam telegraph) → Tier 2 (`~180–240 HP`) pacing, safe Tier 1 death, and manual/auto Boss summon.
- [x] Verify deterministic simulation, boss summon, Tier 2 scaling, and safe Tier 1 death in `tests/combatEngine.test.ts`.

### Task 5: Headless CLI Balance Simulator & Asset Reporting (`src/sim/index.ts`, `scripts/optimize-webp.ts`)
- [x] Implement `src/sim/index.ts` (`npm run sim`) across 4 sample builds for 10,000 ticks (`1,000s`) at Zone 1 Tier 1 & Tier 3.
- [x] Implement `scripts/optimize-webp.ts` (`npm run report-assets`) without mutating `assets/`.
- [ ] Verify all checks pass cleanly (`npm run validate`, `npm test`, `npm run sim`, `npm run report-assets`, `npm run build`), then **STOP and present a file summary for user approval before any Git commit**.
