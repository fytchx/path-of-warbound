import { doctrineById, monsterById, skillTree, zoneById } from '../data';
import type { AilmentId, DoctrineId, MonsterDef, School, ZoneDef } from '../data/types';
import type { CombatSkill, PlayerStats } from './stats';
import { mulberry32, chance, pickOne, rollBetween } from './rng';

export const TICK_SECONDS = 0.1;

export interface AilmentInstance {
  dps: number;
  remaining: number;
  duration?: number;
  stacks: number;
  severity?: number;
}

export interface CombatEnemy {
  uid: string;
  defId: string;
  name: string;
  hp: number;
  maxHp: number;
  damage: number;
  armor: number;
  attackSpeed: number;
  attackInterval: number;
  school: School;
  elite: boolean;
  level: number;
  attackTimer: number;
  dazed: number;
  exposureRemaining?: number;
  ailments: Partial<Record<AilmentId, AilmentInstance>>;
  slamTimer?: number;
  slamTelegraph?: number;
  slamWarned?: boolean;
}

export interface Buff {
  id: string;
  name: string;
  remaining: number;
  duration: number;
  attackSpeed?: number;
  castSpeed?: number;
  damageMore?: number;
}

export interface CombatEvent {
  t: number;
  kind: 'hit' | 'crit' | 'ailment' | 'kill' | 'ward' | 'guard' | 'key' | 'death' | 'wave' | 'boss' | 'trigger' | 'cast';
  text: string;
}

export interface CombatHitEvent {
  id: number;
  enemyUid: string;
  amount: number;
  school: School;
  crit: boolean;
}

export type DamageSource = 'auto' | 'skill' | 'ailment' | 'thorns';

export interface DamageSample {
  t: number;
  amount: number;
  school: School;
  source: DamageSource;
}

export interface CombatRewards {
  gold: number;
  xp: number;
  kills: number;
  eliteKills: number;
  bossKills: number;
  deaths: number;
  keys: number;
  damage: number;
}

export interface CombatState {
  tickCount: number;
  time: number;
  zone: ZoneDef;
  tier: number;
  packSize: number;
  doctrine: DoctrineId;
  playerStats: PlayerStats;
  player: {
    hp: number;
    ward: number;
    mana: number;
    dodgeCharge: number;
    attackTimer: number;
    attackInterval: number;
    castLock: number;
    cast: { skillId: string; remaining: number; duration: number; power: number } | null;
    disciplineStacks: number;
    skillTimers: Record<string, number>;
    buffs: Buff[];
    lastDamageAt: number;
    deaths: number;
    hitCounter: number;
    guardActive: number;
    leechThisSecond: number;
    leechWindowTimer: number;
  };
  enemies: CombatEnemy[];
  bossActive: boolean;
  bossDefeated: boolean;
  wave: number;
  keys: number;
  keysUnlocked: boolean;
  rotationMode: 'auto' | 'manual';
  rotationOrder: string[];
  allowedMonsterIds?: string[];
  status: 'running' | 'dead' | 'victory';
  deathTimer: number;
  activeBar: 'bar_1' | 'bar_2';
  swapTimer: number;
  rng: () => number;
  log: CombatEvent[];
  damageLog: DamageSample[];
  hitSeq: number;
  recentHits: CombatHitEvent[];
  rewards: CombatRewards;
  totalDamage: number;
}

export interface CreateCombatOptions {
  seed: number;
  zoneId: string;
  tier: number;
  packSize: number;
  doctrine: DoctrineId;
  activeBar: 'bar_1' | 'bar_2';
  startingKeys?: number;
  keysUnlocked?: boolean;
  allowedMonsterIds?: string[];
  rotation?: { mode: 'auto' | 'manual'; order: string[] };
  playerStats: PlayerStats;
}

const AILMENTS: AilmentId[] = ['bleed', 'ignite', 'chill', 'shock', 'corruption'];

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function clampTier(tier: number): number {
  return Math.max(1, Math.min(10, Math.floor(tier) || 1));
}

function spawnEnemy(state: CombatState, def: MonsterDef): CombatEnemy {
  const hpScale = state.tier === 1 ? 1 : 2.5 * Math.pow(1.35, state.tier - 2);
  const dmgScale = state.tier === 1 ? 1 : 2.25 * Math.pow(1.22, state.tier - 2);
  const armorScale = 1 + (state.tier - 1) * 0.25;
  const eliteScale = def.elite ? 1 + (state.tier - 1) * 0.08 : 1;
  const hp = Math.round(def.hp * hpScale * eliteScale);
  const isBoss = def.id === 'mob_boss';
  const attackInterval = 1 / Math.max(0.2, def.attackSpeed);
  return {
    uid: `e${state.tickCount}_${Math.floor(state.rng() * 1e6)}`,
    defId: def.id,
    name: def.name,
    hp,
    maxHp: hp,
    damage: def.damage * dmgScale,
    armor: def.armor * armorScale,
    attackSpeed: def.attackSpeed,
    attackInterval,
    school: def.school,
    elite: def.elite,
    level: state.tier + 1,
    attackTimer: Math.min(attackInterval, 0.4 + state.rng() * 0.8),
    dazed: 0,
    exposureRemaining: 0,
    ailments: {},
    ...(isBoss ? { slamTimer: 4.5, slamTelegraph: 0, slamWarned: false } : {}),
  };
}

function rollElite(state: CombatState, baseChance: number): boolean {
  const doubled = state.playerStats.keystones.has('ks_crowd_sovereign') ? 2 : 1;
  return chance(state.rng, Math.min(0.9, baseChance * doubled));
}

function spawnPack(state: CombatState): void {
  const forced = state.playerStats.keystones.has('ks_crowd_sovereign') ? Math.max(4, state.packSize) : state.packSize;
  const count = Math.max(1, Math.min(5, forced));
  const zonePool = state.zone.monsterIds.map((id) => monsterById.get(id)).filter((m): m is MonsterDef => Boolean(m));
  const allowed = state.allowedMonsterIds?.length
    ? zonePool.filter((m) => state.allowedMonsterIds!.includes(m.id))
    : zonePool;
  const pool = allowed.length ? allowed : zonePool;
  const normals = pool.filter((m) => !m.elite);
  const elites = pool.filter((m) => m.elite);
  state.enemies = [];
  for (let i = 0; i < count; i += 1) {
    const wantsElite = elites.length > 0 && rollElite(state, state.zone.eliteChance);
    const def = wantsElite ? pickOne(state.rng, elites) : pickOne(state.rng, normals.length ? normals : pool);
    state.enemies.push(spawnEnemy(state, def));
  }
  state.wave += 1;
  pushLog(state, 'wave', `Wave ${state.wave} — ${count} ${count === 1 ? 'enemy' : 'enemies'}${state.bossActive ? ' and the Bound One' : ''}`);
}

