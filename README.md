# PATH OF WARBOUND

> *"An intimidating monster in the background, simple for a solo developer to build without scope creep, deeply stimulating for theorycrafters, and effortless for the average player."*

**Path of Warbound** is a mobile-portrait-first (`390px`), seasonal semi-idle autobattler set on the war-torn world of **Khorvath**. Merging *Path of Exile*'s deep itemization, linked gem engines, and passive tree pathing with the immediate, low-friction progression of *IdleArc*, the game strips away character models and rigid classes in favor of pure build-craft.

## Premise & Identity

Centuries ago, a planar cataclysm called **The Unmaking** saturated Khorvath in raw, unstable magic that mortal flesh cannot survive. Ancient runic smiths discovered how to bind a warrior's **Soul-Spark** directly into **Warbound Armaments**.

- **No Physical Body, No Rigid Classes:** Equipped weapons, armor, relics, linked gems, and the passive constellation form the player's identity.
- **Progress, Power, and Luck:** Players climb the seasonal ladder through steady upgrades, build synergy, and rare drop mutations.

## Core Systems

- **Soul-Forged Loadout:** Weapon, offhand, and 3x3 equipment grid with universal gem sockets.
- **Dual-Bar Auto-Combat:** Weapon auto-attacks, swappable skill bars, and selectable Combat Doctrines.
- **Deterministic Math Pipeline:** `Base -> Flat -> Increased -> More -> Two-Pass DAG Conversions`.
- **Radial Constellation:** Mobile-friendly petal sectors, notable nodes, minors, and mutually exclusive keystones.
- **Zones and Economy:** Configurable pack size, 10-tier zones, Rift Keys with pity, boss runs, offline progression, and crafting currencies.
- **Readable Combat:** Independent auto-attack and cast bars, telegraphed heavies with a punish window, boss ward and phase chips, and a filtrable War Log.
- **Uniques and Mythics:** A unique registry (`src/data/uniques.json`) whose effects feed the stat pipeline and combat engine.

## Roadmap

- **v0.1 — Core Playable Slice (done):** Headless engine, JSON registries, portrait UI, zones, gems, gear, skill tree, and local saves.
- **v0.3 — Deep ARPG Systems (current):** Socket colours, chromatic and currency crafting, uniques/mythics, combat juice, tier locks. Engine hooks for the currency bench, boss caches and respec exist; their UI wiring is pending.
- **Online / seasonal layer (parked):** Leaderboards, PvP, group content and trading stay out until `docs/ACTIVE_INSTRUCTIONS.md` §7 changes.

## Repository Map

```text
/
├── STARTHERE.md
├── README.md
├── docs/
│   ├── ACTIVE_INSTRUCTIONS.md
│   ├── GAME_DESIGN_BIBLE.md
│   └── DATA_SCHEMAS.md
├── src/
│   ├── engine/
│   ├── data/
│   ├── game/
│   ├── sim/
│   ├── styles/
│   └── ui/
├── scripts/
└── tests/
```

## Development

```bash
npm install
npm run build
npm test
npm run sim
```

The `src/engine` package must remain independent of UI and browser APIs. The headless simulator uses the same formulas and registries as the game.
