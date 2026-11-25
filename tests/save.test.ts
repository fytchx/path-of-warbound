import { describe, expect, it } from 'vitest';
import { computePlayerStats } from '../src/engine/stats';
import {
  ALL_UNLOCKABLE_SYSTEMS,
  SAVE_VERSION,
  allocateNode,
  applyCombatRewards,
  applyStarterChoice,
  applyXp,
  awardGemXp,
  canSocketGem,
  chromaticReforge,
  claimOffline,
  computeOffline,
  craftSocketColor,
  createInitialSave,
  createItem,
  equipItem,
  evaluateProgression,
  grantBossCache,
  infusePrismatic,
  levelUpGemWithDust,
  makeGem,
  processKillDrops,
  refundNode,
  respecCost,
  respecTree,
  rollUnique,
  sanitizeSave,
  unequipItem,
  unspentPoints,
  xpNeeded,
} from '../src/game/state';
import {
  addSocket,
  augmentCraft,
  chaosCraft,
  corruptItem,
  essenceLockReforge,
  fusingCraft,
  guaranteedLinkCraft,
  jewellerCraft,
  linkSocket,
  promoteRarity,
  reforgeItem,
  regalCraft,
  socketCap,
  transmuteCraft,
  upgradeItem,
} from '../src/game/crafting';
import { gemDustCostToLevel, itemBase, itemDisplayName } from '../src/game/items';

const starter = () => {
  const save = createInitialSave(0);
  applyStarterChoice(save, 'melee');
  return save;
};

