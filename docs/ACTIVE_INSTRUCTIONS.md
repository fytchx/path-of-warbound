# Active Instructions

## Current Sprint: v0.1 Foundation

Build a playable, headless foundation before adding UI polish or online features.

## Current Tasks

1. Create the shared stat and damage types in `src/engine`.
2. Implement the one-way stat pipeline and basic damage application.
3. Add a deterministic combat tick and typed combat events.
4. Add JSON schemas and seed registries for gems, items, affixes, zones, doctrines, and the skill tree.
5. Build an elemental and physical ailment model.
6. Add a CLI mode that accepts registries and reports aggregate combat balance.
7. Preserve 390px portrait assumptions in UI components.

## Explicitly Deferred

- Authentication and accounts
- Persistent global leaderboards
- PvP
- Group content
- Complex online chat
- Asset production

## Validation Checklist

- [ ] `npm run build` succeeds
- [ ] `npm test` succeeds
- [ ] `npm run sim` produces a deterministic summary
- [ ] Registries pass schema validation
- [ ] No UI dependencies exist in `src/engine`
