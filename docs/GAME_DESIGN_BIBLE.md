# Game Design Bible

## Vision

A seasonal semi-idle autobattler about itemization and build-craft rather than character models or rigid classes.

## Attributes

- **Might:** Weapon base damage, ability power, critical multiplier, armor break.
- **Agility:** Attack speed, double-hit chance, DoT tick speed, dodge.
- **Wisdom:** Cast/channel speed, mana and ward, ailment potency.
- **Fortitude:** Health, healing, armor, and thorns.

## Damage and Ailments

Five schools: Physical, Fire, Frost, Lightning, and Void.

- Physical: Bleed
- Fire: Ignite
- Frost: Chill and Freeze
- Lightning: Shock
- Void: Corruption

## Deterministic Calculation Pipeline

1. Base values
2. Flat additions
3. Increased values, combined additively
4. More values, combined multiplicatively
5. Two-pass dependency graph for conversions

Conversions must be acyclic. Resolve inward values first, then outward values, and prevent a conversion from feeding itself or creating a loop.

## Loadout

- Main-hand weapon and optional offhand
- Amulet, helmet, trinket, gloves, chest, rings, boots, and legs
- A two-handed weapon spans and locks the offhand slot
- Active gems and linked supports use universal sockets

## Combat

The combat system has a weapon auto-attack bar, two 5-slot skill bars, and one of five doctrines: Tactician, Blitz, Bastion, Weaver, or Entropy. Active buffs and damage-over-time effects continue ticking while bars are swapped.

## Zone Pacing

- Ten tiers per zone
- Player-selected pack size from 1 to 5
- Three Rift Keys summon the zone boss
- Death moves the player back one zone tier
- Offline rewards scale from the active loadout