function spawnBoss(state: CombatState): void {
  const def = monsterById.get('mob_boss');
  if (!def) return;
  const boss = spawnEnemy(state, def);
  boss.name = `${state.zone.name} Boss`;
  state.enemies = [boss, ...state.enemies.filter((e) => e.hp > 0)];
  state.bossActive = true;
  pushLog(state, 'boss', `${boss.name} rises. Kill it to claim the tier.`);
}

export function summonBoss(state: CombatState): boolean {
  if (state.bossActive || state.keys < 3 || state.status !== 'running') return false;
  state.keys -= 3;
  spawnBoss(state);
  return true;
}

function computeAttackInterval(state: CombatState): number {
  const stats = state.playerStats;
  const haste = 1 + state.player.buffs.reduce((sum, b) => sum + (b.attackSpeed ?? 0), 0);
  return 1 / Math.max(0.1, stats.weapon.attacksPerSecond * stats.attackSpeedMultiplier * haste);
}

export function createCombat(options: CreateCombatOptions): CombatState {
  const zone = zoneById.get(options.zoneId) ?? zoneById.values().next().value;
  if (!zone) throw new Error('No zones registered');
  const doctrine = doctrineById.get(options.doctrine)?.id ?? 'tactician';
  const baseInterval = 1 / Math.max(0.1, options.playerStats.weapon.attacksPerSecond * options.playerStats.attackSpeedMultiplier);
  const state: CombatState = {
    tickCount: 0,
    time: 0,
    zone,
    tier: clampTier(options.tier),
    packSize: Math.max(1, Math.min(5, Math.round(options.packSize))),
    doctrine,
    playerStats: options.playerStats,
    player: {
      hp: options.playerStats.maxHp,
      ward: options.playerStats.maxWard,
      mana: options.playerStats.maxMana,
      dodgeCharge: 0,
      attackTimer: 0.2,
      attackInterval: baseInterval,
      castLock: 0,
      cast: null,
      disciplineStacks: 0,
      skillTimers: {},
      buffs: [],
      lastDamageAt: -10,
      deaths: 0,
      hitCounter: 0,
      guardActive: 0,
      leechThisSecond: 0,
      leechWindowTimer: 1,
    },
    enemies: [],
    bossActive: false,
    bossDefeated: false,
    wave: 0,
    keys: options.startingKeys ?? 0,
    keysUnlocked: options.keysUnlocked ?? true,
    rotationMode: options.rotation?.mode === 'manual' ? 'manual' : 'auto',
    rotationOrder: [...(options.rotation?.order ?? [])],
    allowedMonsterIds: options.allowedMonsterIds,
    status: 'running',
    deathTimer: 0,
    activeBar: options.activeBar,
    swapTimer: 5,
    rng: mulberry32(options.seed),
    log: [],
    damageLog: [],
    hitSeq: 0,
    recentHits: [],
    rewards: { gold: 0, xp: 0, kills: 0, eliteKills: 0, bossKills: 0, deaths: 0, keys: 0, damage: 0 },
    totalDamage: 0,
  };
  spawnPack(state);
  return state;
}

function pushLog(state: CombatState, kind: CombatEvent['kind'], text: string): void {
  state.log.unshift({ t: Math.round(state.time * 10) / 10, kind, text });
  if (state.log.length > 60) state.log.length = 60;
}

function armorReduction(armor: number, enemyLevel: number): number {
  if (armor <= 0) return 0;
  return Math.min(0.8, armor / (armor + 45 * Math.max(1, enemyLevel)));
}

function shockBonus(enemy: CombatEnemy): number {
  const shock = enemy.ailments.shock;
  if (!shock) return 1;
  return 1 + clamp(shock.severity ?? 0.1 * shock.stacks, 0.1, 0.4);
}

function hitResists(state: CombatState, school: School, raw: number): number {
  const resist = state.playerStats.resist[school] ?? 0;
  return raw * (1 - 0.8 * Math.min(0.75, Math.max(0, resist) / 100));
}

function dominantSchool(state: CombatState): School {
  const order: School[] = ['void', 'lightning', 'frost', 'fire', 'physical'];
  let best: School = 'physical';
  let bestValue = Number.NEGATIVE_INFINITY;
  for (const school of order) {
    const value = state.playerStats.schoolIncreased[school] ?? 0;
    if (value > bestValue) {
      best = school;
      bestValue = value;
    }
  }
  return best;
}

function applyLifeLeech(state: CombatState, dealt: number, skill?: CombatSkill): void {
  if (dealt <= 0) return;
  const stats = state.playerStats;
  const player = state.player;
  const leechRate = stats.lifeLeech + (skill?.lifeLeechBonus ?? 0);
  if (leechRate <= 0) return;
  const maxPerSec = stats.maxHp * 0.06;
  const room = Math.max(0, maxPerSec - player.leechThisSecond);
  if (room <= 0) return;
  const heal = Math.min(room, dealt * leechRate);
  if (heal > 0) {
    player.leechThisSecond += heal;
    player.hp = Math.min(stats.maxHp, player.hp + heal);
  }
}

/** Applies a hit after shock, execute, crowd, armor break, and chill shatter rules. Returns actual damage. */
function damageEnemy(
  state: CombatState,
  enemy: CombatEnemy,
  raw: number,
  school: School,
  crit: boolean,
  source: DamageSource,
  skill?: CombatSkill,
): number {
  if (enemy.hp <= 0 || raw <= 0) return 0;
  let amount = raw * shockBonus(enemy);
  const stats = state.playerStats;

  if (stats.keystones.has('ks_crowd_sovereign')) {
    amount *= 1 + 0.25 * Math.min(5, state.enemies.filter((e) => e.hp > 0).length);
  }
  if (enemy.hp / enemy.maxHp < 0.35 && source !== 'ailment') {
    amount *= stats.executeDamageMore * (skill?.executeDamageMore ?? 1);
  }
  if (school === 'physical') {
    const effectiveArmor = enemy.armor * (1 - stats.armorBreak);
    amount *= 1 - armorReduction(effectiveArmor, enemy.level);
  }
  if (enemy.ailments.chill && enemy.ailments.chill.stacks >= 3 && crit) {
    amount *= 2;
  }

  const dealt = Math.max(0, Math.round(amount * 10) / 10);
  enemy.hp = Math.max(0, enemy.hp - dealt);
  state.totalDamage += dealt;
  state.rewards.damage += dealt;
  state.damageLog.push({ t: state.time, amount: dealt, school, source });
  if (state.damageLog.length > 200) state.damageLog.shift();

  if (source === 'auto' || source === 'skill') {
    applyLifeLeech(state, dealt, skill);
  }

  if (dealt >= 1) {
    state.hitSeq += 1;
    state.recentHits.push({ id: state.hitSeq, enemyUid: enemy.uid, amount: dealt, school, crit });
    if (state.recentHits.length > 16) state.recentHits.shift();
    pushLog(
      state,
      crit ? 'crit' : 'hit',
      `${crit ? 'CRIT ' : ''}${dealt.toFixed(0)} ${school} → ${enemy.name} (${enemy.hp.toFixed(0)} hp)`,
    );
  }
  return dealt;
}

