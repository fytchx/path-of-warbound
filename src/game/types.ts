import type { AssetId } from '../assets/assetIds';
import type { DoctrineId, ItemSlot, Rarity, SocketColor } from '../data/types';

export type MaterialId = 'mat_scrap' | 'mat_flux' | 'mat_thread' | 'mat_essence' | 'mat_chroma' | 'gem_dust';
export const MATERIAL_IDS: MaterialId[] = ['mat_scrap', 'mat_flux', 'mat_thread', 'mat_essence', 'mat_chroma', 'gem_dust'];
export const MATERIAL_ASSET: Record<MaterialId, AssetId> = {
  mat_scrap: 'mat_scrap',
  mat_flux: 'mat_flux',
  mat_thread: 'mat_thread',
  mat_essence: 'mat_essence',
  mat_chroma: 'mat_flux',
  gem_dust: 'gem_round',
};

export type SkillBar = 'bar_1' | 'bar_2' | 'both';

export interface GemInstance {
  gemId: string;
  level: number;
  xp: number;
  bar: SkillBar;
}

export interface ItemInstance {
  uid: string;
  baseId: string;
  rarity: Rarity;
  itemLevel: number;
  affixes: { affixId: string; tier: number }[];
  sockets: (GemInstance | null)[];
  /** One colour per socket, parallel to `sockets`. White is universal. */
  socketColors: SocketColor[];
  linkedSockets?: number;
  corrupted: boolean;
  dropped?: boolean;
  /** Set when the item is a named Mythic unique. */
  uniqueId?: string;
}

export interface LifetimeStats {
  kills: number;
  elites: number;
  bosses: number;
  deaths: number;
  damage: number;
  gold: number;
}

export type OnboardingStep = 0 | 1 | 2 | 3 | 4 | 5 | 6;

export interface CharacterSave {
  version: number;
  createdAt: number;
  lastSeen: number;
  level: number;
  xp: number;
  gold: number;
  keys: number;
  materials: Record<MaterialId, number>;
  doctrine: DoctrineId;
  activeBar: 'bar_1' | 'bar_2';
  packSize: 1 | 2 | 3 | 4 | 5;
  zoneId: string;
  tier: number;
  /** Highest tier unlocked per zone. Tier + can never exceed this. */
  unlockedTierByZone: Record<string, number>;
  /** Zones the player may enter. */
  unlockedZones: string[];
  equipment: Partial<Record<ItemSlot, ItemInstance>>;
  inventory: ItemInstance[];
  gemStash: GemInstance[];
  allocated: string[];
  skillSlots: number;
  unlockedSystems: string[];
  grantedProgression: string[];
  onboardingStep: OnboardingStep;
  starterKillsClaimed: number;
  starterArchetype: 'melee' | 'spell' | 'dot' | null;
  awakened: boolean;
  milestones: { packSeconds: number; sawLowHp: boolean; forgeUpgrades: number };
  rotation: { mode: 'auto' | 'manual'; order: string[] };
  autoAdvanceBoss: boolean;
  autoSalvage: boolean;
  lifetime: LifetimeStats;
  /** zoneId:tier keys whose first-cleared Boss Cache has been claimed. */
  firstClearCaches: string[];
  /** Extra Skill Points earned from first-clear Boss Caches. */
  bonusSkillPoints: number;
  settings: { reducedMotion: boolean; logCombat: boolean; guideSkipped: boolean };
}

export interface OfflineSummary {
  seconds: number;
  gold: number;
  xp: number;
  kills: number;
  keys: number;
}
