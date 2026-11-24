# AI and Contributor Start Instructions

This file is mandatory context for every coding task in this repository.

## Operating Rules

1. Keep `src/engine` pure: no DOM, React, browser storage, timers, or UI imports.
2. Keep JSON in `src/data/registries`; do not duplicate combat constants in UI or simulator code.
3. Apply the game math pipeline in order:
   `Base -> Flat -> Increased (additive) -> More (multiplicative) -> Two-Pass DAG Conversions`
4. Change a schema only with matching TypeScript types, registry examples, and validation tests.
5. Add or update tests for every engine or graph behavior change.
6. Do not fabricate assets, balance values, or product requirements; mark unknown values as TODO.
7. Verify repository status before destructive Git operations and never rewrite shared history.

## Active Version Router

- Read `docs/ACTIVE_INSTRUCTIONS.md` before implementation.
- Read `docs/GAME_DESIGN_BIBLE.md` for formulas and mechanics.
- Read `docs/DATA_SCHEMAS.md` before editing JSON registries.
- Keep additions compatible with the mobile-portrait (`390px`) v0.1 scope.

## Definition of Done

- Code builds with `npm run build`.
- Tests pass with `npm test`.
- Headless balance checks run with `npm run sim`.
- README or relevant documentation reflects public behavior changes.