function applyAilment(
  state: CombatState,
  enemy: CombatEnemy,
  ailmentId: AilmentId,
  baseDps: number,
  duration: number,
  chanceToApply: number,
  hitDamage = 0,
  skill?: CombatSkill,
): void {
  if (!chance(state.rng, chanceToApply)) return;
  const stats = state.playerStats;
  const wisdom = stats.values.wisdom ?? 0;
  const agility = stats.values.agility ?? 0;

  // Anti-Double-Dipping Ailment DoT Formula (Section 3.4)
  const scaling =
    (1 + wisdom / 120) *
    (1 + agility / 150) *
    stats.ailmentPotency *
    (1 + (skill?.ailmentPotencyBonus ?? 0)) *
    (ailmentId === 'corruption' && stats.keystones.has('ks_void_tithe') ? 1.5 : 1);

  const existing = enemy.ailments[ailmentId];
  const festering = stats.keystones.has('ks_festering_wound');

  // Weaver rule: never overwrite an ailment with >15% duration remaining unless stacking.
  if (
    state.doctrine === 'weaver' &&
    existing &&
    !festering &&
    ailmentId !== 'bleed' &&
    ailmentId !== 'chill' &&
    existing.remaining > (existing.duration ?? duration) * 0.15
  ) {
    return;
  }

  const maxStacks = festering ? 3 : ailmentId === 'bleed' || ailmentId === 'chill' ? 3 : 1;
  const durationScale = festering ? 0.7 : 1;
  const stackMultiplier = festering ? 0.4 : 1;
  const finalDuration = duration * durationScale;
  const severity =
    ailmentId === 'shock'
      ? clamp(0.1 + (hitDamage / Math.max(1, enemy.maxHp)) * 0.5 * (1 + wisdom / 120) * stats.ailmentPotency, 0.1, 0.4)
      : undefined;

  if (existing) {
    existing.stacks = Math.min(maxStacks, existing.stacks + 1);
    existing.remaining = Math.max(existing.remaining, finalDuration);
    existing.duration = finalDuration;
    existing.dps = Math.max(existing.dps, baseDps * scaling * stackMultiplier);
    if (severity !== undefined) {
      existing.severity = Math.max(existing.severity ?? 0.1, severity);
    }
  } else {
    enemy.ailments[ailmentId] = {
      dps: baseDps * scaling * stackMultiplier,
      remaining: finalDuration,
      duration: finalDuration,
      stacks: 1,
      severity,
    };
  }
  pushLog(state, 'ailment', `${ailmentId} applied to ${enemy.name}${existing ? ' (stack)' : ''}`);

  // Ailment Proliferation: spread to 1 nearby living enemy at 50% remaining duration.
  if (skill?.hasProliferation) {
    const neighbor = state.enemies.find((other) => other !== enemy && other.hp > 0);
    if (neighbor) {
      const spreadDur = Math.max(0.5, finalDuration * 0.5);
      const prevNeighbor = neighbor.ailments[ailmentId];
      if (!prevNeighbor || prevNeighbor.remaining < spreadDur) {
        neighbor.ailments[ailmentId] = {
          dps: baseDps * scaling * stackMultiplier,
          remaining: spreadDur,
          duration: spreadDur,
          stacks: 1,
          severity,
        };
      }
    }
  }
}

function dazeEnemy(_state: CombatState, enemy: CombatEnemy, seconds: number): void {
  enemy.dazed = Math.max(enemy.dazed, seconds);
}

function autoDamageParts(state: CombatState, base: number): { school: School; amount: number }[] {
  const stats = state.playerStats;
  let physical = base;
  const parts: { school: School; amount: number }[] = [];

  if (stats.keystones.has('ks_void_tithe')) {
    const moved = physical * 0.5;
    physical -= moved;
    parts.push({ school: 'void', amount: moved });
  }
  if (physical > 0) parts.push({ school: 'physical', amount: physical });
  return parts;
}

function skillDamageParts(state: CombatState, skill: CombatSkill, amount: number): { school: School; amount: number }[] {
  const stats = state.playerStats;
  if (skill.school !== 'physical') {
    return [{ school: skill.school, amount }];
  }
  let physical = amount;
  const parts: { school: School; amount: number }[] = [];
  const fireShift = Math.min(100, Math.max(0, skill.convertPhysicalFire));
  if (fireShift > 0) {
    const moved = physical * (fireShift / 100);
    physical -= moved;
    parts.push({ school: 'fire', amount: moved });
  }
  if (stats.keystones.has('ks_void_tithe')) {
    const moved = physical * 0.5;
    physical -= moved;
    parts.push({ school: 'void', amount: moved });
  }
  if (physical > 0) parts.push({ school: 'physical', amount: physical });
  return parts;
}

function fireTriggers(state: CombatState, type: 'crit' | 'damage'): void {
  const player = state.player;
  const stats = state.playerStats;
  const triggers = stats.skills
    .filter((s) => s.triggerType === type)
    .sort((a, b) => a.snakeRank - b.snakeRank);

  for (const skill of triggers) {
    const isEntropy = state.doctrine === 'entropy';
    const entropyProc = isEntropy && chance(state.rng, 0.2 * stats.doctrineMultiplier);
    const ready = (player.skillTimers[skill.id] ?? 0) <= 0;
    if (!ready && !entropyProc) continue;

    if (type === 'crit' && skill.tags.includes('guard')) continue;
    const baseCooldown = Math.max(1, skill.effectiveCooldown || 1);
    player.skillTimers[skill.id] = entropyProc ? 0.2 : baseCooldown * (type === 'damage' ? 0.5 : 1);

    const power = entropyProc ? rollBetween(state.rng, 0.7, 1.6) : type === 'crit' ? 0.75 : 1;
    castSkill(state, skill, power, true);
    if (entropyProc) {
      castSkill(state, skill, rollBetween(state.rng, 0.7, 1.6), true);
      pushLog(state, 'trigger', `Entropy double-fires ${skill.name}!`);
    }
  }
}

