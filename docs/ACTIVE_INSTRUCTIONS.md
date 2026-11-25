# ACTIVE INSTRUCTIONS — Path of Warbound

> Source of truth for what to build now. `STARTHERE.md` holds safety rules; `docs/MASTER_DIRECTIVE.md` holds the full game and engineering blueprint.
> Verified baseline: Phase 2 checkpoint, commit `chore: lock in master directive and checkpoint baseline before v0.3 overhaul` (2026-11-25).

## 1. Current milestone

Build the complete unified playable overhaul on top of the checkpoint:

- Blank-slate reset plus a Soul-Spark Awakening starter choice (melee / spell / dot).
- Independent weapon auto-attacks and a dedicated spell cast bar, with clamp-safe progress bars.
- Experience-gated drop unlocks, a deliberate XP curve and manual, key-summoned zone bosses.
- Every computed stat wired into combat, plain-English descriptions on all content, AUTO and MANUAL rotation.
- A four-sector colour-coded skill tree and frosted-obsidian modal polish.

Detailed acceptance criteria: `docs/MASTER_DIRECTIVE.md` §7.

## 2. Verified baseline

| Area | Where | State |
| --- | --- | --- |
| Stat pipeline | `src/engine/stats.ts` | Base → Flat → Increased → More → two-pass conversions |
| Tree graph | `src/engine/treeGraph.ts` | BFS pathing, allocation, Tarjan-style refund safety |
| Combat loop | `src/engine/combatEngine.ts` | `100ms` ticks, utility scoring, ailments, keys, boss, death |
| Data registries | `src/data/*.json` | 154 assets, 27 bases, 30 affixes, 21 gems, 12 monsters, 3 zones, 91 nodes, 106 edges |
| UI | `src/ui/` | 5 tabs, portrait frame, modals, toasts |
| Saves | `src/game/state.ts` | Versioned local save, 8 h offline cap |
| Simulator | `src/sim/runSim.ts` | 4 builds × Tier 1/3 × 10,000 ticks |
| Tests | `tests/` | 6 files, 67 tests |

Frozen reference HTML lives in `docs/reference/`. `warbound-sprite.svg` stays at the repository root because `vite.config.ts` inlines it into `index.html`.

## 3. Commands

```bash
npm run validate      # schema, ids, manifest and asset references
npm test              # vitest suite
npm run sim           # headless balance table: 4 builds x Tier 1 & 3 x 10,000 ticks
npm run report-assets # asset payload by category
npm run report-assets -- --convert   # WebP copies into dist-assets-webp/ (assets/ untouched)
npm run build         # tsc --noEmit + vite build
npm run dev           # local preview
```

## 4. Standing repository rules

1. Never modify or regenerate files in `assets/` or `warbound-sprite.svg`. Reference art only through `AssetId` keys declared in `assets/manifest.json`; every code and data file resolves them via `src/data/` or `src/assets/`.
2. `src/engine/` stays 100% pure TypeScript: no DOM, `window`, CSS or browser globals.
3. Content is data-driven. Tune `src/data/*.json`, not engine constants, unless the value is a documented engine formula.
4. UI remains portrait-only (`390px`–`420px`, letterboxed on desktop), five bottom tabs always unlocked, tap targets ≥ `44px`.
5. Workflow: read `STARTHERE.md` and this file, inspect `git status`, run checks before changing code, verify after.
6. Git: after the Phase 2 checkpoint push, never run `git commit` or `git push` without explicit user approval. The Phase 2 push was approved once for that checkpoint only.

## 5. Verification guard

Report a test, build or fix as passing only after running it in the same session and quoting its exact command output. Otherwise prefix the claim with `Not verified:`.

## 6. Mandatory 6-section handover (every task)

1. Goal & Behavioral Summary
2. Files Created, Modified, or Deleted
3. Exact Numbers, Formulas & Tuning Values
4. Verification Output
5. Known Quirks, Trade-offs & Decisions Needed
6. Git Working Tree State

## 7. Parked (do not build)

Online leaderboards, backend auth/databases, War-Orders maps, endless survival, PvP, group content, trading, seasonal ladders. Update this file before adding any of them.
