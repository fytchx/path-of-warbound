import { gemById, itemBaseById, nodeById, statRegistry } from '../data';
import type { AilmentId, DoctrineId, GemDef, ItemBase, ItemSlot, School, StatMod, WeaponProfile } from '../data/types';
import type { CharacterSave, GemInstance, ItemInstance } from '../game/types';
import { characterGearscore, itemBase, itemMods } from '../game/items';

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
  base.max_mana = (base.max_mana ?? 0) + levels * 5;
  base.armor = (base.armor ?? 0) + levels * 2;
  base.might = (base.might ?? 0) + Math.floor(levels / 5);
  base.agility = (base.agility ?? 0) + Math.floor(levels / 5);
  base.wisdom = (base.wisdom ?? 0) + Math.floor(levels / 5);
  base.fortitude = (base.fortitude ?? 0) + Math.floor(levels / 5);
  return base;
}

export type TriggerType = 'crit' | 'damage' | 'hit' | null;

export interface CombatSkill {
  id: string;
  gemId: string;
  name: string;
  school: School;
  minDamage: number;
  maxDamage: number;
  effectiveMinDamage: number;
  effectiveMaxDamage: number;
  effectiveness: number;
  manaCost: number;
  effectiveManaCost: number;
  manaReservation: number;
  cooldown: number;
  effectiveCooldown: number;
  castTime: number;
  effectiveCastTime: number;
  damageMoreMultiplier: number;
  areaDamageMore: number;
  executeDamageMore: number;
  extraProjectiles: number;
  doubleHitBonus: number;
  lifeLeechBonus: number;
  ailmentPotencyBonus: number;
  convertPhysicalFire: number;
  hasProliferation: boolean;
  triggerType: TriggerType;
  linkedSupportIds: string[];
  linkedSupportNames: string[];
  snakeRank: number;
  sourceSlot: ItemSlot;
  sourceSocketIndex: number;
  tags: string[];
  ailment?: { id: AilmentId; chance: number; dps: number; duration: number };
  level: number;
  bar: GemInstance['bar'];
}

export interface AppliedConversion {
  pass: 1 | 2;
  from: string;
  to: string;
  percent: number;
  amount: number;
}

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
  armorBreak: number;
  thorns: number;
  wardDelay: number;
  dotSpeedMultiplier: number;
  cooldownRecoveryMultiplier: number;
  resist: Record<School, number>;
  maxHp: number;
  totalMaxMana: number;
  reservedMana: number;
  reservedManaPct: number;
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
  conversionsApplied: AppliedConversion[];
  trinketId?: string;
  gearscore: number;
  doctrine: DoctrineId;
  doctrineMultiplier: number;
}

const FALLBACK_WEAPON: WeaponProfile = {
  minDamage: 11,
  maxDamage: 17,
  attacksPerSecond: 1.3,
  twoHanded: false,
  archetype: 'sword',
};

const SCHOOLS: School[] = ['physical', 'fire', 'frost', 'lightning', 'void'];

/** Snake-order slot hierarchy from Section 3.5 */
export const SNAKE_SLOT_ORDER: ItemSlot[] = [
  'chest',
  'ring_1',
  'main_hand',
  'ring_2',
  'off_hand',
  'helmet',
  'amulet',
  'gloves',
  'boots',
  'legs',
  'trinket',
];

/** Snake-order socket index walk (1→2→4→3→5→6 in 1-based indexing). */
export const SNAKE_SOCKET_INDICES = [0, 1, 3, 2, 4, 5];

function snakeOrderIndices(length: number): number[] {
  const result: number[] = [];
  for (const idx of SNAKE_SOCKET_INDICES) {
    if (idx < length) result.push(idx);
  }
  for (let i = 0; i < length; i += 1) {
    if (!result.includes(i)) result.push(i);
  }
  return result;
}

function supportMatchesActive(support: GemDef, active: GemDef): boolean {
  const allowed = support.support?.allowedTags;
  if (!allowed || allowed.length === 0) return true;
  return allowed.some((tag) => active.tags.includes(tag));
}

function supportTriggerType(supportId: string): TriggerType {
  if (supportId === 'support_cast_on_crit') return 'crit';
  if (supportId === 'support_cast_when_damage_taken') return 'damage';
  return null;
}

interface SocketedActiveEntry {
  slot: ItemSlot;
  socketIndex: number;
  snakeRank: number;
  instance: GemInstance;
  gem: GemDef;
  linkedSupports: { instance: GemInstance; gem: GemDef }[];
}

