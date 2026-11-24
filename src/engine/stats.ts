import { gemById, itemBaseById, nodeById, statRegistry } from '../data';
import type { AilmentId, DoctrineId, GemDef, ItemBase, School, StatMod, WeaponProfile } from '../data/types';
import type { CharacterSave, GemInstance, ItemInstance } from '../game/types';
import { allSocketedGems, characterGearscore, itemBase, itemMods } from '../game/items';

export interface StatValue {
  base: number;
  flat: number;
  increased: number;
  more: number;
}

/** Characterisation of the original pipeline: flat, then additive increased, then multiplicative more. */
export function resolveStat(stat: StatValue): number {
  const flatValue = stat.base + stat.flat;
  const increasedValue = flatValue * (1 + stat.increased);
  return increasedValue * (1 + stat.more);
}

type Bag = { flat: Record<string, number>; increased: Record<string, number>; more: Record<string, number> };

const emptyBag = (): Bag => ({ flat: {}, increased: {}, more: {} });

function addTo(map: Record<string, number>, key: string, value: number): void {
  map[key] = (map[key] ?? 0) + value;
}

function addMods(bag: Bag, mods: StatMod[], scale = 1): void {
  for (const mod of mods) {
    addTo(bag[mod.layer], mod.stat, mod.value * scale);
  }
}

/**
 * Master aggregation: X = (base + sum(flat)) * (1 + sum(increased)) * product(1 + more).
 * Pure and recomputed from scratch on every call.
 */
export function aggregateStats(mods: StatMod[], base: Record<string, number>): Record<string, number> {
  const bag = emptyBag();
  addMods(bag, mods);
  const stats: Record<string, number> = {};
  const keys = new Set([...Object.keys(base), ...Object.keys(bag.flat), ...Object.keys(bag.increased), ...Object.keys(bag.more)]);
  for (const key of keys) {
    const baseValue = base[key] ?? 0;
    let value = baseValue + (bag.flat[key] ?? 0);
    value *= 1 + (bag.increased[key] ?? 0) / 100;
    for (const mod of mods) {
      if (mod.layer === 'more' && mod.stat === key) value *= 1 + mod.value / 100;
    }
    stats[key] = value;
  }
  return stats;
}

export function baseStats(level: number): Record<string, number> {
  const base: Record<string, number> = {};
  for (const [id, def] of Object.entries(statRegistry.stats)) base[id] = def.base;
  const levels = Math.max(0, level - 1);
  base.max_hp = (base.max_hp ?? 0) + levels * 10;
  base.max_mana = (base.max_mana ?? 0) + levels * 4;
  base.armor = (base.armor ?? 0) + levels * 2;
  base.might = (base.might ?? 0) + Math.floor(levels / 5);
  base.agility = (base.agility ?? 0) + Math.floor(levels / 5);
  base.wisdom = (base.wisdom ?? 0) + Math.floor(levels / 5);
  base.fortitude = (base.fortitude ?? 0) + Math.floor(levels / 5);
  return base;
}

export interface CombatSkill {
  id: string;
  gemId: string;
  name: string;
  school: School;
  minDamage: number;
  maxDamage: number;
  effectiveness: number;
  manaCost: number;
  cooldown: number;
  castTime: number;
  tags: string[];
  ailment?: { id: AilmentId; chance: number; dps: number; duration: number };
  level: number;
  bar: GemInstance['bar'];
}

export type TriggerType = 'crit' | 'damage' | null;

export interface PlayerStats {
  values: Record<string, number>;
  keystones: Set<string>;
  weapon: WeaponProfile;
  weaponBase: ItemBase;
  weaponName: string;
  skills: CombatSkill[];
  supports: GemDef[];
  triggerType: TriggerType;
  critChance: number;
  critMultiplier: number;
  doubleHitChance: number;
  dodgeCap: number;
  dodgePerHit: number;
  armor: number;
  resist: Record<School, number>;
  maxHp: number;
  maxMana: number;
  maxWard: number;
  hpRegen: number;
  manaRegen: number;
  attackSpeedMultiplier: number;
  castSpeedMultiplier: number;
  manaCostMultiplier: number;
  ailmentPotency: number;
  lifeLeech: number;
  areaDamageMore: number;
  executeDamageMore: number;
  extraProjectiles: number;
  goldFind: number;
  itemFind: number;
  schoolIncreased: Record<School, number>;
  gearscore: number;
  doctrine: DoctrineId;
  doctrineMultiplier: number;
}

