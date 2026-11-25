import { affixById, itemBaseById } from '../data';
import type { Rarity } from '../data/types';
import { mulberry32, pickOne } from '../engine/rng';
import { itemBase, itemGearscore } from './items';
import { eligibleAffixes, newUid, rollAffixes } from './state';
import type { CharacterSave, ItemInstance, MaterialId } from './types';
import { baseAttribute, rollSocketColors } from './sockets';

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

/** Directive socket caps: 2H 6, 1H/chest 4, other armour 3, jewellery 1. */
export function socketCap(item: ItemInstance): number {
  const base = itemBase(item);
  const tags = base.slotTags;
  let cap = 3;
  if (tags.includes('jewellery')) cap = 1;
  else if (tags.includes('two_hand')) cap = 6;
  else if (tags.includes('one_hand') || tags.includes('chest')) cap = 4;
  return Math.max(base.sockets, cap);
}

function canPayMaterials(save: CharacterSave, costs: Partial<Record<MaterialId, number>>): boolean {
  return Object.entries(costs).every(([id, amount]) => (save.materials[id as MaterialId] ?? 0) >= (amount ?? 0));
}

function payMaterials(save: CharacterSave, costs: Partial<Record<MaterialId, number>>): void {
  for (const [id, amount] of Object.entries(costs)) {
    const key = id as MaterialId;
    save.materials[key] = Math.max(0, (save.materials[key] ?? 0) - (amount ?? 0));
  }
}

/** Jeweller's Craft: adds one socket up to the item cap with a weighted colour. */
export function jewellerCraft(save: CharacterSave, item: ItemInstance, seed = Date.now()): CraftResult {
  if (item.corrupted) return { ok: false, message: 'Corrupted items cannot be modified.' };
  const cap = socketCap(item);
  if (item.sockets.length >= cap) return { ok: false, message: `Already at ${cap} sockets.` };
  if (!canPayMaterials(save, { mat_scrap: 3 })) return { ok: false, message: 'Needs 3 War-Scrap.' };
  payMaterials(save, { mat_scrap: 3 });
  const rng = mulberry32(seed >>> 0);
  const [color] = rollSocketColors(baseAttribute(itemBase(item)), 1, rng);
  item.sockets.push(null);
  item.socketColors.push(color ?? 'white');
  if ((item.linkedSockets ?? 0) === 0) item.linkedSockets = 1;
  save.milestones.forgeUpgrades += 1;
  return { ok: true, message: `Jeweller's Craft added a ${color} socket.` };
}

/** Fusing Craft: rerolls links without ever shrinking the linked group. */
export function fusingCraft(save: CharacterSave, item: ItemInstance, seed = Date.now()): CraftResult {
  if (item.corrupted) return { ok: false, message: 'Corrupted items cannot be modified.' };
  const sockets = item.sockets.length;
  if (sockets < 2) return { ok: false, message: 'Needs at least 2 sockets.' };
  if (!canPayMaterials(save, { mat_thread: 2 })) return { ok: false, message: 'Needs 2 Soul-Thread.' };
  const current = Math.max(1, Math.min(item.linkedSockets ?? 1, sockets));
  if (current >= sockets) return { ok: false, message: 'All sockets are already linked.' };
  payMaterials(save, { mat_thread: 2 });
  const rng = mulberry32(seed >>> 0);
  const span = sockets - current;
  const gain = Math.min(span, Math.max(1, Math.ceil(Math.pow(rng(), 0.65) * span)));
  item.linkedSockets = current + gain;
  save.milestones.forgeUpgrades += 1;
  return { ok: true, message: `Fusing Craft improved the links to ${item.linkedSockets}-link.` };
}