function playerAutoAttack(state: CombatState): void {
  const targets = state.enemies.filter((e) => e.hp > 0);
  if (!targets.length) return;
  const stats = state.playerStats;
  const player = state.player;
  const target = targets.reduce((lowest, enemy) => (enemy.hp < lowest.hp ? enemy : lowest), targets[0]!);

  // Baseline Mana: +4 Mana per Weapon Auto-Attack hit (Section 2).
  player.mana = Math.min(stats.maxMana, player.mana + 4);

  const might = stats.values.might ?? 0;
  const weapon = stats.weapon;
  const hollow = stats.keystones.has('ks_hollow_fist');
  const implicitScale = hollow ? 2 : 1;
  const buffs = player.buffs.reduce((sum, b) => sum + (b.damageMore ?? 0), 0);
  let raw = rollBetween(state.rng, weapon.minDamage + (stats.values.weapon_min ?? 0), weapon.maxDamage + (stats.values.weapon_max ?? 0));
  raw *= 1 + might / 100;
  raw *= 1 + (stats.schoolIncreased.physical ?? 0) + (stats.values.dmg_increased ?? 0) / 100;
  raw *= 1 + buffs;
  if (hollow) raw *= 1.4;

  const axeBonus = weapon.archetype === 'axe' && target.ailments.bleed ? 1 + 0.25 * implicitScale : 1;

  player.hitCounter += 1;
  const isCrit = chance(state.rng, stats.critChance);
  let totalRaw = raw * axeBonus;
  if (isCrit) totalRaw *= stats.critMultiplier;

  for (const part of autoDamageParts(state, totalRaw)) {
    damageEnemy(state, target, part.amount, part.school, isCrit, 'auto');
  }
  if (isCrit) state.damageLog.push({ t: state.time, amount: 0, school: dominantSchool(state), source: 'auto' });

  // Double hit echoes at 70% damage and triggers on-hit effects.
  if (chance(state.rng, stats.doubleHitChance)) {
    for (const part of autoDamageParts(state, totalRaw * 0.7)) {
      damageEnemy(state, target, part.amount, part.school, false, 'auto');
    }
    applyWeaponOnHit(state, target, weapon.archetype, isCrit, implicitScale);
  } else {
    applyWeaponOnHit(state, target, weapon.archetype, isCrit, implicitScale);
  }

  if (weapon.archetype === 'sword' && player.hitCounter % 3 === 0) {
    player.buffs.push({ id: 'sword_haste', name: 'Sword Haste', remaining: 3, duration: 3, attackSpeed: 0.1 * implicitScale });
  }

  if (weapon.archetype === 'staff') {
    for (const ailment of Object.values(target.ailments)) {
      if (ailment) ailment.remaining += 1;
    }
    player.ward = Math.min(stats.maxWard, player.ward + stats.maxWard * 0.02 * implicitScale);
  }

  if (weapon.archetype === 'bow' && isCrit) {
    player.mana = Math.min(stats.maxMana, player.mana + stats.maxMana * 0.03 * implicitScale);
  }

  if (isCrit) {
    fireTriggers(state, 'crit');
  }
}

function applyWeaponOnHit(state: CombatState, target: CombatEnemy, archetype: string, isCrit: boolean, scale: number): void {
  const stats = state.playerStats;
  const dot = stats.weapon.dotOnHit;
  if (dot && chance(state.rng, Math.min(1, dot.chance * scale))) {
    applyAilment(state, target, dot.ailment as AilmentId, dot.dps * scale, dot.duration, 1);
  }
  if (archetype === 'mace' && chance(state.rng, Math.min(1, 0.3 * scale))) {
    dazeEnemy(state, target, 3);
    pushLog(state, 'hit', `${target.name} is dazed.`);
  }
  if (archetype === 'axe' && isCrit) {
    applyAilment(state, target, 'bleed', 5 * scale, 4, 1);
  }
  if (archetype === 'sword' && stats.keystones.has('ks_void_tithe')) {
    target.ailments.corruption ??= { dps: 2 * scale, remaining: 3, duration: 3, stacks: 1 };
  }
}

function isSkillBarValid(state: CombatState, skill: CombatSkill): boolean {
  const hasPendulum = state.player.buffs.some((b) => b.id === 'pendulum');
  const hourglassActive =
    state.playerStats.trinketId === 'base_trinket_hourglass' && Math.floor(state.time) % 5 === 0;
  return skill.bar === 'both' || skill.bar === state.activeBar || hasPendulum || hourglassActive;
}

function effectiveSkillRecovery(state: CombatState, skill: CombatSkill): number {
  const stats = state.playerStats;
  let cdr = 1;
  if (state.doctrine === 'bastion' && skill.tags.includes('guard')) {
    cdr += 0.25 * stats.doctrineMultiplier;
  }
  if (stats.trinketId === 'base_trinket_waning' && state.player.hp / stats.maxHp < 0.35) {
    cdr += 0.1;
  }
  return skill.effectiveCooldown / cdr;
}