const FALLBACK_WEAPON: WeaponProfile = {
  minDamage: 6,
  maxDamage: 10,
  attacksPerSecond: 1.2,
  twoHanded: false,
  archetype: 'sword',
};

const SCHOOLS: School[] = ['physical', 'fire', 'frost', 'lightning', 'void'];

function skillFromGem(gem: GemDef, instance: GemInstance): CombatSkill | null {
  if (gem.kind !== 'active' || !gem.damage || !gem.school) return null;
  const scale = 1 + 0.14 * (instance.level - 1);
  const cooldownScale = Math.max(0.35, 1 - 0.02 * (instance.level - 1));
  return {
    id: `skill_${gem.id}`,
    gemId: gem.id,
    name: gem.name,
    school: gem.school,
    minDamage: gem.damage.min * scale,
    maxDamage: gem.damage.max * scale,
    effectiveness: gem.damage.effectiveness,
    manaCost: gem.manaCost ?? 0,
    cooldown: (gem.cooldown ?? 0) * cooldownScale,
    castTime: gem.castTime ?? 0,
    tags: gem.tags,
    ailment: gem.ailment,
    level: instance.level,
    bar: instance.bar,
  };
}

function collectGemMods(gems: GemInstance[]): { mods: StatMod[]; supports: GemDef[] } {
  const mods: StatMod[] = [];
  const supports: GemDef[] = [];
  for (const instance of gems) {
    const gem = gemById.get(instance.gemId);
    if (!gem) continue;
    if (gem.kind === 'support') {
      supports.push(gem);
    }
    const scale = gem.kind === 'support' ? 1 + 0.06 * (instance.level - 1) : 1 + 0.05 * (instance.level - 1);
    mods.push(...gem.mods.map((mod) => ({ ...mod, value: mod.value * scale })));
  }
  return { mods, supports };
}

export function equippedWeapon(save: CharacterSave): { base: ItemBase; profile: WeaponProfile } {
  const main = save.equipment.main_hand;
  if (main) {
    const base = itemBase(main);
    if (base.weapon) return { base, profile: base.weapon };
  }
  const fallbackBase = itemBaseById.get('base_sword_1h')!;
  return { base: fallbackBase, profile: FALLBACK_WEAPON };
}

