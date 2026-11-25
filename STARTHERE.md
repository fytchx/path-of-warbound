# STARTHERE — Path of Warbound

> Read this file, then `docs/ACTIVE_INSTRUCTIONS.md`, before reading code or running commands.
> `docs/MASTER_DIRECTIVE.md` is the end-to-end game and engineering blueprint.

## 1. Repository safety (hard stops)

1. Never run `git commit`, `git push`, `git merge`, `git rebase`, `git reset --hard` or `git push --force` without explicit user approval for that exact action. The one standing exception is written into `docs/ACTIVE_INSTRUCTIONS.md`.
2. Never modify, rename, delete or regenerate anything inside `assets/` or `warbound-sprite.svg`. Art is referenced only by `AssetId` from `assets/manifest.json`.
3. Never delete engine modules, data registries or documentation without approval.
4. Keep changes scoped to the task. Do not refactor working systems that the task does not touch.

## 2. What this repository is

`v0.2` working baseline of *Path of Warbound*: a portrait-only (`390px`–`420px`) ARPG where a disembodied Soul-Spark animates bound armaments. There are no human faces or character portraits; the header emblem is `fx_soulspark` inside `#w-medal`.

Verified at the Phase 2 checkpoint (2026-11-25):

| Area | Path | State |
| --- | --- | --- |
| Stat pipeline | `src/engine/stats.ts` | Base → Flat → Increased → More → two-pass conversions |
| Tree graph | `src/engine/treeGraph.ts` | BFS pathing, allocation, articulation-safe refunds |
| Combat loop | `src/engine/combatEngine.ts` | `100ms` ticks, utility AI, ailments, keys, boss, death |
| Determinism | `src/engine/rng.ts` | Seeded mulberry32 |
| Data registries | `src/data/*.json` | 154 assets, 25 bases, 30 affixes, 18 gems, 12 monsters, 3 zones, 91 tree nodes, 106 edges |
| Save + offline | `src/game/state.ts` | Local save, 8 h offline cap |
| UI | `src/ui/` + `src/styles/app.css` | 5 tabs: Combat, Altar, Tree, Bag, Forge |
| Simulator | `src/sim/runSim.ts` | 4 builds × Tier 1/3 × 10,000 ticks |
| Tests | `tests/` | 6 files, 55 tests |

## 3. Architectural guardrails

1. `src/engine/` is pure deterministic TypeScript: no DOM, `window`, CSS or browser globals.
2. Content lives in `src/data/`; no hardcoded gem, item, affix, zone or node numbers in engine or UI.
3. One-way math: `Base → Flat → Increased (additive) → More (multiplicative) → Pass 1 attribute/defence → Pass 2 school conversions`. No circular dependencies.
4. Mobile portrait first (`390px` target, letterboxed on desktop), tap targets ≥ `44px`, modals dismiss on outside tap, `Escape` or `×`.
5. Verification guard: a test, build or fix counts as passing only if it was run in the same session and its exact output is quoted. Otherwise prefix the claim with `Not verified:`.

## 4. Every session

1. Read this file and `docs/ACTIVE_INSTRUCTIONS.md`.
2. Run `git status` and run the relevant checks before changing code.
3. State which files you will touch.
4. Build, validate and test; the engine stays headless.
5. Finish with the mandatory 6-section handover rundown from `docs/ACTIVE_INSTRUCTIONS.md`.
6. Stop before any commit or push unless approval is on record.
