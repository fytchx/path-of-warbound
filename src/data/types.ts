import type { AssetId } from '../assets/assetIds';

export type StatLayer = 'flat' | 'increased' | 'more';

export interface StatMod {
  stat: string;
  layer: StatLayer;
  value: number;
}

export interface Conversion {
  from: string;
  to: string;
  percent: number;
  pass: 1 | 2;
}

export interface StatRegistry {
  version: string;
  stats: Record<string, { label: string; category: string; base: number; description: string }>;
  conversions: Conversion[];
}

export type ItemSlot =
  | 'main_hand'
  | 'off_hand'
  | 'amulet'
  | 'helmet'
  | 'trinket'
  | 'gloves'
  | 'chest'
  | 'ring_1'
  | 'boots'
  | 'legs'
  | 'ring_2';

export type Rarity = 'common' | 'magic' | 'rare' | 'mythic';

export interface WeaponProfile {
  minDamage: number;
  maxDamage: number;
  attacksPerSecond: number;
  twoHanded: boolean;
  archetype: 'dagger' | 'sword' | 'mace' | 'axe' | 'bow' | 'staff';
  dotOnHit?: { ailment: string; chance: number; dps: number; duration: number };
}

export interface ItemBase {
  id: string;
  name: string;
  slot: ItemSlot;
  slotTags: string[];
  assetId: AssetId;
  baseType: string;
  itemLevel: number;
  sockets: number;
  implicit: StatMod[];
  weapon?: WeaponProfile;
  uniqueEffect?: string;
  description: string;
  flavour: string;
}

export interface Affix {
  id: string;
  name: string;
  kind: 'prefix' | 'suffix';
  slotTags: string[];
  stat: string;
  layer: StatLayer;
  values: [number, number, number, number, number];
  itemLevel: number;
}

export type School = 'physical' | 'fire' | 'frost' | 'lightning' | 'void';
export type AilmentId = 'bleed' | 'ignite' | 'chill' | 'shock' | 'corruption';

export interface GemDef {
  id: string;
  name: string;
  kind: 'active' | 'support';
  assetId: AssetId;
  school?: School;
  tags: string[];
  description: string;
  manaCost?: number;
  manaReservation?: number;
  cooldown?: number;
  castTime?: number;
  damage?: { min: number; max: number; effectiveness: number };
  ailment?: { id: AilmentId; chance: number; dps: number; duration: number };
  mods: StatMod[];
  support?: { allowedTags?: string[]; note: string };
}

export interface MonsterDef {
  id: string;
  name: string;
  assetId: AssetId;
  hp: number;
  damage: number;
  armor: number;
  attackSpeed: number;
  school: School;
  elite: boolean;
  flavour: string;
}

export interface ZoneDef {
  id: string;
  name: string;
  assetId: AssetId;
  tiers: number;
  monsterIds: string[];
  eliteChance: number;
  keyDropChance: number;
  rewardMultiplier: number;
  flavour: string;
}

export type DoctrineId = 'tactician' | 'blitz' | 'bastion' | 'weaver' | 'entropy';

export interface DoctrineDef {
  id: DoctrineId;
  name: string;
  assetId: AssetId;
  guardThreshold: number;
  description: string;
  perks: string[];
}

export type TreeNodeKind = 'hub' | 'minor' | 'notable' | 'keystone' | 'socket';

export interface TreeNode {
  id: string;
  name: string;
  kind: TreeNodeKind;
  sector: 'core' | 'might' | 'agility' | 'wisdom' | 'fortitude';
  x: number;
  y: number;
  mods: StatMod[];
  description: string;
  assetId?: AssetId;
  excludes?: string[];
}

export interface SkillTree {
  version: string;
  rootId: string;
  nodes: TreeNode[];
  edges: [string, string][];
}

export type UnlockableSystem =
  | 'altar'
  | 'bag'
  | 'tree'
  | 'forge'
  | 'bar_2'
  | 'doctrines'
  | 'auto_boss'
  | 'pack_2'
  | 'pack_full'
  | 'forge_full'
  | 'auto_salvage'
  | 'keystones';

export type ProgressionTrigger = { level: number } | { event: 'first_death' };

export interface ProgressionGrants {
  skillSlot?: number;
  gem?: string;
  unlockedSystems?: UnlockableSystem[];
}

export interface ProgressionEntry {
  id: string;
  trigger: ProgressionTrigger;
  grants: ProgressionGrants;
}

export interface PriorityVerbDef {
  id: string;
  name: string;
  description: string;
  unlocksAtLevel: number;
}

export interface Registries {
  stats: StatRegistry;
  items: ItemBase[];
  affixes: Affix[];
  gems: GemDef[];
  monsters: MonsterDef[];
  zones: ZoneDef[];
  doctrines: DoctrineDef[];
  tree: SkillTree;
  progression: ProgressionEntry[];
}
