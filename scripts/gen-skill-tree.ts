import { writeFileSync } from 'node:fs';
import type { StatMod, TreeNode } from '../src/data/types';

const DEG = Math.PI / 180;
const pos = (r: number, deg: number) => ({
  x: Math.round(Math.cos(deg * DEG) * r * 10) / 10,
  y: Math.round(Math.sin(deg * DEG) * r * 1.15 * 10) / 10,
});

type Sector = 'might' | 'agility' | 'wisdom' | 'fortitude';
const sectors: { id: Sector; angle: number }[] = [
  { id: 'might', angle: -90 },
  { id: 'agility', angle: 0 },
  { id: 'wisdom', angle: 90 },
  { id: 'fortitude', angle: 180 },
];

const core = (stat: string, value: number): StatMod => ({ stat, layer: 'flat', value });
const inc = (stat: string, value: number): StatMod => ({ stat, layer: 'increased', value });

const minorMods: Record<Sector, StatMod[]> = {
  might: [core('might', 6)],
  agility: [core('agility', 6)],
  wisdom: [core('wisdom', 6)],
  fortitude: [core('fortitude', 6)],
};

const notableMods: Record<Sector, StatMod[]> = {
  might: [core('might', 14), inc('dmg_physical', 12)],
  agility: [core('agility', 14), inc('attack_speed', 8)],
  wisdom: [core('wisdom', 14), inc('ailment_potency', 15)],
  fortitude: [core('fortitude', 14), inc('max_hp', 10)],
};

const notableNames: Record<Sector, string[]> = {
  might: ['Executioner\'s Poise', 'Warborn Sinew', 'Sunder Grip', 'Red Remembrance'],
  agility: ['Ghost Step', 'Quickened Pulse', 'Hunters\' Cadence', 'Flicker Guard'],
  wisdom: ['Deep Well', 'Runic Patience', 'Ward Whisper', 'Bitter Insight'],
  fortitude: ['Grave Stance', 'Bulwark Blood', 'Unbroken Ribs', 'Thorn Mantle'],
};

const keystoneData = [
  {
    id: 'ks_pendulum',
    name: 'Pendulum',
    sector: 'might' as Sector,
    assetId: 'ks_pendulum' as const,
    excludes: ['ks_hollow_fist'],
    description: 'Auto-swaps skill bars every 5s; 30% more damage for 3s after a swap. Manual swapping disabled.',
  },
  {
    id: 'ks_hollow_fist',
    name: 'Hollow Fist',
    sector: 'might' as Sector,
    assetId: 'ks_hollow_fist' as const,
    excludes: ['ks_pendulum'],
    description: 'Weapon auto-attack implicits are doubled and deal 40% more damage. Active skills deal 25% less and cost 50% more mana.',
  },
  {
    id: 'ks_ghostframe',
    name: 'Ghostframe',
    sector: 'agility' as Sector,
    assetId: 'ks_ghostframe' as const,
    excludes: ['ks_lattice_skin'],
    description: 'Dodge Rating cap is doubled. Dodging releases a Thorns burst equal to 15% of Dodge Rating. Max HP -40%.',
  },
  {
    id: 'ks_crowd_sovereign',
    name: 'Crowd Sovereign',
    sector: 'agility' as Sector,
    assetId: 'ks_crowd_sovereign' as const,
    excludes: ['ks_zealots_mandate'],
    description: 'Pack Size is forced to at least 4. 25% more damage and 15% more damage taken per enemy, up to 5. Elite chance doubled.',
  },
  {
    id: 'ks_festering_wound',
    name: 'Festering Wound',
    sector: 'wisdom' as Sector,
    assetId: 'ks_festering_wound' as const,
    excludes: ['ks_void_tithe'],
    description: 'Ailments stack up to 3 instances at 40% potency each. Ailment duration -30%.',
  },
  {
    id: 'ks_void_tithe',
    name: 'Void Tithe',
    sector: 'wisdom' as Sector,
    assetId: 'ks_void_tithe' as const,
    excludes: ['ks_festering_wound'],
    description: '50% of Physical damage is converted to Void. Corruption potency +50%. Take self-Corruption: 3% max HP over 5s, ward-absorbable.',
  },
  {
    id: 'ks_lattice_skin',
    name: 'Lattice Skin',
    sector: 'fortitude' as Sector,
    assetId: 'ks_lattice_skin' as const,
    excludes: ['ks_ghostframe'],
    description: 'Armor no longer mitigates. Gain max Ward equal to 60% of Armor. Ward delay fixed at 2.0s.',
  },
  {
    id: 'ks_zealots_mandate',
    name: "Zealot's Mandate",
    sector: 'fortitude' as Sector,
    assetId: 'ks_zealots_mandate' as const,
    excludes: ['ks_crowd_sovereign'],
    description: 'Locked to your chosen Doctrine, doubling its perks and weights. The other four Doctrines are disabled.',
  },
];

const nodes: TreeNode[] = [];
const edges: [string, string][] = [];
const addEdge = (a: string, b: string) => edges.push([a, b]);

nodes.push({
  id: 'hub_0',
  name: 'Soul-Spark',
  kind: 'hub',
  sector: 'core',
  ...pos(0, 0),
  x: 0,
  y: 0,
  mods: [core('might', 4), core('agility', 4), core('wisdom', 4), core('fortitude', 4)],
  description: 'The spark that binds. All paths begin here.',
});

