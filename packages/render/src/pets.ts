// Companions: little animals that follow their owner around a room. Cosmetic
// only: they have no position the server cares about. The client draws them
// from a species and a colour index; the server only stores who owns what.

export interface PetColor {
  name: string;
  /** Main fur colour. */
  body: number;
  /** Ears, paws, belly. */
  accent: number;
}

export interface PetSpecies {
  key: string;
  name: string;
  /** In Pixels. */
  price: number;
  description: string;
  colors: readonly PetColor[];
}

export const PET_SPECIES: readonly PetSpecies[] = [
  {
    key: 'chat',
    name: 'Chat',
    price: 150,
    description: 'Curieux et câlin, il se frotte à tes jambes.',
    colors: [
      { name: 'Roux', body: 0xf08a3c, accent: 0xfff0d6 },
      { name: 'Gris', body: 0x8f96b0, accent: 0xe8eaf4 },
      { name: 'Noir', body: 0x3b3366, accent: 0xa79fcb },
      { name: 'Crème', body: 0xf2dcb0, accent: 0xffffff },
    ],
  },
  {
    key: 'chien',
    name: 'Chien',
    price: 150,
    description: 'Fidèle, il te suit partout en remuant la queue.',
    colors: [
      { name: 'Caramel', body: 0xc98a4a, accent: 0xf6d9ad },
      { name: 'Chocolat', body: 0x6e4a2c, accent: 0xd9b48a },
      { name: 'Blanc', body: 0xf4efe6, accent: 0xd9a05b },
      { name: 'Tacheté', body: 0xd9d4e8, accent: 0x3b3366 },
    ],
  },
  {
    key: 'lapin',
    name: 'Lapin',
    price: 120,
    description: 'Tout doux, il saute plutôt qu’il ne marche.',
    colors: [
      { name: 'Blanc', body: 0xf4efe6, accent: 0xffb0c8 },
      { name: 'Gris', body: 0xb5b0c8, accent: 0xf4efe6 },
      { name: 'Brun', body: 0xa8764a, accent: 0xf2dcb0 },
      { name: 'Rose', body: 0xffb0c8, accent: 0xfff3f7 },
    ],
  },
  {
    key: 'canard',
    name: 'Caneton',
    price: 100,
    description: 'Un petit canard qui se dandine derrière toi.',
    colors: [
      { name: 'Jaune', body: 0xffd95a, accent: 0xff9a3c },
      { name: 'Bleu', body: 0x7ac8ff, accent: 0xffb35a },
      { name: 'Vert', body: 0x8fe0a0, accent: 0xffb35a },
      { name: 'Rose', body: 0xffb0d0, accent: 0xff9a3c },
    ],
  },
];

export const petSpecies = (key: string): PetSpecies | undefined => PET_SPECIES.find((s) => s.key === key);

/** Companions a player can own at once. */
export const MAX_PETS = 3;

// ----- Care ---------------------------------------------------------------------------------------------------
// A companion's hunger and joy are not stored: they are worked out when read, from the time of the last meal and
// the last game. They fall with real time, never below zero, and nothing bad happens at zero: a neglected
// companion is only sad and does not show off. Feeding and playing cost nothing, but only work once the need is
// there, and they earn experience that unlocks tricks.

export const FED_SPAN_MS = 24 * 60 * 60 * 1000;
export const JOY_SPAN_MS = 8 * 60 * 60 * 1000;
/** A meal or a game only works once the need has dropped below 80. */
export const CARE_THRESHOLD = 80;
export const PET_XP_FEED = 5;
export const PET_XP_PLAY = 4;
export const MAX_PET_LEVEL = 10;

/** 100 just after a meal (or a game), falling in a straight line to 0 over `spanMs`. */
export const petNeed = (sinceMs: number, spanMs: number): number =>
  Math.max(0, Math.min(100, Math.round(100 - (Math.max(0, sinceMs) / spanMs) * 100)));

/** How long after the last meal (or game) the need is below the threshold, so that care works again. */
export const careReadyAfterMs = (spanMs: number): number => Math.ceil(((100 - CARE_THRESHOLD) / 100) * spanMs);

export type PetMood = 'happy' | 'ok' | 'sad';
export const petMood = (hunger: number, joy: number): PetMood => {
  const low = Math.min(hunger, joy);
  return low < 25 ? 'sad' : low >= 60 ? 'happy' : 'ok';
};
/** Mood as the number stored in the room's state. */
export const MOOD_CODE: Record<PetMood, number> = { happy: 0, ok: 1, sad: 2 };

export const petLevel = (xp: number): number => Math.min(MAX_PET_LEVEL, 1 + Math.floor(Math.sqrt(Math.max(0, xp) / 12)));
/** Experience needed to reach a level (1 needs none). */
export const xpForLevel = (level: number): number => (level <= 1 ? 0 : (level - 1) * (level - 1) * 12);

export interface PetTrick {
  key: string;
  name: string;
  /** Level at which the companion learns it. */
  level: number;
}
export const PET_TRICKS: readonly PetTrick[] = [
  { key: 'assis', name: 'S’asseoir', level: 1 },
  { key: 'viens', name: 'Venir près de toi', level: 1 },
  { key: 'saute', name: 'Sauter', level: 2 },
  { key: 'tourne', name: 'Tourner sur lui-même', level: 3 },
];
export const petTrick = (key: string): PetTrick | undefined => PET_TRICKS.find((t) => t.key === key);

