import { describe, expect, it } from 'vitest';
import { createCombat, runCombat, summonBoss, tickCombat, type CombatState } from '../src/engine/combatEngine';
import { computePlayerStats } from '../src/engine/stats';
import { createInitialSave } from '../src/game/state';
import { runBalanceSim } from '../src/sim';

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

  it('spends three keys to summon the zone boss when autoSummonBoss is enabled', () => {
    const state = stateFor(2);
    state.keys = 3;
    state.enemies.forEach((enemy) => (enemy.hp = 0));
    tickCombat(state);
    expect(state.bossActive).toBe(true);
    expect(state.keys).toBe(0);
    expect(state.enemies.some((enemy) => enemy.defId === 'mob_boss')).toBe(true);
  });

  it('waits for manual summonBoss when autoSummonBoss is false and telegraphs Heavy Slam', () => {
    const save = createInitialSave(0);
    const state = createCombat({
      seed: 42,
      zoneId: save.zoneId,
      tier: 1,
      packSize: 1,
      doctrine: save.doctrine,
      activeBar: 'bar_1',
      startingKeys: 3,
      autoSummonBoss: false,
      suppressRandomKeys: true,
      playerStats: computePlayerStats(save),
    });
    state.enemies.forEach((enemy) => (enemy.hp = 0));
    tickCombat(state);
    expect(state.bossActive).toBe(false);
    expect(state.keys).toBe(3);

    expect(summonBoss(state)).toBe(true);
    expect(state.bossActive).toBe(true);
    expect(state.keys).toBe(0);
    const boss = state.enemies.find((enemy) => enemy.defId === 'mob_boss')!;
    expect(boss.maxHp).toBeGreaterThanOrEqual(800);
    runCombat(state, 37); // ~3.7s into 4.5s slam timer -> inside 1.0s telegraph window
    expect((boss.slamTelegraph ?? 0) > 0).toBe(true);
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

  it('preserves keys and revives with full HP/Ward on Safe Tier 1 death', () => {
    const state = stateFor(1);
    state.tier = 1;
    state.keys = 2;
    state.playerStats.dodgePerHit = 0;
    state.player.ward = 0;
    state.player.hp = 0.01;
    state.enemies.forEach((enemy) => {
      enemy.damage = 1_000_000;
      enemy.attackTimer = 0;
    });
    tickCombat(state);
    expect(state.status).toBe('dead');
    expect(state.tier).toBe(1);
    expect(state.keys).toBe(2);
    runCombat(state, 31);
    expect(state.status).toBe('running');
    expect(state.player.hp).toBe(state.playerStats.maxHp);
    expect(state.player.ward).toBe(state.playerStats.maxWard);
  });

  it('drops the tier and revives after death above Tier 1', () => {
    const state = stateFor(2);
    state.tier = 4;
    state.keys = 2;
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
    expect(state.keys).toBe(0);
    runCombat(state, 31);
    expect(state.status).toBe('running');
    expect(state.tier).toBe(3);
    expect(state.player.hp).toBeGreaterThan(0);
  });

  it('scales Tier 2 enemy HP significantly above Tier 1', () => {
    const save = createInitialSave(0);
    const t1 = createCombat({
      seed: 99,
      zoneId: save.zoneId,
      tier: 1,
      packSize: 1,
      doctrine: save.doctrine,
      activeBar: 'bar_1',
      allowedMonsterIds: ['mob_slime'],
      playerStats: computePlayerStats(save),
    });
    const t2 = createCombat({
      seed: 99,
      zoneId: save.zoneId,
      tier: 2,
      packSize: 1,
      doctrine: save.doctrine,
      activeBar: 'bar_1',
      allowedMonsterIds: ['mob_slime'],
      playerStats: computePlayerStats(save),
    });
    expect(t1.enemies[0]!.maxHp).toBeGreaterThanOrEqual(65);
    expect(t2.enemies[0]!.maxHp).toBeGreaterThanOrEqual(170);
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

  it('runs the balance simulator across presets without NaN or zero DPS', () => {
    const results = runBalanceSim(300);
    expect(results).toHaveLength(8);
    for (const r of results) {
      expect(Number.isFinite(r.avgDps)).toBe(true);
      expect(r.avgDps).toBeGreaterThan(0);
    }
  });
});
