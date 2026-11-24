# PATH OF WARBOUND — DATA SCHEMAS & ENGINE CONTRACTS (`v0.1`)

> **Document Purpose:** Canonical TypeScript interfaces, JSON file structures, core graph/math algorithms, and build-time CI validation rules. All JSON registries in `src/data/` must conform strictly to these types.

---

## 1. Core Enumerations & Registries

```ts
export type AttributeId = 'might' | 'agility' | 'wisdom' | 'fortitude';
export type DamageSchool = 'physical' | 'fire' | 'frost' | 'lightning' | 'void';
export type AilmentId = 'bleed' | 'ignite' | 'chill_freeze' | 'shock' | 'corruption';
export type ModLayer = 'base' | 'flat' | 'increased' | 'more' | 'convert';
export type Rarity = 'common' | 'magic' | 'rare' | 'mythic';
export type EquipSlot =
  | 'main_hand' | 'off_hand'
  | 'amulet' | 'helmet' | 'trinket'
  | 'gloves' | 'chest' | 'ring_1'
  | 'boots' | 'legs' | 'ring_2';

export type DoctrineId = 'tactician' | 'blitz' | 'bastion' | 'weaver' | 'entropy';
export type MaterialId = 'war_scrap' | 'runic_flux' | 'link_thread' | 'rift_essence' | 'gem_dust';
```

### Stat Registry (`src/data/stat_registry.json`)
Every `stat` string referenced anywhere in JSON must exist in `stat_registry.json` to prevent silent typo bugs.
* **Attributes:** `might`, `agility`, `wisdom`, `fortitude`
* **Offense:** `weapon_damage`, `ability_power`, `attack_speed`, `cast_speed`, `crit_chance`, `crit_multi`, `double_hit_chance`, `armor_break`, `dot_tick_speed`, `ailment_potency`
* **School Damage:** `physical_damage`, `fire_damage`, `frost_damage`, `lightning_damage`, `void_damage`
* **Defense & Resource:** `max_hp`, `hp_regen`, `armor`, `max_ward`, `ward_recharge_delay`, `ward_recharge_rate`, `dodge_rating`, `block_chance`, `thorns`, `max_mana`, `mana_regen`, `fire_res`, `frost_res`, `lightning_res`, `void_res`, `cooldown_recovery`

---

## 2. Modifier & Conversion Schema

```ts
export interface StatMod {
  stat: string;                 // Must match key in stat_registry.json
  layer: ModLayer;
  value: number;                // Flat value or percentage (e.g., 14 = +14%)
  convertTo?: string;           // Required if layer === 'convert'
  conditionTag?: string;        // Optional situational gate (e.g., 'while_bleeding')
}
```

### Strict Conversion Ordering Constants
```ts
export const PASS1_CONVERSION_ORDER = [
  'might', 'agility', 'wisdom', 'fortitude',
  'armor', 'max_ward', 'dodge_rating'
] as const;

export const PASS2_SCHOOL_ORDER: DamageSchool[] = [
  'physical', 'fire', 'frost', 'lightning', 'void'
];
```

---

## 3. Gem Schema (`src/data/gems.json`)

```ts
export type GemKind = 'active' | 'support';
export type SkillRole = 'emergency' | 'debuff_curse' | 'offensive_buff' | 'cooldown_nuke' | 'primary_clear';
export type TriggerType = 'none' | 'on_crit' | 'on_damage_taken' | 'on_hit' | 'energy_full' | 'instant_auto';

export interface GemDefinition {
  id: string;
  name: string;
  kind: GemKind;
  tags: string[];               // e.g., ['attack', 'melee', 'fire', 'aoe']
  role?: SkillRole;             // Required for 'active' gems
  baseCooldownMs?: number;
  baseCastTimeMs?: number;
  baseManaCost?: number;
  manaReservationPct?: number;  // For persistent Auras/Heralds
  damageSchool?: DamageSchool;
  skillEffectiveness?: number;  // Multiplier on base damage (e.g., 1.25)
  ailmentChancePct?: number;
  trigger?: {
    type: TriggerType;
    threshold?: number;         // e.g., damage taken or energy required
    internalCooldownMs: number;
  };
  modsPerLevel: StatMod[];      // Base scaling applied per gem level (1..20)
  supportMultipliers?: StatMod[]; // Applied to linked Active Gem if kind === 'support'
}

export interface GemInstance {
  uid: string;
  gemId: string;
  level: number;                // 1..20 (21 if corrupted)
  xp: number;
  quality: number;              // 0..20%
  corrupted: boolean;
  assignedBars: ('bar_1' | 'bar_2')[];
}
```

---

## 4. Equipment & Affix Schemas (`src/data/items.json`, `src/data/affixes.json`)

