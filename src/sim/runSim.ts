import { pathToFileURL } from 'node:url';
import {
  TICK_SECONDS,
  createCombat,
  tickCombat,
  type CombatState,
  type DamageSource,
} from '../engine/combatEngine';
import { computePlayerStats } from '../engine/stats';
import { allocateNode, createInitialSave, createItem, makeGem } from '../game/state';
import type { CharacterSave, GemInstance, ItemInstance } from '../game/types';
import type { DoctrineId, ItemSlot } from '../data/types';

export const ZONE_ID = 'zone_ashen_graveyard';
export const PACK_SIZE = 3;
export const DEFAULT_TICKS = 10_000;
const GEAR_LEVEL = 60;

type Affix = ItemInstance['affixes'][number];

interface BuildSpec {
  name: string;
  doctrine: DoctrineId;
  level: number;
  gear: Array<{ slot: ItemSlot; baseId: string; gems?: GemInstance[]; affixes?: Affix[] }>;
  nodes: string[];
}

export interface SimTotals {
  build: string;
  doctrine: DoctrineId;
  tier: number;
  ticks: number;
  seconds: number;
  damage: number;
  dps: number;
  topSource: string;
  ailmentUptime: number;
  deaths: number;
  kills: number;
  killsPerHour: number;
  keys: number;
  keysPerHour: number;
  missingNodes: string[];
}

const gem = (gemId: string, bar: GemInstance['bar'] = 'both'): GemInstance => makeGem(gemId, 10, bar);

function gear(
  slot: ItemSlot,
  baseId: string,
  seed: string,
  gems: GemInstance[] = [],
  affixes: Affix[] = [],
): { slot: ItemSlot; baseId: string; gems: GemInstance[]; affixes: Affix[] } {
  return { slot, baseId, gems, affixes };
}

const thorns: Affix = { affixId: 'aff_thorns', tier: 5 };

export const BUILDS: BuildSpec[] = [
  {
    name: 'Blitz Dagger Poison',
    doctrine: 'blitz',
    level: GEAR_LEVEL,
    gear: [
      gear('main_hand', 'base_dagger', 'sim-blitz-dagger', [
        gem('gem_plague_skull'),
        gem('support_ailment_proliferation'),
        gem('support_multistrike'),
      ]),
      gear('off_hand', 'base_focus_orb', 'sim-blitz-orb', [gem('gem_bloodlust_aura'), gem('support_life_leech')]),
      gear('chest', 'base_chest', 'sim-blitz-chest'),
    ],
    nodes: [
      'p_agility_0_notable',
      'p_agility_1_notable',
      'p_agility_2_notable',
      'p_agility_3_notable',
      'p_wisdom_0_notable',
      'p_wisdom_1_notable',
      'p_wisdom_2_notable',
      'p_wisdom_3_notable',
      'ks_festering_wound',
      'ks_ghostframe',
    ],
  },
  {
    name: 'Bastion Mace Thorns',
    doctrine: 'bastion',
    level: GEAR_LEVEL,
    gear: [
      gear('main_hand', 'base_mace_1h', 'sim-bastion-mace', [
        gem('gem_cleave'),
        gem('support_concussive'),
        gem('support_executioner'),
      ]),
      gear('off_hand', 'base_shield', 'sim-bastion-shield', [gem('gem_ward_barrier'), gem('support_life_leech')], [thorns]),
      gear('chest', 'base_chest', 'sim-bastion-chest', [], [thorns]),
    ],
    nodes: [
      'p_fortitude_0_notable',
      'p_fortitude_1_notable',
      'p_fortitude_2_notable',
      'p_fortitude_3_notable',
      'p_might_0_notable',
      'p_might_1_notable',
      'ks_lattice_skin',
      'ks_zealots_mandate',
    ],
  },
  {
    name: 'Pendulum Dual-Bar Caster',
    doctrine: 'weaver',
    level: GEAR_LEVEL,
    gear: [
      gear('main_hand', 'base_staff', 'sim-pendulum-staff', [
        gem('gem_ember_bolt', 'bar_1'),
        gem('support_school_shift'),
        gem('support_echo'),
      ]),
      gear('chest', 'base_chest', 'sim-pendulum-chest', [
        gem('gem_void_lance', 'bar_2'),
        gem('support_pierce'),
        gem('gem_ward_barrier'),
      ]),
    ],
    nodes: [
      'p_might_0_notable',
      'p_might_1_notable',
      'p_might_2_notable',
      'p_might_3_notable',
      'p_wisdom_0_notable',
      'p_wisdom_1_notable',
      'p_wisdom_2_notable',
      'p_wisdom_3_notable',
      'ks_pendulum',
      'ks_void_tithe',
    ],
  },
  {
    name: 'Hollow Fist Auto-Attacker',
    doctrine: 'tactician',
    level: GEAR_LEVEL,
    gear: [
      gear('main_hand', 'base_axe_1h', 'sim-hollow-axe', [
        gem('gem_cleave'),
        gem('support_multistrike'),
        gem('support_executioner'),
      ]),
      gear('off_hand', 'base_focus_orb', 'sim-hollow-orb', [gem('support_ailment_proliferation')]),
      gear('chest', 'base_chest', 'sim-hollow-chest'),
    ],
    nodes: [
      'p_might_0_notable',
      'p_might_1_notable',
      'p_might_2_notable',
      'p_might_3_notable',
      'p_agility_0_notable',
      'p_agility_1_notable',
      'p_agility_2_notable',
      'p_agility_3_notable',
      'ks_hollow_fist',
    ],
  },
];