function castSkill(state: CombatState, skill: CombatSkill, power: number, triggered = false): void {
  const stats = state.playerStats;
  const player = state.player;
  const living = state.enemies.filter((e) => e.hp > 0);
  if (!living.length) return;

  if (!triggered) {
    if (player.mana < skill.effectiveManaCost) return;
    player.mana -= skill.effectiveManaCost;
    if (skill.effectiveCastTime > 0) {
      const hasteBuff = 1 + player.buffs.reduce((sum, b) => sum + (b.castSpeed ?? b.attackSpeed ?? 0), 0);
      const duration = Math.max(0.3, skill.effectiveCastTime) / Math.max(0.4, hasteBuff);
      player.castLock = duration;
      if (!skill.tags.includes('guard')) {
        player.cast = { skillId: skill.id, remaining: duration, duration, power };
        pushLog(state, 'cast', `${skill.name} begins casting (${duration.toFixed(1)}s)`);
        player.skillTimers[skill.id] = effectiveSkillRecovery(state, skill);
        return;
      }
    }
    player.skillTimers[skill.id] = effectiveSkillRecovery(state, skill);
    if (skill.effectiveCooldown > 0) {
      pushLog(state, 'guard', `${skill.name} cast (${player.skillTimers[skill.id]!.toFixed(1)}s CD)`);
    }
  }

  const isGuard = skill.tags.includes('guard');
  if (isGuard) {
    player.ward = Math.min(stats.maxWard, player.ward + stats.maxWard * 0.18);
    player.guardActive = 2;
    pushLog(state, 'ward', `${skill.name} restores ward (${player.ward.toFixed(0)}/${stats.maxWard.toFixed(0)})`);
    return;
  }

  const area = skill.tags.includes('area');
  const totalExtra = stats.extraProjectiles + skill.extraProjectiles;
  const targets = area ? living : living.slice(0, 1 + totalExtra);
  const might = stats.values.might ?? 0;
  const buffs = 1 + player.buffs.reduce((sum, b) => sum + (b.damageMore ?? 0), 0);
  const schoolBonus = 1 + (stats.schoolIncreased[skill.school] ?? 0) + (stats.values.dmg_increased ?? 0) / 100;
  const hollowPenalty = stats.keystones.has('ks_hollow_fist') ? 0.75 : 1;
  const apFlat = might * 0.25 * skill.effectiveness;
  const rawRoll = rollBetween(state.rng, skill.minDamage, skill.maxDamage);
  const payoff = state.rotationMode === 'manual' ? payoffMultiplier(state) : 1;
  const base =
    (rawRoll * skill.effectiveness * (1 + might / 100) + apFlat) *
    schoolBonus *
    skill.damageMoreMultiplier *
    buffs *
    power *
    payoff;

  const isCurse = skill.tags.includes('curse');

  targets.forEach((target, idx) => {
    const pierceScale = !area && idx > 0 ? 0.6 : 1;
    const crit = chance(state.rng, stats.critChance);
    const amount =
      base *
      pierceScale *
      (area ? stats.areaDamageMore : 1) *
      hollowPenalty *
      (crit ? stats.critMultiplier : 1);

    let dealtTotal = 0;
    for (const part of skillDamageParts(state, skill, amount)) {
      dealtTotal += damageEnemy(state, target, part.amount, part.school, crit, 'skill', skill);
    }
    if (isCurse) {
      target.exposureRemaining = Math.max(target.exposureRemaining ?? 0, 6);
    }
    if (skill.ailment && dealtTotal > 0) {
      applyAilment(
        state,
        target,
        skill.ailment.id,
        skill.ailment.dps,
        skill.ailment.duration,
        skill.ailment.chance,
        dealtTotal,
        skill,
      );
    }
    if (chance(state.rng, stats.doubleHitChance + skill.doubleHitBonus)) {
      let echoTotal = 0;
      for (const part of skillDamageParts(state, skill, amount * 0.7)) {
        echoTotal += damageEnemy(state, target, part.amount, part.school, false, 'skill', skill);
      }
      if (skill.ailment && echoTotal > 0) {
        applyAilment(
          state,
          target,
          skill.ailment.id,
          skill.ailment.dps,
          skill.ailment.duration,
          skill.ailment.chance,
          echoTotal,
          skill,
        );
      }
    }
  });

  if (triggered) pushLog(state, 'trigger', `${skill.name} triggered`);
}

/**
 * Dynamic Utility Score (Section 3.5):
 * S_i = (B_i * U_i * M_econ * M_synergy * W_doctrine) - C_waste
 */
export function scoreSkillUtility(state: CombatState, skill: CombatSkill): number {
  const stats = state.playerStats;
  const player = state.player;
  const living = state.enemies.filter((e) => e.hp > 0);
  const target = living[0];
  if (!target) return Number.NEGATIVE_INFINITY;

  if (player.mana < skill.effectiveManaCost) return Number.NEGATIVE_INFINITY;

  const isGuard = skill.tags.includes('guard');
  const isCurse = skill.tags.includes('curse');
  const isBuff = skill.tags.includes('buff');
  const isNuke = !isGuard && !isCurse && !isBuff && skill.cooldown > 0;

  // 1. Base Role Weight B_i
  const baseWeight = isGuard ? 95 : isCurse ? 85 : isBuff ? 80 : isNuke ? 75 : 55;

  // 2. Urgency U_i [0.05 .. 3.0]
  const doctrine = doctrineById.get(state.doctrine);
  const guardThreshold = (doctrine?.guardThreshold ?? 45) / 100;
  const totalPool = Math.max(1, stats.maxHp + stats.maxWard);
  const ehpRatio = (player.hp + player.ward) / totalPool;
  const hpRatio = player.hp / Math.max(1, stats.maxHp);
  const bossSlamSoon = state.enemies.some((e) => (e.slamTelegraph ?? 0) > 0);

  let urgency = 1.0;
  if (isGuard) {
    if (hpRatio <= guardThreshold || ehpRatio <= guardThreshold || (state.doctrine === 'bastion' && bossSlamSoon)) {
      const deficit = Math.max(0.2, 1 - Math.min(hpRatio, ehpRatio));
      urgency = clamp(1.2 + deficit * 1.8, 1.0, 3.0);
    } else {
      urgency = 0.05;
    }
  } else if (isCurse) {
    const expRem = target.exposureRemaining ?? 0;
    urgency = expRem < 1.5 ? 1.2 : 0.05;
  } else {
    if (skill.tags.includes('area') && living.length > 1) {
      urgency += 0.25 * (living.length - 1);
    }
    if (!skill.tags.includes('area') && state.bossActive) {
      urgency += 0.6;
    }
    if (state.doctrine === 'weaver' && skill.ailment && (target.exposureRemaining ?? 0) <= 0 && stats.skills.some((s) => s.tags.includes('curse'))) {
      urgency *= 0.2;
    }
  }
  urgency = clamp(urgency, 0.05, 3.0);

  // 3. Resource Lookahead M_econ [0.2 .. 1.2]
  let economy = 1.0;
  if (state.doctrine !== 'entropy') {
    const higherComingSoon = stats.skills.find((other) => {
      if (other.id === skill.id || !isSkillBarValid(state, other)) return false;
      const otherWeight = other.tags.includes('guard') ? 95 : other.tags.includes('curse') ? 85 : other.cooldown > 0 ? 75 : 55;
      if (otherWeight <= baseWeight) return false;
      const remCd = player.skillTimers[other.id] ?? 0;
      return remCd > 0 && remCd <= 1.2;
    });
    if (higherComingSoon && player.mana - skill.effectiveManaCost < higherComingSoon.effectiveManaCost) {
      economy = 0.25;
    } else {
      const manaRatio = stats.maxMana > 0 ? player.mana / stats.maxMana : 1;
      economy = clamp(0.8 + manaRatio * 0.4, 0.2, 1.2);
    }
  }

  // 4. Combo Multiplier M_synergy [1.0 .. 2.0]
  let synergy = 1.0;
  if (!isGuard && !isCurse) {
    const hasSynergyDebuff =
      (target.exposureRemaining ?? 0) > 0 ||
      Boolean(target.ailments.shock) ||
      Boolean(target.ailments.corruption) ||
      (target.ailments.chill?.stacks ?? 0) >= 3;
    if (hasSynergyDebuff) {
      synergy = isNuke ? 1.65 : 1.35;
    }
  }

  // 5. Playstyle Weight W_doctrine [0.0 .. 2.5]
  let doctrineWeight = 1.0;
  if (state.doctrine === 'blitz') {
    doctrineWeight = isGuard ? 0.5 : isBuff ? 1.4 : 1.2;
  } else if (state.doctrine === 'bastion') {
    doctrineWeight = isGuard ? 1.45 : 0.95;
  } else if (state.doctrine === 'weaver') {
    doctrineWeight = isCurse || skill.ailment ? 1.3 : 0.9;
  } else if (state.doctrine === 'entropy') {
    doctrineWeight = 1 + (state.rng() * 0.7 - 0.35);
  }
  doctrineWeight = clamp(doctrineWeight * (stats.doctrineMultiplier > 1 && state.doctrine !== 'entropy' ? 1.25 : 1), 0, 2.5);

  // 6. Overkill / Telegraph Penalty C_waste [0 .. 150]
  let waste = 0;
  if (isNuke && skill.effectiveMinDamage > target.hp * 2) {
    waste += Math.min(80, (skill.effectiveMinDamage / Math.max(1, target.hp)) * 20);
  }
  if (state.doctrine !== 'blitz' && skill.effectiveCastTime > 0 && bossSlamSoon) {
    const soonestSlam = Math.min(...living.map((e) => e.slamTelegraph || 99));
    if (soonestSlam > 0 && soonestSlam < skill.effectiveCastTime) {
      waste += 40;
    }
  }
  waste = clamp(waste, 0, 150);

  return baseWeight * urgency * economy * synergy * doctrineWeight - waste;
}

