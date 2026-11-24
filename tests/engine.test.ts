import { strict as assert } from 'node:assert';
import test from 'node:test';
import { resolveStat, runCombatTick } from '../src/engine/index.js';

test('stat pipeline applies flat, increased, and more in order', () => {
  const value = resolveStat({
    base: 10,
    flat: 5,
    increased: 0.5,
    more: 0.25,
  });

  assert.equal(value, 28.125);
});

test('combat tick clamps health at zero', () => {
  const result = runCombatTick(
    { name: 'Attacker', health: 100, damage: 30 },
    { name: 'Defender', health: 50, damage: 0 },
    2,
  );

  assert.equal(result.attackerDamage, 60);
  assert.equal(result.defenderHealth, 0);
});
