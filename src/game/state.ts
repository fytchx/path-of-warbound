import { affixById, affixes, itemBaseById, progression, skillTree } from '../data';
import type { DoctrineId, ItemSlot, ProgressionEntry, Rarity } from '../data/types';
import { buildTreeGraph, canAllocate, getArticulationPoints, strandedAfterRemoval } from '../engine/treeGraph';
import type { CombatRewards } from '../engine/combatEngine';
import { mulberry32, pickOne } from '../engine/rng';
import {
  allSocketedGems,
  fitsSlot,
  itemBase,
  itemGearscore,
  socketedGems,
} from './items';
import { MATERIAL_IDS, type CharacterSave, type GemInstance, type ItemInstance, type MaterialId, type OfflineSummary } from './types';

export const STORAGE_KEY = 'path-of-warbound.save.v1';
export const SAVE_VERSION = 2;

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
  return 90 + (level - 1) * 55;
}

export function eligibleAffixes(baseId: string): typeof affixes {
  const base = itemBaseById.get(baseId);
  if (!base) return [];
  return affixes.filter((affix) => affix.slotTags.some((tag) => base.slotTags.includes(tag)));
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

function withGems(item: ItemInstance, gems: (GemInstance | null)[]): ItemInstance {
  const sockets = [...item.sockets];
  gems.forEach((gem, index) => {
    if (index < sockets.length) sockets[index] = gem;
  });
  return { ...item, sockets };
}

export function createInitialSave(now = Date.now()): CharacterSave {
  const seed = 'warbound-v0.1';
  const weapon = withGems(createItem('base_sword_1h', 'common', 1, seed), [makeGem('gem_cleave', 1, 'both'), null, null]);

  const equipment: Partial<Record<ItemSlot, ItemInstance>> = {
    main_hand: weapon,
    chest: createItem('base_chest', 'common', 1, seed),
    boots: createItem('base_boots', 'common', 1, seed),
  };

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
    packSize: 2,
    zoneId: 'zone_ashen_graveyard',
    tier: 1,
    equipment,
    inventory: [],
    gemStash: [],
    allocated: ['hub_0'],
    skillSlots: 1,
    unlockedSystems: [],
    grantedProgression: [],
    lifetime: { kills: 0, elites: 0, bosses: 0, deaths: 0, damage: 0, gold: 0 },
    settings: { reducedMotion: false, logCombat: true },
  };
}

export function sanitizeSave(raw: unknown, now = Date.now()): CharacterSave {
  const fallback = createInitialSave(now);
  if (!raw || typeof raw !== 'object') return fallback;
  const candidate = raw as Partial<CharacterSave>;
  if (candidate.version !== SAVE_VERSION) return fallback;
  const merged: CharacterSave = { ...fallback, ...candidate, settings: { ...fallback.settings, ...candidate.settings } };
  merged.materials = { ...fallback.materials, ...candidate.materials };
  merged.lifetime = { ...fallback.lifetime, ...candidate.lifetime };
  if (!Array.isArray(merged.inventory)) merged.inventory = [];
  if (!Array.isArray(merged.gemStash)) merged.gemStash = [];
  if (!Array.isArray(merged.allocated) || !merged.allocated.includes('hub_0')) merged.allocated = ['hub_0'];
  if (!Array.isArray(merged.unlockedSystems)) merged.unlockedSystems = [];
  if (!Array.isArray(merged.grantedProgression)) merged.grantedProgression = [];
  merged.skillSlots = Math.max(1, Math.floor(Number(merged.skillSlots) || 1));
  if (!merged.equipment || typeof merged.equipment !== 'object') merged.equipment = {};
  if (!merged.inventory.every((item) => itemBaseById.has(item.baseId))) merged.inventory = [];
  merged.tier = Math.max(1, Math.min(10, Math.round(merged.tier) || 1));
  merged.packSize = (Math.max(1, Math.min(5, Math.round(merged.packSize) || 2)) as CharacterSave['packSize']);
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
  const rewardMultiplier = 1 + (save.tier - 1) * 0.12;
  const summary: OfflineSummary = {
    seconds: capped,
    gold: Math.floor(minutes * (1.6 + save.tier * 0.55) * rewardMultiplier),
    xp: Math.floor(minutes * (1.1 + save.tier * 0.45) * rewardMultiplier),
    kills: Math.floor(minutes * (1.4 + save.tier * 0.35)),
    keys: Math.floor(minutes * 0.035),
  };
  return summary;
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
    if (entry.grants.skillSlot) {
      save.skillSlots += entry.grants.skillSlot;
    }
    if (entry.grants.gem) {
      save.gemStash.push(makeGem(entry.grants.gem, 1));
    }
    for (const system of entry.grants.unlockedSystems ?? []) {
      if (!save.unlockedSystems.includes(system)) save.unlockedSystems.push(system);
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
  };  save.inventory = save.inventory.filter((entry) => entry.uid !== item.uid);
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

export function pickAffixFor(item: ItemInstance): (typeof affixes)[number] | undefined {
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
