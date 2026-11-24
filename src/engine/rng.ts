/** Deterministic, serialisable RNG (mulberry32) — no Math.random in the engine. */
export function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function rollBetween(rng: () => number, min: number, max: number): number {
  return min + rng() * (max - min);
}

export function pickOne<T>(rng: () => number, list: readonly T[]): T {
  if (!list.length) throw new Error('pickOne: empty list');
  return list[Math.floor(rng() * list.length)]!;
}

export function chance(rng: () => number, probability: number): boolean {
  return rng() < probability;
}
