import { doctrineById, monsterById, skillTree, zoneById } from '../data';
import type { AilmentId, DoctrineId, MonsterDef, School, ZoneDef } from '../data/types';
import type { PlayerStats } from './stats';
import { mulberry32, chance, pickOne, rollBetween } from './rng';

export const TICK_SECONDS = 0.1;

export interface AilmentInstance {
  dps: number;
  remaining: number;
  stacks: number;
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
  school: School;
  elite: boolean;
  level: number;
  attackTimer: number;
  dazed: number;
  ailments: Partial<Record<AilmentId, AilmentInstance>>;
  slamTimer?: number;
  slamTelegraph?: number;
  slamWarned?: boolean;
}

export interface Buff {
  id: string;
  name: string;
  remaining: number;
  attackSpeed?: number;
  damageMore?: number;
}

export interface CombatEvent {
  t: number;
  kind: 'hit' | 'crit' | 'ailment' | 'kill' | 'ward' | 'guard' | 'key' | 'death' | 'wave' | 'boss' | 'trigger';
  text: string;
}

export interface CombatHitEvent {
  id: number;
  enemyUid: string;
  amount: number;
  school: School;
  crit: boolean;
}

export interface DamageSample {
  t: number;
  amount: number;
  school: School;
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
    castLock: number;
    skillTimers: Record<string, number>;
    buffs: Buff[];
    lastDamageAt: number;
    deaths: number;
    hitCounter: number;
    guardActive: number;
  };
  enemies: CombatEnemy[];
  bossActive: boolean;
  bossDefeated: boolean;
  wave: number;
  keys: number;
  autoSummonBoss: boolean;
  suppressRandomKeys: boolean;
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
  autoSummonBoss?: boolean;
  suppressRandomKeys?: boolean;
  allowedMonsterIds?: string[];
  playerStats: PlayerStats;
}

