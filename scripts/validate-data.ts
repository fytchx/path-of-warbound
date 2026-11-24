import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import affixes from '../src/data/affixes.json';
import doctrines from '../src/data/doctrines.json';
import gems from '../src/data/gems.json';
import items from '../src/data/items.json';
import monsters from '../src/data/monsters.json';
import progression from '../src/data/progression.json';
import tree from '../src/data/skill_tree.json';
import statRegistry from '../src/data/stat_registry.json';
import zones from '../src/data/zones.json';

type Asset = { id: string; file: string; category: string; w: number; h: number };
type Manifest = { version: string; count: number; assets: Asset[] };
type Json = Record<string, unknown>;

const failures: string[] = [];
const fail = (msg: string) => failures.push(msg);

const manifest = JSON.parse(readFileSync('assets/manifest.json', 'utf8')) as Manifest;
const assetIds = new Set(manifest.assets.map((a) => a.id));
const stats = statRegistry.stats as Record<string, { category: string }>;
const statIds = new Set(Object.keys(stats));

// 1. Manifest integrity: count, unique ids, files present at non-zero size.
if (manifest.count !== manifest.assets.length) {
  fail(`manifest count ${manifest.count} != assets.length ${manifest.assets.length}`);
}
if (assetIds.size !== manifest.assets.length) fail('manifest contains duplicate ids');
for (const asset of manifest.assets) {
  if (!existsSync(asset.file)) {
    fail(`missing asset file: ${asset.file}`);
    continue;
  }
  if (statSync(asset.file).size === 0) fail(`empty asset file: ${asset.file}`);
  if (!(asset.w > 0 && asset.h > 0)) fail(`bad dimensions for ${asset.id}`);
}

// 2. Every assetId referenced by data exists in the manifest.
const refs: { where: string; id: string }[] = [];
const scanAssetRefs = (value: unknown, where: string) => {
  if (Array.isArray(value)) {
    value.forEach((entry, i) => scanAssetRefs(entry, `${where}[${i}]`));
    return;
  }
  if (value && typeof value === 'object') {
    for (const [key, child] of Object.entries(value as Json)) {
      if (key === 'assetId' && typeof child === 'string') refs.push({ where, id: child });
      else scanAssetRefs(child, `${where}.${key}`);
    }
  }
};

const dataFiles: [string, unknown][] = [
  ['items', items],
  ['affixes', affixes],
  ['gems', gems],
  ['monsters', monsters],
  ['zones', zones],
  ['doctrines', doctrines],
  ['skill_tree', tree],
];
dataFiles.forEach(([name, data]) => scanAssetRefs(data, name));
for (const ref of refs) {
  if (!assetIds.has(ref.id)) fail(`${ref.where}: unknown assetId "${ref.id}"`);
}

// 3. Every stat referenced exists in the registry.
const collectStats = (mods: unknown, where: string) => {
  if (!Array.isArray(mods)) return;
  for (const mod of mods as { stat?: string; layer?: string }[]) {
    if (!mod.stat) {
      fail(`${where}: modifier without a stat`);
      continue;
    }
    if (!statIds.has(mod.stat)) fail(`${where}: unknown stat "${mod.stat}"`);
    if (!['flat', 'increased', 'more'].includes(mod.layer ?? '')) {
      fail(`${where}: bad layer "${String(mod.layer)}"`);
    }
  }
};

items.forEach((item) => collectStats(item.implicit, `items.${item.id}.implicit`));
affixes.forEach((affix) => {
  if (!statIds.has(affix.stat)) fail(`affixes.${affix.id}: unknown stat "${affix.stat}"`);
  if (affix.values.length !== 5) fail(`affixes.${affix.id}: expected 5 tiers`);
  if (affix.values.some((v, i) => i > 0 && v <= affix.values[i - 1]!)) {
    fail(`affixes.${affix.id}: tier values must increase`);
  }
});
gems.forEach((gem) => collectStats(gem.mods, `gems.${gem.id}.mods`));
(tree.nodes as { id: string; kind: string; mods: unknown; excludes?: string[] }[]).forEach((node) => {
  collectStats(node.mods, `skill_tree.${node.id}.mods`);
});