function payoffMultiplier(state: CombatState): number {
  const target = state.enemies.find((enemy) => enemy.hp > 0);
  if (!target) return 1;
  const distinct = Object.values(target.ailments).filter((ailment) => (ailment?.stacks ?? 0) > 0).length;
  return 1 + Math.min(0.45, 0.15 * distinct);
}

function usableActiveCount(state: CombatState): number {
  return state.playerStats.skills.filter(
    (skill) => skill.manaReservation <= 0 && !skill.triggerType && skill.maxDamage > 0,
  ).length;
}

function advanceDiscipline(state: CombatState, skillId: string): void {
  if (state.rotationMode !== 'manual' || usableActiveCount(state) < 2) {
    state.player.disciplineStacks = 0;
    return;
  }
  const order = state.rotationOrder.filter((id) => state.playerStats.skills.some((skill) => skill.id === id));
  if (order.length < 2) {
    state.player.disciplineStacks = Math.min(4, state.player.disciplineStacks + 1);
    return;
  }
  const expected = order[state.tickCount % order.length];
  state.player.disciplineStacks = skillId === expected ? Math.min(4, state.player.disciplineStacks + 1) : 0;
}

function disciplineMultiplier(state: CombatState): number {
  if (state.rotationMode !== 'manual' || usableActiveCount(state) < 2) return 1;
  return 1 + 0.06 * state.player.disciplineStacks;
}

function playerCastLoop(state: CombatState): void {
  const player = state.player;
  const stats = state.playerStats;

  if (player.cast) return;

  // Tier 2 — Instant Cooldown Automation (castTime <= 0). AUTO only; MANUAL waits for the player.
  if (state.rotationMode === 'auto') {
    for (const skill of stats.skills) {
      if (skill.manaReservation > 0 || skill.triggerType) continue;
      if (skill.castTime > 0) continue;
      if (!isSkillBarValid(state, skill)) continue;
      if ((player.skillTimers[skill.id] ?? 0) > 0) continue;
      if (player.mana < skill.effectiveManaCost) continue;
      if (skill.maxDamage <= 0 && !skill.tags.includes('guard') && !skill.tags.includes('buff')) continue;
      advanceDiscipline(state, skill.id);
      castSkill(state, skill, disciplineMultiplier(state));
    }
  }

  // Tier 4 — Active Cast Loop (S_i Evaluation)
  if (player.castLock > 0) return;

  const candidates = stats.skills.filter((skill) => {
    if (skill.manaReservation > 0 || skill.triggerType) return false;
    if (skill.castTime <= 0) return false;
    const barOk = isSkillBarValid(state, skill);
    const ready = (player.skillTimers[skill.id] ?? 0) <= 0;
    return (
      barOk &&
      ready &&
      player.mana >= skill.effectiveManaCost &&
      (skill.maxDamage > 0 || skill.tags.includes('guard') || skill.tags.includes('curse'))
    );
  });
  if (!candidates.length) return;

  if (state.rotationMode === 'manual') {
    const ranked = [...candidates].sort((a, b) => {
      const ai = state.rotationOrder.indexOf(a.id);
      const bi = state.rotationOrder.indexOf(b.id);
      return (ai < 0 ? 999 : ai) - (bi < 0 ? 999 : bi);
    });
    const next = ranked[0]!;
    advanceDiscipline(state, next.id);
    castSkill(state, next, disciplineMultiplier(state));
    return;
  }

  let best = candidates[0]!;
  let bestScore = scoreSkillUtility(state, best);
  for (const skill of candidates.slice(1)) {
    const score = scoreSkillUtility(state, skill);
    if (score > bestScore) {
      best = skill;
      bestScore = score;
    }
  }
  if (Number.isFinite(bestScore) && bestScore > 0) {
    advanceDiscipline(state, best.id);
    castSkill(state, best, disciplineMultiplier(state));
  }
}

function damagePlayer(state: CombatState, enemy: CombatEnemy, multiplier = 1, attackLabel?: string): void {
  const player = state.player;
  const stats = state.playerStats;
  let incoming = enemy.damage * multiplier;
  if (enemy.dazed > 0) incoming *= 0.8;
  if (stats.keystones.has('ks_crowd_sovereign')) {
    incoming *= 1 + 0.15 * Math.min(5, state.enemies.filter((e) => e.hp > 0).length);
  }

  // Entropy dodge: accumulate per hit, spend 100 to dodge.
  player.dodgeCharge += stats.dodgePerHit;
  if (player.dodgeCharge >= 100) {
    player.dodgeCharge -= 100;
    pushLog(state, 'ward', `Dodged ${enemy.name}${attackLabel ? ` (${attackLabel})` : ''}`);
    if (state.doctrine === 'bastion') {
      player.mana = Math.min(stats.maxMana, player.mana + stats.maxMana * 0.05 * stats.doctrineMultiplier);
    }
    if (stats.keystones.has('ks_ghostframe')) {
      const burst = (stats.values.dodge_rating ?? 0) * 0.15;
      damageEnemy(state, enemy, burst, 'physical', false, 'thorns');
    }
    return;
  }

  incoming *= 1 - armorReduction(stats.armor, enemy.level);
  incoming = hitResists(state, enemy.school, incoming);
  incoming = Math.max(0, Math.round(incoming * 10) / 10);

  const before = incoming;
  const absorbed = Math.min(player.ward, incoming);
  player.ward -= absorbed;
  incoming -= absorbed;
  if (absorbed > 0) {
    pushLog(state, 'ward', `Ward absorbs ${absorbed.toFixed(0)}`);
    if (state.doctrine === 'bastion') {
      player.mana = Math.min(stats.maxMana, player.mana + stats.maxMana * 0.05 * stats.doctrineMultiplier);
    }
  }

  player.hp = Math.max(0, player.hp - incoming);
  player.lastDamageAt = state.time;

  if (incoming > 0) {
    pushLog(
      state,
      attackLabel ? 'boss' : 'hit',
      `${enemy.name}${attackLabel ? ` ${attackLabel}` : ''} hits for ${incoming.toFixed(0)} (${player.hp.toFixed(0)} hp)`,
    );
  }

  if (stats.thorns > 0) damageEnemy(state, enemy, stats.thorns, 'physical', false, 'thorns');

  if (before > stats.maxHp * 0.08) {
    fireTriggers(state, 'damage');
  }

  if (player.hp <= 0) killPlayer(state);
}

