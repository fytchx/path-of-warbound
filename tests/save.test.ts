import { describe, expect, it } from 'vitest';
import { computePlayerStats } from '../src/engine/stats';
import {
  ALL_UNLOCKABLE_SYSTEMS,
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
  processKillDrops,
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

  it('starts a new save with minimal Step 0 kit: 1 skill slot, 1 active skill, packSize 1', () => {
    const save = createInitialSave(0);
    expect(save.level).toBe(1);
    expect(save.packSize).toBe(1);
    expect(save.onboardingStep).toBe(0);
    expect(save.starterKillsClaimed).toBe(0);
    expect(save.skillSlots).toBe(1);
    expect(save.unlockedSystems).toEqual([]);
    expect(save.equipment.main_hand?.baseId).toBe('base_sword_1h');
    expect(save.equipment.main_hand?.sockets).toHaveLength(1);
    expect(save.equipment.main_hand?.linkedSockets).toBe(1);
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
    expect(save.unlockedSystems).toContain('tree');

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

  it('delivers the deterministic starter drop deck for the first 10 kills and awakens on Tier 2', () => {
    const save = createInitialSave(0);

    const k2 = processKillDrops(save, 2, 1);
    expect(save.starterKillsClaimed).toBe(2);
    expect(k2.itemsAdded.map((i) => i.baseId)).toEqual(['base_helm']);
    expect(save.unlockedSystems).toContain('altar');
    expect(save.unlockedSystems).toContain('bag');
    expect(save.onboardingStep).toBe(1);

    const k3 = processKillDrops(save, 1, 1);
    expect(k3.itemsAdded.map((i) => i.baseId)).toEqual(['base_chest']);
    expect(k3.itemsAdded[0]!.linkedSockets).toBe(2);

    const k5 = processKillDrops(save, 2, 1);
    expect(k5.gemsAdded).toEqual(['support_multistrike']);
    expect(save.gemStash.some((g) => g.gemId === 'support_multistrike')).toBe(true);
    expect(save.onboardingStep).toBe(2);

    const k6 = processKillDrops(save, 1, 1);
    expect(k6.keysAdded).toBe(1);
    expect(k6.scrapAdded).toBe(25);
    expect(save.keys).toBe(1);

    const k8 = processKillDrops(save, 2, 1);
    expect(k8.itemsAdded.map((i) => i.baseId)).toEqual(['base_axe_1h']);
    expect(save.unlockedSystems).toContain('forge');
    expect(save.unlockedSystems).toContain('pack_2');
    expect(save.onboardingStep).toBe(4);

    const k10 = processKillDrops(save, 2, 1);
    expect(save.starterKillsClaimed).toBe(10);
    expect(k10.keysAdded).toBe(1);
    expect(k10.scrapAdded).toBe(35);
    expect(save.keys).toBe(2);

    save.keys = 3;
    processKillDrops(save, 0, 1);
    expect(save.onboardingStep).toBe(5);

    const awakened = processKillDrops(save, 1, 2);
    expect(awakened.awakened).toBe(true);
    expect(save.onboardingStep).toBe(6);
    for (const sys of ALL_UNLOCKABLE_SYSTEMS) {
      expect(save.unlockedSystems).toContain(sys);
    }
  });

  it('respects linkedSockets for support gem modifiers and supports autoSalvage', () => {
    const save = createInitialSave(0);
    const chest = createItem('base_chest', 'magic', 1, 'test-link-chest');
    chest.sockets = [makeGem('support_multistrike', 1, 'both'), makeGem('gem_cleave', 1, 'both')];
    chest.linkedSockets = 1;
    save.equipment.chest = chest;

    const unlinkedStats = computePlayerStats(save);
    expect(unlinkedStats.supports).toHaveLength(0);

    chest.linkedSockets = 2;
    const linkedStats = computePlayerStats(save);
    expect(linkedStats.supports.map((s) => s.id)).toContain('support_multistrike');

    save.starterKillsClaimed = 10;
    save.autoSalvage = true;
    const dropSummary = processKillDrops(save, 50, 2);
    expect(dropSummary.itemsSalvaged).toBeGreaterThan(0);
    expect(save.inventory.some((i) => i.rarity === 'common')).toBe(false);
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
    const item = createItem('base_boots', 'common', 1, 'test-corrupt');
    save.inventory.push(item);
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