export function buildSave(build: BuildSpec): CharacterSave {
  const save = createInitialSave(0);
  save.level = build.level;
  save.xp = 0;
  save.doctrine = build.doctrine;
  save.zoneId = ZONE_ID;
  save.packSize = PACK_SIZE;
  save.tier = 1;
  save.allocated = ['hub_0'];
  save.settings = { ...save.settings, logCombat: false };
  save.equipment = {};

  for (const entry of build.gear) {
    const item = createItem(entry.baseId, 'rare', GEAR_LEVEL, `${entry.baseId}:${save.level}`);
    const sockets = [...item.sockets];
    const itemGems = entry.gems ?? [];
    const itemAffixes = entry.affixes ?? [];
    itemGems.forEach((socketGem, index) => {
      if (index < sockets.length) sockets[index] = socketGem;
    });
    save.equipment[entry.slot] = {
      ...item,
      sockets,
      affixes: itemAffixes.length > 0 ? [...itemAffixes, ...item.affixes].slice(0, item.affixes.length) : item.affixes,
    };
  }

  for (const nodeId of build.nodes) allocateNode(save, nodeId);
  return save;
}

function missingNodes(save: CharacterSave, build: BuildSpec): string[] {
  return build.nodes.filter((id) => !save.allocated.includes(id));
}

const SOURCE_LABELS: Record<DamageSource, string> = {
  auto: 'Auto-attack',
  skill: 'Skills',
  ailment: 'Ailments',
  thorns: 'Thorns',
};

function startCombat(save: CharacterSave, tier: number, seed: number): CombatState {
  return createCombat({
    seed,
    zoneId: ZONE_ID,
    tier,
    packSize: PACK_SIZE,
    doctrine: save.doctrine,
    playerStats: computePlayerStats(save),
    activeBar: save.activeBar,
    startingKeys: 0,
  });
}

