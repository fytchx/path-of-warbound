# Data Schemas

JSON registries in `src/data/registries` must validate at runtime and compile against exported TypeScript types.

## Registry Conventions

- Use stable string IDs such as `gem.fireball` or `weapon.dagger`.
- Do not use natural-language names as identifiers.
- Include a `schemaVersion` field at the top of each registry.
- Keep balance values numeric and explicit.
- Avoid cross-registry references that cannot be resolved during validation.

## Common Stat

```json
{
  "key": "might",
  "value": 10,
  "operation": "flat"
}
```

Supported operations:

- `base`
- `flat`
- `increased`
- `more`
- `convert`

## Gem

```json
{
  "id": "gem.fireball",
  "name": "Fireball",
  "kind": "active",
  "schools": ["fire"],
  "tags": ["projectile", "spell"],
  "cost": 8,
  "effects": []
}
```

## Item

Required fields: `id`, `name`, `slot`, `rarity`, `implicit`, `affixes`, and `socketLimit`.

## Zone

Required fields: `id`, `name`, `tierCount`, `enemyPool`, and `bossId`.

## Skill-Tree Node

Required fields: `id`, `petalId`, `sector`, `kind`, `cost`, `connections`, and `effects`.

## Validation Requirements

- Every registry ID is unique within its registry.
- Every cross-reference resolves to an existing ID.
- No skill-tree cycle or dangling connection exists.
- A keystone node has no conflicting mutually exclusive peer.
- The registry fails validation with an actionable error containing the ID and field name.
