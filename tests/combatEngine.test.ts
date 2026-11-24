import { describe, expect, it } from 'vitest';
import { createCombat, runCombat, tickCombat, type CombatState } from '../src/engine/combatEngine';
import { computePlayerStats } from '../src/engine/stats';
import { createInitialSave } from '../src/game/state';

function stateFor(packSize = 3, seed = 12345): CombatState {
  const save = createInitialSave(0);
  return createCombat({
    seed,
    zoneId: save.zoneId,
    tier: save.tier,
    packSize,
    doctrine: save.doctrine,
    activeBar: 'bar_1',
    startingKeys: save.keys,
    playerStats: computePlayerStats(save),
  });
}

describe('combat engine', () => {
  it('spawns exactly the configured pack size', () => {
    for (const size of [1, 2, 3, 4, 5]) {
      const state = stateFor(size);
      expect(state.enemies).toHaveLength(size);
    }
  });

  it('is deterministic for the same seed and options', () => {
    const a = stateFor(4, 90210);
    const b = stateFor(4, 90210);
    runCombat(a, 300);
    runCombat(b, 300);
    expect(a.totalDamage).toBeCloseTo(b.totalDamage, 6);
    expect(a.player.hp).toBeCloseTo(b.player.hp, 6);
    expect(a.tier).toBe(b.tier);
    expect(a.enemies.map((e) => Math.round(e.hp))).toEqual(b.enemies.map((e) => Math.round(e.hp)));
  });

  it('diverges for different seeds', () => {
    const a = stateFor(4, 1);
    const b = stateFor(4, 2);
    runCombat(a, 120);
    runCombat(b, 120);
    expect(a.totalDamage).not.toBeCloseTo(b.totalDamage, 3);
  });

  it('ticks ailments down and deals damage over time', () => {
    const state = stateFor(1, 7);
    const enemy = state.enemies[0]!;
    enemy.hp = enemy.maxHp;
    enemy.ailments.ignite = { dps: 20, remaining: 3, stacks: 1 };
    const before = enemy.hp;
    for (let i = 0; i < 10; i += 1) tickCombat(state);
    expect(enemy.hp).toBeLessThan(before);
    expect(state.totalDamage).toBeGreaterThan(0);
  });

  it('spends three keys to summon the zone boss', () => {
    const state = stateFor(2);
    state.keys = 3;
    state.enemies.forEach((enemy) => (enemy.hp = 0));
    tickCombat(state);
    expect(state.bossActive).toBe(true);
    expect(state.keys).toBe(0);
    expect(state.enemies.some((enemy) => enemy.defId === 'mob_boss')).toBe(true);
  });

  it('turns a boss kill into victory and advances the tier', () => {
    const state = stateFor(1);
    state.keys = 3;
    state.enemies.forEach((enemy) => (enemy.hp = 0));
    tickCombat(state);
    const boss = state.enemies.find((enemy) => enemy.defId === 'mob_boss')!;
    boss.hp = 0.01;
    runCombat(state, 200);
    expect(state.status).toBe('victory');
    expect(state.rewards.bossKills).toBe(1);
    expect(state.tier).toBeGreaterThan(1);
  });

  it('drops the tier and revives after death', () => {
    const state = stateFor(2);
    state.tier = 4;
    state.playerStats.dodgePerHit = 0;
    state.player.ward = 0;
    state.player.hp = 0.01;
    state.enemies.forEach((enemy) => {
      enemy.damage = 1_000_000;
      enemy.attackTimer = 0;
    });
    tickCombat(state);
    expect(state.status).toBe('dead');
    expect(state.tier).toBe(3);
    runCombat(state, 31);
    expect(state.status).toBe('running');
    expect(state.tier).toBe(3);
    expect(state.player.hp).toBeGreaterThan(0);
  });

  it('lets ward absorb damage before health', () => {
    const state = stateFor(1);
    state.playerStats.dodgePerHit = 0;
    state.player.ward = state.playerStats.maxWard;
    state.player.hp = state.playerStats.maxHp;
    const enemy = state.enemies[0]!;
    enemy.damage = 5;
    enemy.attackTimer = 0;
    state.enemies = [enemy];
    const hpBefore = state.player.hp;
    tickCombat(state);
    expect(state.player.ward).toBeLessThan(state.playerStats.maxWard);
    expect(state.player.hp).toBe(hpBefore);
  });

  it('keeps health above zero and caps regen at max', () => {
    const state = stateFor(3);
    runCombat(state, 600);
    expect(state.player.hp).toBeGreaterThanOrEqual(0);
    expect(state.player.hp).toBeLessThanOrEqual(state.playerStats.maxHp);
  });
});
