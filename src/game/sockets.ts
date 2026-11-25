import type { Attribute, GemColor, ItemBase, SocketColor } from '../data/types';

export const SOCKET_COLORS: SocketColor[] = ['red', 'green', 'blue', 'white'];

const WEIGHTS: Record<Attribute, Record<SocketColor, number>> = {
  might: { red: 70, green: 12, blue: 12, white: 6 },
  agility: { red: 12, green: 70, blue: 12, white: 6 },
  wisdom: { red: 12, green: 12, blue: 70, white: 6 },
  fortitude: { red: 23, green: 23, blue: 23, white: 8 },
  hybrid: { red: 23, green: 23, blue: 23, white: 8 },
};

/** A coloured gem fits its own colour or a Prismatic (white) socket. A white gem fits any socket. */
export function gemFitsSocket(gem: GemColor, socket: SocketColor): boolean {
  if (gem === 'white') return true;
  return socket === 'white' || gem === socket;
}

export function baseAttribute(base: ItemBase): Attribute {
  if (base.attribute) return base.attribute;
  const tags = base.slotTags;
  if (tags.includes('staff') || tags.includes('wand') || tags.includes('focus') || tags.includes('trinket')) return 'wisdom';
  if (tags.includes('dagger') || tags.includes('bow') || tags.includes('quiver') || tags.includes('boots')) return 'agility';
  if (tags.includes('shield') || tags.includes('armour') || tags.includes('chest') || tags.includes('legs')) return 'fortitude';
  if (tags.includes('sword') || tags.includes('mace') || tags.includes('axe') || tags.includes('helmet') || tags.includes('gloves')) return 'might';
  return 'hybrid';
}

export function rollSocketColors(
  attribute: Attribute,
  count: number,
  rng: () => number,
  avoid?: SocketColor[],
): SocketColor[] {
  const weights = WEIGHTS[attribute] ?? WEIGHTS.hybrid;
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const colors: SocketColor[] = [];
    for (let i = 0; i < count; i += 1) {
      let roll = rng() * 100;
      let picked: SocketColor = 'red';
      for (const color of SOCKET_COLORS) {
        roll -= weights[color];
        if (roll <= 0) {
          picked = color;
          break;
        }
      }
      colors.push(picked);
    }
    if (!avoid || count === 0 || colors.some((color, index) => color !== avoid[index])) return colors;
  }
  return avoid ? avoid.map((color) => (color === 'white' ? 'red' : 'white')) : [];
}

export function socketColorCode(color: SocketColor): string {
  return color === 'red' ? 'R' : color === 'green' ? 'G' : color === 'blue' ? 'B' : 'W';
}

export function socketColorHex(color: SocketColor): string {
  return color === 'red' ? '#e0574a' : color === 'green' ? '#4be37a' : color === 'blue' ? '#5aa9ff' : '#f0ece1';
}