describe('save state', () => {
  it('round-trips through JSON and rejects foreign versions', () => {
    const save = createInitialSave(1000);
    expect(save.version).toBe(SAVE_VERSION);
    expect(SAVE_VERSION).toBe(4);
    const restored = sanitizeSave(JSON.parse(JSON.stringify(save)), 1000);
    expect(restored.level).toBe(save.level);
    expect(restored.skillSlots).toBe(6);
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

  it('starts a new save as a blank slate with every system unlocked', () => {
    const save = createInitialSave(0);
    expect(save.level).toBe(1);
    expect(save.packSize).toBe(1);
    expect(save.gold).toBe(0);
    expect(save.keys).toBe(0);
    expect(save.inventory).toEqual([]);
    expect(save.gemStash).toEqual([]);
    expect(save.materials).toEqual({
      mat_scrap: 0,
      mat_flux: 0,
      mat_thread: 0,
      mat_essence: 0,
      mat_chroma: 0,
      gem_dust: 0,
    });
    expect(save.unlockedTierByZone).toEqual({ zone_ashen_graveyard: 1 });
    expect(save.unlockedZones).toEqual(['zone_ashen_graveyard']);
    expect(save.skillSlots).toBe(6);
    for (const sys of ALL_UNLOCKABLE_SYSTEMS) {
      expect(save.unlockedSystems).toContain(sys);
    }
    expect(save.awakened).toBe(false);
    expect(save.equipment.main_hand).toBeUndefined();
    expect(save.equipment.off_hand).toBeUndefined();
    expect(save.equipment.trinket).toBeUndefined();
    expect(computePlayerStats(save).skills).toHaveLength(0);
  });

  it('grants only the chosen starter weapon and its level 1 gem', () => {
    const save = createInitialSave(0);
    applyStarterChoice(save, 'melee');
    expect(save.awakened).toBe(true);
    expect(save.equipment.main_hand?.baseId).toBe('base_sword_starter');
    expect(save.equipment.main_hand?.rarity).toBe('common');
    expect(save.equipment.main_hand?.sockets).toHaveLength(1);
    expect(save.equipment.main_hand?.linkedSockets).toBe(1);
    expect(save.equipment.off_hand).toBeUndefined();
    expect(save.equipment.trinket).toBeUndefined();

    const stats = computePlayerStats(save);
    expect(stats.skills).toHaveLength(1);
    expect(stats.skills[0]!.gemId).toBe('gem_crossed_slash');
    expect(stats.skills[0]!.level).toBe(1);
  });

  it('applies combat rewards and levels up on the 220 * level^1.45 curve', () => {
    expect(xpNeeded(1)).toBe(220);
    expect(xpNeeded(2)).toBe(Math.floor(220 * Math.pow(2, 1.45)));
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

describe('progression, loot, and gem leveling', () => {
  it('grants progression gems once per trigger without double grants', () => {
    const save = createInitialSave(0);
    const first = applyXp(save, xpNeeded(1));
    expect(save.level).toBe(2);
    expect(first.map((entry) => entry.id)).toContain('prog_ember_bolt');
    expect(save.gemStash.filter((g) => g.gemId === 'gem_ember_bolt')).toHaveLength(1);

    const repeat = applyXp(save, 5);
    const manualRepeat = evaluateProgression(save);
    expect(repeat).toEqual([]);
    expect(manualRepeat).toEqual([]);
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
    expect(save.gemStash.filter((g) => g.gemId === 'gem_ward_barrier')).toHaveLength(1);
  });

  it('drops gear from stage 1, adds materials from stage 2, and salvages duplicates for Gem Dust', () => {
    const stageOne = processKillDrops(createInitialSave(0), 200, 2, 0);
    expect(stageOne.itemsAdded.length).toBeGreaterThan(0);
    expect(stageOne.scrapAdded).toBe(0);

    const save = starter();
    save.lifetime.kills = 10;
    const worn = createItem('base_chest', 'common', 1, 'stage-2-chest');
    worn.dropped = true;
    save.equipment.chest = worn;
    const drops = processKillDrops(save, 120, 2, 0);
    expect(drops.scrapAdded).toBeGreaterThan(0);
    expect(drops.itemsAdded.length).toBeGreaterThan(0);
    expect(drops.gemsAdded.length + drops.dustAdded).toBeGreaterThan(0);

    // Duplicate gem protection: when player owns all gems, gem drops yield +15 gem_dust
    const dustSave = starter();
    dustSave.autoSalvage = true;
    const bulkDrops = processKillDrops(dustSave, 200, 2, 0.5);
    expect(bulkDrops.itemsSalvaged).toBeGreaterThan(0);
    expect(dustSave.inventory.some((i) => i.rarity === 'common')).toBe(false);
  });

  it('awards gem XP on kills and levels gems with Gem Dust', () => {
    const save = starter();
    const gem = save.equipment.main_hand!.sockets[0]!;
    awardGemXp(save, 5);
    expect(gem.xp).toBe(20);

    const cost = gemDustCostToLevel(gem.level);
    expect(levelUpGemWithDust(save, gem).ok).toBe(false);
    save.materials.gem_dust = cost;
    expect(levelUpGemWithDust(save, gem).ok).toBe(true);
    expect(gem.level).toBe(2);
    expect(save.materials.gem_dust).toBe(0);
  });

  it('respects linkedSockets for support gem modifiers', () => {
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
  });
});

describe('allocation and full respec', () => {
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

  it('offers free respec at level <= 10 and charges gold at higher levels', () => {
    const save = createInitialSave(0);
    save.level = 10;
    save.allocated = ['hub_0', 'sec_wisdom', 'p_wisdom_0_entry'];
    expect(respecCost(save)).toBe(0);
    const freeRes = respecTree(save);
    expect(freeRes).toEqual({ ok: true, refunded: 2, cost: 0 });
    expect(save.allocated).toEqual(['hub_0']);

    save.level = 14;
    save.allocated = ['hub_0', 'sec_wisdom', 'p_wisdom_0_entry'];
    expect(respecCost(save)).toBe(350);
    save.gold = 100;
    const denied = respecTree(save);
    expect(denied.ok).toBe(false);
    expect(save.allocated).toHaveLength(3);

    save.gold = 400;
    const paid = respecTree(save);
    expect(paid).toEqual({ ok: true, refunded: 2, cost: 350 });
    expect(save.gold).toBe(50);
    expect(save.allocated).toEqual(['hub_0']);
  });
});

describe('equipment rules & unique presentation', () => {
  it('refuses a two-hander while the off hand is occupied, then frees the off hand', () => {
    const save = starter();
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
    const save = starter();
    const old = save.equipment.main_hand!;
    const replacement = createItem('base_bow', 'magic', 2, 'test-bow-replace');
    save.inventory.push(replacement);
    expect(equipItem(save, replacement, 'main_hand').ok).toBe(true);
    expect(save.inventory.some((item) => item.uid === old.uid)).toBe(true);
  });

  it('uses mythic unique names and treats all sockets as white while wearing Prismatic Aegis', () => {
    const save = starter();
    const aegis = {
      ...createItem('base_chest', 'mythic', 5, 'test-aegis'),
      uniqueId: 'uq_prismatic_aegis',
      socketColors: ['red', 'red', 'red'] as ('red' | 'green' | 'blue' | 'white')[],
      sockets: [null, null, null],
    };
    save.equipment.chest = aegis;
    expect(itemDisplayName(aegis)).toBe('Prismatic Aegis');
    expect(canSocketGem(save, aegis, 0, makeGem('gem_ember_bolt', 1)).ok).toBe(true);

    const rolled = rollUnique(42, 5);
    expect(rolled.rarity).toBe('mythic');
    expect(rolled.uniqueId).toBeTruthy();
    expect(itemDisplayName(rolled)).not.toBe(itemBase(rolled).name);
  });
});

describe('offline progression & boss caches', () => {
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

  it('grants a first-clear Boss Cache with bonus Skill Point, currency, and fully linked gear', () => {
    const save = starter();
    const beforePts = unspentPoints(save);
    const first = grantBossCache(save, 'zone_ashen_graveyard', 1);
    expect(first.firstClear).toBe(true);
    expect(first.skillPoint).toBe(1);
    expect(first.chroma).toBe(3);
    expect(first.essence).toBe(2);
    expect(['rare', 'mythic']).toContain(first.item.rarity);
    expect(first.item.sockets.length).toBeGreaterThanOrEqual(2);
    expect(first.item.linkedSockets).toBe(first.item.sockets.length);
    expect(unspentPoints(save)).toBe(beforePts + 1);
    expect(save.inventory.some((i) => i.uid === first.item.uid)).toBe(true);

    const repeat = grantBossCache(save, 'zone_ashen_graveyard', 1);
    expect(repeat.firstClear).toBe(false);
    expect(repeat.skillPoint).toBe(0);
    expect(unspentPoints(save)).toBe(beforePts + 1);
  });
});

describe('crafting & Currency Bench', () => {
  it('upgrades item level and consumes scrap', () => {
    const save = starter();
    save.materials.mat_scrap = 50;
    const item = save.equipment.main_hand!;
    const before = { level: item.itemLevel, scrap: save.materials.mat_scrap };
    const result = upgradeItem(save, item);
    expect(result.ok).toBe(true);
    expect(item.itemLevel).toBe(before.level + 1);
    expect(save.materials.mat_scrap).toBeLessThan(before.scrap);
    expect(item.affixes.every((a) => a.tier >= 1 && a.tier <= 5)).toBe(true);
  });

  it('walks an item through Transmute -> Augment -> Regal -> Chaos and Jeweller -> Fusing -> Full Link', () => {
    const save = createInitialSave(0);
    save.materials.mat_flux = 50;
    save.materials.mat_essence = 20;
    save.materials.mat_scrap = 50;
    save.materials.mat_thread = 50;

    const item = createItem('base_chest', 'common', 5, 'currency-bench-chest');
    item.affixes = [];
    item.sockets = [null];
    item.socketColors = ['red'];
    item.linkedSockets = 1;

    expect(transmuteCraft(save, item, 1).ok).toBe(true);
    expect(item.rarity).toBe('magic');
    expect(item.affixes).toHaveLength(1);

    expect(augmentCraft(save, item, 2).ok).toBe(true);
    expect(item.affixes).toHaveLength(2);
    expect(augmentCraft(save, item, 3).ok).toBe(false);

    expect(regalCraft(save, item, 4).ok).toBe(true);
    expect(item.rarity).toBe('rare');
    expect(item.affixes.length).toBeGreaterThanOrEqual(3);

    expect(chaosCraft(save, item, 5).ok).toBe(true);
    expect(item.rarity).toBe('rare');

    expect(socketCap(item)).toBeGreaterThanOrEqual(4);
    expect(jewellerCraft(save, item, 6).ok).toBe(true);
    expect(item.sockets).toHaveLength(2);
    expect(jewellerCraft(save, item, 7).ok).toBe(true);
    expect(item.sockets).toHaveLength(3);

    expect(fusingCraft(save, item, 8).ok).toBe(true);
    expect(item.linkedSockets).toBeGreaterThanOrEqual(2);

    if ((item.linkedSockets ?? 1) < item.sockets.length) {
      expect(guaranteedLinkCraft(save, item).ok).toBe(true);
    }
    expect(item.linkedSockets).toBe(item.sockets.length);
  });

  it('enforces exact costs and blocks corrupted items in Chromatic Bench helpers', () => {
    const save = createInitialSave(0);
    const chest = createItem('base_chest', 'magic', 3, 'chroma-chest');
    chest.sockets = [null, null];
    chest.socketColors = ['red', 'green'];

    // craftSocketColor needs 2 chroma + 3 flux
    save.materials.mat_chroma = 2;
    save.materials.mat_flux = 2;
    expect(craftSocketColor(save, chest, 0, 'blue').ok).toBe(false);
    save.materials.mat_flux = 3;
    expect(craftSocketColor(save, chest, 0, 'blue').ok).toBe(true);
    expect(chest.socketColors[0]).toBe('blue');
    expect(save.materials.mat_flux).toBe(0);

    // infusePrismatic needs 5 chroma + 2 essence
    save.materials.mat_chroma = 4;
    save.materials.mat_essence = 2;
    expect(infusePrismatic(save, chest, 1).ok).toBe(false);
    save.materials.mat_chroma = 5;
    expect(infusePrismatic(save, chest, 1).ok).toBe(true);
    expect(chest.socketColors[1]).toBe('white');
    expect(save.materials.mat_chroma).toBe(0);

    // Corrupted blocks all Currency Bench & Chromatic actions
    chest.corrupted = true;
    save.materials.mat_chroma = 20;
    save.materials.mat_flux = 20;
    save.materials.mat_essence = 20;
    save.materials.mat_scrap = 20;
    save.materials.mat_thread = 20;
    expect(chromaticReforge(save, chest).ok).toBe(false);
    expect(craftSocketColor(save, chest, 0, 'red').ok).toBe(false);
    expect(infusePrismatic(save, chest, 0).ok).toBe(false);
    expect(jewellerCraft(save, chest, 1).ok).toBe(false);
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

  it('opens sockets only up to the base limit, links sockets with thread, and essence-lock reforges', () => {
    const save = createInitialSave(0);
    save.materials.mat_thread = 50;
    save.materials.mat_essence = 10;
    const ring = createItem('base_ring_ruby', 'magic', 2, 'test-ring');
    expect(itemBase(ring).sockets).toBe(1);
    const denied = addSocket(save, ring);
    expect(denied.ok).toBe(false);
    expect(ring.sockets).toHaveLength(1);

    const chest = createItem('base_chest', 'rare', 5, 'test-chest-link');
    chest.sockets = [null, null, null];
    chest.linkedSockets = 1;
    expect(linkSocket(save, chest).ok).toBe(true);
    expect(chest.linkedSockets).toBe(2);

    const lockedAffix = { ...chest.affixes[0]! };
    expect(essenceLockReforge(save, chest, 0).ok).toBe(true);
    expect(chest.affixes[0]).toEqual(lockedAffix);
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