const notableIndex: Record<Sector, { id: string; angle: number }[]> = {
  might: [],
  agility: [],
  wisdom: [],
  fortitude: [],
};

for (const sector of sectors) {
  const ringId = `sec_${sector.id}`;
  nodes.push({
    id: ringId,
    name: `${sector.id[0]!.toUpperCase()}${sector.id.slice(1)} Ring`,
    kind: 'minor',
    sector: sector.id,
    ...pos(44, sector.angle),
    mods: [core(sector.id, 10)],
    description: `A ring of ${sector.id} carved into the tree's first tier.`,
  });
  addEdge('hub_0', ringId);

  // Two side minor nodes per sector keep the ring from being a single corridor.
  for (const offset of [-13, 13]) {
    const sideId = `sec_${sector.id}_side_${offset > 0 ? 'r' : 'l'}`;
    nodes.push({
      id: sideId,
      name: `${sector.id} Sigil`,
      kind: 'minor',
      sector: sector.id,
      ...pos(74, sector.angle + offset),
      mods: [minorMods[sector.id][0]!, inc('max_ward', 4)],
      description: `Minor ${sector.id} and ward node.`,
    });
    addEdge(ringId, sideId);
  }

  const petalAngles = [sector.angle - 27, sector.angle - 9, sector.angle + 9, sector.angle + 27];
  petalAngles.forEach((angle, i) => {
    const base = `p_${sector.id}_${i}`;
    const entryId = `${base}_entry`;
    const leftId = `${base}_l`;
    const rightId = `${base}_r`;
    const notableId = `${base}_notable`;

    nodes.push({
      id: entryId,
      name: `${sector.id} Minor`,
      kind: 'minor',
      sector: sector.id,
      ...pos(64, angle),
      mods: minorMods[sector.id],
      description: `Tier one ${sector.id}.`,
    });
    nodes.push({
      id: leftId,
      name: `${sector.id} Minor`,
      kind: 'minor',
      sector: sector.id,
      ...pos(88, angle - 4),
      mods: [minorMods[sector.id][0]!, inc(`dmg_${sector.id === 'might' ? 'physical' : 'void'}`, 4)],
      description: `A branching ${sector.id} minor.`,
    });
    nodes.push({
      id: rightId,
      name: `${sector.id} Minor`,
      kind: 'minor',
      sector: sector.id,
      ...pos(88, angle + 4),
      mods: [minorMods[sector.id][0]!, inc('max_hp', 4)],
      description: `A branching ${sector.id} minor.`,
    });
    nodes.push({
      id: notableId,
      name: notableNames[sector.id][i]!,
      kind: 'notable',
      sector: sector.id,
      ...pos(118, angle),
      mods: notableMods[sector.id],
      description: `Notable. ${notableNames[sector.id][i]} empowers ${sector.id}.`,
    });

    addEdge(ringId, entryId);
    addEdge(entryId, leftId);
    addEdge(entryId, rightId);
    addEdge(leftId, notableId);
    addEdge(rightId, notableId);
    notableIndex[sector.id].push({ id: notableId, angle });
  });

  const keystones = keystoneData.filter((k) => k.sector === sector.id);
  keystones.forEach((k, i) => {
    const angle = sector.angle + (i === 0 ? -40 : 40);
    nodes.push({
      id: k.id,
      name: k.name,
      kind: 'keystone',
      sector: sector.id,
      ...pos(168, angle),
      mods: [],
      assetId: k.assetId,
      excludes: k.excludes,
      description: k.description,
    });
    const target = notableIndex[sector.id][i === 0 ? 0 : 3]!;
    addEdge(target.id, k.id);
  });
}

// Six jewel sockets between the sectors, each hanging off the nearest notable.
const socketAngles = [-45, 45, 135, 225, 0, 180];
socketAngles.forEach((angle, i) => {
  const id = `socket_${i}`;
  nodes.push({
    id,
    name: 'Jewel Socket',
    kind: 'socket',
    sector: 'core',
    ...pos(150, angle),
    mods: [],
    description: 'A socket for a support gem. Socketing a gem here applies its modifiers loadout-wide.',
  });
  const candidates = Object.entries(notableIndex).flatMap(([, list]) =>
    list.map((n) => ({ ...n, dist: Math.abs(((n.angle - angle + 540) % 360) - 180) })),
  );
  candidates.sort((a, b) => a.dist - b.dist);
  addEdge(candidates[0]!.id, id);
});

if (nodes.length !== 91) {
  throw new Error(`expected 91 nodes, got ${nodes.length}`);
}

const ids = new Set(nodes.map((n) => n.id));
for (const [a, b] of edges) {
  if (!ids.has(a) || !ids.has(b)) throw new Error(`dangling edge ${a} -> ${b}`);
}

const tree = {
  version: '0.1.0',
  rootId: 'hub_0',
  nodes,
  edges,
};

writeFileSync('src/data/skill_tree.json', `${JSON.stringify(tree, null, 2)}\n`);
console.log(`skill_tree.json written: ${nodes.length} nodes, ${edges.length} edges`);