export function simulateBuild(build: BuildSpec, tier: number, ticks = DEFAULT_TICKS): SimTotals {
  const save = buildSave(build);
  let state = startCombat(save, tier, 0);
  const damageBySource = new Map<DamageSource, number>();
  let damage = 0;
  let kills = 0;
  let deaths = 0;
  let keys = 0;
  let ailmentTicks = 0;
  let simulated = 0;
  let segments = 1;

  while (simulated < ticks) {
    tickCombat(state);
    simulated += 1;

    for (const sample of state.damageLog.splice(0)) {
      if (sample.amount <= 0) continue;
      damage += sample.amount;
      const source = sample.source ?? 'skill';
      damageBySource.set(source, (damageBySource.get(source) ?? 0) + sample.amount);
    }
    if (state.enemies.some((enemy) => enemy.hp > 0 && Object.keys(enemy.ailments).length > 0)) ailmentTicks += 1;

    if (state.status === 'victory') {
      kills += state.rewards.kills;
      deaths += state.rewards.deaths;
      keys += state.rewards.keys;
      segments += 1;
      state = startCombat(save, tier, segments);
    }
  }
  kills += state.rewards.kills;
  deaths += state.rewards.deaths;
  keys += state.rewards.keys;

  const seconds = simulated * TICK_SECONDS;
  const top = [...damageBySource.entries()].sort((a, b) => b[1] - a[1])[0];
  const topShare = top && damage > 0 ? (top[1] / damage) * 100 : 0;
  const topSource = top ? `${SOURCE_LABELS[top[0]]} (${topShare.toFixed(1)}%)` : '—';

  return {
    build: build.name,
    doctrine: build.doctrine,
    tier,
    ticks: simulated,
    seconds,
    damage,
    dps: damage / seconds,
    topSource,
    ailmentUptime: simulated > 0 ? (ailmentTicks / simulated) * 100 : 0,
    deaths,
    kills,
    killsPerHour: seconds > 0 ? (kills / seconds) * 3600 : 0,
    keys,
    keysPerHour: seconds > 0 ? (keys / seconds) * 3600 : 0,
    missingNodes: missingNodes(save, build),
  };
}

export interface SimOptions {
  ticks?: number;
  tiers?: number[];
}

export function runSimulation(options: SimOptions = {}): SimTotals[] {
  const ticks = Math.max(1, Math.floor(options.ticks ?? DEFAULT_TICKS));
  const tiers = options.tiers ?? [1, 3];
  const rows: SimTotals[] = [];
  for (const build of BUILDS) {
    for (const tier of tiers) rows.push(simulateBuild(build, tier, ticks));
  }
  return rows;
}

function pad(value: string, width: number): string {
  return value.length >= width ? value : value + ' '.repeat(width - value.length);
}

export function formatTable(rows: SimTotals[]): string {
  const header = ['Build', 'Tier', 'Avg DPS', 'Top Damage Source', 'Ailment %', 'Deaths', 'Kills/hr', 'Keys/hr'];
  const data = rows.map((row) => [
    row.build,
    `T${row.tier}`,
    row.dps.toFixed(0),
    row.topSource,
    `${row.ailmentUptime.toFixed(1)}%`,
    String(row.deaths),
    row.killsPerHour.toFixed(1),
    row.keysPerHour.toFixed(2),
  ]);
  const widths = header.map((cell, index) => Math.max(cell.length, ...data.map((line) => (line[index] ?? '').length)));
  const line = (cells: string[]) => cells.map((cell, index) => pad(cell, widths[index] ?? 0)).join('  ');
  const rule = widths.map((width) => '-'.repeat(width)).join('  ');
  return [line(header), rule, ...data.map(line)].join('\n');
}

function main(): void {
  const started = Date.now();
  const rows = runSimulation();
  console.log(`Path of Warbound headless simulator — ${ZONE_ID}, pack ${PACK_SIZE}, ${DEFAULT_TICKS} ticks (${(DEFAULT_TICKS * TICK_SECONDS).toFixed(0)}s) per build/tier\n`);
  console.log(formatTable(rows));
  const warnings = rows.filter((row) => row.missingNodes.length > 0);
  if (warnings.length > 0) {
    console.log('\nUnallocated targets (tree path or point budget):');
    for (const row of warnings) console.log(`- ${row.build}: ${row.missingNodes.join(', ')}`);
  }
  console.log(`\nDone in ${((Date.now() - started) / 1000).toFixed(1)}s`);
}

const entry = process.argv[1] ? pathToFileURL(process.argv[1]).href : '';
if (import.meta.url === entry) main();