function collectSocketedEntries(save: CharacterSave): {
  actives: SocketedActiveEntry[];
  globalMods: StatMod[];
  linkedSupports: GemDef[];
  reservedPct: number;
} {
  const actives: SocketedActiveEntry[] = [];
  const globalMods: StatMod[] = [];
  const linkedSupports: GemDef[] = [];
  let reservedPct = 0;
  let snakeRank = 0;

  for (const slot of SNAKE_SLOT_ORDER) {
    const item = save.equipment[slot];
    if (!item) continue;

    const linkCount =
      item.linkedSockets !== undefined
        ? Math.max(0, Math.min(item.sockets.length, item.linkedSockets))
        : item.sockets.length;

    const linkedGroup: { instance: GemInstance; gem: GemDef; socketIndex: number }[] = [];
    for (let idx = 0; idx < linkCount; idx += 1) {
      const inst = item.sockets[idx];
      if (!inst) continue;
      const def = gemById.get(inst.gemId);
      if (def) linkedGroup.push({ instance: inst, gem: def, socketIndex: idx });
    }

    const activeGemsInGroup = linkedGroup.filter((entry) => entry.gem.kind === 'active');
    const supportGemsInGroup = linkedGroup.filter((entry) => entry.gem.kind === 'support');

    const addedSupportInstances = new Set<GemInstance>();

    for (const idx of snakeOrderIndices(item.sockets.length)) {
      const inst = item.sockets[idx];
      if (!inst) continue;
      const def = gemById.get(inst.gemId);
      if (!def) continue;

      if (def.kind === 'active') {
        const isInLinkedGroup = idx < linkCount;
        const matchingSupports = isInLinkedGroup
          ? supportGemsInGroup.filter((sup) => supportMatchesActive(sup.gem, def))
          : [];

        for (const sup of matchingSupports) {
          if (!addedSupportInstances.has(sup.instance)) {
            addedSupportInstances.add(sup.instance);
            linkedSupports.push(sup.gem);
          }
        }

        // Reservation & active passive mods always apply when socketed.
        if (def.manaReservation && def.manaReservation > 0) {
          reservedPct += def.manaReservation;
        }
        const activeScale = 1 + 0.05 * (inst.level - 1);
        globalMods.push(...def.mods.map((m) => ({ ...m, value: m.value * activeScale })));

        // Non-combat / aura reservations don't enter active cast list unless they also cast.
        if (def.damage || def.tags.includes('guard')) {
          actives.push({
            slot,
            socketIndex: idx,
            snakeRank,
            instance: inst,
            gem: def,
            linkedSupports: matchingSupports.map((s) => ({ instance: s.instance, gem: s.gem })),
          });
          snakeRank += 1;
        }
      } else if (def.kind === 'support' && idx < linkCount && activeGemsInGroup.length > 0) {
        const anyMatch = activeGemsInGroup.some((act) => supportMatchesActive(def, act.gem));
        if (anyMatch) {
          const supScale = 1 + 0.06 * (inst.level - 1);
          // Global utility mods like life_leech, double_hit, convert_physical_fire, cast_speed, mana_cost
          // also aggregate globally when linked to a matching active gem.
          globalMods.push(...def.mods.map((m) => ({ ...m, value: m.value * supScale })));
        }
      }
    }
  }

  return { actives, globalMods, linkedSupports, reservedPct };
}

