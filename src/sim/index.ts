import { pathToFileURL } from 'node:url';
import type { DoctrineId, School } from '../data/types';
import { createCombat, tickCombat } from '../engine/combatEngine';
import { computePlayerStats } from '../engine/stats';
import { createInitialSave, createItem, makeGem } from '../game/state';
import type { CharacterSave } from '../game/types';

export interface BuildPreset {
  name: string;
  doctrine: DoctrineId;
  configure: (save: CharacterSave) => void;
}

export interface SimResult {
  build: string;
  tier: number;
  ticks: number;
  seconds: number;
  avgDps: number;
  totalDamage: number;
  schoolShare: Record<School, number>;
  ailmentUptimePct: number;
  deaths: number;
  kills: number;
  bossKills: number;
  killsPerHour: number;
  keysPerHour: number;
}

const SCHOOLS: School[] = ['physical', 'fire', 'frost', 'lightning', 'void'];

export const BUILD_PRESETS: BuildPreset[] = [
  {
    name: 'Blitz Dagger Poison',
    doctrine: 'blitz',
    configure: (save) => {
      save.level = 15;
      save.skillSlots = 6;
      save.doctrine = 'blitz';
      save.allocated = ['hub_0', 'sec_agility', 'ks_festering_wound'];
      const dagger = createItem('base_dagger', 'rare', 10, 'sim-blitz');
      dagger.sockets = [
        makeGem('gem_void_lance', 3, 'both'),
        makeGem('support_ailment_proliferation', 2, 'both'),
        makeGem('support_multistrike', 2, 'both'),
      ];
      dagger.linkedSockets = 3;
      save.equipment.main_hand = dagger;
      const chest = createItem('base_chest', 'magic', 10, 'sim-blitz-chest');
      chest.sockets = [makeGem('gem_cleave', 3, 'both'), null];
      chest.linkedSockets = 2;
      save.equipment.chest = chest;
    },
  },
  {
    name: 'Bastion Mace Thorns',
    doctrine: 'bastion',
    configure: (save) => {
      save.level = 15;
      save.skillSlots = 6;
      save.doctrine = 'bastion';
      save.allocated = ['hub_0', 'sec_fortitude', 'ks_lattice_skin'];
      const mace = createItem('base_mace_1h', 'rare', 10, 'sim-bastion');
      mace.sockets = [
        makeGem('gem_ward_barrier', 3, 'both'),
        makeGem('support_cast_when_damage_taken', 2, 'both'),
        makeGem('gem_cleave', 2, 'both'),
      ];
      mace.linkedSockets = 3;
      const shield = createItem('base_shield', 'rare', 10, 'sim-bastion-shield');
      shield.affixes = [
        { affixId: 'aff_thorns', tier: 4 },
        { affixId: 'aff_tempered', tier: 4 },
        { affixId: 'aff_vital', tier: 3 },
      ];
      const chest = createItem('base_chest', 'rare', 10, 'sim-bastion-chest');
      chest.affixes = [
        { affixId: 'aff_thorns', tier: 4 },
        { affixId: 'aff_tempered', tier: 4 },
        { affixId: 'aff_vital', tier: 3 },
      ];
      save.equipment.main_hand = mace;
      save.equipment.off_hand = shield;
      save.equipment.chest = chest;
    },
  },
  {
    name: 'Pendulum Dual-Bar Caster',
    doctrine: 'weaver',
    configure: (save) => {
      save.level = 15;
      save.skillSlots = 6;
      save.doctrine = 'weaver';
      save.allocated = ['hub_0', 'sec_wisdom', 'ks_pendulum'];
      const staff = createItem('base_staff', 'rare', 10, 'sim-pendulum');
      staff.sockets = [
        makeGem('gem_ember_bolt', 3, 'bar_1'),
        makeGem('gem_frost_shard', 3, 'bar_2'),
        makeGem('support_echo', 2, 'both'),
        makeGem('support_concussive', 2, 'both'),
        null,
        null,
      ];
      staff.linkedSockets = 4;
      save.equipment.main_hand = staff;
    },
  },
  {
    name: 'Hollow Fist Auto-Attacker',
    doctrine: 'tactician',
    configure: (save) => {
      save.level = 15;
      save.skillSlots = 6;
      save.doctrine = 'tactician';
      save.allocated = ['hub_0', 'sec_might', 'ks_hollow_fist'];
      const axe = createItem('base_axe_1h', 'rare', 10, 'sim-hollow');
      axe.affixes = [
        { affixId: 'aff_bloodletting', tier: 4 },
        { affixId: 'aff_sharp', tier: 4 },
        { affixId: 'aff_haste', tier: 3 },
        { affixId: 'aff_mighty', tier: 3 },
      ];
      axe.sockets = [
        makeGem('gem_cleave', 3, 'both'),
        makeGem('support_multistrike', 3, 'both'),
        makeGem('support_executioner', 2, 'both'),
      ];
      axe.linkedSockets = 3;
      save.equipment.main_hand = axe;
    },
  },
];

