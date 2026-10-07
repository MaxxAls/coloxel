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