function killPlayer(state: CombatState): void {
  const player = state.player;
  player.deaths += 1;
  state.rewards.deaths += 1;
  state.status = 'dead';
  state.deathTimer = 2.5;
  state.bossActive = false;
  if (state.tier <= 1) {
    state.tier = 1;
    pushLog(state, 'death', 'Your vessel shattered. Keys preserved at Tier 1.');
  } else {
    state.tier = Math.max(1, state.tier - 1);
    state.keys = 0;
    pushLog(state, 'death', `The spark gutters. Tier falls to ${state.tier}.`);
  }
}

function tickAilments(state: CombatState): void {
  const stats = state.playerStats;
  for (const enemy of state.enemies) {
    if (enemy.hp <= 0) continue;
    if ((enemy.exposureRemaining ?? 0) > 0) {
      enemy.exposureRemaining = Math.max(0, (enemy.exposureRemaining ?? 0) - TICK_SECONDS);
    }
    const debuffCount = AILMENTS.filter((a) => enemy.ailments[a]).length + ((enemy.exposureRemaining ?? 0) > 0 ? 1 : 0);
    const weaverBonus = state.doctrine === 'weaver' && debuffCount >= 3 ? 1 + 0.2 * stats.doctrineMultiplier : 1;
    const exposureBonus = (enemy.exposureRemaining ?? 0) > 0 ? 1.2 : 1;

    for (const id of AILMENTS) {
      const ailment = enemy.ailments[id];
      if (!ailment) continue;
      ailment.remaining -= TICK_SECONDS;
      if (ailment.remaining <= 0) {
        delete enemy.ailments[id];
        continue;
      }
      const damage = ailment.dps * ailment.stacks * weaverBonus * exposureBonus * TICK_SECONDS;
      if (damage <= 0) continue;
      let dealt = damage;
      if (id !== 'corruption') {
        dealt *= 1 - armorReduction(enemy.armor, enemy.level) * 0.5;
      }
      enemy.hp = Math.max(0, enemy.hp - dealt);
      state.totalDamage += dealt;
      state.rewards.damage += dealt;
      const school: School =
        id === 'ignite' ? 'fire' : id === 'chill' ? 'frost' : id === 'shock' ? 'lightning' : id === 'bleed' ? 'physical' : 'void';
      state.damageLog.push({ t: state.time, amount: dealt, school, source: 'ailment' });
      if (state.damageLog.length > 200) state.damageLog.shift();
    }
    if (enemy.dazed > 0) enemy.dazed = Math.max(0, enemy.dazed - TICK_SECONDS);
  }
}

function resolveDeaths(state: CombatState): void {
  const stats = state.playerStats;
  for (const enemy of [...state.enemies]) {
    if (enemy.hp > 0) continue;
    state.enemies = state.enemies.filter((e) => e !== enemy);
    state.rewards.kills += 1;

    const baseGold = rollBetween(state.rng, 3, 8);
    const tierGoldMult = 1 + (state.tier - 1) * 0.25;
    const goldGain = Math.round(
      baseGold * state.zone.rewardMultiplier * tierGoldMult * (enemy.elite ? 2.5 : 1) * (1 + stats.goldFind),
    );
    state.rewards.gold += goldGain;

    // Pacing curve (Section 2 & 6): Tier 1 normal ~22 XP (250 XP Lv 1->2 = ~11-12 kills), Tier 2 normal ~48 XP.
    const baseXp = state.tier === 1 ? 22 : 48 * Math.pow(1.35, state.tier - 2);
    const xpGain = Math.round(baseXp * state.zone.rewardMultiplier * (enemy.elite ? 2 : 1));
    state.rewards.xp += xpGain;

    if (enemy.elite) {
      state.rewards.eliteKills += 1;
      if (stats.trinketId === 'base_trinket_soulvessel') {
        state.player.hp = Math.min(stats.maxHp, state.player.hp + stats.maxHp * 0.06);
        state.player.ward = Math.min(stats.maxWard, state.player.ward + stats.maxWard * 0.06);
      }
    }

    if (state.doctrine === 'blitz') {
      const blitzBonus = 0.15 * stats.doctrineMultiplier;
      state.player.buffs = state.player.buffs.filter((b) => b.id !== 'blitz_haste');
      state.player.buffs.push({
        id: 'blitz_haste',
        name: 'Blitz Frenzy',
        remaining: 3,
        duration: 3,
        attackSpeed: blitzBonus,
        castSpeed: blitzBonus,
      });
    }

    if (enemy.defId === 'mob_boss') {
      state.bossDefeated = true;
      state.bossActive = false;
      state.rewards.bossKills += 1;
      state.rewards.gold += Math.round(100 * state.zone.rewardMultiplier);
      state.rewards.xp += Math.round(90 * state.zone.rewardMultiplier * Math.pow(1.25, state.tier - 1));
      state.tier = Math.min(10, state.tier + 1);
      state.status = 'victory';
      pushLog(state, 'boss', `${enemy.name} falls. Tier ${state.tier} opens.`);
      continue;
    }

    pushLog(state, 'kill', `${enemy.name} dies (+${goldGain} gold)`);
    if (state.keysUnlocked && chance(state.rng, state.zone.keyDropChance)) {
      state.keys += 1;
      state.rewards.keys += 1;
      pushLog(state, 'key', `Rift Key found (${state.keys}/3)`);
    }
  }

  if (state.status !== 'running') return;
  if (state.enemies.length === 0) spawnPack(state);
}

function tickBuffs(state: CombatState): void {
  const player = state.player;
  for (const buff of player.buffs) buff.remaining -= TICK_SECONDS;
  player.buffs = player.buffs.filter((b) => b.remaining > 0);
  if (player.guardActive > 0) player.guardActive = Math.max(0, player.guardActive - TICK_SECONDS);
}

