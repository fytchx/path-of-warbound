import { affixById, gemById, gems, itemBaseById, itemBases, progression, skillTree } from '../data';
import type { DoctrineId, ItemSlot, ProgressionEntry, Rarity, UnlockableSystem } from '../data/types';
import { buildTreeGraph, canAllocate, getArticulationPoints, strandedAfterRemoval } from '../engine/treeGraph';
import type { CombatRewards } from '../engine/combatEngine';
import { chance, mulberry32, pickOne } from '../engine/rng';
import {
  allSocketedGems,
  fitsSlot,
  gemDustCostToLevel,
  gemXpToNext,
  itemBase,
  itemGearscore,
  socketedGems,
} from './items';
import {
  MATERIAL_IDS,
  type CharacterSave,
  type GemInstance,
  type ItemInstance,
  type MaterialId,
  type OfflineSummary,
  type OnboardingStep,
} from './types';

export const STORAGE_KEY = 'path-of-warbound.save.v1';
export const SAVE_VERSION = 4;

export const ALL_UNLOCKABLE_SYSTEMS: UnlockableSystem[] = [
  'altar',
  'bag',
  'tree',
  'forge',
  'bar_2',
  'doctrines',
  'auto_boss',
  'pack_2',
  'pack_full',
  'forge_full',
  'auto_salvage',
  'keystones',
];

const treeGraph = buildTreeGraph(skillTree);

let uidCounter = 0;
export function newUid(prefix = 'it'): string {
  uidCounter += 1;
  return `${prefix}_${Date.now().toString(36)}_${uidCounter}`;
}