export function computePlayerStats(save: CharacterSave): PlayerStats {
  const mods: StatMod[] = [];
  const keystones = new Set<string>();

  for (const id of save.allocated) {
    const node = nodeById(id);
    if (!node) continue;
    if (node.kind === 'keystone') keystones.add(node.id);
    mods.push(...node.mods);
  }

  for (const item of Object.values(save.equipment)) {
    if (!item) continue;
    mods.push(...itemMods(item));
  }

  const socketed = allSocketedGems(save.equipment);
  const { mods: gemMods, supports } = collectGemMods(socketed);
  mods.push(...gemMods);

  const stats = aggregateStats(mods, baseStats(save.level));

  // Pass 1: attribute and defence conversions (forward-only, applied from current values).
  const passOne = statRegistry.conversions.filter((c) => c.pass === 1 && c.percent > 0);
  for (const conv of passOne) {
    const amount = (stats[conv.from] ?? 0) * (conv.percent / 100);
    stats[conv.from] = (stats[conv.from] ?? 0) - amount;
    stats[conv.to] = (stats[conv.to] ?? 0) + amount;
  }

  // Pass 2: damage school conversions.
  const passTwo = statRegistry.conversions.filter((c) => c.pass === 2 && c.percent > 0);
  for (const conv of passTwo) {
    const amount = (stats[conv.from] ?? 0) * (conv.percent / 100);
    stats[conv.from] = (stats[conv.from] ?? 0) - amount;
    stats[conv.to] = (stats[conv.to] ?? 0) + amount;
  }

  // Support-driven physical -> fire conversion.
  const supportShift = Math.min(100, Math.max(0, stats.convert_physical_fire ?? 0));
  if (supportShift > 0) {
    const amount = (stats.dmg_physical ?? 0) * (supportShift / 100);
    stats.dmg_physical = (stats.dmg_physical ?? 0) - amount;
    stats.dmg_fire = (stats.dmg_fire ?? 0) + amount;
  }

  const weapon = equippedWeapon(save);

  if (keystones.has('ks_ghostframe')) stats.max_hp = (stats.max_hp ?? 0) * 0.6;

  let armor = stats.armor ?? 0;
  if (keystones.has('ks_lattice_skin')) {
    stats.max_ward = (stats.max_ward ?? 0) + armor * 0.6;
    armor = 0;
  }

  const might = stats.might ?? 0;
  const agility = stats.agility ?? 0;
  const dodgeCap = keystones.has('ks_ghostframe') ? 150 : 75;

  const skills: CombatSkill[] = [];
  for (const instance of socketed) {
    const gem = gemById.get(instance.gemId);
    if (!gem) continue;
    const skill = skillFromGem(gem, instance);
    if (skill) skills.push(skill);
  }

  const triggerSupports = supports.map((s) => s.id);
  const triggerType: TriggerType = triggerSupports.includes('support_cast_on_crit')
    ? 'crit'
    : triggerSupports.includes('support_cast_when_damage_taken')
      ? 'damage'
      : null;

  const doctrineMultiplier = keystones.has('ks_zealots_mandate') ? 2 : 1;

  return {
    values: stats,
    keystones,
    weapon: weapon.profile,
    weaponBase: weapon.base,
    weaponName: weapon.base.name,
    skills,
    supports,
    triggerType,
    critChance: Math.min(0.95, Math.max(0, (stats.crit_chance ?? 0) / 100)),
    critMultiplier: 1.5 + (stats.crit_multi ?? 0) / 100 + might / 200,
    doubleHitChance: Math.min(0.75, Math.max(0, agility / (agility + 250) + (stats.double_hit ?? 0) / 100)),
    dodgeCap,
    dodgePerHit: Math.min(dodgeCap, (stats.dodge_rating ?? 0) * 0.25 + agility * 0.01),
    armor,
    resist: {
      physical: stats.res_physical ?? 0,
      fire: stats.res_fire ?? 0,
      frost: stats.res_frost ?? 0,
      lightning: stats.res_lightning ?? 0,
      void: stats.res_void ?? 0,
    },
    maxHp: Math.max(1, stats.max_hp ?? 1),
    maxMana: Math.max(0, stats.max_mana ?? 0),
    maxWard: Math.max(0, stats.max_ward ?? 0),
    hpRegen: stats.hp_regen ?? 0,
    manaRegen: stats.mana_regen ?? 0,
    attackSpeedMultiplier: 1 + (stats.attack_speed ?? 0) / 100,
    castSpeedMultiplier: 1 + (stats.cast_speed ?? 0) / 100,
    manaCostMultiplier: 1 + (stats.mana_cost ?? 0) / 100,
    ailmentPotency: 1 + (stats.ailment_potency ?? 0) / 100,
    lifeLeech: (stats.life_leech ?? 0) / 100,
    areaDamageMore: 1 + (stats.area_damage ?? 0) / 100,
    executeDamageMore: 1 + (stats.execute_damage ?? 0) / 100,
    extraProjectiles: Math.max(0, Math.round(stats.projectile_count ?? 0)),
    goldFind: (stats.gold_find ?? 0) / 100,
    itemFind: (stats.item_find ?? 0) / 100,
    schoolIncreased: {
      physical: (stats.dmg_physical ?? 0) / 100,
      fire: (stats.dmg_fire ?? 0) / 100,
      frost: (stats.dmg_frost ?? 0) / 100,
      lightning: (stats.dmg_lightning ?? 0) / 100,
      void: (stats.dmg_void ?? 0) / 100,
    },
    gearscore: characterGearscore(save.equipment),
    doctrine: save.doctrine,
    doctrineMultiplier,
  };
}

export function itemModSummary(item: ItemInstance): StatMod[] {
  return itemMods(item);
}

export const ALL_SCHOOLS = SCHOOLS;