// 4. Conversions are forward-only and ordered.
const order: Record<number, string[]> = {
  1: ['might', 'agility', 'wisdom', 'fortitude', 'armor', 'max_ward', 'dodge_rating'],
  2: ['dmg_physical', 'dmg_fire', 'dmg_frost', 'dmg_lightning', 'dmg_void'],
};
for (const conv of statRegistry.conversions) {
  const list = order[conv.pass];
  if (!list) {
    fail(`conversion ${conv.from}->${conv.to}: unknown pass ${conv.pass}`);
    continue;
  }
  const fromIndex = list.indexOf(conv.from);
  const toIndex = list.indexOf(conv.to);
  if (fromIndex === -1 || toIndex === -1) {
    fail(`conversion ${conv.from}->${conv.to}: endpoints outside pass ${conv.pass} order`);
  } else if (toIndex <= fromIndex) {
    fail(`conversion ${conv.from}->${conv.to} is not forward-only`);
  }
  if (conv.percent < 0 || conv.percent > 100) fail(`conversion ${conv.from}->${conv.to}: percent out of range`);
}

// 5. Skill tree: unique ids, valid symmetric edges, connected, exclusions symmetric.
const nodes = tree.nodes as { id: string; kind: string; assetId?: string; excludes?: string[] }[];
const nodeIds = new Set<string>();
for (const node of nodes) {
  if (nodeIds.has(node.id)) fail(`skill_tree: duplicate node "${node.id}"`);
  nodeIds.add(node.id);
}
const edges = tree.edges as [string, string][];
const seenEdges = new Set<string>();
const adjacency = new Map<string, Set<string>>();
for (const [a, b] of edges) {
  if (a === b) fail(`skill_tree: self edge ${a}`);
  if (!nodeIds.has(a) || !nodeIds.has(b)) fail(`skill_tree: dangling edge ${a} -> ${b}`);
  const key = [a, b].sort().join('|');
  if (seenEdges.has(key)) fail(`skill_tree: duplicate edge ${a} -> ${b}`);
  seenEdges.add(key);
  if (!adjacency.has(a)) adjacency.set(a, new Set());
  if (!adjacency.has(b)) adjacency.set(b, new Set());
  adjacency.get(a)!.add(b);
  adjacency.get(b)!.add(a);
}
const visited = new Set<string>([tree.rootId]);
const queue = [tree.rootId];
while (queue.length) {
  const current = queue.shift()!;
  for (const next of adjacency.get(current) ?? []) {
    if (!visited.has(next)) {
      visited.add(next);
      queue.push(next);
    }
  }
}
if (visited.size !== nodes.length) fail(`skill_tree: ${nodes.length - visited.size} node(s) unreachable from ${tree.rootId}`);

for (const node of nodes) {
  for (const excluded of node.excludes ?? []) {
    const other = nodes.find((n) => n.id === excluded);
    if (!other) fail(`skill_tree.${node.id}: excludes unknown node "${excluded}"`);
    else if (!(other.excludes ?? []).includes(node.id)) {
      fail(`skill_tree: exclusion ${node.id} -> ${other.id} is not symmetric`);
    }
  }
}
if (nodes.filter((n) => n.kind === 'keystone').length !== 8) fail('skill_tree: expected 8 keystones');
if (nodes.filter((n) => n.kind === 'socket').length !== 6) fail('skill_tree: expected 6 jewel sockets');

// 6. Items cover every equipment slot with 1-2 bases, and sockets fit their slot.
const slots = new Set([
  'main_hand', 'off_hand', 'amulet', 'helmet', 'trinket', 'gloves', 'chest', 'ring_1', 'boots', 'legs', 'ring_2',
]);
const slotCount = new Map<string, number>();
const maxSockets: Record<string, number> = {
  main_hand: 6, off_hand: 3, amulet: 1, helmet: 4, trinket: 1, gloves: 4, chest: 6, ring_1: 1, ring_2: 1, boots: 4, legs: 4,
};
for (const item of items) {
  if (!slots.has(item.slot)) fail(`items.${item.id}: invalid slot "${item.slot}"`);
  const group = item.slot.startsWith('ring') ? 'ring' : item.slot;
  slotCount.set(group, (slotCount.get(group) ?? 0) + 1);
  if (item.sockets > (maxSockets[item.slot] ?? 0)) fail(`items.${item.id}: too many sockets`);
  if (item.slot === 'main_hand' && !item.weapon) fail(`items.${item.id}: main hand without weapon profile`);
}
for (const slot of slots) {
  const group = slot.startsWith('ring') ? 'ring' : slot;
  const count = slotCount.get(group) ?? 0;
  const limit = group === 'main_hand' ? 9 : group === 'trinket' ? 3 : 2;
  if (count < 1 || count > limit) fail(`items: slot ${group} has ${count} base(s), expected 1-${limit}`);
}

