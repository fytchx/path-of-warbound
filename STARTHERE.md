# STARTHERE — Path of Warbound (v1.0)

> Read this, then `docs/ACTIVE_INSTRUCTIONS.md`. `docs/MASTER_DIRECTIVE.md` is the only game and engineering blueprint; it supersedes every earlier phase checklist.

## 1. Repository safety (hard stops)

1. Never run `git commit`, `git push`, `git merge`, `git rebase`, `git reset --hard` or `git push --force` without explicit user approval for that exact action.
2. Never modify, rename, delete or regenerate anything inside `assets/` or `warbound-sprite.svg`. Art is referenced only by `AssetId` from `assets/manifest.json`. Overlay effects (sockets, links, slashes, cast bars, telegraphs) are CSS/SVG/Canvas.
3. Never delete engine modules, data registries or documentation without approval.
4. Keep changes scoped. Do not refactor working systems the task does not touch.

## 2. What this repository is

*Path of Warbound*: a portrait-only (`390px`–`420px`, letterboxed desktop) ARPG where a disembodied Soul-Spark animates bound armaments. No human faces or portraits; the header emblem is `fx_soulspark` inside `#w-medal`.

## 3. Architecture (the only current description)

| Area | Path | Responsibility |
| --- | --- | --- |
| Headless engine | `src/engine/` | `100ms` tick combat, stats pipeline, tree graph, seeded RNG. No DOM. |
| Content data | `src/data/*.json` | Items, gems, affixes, monsters, zones, doctrines, priority verbs, skill tree, stat registry. |
| Game rules | `src/game/` | Save schema, starters, tiers/zones, drops, milestones, crafting, sockets. |
| UI | `src/ui/` + `src/styles/app.css` | Five tabs, frosted modals, combat visuals, bag/altar/forge/tree screens. |
| Simulator | `src/sim/runSim.ts` | Headless balance table. |
| Validator | `scripts/validate-data.ts` | Schema, ids, assets, stat references, content rules. |

Authoritative registry counts are whatever `npm run validate` prints. Do not copy counts into docs by hand.

## 4. Architectural guardrails

1. `src/engine/` is pure deterministic TypeScript: no DOM, `window`, CSS or browser globals.
2. Content lives in `src/data/`; no hardcoded gem, item, affix, zone or node numbers in engine or UI.
3. One-way math: `Base → Flat → Increased (additive) → More (multiplicative) → Pass 1 attribute/defence → Pass 2 school conversions`. No circular dependencies.
4. Portrait first (`390px` target), tap targets ≥ `44px`, modals dismiss on outside tap, `Escape` or `×`.
5. Verification guard: a test, build or fix counts as passing only if it was run in this session and its exact output is quoted. Otherwise prefix the claim with `Not verified:`.

## 5. Every session

1. Read this file and `docs/ACTIVE_INSTRUCTIONS.md`.
2. Run `git status` and the relevant checks before changing code.
3. State which files you will touch.
4. Build, validate and test; the engine stays headless.
5. Finish with the 6-section handover rundown from `docs/ACTIVE_INSTRUCTIONS.md`.
6. Stop before commit or push unless approval is on record.