function hashSeed(text: string): number {
  let hash = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function xpNeeded(level: number): number {
  return Math.floor(250 * Math.pow(Math.max(1, level), 1.45));
}

export function eligibleAffixes(baseId: string): typeof affixById extends Map<string, infer T> ? T[] : never {
  const base = itemBaseById.get(baseId);
  if (!base) return [];
  const list: typeof affixById extends Map<string, infer T> ? T[] : never = [];
  for (const affix of affixById.values()) {
    if (affix.slotTags.some((tag) => base.slotTags.includes(tag))) list.push(affix);
  }
  return list;
}

export function rollAffixes(
  baseId: string,
  rarity: Rarity,
  itemLevel: number,
  seed: number,
): { affixId: string; tier: number }[] {
  const counts: Record<Rarity, number> = { common: 0, magic: 2, rare: 4, mythic: 5 };
  const count = counts[rarity];
  const rng = mulberry32(seed);
  const pool = eligibleAffixes(baseId).filter((a) => a.itemLevel <= itemLevel);
  const chosen: { affixId: string; tier: number }[] = [];
  const used = new Set<string>();
  const maxTier = Math.max(1, Math.min(5, 1 + Math.floor(itemLevel / 10)));
  while (chosen.length < count && pool.length > used.size) {
    const candidate = pickOne(rng, pool);
    if (used.has(candidate.id)) continue;
    used.add(candidate.id);
    chosen.push({ affixId: candidate.id, tier: Math.max(1, Math.min(maxTier, 1 + Math.floor(rng() * maxTier))) });
  }
  return chosen;
}

export function createItem(baseId: string, rarity: Rarity, itemLevel: number, seedText: string): ItemInstance {
  const base = itemBaseById.get(baseId);
  if (!base) throw new Error(`Unknown base ${baseId}`);
  const uid = newUid();
  return {
    uid,
    baseId,
    rarity,
    itemLevel,
    affixes: rollAffixes(baseId, rarity, itemLevel, hashSeed(seedText + baseId)),
    sockets: Array.from({ length: base.sockets }, () => null),
    corrupted: false,
  };
}

export function makeGem(gemId: string, level = 1, bar: GemInstance['bar'] = 'both'): GemInstance {
  return { gemId, level, xp: 0, bar };
}

export function createInitialSave(now = Date.now()): CharacterSave {
  return {
    version: SAVE_VERSION,
    createdAt: now,
    lastSeen: now,
    level: 1,
    xp: 0,
    gold: 0,
    keys: 0,
    materials: { mat_scrap: 0, mat_flux: 0, mat_thread: 0, mat_essence: 0, gem_dust: 0 },
    doctrine: 'tactician',
    activeBar: 'bar_1',
    packSize: 1,
    zoneId: 'zone_ashen_graveyard',
    tier: 1,
    equipment: {},
    inventory: [],
    gemStash: [],
    allocated: ['hub_0'],
    skillSlots: 6,
    unlockedSystems: [...ALL_UNLOCKABLE_SYSTEMS],
    grantedProgression: [],
    onboardingStep: 6,
    starterKillsClaimed: 0,
    starterArchetype: null,
    awakened: false,
    milestones: { packSeconds: 0, sawLowHp: false, forgeUpgrades: 0 },
    rotation: { mode: 'auto', order: [] },
    autoAdvanceBoss: false,
    autoSalvage: false,
    lifetime: { kills: 0, elites: 0, bosses: 0, deaths: 0, damage: 0, gold: 0 },
    settings: { reducedMotion: false, logCombat: true, guideSkipped: true },
  };
}

export type StarterChoice = 'melee' | 'spell' | 'dot';

export const STARTERS: Record<
  StarterChoice,
  { name: string; baseId: string; gemId: string; attribute: string; blurb: string }
> = {
  melee: {
    name: 'Melee',
    baseId: 'base_sword_starter',
    gemId: 'gem_crossed_slash',
    attribute: 'Might',
    blurb: 'Instant single-target slash. Steel first, questions never.',
  },
  spell: {
    name: 'Spell',
    baseId: 'base_staff_starter',
    gemId: 'gem_grave_bolt',
    attribute: 'Wisdom',
    blurb: 'A 1.5s timed cast that hits like a falling roof.',
  },
  dot: {
    name: 'DoT',
    baseId: 'base_dagger_starter',
    gemId: 'gem_venom_dagger',
    attribute: 'Agility',
    blurb: 'Fast stabs with a 25% chance to stack Corruption.',
  },
};

/** Grants the chosen starter weapon and its socketed gem. Never locks the player in. */
export function applyStarterChoice(save: CharacterSave, choice: StarterChoice): ItemInstance {
  const starter = STARTERS[choice];
  const weapon = createItem(starter.baseId, 'common', 1, `starter-${choice}`);
  weapon.sockets = [makeGem(starter.gemId, 1, 'both')];
  weapon.linkedSockets = 1;
  weapon.dropped = false;
  save.equipment.main_hand = weapon;
  save.starterArchetype = choice;
  save.awakened = true;
  return weapon;
}

export function sanitizeSave(raw: unknown, now = Date.now()): CharacterSave {
  const fallback = createInitialSave(now);
  if (!raw || typeof raw !== 'object') return fallback;
  const candidate = raw as Partial<CharacterSave>;
  if (candidate.version !== SAVE_VERSION) return fallback;
  const merged: CharacterSave = {
    ...fallback,
    ...candidate,
    settings: { ...fallback.settings, ...candidate.settings },
  };
  merged.materials = { ...fallback.materials, ...candidate.materials };
  merged.lifetime = { ...fallback.lifetime, ...candidate.lifetime };
  if (!Array.isArray(merged.inventory)) merged.inventory = [];
  if (!Array.isArray(merged.gemStash)) merged.gemStash = [];
  if (!Array.isArray(merged.allocated) || !merged.allocated.includes('hub_0')) merged.allocated = ['hub_0'];
  merged.unlockedSystems = [...ALL_UNLOCKABLE_SYSTEMS];
  if (!Array.isArray(merged.grantedProgression)) merged.grantedProgression = [];
  merged.skillSlots = Math.max(6, Math.floor(Number(merged.skillSlots) || 6));
  merged.onboardingStep = 6 as OnboardingStep;
  merged.starterKillsClaimed = Math.max(0, Math.floor(Number(merged.starterKillsClaimed) || 0));
  merged.starterArchetype =
    candidate.starterArchetype === 'melee' || candidate.starterArchetype === 'spell' || candidate.starterArchetype === 'dot'
      ? candidate.starterArchetype
      : null;
  merged.awakened = Boolean(candidate.awakened) || Object.keys(merged.equipment ?? {}).length > 0;
  merged.milestones = { ...fallback.milestones, ...(candidate.milestones ?? {}) };
  merged.milestones.packSeconds = Math.max(0, Number(merged.milestones.packSeconds) || 0);
  merged.milestones.forgeUpgrades = Math.max(0, Math.floor(Number(merged.milestones.forgeUpgrades) || 0));
  merged.milestones.sawLowHp = Boolean(merged.milestones.sawLowHp);
  merged.rotation = {
    mode: candidate.rotation?.mode === 'manual' ? 'manual' : 'auto',
    order: Array.isArray(candidate.rotation?.order) ? [...candidate.rotation.order] : [],
  };
  merged.autoAdvanceBoss = false;
  merged.autoSalvage = Boolean(candidate.autoSalvage);
  merged.settings.guideSkipped = true;
  if (!merged.equipment || typeof merged.equipment !== 'object') merged.equipment = {};
  if (!merged.inventory.every((item) => itemBaseById.has(item.baseId))) merged.inventory = [];
  merged.tier = Math.max(1, Math.min(10, Math.round(merged.tier) || 1));
  merged.packSize = Math.max(1, Math.min(5, Math.round(merged.packSize) || 1)) as CharacterSave['packSize'];
  return merged;
}

export function loadSave(now = Date.now()): CharacterSave | null {
  if (typeof localStorage === 'undefined') return null;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return sanitizeSave(JSON.parse(raw), now);
  } catch {
    return null;
  }
}

