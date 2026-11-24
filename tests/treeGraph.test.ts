import { describe, expect, it } from 'vitest';
import { skillTree } from '../src/data';
import {
  buildTreeGraph,
  canAllocate,
  getArticulationPoints,
  pathTo,
  strandedAfterRemoval,
} from '../src/engine/treeGraph';
import type { SkillTree } from '../src/data/types';

const graph = buildTreeGraph(skillTree);

const synthetic: SkillTree = {
  version: 'test',
  rootId: 'r',
  nodes: [
    { id: 'r', name: 'root', kind: 'hub', sector: 'core', x: 0, y: 0, mods: [], description: '' },
    { id: 'a', name: 'a', kind: 'minor', sector: 'might', x: 0, y: 0, mods: [], description: '' },
    { id: 'b', name: 'b', kind: 'minor', sector: 'might', x: 0, y: 0, mods: [], description: '' },
    { id: 'c', name: 'c', kind: 'notable', sector: 'might', x: 0, y: 0, mods: [], description: '' },
    { id: 'd', name: 'd', kind: 'minor', sector: 'might', x: 0, y: 0, mods: [], description: '' },
  ],
  edges: [
    ['r', 'a'],
    ['a', 'b'],
    ['b', 'c'],
    ['b', 'd'],
  ],
};

describe('tree graph', () => {
  it('builds a symmetric adjacency map', () => {
    for (const [a, b] of skillTree.edges) {
      expect(graph.adjacency.get(a)).toContain(b);
      expect(graph.adjacency.get(b)).toContain(a);
    }
  });

  it('finds the shortest unallocated path by multi-source BFS', () => {
    const g = buildTreeGraph(synthetic);
    expect(pathTo([], 'r', g)).toEqual([]);
    expect(pathTo([], 'a', g)).toEqual(['a']);
    expect(pathTo([], 'c', g)).toEqual(['a', 'b', 'c']);
    expect(pathTo([], 'd', g)).toEqual(['a', 'b', 'd']);
    expect(pathTo([], 'missing', g)).toBeNull();
  });

  it('charges only unallocated nodes and rejects unaffordable paths', () => {
    const g = buildTreeGraph(synthetic);
    const check = canAllocate([], 'c', g, 2);
    expect(check.ok).toBe(false);
    expect(check.reason).toBe('not-enough-points');
    expect(check.cost).toBe(3);
    expect(canAllocate([], 'r', g).reason).toBe('root');
    expect(canAllocate(['a'], 'a', g).reason).toBe('already-allocated');
  });

  it('rejects a keystone while its mutually exclusive partner is allocated', () => {
    const check = canAllocate(['hub_0', 'ks_hollow_fist'], 'ks_pendulum', graph, 100);
    expect(check.reason).toBe('excluded');
    expect(check.blockedBy).toBe('ks_hollow_fist');
  });

  it('detects stranded branches after refunds', () => {
    const g = buildTreeGraph(synthetic);
    expect(strandedAfterRemoval(['a', 'b', 'c', 'd'], 'b', g)).toEqual(['c', 'd']);
    expect(strandedAfterRemoval(['a', 'b', 'd'], 'd', g)).toEqual([]);
  });

  it('finds articulation points in a chain and not on leaves', () => {
    const g = buildTreeGraph(synthetic);
    const points = getArticulationPoints(['a', 'b', 'c', 'd'], g);
    expect(points).toContain('a');
    expect(points).toContain('b');
    expect(points).not.toContain('c');
    expect(points).not.toContain('d');
  });

  it('exposes eight keystones and six sockets in the shipped tree', () => {
    expect(skillTree.nodes.filter((n) => n.kind === 'keystone')).toHaveLength(8);
    expect(skillTree.nodes.filter((n) => n.kind === 'socket')).toHaveLength(6);
    expect(skillTree.nodes.filter((n) => n.kind === 'notable').length).toBeGreaterThanOrEqual(8);
  });
});
