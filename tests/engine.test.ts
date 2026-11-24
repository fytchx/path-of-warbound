import { describe, expect, it } from 'vitest';
import { resolveStat, runCombatTick } from '../src/engine/index';

describe('engine characterisation (preserved from the pre-migration suite)', () => {
  it('stat pipeline applies flat, increased, and more in order', () => {
    const value = resolveStat({ base: 10, flat: 5, increased: 0.5, more: 0.25 });
    expect(value).toBe(28.125);
  });

  it('combat tick applies damage and clamps defender health at zero', () => {
    const result = runCombatTick({ name: 'Attacker', health: 100, damage: 60 }, { name: 'Defender', health: 45, damage: 0 }, 1);
    expect(result.attackerDamage).toBe(60);
    expect(result.defenderHealth).toBe(0);
  });
});