/** Deterministic full link: every socket joins one group. */
export function guaranteedLinkCraft(save: CharacterSave, item: ItemInstance): CraftResult {
  if (item.corrupted) return { ok: false, message: 'Corrupted items cannot be modified.' };
  const sockets = item.sockets.length;
  if (sockets < 2) return { ok: false, message: 'Needs at least 2 sockets.' };
  if ((item.linkedSockets ?? 1) >= sockets) return { ok: false, message: 'Already fully linked.' };
  if (!canPayMaterials(save, { mat_thread: 6, mat_flux: 2 })) return { ok: false, message: 'Needs 6 Soul-Thread and 2 Aether-Flux.' };
  payMaterials(save, { mat_thread: 6, mat_flux: 2 });
  item.linkedSockets = sockets;
  save.milestones.forgeUpgrades += 1;
  return { ok: true, message: `Forged a guaranteed ${sockets}-link.` };
}

function addOneAffix(item: ItemInstance, seed: number): boolean {
  const base = itemBase(item);
  const nextRarity: Rarity = item.rarity === 'common' ? 'magic' : item.rarity;
  const rolled = rollAffixes(base.id, nextRarity, Math.max(1, item.itemLevel), seed >>> 0);
  for (const candidate of rolled) {
    if (item.affixes.some((existing) => existing.affixId === candidate.affixId)) continue;
    item.affixes.push(candidate);
    return true;
  }
  return false;
}

export function transmuteCraft(save: CharacterSave, item: ItemInstance, seed = Date.now()): CraftResult {
  if (item.corrupted) return { ok: false, message: 'Corrupted items cannot be modified.' };
  if (item.rarity !== 'common') return { ok: false, message: 'Transmute needs a Common item.' };
  if (!canPayMaterials(save, { mat_flux: 2 })) return { ok: false, message: 'Needs 2 Aether-Flux.' };
  payMaterials(save, { mat_flux: 2 });
  item.rarity = 'magic';
  addOneAffix(item, seed);
  save.milestones.forgeUpgrades += 1;
  return { ok: true, message: 'Transmuted to Magic.' };
}

export function augmentCraft(save: CharacterSave, item: ItemInstance, seed = Date.now()): CraftResult {
  if (item.corrupted) return { ok: false, message: 'Corrupted items cannot be modified.' };
  if (item.rarity !== 'magic') return { ok: false, message: 'Augment needs a Magic item.' };
  if (item.affixes.length >= 2) return { ok: false, message: 'This Magic item already has 2 affixes.' };
  if (!canPayMaterials(save, { mat_flux: 2 })) return { ok: false, message: 'Needs 2 Aether-Flux.' };
  payMaterials(save, { mat_flux: 2 });
  if (!addOneAffix(item, seed)) return { ok: false, message: 'No affix could be added.' };
  save.milestones.forgeUpgrades += 1;
  return { ok: true, message: 'Augmented with a second affix.' };
}

export function regalCraft(save: CharacterSave, item: ItemInstance, seed = Date.now()): CraftResult {
  if (item.corrupted) return { ok: false, message: 'Corrupted items cannot be modified.' };
  if (item.rarity !== 'magic') return { ok: false, message: 'Regal needs a Magic item.' };
  if (!canPayMaterials(save, { mat_flux: 3, mat_essence: 1 })) return { ok: false, message: 'Needs 3 Aether-Flux and 1 Void-Essence.' };
  payMaterials(save, { mat_flux: 3, mat_essence: 1 });
  item.rarity = 'rare';
  let guard = 0;
  while (item.affixes.length < 3 && guard < 6) {
    if (!addOneAffix(item, seed + guard * 131)) break;
    guard += 1;
  }
  save.milestones.forgeUpgrades += 1;
  return { ok: true, message: 'Regal upgrade: the item is now Rare.' };
}

export function chaosCraft(save: CharacterSave, item: ItemInstance, seed = Date.now()): CraftResult {
  if (item.corrupted) return { ok: false, message: 'Corrupted items cannot be modified.' };
  if (item.rarity !== 'rare') return { ok: false, message: 'Chaos needs a Rare item.' };
  if (!canPayMaterials(save, { mat_essence: 2 })) return { ok: false, message: 'Needs 2 Void-Essence.' };
  payMaterials(save, { mat_essence: 2 });
  item.affixes = rollAffixes(itemBase(item).id, 'rare', Math.max(1, item.itemLevel), seed >>> 0);
  save.milestones.forgeUpgrades += 1;
  return { ok: true, message: 'Chaos Reforge rolled new affixes.' };
}
