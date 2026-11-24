import type { AssetId } from '../assets/assetIds';
import type { DoctrineId, ItemSlot, Rarity } from '../data/types';

export type MaterialId = 'mat_scrap' | 'mat_flux' | 'mat_thread' | 'mat_essence' | 'gem_dust';
export const MATERIAL_IDS: MaterialId[] = ['mat_scrap', 'mat_flux', 'mat_thread', 'mat_essence', 'gem_dust'];
export const MATERIAL_ASSET: Record<MaterialId, AssetId> = {
  mat_scrap: 'mat_scrap',
  mat_flux: 'mat_flux',
  mat_thread: 'mat_thread',
  mat_essence: 'mat_essence',
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
  linkedSockets?: number;
  corrupted: boolean;
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
  equipment: Partial<Record<ItemSlot, ItemInstance>>;
  inventory: ItemInstance[];
  gemStash: GemInstance[];
  allocated: string[];
  skillSlots: number;
  unlockedSystems: string[];
  grantedProgression: string[];
  onboardingStep: OnboardingStep;
  starterKillsClaimed: number;
  autoAdvanceBoss: boolean;
  autoSalvage: boolean;
  lifetime: LifetimeStats;
  settings: { reducedMotion: boolean; logCombat: boolean; guideSkipped: boolean };
}

export interface OfflineSummary {
  seconds: number;
  gold: number;
  xp: number;
  kills: number;
  keys: number;
}
