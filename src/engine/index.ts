export interface StatValue {
  base: number;
  flat: number;
  increased: number;
  more: number;
}

export type DamageSchool = 'physical' | 'fire' | 'frost' | 'lightning' | 'void';

export interface StatEntity {
  name: string;
  base?: number;
  flat?: number;
  increased?: number;
  more?: number;
}

/**
 * Resolves a value using the project's deterministic pipeline.
 * Increased values are additive and More values are multiplicative.
 */
export function resolveStat(stat: StatValue): number {
  const flatValue = stat.base + stat.flat;
  const increasedValue = flatValue * (1 + stat.increased);
  return increasedValue * (1 + stat.more);
}

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

export function runCombatTick(attacker: CombatEntity, defender: CombatEntity, ticks = 1): CombatTick {
  const safeTicks = Math.max(0, Math.floor(ticks));
  const attackerDamage = attacker.damage * safeTicks;
  const defenderHealth = Math.max(0, defender.health - attackerDamage);

  return {
    ticks: safeTicks,
    attackerDamage,
    defenderHealth,
  };
}
