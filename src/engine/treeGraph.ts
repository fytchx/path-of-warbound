import type { SkillTree, TreeNode } from '../data/types';

export interface TreeGraph {
  rootId: string;
  nodes: Map<string, TreeNode>;
  adjacency: Map<string, string[]>;
}

export function buildTreeGraph(tree: SkillTree): TreeGraph {
  const nodes = new Map(tree.nodes.map((node) => [node.id, node]));
  const adjacency = new Map<string, string[]>();
  for (const node of tree.nodes) adjacency.set(node.id, []);
  for (const [a, b] of tree.edges) {
    adjacency.get(a)?.push(b);
    adjacency.get(b)?.push(a);
  }
  return { rootId: tree.rootId, nodes, adjacency };
}

function sources(allocated: string[], graph: TreeGraph): Set<string> {
  return new Set([graph.rootId, ...allocated]);
}

/**
 * Multi-source BFS. Returns the unallocated nodes that must be purchased to
 * reach the target (target last), or null when no route exists.
 */
export function pathTo(allocated: string[], targetId: string, graph: TreeGraph): string[] | null {
  const owned = sources(allocated, graph);
  if (owned.has(targetId)) return [];
  if (!graph.nodes.has(targetId)) return null;

  const parent = new Map<string, string | null>();
  const queue: string[] = [];
  for (const id of owned) {
    parent.set(id, null);
    queue.push(id);
  }

  while (queue.length) {
    const current = queue.shift()!;
    for (const next of graph.adjacency.get(current) ?? []) {
      if (parent.has(next)) continue;
      parent.set(next, current);
      if (next === targetId) {
        const path: string[] = [];
        let cursor: string | null = next;
        while (cursor && !owned.has(cursor)) {
          path.push(cursor);
          cursor = parent.get(cursor) ?? null;
        }
        return path.reverse();
      }
      queue.push(next);
    }
  }
  return null;
}

export interface AllocationCheck {
  ok: boolean;
  reason?: 'already-allocated' | 'unknown-node' | 'unreachable' | 'not-enough-points' | 'excluded' | 'root';
  cost: number;
  path: string[];
  blockedBy?: string;
}

export function canAllocate(
  allocated: string[],
  targetId: string,
  graph: TreeGraph,
  pointsLeft = Number.POSITIVE_INFINITY,
): AllocationCheck {
  if (targetId === graph.rootId) {
    return { ok: false, reason: 'root', cost: 0, path: [] };
  }
  const node = graph.nodes.get(targetId);
  if (!node) return { ok: false, reason: 'unknown-node', cost: 0, path: [] };
  if (allocated.includes(targetId)) {
    return { ok: false, reason: 'already-allocated', cost: 0, path: [] };
  }

  const taken = new Set(allocated);
  for (const excluded of node.excludes ?? []) {
    if (taken.has(excluded)) {
      return { ok: false, reason: 'excluded', cost: 0, path: [], blockedBy: excluded };
    }
  }

  const path = pathTo(allocated, targetId, graph);
  if (!path) return { ok: false, reason: 'unreachable', cost: 0, path: [] };
  if (path.length > pointsLeft) {
    return { ok: false, reason: 'not-enough-points', cost: path.length, path };
  }
  return { ok: true, cost: path.length, path };
}

/** Allocated nodes that would be cut off from the root if `removeId` were refunded. */
export function strandedAfterRemoval(allocated: string[], removeId: string, graph: TreeGraph): string[] {
  if (!allocated.includes(removeId)) return [];
  const remaining = allocated.filter((id) => id !== removeId);
  const reachable = new Set<string>([graph.rootId]);
  const queue = [graph.rootId];
  while (queue.length) {
    const current = queue.shift()!;
    for (const next of graph.adjacency.get(current) ?? []) {
      if (next === removeId) continue;
      if (!reachable.has(next) && (remaining.includes(next) || next === graph.rootId)) {
        reachable.add(next);
        queue.push(next);
      }
    }
  }
  return remaining.filter((id) => !reachable.has(id));
}

/**
 * Tarjan articulation points over the allocated subgraph (root included).
 * Refund Mode uses this to mark nodes that cannot be safely removed.
 */
export function getArticulationPoints(allocated: string[], graph: TreeGraph): string[] {
  const vertices = new Set<string>([graph.rootId, ...allocated]);
  const index = new Map<string, number>();
  const low = new Map<string, number>();
  const points = new Set<string>();
  let counter = 0;

  const visit = (id: string, parent: string | null, root: string) => {
    index.set(id, counter);
    low.set(id, counter);
    counter += 1;
    let children = 0;

    for (const next of graph.adjacency.get(id) ?? []) {
      if (!vertices.has(next)) continue;
      if (!index.has(next)) {
        children += 1;
        visit(next, id, root);
        low.set(id, Math.min(low.get(id)!, low.get(next)!));
        if (parent !== null && low.get(next)! >= index.get(id)!) points.add(id);
      } else if (next !== parent) {
        low.set(id, Math.min(low.get(id)!, index.get(next)!));
      }
    }

    if (parent === null && children > 1) points.add(root);
  };

  visit(graph.rootId, null, graph.rootId);
  return [...points].filter((id) => id !== graph.rootId).sort();
}

export function neighborCount(id: string, allocated: string[], graph: TreeGraph): number {
  const taken = new Set(allocated);
  return (graph.adjacency.get(id) ?? []).filter((n) => taken.has(n) || n === graph.rootId).length;
}
