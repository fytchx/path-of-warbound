import { affixById, itemBaseById } from '../data';
import type { Rarity } from '../data/types';
import { mulberry32, pickOne } from '../engine/rng';
import { itemBase, itemGearscore } from './items';
import { eligibleAffixes, newUid } from './state';
import type { CharacterSave, ItemInstance, MaterialId } from './types';

export interface CraftCost {
  material: MaterialId;
  amount: number;
}

export interface CraftResult {
  ok: boolean;
  message: string;
  cost?: CraftCost;
}

const COSTS = {
  upgrade: (item: ItemInstance): CraftCost => ({ material: 'mat_scrap', amount: 6 + item.itemLevel * 2 }),
  reforge: (item: ItemInstance): CraftCost => ({ material: 'mat_flux', amount: item.rarity === 'mythic' ? 18 : 8 }),
  socket: (item: ItemInstance): CraftCost => ({ material: 'mat_thread', amount: 4 + item.sockets.length * 2 }),
  link: (item: ItemInstance): CraftCost => ({ material: 'mat_thread', amount: 3 + (item.linkedSockets ?? 1) * 2 }),
  lockReforge: (): CraftCost => ({ material: 'mat_essence', amount: 1 }),
  corrupt: (): CraftCost => ({ material: 'mat_essence', amount: 2 }),
  promote: (item: ItemInstance): CraftCost => ({ material: 'mat_flux', amount: item.rarity === 'rare' ? 22 : 10 }),
};

export function canPay(save: CharacterSave, cost: CraftCost): boolean {
  return (save.materials[cost.material] ?? 0) >= cost.amount;
}

function pay(save: CharacterSave, cost: CraftCost): void {
  save.materials[cost.material] -= cost.amount;
}

function seedFor(item: ItemInstance, salt: string): number {
  let hash = 0;
  for (const char of item.uid + salt) hash = (Math.imul(hash, 31) + char.charCodeAt(0)) | 0;
  return hash >>> 0;
}

/** +1 item level and a fresh roll of every affix tier (values follow the tier). */
export function upgradeItem(save: CharacterSave, item: ItemInstance): CraftResult {
  const cost = COSTS.upgrade(item);
  if (!canPay(save, cost)) return { ok: false, message: `Need ${cost.amount} ${cost.material}`, cost };
  pay(save, cost);
  item.itemLevel += 1;
  save.milestones.forgeUpgrades += 1;
  const rng = mulberry32(seedFor(item, `up${item.itemLevel}`));
  item.affixes = item.affixes.map((entry) => ({
    ...entry,
    tier: Math.max(entry.tier, Math.min(5, 1 + Math.floor(rng() * Math.min(5, 1 + Math.floor(item.itemLevel / 8))))),
  }));
  return { ok: true, message: `Tempered to item level ${item.itemLevel}`, cost };
}

/** Reforge rerolls affixes inside the item's current rarity. */
export function reforgeItem(save: CharacterSave, item: ItemInstance): CraftResult {
  const cost = COSTS.reforge(item);
  if (!canPay(save, cost)) return { ok: false, message: `Need ${cost.amount} ${cost.material}`, cost };
  if (item.rarity === 'common') return { ok: false, message: 'Common items have nothing to reforge.', cost };
  pay(save, cost);
  const base = itemBase(item);
  const rng = mulberry32(seedFor(item, `reforge${item.itemLevel}${item.affixes.length}${item.uid}`));
  const pool = eligibleAffixes(item.baseId).filter((a) => a.itemLevel <= item.itemLevel);
  const count = item.affixes.length;
  const picked: { affixId: string; tier: number }[] = [];
  const used = new Set<string>();
  while (picked.length < count && pool.length > used.size) {
    const candidate = pickOne(rng, pool);
    if (used.has(candidate.id)) continue;
    used.add(candidate.id);
    picked.push({
      affixId: candidate.id,
      tier: Math.max(1, Math.min(5, 1 + Math.floor(rng() * Math.min(5, 1 + Math.floor(item.itemLevel / 8))))),
    });
  }
  item.affixes = picked;
  return { ok: true, message: `Reforged ${base.name} into ${picked.length} new affixes`, cost };
}

/** Rift Essence lock: keeps 1 chosen affix and rerolls the rest. */
export function essenceLockReforge(save: CharacterSave, item: ItemInstance, lockedIndex = 0): CraftResult {
  const cost = COSTS.lockReforge();
  if (item.affixes.length < 2) return { ok: false, message: 'Need at least 2 affixes to lock one.', cost };
  if (!canPay(save, cost)) return { ok: false, message: `Need ${cost.amount} ${cost.material}`, cost };
  const safeIndex = Math.max(0, Math.min(item.affixes.length - 1, lockedIndex));
  const kept = item.affixes[safeIndex]!;
  pay(save, cost);

  const rng = mulberry32(seedFor(item, `lock${item.itemLevel}${safeIndex}${save.materials.mat_essence}`));
  const pool = eligibleAffixes(item.baseId).filter((a) => a.itemLevel <= item.itemLevel);
  const targetCount = item.affixes.length;
  const picked: { affixId: string; tier: number }[] = [{ ...kept }];
  const used = new Set<string>([kept.affixId]);

  while (picked.length < targetCount && pool.length > used.size) {
    const candidate = pickOne(rng, pool);
    if (used.has(candidate.id)) continue;
    used.add(candidate.id);
    picked.push({
      affixId: candidate.id,
      tier: Math.max(1, Math.min(5, 1 + Math.floor(rng() * Math.min(5, 1 + Math.floor(item.itemLevel / 8))))),
    });
  }
  item.affixes = picked;
  const keptDef = affixById.get(kept.affixId);
  return { ok: true, message: `Locked ${keptDef?.name ?? 'affix'} and reforged the rest`, cost };
}

