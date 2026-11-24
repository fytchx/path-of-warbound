import affixesJson from './affixes.json';
import doctrinesJson from './doctrines.json';
import gemsJson from './gems.json';
import itemsJson from './items.json';
import monstersJson from './monsters.json';
import progressionJson from './progression.json';
import skillTreeJson from './skill_tree.json';
import statRegistryJson from './stat_registry.json';
import zonesJson from './zones.json';
import type {
  Affix,
  DoctrineDef,
  GemDef,
  ItemBase,
  MonsterDef,
  ProgressionEntry,
  Registries,
  SkillTree,
  StatRegistry,
  ZoneDef,
} from './types';

export const statRegistry = statRegistryJson as unknown as StatRegistry;
export const itemBases = itemsJson as unknown as ItemBase[];
export const affixes = affixesJson as unknown as Affix[];
export const gems = gemsJson as unknown as GemDef[];
export const monsters = monstersJson as unknown as MonsterDef[];
export const zones = zonesJson as unknown as ZoneDef[];
export const doctrines = doctrinesJson as unknown as DoctrineDef[];
export const skillTree = skillTreeJson as unknown as SkillTree;
export const progression = progressionJson as unknown as ProgressionEntry[];

export const registries: Registries = {
  stats: statRegistry,
  items: itemBases,
  affixes,
  gems,
  monsters,
  zones,
  doctrines,
  tree: skillTree,
  progression,
};

const byId = <T extends { id: string }>(list: T[]): Map<string, T> => new Map(list.map((entry) => [entry.id, entry]));

export const itemBaseById = byId(itemBases);
export const affixById = byId(affixes);
export const gemById = byId(gems);
export const monsterById = byId(monsters);
export const zoneById = byId(zones);
export const doctrineById = byId(doctrines);

export function nodeById(id: string) {
  return skillTree.nodes.find((node) => node.id === id);
}

export const keystones = skillTree.nodes.filter((node) => node.kind === 'keystone');
