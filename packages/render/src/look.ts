// What a player's avatar is made of, shared by the client (which draws it) and
// the server (which decides what a player may wear). A look is plain numbers:
// indexes into the palettes and the wardrobe below. Nothing in it can carry text.

export type Slot = 'hair' | 'top' | 'bottom' | 'shoes' | 'hat' | 'glasses' | 'extra';

export const SLOTS: readonly Slot[] = ['hair', 'top', 'bottom', 'shoes', 'hat', 'glasses', 'extra'];

export interface Look {
  /** Index in SKIN_TONES. */
  skin: number;
  /** Index in EYES. */
  eyes: number;
  /** Index in MOUTHS. */
  mouth: number;
  hair: number;
  /** Index in HAIR_COLORS. */
  hairColor: number;
  top: number;
  /** Index in CLOTH_COLORS (for every colour below). */
  topColor: number;
  bottom: number;
  bottomColor: number;
  shoes: number;
  shoesColor: number;
  hat: number;
  hatColor: number;
  glasses: number;
  extra: number;
  extraColor: number;
}

export const SKIN_TONES: readonly number[] = [
  0xf6d3b3, 0xefc29a, 0xe8b88a, 0xc98f5e, 0xa8744a, 0x8a5a3a, 0x6b4427, 0x4a2f1c, 0xa6dcb0, 0xb8a6e8,
];

export const HAIR_COLORS: readonly number[] = [
  0x2a1a14, 0x5a3420, 0x8b5a2b, 0xb5651d, 0xe0b04a, 0xf2d27a, 0xd04a6a, 0xff8fb1, 0x4a6fd0, 0x7d4fc9, 0x3aa17e, 0xe8e4f0,
];

export const CLOTH_COLORS: readonly number[] = [
  0xe2483d, 0xf08a3c, 0xf2c230, 0x8fd14f, 0x35b57c, 0x4fc3c3, 0x5ab8ff, 0x4a8fe2, 0x5a56c9, 0xb36bd6, 0xff8fb1, 0xd04a8a,
  0xf4efe6, 0x8f86bf, 0x8b5e3c, 0x2a2140,
];

export const EYES: readonly string[] = ['Ronds', 'Rieurs', 'Endormis', 'Brillants'];
export const MOUTHS: readonly string[] = ['Sourire', 'Grand sourire', 'Neutre', 'Surpris'];

export interface LookItem {
  /** Equal to its position in the slot's list. */
  id: number;
  name: string;
  /** In Pixels. 0 means everybody owns it from the start. */
  price: number;
  /** Does the garment take one of CLOTH_COLORS (hair takes HAIR_COLORS)? */
  colorable: boolean;
}

const item = (id: number, name: string, price = 0, colorable = true): LookItem => ({ id, name, price, colorable });

export const LOOK_ITEMS: Record<Slot, readonly LookItem[]> = {
  hair: [
    item(0, 'Court'),
    item(1, 'Long'),
    item(2, 'Pointes'),
    item(3, 'Chignon'),
    item(4, 'Carré'),
    item(5, 'Frange de côté', 30),
    item(6, 'Couettes', 40),
    item(7, 'Afro', 60),
    item(8, 'Crête', 80),
    item(9, 'Chauve'),
    item(10, 'Queue de cheval', 40),
  ],
  top: [
    item(0, 'T-shirt'),
    item(1, 'Marinière'),
    item(2, 'Sweat à capuche'),
    item(3, 'T-shirt étoile'),
    item(4, 'Chemise et cravate', 50),
    item(5, 'Veste', 90),
    item(6, 'Pull col roulé', 60),
    item(7, 'Débardeur', 30),
    item(8, 'Robe', 80),
    item(9, 'Salopette', 70),
  ],
  bottom: [item(0, 'Jean'), item(1, 'Short'), item(2, 'Jogging', 20), item(3, 'Jupe', 40), item(4, 'Pantalon cargo', 50)],
  shoes: [item(0, 'Baskets'), item(1, 'Bottes', 40), item(2, 'Montantes', 50), item(3, 'Pieds nus', 0, false)],
  hat: [
    item(0, 'Aucun', 0, false),
    item(1, 'Casquette'),
    item(2, 'Bonnet'),
    item(3, 'Couronne', 150),
    item(4, 'Haut-de-forme', 100),
    item(5, 'Oreilles de chat', 60),
    item(6, 'Bandeau', 20),
    item(7, 'Chapeau de sorcier', 120),
    item(8, 'Couronne de fleurs', 30),
  ],
  glasses: [
    item(0, 'Aucune', 0, false),
    item(1, 'Rondes', 0, false),
    item(2, 'Carrées', 20, false),
    item(3, 'De soleil', 40, false),
    item(4, 'Cœurs', 60, false),
  ],
  extra: [
    item(0, 'Aucun', 0, false),
    item(1, 'Écharpe', 40),
    item(2, 'Sac à dos', 50),
    item(3, 'Ailes d’ange', 200, false),
    item(4, 'Cape', 150),
    item(5, 'Nœud papillon', 30),
  ],
};

