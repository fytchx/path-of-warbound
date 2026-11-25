import affixesJson from './affixes.json';
import doctrinesJson from './doctrines.json';
import gemsJson from './gems.json';
import itemsJson from './items.json';
import monstersJson from './monsters.json';
import priorityJson from './priority.json';
import progressionJson from './progression.json';
import sfxJson from './sfx.json';
import skillTreeJson from './skill_tree.json';
import statRegistryJson from './stat_registry.json';
import uniquesJson from './uniques.json';
import zonesJson from './zones.json';
import type {
  Affix,
  DoctrineDef,
  GemDef,
  ItemBase,
  MonsterDef,
  ProgressionEntry,
  PriorityVerbDef,
  Registries,
  SfxDef,
  SkillTree,
  StatRegistry,
  UniqueDef,
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
export const priorityVerbs = priorityJson as unknown as PriorityVerbDef[];
export const uniques = uniquesJson as unknown as UniqueDef[];
export const sfxDefs = sfxJson as unknown as SfxDef[];

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
  uniques,
  sfx: sfxDefs,
};

const byId = <T extends { id: string }>(list: T[]): Map<string, T> => new Map(list.map((entry) => [entry.id, entry]));

export const itemBaseById = byId(itemBases);
export const affixById = byId(affixes);
export const gemById = byId(gems);
export const monsterById = byId(monsters);
export const zoneById = byId(zones);
export const doctrineById = byId(doctrines);
export const uniqueById = byId(uniques);
export const sfxById = byId(sfxDefs);

export function sfxFileFor(id: string): string {
  return sfxById.get(id)?.file ?? `sfx/combat/${id}.ogg`;
}

export function nodeById(id: string) {
  return skillTree.nodes.find((node) => node.id === id);
}

export const keystones = skillTree.nodes.filter((node) => node.kind === 'keystone');
