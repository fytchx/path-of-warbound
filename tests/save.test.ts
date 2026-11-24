import { describe, expect, it } from 'vitest';
import { computePlayerStats } from '../src/engine/stats';
import {
  SAVE_VERSION,
  allocateNode,
  applyCombatRewards,
  applyXp,
  claimOffline,
  computeOffline,
  createInitialSave,
  createItem,
  equipItem,
  evaluateProgression,
  makeGem,
  refundNode,
  sanitizeSave,
  unequipItem,
  unspentPoints,
  xpNeeded,
} from '../src/game/state';
import { addSocket, corruptItem, promoteRarity, reforgeItem, upgradeItem } from '../src/game/crafting';
import { itemBase } from '../src/game/items';

describe('save state', () => {
  it('round-trips through JSON and rejects foreign versions', () => {
    const save = createInitialSave(1000);
    expect(save.version).toBe(SAVE_VERSION);
    const restored = sanitizeSave(JSON.parse(JSON.stringify(save)), 1000);
    expect(restored.level).toBe(save.level);
    expect(restored.skillSlots).toBe(save.skillSlots);
    expect(Object.keys(restored.equipment)).toEqual(Object.keys(save.equipment));
    expect(restored.materials.mat_scrap).toBe(save.materials.mat_scrap);
    const oldVersion = sanitizeSave({ ...save, version: 1 }, 1000);
    expect(oldVersion.level).toBe(1);
    const foreign = sanitizeSave({ ...save, version: 999 }, 1000);
    expect(foreign.level).toBe(createInitialSave(1000).level);
    expect(foreign.allocated).toContain('hub_0');
    const broken = sanitizeSave({ version: SAVE_VERSION, allocated: [] }, 1000);
    expect(broken.allocated).toEqual(['hub_0']);
  });

  it('starts a new save with exactly 1 skill slot and 1 active skill', () => {
    const save = createInitialSave(0);
    expect(save.level).toBe(1);
    expect(save.skillSlots).toBe(1);
    expect(save.unlockedSystems).toEqual([]);
    expect(save.equipment.off_hand).toBeUndefined();
    expect(save.equipment.trinket).toBeUndefined();
    expect(save.gemStash).toEqual([]);

    const stats = computePlayerStats(save);
    expect(stats.skills).toHaveLength(1);
    expect(stats.skills[0]!.gemId).toBe('gem_cleave');
  });

  it('applies combat rewards and levels up with the xp curve', () => {
    const save = createInitialSave(0);
    const needed = xpNeeded(save.level) - save.xp;
    applyCombatRewards(save, {
      gold: 50,
      xp: needed,
      kills: 3,
      eliteKills: 1,
      bossKills: 0,
      deaths: 0,
      keys: 1,
      damage: 500,
    });
    expect(save.level).toBe(2);
    expect(save.gold).toBe(50);
    expect(save.keys).toBe(1);
    expect(save.lifetime.kills).toBe(3);
    expect(save.lifetime.damage).toBe(500);
  });
});

describe('progression unlocks', () => {
  it('grants a slot, gem, and unlocked system once per level trigger without double grants', () => {
    const save = createInitialSave(0);
    const first = applyXp(save, xpNeeded(1));
    expect(save.level).toBe(2);
    expect(first.map((entry) => entry.id)).toContain('prog_ember_bolt');
    expect(save.skillSlots).toBe(2);
    expect(save.gemStash.filter((g) => g.gemId === 'gem_ember_bolt')).toHaveLength(1);
    expect(save.unlockedSystems).toContain('altar');

    const repeat = applyXp(save, 5);
    const manualRepeat = evaluateProgression(save);
    expect(repeat).toEqual([]);
    expect(manualRepeat).toEqual([]);
    expect(save.skillSlots).toBe(2);
    expect(save.gemStash.filter((g) => g.gemId === 'gem_ember_bolt')).toHaveLength(1);
  });

  it('grants Ward Barrier once on first_death', () => {
    const save = createInitialSave(0);
    const firstDeath = applyCombatRewards(save, {
      gold: 0,
      xp: 0,
      kills: 0,
      eliteKills: 0,
      bossKills: 0,
      deaths: 1,
      keys: 0,
      damage: 0,
    });
    expect(firstDeath.map((entry) => entry.id)).toContain('prog_ward_barrier');
    expect(save.skillSlots).toBe(2);
    expect(save.gemStash.filter((g) => g.gemId === 'gem_ward_barrier')).toHaveLength(1);

    const secondDeath = applyCombatRewards(save, {
      gold: 0,
      xp: 0,
      kills: 0,
      eliteKills: 0,
      bossKills: 0,
      deaths: 1,
      keys: 0,
      damage: 0,
    });
    expect(secondDeath).toEqual([]);
    expect(save.skillSlots).toBe(2);
    expect(save.gemStash.filter((g) => g.gemId === 'gem_ward_barrier')).toHaveLength(1);
  });

  it('slices active skills in computePlayerStats to never exceed save.skillSlots', () => {
    const save = createInitialSave(0);
    save.equipment.main_hand!.sockets = [
      makeGem('gem_cleave', 1, 'both'),
      makeGem('gem_ember_bolt', 1, 'both'),
      makeGem('gem_frost_shard', 1, 'both'),
    ];

    save.skillSlots = 1;
    expect(computePlayerStats(save).skills).toHaveLength(1);
    expect(computePlayerStats(save).skills.map((s) => s.gemId)).toEqual(['gem_cleave']);

    save.skillSlots = 2;
    expect(computePlayerStats(save).skills).toHaveLength(2);
    expect(computePlayerStats(save).skills.map((s) => s.gemId)).toEqual(['gem_cleave', 'gem_ember_bolt']);

    save.skillSlots = 3;
    expect(computePlayerStats(save).skills).toHaveLength(3);
  });
});