export function persistSave(save: CharacterSave, now = Date.now()): void {
  if (typeof localStorage === 'undefined') return;
  save.lastSeen = now;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(save));
  } catch {
    /* storage full or blocked: the session keeps running in memory */
  }
}

export function computeOffline(save: CharacterSave, now = Date.now()): OfflineSummary | null {
  const elapsed = Math.max(0, Math.floor((now - save.lastSeen) / 1000));
  if (elapsed < 60) return null;
  const capped = Math.min(elapsed, 8 * 3600);
  const minutes = capped / 60;
  const packFactor = 0.75 + save.packSize * 0.25;
  const rewardMultiplier = 1 + (save.tier - 1) * 0.35;
  const killsPerMin = 12 * packFactor;
  const kills = Math.floor(minutes * killsPerMin);
  return {
    seconds: capped,
    gold: Math.floor(kills * 5.5 * rewardMultiplier),
    xp: Math.floor(kills * (save.tier === 1 ? 22 : 48) * rewardMultiplier),
    kills,
    keys: dropStage(save) >= 5 ? Math.floor(kills * 0.12) : 0,
  };
}

export function unlockSystem(save: CharacterSave, system: UnlockableSystem): boolean {
  if (save.unlockedSystems.includes(system)) return false;
  save.unlockedSystems.push(system);
  return true;
}

export function unlockAllSystems(save: CharacterSave): UnlockableSystem[] {
  const added: UnlockableSystem[] = [];
  for (const sys of ALL_UNLOCKABLE_SYSTEMS) {
    if (unlockSystem(save, sys)) added.push(sys);
  }
  save.onboardingStep = 6;
  return added;
}

export interface KillDropSummary {
  itemsAdded: ItemInstance[];
  itemsSalvaged: number;
  gemsAdded: string[];
  dustAdded: number;
  scrapAdded: number;
  fluxAdded: number;
  threadAdded: number;
  essenceAdded: number;
}