export function addSocket(save: CharacterSave, item: ItemInstance): CraftResult {
  const base = itemBase(item);
  const cost = COSTS.socket(item);
  if (item.sockets.length >= base.sockets) {
    return { ok: false, message: `This ${base.baseType} cannot hold more than ${base.sockets} sockets.`, cost };
  }
  if (!canPay(save, cost)) return { ok: false, message: `Need ${cost.amount} ${cost.material}`, cost };
  pay(save, cost);
  item.sockets.push(null);
  if ((item.linkedSockets ?? 0) === 0) item.linkedSockets = 1;
  return { ok: true, message: `Socket ${item.sockets.length} opened`, cost };
}

/** Link-Thread fuses an additional socket link up to the current socket count. */
export function linkSocket(save: CharacterSave, item: ItemInstance): CraftResult {
  const cost = COSTS.link(item);
  const currentLinks = Math.max(1, Math.min(item.sockets.length, item.linkedSockets ?? 1));
  if (item.sockets.length < 2) {
    return { ok: false, message: 'Open at least 2 sockets first.', cost };
  }
  if (currentLinks >= item.sockets.length) {
    return { ok: false, message: 'All sockets on this item are already linked.', cost };
  }
  if (!canPay(save, cost)) return { ok: false, message: `Need ${cost.amount} ${cost.material}`, cost };
  pay(save, cost);
  item.linkedSockets = currentLinks + 1;
  return { ok: true, message: `Fused ${item.linkedSockets}-Link!`, cost };
}

/** Essence corruption: one roll, permanent. Adds a socket if there is space, else raises an affix tier. */
export function corruptItem(save: CharacterSave, item: ItemInstance): CraftResult {
  const cost = COSTS.corrupt();
  if (item.corrupted) return { ok: false, message: 'Already corrupted.', cost };
  if (!canPay(save, cost)) return { ok: false, message: `Need ${cost.amount} ${cost.material}`, cost };
  const base = itemBase(item);
  pay(save, cost);
  const rng = mulberry32(seedFor(item, 'corrupt'));
  const roll = rng();
  item.corrupted = true;

  if (roll < 0.5 && item.sockets.length < base.sockets) {
    item.sockets.push(null);
    return { ok: true, message: 'Corruption opens an extra socket.', cost };
  }
  if (roll < 0.8 && item.affixes.length) {
    const index = Math.floor(rng() * item.affixes.length);
    const affix = item.affixes[index];
    if (affix) affix.tier = Math.min(5, affix.tier + 1);
    return { ok: true, message: 'Corruption empowers one affix.', cost };
  }
  if (item.rarity !== 'mythic') {
    const nextRarity: Record<Rarity, Rarity> = { common: 'magic', magic: 'rare', rare: 'mythic', mythic: 'mythic' };
    item.rarity = nextRarity[item.rarity];
    return { ok: true, message: `Corruption raises the item to ${item.rarity}.`, cost };
  }
  return { ok: true, message: 'The essence finds nothing left to take.', cost };
}

/** Promotes rarity with flux, filling the new affix slots. */
export function promoteRarity(save: CharacterSave, item: ItemInstance): CraftResult {
  const order: Rarity[] = ['common', 'magic', 'rare', 'mythic'];
  const index = order.indexOf(item.rarity);
  if (index < 0 || index === order.length - 1) return { ok: false, message: 'Already mythic.' };
  const cost = COSTS.promote(item);
  if (!canPay(save, cost)) return { ok: false, message: `Need ${cost.amount} ${cost.material}`, cost };
  pay(save, cost);
  item.rarity = order[index + 1]!;

  const targetCount: Record<Rarity, number> = { common: 0, magic: 2, rare: 4, mythic: 5 };
  const pool = eligibleAffixes(item.baseId).filter((a) => a.itemLevel <= item.itemLevel);
  const rng = mulberry32(seedFor(item, `promote${item.rarity}`));
  const used = new Set(item.affixes.map((a) => a.affixId));
  while (item.affixes.length < targetCount[item.rarity] && pool.length > used.size) {
    const candidate = pickOne(rng, pool);
    if (used.has(candidate.id)) continue;
    used.add(candidate.id);
    item.affixes.push({ affixId: candidate.id, tier: 1 });
  }
  return { ok: true, message: `Reforged upward to ${item.rarity}.`, cost };
}

export function itemTooltip(item: ItemInstance): string[] {
  const base = itemBaseById.get(item.baseId);
  if (!base) return [];
  const lines = [`${base.baseType} · item level ${item.itemLevel}`, `Gearscore ${itemGearscore(item)}`];
  for (const roll of item.affixes) {
    const affix = affixById.get(roll.affixId);
    if (!affix) continue;
    const value = affix.values[Math.min(4, Math.max(0, roll.tier - 1))] ?? 0;
    lines.push(`${affix.name}: +${value}${affix.layer === 'more' ? '% more' : affix.layer === 'increased' ? '%' : ''} ${affix.stat.replace(/_/g, ' ')}`);
  }
  if (base.weapon) lines.push(`${base.weapon.minDamage}-${base.weapon.maxDamage} damage · ${base.weapon.attacksPerSecond}/s`);
  if (item.corrupted) lines.push('Corrupted');
  return lines;
}

export const CRAFT_COSTS = COSTS;
export { newUid };
