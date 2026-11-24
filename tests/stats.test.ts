import { describe, expect, it } from 'vitest';
import { aggregateStats, baseStats, computePlayerStats, equippedWeapon } from '../src/engine/stats';
import { createInitialSave, createItem, makeGem } from '../src/game/state';
import { itemGearscore, itemMods, fitsSlot } from '../src/game/items';
import { affixById, itemBaseById, statRegistry } from '../src/data';
import type { CharacterSave } from '../src/game/types';

const starter = () => createInitialSave(0);

describe('stat aggregation', () => {
  it('applies flat, additive increased and multiplicative more layers', () => {
    const value = aggregateStats(
      [
        { stat: 'might', layer: 'flat', value: 5 },
        { stat: 'might', layer: 'increased', value: 50 },
        { stat: 'might', layer: 'more', value: 25 },
      ],
      { might: 10 },
    );
    expect(value.might).toBeCloseTo(28.125, 6);
  });

  it('multiplies multiple more modifiers instead of adding them', () => {
    const value = aggregateStats(
      [
        { stat: 'max_hp', layer: 'more', value: 25 },
        { stat: 'max_hp', layer: 'more', value: 10 },
      ],
      { max_hp: 100 },
    );
    expect(value.max_hp).toBeCloseTo(137.5, 6);
  });

  it('includes registry defaults for every stat', () => {
    const stats = baseStats(1);
    for (const id of Object.keys(statRegistry.stats)) {
      expect(stats[id], `base stat ${id}`).toBeTypeOf('number');
    }
  });
});

describe('item and character stats', () => {
  it('applies affix values from the rolled tier', () => {
    const item = createItem('base_ring_ruby', 'magic', 10, 'affix-test');
    const mods = itemMods(item);
    expect(mods.length).toBeGreaterThan(0);
    item.affixes.forEach((roll) => {
      const affix = affixById.get(roll.affixId)!;
      const mod = mods.find((m) => m.stat === affix.stat && m.layer === affix.layer);
      expect(mod).toBeDefined();
      expect(mod!.value).toBe(affix.values[roll.tier - 1]);
    });
  });

  it('computes gearscore from item level, affix tiers and filled sockets', () => {
    const item = createItem('base_sword_2h', 'rare', 7, 'gs-test');
    item.sockets[0] = makeGem('gem_cleave', 1);
    const expected = 7 * 10 + item.affixes.reduce((sum, a) => sum + a.tier * 15, 0) + 25;
    expect(itemGearscore(item)).toBe(expected);
    expect(itemBaseById.get('base_sword_2h')!.weapon!.twoHanded).toBe(true);
  });

  it('uses the equipped weapon profile and falls back to a sword', () => {
    const save = starter();
    const equipped = equippedWeapon(save);
    expect(equipped.profile.archetype).toBe('sword');
    const empty = { ...save, equipment: {} } as CharacterSave;
    expect(equippedWeapon(empty).profile.archetype).toBe('sword');
    expect(equippedWeapon(empty).base.id).toBe('base_sword_1h');
  });

  it('derives crit, double-hit and resistance numbers from stats', () => {
    const save = starter();
    const stats = computePlayerStats(save);
    const might = stats.values.might!;
    expect(stats.critMultiplier).toBeCloseTo(1.5 + stats.values.crit_multi! / 100 + might / 200, 6);
    expect(stats.doubleHitChance).toBeLessThanOrEqual(0.75);
    expect(stats.doubleHitChance).toBeGreaterThan(0);
    expect(stats.maxHp).toBeGreaterThan(0);
  });

  it('applies Ghostframe max health penalty only when allocated', () => {
    const base = { ...starter(), equipment: {}, allocated: ['hub_0'] } as CharacterSave;
    const plain = computePlayerStats(base);
    const ghost = computePlayerStats({ ...base, allocated: ['hub_0', 'ks_ghostframe'] });
    expect(ghost.maxHp).toBeCloseTo(plain.maxHp * 0.6, 5);
    expect(ghost.dodgeCap).toBe(150);
  });

  it('converts armor into ward under Lattice Skin', () => {
    const base = { ...starter(), equipment: {}, allocated: ['hub_0'] } as CharacterSave;
    const armored = computePlayerStats(base);
    const lattice = computePlayerStats({ ...base, allocated: ['hub_0', 'ks_lattice_skin'] });
    expect(armored.armor).toBeGreaterThan(0);
    expect(lattice.armor).toBe(0);
    expect(lattice.maxWard).toBeCloseTo(armored.maxWard + armored.armor * 0.6, 5);
  });
});