function playerOwnsGem(save: CharacterSave, gemId: string): boolean {
  if (save.gemStash.some((g) => g.gemId === gemId)) return true;
  return allSocketedGems(save.equipment).some((g) => g.gemId === gemId);
}

/**
 * Clean, data-driven loot drop table (Section 2 & 4):
 * - ~30% War-Scrap (1–3)
 * - ~8% Runic Flux (1)
 * - ~4% Link-Thread (1)
 * - ~2% Rift Essence (1, 6% at Tier 2+)
 * - ~10% Gear (~12–15% combined Gear/Gem)
 * - ~4% Gem (duplicate gems salvage into +15 Gem Dust)
 */
export type DropStage = 1 | 2 | 3 | 4 | 5;

export function hasDroppedGearEquipped(save: CharacterSave): boolean {
  return Object.values(save.equipment).some((item) => Boolean(item?.dropped));
}

export function hasSupportLinked(save: CharacterSave): boolean {
  return Object.values(save.equipment).some(
    (item) =>
      Boolean(item) &&
      (item?.linkedSockets ?? 0) >= 2 &&
      (item?.sockets ?? []).some((gem) => gem && gemById.get(gem.gemId)?.kind === 'support'),
  );
}

export function dropStage(save: CharacterSave): DropStage {
  if (
    save.level >= 3 &&
    hasSupportLinked(save) &&
    save.milestones.forgeUpgrades >= 1
  ) {
    return 5;
  }
  if (save.milestones.sawLowHp) return 4;
  if (save.milestones.packSeconds >= 30) return 3;
  if (save.lifetime.kills >= 5 && hasDroppedGearEquipped(save)) return 2;
  return 1;
}

function weightedPick<T>(rng: () => number, list: T[], weight: (entry: T) => number): T {
  const total = list.reduce((sum, entry) => sum + Math.max(0.0001, weight(entry)), 0);
  let roll = rng() * total;
  for (const entry of list) {
    roll -= Math.max(0.0001, weight(entry));
    if (roll <= 0) return entry;
  }
  return list[list.length - 1]!;
}

function starterBias(save: CharacterSave, baseId: string): number {
  if (!save.starterArchetype) return 1;
  const base = itemBaseById.get(baseId);
  if (!base) return 1;
  const tags = base.slotTags;
  const match =
    save.starterArchetype === 'melee'
      ? tags.some((tag) => tag === 'sword' || tag === 'mace' || tag === 'axe')
      : save.starterArchetype === 'spell'
        ? tags.includes('staff') || tags.includes('trinket')
        : tags.includes('dagger') || tags.includes('ring');
  return match ? 1.4 : 1;
}

function gemBias(save: CharacterSave, gem: (typeof gems)[number]): number {
  if (!save.starterArchetype) return 1;
  const tags = gem.tags ?? [];
  const match =
    save.starterArchetype === 'melee'
      ? tags.includes('melee') || tags.includes('attack')
      : save.starterArchetype === 'spell'
        ? tags.includes('spell')
        : tags.includes('dot') || gem.school === 'void';
  return match ? 1.4 : 1;
}

