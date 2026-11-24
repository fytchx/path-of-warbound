import { runCombatTick } from '../engine/index.js';

const attacker = { name: 'Warbound', health: 100, damage: 12 };
const defender = { name: 'Khorvath Wraith', health: 100, damage: 0 };

const result = runCombatTick(attacker, defender, 5);

console.log(`Attacker: ${attacker.name}`);
console.log(`Defender: ${defender.name}`);
console.log(`Ticks: ${result.ticks}`);
console.log(`Damage: ${result.attackerDamage}`);
console.log(`Remaining health: ${result.defenderHealth}`);