const AILMENTS: AilmentId[] = ['bleed', 'ignite', 'chill', 'shock', 'corruption'];

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
  return {
    uid: `e${state.tickCount}_${Math.floor(state.rng() * 1e6)}`,
    defId: def.id,
    name: def.name,
    hp,
    maxHp: hp,
    damage: def.damage * dmgScale,
    armor: def.armor * armorScale,
    attackSpeed: def.attackSpeed,
    school: def.school,
    elite: def.elite,
    level: state.tier + 1,
    attackTimer: 0.4 + state.rng() * 0.8,
    dazed: 0,
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

export function createCombat(options: CreateCombatOptions): CombatState {
  const zone = zoneById.get(options.zoneId) ?? zoneById.values().next().value;
  if (!zone) throw new Error('No zones registered');
  const doctrine = doctrineById.get(options.doctrine)?.id ?? 'tactician';
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
      castLock: 0,
      skillTimers: {},
      buffs: [],
      lastDamageAt: -10,
      deaths: 0,
      hitCounter: 0,
      guardActive: 0,
    },
    enemies: [],
    bossActive: false,
    bossDefeated: false,
    wave: 0,
    keys: options.startingKeys ?? 0,
    autoSummonBoss: options.autoSummonBoss ?? true,
    suppressRandomKeys: options.suppressRandomKeys ?? false,
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
  return 1 + Math.min(0.4, 0.1 * (shock?.stacks ?? 0));
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

/** Applies a hit after shock, execute, crowd and armour rules. Returns actual damage. */
function damageEnemy(
  state: CombatState,
  enemy: CombatEnemy,
  raw: number,
  school: School,
  crit: boolean,
  source: 'auto' | 'skill' | 'ailment' | 'thorns',
): number {
  if (enemy.hp <= 0 || raw <= 0) return 0;
  let amount = raw * shockBonus(enemy);
  const stats = state.playerStats;

  if (stats.keystones.has('ks_crowd_sovereign')) {
    amount *= 1 + 0.25 * Math.min(5, state.enemies.filter((e) => e.hp > 0).length);
  }
  if (enemy.hp / enemy.maxHp < 0.35 && source !== 'ailment') {
    amount *= stats.executeDamageMore;
  }
  if (school === 'physical') {
    amount *= 1 - armorReduction(enemy.armor, enemy.level);
  }
  if (enemy.ailments.chill && enemy.ailments.chill.stacks >= 3 && crit) {
    amount *= 2;
  }

  const dealt = Math.max(0, Math.round(amount * 10) / 10);
  enemy.hp = Math.max(0, enemy.hp - dealt);
  state.totalDamage += dealt;
  state.rewards.damage += dealt;
  state.damageLog.push({ t: state.time, amount: dealt, school });
  if (state.damageLog.length > 200) state.damageLog.shift();
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

function applyAilment(state: CombatState, enemy: CombatEnemy, ailmentId: AilmentId, dps: number, duration: number, chanceToApply: number): void {
  if (!chance(state.rng, chanceToApply)) return;
  const stats = state.playerStats;
  const potency =
    stats.ailmentPotency *
    (1 + (stats.values.wisdom ?? 0) / 120) *
    (1 + (stats.values.agility ?? 0) / 150) *
    (ailmentId === 'corruption' && stats.keystones.has('ks_void_tithe') ? 1.5 : 1);

  const existing = enemy.ailments[ailmentId];
  const festering = stats.keystones.has('ks_festering_wound');
  const maxStacks = festering ? 3 : 1;
  const durationScale = festering ? 0.7 : 1;
  const stackMultiplier = festering ? 0.4 : 1;

  if (existing) {
    existing.stacks = Math.min(maxStacks, existing.stacks + 1);
    existing.remaining = Math.max(existing.remaining, duration * durationScale);
    existing.dps = dps * potency * stackMultiplier;
  } else {
    enemy.ailments[ailmentId] = {
      dps: dps * potency * stackMultiplier,
      remaining: duration * durationScale,
      stacks: 1,
    };
  }
  pushLog(state, 'ailment', `${ailmentId} applied to ${enemy.name}${existing ? ' (stack)' : ''}`);
}

function dazeEnemy(state: CombatState, enemy: CombatEnemy, seconds: number): void {
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

function playerAutoAttack(state: CombatState): void {
  const targets = state.enemies.filter((e) => e.hp > 0);
  if (!targets.length) return;
  const stats = state.playerStats;
  const player = state.player;
  const target = targets.reduce((lowest, enemy) => (enemy.hp < lowest.hp ? enemy : lowest), targets[0]!);

  const might = stats.values.might ?? 0;
  const weapon = stats.weapon;
  const hollow = stats.keystones.has('ks_hollow_fist');
  const implicitScale = hollow ? 2 : 1;
  const buffs = player.buffs.reduce((sum, b) => sum + (b.damageMore ?? 0), 0);
  let raw = rollBetween(state.rng, weapon.minDamage, weapon.maxDamage);
  raw *= 1 + might / 100;
  raw *= 1 + (stats.schoolIncreased.physical ?? 0) + (stats.values.dmg_increased ?? 0) / 100;
  raw *= 1 + buffs;
  if (hollow) raw *= 1.4;

  // Weapon implicits scale with Hollow Fist.
  const axeBonus = weapon.archetype === 'axe' && target.ailments.bleed ? 1 + 0.25 * implicitScale : 1;

  player.hitCounter += 1;
  const isCrit = chance(state.rng, stats.critChance);
  let totalRaw = raw * axeBonus;
  if (isCrit) totalRaw *= stats.critMultiplier;

  for (const part of autoDamageParts(state, totalRaw)) {
    damageEnemy(state, target, part.amount, part.school, isCrit, 'auto');
  }
  if (isCrit) state.damageLog.push({ t: state.time, amount: 0, school: dominantSchool(state) });

  // Double hit echoes at 70% damage and can trigger on-hit effects.
  if (chance(state.rng, stats.doubleHitChance)) {
    for (const part of autoDamageParts(state, totalRaw * 0.7)) {
      damageEnemy(state, target, part.amount, part.school, false, 'auto');
    }
    applyWeaponOnHit(state, target, weapon.archetype, isCrit, implicitScale);
  } else {
    applyWeaponOnHit(state, target, weapon.archetype, isCrit, implicitScale);
  }

  if (weapon.archetype === 'sword' && player.hitCounter % 3 === 0) {
    const others = targets.filter((e) => e !== target).slice(0, 2);
    for (const other of others) {
      for (const part of autoDamageParts(state, totalRaw * 0.6)) {
        damageEnemy(state, other, part.amount, part.school, false, 'auto');
      }
    }
    player.buffs.push({ id: 'sword_haste', name: 'Sword Haste', remaining: 3, attackSpeed: 0.1 * implicitScale });
  }

  if (weapon.archetype === 'staff') {
    for (const ailment of Object.values(target.ailments)) {
      if (ailment) ailment.remaining += 1;
    }
    player.ward = Math.min(stats.maxWard, player.ward + stats.maxWard * 0.02);
  }

  if (weapon.archetype === 'bow' && isCrit) {
    player.mana = Math.min(stats.maxMana, player.mana + stats.maxMana * 0.03);
  }

  if (isCrit && stats.triggerType === 'crit') {
    const ready = stats.skills.find((skill) => (player.skillTimers[skill.id] ?? 0) <= 0 && skill.maxDamage > 0);
    if (ready) {
      player.skillTimers[ready.id] = 1;
      castSkill(state, ready, 0.75, true);
    }
  }
}

function applyWeaponOnHit(state: CombatState, target: CombatEnemy, archetype: string, isCrit: boolean, scale: number): void {
  const stats = state.playerStats;
  if (archetype === 'dagger' && chance(state.rng, Math.min(1, 0.5 * scale))) {
    applyAilment(state, target, 'corruption', 4 * scale, 4, 1);
  }
  if (archetype === 'mace' && chance(state.rng, Math.min(1, 0.3 * scale))) {
    dazeEnemy(state, target, 3);
    pushLog(state, 'hit', `${target.name} is dazed.`);
  }
  if (archetype === 'axe' && isCrit) {
    applyAilment(state, target, 'bleed', 5 * scale, 4, 1);
  }
  if (archetype === 'sword' && stats.keystones.has('ks_void_tithe')) {
    target.ailments.corruption ??= { dps: 2 * scale, remaining: 3, stacks: 1 };
  }
}

function castSkill(state: CombatState, skill: PlayerStats['skills'][number], power: number, triggered = false): void {  const stats = state.playerStats;
  const player = state.player;
  const living = state.enemies.filter((e) => e.hp > 0);
  if (!living.length) return;

  if (!triggered) {
    const cost = skill.manaCost * stats.manaCostMultiplier;
    if (player.mana < cost) return;
    player.mana -= cost;
    player.castLock = skill.castTime / stats.castSpeedMultiplier;
    player.skillTimers[skill.id] = skill.cooldown;
    if (skill.cooldown > 0) pushLog(state, 'guard', `${skill.name} cast (${skill.cooldown.toFixed(1)}s CD)`);
  }

  const isGuard = skill.tags.includes('guard');
  if (isGuard) {
    player.ward = Math.min(stats.maxWard, player.ward + stats.maxWard * 0.18);
    player.guardActive = 2;
    pushLog(state, 'ward', `${skill.name} restores ward (${player.ward.toFixed(0)}/${stats.maxWard.toFixed(0)})`);
    return;
  }

  const area = skill.tags.includes('area');
  const targets = area ? living : living.slice(0, 1 + stats.extraProjectiles);
  const might = stats.values.might ?? 0;
  const schoolBonus = 1 + (stats.schoolIncreased[skill.school] ?? 0) + (stats.values.dmg_increased ?? 0) / 100;
  const base = rollBetween(state.rng, skill.minDamage, skill.maxDamage) * skill.effectiveness * (1 + might / 100) * schoolBonus * power;
  const hollowPenalty = stats.keystones.has('ks_hollow_fist') ? 0.75 : 1;

  for (const target of targets) {
    const crit = chance(state.rng, stats.critChance);
    const amount = base * (area ? stats.areaDamageMore : 1) * hollowPenalty * (crit ? stats.critMultiplier : 1);
    const dealt = damageEnemy(state, target, amount, skill.school, crit, 'skill');
    if (skill.ailment && dealt > 0) {
      applyAilment(state, target, skill.ailment.id, skill.ailment.dps, skill.ailment.duration, skill.ailment.chance);
    }
  }
  if (triggered) pushLog(state, 'trigger', `${skill.name} triggered`);
}

function skillScore(state: CombatState, skill: PlayerStats['skills'][number]): number {
  const stats = state.playerStats;
  const player = state.player;
  const target = state.enemies.find((e) => e.hp > 0);
  if (!target) return Number.NEGATIVE_INFINITY;
  const doctrine = doctrineById.get(state.doctrine);
  const guardThreshold = (doctrine?.guardThreshold ?? 45) / 100;
  const avg = (skill.minDamage + skill.maxDamage) / 2;
  let score = avg * skill.effectiveness * (1 + (stats.values.might ?? 0) / 100);

  const distinctAilments = AILMENTS.filter((a) => target.ailments[a]).length;
  let utility = 1;
  let synergy = 1;

  if (skill.tags.includes('guard')) {
    const hpRatio = player.hp / stats.maxHp;
    utility = hpRatio < guardThreshold ? 6 : 0.1;
  }
  if (state.doctrine === 'weaver' && distinctAilments >= 3) synergy *= 1 - 0.1 * stats.doctrineMultiplier;
  if (state.doctrine === 'weaver' && skill.ailment) synergy *= 0.5;
  if (target.hp / target.maxHp < 0.2) synergy *= 1.2;

  const economy = Math.min(1.4, 1 + player.mana / Math.max(1, stats.maxMana) * 0.4);
  const waste = player.mana < skill.manaCost * stats.manaCostMultiplier ? 0 : 1;
  if (waste === 0) return Number.NEGATIVE_INFINITY;

  const doctrineWeight = state.doctrine === 'entropy' ? 1 + (state.rng() * 0.7 - 0.35) : state.doctrine === 'blitz' ? 1.1 : 1;
  return score * utility * synergy * (state.doctrine === 'entropy' ? 1 : economy) * doctrineWeight * stats.doctrineMultiplier;
}

function playerCastLoop(state: CombatState): void {
  const player = state.player;
  const stats = state.playerStats;
  if (player.castLock > 0) return;

  const candidates = stats.skills.filter((skill) => {
    const barOk = skill.bar === 'both' || skill.bar === state.activeBar || player.buffs.some((b) => b.id === 'pendulum');
    const ready = (player.skillTimers[skill.id] ?? 0) <= 0;
    const cost = skill.manaCost * stats.manaCostMultiplier;
    return barOk && ready && player.mana >= cost && (skill.maxDamage > 0 || skill.tags.includes('guard'));
  });
  if (!candidates.length) return;

  let best = candidates[0]!;
  let bestScore = skillScore(state, best);
  for (const skill of candidates.slice(1)) {
    const score = skillScore(state, skill);
    if (score > bestScore) {
      best = skill;
      bestScore = score;
    }
  }
  if (Number.isFinite(bestScore)) castSkill(state, best, 1);
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
  if (absorbed > 0) pushLog(state, 'ward', `Ward absorbs ${absorbed.toFixed(0)}`);

  player.hp = Math.max(0, player.hp - incoming);
  player.lastDamageAt = state.time;

  if (incoming > 0) {
    pushLog(
      state,
      attackLabel ? 'boss' : 'hit',
      `${enemy.name}${attackLabel ? ` ${attackLabel}` : ''} hits for ${incoming.toFixed(0)} (${player.hp.toFixed(0)} hp)`,
    );
  }

  const thorns = stats.values.thorns ?? 0;
  if (thorns > 0) damageEnemy(state, enemy, thorns, 'physical', false, 'thorns');

  if (stats.triggerType === 'damage' && before > stats.maxHp * 0.08) {
    const guard = stats.skills.find((s) => s.tags.includes('guard') && (player.skillTimers[s.id] ?? 0) <= 0);
    if (guard) {
      player.skillTimers[guard.id] = Math.max(1, guard.cooldown * 0.5);
      castSkill(state, guard, 1, true);
    }
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
  for (const enemy of state.enemies) {
    if (enemy.hp <= 0) continue;
    for (const id of AILMENTS) {
      const ailment = enemy.ailments[id];
      if (!ailment) continue;
      ailment.remaining -= TICK_SECONDS;
      if (ailment.remaining <= 0) {
        delete enemy.ailments[id];
        continue;
      }
      const damage = ailment.dps * ailment.stacks * TICK_SECONDS;
      if (damage <= 0) continue;
      // Corruption bypasses armour; all ailments skip execute/crowd multipliers.
      let dealt = damage;
      if (id !== 'corruption') {
        dealt *= 1 - armorReduction(enemy.armor, enemy.level) * 0.5;
      }
      enemy.hp = Math.max(0, enemy.hp - dealt);
      state.totalDamage += dealt;
      state.rewards.damage += dealt;
      state.damageLog.push({ t: state.time, amount: dealt, school: id === 'ignite' ? 'fire' : id === 'chill' ? 'frost' : 'void' });
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
    state.rewards.gold += Math.round(4 * state.zone.rewardMultiplier * (1 + state.tier * 0.15) * (enemy.elite ? 2.5 : 1) * (1 + stats.goldFind));
    state.rewards.xp += Math.round(14 * state.zone.rewardMultiplier * (1 + (state.tier - 1) * 0.2) * (enemy.elite ? 2 : 1));
    if (enemy.elite) state.rewards.eliteKills += 1;
    if (enemy.defId === 'mob_boss') {
      state.bossDefeated = true;
      state.bossActive = false;
      state.rewards.bossKills += 1;
      state.rewards.gold += 100 * state.zone.rewardMultiplier;
      state.rewards.xp += Math.round(45 * state.zone.rewardMultiplier);
      state.tier = Math.min(10, state.tier + 1);
      state.status = 'victory';
      pushLog(state, 'boss', `${enemy.name} falls. Tier ${state.tier} opens.`);
      continue;
    }
    pushLog(state, 'kill', `${enemy.name} dies (+${Math.round(4 * state.zone.rewardMultiplier)} gold)`);
    if (!state.suppressRandomKeys && chance(state.rng, state.zone.keyDropChance)) {
      state.keys += 1;
      state.rewards.keys += 1;
      pushLog(state, 'key', `Rift Key found (${state.keys}/3)`);
    }
  }

  if (state.status !== 'running') return;
  if (state.enemies.length === 0) {
    if (state.autoSummonBoss && state.keys >= 3) {
      state.keys -= 3;
      spawnBoss(state);
    } else {
      spawnPack(state);
    }
  }
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

  // Ward recharge: 20% max ward per second after 2s without damage.
  const wardDelay = stats.keystones.has('ks_lattice_skin') ? 2 : 2;
  if (state.time - player.lastDamageAt >= wardDelay) {
    const rate = stats.keystones.has('ks_lattice_skin') ? 0.25 : 0.2;
    player.ward = Math.min(stats.maxWard, player.ward + stats.maxWard * rate * TICK_SECONDS);
  }

  player.hp = Math.min(stats.maxHp, player.hp + stats.hpRegen * TICK_SECONDS);
  player.mana = Math.min(stats.maxMana, player.mana + stats.manaRegen * TICK_SECONDS);
  player.castLock = Math.max(0, player.castLock - TICK_SECONDS);
  for (const key of Object.keys(player.skillTimers)) {
    player.skillTimers[key] = Math.max(0, (player.skillTimers[key] ?? 0) - TICK_SECONDS);
  }

  if (stats.keystones.has('ks_pendulum')) {
    state.swapTimer -= TICK_SECONDS;
    if (state.swapTimer <= 0) {
      state.swapTimer = 5;
      state.activeBar = state.activeBar === 'bar_1' ? 'bar_2' : 'bar_1';
      player.buffs.push({ id: 'pendulum', name: 'Pendulum', remaining: 3, damageMore: 0.3 });
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

  const haste = 1 + player.buffs.reduce((sum, b) => sum + (b.attackSpeed ?? 0), 0);
  const interval = 1 / Math.max(0.1, stats.weapon.attacksPerSecond * stats.attackSpeedMultiplier * haste);
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
    const chillScale = chill ? Math.max(0.5, 1 - 0.12 * chill.stacks) : 1;
    const speedFactor = TICK_SECONDS * dazeScale * chillScale;
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
      enemy.attackTimer += 1 / Math.max(0.2, enemy.attackSpeed);
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

/** Manual cast from the skill bar; respects cooldown, bar and mana exactly like automation. */
export function manualCast(state: CombatState, skillId: string): boolean {
  if (state.status !== 'running') return false;
  const skill = state.playerStats.skills.find((entry) => entry.id === skillId);
  if (!skill) return false;
  const barOk = skill.bar === 'both' || skill.bar === state.activeBar;
  if (!barOk) return false;
  if ((state.player.skillTimers[skill.id] ?? 0) > 0) return false;
  if (state.player.mana < skill.manaCost * state.playerStats.manaCostMultiplier) return false;
  castSkill(state, skill, 1);
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