export function processKillDrops(save: CharacterSave, newKills: number, tier: number, itemFind = 0): KillDropSummary {
  const summary: KillDropSummary = {
    itemsAdded: [],
    itemsSalvaged: 0,
    gemsAdded: [],
    dustAdded: 0,
    scrapAdded: 0,
    fluxAdded: 0,
    threadAdded: 0,
    essenceAdded: 0,
  };

  const findScale = 1 + Math.max(0, itemFind);
  const stage = dropStage(save);

  for (let i = 0; i < newKills; i += 1) {
    const rng = mulberry32(hashSeed(`drop:${save.lifetime.kills}:${i}:${tier}:${save.gold}`));

    if (stage >= 2 && chance(rng, 0.3)) {
      const scrap = 1 + Math.floor(rng() * 3) + Math.floor((tier - 1) / 2);
      save.materials.mat_scrap += scrap;
      summary.scrapAdded += scrap;
    }
    if (stage >= 3 && chance(rng, 0.08)) {
      save.materials.mat_flux += 1;
      summary.fluxAdded += 1;
    }
    if (stage >= 3 && chance(rng, 0.04)) {
      save.materials.mat_thread += 1;
      summary.threadAdded += 1;
    }
    if (stage >= 4 && chance(rng, tier >= 2 ? 0.06 : 0.02)) {
      save.materials.mat_essence += 1;
      summary.essenceAdded += 1;
    }

    const gearChance = stage === 1 ? 0.15 : Math.min(0.35, 0.15 * findScale);
    if (chance(rng, gearChance) && itemBases.length > 0) {
      const base = weightedPick(rng, itemBases, (entry) => starterBias(save, entry.id));
      const roll = rng();
      const rarity: Rarity =
        stage === 1
          ? 'common'
          : roll < 0.02 + tier * 0.005
            ? 'mythic'
            : roll < 0.16 + tier * 0.02
              ? 'rare'
              : roll < 0.56
                ? 'magic'
                : 'common';
      const item = createItem(base.id, rarity, Math.max(1, tier), `drop-${save.lifetime.kills}-${i}`);
      if (stage === 1) {
        const pool = eligibleAffixes(base.id);
        item.affixes = pool.length ? [{ affixId: pickOne(rng, pool).id, tier: 1 }] : [];
      }
      const maxLinks = Math.max(1, item.sockets.length);
      item.linkedSockets = Math.max(1, Math.min(maxLinks, 1 + Math.floor(rng() * maxLinks)));
      item.dropped = true;
      if (save.autoSalvage && item.rarity === 'common') {
        const gain = salvageItem(save, item);
        summary.scrapAdded += gain.scrap;
        summary.fluxAdded += gain.flux;
        summary.itemsSalvaged += 1;
      } else {
        save.inventory.push(item);
        summary.itemsAdded.push(item);
      }
    }

    if (stage >= 2 && chance(rng, Math.min(0.15, 0.04 * findScale))) {
      const pool = gems.filter((gem) => {
        const tags = gem.tags ?? [];
        if (stage < 4 && (tags.includes('guard') || tags.includes('ward'))) return false;
        if (gem.kind === 'active') return stage >= 3 && tags.includes('area') ? true : !tags.includes('area');
        return stage >= 3 || !tags.includes('area');
      });
      if (pool.length) {
        const def = weightedPick(rng, pool, (gem) => gemBias(save, gem));
        if (playerOwnsGem(save, def.id)) {
          save.materials.gem_dust += 15;
          summary.dustAdded += 15;
        } else {
          save.gemStash.push(makeGem(def.id, 1, 'both'));
          summary.gemsAdded.push(def.id);
        }
      }
    }
  }

  return summary;
}

export function awardGemXp(save: CharacterSave, kills: number): void {
  if (kills <= 0) return;
  const xpGain = kills * 4;
  for (const gem of allSocketedGems(save.equipment)) {
    if (gem.level >= 20) continue;
    gem.xp += xpGain;
    while (gem.level < 20 && gem.xp >= gemXpToNext(gem.level)) {
      gem.xp -= gemXpToNext(gem.level);
      gem.level += 1;
    }
  }
}

export function levelUpGemWithDust(save: CharacterSave, gem: GemInstance): { ok: boolean; message: string } {
  if (gem.level >= 20) return { ok: false, message: 'Gem is already max level (Lv 20).' };
  const cost = gemDustCostToLevel(gem.level);
  if ((save.materials.gem_dust ?? 0) < cost) {
    return { ok: false, message: `Need ${cost} Gem Dust.` };
  }
  save.materials.gem_dust -= cost;
  gem.level += 1;
  gem.xp = 0;
  return { ok: true, message: `Gem leveled to Lv ${gem.level}!` };
}