// 7. Gems: actives have damage, supports have a support rule, all have plain-English descriptions.
for (const gem of gems) {
  if (gem.kind === 'active' && !gem.damage) fail(`gems.${gem.id}: active gem without damage profile`);
  if (gem.kind === 'support' && !gem.support) fail(`gems.${gem.id}: support gem without support rule`);
  if (!gem.description || !gem.description.trim()) fail(`gems.${gem.id}: missing description`);
}
for (const item of items) {
  if (!item.description || !item.description.trim()) fail(`items.${item.id}: missing description`);
}
for (const doctrine of doctrines) {
  if (!doctrine.description || !doctrine.description.trim()) fail(`doctrines.${doctrine.id}: missing description`);
}
for (const [statId, def] of Object.entries(statRegistry.stats as Record<string, { description?: string }>)) {
  if (!def.description || !def.description.trim()) fail(`stat_registry.${statId}: missing description`);
}
for (const node of tree.nodes as { id: string; description?: string }[]) {
  if (!node.description || !node.description.trim()) fail(`skill_tree.${node.id}: missing description`);
}

// 8. Zones and monsters.
const monsterIds = new Set(monsters.map((m) => m.id));
for (const zone of zones) {
  if (!assetIds.has(zone.assetId)) fail(`zones.${zone.id}: unknown backdrop`);
  if (zone.tiers !== 10) fail(`zones.${zone.id}: expected 10 tiers`);
  zone.monsterIds.forEach((id) => {
    if (!monsterIds.has(id)) fail(`zones.${zone.id}: unknown monster "${id}"`);
  });
}
if (zones.length !== 3) fail(`expected 3 zones, found ${zones.length}`);
if (doctrines.length !== 5) fail(`expected 5 doctrines, found ${doctrines.length}`);

// 9. Progression: unique ids, valid triggers, valid granted gem ids and system ids.
const gemIds = new Set(gems.map((g) => g.id));
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
const progressionIds = new Set<string>();
if (!Array.isArray(progression) || progression.length === 0) {
  fail('progression: expected at least 1 entry');
} else {
  for (const entry of progression as {
    id?: string;
    trigger?: { level?: number; event?: string };
    grants?: { skillSlot?: number; gem?: string; unlockedSystems?: string[] };
  }[]) {
    if (!entry.id) {
      fail('progression: entry missing id');
      continue;
    }
    if (progressionIds.has(entry.id)) fail(`progression: duplicate id "${entry.id}"`);
    progressionIds.add(entry.id);

    const hasLevel = typeof entry.trigger?.level === 'number';
    const hasEvent = typeof entry.trigger?.event === 'string';
    if (hasLevel === hasEvent) {
      fail(`progression.${entry.id}: trigger must specify either level or event`);
    } else if (hasLevel && (!Number.isInteger(entry.trigger!.level) || entry.trigger!.level! < 1)) {
      fail(`progression.${entry.id}: trigger level must be an integer >= 1`);
    } else if (hasEvent && entry.trigger!.event !== 'first_death') {
      fail(`progression.${entry.id}: unknown trigger event "${entry.trigger!.event}"`);
    }

    if (entry.grants?.gem && !gemIds.has(entry.grants.gem)) {
      fail(`progression.${entry.id}: unknown granted gem "${entry.grants.gem}"`);
    }
    if (entry.grants?.skillSlot !== undefined && (!Number.isInteger(entry.grants.skillSlot) || entry.grants.skillSlot <= 0)) {
      fail(`progression.${entry.id}: skillSlot grant must be a positive integer`);
    }
    for (const sys of entry.grants?.unlockedSystems ?? []) {
      if (!validSystems.has(sys)) fail(`progression.${entry.id}: unknown unlockedSystem "${sys}"`);
    }
  }
}

if (failures.length) {
  console.error(`validate-data: ${failures.length} problem(s)\n`);
  failures.forEach((msg) => console.error(`  - ${msg}`));
  process.exit(1);
}

console.log(
  `validate-data: OK — ${manifest.assets.length} assets, ${items.length} bases, ${affixes.length} affixes, ` +
    `${gems.length} gems, ${monsters.length} monsters, ${zones.length} zones, ${nodes.length} tree nodes, ${edges.length} edges, ${progression.length} progression entries`,
);