export function tickCombat(state: CombatState): void {
  if (state.status === 'victory') return;

  if (state.status === 'dead') {
    state.deathTimer -= TICK_SECONDS;
    if (state.deathTimer <= 0) {
      const stats = state.playerStats;
      const safeTierOne = state.tier <= 1;
      state.player.hp = safeTierOne ? stats.maxHp : stats.maxHp * 0.5;
      state.player.ward = safeTierOne ? stats.maxWard : 0;
      state.player.mana = stats.maxMana;
      state.player.buffs = [];
      state.player.dodgeCharge = 0;
      state.player.skillTimers = {};
      state.status = 'running';
      state.bossActive = false;
      state.enemies = [];
      state.wave = 0;
      spawnPack(state);
      pushLog(
        state,
        'wave',
        safeTierOne ? 'The spark rekindles at Tier 1.' : 'The spark rekindles. The tier is one lower.',
      );
    }
    return;
  }

  state.tickCount += 1;
  state.time += TICK_SECONDS;
  const player = state.player;
  const stats = state.playerStats;

  player.leechWindowTimer -= TICK_SECONDS;
  if (player.leechWindowTimer <= 0) {
    player.leechWindowTimer += 1;
    player.leechThisSecond = 0;
  }

  // Ward recharge: 20% max ward per second after Wisdom-reduced delay (fixed 2.0s for Lattice Skin).
  if (state.time - player.lastDamageAt >= stats.wardDelay) {
    const rate = stats.keystones.has('ks_lattice_skin') ? 0.25 : 0.2;
    player.ward = Math.min(stats.maxWard, player.ward + stats.maxWard * rate * TICK_SECONDS);
  }

  player.hp = Math.min(stats.maxHp, player.hp + stats.hpRegen * TICK_SECONDS);
  player.mana = Math.min(stats.maxMana, player.mana + stats.manaRegen * TICK_SECONDS);
  player.castLock = Math.max(0, player.castLock - TICK_SECONDS);
  if (player.cast) {
    player.cast.remaining -= TICK_SECONDS;
    if (player.cast.remaining <= 0) {
      const pending = player.cast;
      player.cast = null;
      player.castLock = 0;
      const skill = stats.skills.find((entry) => entry.id === pending.skillId);
      if (skill) {
        pushLog(state, 'cast', `${skill.name} fires`);
        castSkill(state, skill, pending.power, true);
      }
    }
  }
  for (const key of Object.keys(player.skillTimers)) {
    player.skillTimers[key] = Math.max(0, (player.skillTimers[key] ?? 0) - TICK_SECONDS);
  }

  if (stats.keystones.has('ks_pendulum')) {
    state.swapTimer -= TICK_SECONDS;
    if (state.swapTimer <= 0) {
      state.swapTimer = 5;
      state.activeBar = state.activeBar === 'bar_1' ? 'bar_2' : 'bar_1';
      player.buffs.push({ id: 'pendulum', name: 'Pendulum', remaining: 3, duration: 3, damageMore: 0.3 });
      pushLog(state, 'trigger', `Pendulum swaps to ${state.activeBar === 'bar_1' ? 'Bar I' : 'Bar II'} (+30% damage)`);
    }
  }

  if (stats.keystones.has('ks_void_tithe') && state.tickCount % 50 === 0) {
    const selfDamage = stats.maxHp * 0.03;
    const absorbed = Math.min(player.ward, selfDamage);
    player.ward -= absorbed;
    player.hp = Math.max(1, player.hp - (selfDamage - absorbed));
    pushLog(state, 'ailment', `Void Tithe burns ${(selfDamage - absorbed).toFixed(0)} hp`);
  }

  tickBuffs(state);

  const interval = computeAttackInterval(state);
  player.attackInterval = interval;
  player.attackTimer -= TICK_SECONDS;
  if (player.attackTimer <= 0) {
    player.attackTimer += interval;
    playerAutoAttack(state);
  }

  playerCastLoop(state);

  for (const enemy of state.enemies) {
    if (enemy.hp <= 0) continue;
    const dazeScale = enemy.dazed > 0 ? 0.8 : 1;
    const chill = enemy.ailments.chill;
    const frozen = (chill?.stacks ?? 0) >= 3;
    // Chill freezes enemy action bar entirely at >= 3 stacks.
    const chillScale = frozen ? 0 : chill ? Math.max(0.55, 1 - 0.15 * chill.stacks) : 1;
    const speedFactor = TICK_SECONDS * dazeScale * chillScale;
    if (speedFactor <= 0) continue;

    if (enemy.defId === 'mob_boss' && enemy.slamTimer !== undefined) {
      enemy.slamTimer -= speedFactor;
      if (enemy.slamTimer <= 1.0 && enemy.slamTimer > 0) {
        enemy.slamTelegraph = enemy.slamTimer;
        if (!enemy.slamWarned) {
          enemy.slamWarned = true;
          pushLog(state, 'boss', `${enemy.name} raises its weapon for a Heavy Slam!`);
        }
      } else if (enemy.slamTimer <= 0) {
        enemy.slamTimer += 4.5;
        enemy.slamTelegraph = 0;
        enemy.slamWarned = false;
        damagePlayer(state, enemy, 1.5, 'Heavy Slam');
        if (state.status !== 'running') break;
      } else {
        enemy.slamTelegraph = 0;
      }
    }
    enemy.attackTimer -= speedFactor;
    if (enemy.attackTimer <= 0) {
      enemy.attackTimer += enemy.attackInterval;
      damagePlayer(state, enemy);
      if (state.status !== 'running') break;
    }
  }

  if (state.status === 'running') tickAilments(state);
  if (state.status === 'running') resolveDeaths(state);
}

export function runCombat(state: CombatState, ticks: number): CombatState {
  const count = Math.max(0, Math.floor(ticks));
  for (let i = 0; i < count; i += 1) {
    if (state.status === 'victory') break;
    tickCombat(state);
  }
  return state;
}

/** Manual cast from the skill bar; respects cooldown, bar, mana and the cast bar. */
export function manualCast(state: CombatState, skillId: string): boolean {
  if (state.status !== 'running') return false;
  const skill = state.playerStats.skills.find((entry) => entry.id === skillId);
  if (!skill) return false;
  if (skill.manaReservation > 0 || skill.triggerType) return false;
  if (!isSkillBarValid(state, skill)) return false;
  if (state.player.cast || state.player.castLock > 0) return false;
  if ((state.player.skillTimers[skill.id] ?? 0) > 0) return false;
  if (state.player.mana < skill.effectiveManaCost) return false;
  advanceDiscipline(state, skill.id);
  castSkill(state, skill, disciplineMultiplier(state));
  return true;
}

export function recentDps(state: CombatState, windowSeconds = 5): number {
  const cutoff = state.time - windowSeconds;
  const total = state.damageLog.filter((sample) => sample.t >= cutoff && sample.amount > 0).reduce((sum, s) => sum + s.amount, 0);
  return windowSeconds > 0 ? total / windowSeconds : 0;
}

export function totalAllocatedMods(): number {
  return skillTree.nodes.length;
}