export function evaluateProgression(save: CharacterSave, event?: 'first_death'): ProgressionEntry[] {
  const granted: ProgressionEntry[] = [];
  for (const entry of progression) {
    if (save.grantedProgression.includes(entry.id)) continue;
    const matched =
      'level' in entry.trigger
        ? save.level >= entry.trigger.level
        : event === entry.trigger.event;
    if (!matched) continue;
    save.grantedProgression.push(entry.id);
    if (entry.grants.gem && !playerOwnsGem(save, entry.grants.gem)) {
      save.gemStash.push(makeGem(entry.grants.gem, 1, 'both'));
    }
    granted.push(entry);
  }
  return granted;
}

export function claimOffline(save: CharacterSave, summary: OfflineSummary): ProgressionEntry[] {
  save.gold += summary.gold;
  save.lifetime.gold += summary.gold;
  save.keys += summary.keys;
  save.lifetime.kills += summary.kills;
  return applyXp(save, summary.xp);
}

export function applyXp(save: CharacterSave, amount: number): ProgressionEntry[] {
  save.xp += Math.max(0, Math.round(amount));
  while (save.xp >= xpNeeded(save.level) && save.level < 50) {
    save.xp -= xpNeeded(save.level);
    save.level += 1;
  }
  return evaluateProgression(save);
}

export function applyCombatRewards(save: CharacterSave, rewards: CombatRewards): ProgressionEntry[] {
  save.gold += rewards.gold;
  save.keys += rewards.keys;
  save.lifetime.kills += rewards.kills;
  save.lifetime.elites += rewards.eliteKills;
  save.lifetime.bosses += rewards.bossKills;
  save.lifetime.deaths += rewards.deaths;
  save.lifetime.damage += Math.round(rewards.damage);
  save.lifetime.gold += rewards.gold;
  awardGemXp(save, rewards.kills);
  const unlocked = applyXp(save, rewards.xp);
  if (rewards.deaths > 0) {
    unlocked.push(...evaluateProgression(save, 'first_death'));
  }
  return unlocked;
}

export function totalPoints(save: CharacterSave): number {
  return save.level;
}

export function unspentPoints(save: CharacterSave): number {
  const paid = save.allocated.filter((id) => id !== 'hub_0').length;
  return Math.max(0, totalPoints(save) - paid);
}

export function allocateNode(save: CharacterSave, nodeId: string): { ok: boolean; reason?: string; path?: string[] } {
  const check = canAllocate(save.allocated, nodeId, treeGraph, unspentPoints(save));
  if (!check.ok) return { ok: false, reason: check.reason, path: check.path };
  save.allocated = [...save.allocated, ...check.path];
  return { ok: true, path: check.path };
}

export function refundNode(save: CharacterSave, nodeId: string): { ok: boolean; reason?: string; stranded?: string[] } {
  if (!save.allocated.includes(nodeId) || nodeId === 'hub_0') return { ok: false, reason: 'not-allocated' };
  const articulation = getArticulationPoints(save.allocated, treeGraph);
  if (articulation.includes(nodeId)) {
    const stranded = strandedAfterRemoval(save.allocated, nodeId, treeGraph);
    return { ok: false, reason: 'articulation', stranded };
  }
  save.allocated = save.allocated.filter((id) => id !== nodeId);
  return { ok: true };
}

