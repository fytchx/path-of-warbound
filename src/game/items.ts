import { affixById, itemBaseById } from '../data';
import type { ItemBase, ItemSlot, Rarity, StatMod } from '../data/types';
import type { GemInstance, ItemInstance } from './types';

export const RARITY_AFFIX_COUNT: Record<Rarity, number> = {
  common: 0,
  magic: 2,
  rare: 4,
  mythic: 5,
};

export const RARITY_COLOR: Record<Rarity, string> = {
  common: '#8a8a8a',
  magic: '#4a7be0',
  rare: '#D4AF37',
  mythic: '#9B51E0',
};

export const RARITY_LABEL: Record<Rarity, string> = {
  common: 'Common',
  magic: 'Magic',
  rare: 'Rare',
  mythic: 'Mythic',
};

export function itemBase(item: ItemInstance): ItemBase {
  const base = itemBaseById.get(item.baseId);
  if (!base) throw new Error(`Unknown item base: ${item.baseId}`);
  return base;
}

export function affixValue(item: ItemInstance, index: number): number {
  const rolled = item.affixes[index];
  if (!rolled) return 0;
  const affix = affixById.get(rolled.affixId);
  if (!affix) return 0;
  return affix.values[Math.min(4, Math.max(0, rolled.tier - 1))]!;
}

export function itemMods(item: ItemInstance): StatMod[] {
  const base = itemBase(item);
  const mods: StatMod[] = [...base.implicit];
  item.affixes.forEach((rolled, index) => {
    const affix = affixById.get(rolled.affixId);
    if (affix) mods.push({ stat: affix.stat, layer: affix.layer, value: affixValue(item, index) });
  });
  return mods;
}

export function itemAffixName(item: ItemInstance): string {
  const prefix = item.affixes
    .map((a) => affixById.get(a.affixId))
    .filter((a) => a?.kind === 'prefix')
    .map((a) => a!.name);
  const suffix = item.affixes
    .map((a) => affixById.get(a.affixId))
    .filter((a) => a?.kind === 'suffix')
    .map((a) => a!.name);
  return [...prefix, itemBase(item).name, ...suffix].join(' ');
}

export function itemGearscore(item: ItemInstance): number {
  const linked = item.sockets.filter(Boolean).length;
  return item.itemLevel * 10 + item.affixes.reduce((sum, a) => sum + a.tier * 15, 0) + linked * 25;
}

export function characterGearscore(equipment: Partial<Record<ItemSlot, ItemInstance>>): number {
  return Object.values(equipment).reduce((sum, item) => sum + (item ? itemGearscore(item) : 0), 0);
}

export function fitsSlot(item: ItemInstance, slot: ItemSlot): boolean {
  const base = itemBase(item);
  if (base.slot === slot) return true;
  if (base.slotTags.includes('ring') && (slot === 'ring_1' || slot === 'ring_2')) return true;
  if (slot === 'off_hand') return base.slotTags.includes('one_hand') || base.slotTags.includes('shield') || base.slotTags.includes('focus');
  return false;
}

export function socketedGems(item: ItemInstance): GemInstance[] {
  return item.sockets.filter((gem): gem is GemInstance => gem !== null);
}

export function allSocketedGems(equipment: Partial<Record<ItemSlot, ItemInstance>>): GemInstance[] {
  return Object.values(equipment).flatMap((item) => (item ? socketedGems(item) : []));
}

export function gemXpToNext(level: number): number {
  return 100 + (level - 1) * 60;
}