export const DEFAULT_LOOK: Look = {
  skin: 0, eyes: 0, mouth: 0,
  hair: 0, hairColor: 1,
  top: 0, topColor: 0,
  bottom: 0, bottomColor: 8,
  shoes: 0, shoesColor: 15,
  hat: 0, hatColor: 0,
  glasses: 0,
  extra: 0, extraColor: 0,
};

/** Highest valid value of each field, for validation and for pickers. */
const RANGES: Record<keyof Look, number> = {
  skin: SKIN_TONES.length - 1,
  eyes: EYES.length - 1,
  mouth: MOUTHS.length - 1,
  hair: LOOK_ITEMS.hair.length - 1,
  hairColor: HAIR_COLORS.length - 1,
  top: LOOK_ITEMS.top.length - 1,
  topColor: CLOTH_COLORS.length - 1,
  bottom: LOOK_ITEMS.bottom.length - 1,
  bottomColor: CLOTH_COLORS.length - 1,
  shoes: LOOK_ITEMS.shoes.length - 1,
  shoesColor: CLOTH_COLORS.length - 1,
  hat: LOOK_ITEMS.hat.length - 1,
  hatColor: CLOTH_COLORS.length - 1,
  glasses: LOOK_ITEMS.glasses.length - 1,
  extra: LOOK_ITEMS.extra.length - 1,
  extraColor: CLOTH_COLORS.length - 1,
};

const KEYS = Object.keys(RANGES) as (keyof Look)[];

/** A look from untrusted input: exactly the known fields, each an integer in range. Anything else is refused. */
export function parseLook(input: unknown): Look | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const raw = input as Record<string, unknown>;
  if (Object.keys(raw).length !== KEYS.length) return null;
  const out = {} as Look;
  for (const key of KEYS) {
    const v = raw[key];
    if (typeof v !== 'number' || !Number.isInteger(v) || v < 0 || v > RANGES[key]) return null;
    out[key] = v;
  }
  return out;
}

/** The pieces a look wears that must be owned (the free ones are everybody's). */
export function paidPieces(look: Look): { slot: Slot; id: number; price: number }[] {
  const out: { slot: Slot; id: number; price: number }[] = [];
  for (const slot of SLOTS) {
    const piece = LOOK_ITEMS[slot][look[slot]];
    if (piece && piece.price > 0) out.push({ slot, id: piece.id, price: piece.price });
  }
  return out;
}

/** A stable pseudo-random look made of free pieces only: what a player starts with. */
export function lookFor(seed: string): Look {
  let h = 2166136261;
  for (let k = 0; k < seed.length; k++) h = Math.imul(h ^ seed.charCodeAt(k), 16777619);
  const next = (n: number) => {
    h = Math.imul(h ^ (h >>> 15), 2246822507) >>> 0;
    h = Math.imul(h ^ (h >>> 13), 3266489909) >>> 0;
    return ((h ^ (h >>> 16)) >>> 0) % n;
  };
  const free = (slot: Slot) => LOOK_ITEMS[slot].filter((i) => i.price === 0);
  const pick = (slot: Slot) => free(slot)[next(free(slot).length)]!.id;
  // Skin tones first: the natural ones are likelier than the fantasy ones.
  const skin = next(10) < 8 ? next(8) : 8 + next(2);
  return {
    skin,
    eyes: next(EYES.length),
    mouth: next(2),
    hair: pick('hair'),
    hairColor: next(HAIR_COLORS.length),
    top: pick('top'),
    topColor: next(CLOTH_COLORS.length),
    bottom: pick('bottom'),
    bottomColor: next(CLOTH_COLORS.length),
    shoes: pick('shoes'),
    shoesColor: next(CLOTH_COLORS.length),
    // Half of the players wear nothing special on their head.
    hat: next(2) === 0 ? 0 : pick('hat'),
    hatColor: next(CLOTH_COLORS.length),
    glasses: next(4) === 0 ? 1 : 0,
    extra: 0,
    extraColor: next(CLOTH_COLORS.length),
  };
}
