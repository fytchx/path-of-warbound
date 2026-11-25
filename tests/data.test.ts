import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { ALL_ASSET_IDS, ASSETS } from '../src/assets/assetIds';
import { affixes, doctrines, gemById, gems, itemBases as items, monsters, progression, registries, skillTree, statRegistry, zones } from '../src/data';
import type { School } from '../src/data/types';

const manifest = JSON.parse(readFileSync('assets/manifest.json', 'utf8')) as {
  count: number;
  assets: { id: string; file: string; w: number; h: number }[];
};

describe('asset manifest', () => {
  it('is the single source of truth for 154 assets', () => {
    expect(manifest.count).toBe(154);
    expect(manifest.assets).toHaveLength(154);
    expect(new Set(manifest.assets.map((a) => a.id)).size).toBe(154);
    expect(ALL_ASSET_IDS).toHaveLength(154);
  });

  it('carries every manifest id through to the generated AssetId map', () => {
    for (const asset of manifest.assets) {
      expect(ASSETS[asset.id as keyof typeof ASSETS], asset.id).toBeDefined();
    }
  });
});

describe('registries', () => {
  it('references only manifest asset ids', () => {
    const walk = (value: unknown): void => {
      if (Array.isArray(value)) return value.forEach(walk);
      if (!value || typeof value !== 'object') return;
      for (const [key, child] of Object.entries(value)) {
        if (key === 'assetId' && typeof child === 'string') {
          expect(ASSETS[child as keyof typeof ASSETS], child).toBeDefined();
        } else walk(child);
      }
    };
    walk(registries);
  });

  it('keeps every modifier stat inside the registry', () => {
    const stats = new Set(Object.keys(statRegistry.stats));
    const check = (mods: { stat: string }[] | undefined, where: string) => {
      for (const mod of mods ?? []) expect(stats.has(mod.stat), `${where}: ${mod.stat}`).toBe(true);
    };
    items.forEach((item) => check(item.implicit, item.id));
    gems.forEach((gem) => check(gem.mods, gem.id));
    affixes.forEach((affix) => expect(stats.has(affix.stat)).toBe(true));
    skillTree.nodes.forEach((node) => check(node.mods, node.id));
  });

  it('keeps conversions forward-only inside their pass ordering', () => {
    const order: Record<number, string[]> = {
      1: ['might', 'agility', 'wisdom', 'fortitude', 'armor', 'max_ward', 'dodge_rating'],
      2: ['dmg_physical', 'dmg_fire', 'dmg_frost', 'dmg_lightning', 'dmg_void'],
    };
    for (const conversion of statRegistry.conversions) {
      const list = order[conversion.pass]!;
      expect(list.indexOf(conversion.to)).toBeGreaterThan(list.indexOf(conversion.from));
    }
  });

  it('keeps keystone exclusions symmetric', () => {
    for (const node of skillTree.nodes) {
      for (const excluded of node.excludes ?? []) {
        const other = skillTree.nodes.find((n) => n.id === excluded)!;
        expect(other.excludes, `${node.id} ↔ ${excluded}`).toContain(node.id);
      }
    }
  });

  it('has the promised content counts', () => {
    expect(skillTree.nodes.filter((n) => n.kind === 'keystone')).toHaveLength(8);
    expect(skillTree.nodes.filter((n) => n.kind === 'socket')).toHaveLength(6);
    expect(skillTree.nodes.length).toBeGreaterThanOrEqual(90);
    expect(zones).toHaveLength(3);
    expect(doctrines).toHaveLength(5);
    expect(gems.filter((g) => g.kind === 'active').length).toBeGreaterThanOrEqual(16);
    expect(gems.filter((g) => g.kind === 'support').length).toBeGreaterThanOrEqual(9);
    expect(gems.length).toBeGreaterThanOrEqual(24);
    expect(gems.some((g) => g.color === 'white')).toBe(true);
    expect(gems.every((g) => ['red', 'green', 'blue', 'white'].includes(g.color))).toBe(true);
    expect(items.length).toBeGreaterThanOrEqual(28);
    expect(affixes.length).toBeGreaterThanOrEqual(36);
    expect(monsters.filter((m) => !m.boss)).toHaveLength(12);
    expect(monsters.filter((m) => m.boss)).toHaveLength(3);
    expect(monsters.every((m) => Boolean(m.telegraph?.name) && m.telegraph.windup > 0)).toBe(true);
    expect(new Set(zones[0]!.monsterIds).size).toBeGreaterThan(0);
    const schools: School[] = ['physical', 'fire', 'frost', 'lightning', 'void'];
    for (const school of schools) {
      expect(gems.some((gem) => gem.school === school), school).toBe(true);
    }
  });

  it('orders affix tiers ascending across five values', () => {
    for (const affix of affixes) {
      expect(affix.values).toHaveLength(5);
      for (let i = 1; i < affix.values.length; i += 1) {
        expect(affix.values[i]).toBeGreaterThan(affix.values[i - 1]!);
      }
    }
  });

  it('validates progression entries, triggers, granted gems, and unlocked systems', () => {
    expect(progression.length).toBeGreaterThan(0);
    const ids = new Set<string>();
    const validSystems = new Set([
      'altar',
      'bag',
      'tree',
      'forge',
      'bar_2',
      'doctrines',
      'auto_boss',
      'pack_2',
      'pack_full',
      'forge_full',
      'auto_salvage',
      'keystones',
    ]);
    for (const entry of progression) {
      expect(ids.has(entry.id), `duplicate progression id ${entry.id}`).toBe(false);
      ids.add(entry.id);
      if ('level' in entry.trigger) {
        expect(Number.isInteger(entry.trigger.level)).toBe(true);
        expect(entry.trigger.level).toBeGreaterThanOrEqual(1);
      } else {
        expect(entry.trigger.event).toBe('first_death');
      }
      if (entry.grants.gem) {
        expect(gemById.has(entry.grants.gem), `unknown gem ${entry.grants.gem}`).toBe(true);
      }
      if (entry.grants.skillSlot !== undefined) {
        expect(Number.isInteger(entry.grants.skillSlot)).toBe(true);
        expect(entry.grants.skillSlot).toBeGreaterThan(0);
      }
      for (const sys of entry.grants.unlockedSystems ?? []) {
        expect(validSystems.has(sys), `unknown system ${sys}`).toBe(true);
      }
    }
  });
});