```ts
export type WeaponArchetype = 'dagger' | 'sword' | 'mace' | 'axe' | 'wand' | 'staff';

export interface BaseItemDefinition {
  id: string;
  name: string;
  slot: EquipSlot;
  isTwoHanded?: boolean;
  weaponArchetype?: WeaponArchetype;
  baseAttackSpeed?: number;
  baseDamageMin?: number;
  baseDamageMax?: number;
  maxSockets: number;           // 6 for Chest/2H, 4 for Helm/Gloves/Legs/Boots, 3 for 1H/Offhand, 1 for Jewelry/Trinket
  implicits: StatMod[];
  uniqueRuleId?: string;        // Required for Trinkets & Mythic rule-breakers
}

export interface AffixDefinition {
  id: string;
  tier: number;                 // 1..5
  allowedSlots: EquipSlot[];
  minVal: number;
  maxVal: number;
  modTemplate: Omit<StatMod, 'value'>;
}

export interface ItemInstance {
  uid: string;
  baseId: string;
  itemLevel: number;
  upgradeLevel: number;         // +0, +1, +2... upgraded with War-Scrap
  rarity: Rarity;
  linkedSockets: number;        // 1..maxSockets
  socketedGems: (GemInstance | null)[];
  affixes: {
    affixId: string;
    rolledValue: number;
    locked?: boolean;           // Locked via Rift Essence
  }[];
  corrupted: boolean;
  corruptionImplicit?: StatMod;
}
```

---

## 5. Skill Tree Schema & Graph Algorithms (`src/data/skill_tree.json`)

```ts
export type NodeType = 'hub' | 'bridge' | 'minor' | 'notable' | 'keystone' | 'socket';

export interface SkillTreeNode {
  id: string;
  type: NodeType;
  name: string;
  sector: AttributeId | 'center';
  tier: 0 | 1 | 2 | 3;
  pos: [number, number];        // Normalized [-1.0, 1.0] coordinates for 390px radial canvas
  tags: string[];
  mods: StatMod[];
  rules?: string[];             // Special Keystone flags (e.g., 'auto_swap_5s', 'no_manual_swap')
  excludes: string[];           // Symmetric array of mutually exclusive Keystone IDs
}

export interface SkillTreeGraph {
  version: string;
  startNodeId: string;          // 'hub_0'
  nodes: Record<string, SkillTreeNode>;
  edges: [string, string][];    // Undirected edges
}
```

### Required Reference Graph Functions (`src/engine/treeGraph.ts`)
1. **`pathTo(allocated: Set<string>, targetId: string): string[] | null`**: Multi-source BFS starting from all `allocated` nodes to find the shortest unblocked path to `targetId` (respecting `excludes`).
2. **`strandedAfterRemoval(allocated: Set<string>, removeId: string, rootId: string): string[]`**: Removes `removeId` and runs BFS/DFS from `rootId`; returns any nodes no longer connected to `rootId`. If empty, refund is immediately safe.
3. **`getArticulationPoints(allocated: Set<string>, rootId: string): Set<string>`**: Tarjan's algorithm in $O(V + E)$ to highlight unsafe-to-refund nodes in Refund Mode.

---

## 6. Zone, Doctrine & Save Schemas

```ts
export interface ZoneDefinition {
  id: string;
  name: string;
  order: number;                // 1, 2, 3
  baseEnemyLevel: number;       // Scales per tier (1..10)
  eliteSpawnChance: number;     // 0.12 -> 0.20 across tiers
  riftKeysRequired: number;     // Default: 3
  bossId: string;
  enemyPoolIds: string[];
}

export interface SaveState {
  saveVersion: string;
  lastSavedTimestamp: number;
  level: number;
  xp: number;
  gold: number;
  materials: Record<MaterialId, number>;
  activeDoctrine: DoctrineId;
  activeSkillBar: 'bar_1' | 'bar_2';
  packSize: 1 | 2 | 3 | 4 | 5;
  currentZoneId: string;
  currentTier: number;          // 1..10
  riftKeysBanked: Record<string, number>;
  equipped: Partial<Record<EquipSlot, ItemInstance>>;
  inventory: ItemInstance[];
  gemStash: GemInstance[];
  allocatedTreeNodes: string[]; // Sorted array of node IDs
  treeVersion: string;
}
```

---

## 7. Build-Time CI Validation Rules (`tests/validateData.test.ts`)

Run automatically before any commit or build:
1. **Stat Registry Integrity:** Every `mod.stat` and `mod.convertTo` across `gems.json`, `items.json`, `affixes.json`, and `skill_tree.json` exists in `stat_registry.json`.
2. **DAG Conversion Safety:** Every `convert` modifier strictly advances forward in `PASS1_CONVERSION_ORDER` or `PASS2_SCHOOL_ORDER`.
3. **Tree Graph Connectivity & Symmetry:** Every node in `skill_tree.json` is reachable from `hub_0`, max node degree $\le 6$, and every `excludes` entry is bidirectional (`A excludes B` $\iff$ `B excludes A`).
4. **Socket Cap Enforcement:** No base item defines `maxSockets` exceeding its slot ceiling (`6` for `chest`/`main_hand` 2H, `4` for armor, `3` for 1H/`off_hand`, `1` for jewelry/trinket).