function buildCombatSkill(entry: SocketedActiveEntry, stats: Record<string, number>, manaCostMultiplier: number, castSpeedMultiplier: number, attackSpeedMultiplier: number, cooldownRecoveryMultiplier: number, hollowFist: boolean): CombatSkill | null {
  const { gem, instance, linkedSupports } = entry;
  if (!gem.school) return null;
  const dmgDef = gem.damage ?? { min: 0, max: 0, effectiveness: 0 };
  const scale = 1 + 0.14 * (instance.level - 1);
  const levelCooldownScale = Math.max(0.35, 1 - 0.02 * (instance.level - 1));

  let damageMoreMultiplier = 1;
  let areaDamageMore = 1;
  let executeDamageMore = 1;
  let extraProjectiles = 0;
  let doubleHitBonus = 0;
  let lifeLeechBonus = 0;
  let ailmentPotencyBonus = 0;
  let convertPhysicalFire = 0;
  let hasProliferation = false;
  let localCastSpeedInc = 0;
  let localManaCostInc = 0;
  let triggerType: TriggerType = null;

  for (const sup of linkedSupports) {
    const supScale = 1 + 0.06 * (sup.instance.level - 1);
    const trig = supportTriggerType(sup.gem.id);
    if (trig && !triggerType) {
      triggerType = trig; // One trigger source per gem rule.
    }
    if (sup.gem.id === 'support_ailment_proliferation') {
      hasProliferation = true;
    }
    for (const mod of sup.gem.mods) {
      const val = mod.value * supScale;
      if (mod.stat === 'area_damage' && mod.layer === 'more') {
        areaDamageMore *= 1 + val / 100;
        damageMoreMultiplier *= 1 + val / 100;
      } else if (mod.stat === 'execute_damage' && mod.layer === 'more') {
        executeDamageMore *= 1 + val / 100;
      } else if (mod.stat === 'projectile_count') {
        extraProjectiles += Math.round(val);
      } else if (mod.stat === 'double_hit') {
        doubleHitBonus += val / 100;
      } else if (mod.stat === 'life_leech') {
        lifeLeechBonus += val / 100;
      } else if (mod.stat === 'ailment_potency') {
        ailmentPotencyBonus += val / 100;
      } else if (mod.stat === 'convert_physical_fire') {
        convertPhysicalFire = Math.min(100, convertPhysicalFire + val);
      } else if (mod.stat === 'cast_speed') {
        localCastSpeedInc += val;
      } else if (mod.stat === 'mana_cost') {
        localManaCostInc += val;
      } else if (mod.layer === 'more' && (mod.stat === 'dmg_increased' || mod.stat === `dmg_${gem.school}`)) {
        damageMoreMultiplier *= 1 + val / 100;
      }
    }
  }

  const might = stats.might ?? 0;
  const schoolIncreased = (stats[`dmg_${gem.school}`] ?? 0) / 100;
  const globalIncreased = (stats.dmg_increased ?? 0) / 100;
  const hollowDmgMult = hollowFist ? 0.75 : 1;
  const hollowManaMult = hollowFist ? 1.5 : 1;

  const baseMin = dmgDef.min * scale;
  const baseMax = dmgDef.max * scale;
  const apFlat = might * 0.25 * dmgDef.effectiveness;

  const effectiveMinDamage =
    baseMax > 0
      ? (baseMin * dmgDef.effectiveness * (1 + might / 100) + apFlat) * (1 + schoolIncreased + globalIncreased) * damageMoreMultiplier * hollowDmgMult
      : 0;
  const effectiveMaxDamage =
    baseMax > 0
      ? (baseMax * dmgDef.effectiveness * (1 + might / 100) + apFlat) * (1 + schoolIncreased + globalIncreased) * damageMoreMultiplier * hollowDmgMult
      : 0;

  const baseCooldown = (gem.cooldown ?? 0) * levelCooldownScale;
  const effectiveCooldown = baseCooldown / Math.max(0.25, cooldownRecoveryMultiplier);

  const isAttack = gem.tags.includes('attack');
  const speedFactor = isAttack
    ? Math.max(0.3, attackSpeedMultiplier)
    : Math.max(0.3, castSpeedMultiplier + localCastSpeedInc / 100);
  const baseCast = gem.castTime ?? 0;
  const effectiveCastTime = baseCast > 0 ? baseCast / speedFactor : 0;

  const baseMana = gem.manaCost ?? 0;
  const effectiveManaCost = Math.max(0, baseMana * Math.max(0.1, manaCostMultiplier + localManaCostInc / 100) * hollowManaMult);

  return {
    id: `skill_${gem.id}`,
    gemId: gem.id,
    name: gem.name,
    school: gem.school,
    minDamage: baseMin,
    maxDamage: baseMax,
    effectiveMinDamage,
    effectiveMaxDamage,
    effectiveness: dmgDef.effectiveness,
    manaCost: baseMana,
    effectiveManaCost,
    manaReservation: gem.manaReservation ?? 0,
    cooldown: baseCooldown,
    effectiveCooldown,
    castTime: baseCast,
    effectiveCastTime,
    damageMoreMultiplier,
    areaDamageMore,
    executeDamageMore,
    extraProjectiles,
    doubleHitBonus,
    lifeLeechBonus,
    ailmentPotencyBonus,
    convertPhysicalFire,
    hasProliferation,
    triggerType,
    linkedSupportIds: linkedSupports.map((s) => s.gem.id),
    linkedSupportNames: linkedSupports.map((s) => s.gem.name),
    snakeRank: entry.snakeRank,
    sourceSlot: entry.slot,
    sourceSocketIndex: entry.socketIndex,
    tags: gem.tags,
    ailment: gem.ailment
      ? { ...gem.ailment, dps: gem.ailment.dps * scale }
      : undefined,
    level: instance.level,
    bar: instance.bar,
  };
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

  const { actives, globalMods, linkedSupports, reservedPct } = collectSocketedEntries(save);
  mods.push(...globalMods);

  const stats = aggregateStats(mods, baseStats(save.level));
  const conversionsApplied: AppliedConversion[] = [];

  // Pass 1: attribute and defence conversions (forward-only DAG).
  const passOne = statRegistry.conversions.filter((c) => c.pass === 1 && c.percent > 0);
  for (const conv of passOne) {
    const amount = (stats[conv.from] ?? 0) * (conv.percent / 100);
    stats[conv.from] = (stats[conv.from] ?? 0) - amount;
    stats[conv.to] = (stats[conv.to] ?? 0) + amount;
    conversionsApplied.push({ pass: 1, from: conv.from, to: conv.to, percent: conv.percent, amount });
  }

  // Pass 2: damage school conversions (forward-only DAG).
  const passTwo = statRegistry.conversions.filter((c) => c.pass === 2 && c.percent > 0);
  for (const conv of passTwo) {
    const amount = (stats[conv.from] ?? 0) * (conv.percent / 100);
    stats[conv.from] = (stats[conv.from] ?? 0) - amount;
    stats[conv.to] = (stats[conv.to] ?? 0) + amount;
    conversionsApplied.push({ pass: 2, from: conv.from, to: conv.to, percent: conv.percent, amount });
  }

  // Support-driven physical -> fire conversion (Pass 2 forward shift).
  const supportShift = Math.min(100, Math.max(0, stats.convert_physical_fire ?? 0));
  if (supportShift > 0) {
    const amount = (stats.dmg_physical ?? 0) * (supportShift / 100);
    stats.dmg_physical = (stats.dmg_physical ?? 0) - amount;
    stats.dmg_fire = (stats.dmg_fire ?? 0) + amount;
    if (amount !== 0) {
      conversionsApplied.push({ pass: 2, from: 'dmg_physical', to: 'dmg_fire', percent: supportShift, amount });
    }
  }

  // Keystone Void Tithe: 50% Physical -> Void
  if (keystones.has('ks_void_tithe')) {
    const voidAmt = (stats.dmg_physical ?? 0) * 0.5;
    stats.dmg_physical = (stats.dmg_physical ?? 0) - voidAmt;
    stats.dmg_void = (stats.dmg_void ?? 0) + voidAmt;
    conversionsApplied.push({ pass: 2, from: 'dmg_physical', to: 'dmg_void', percent: 50, amount: voidAmt });
  }

  // Resolve all 4 vectors of the 4 Core Attributes AFTER Pass 1 conversions
  // and BEFORE Ghostframe (0.6x Max HP) and Lattice Skin (Armor -> Max Ward).
  const might = stats.might ?? 0;
  const agility = stats.agility ?? 0;
  const wisdom = stats.wisdom ?? 0;
  const fortitude = stats.fortitude ?? 0;

  // Might vectors: Weapon Damage (+1.5%/pt), Melee/Physical Power (+1.0%/pt), Crit Multi (+0.5%/pt), Armor Break (+1.5/pt)
  stats.armor_break = Math.min(85, (stats.armor_break ?? 0) + might * 1.5);

  // Agility vectors: Attack Speed (+0.8%/pt), Double-Hit (agility/(agility+250)), DoT Tick Speed (+0.7%/pt), Dodge Rating (+2.5/pt)
  stats.attack_speed = (stats.attack_speed ?? 0) + agility * 0.8;
  stats.dot_speed = (stats.dot_speed ?? 0) + agility * 0.7;
  stats.dodge_rating = (stats.dodge_rating ?? 0) + agility * 2.5;

  // Wisdom vectors: Cast Speed (+0.8%/pt), Max Mana (+3/pt) & Regen (+0.25/s/pt), Max Ward (+4/pt) + shorter delay, Ailment Potency (+0.85%/pt)
  stats.cast_speed = (stats.cast_speed ?? 0) + wisdom * 0.8;
  stats.max_mana = (stats.max_mana ?? 0) + wisdom * 3;
  stats.mana_regen = (stats.mana_regen ?? 0) + wisdom * 0.25;
  stats.max_ward = (stats.max_ward ?? 0) + wisdom * 4;
  stats.ailment_potency = (stats.ailment_potency ?? 0) + wisdom * 0.85;

  // Fortitude vectors: Max HP (+6/pt), HP Regen (+0.3/s/pt), Armor (+3/pt), Thorns (+1.5/pt)
  stats.max_hp = (stats.max_hp ?? 0) + fortitude * 6;
  stats.hp_regen = (stats.hp_regen ?? 0) + fortitude * 0.3;
  stats.armor = (stats.armor ?? 0) + fortitude * 3;
  stats.thorns = (stats.thorns ?? 0) + fortitude * 1.5;

  // Keystone defense modifiers
  if (keystones.has('ks_ghostframe')) stats.max_hp = (stats.max_hp ?? 0) * 0.6;

  let armor = stats.armor ?? 0;
  if (keystones.has('ks_lattice_skin')) {
    stats.max_ward = (stats.max_ward ?? 0) + armor * 0.6;
    armor = 0;
    stats.armor = 0;
  }

  const dodgeCap = keystones.has('ks_ghostframe') ? 150 : 75;
  const wardDelay = keystones.has('ks_lattice_skin') ? 2.0 : Math.max(0.8, 2.0 - wisdom * 0.015);
  const attackSpeedMultiplier = Math.max(0.3, 1 + (stats.attack_speed ?? 0) / 100);
  const castSpeedMultiplier = Math.max(0.3, 1 + (stats.cast_speed ?? 0) / 100);
  const manaCostMultiplier = Math.max(0.1, 1 + (stats.mana_cost ?? 0) / 100);
  const cooldownRecoveryMultiplier = Math.max(0.25, 1 + (stats.cooldown_recovery ?? 0) / 100);

  const hollowFist = keystones.has('ks_hollow_fist');
  const skills: CombatSkill[] = [];
  for (const entry of actives) {
    const skill = buildCombatSkill(
      entry,
      stats,
      manaCostMultiplier,
      castSpeedMultiplier,
      attackSpeedMultiplier,
      cooldownRecoveryMultiplier,
      hollowFist,
    );
    if (skill) skills.push(skill);
  }

  const skillLimit = Math.max(1, Math.floor(save.skillSlots ?? 6));
  const activeSkills = skills.slice(0, skillLimit);

  const triggerSupports = linkedSupports.map((s) => s.id);
  const triggerType: TriggerType = triggerSupports.includes('support_cast_on_crit')
    ? 'crit'
    : triggerSupports.includes('support_cast_when_damage_taken')
      ? 'damage'
      : null;

  const doctrineMultiplier = keystones.has('ks_zealots_mandate') ? 2 : 1;
  const totalMaxMana = Math.max(0, stats.max_mana ?? 0);
  const clampedReservedPct = Math.min(95, Math.max(0, reservedPct));
  const reservedMana = totalMaxMana * (clampedReservedPct / 100);
  const usableMaxMana = Math.max(0, totalMaxMana - reservedMana);

  const weapon = equippedWeapon(save);

  return {
    values: stats,
    keystones,
    weapon: weapon.profile,
    weaponBase: weapon.base,
    weaponName: weapon.base.name,
    skills: activeSkills,
    supports: linkedSupports,
    triggerType,
    critChance: Math.min(0.95, Math.max(0, (stats.crit_chance ?? 0) / 100)),
    critMultiplier: 1.5 + (stats.crit_multi ?? 0) / 100 + might / 200,
    doubleHitChance: Math.min(0.75, Math.max(0, agility / (agility + 250) + (stats.double_hit ?? 0) / 100)),
    dodgeCap,
    dodgePerHit: Math.min(dodgeCap, (stats.dodge_rating ?? 0) * 0.25),
    armor,
    armorBreak: Math.min(0.85, Math.max(0, (stats.armor_break ?? 0) / 100)),
    thorns: Math.max(0, stats.thorns ?? 0),
    wardDelay,
    dotSpeedMultiplier: Math.max(1, 1 + (stats.dot_speed ?? 0) / 100),
    cooldownRecoveryMultiplier,
    resist: {
      physical: stats.res_physical ?? 0,
      fire: stats.res_fire ?? 0,
      frost: stats.res_frost ?? 0,
      lightning: stats.res_lightning ?? 0,
      void: stats.res_void ?? 0,
    },
    maxHp: Math.max(1, stats.max_hp ?? 1),
    totalMaxMana,
    reservedMana,
    reservedManaPct: clampedReservedPct,
    maxMana: usableMaxMana,
    maxWard: Math.max(0, stats.max_ward ?? 0),
    hpRegen: stats.hp_regen ?? 0,
    manaRegen: stats.mana_regen ?? 0,
    attackSpeedMultiplier,
    castSpeedMultiplier,
    manaCostMultiplier,
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
    conversionsApplied,
    trinketId: save.equipment.trinket?.baseId,
    gearscore: characterGearscore(save.equipment),
    doctrine: save.doctrine,
    doctrineMultiplier,
  };
}

export function itemModSummary(item: ItemInstance): StatMod[] {
  return itemMods(item);
}

export const ALL_SCHOOLS = SCHOOLS;