export function equipItem(save: CharacterSave, item: ItemInstance, slot: ItemSlot): { ok: boolean; reason?: string } {
  if (!fitsSlot(item, slot)) return { ok: false, reason: 'This base does not fit that slot.' };
  const current = save.equipment[slot];
  const twoHanded = itemBase(item).weapon?.twoHanded ?? false;
  const mainToo = itemBase(item).slot === 'main_hand' && save.equipment.main_hand && itemBase(save.equipment.main_hand).weapon?.twoHanded;

  if (slot === 'main_hand' && twoHanded && save.equipment.off_hand) {
    return { ok: false, reason: 'A two-handed weapon spans the off hand. Unequip it first.' };
  }
  if (slot === 'off_hand' && itemBase(item).slot === 'main_hand' && mainToo) {
    return { ok: false, reason: 'The main hand holds a two-handed weapon.' };
  }

  save.inventory = save.inventory.filter((entry) => entry.uid !== item.uid);
  if (save.equipment.main_hand?.uid === item.uid) save.equipment.main_hand = undefined;
  if (save.equipment.off_hand?.uid === item.uid) save.equipment.off_hand = undefined;
  Object.entries(save.equipment).forEach(([key, equipped]) => {
    if (equipped?.uid === item.uid) delete save.equipment[key as ItemSlot];
  });

  save.equipment[slot] = item;
  if (current && current.uid !== item.uid) save.inventory.push(current);
  if (slot === 'main_hand' && twoHanded) {
    if (save.equipment.off_hand) {
      save.inventory.push(save.equipment.off_hand);
      delete save.equipment.off_hand;
    }
  }
  return { ok: true };
}

export function unequipItem(save: CharacterSave, slot: ItemSlot): void {
  const item = save.equipment[slot];
  if (!item) return;
  save.inventory.push(item);
  delete save.equipment[slot];
}

export function socketGem(save: CharacterSave, item: ItemInstance, socketIndex: number, gem: GemInstance): { ok: boolean; reason?: string } {
  if (socketIndex < 0 || socketIndex >= item.sockets.length) return { ok: false, reason: 'No such socket.' };
  if (item.sockets[socketIndex]) return { ok: false, reason: 'Socket is already filled.' };
  item.sockets[socketIndex] = gem;
  save.gemStash = save.gemStash.filter((entry) => entry !== gem);
  return { ok: true };
}

export function unsocketGem(save: CharacterSave, item: ItemInstance, socketIndex: number): void {
  const gem = item.sockets[socketIndex];
  if (!gem) return;
  item.sockets[socketIndex] = null;
  save.gemStash.push(gem);
}

export function assignGemBar(gem: GemInstance, bar: GemInstance['bar']): void {
  gem.bar = bar;
}

export function salvageItem(save: CharacterSave, item: ItemInstance): { scrap: number; flux: number } {
  const gain = {
    scrap: itemGearscore(item) >= 120 ? 6 : 3,
    flux: item.rarity === 'rare' ? 2 : item.rarity === 'mythic' ? 5 : item.rarity === 'magic' ? 1 : 0,
  };
  save.inventory = save.inventory.filter((entry) => entry.uid !== item.uid);
  save.materials.mat_scrap += gain.scrap;
  save.materials.mat_flux += gain.flux;
  return gain;
}

export function socketedGemCount(save: CharacterSave): number {
  return allSocketedGems(save.equipment).length;
}

export function setDoctrine(save: CharacterSave, doctrine: DoctrineId): void {
  save.doctrine = doctrine;
}

export function gemInSockets(save: CharacterSave): GemInstance[] {
  return allSocketedGems(save.equipment);
}

export function inventoryValue(item: ItemInstance): number {
  return Math.round(itemGearscore(item) * 0.8) + 10;
}

export function materialList(): MaterialId[] {
  return [...MATERIAL_IDS];
}

export function pickAffixFor(item: ItemInstance) {
  return eligibleAffixes(item.baseId)[0];
}

export function refillSockets(item: ItemInstance): void {
  while (item.sockets.length < itemBase(item).sockets) item.sockets.push(null);
}

export { socketedGems, allSocketedGems };
export { affixById, skillTree };

export function saveHash(save: CharacterSave): number {
  return hashSeed(JSON.stringify({ level: save.level, xp: save.xp, gold: save.gold, tier: save.tier, allocation: save.allocated.length }));
}