describe('slot fitting', () => {
  it('allows rings in both ring slots and one-handers in the off hand', () => {
    const ring = createItem('base_ring_ruby', 'common', 1, 'ring-fit');
    expect(fitsSlot(ring, 'ring_1')).toBe(true);
    expect(fitsSlot(ring, 'ring_2')).toBe(true);
    expect(fitsSlot(ring, 'helmet')).toBe(false);
    const dagger = createItem('base_dagger', 'common', 1, 'dagger-fit');
    expect(fitsSlot(dagger, 'off_hand')).toBe(true);
    const bow = createItem('base_bow', 'common', 1, 'bow-fit');
    expect(fitsSlot(bow, 'off_hand')).toBe(false);
  });
});

describe('master directive stat wiring', () => {
  it('scales max_mana by +5 per level', () => {
    expect(baseStats(2).max_mana ?? 0).toBe((baseStats(1).max_mana ?? 0) + 5);
    expect(baseStats(5).max_mana ?? 0).toBe((baseStats(1).max_mana ?? 0) + 20);
  });

  it('wires all 4 vectors of Might, Agility, Wisdom, and Fortitude', () => {
    const base = { ...starter(), equipment: {}, allocated: ['hub_0'] } as CharacterSave;
    const plain = computePlayerStats(base);

    const mightChest = createItem('base_chest', 'common', 1, 'v-might');
    mightChest.affixes = [{ affixId: 'aff_mighty', tier: 5 }]; // +flat might
    const withMight = computePlayerStats({ ...base, equipment: { chest: mightChest } });
    expect(withMight.armorBreak).toBeGreaterThan(plain.armorBreak);
    expect(withMight.critMultiplier).toBeGreaterThan(plain.critMultiplier);

    const agiChest = createItem('base_chest', 'common', 1, 'v-agi');
    agiChest.affixes = [{ affixId: 'aff_swift', tier: 5 }];
    const withAgi = computePlayerStats({ ...base, equipment: { chest: agiChest } });
    expect(withAgi.attackSpeedMultiplier).toBeGreaterThan(plain.attackSpeedMultiplier);
    expect(withAgi.doubleHitChance).toBeGreaterThan(plain.doubleHitChance);
    expect(withAgi.dotSpeedMultiplier).toBeGreaterThan(plain.dotSpeedMultiplier);
    expect(withAgi.dodgePerHit).toBeGreaterThan(plain.dodgePerHit);

    const wisChest = createItem('base_chest', 'common', 1, 'v-wis');
    wisChest.affixes = [{ affixId: 'aff_wise', tier: 5 }];
    const withWis = computePlayerStats({ ...base, equipment: { chest: wisChest } });
    expect(withWis.castSpeedMultiplier).toBeGreaterThan(plain.castSpeedMultiplier);
    expect(withWis.totalMaxMana).toBeGreaterThan(plain.totalMaxMana);
    expect(withWis.manaRegen).toBeGreaterThan(plain.manaRegen);
    expect(withWis.maxWard).toBeGreaterThan(plain.maxWard);
    expect(withWis.wardDelay).toBeLessThan(plain.wardDelay);

    const fortChest = createItem('base_chest', 'common', 1, 'v-fort');
    fortChest.affixes = [{ affixId: 'aff_stout', tier: 5 }];
    const withFort = computePlayerStats({ ...base, equipment: { chest: fortChest } });
    expect(withFort.maxHp).toBeGreaterThan(plain.maxHp);
    expect(withFort.hpRegen).toBeGreaterThan(plain.hpRegen);
    expect(withFort.armor).toBeGreaterThan(plain.armor);
    expect(withFort.thorns).toBeGreaterThan(plain.thorns);
  });

  it('applies Tier 1 mana reservation for Bloodlust Aura and filters supports by allowedTags', () => {
    const save = starter();
    const chest = createItem('base_chest', 'common', 1, 'aura-chest');
    chest.sockets = [
      makeGem('gem_bloodlust_aura', 1, 'both'),
      makeGem('gem_ember_bolt', 1, 'both'),
      makeGem('support_echo', 1, 'both'), // spell-only
    ];
    chest.linkedSockets = 3;
    save.equipment.chest = chest;

    const stats = computePlayerStats(save);
    expect(stats.reservedManaPct).toBe(20);
    expect(stats.maxMana).toBeCloseTo(stats.totalMaxMana * 0.8, 4);

    const ember = stats.skills.find((s) => s.gemId === 'gem_ember_bolt')!;
    const cleave = stats.skills.find((s) => s.gemId === 'gem_cleave')!;
    expect(ember.linkedSupportIds).toContain('support_echo');
    expect(cleave.linkedSupportIds).not.toContain('support_echo');
  });
});