describe('allocation', () => {
  it('needs unspent points and allocates the BFS path', () => {
    const save = createInitialSave(0);
    save.level = 10;
    save.allocated = ['hub_0'];
    expect(unspentPoints(save)).toBe(10);
    const result = allocateNode(save, 'sec_wisdom');
    expect(result.ok).toBe(true);
    expect(save.allocated).toContain('sec_wisdom');
    expect(unspentPoints(save)).toBe(9);
  });

  it('blocks refunds that would strand allocated nodes', () => {
    const save = createInitialSave(0);
    save.level = 20;
    save.allocated = ['hub_0', 'sec_wisdom', 'p_wisdom_0_entry'];
    const blocked = refundNode(save, 'sec_wisdom');
    expect(blocked.ok).toBe(false);
    expect(blocked.reason).toBe('articulation');
    expect(blocked.stranded).toContain('p_wisdom_0_entry');
    const leaf = refundNode(save, 'p_wisdom_0_entry');
    expect(leaf.ok).toBe(true);
    expect(save.allocated).not.toContain('p_wisdom_0_entry');
  });
});

describe('equipment rules', () => {
  it('refuses a two-hander while the off hand is occupied, then frees the off hand', () => {
    const save = createInitialSave(0);
    const shield = createItem('base_shield', 'magic', 1, 'test-shield');
    const bow = createItem('base_bow', 'magic', 2, 'test-bow');
    save.inventory.push(shield, bow);
    expect(equipItem(save, shield, 'off_hand').ok).toBe(true);
    expect(equipItem(save, bow, 'main_hand').ok).toBe(false);
    unequipItem(save, 'off_hand');
    const result = equipItem(save, bow, 'main_hand');
    expect(result.ok).toBe(true);
    expect(save.equipment.main_hand?.baseId).toBe('base_bow');
    expect(save.equipment.off_hand).toBeUndefined();
  });

  it('returns replaced gear to the bag', () => {
    const save = createInitialSave(0);
    const old = save.equipment.main_hand!;
    const replacement = createItem('base_bow', 'magic', 2, 'test-bow-replace');
    save.inventory.push(replacement);
    expect(equipItem(save, replacement, 'main_hand').ok).toBe(true);
    expect(save.inventory.some((item) => item.uid === old.uid)).toBe(true);
  });
});

describe('offline progression', () => {
  it('ignores short absences and caps long ones at eight hours', () => {
    const save = createInitialSave(0);
    save.lastSeen = 10_000;
    expect(computeOffline(save, 10_000 + 30_000)).toBeNull();
    const short = computeOffline(save, 10_000 + 10 * 60_000)!;
    expect(short.seconds).toBe(600);
    const long = computeOffline(save, 10_000 + 48 * 3600_000)!;
    expect(long.seconds).toBe(8 * 3600);
    expect(long.gold).toBeGreaterThan(short.gold);
  });

  it('claims offline rewards into gold, keys and xp', () => {
    const save = createInitialSave(0);
    const beforeGold = save.gold;
    claimOffline(save, { seconds: 600, gold: 25, xp: 10, kills: 4, keys: 1 });
    expect(save.gold).toBe(beforeGold + 25);
    expect(save.keys).toBe(1);
    expect(save.lifetime.kills).toBe(4);
  });
});

describe('crafting', () => {
  it('upgrades item level and consumes scrap', () => {
    const save = createInitialSave(0);
    save.materials.mat_scrap = 50;
    const item = save.equipment.main_hand!;
    const before = { level: item.itemLevel, scrap: save.materials.mat_scrap };
    const result = upgradeItem(save, item);
    expect(result.ok).toBe(true);
    expect(item.itemLevel).toBe(before.level + 1);
    expect(save.materials.mat_scrap).toBeLessThan(before.scrap);
    expect(item.affixes.every((a) => a.tier >= 1 && a.tier <= 5)).toBe(true);
  });

  it('reforges affixes without changing rarity or socket count', () => {
    const save = createInitialSave(0);
    save.materials.mat_flux = 50;
    const item = createItem('base_chest', 'rare', 3, 'test-reforge');
    const sockets = item.sockets.length;
    const rarity = item.rarity;
    const result = reforgeItem(save, item);
    expect(result.ok).toBe(true);
    expect(item.rarity).toBe(rarity);
    expect(item.sockets).toHaveLength(sockets);
    expect(item.affixes.length).toBeGreaterThan(0);
  });

  it('opens sockets only up to the base limit', () => {
    const save = createInitialSave(0);
    save.materials.mat_thread = 50;
    const ring = createItem('base_ring_ruby', 'magic', 2, 'test-ring');
    expect(itemBase(ring).sockets).toBe(1);
    const denied = addSocket(save, ring);
    expect(denied.ok).toBe(false);
    expect(ring.sockets).toHaveLength(1);
  });

  it('corrupts once and promotes rarity', () => {
    const save = createInitialSave(0);
    save.materials.mat_essence = 10;
    save.materials.mat_flux = 100;
    const item = save.equipment.boots!;
    expect(corruptItem(save, item).ok).toBe(true);
    expect(item.corrupted).toBe(true);
    expect(corruptItem(save, item).ok).toBe(false);
    const before = item.rarity;
    if (before !== 'mythic') {
      expect(promoteRarity(save, item).ok).toBe(true);
      expect(item.rarity).not.toBe(before);
    }
  });
});
