export { resolveStat } from './stats';
export type { StatValue, PlayerStats, CombatSkill, TriggerType } from './stats';
export { aggregateStats, baseStats, computePlayerStats, equippedWeapon } from './stats';
export {
  buildTreeGraph,
  canAllocate,
  pathTo,
  strandedAfterRemoval,
  getArticulationPoints,
  neighborCount,
} from './treeGraph';
export type { TreeGraph, AllocationCheck } from './treeGraph';
export {
  TICK_SECONDS,
  createCombat,
  tickCombat,
  runCombat,
  summonBoss,
  recentDps,
} from './combatEngine';
export type {
  CombatState,
  CombatEnemy,
  CombatEvent,
  CombatHitEvent,
  CombatRewards,
  CreateCombatOptions,
  AilmentInstance,
} from './combatEngine';

export interface CombatEntity {
  name: string;
  health: number;
  damage: number;
}

export interface CombatTick {
  ticks: number;
  attackerDamage: number;
  defenderHealth: number;
}

/**
 * Characterisation of the original tick helper, kept for the v0.1 slice's
 * deterministic damage tests: damage is applied per tick and health clamps at 0.
 */
export function runCombatTick(attacker: CombatEntity, defender: CombatEntity, ticks = 1): CombatTick {
  const safeTicks = Math.max(0, Math.floor(ticks));
  const attackerDamage = attacker.damage * safeTicks;
  const defenderHealth = Math.max(0, defender.health - attackerDamage);
  return { ticks: safeTicks, attackerDamage, defenderHealth };
}

export type DamageSchool = 'physical' | 'fire' | 'frost' | 'lightning' | 'void';
