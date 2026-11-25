import { describe, expect, it } from 'vitest';
import { createCombat, runCombat, summonBoss, tickCombat, type CombatState } from '../src/engine/combatEngine';
import { computePlayerStats } from '../src/engine/stats';
import { applyStarterChoice, createInitialSave, createItem, dropStage, makeGem } from '../src/game/state';
import type { CharacterSave } from '../src/game/types';
import { runSimulation } from '../src/sim/runSim';

function starterSave(): CharacterSave {
  const save = createInitialSave(0);
  applyStarterChoice(save, 'melee');
  return save;
}

function stateFor(packSize = 3, seed = 12345): CombatState {
  const save = starterSave();
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

  it('never auto-spawns the zone boss, even while holding three Rift Keys', () => {
    const state = stateFor(2);
    state.keys = 3;
    state.enemies.forEach((enemy) => (enemy.hp = 0));
    for (let i = 0; i < 200; i += 1) tickCombat(state);
    expect(state.bossActive).toBe(false);
    expect(state.keys).toBeGreaterThanOrEqual(3);
    expect(state.enemies.some((enemy) => enemy.defId === 'mob_boss')).toBe(false);
  });

  it('summons the boss only on manual summonBoss and telegraphs Heavy Slam', () => {
    const save = createInitialSave(0);
    const state = createCombat({
      seed: 42,
      zoneId: save.zoneId,
      tier: 1,
      packSize: 1,
      doctrine: save.doctrine,
      activeBar: 'bar_1',
      startingKeys: 3,
      keysUnlocked: false,
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
    expect(summonBoss(state)).toBe(true);
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
    const results = runSimulation({ ticks: 300 });
    expect(results).toHaveLength(8);
    for (const r of results) {
      expect(Number.isFinite(r.dps)).toBe(true);
      expect(r.dps).toBeGreaterThan(0);
    }
  });

  it('grants +4 Mana per weapon auto-attack hit and triggers Tier 2 instant skills off-GCD', () => {
    const save = starterSave();
    const helm = createItem('base_helm', 'common', 1, 'combat-helm');
    helm.sockets = [makeGem('gem_ward_barrier', 1, 'both')];
    helm.linkedSockets = 1;
    save.equipment.helmet = helm;

    const state = createCombat({
      seed: 101,
      zoneId: save.zoneId,
      tier: 1,
      packSize: 1,
      doctrine: save.doctrine,
      activeBar: 'bar_1',
      playerStats: computePlayerStats(save),
    });
    state.player.mana = 10;
    state.player.attackTimer = 0;
    // Let Ward Barrier (Tier 2 instant) fire and weapon swing gain +4 Mana
    tickCombat(state);
    expect(state.player.ward).toBeGreaterThan(0);
    expect(state.player.mana).toBeGreaterThanOrEqual(4);
  });

  it('freezes enemies at >= 3 Chill stacks and applies +20% Exposure from Plague Skull', () => {
    const state = stateFor(1, 77);
    const enemy = state.enemies[0]!;
    const beforeAtkTimer = enemy.attackTimer;
    enemy.ailments.chill = { dps: 0, remaining: 4, stacks: 3 };
    tickCombat(state);
    expect(enemy.attackTimer).toBe(beforeAtkTimer);

    const beforeHp = enemy.hp;
    enemy.ailments = { ignite: { dps: 100, remaining: 3, stacks: 1 } };
    enemy.exposureRemaining = 0;
    state.player.attackTimer = 10_000;
    tickCombat(state);
    const unexposedDrop = beforeHp - enemy.hp;

    const state2 = stateFor(1, 77);
    const enemy2 = state2.enemies[0]!;
    enemy2.hp = beforeHp;
    enemy2.ailments = { ignite: { dps: 100, remaining: 3, stacks: 1 } };
    enemy2.exposureRemaining = 6;
    state2.player.attackTimer = 10_000;
    tickCombat(state2);
    const exposedDrop = beforeHp - enemy2.hp;
    expect(exposedDrop).toBeGreaterThan(unexposedDrop);
  });

  it('awards 22 XP and 3-8 Gold per Tier 1 normal kill, and 48 XP at Tier 2', () => {
    const save = createInitialSave(0);
    const t1 = createCombat({
      seed: 55,
      zoneId: save.zoneId,
      tier: 1,
      packSize: 1,
      doctrine: save.doctrine,
      activeBar: 'bar_1',
      allowedMonsterIds: ['mob_slime'],
      playerStats: computePlayerStats(save),
    });
    t1.enemies[0]!.elite = false;
    t1.enemies[0]!.hp = 1;
    t1.player.attackTimer = 0;
    tickCombat(t1);
    expect(t1.rewards.kills).toBe(1);
    expect(t1.rewards.xp).toBe(22);
    expect(t1.rewards.gold).toBeGreaterThanOrEqual(3);
    expect(t1.rewards.gold).toBeLessThanOrEqual(8);

    const t2 = createCombat({
      seed: 55,
      zoneId: save.zoneId,
      tier: 2,
      packSize: 1,
      doctrine: save.doctrine,
      activeBar: 'bar_1',
      allowedMonsterIds: ['mob_slime'],
      playerStats: computePlayerStats(save),
    });
    t2.enemies[0]!.elite = false;
    t2.enemies[0]!.hp = 1;
    t2.player.attackTimer = 0;
    tickCombat(t2);
    expect(t2.rewards.kills).toBe(1);
    expect(t2.rewards.xp).toBe(48);
  });

  it('gates Rift Key drops behind Stage 5 readiness', () => {
    const save = starterSave();
    expect(dropStage(save)).toBeLessThan(5);

    const options = {
      seed: 2026,
      zoneId: save.zoneId,
      tier: 1,
      packSize: 1,
      doctrine: save.doctrine,
      activeBar: 'bar_1' as const,
      startingKeys: 0,
    };
    const gated = createCombat({
      ...options,
      keysUnlocked: dropStage(save) >= 5,
      playerStats: computePlayerStats(save),
    });
    runCombat(gated, 6000);
    expect(gated.rewards.kills).toBeGreaterThan(5);
    expect(gated.keys).toBe(0);

    const sword = createItem('base_sword_1h', 'common', 3, 'stage5-sword');
    sword.sockets = [makeGem('gem_crossed_slash', 3, 'both'), makeGem('support_echo', 1, 'both')];
    sword.linkedSockets = 2;
    save.equipment.main_hand = sword;
    save.level = 3;
    save.milestones.forgeUpgrades = 1;
    expect(dropStage(save)).toBe(5);

    const unlocked = createCombat({
      ...options,
      keysUnlocked: dropStage(save) >= 5,
      playerStats: computePlayerStats(save),
    });
    runCombat(unlocked, 6000);
    expect(unlocked.rewards.kills).toBeGreaterThan(5);
    expect(unlocked.keys).toBeGreaterThan(0);
  });
});

