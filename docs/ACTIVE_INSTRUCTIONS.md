# ACTIVE INSTRUCTIONS — Path of Warbound

> `STARTHERE.md` holds safety. `docs/MASTER_DIRECTIVE.md` holds the full game and engineering blueprint.
> There is no phased roadmap. The v1.0 build described in the directive is the current game.

## 1. Current state

The v1.0 full-send build: blank-slate Soul-Spark Awakening (melee / spell / dot) with colour-coded starter sockets; independent weapon auto-attack and spell cast bars; per-monster and per-boss telegraphed heavy attacks; gem/socket colour system with chromatic crafting; four-attribute stat pipeline; strict Tier 1–10 and zone locks with manual, key-summoned bosses; milestone-gated loot; split bag; clickable sockets; frosted modals.

Acceptance criteria and every tuning number: `docs/MASTER_DIRECTIVE.md`.

## 2. Verified baseline

| Area | Where | State |
| --- | --- | --- |
| Stat pipeline | `src/engine/stats.ts` | Base → Flat → Increased → More → two-pass conversions |
| Tree graph | `src/engine/treeGraph.ts` | BFS pathing, allocation, Tarjan-style refund safety |
| Combat loop | `src/engine/combatEngine.ts` | `100ms` ticks, utility scoring, ailments, telegraphs, keys, bosses |
| Data registries | `src/data/*.json` | Run `npm run validate` for current counts |
| UI | `src/ui/` | 5 tabs, portrait frame, frosted modals, toasts |
| Saves | `src/game/state.ts` | Versioned local save, 8 h offline cap, tier/zone unlocks |
| Simulator | `src/sim/runSim.ts` | Headless balance table |
| Tests | `tests/` | Vitest suite |

Frozen reference HTML lives in `docs/reference/`. `warbound-sprite.svg` stays at the repository root because `vite.config.ts` inlines it into `index.html`.

## 3. Commands

```bash
npm run validate      # schema, ids, manifest, asset references, content rules
npm test              # vitest suite
npm run sim           # headless balance table
npm run report-assets # asset payload by category
npm run build         # tsc --noEmit + vite build
npm run dev           # local preview
```

## 4. Standing repository rules

1. Never modify or regenerate files in `assets/` or `warbound-sprite.svg`. Reference art only through `AssetId` keys from `assets/manifest.json`.
2. `src/engine/` stays 100% pure TypeScript: no DOM, `window`, CSS or browser globals.
3. Content is data-driven. Tune `src/data/*.json`, not engine constants, unless the value is a documented engine formula.
4. UI remains portrait-only (`390px`–`420px`, letterboxed on desktop), five bottom tabs always unlocked, tap targets ≥ `44px`.
5. Workflow: read `STARTHERE.md` and this file, inspect `git status`, run checks before changing code, verify after.
6. Git: after the Phase 2 checkpoint push, never run `git commit` or `git push` without explicit user approval.

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