function simulatePreset(preset: BuildPreset, tier: number, ticks: number): SimResult {
  const save = createInitialSave(0);
  save.tier = tier;
  save.packSize = 3;
  preset.configure(save);
  const stats = computePlayerStats(save);

  const combat = createCombat({
    seed: 4242 + tier * 31,
    zoneId: 'zone_ashen_graveyard',
    tier,
    packSize: 3,
    doctrine: preset.doctrine,
    activeBar: 'bar_1',
    startingKeys: 0,
    autoSummonBoss: true,
    suppressRandomKeys: false,
    playerStats: stats,
  });

  const schoolDamage: Record<School, number> = {
    physical: 0,
    fire: 0,
    frost: 0,
    lightning: 0,
    void: 0,
  };
  let ailmentTicks = 0;

  for (let i = 0; i < ticks; i += 1) {
    tickCombat(combat);
    for (let j = combat.damageLog.length - 1; j >= 0; j -= 1) {
      const s = combat.damageLog[j]!;
      if (s.t < combat.time) break;
      if (s.t === combat.time && s.amount > 0) schoolDamage[s.school] += s.amount;
    }

    if (combat.enemies.some((e) => e.hp > 0 && Object.keys(e.ailments).length > 0)) {
      ailmentTicks += 1;
    }

    if (combat.status === 'victory') {
      combat.status = 'running';
      combat.bossDefeated = false;
      combat.tier = tier;
      combat.enemies = [];
    } else if (combat.tier !== tier && combat.status === 'running') {
      combat.tier = tier;
    }
  }

  const seconds = ticks * 0.1;
  const schoolSum = SCHOOLS.reduce((acc, s) => acc + schoolDamage[s], 0) || 1;
  const schoolShare = Object.fromEntries(
    SCHOOLS.map((s) => [s, Math.round((schoolDamage[s] / schoolSum) * 1000) / 10]),
  ) as Record<School, number>;

  return {
    build: preset.name,
    tier,
    ticks,
    seconds,
    avgDps: Math.round((combat.totalDamage / seconds) * 10) / 10,
    totalDamage: Math.round(combat.totalDamage),
    schoolShare,
    ailmentUptimePct: Math.round((ailmentTicks / ticks) * 1000) / 10,
    deaths: combat.rewards.deaths,
    kills: combat.rewards.kills,
    bossKills: combat.rewards.bossKills,
    killsPerHour: Math.round((combat.rewards.kills / seconds) * 3600),
    keysPerHour: Math.round((combat.rewards.keys / seconds) * 3600),
  };
}

export function runBalanceSim(ticks = 10_000): SimResult[] {
  const results: SimResult[] = [];
  for (const tier of [1, 3]) {
    for (const preset of BUILD_PRESETS) {
      results.push(simulatePreset(preset, tier, ticks));
    }
  }
  return results;
}

const isDirectRun =
  typeof process !== 'undefined' &&
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (isDirectRun) {
  const results = runBalanceSim(10_000);
  console.log('\n=== Path of Warbound — Balance Simulator (10,000 ticks / 1,000s per build) ===\n');
  for (const r of results) {
    const breakdown = SCHOOLS.filter((s) => r.schoolShare[s] > 0)
      .map((s) => `${s}:${r.schoolShare[s]}%`)
      .join(' ');
    console.log(
      `[T${r.tier}] ${r.build.padEnd(27)} | DPS: ${String(r.avgDps).padStart(6)} | Kills/hr: ${String(r.killsPerHour).padStart(5)} | Keys/hr: ${String(r.keysPerHour).padStart(4)} | Deaths: ${String(r.deaths).padStart(2)} | Ailment: ${String(r.ailmentUptimePct).padStart(5)}% | ${breakdown}`,
    );
  }
  console.log('');
}
