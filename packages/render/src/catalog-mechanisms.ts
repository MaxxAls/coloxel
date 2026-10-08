import type { CatalogueEntry, FurnitureCategory } from './catalog';
import type { Part, Recipe, Texture } from './types';

// Base furniture that does something when clicked: a gate that opens and closes, a confetti cannon.
// What they do is decided by the server (apps/server/src/realtime/rooms.ts); here only how they look.

type Extras = Partial<Omit<CatalogueEntry, 'key' | 'name' | 'category' | 'recipe'>>;
export interface MechanismPiece {
  key: string;
  category: FurnitureCategory;
  recipe: Recipe;
  extras: Extras;
}

const box = (x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, c: string, tex?: Texture): Part => ({
  t: 'box', x0, x1, y0, y1, z0, z1, c, ...(tex ? { tex } : {}),
});
const cyl = (x: number, y: number, r: number, z0: number, z1: number, side: string, top?: string): Part => ({
  t: 'cyl', x, y, r, z0, z1, side, ...(top ? { top } : {}),
});
const ball = (x: number, y: number, z: number, r: number, c: string): Part => ({ t: 'sphere', x, y, z, r, c });
const pix = (x: number, y: number, z: number, w: number, h: number, c: string): Part => ({ t: 'pix', x, y, z, w, h, c });
const glow = (x: number, y: number, z: number, r: number, c: string, a = 0.6): Part => ({ t: 'glow', x, y, z, r, c, a });

const WOOD = '#9a6a3e';
const WOOD_DARK = '#6a4628';
const IRON = '#3d4350';

/** Two posts and a hinge; the leaves are what changes between closed and open. */
const gatePosts: Part[] = [
  box(-8, -5, -2, 2, 0, 24, WOOD_DARK, 'wood'), box(5, 8, -2, 2, 0, 24, WOOD_DARK, 'wood'),
  box(-8.4, -4.6, -2.4, 2.4, 24, 26, WOOD), box(4.6, 8.4, -2.4, 2.4, 24, 26, WOOD),
  ball(-6.5, 0, 28, 1.6, '#d6b25a'), ball(6.5, 0, 28, 1.6, '#d6b25a'),
  box(-5, -4.4, -0.8, 0.8, 6, 9, IRON), box(-5, -4.4, -0.8, 0.8, 17, 20, IRON),
];

const gateClosed: Recipe = {
  name: 'Portillon',
  parts: [
    ...gatePosts,
    // Two leaves, shut: slats, a rail top and bottom, a latch.
    box(-5, 0, -1, 1, 5, 7, WOOD, 'wood'), box(-5, 0, -1, 1, 16, 18, WOOD, 'wood'), box(0, 5, -1, 1, 5, 7, WOOD, 'wood'), box(0, 5, -1, 1, 16, 18, WOOD, 'wood'),
    ...[-4, -2, 0, 2, 4].map((x) => box(x - 0.6, x + 0.6, -0.8, 0.8, 7, 16, '#b88450', 'planks')),
    box(-0.8, 0.8, -1.2, 1.2, 10, 13, IRON), pix(-0.4, 1.3, 11.5, 1, 1, '#d6b25a'),
  ],
};

const gateOpen: Recipe = {
  name: 'Portillon',
  parts: [
    ...gatePosts,
    // The leaves swung back against the posts.
    box(-5, -4, -1, 5, 5, 7, WOOD, 'wood'), box(-5, -4, -1, 5, 16, 18, WOOD, 'wood'),
    ...[0, 1, 2, 3].map((k) => box(-5, -4, 0 + k * 1.2, 0.8 + k * 1.2, 7, 16, '#b88450', 'planks')),
    box(4, 5, -1, 5, 5, 7, WOOD, 'wood'), box(4, 5, -1, 5, 16, 18, WOOD, 'wood'),
    ...[0, 1, 2, 3].map((k) => box(4, 5, 0 + k * 1.2, 0.8 + k * 1.2, 7, 16, '#b88450', 'planks')),
  ],
};

const cannon: Recipe = {
  name: 'Canon à confettis',
  parts: [
    // Wooden carriage with two wheels.
    box(-6, 6, -5, 5, 3, 6, WOOD_DARK, 'planks'),
    cyl(-6.2, 5.2, 4, 0, 1.4, '#c98f5e', '#e0b080'), cyl(-6.2, -5.2, 4, 0, 1.4, '#c98f5e', '#e0b080'),
    // The barrel: a striped party tube tipped toward the sky.
    box(-3, 4, -2.6, 2.6, 6, 11, '#d94f6a', 'stripes'), box(-1, 6, -2.2, 2.2, 10, 15, '#f0c14a', 'stripes'),
    box(1, 8, -1.8, 1.8, 14, 19, '#4fa8d8', 'stripes'),
    // Confetti poking out of the mouth, and a pull string.
    ball(9, 0, 21, 1.4, '#ff8ac0'), ball(7, 1.2, 22.5, 1.1, '#fff06a'), ball(10, -1.2, 22.5, 1.1, '#8affa0'), ball(8, -0.4, 24.5, 0.9, '#8ac8ff'),
    pix(5, 3, 8, 0.5, 4, '#fff0c0'), ball(5, 3, 7, 0.9, '#e0503a'),
    pix(-2, -4.5, 9, 1, 1, '#ffffff'), pix(2, -4.5, 7.5, 1, 1, '#fff06a'),
  ],
};

/** A scoreboard on two legs: a red half and a blue half, bulbs along the top. */
const gameBoard: Recipe = {
  name: 'Tableau des couleurs',
  parts: [
    box(-6, -4, -1.5, 1.5, 0, 22, WOOD_DARK, 'wood'), box(4, 6, -1.5, 1.5, 0, 22, WOOD_DARK, 'wood'),
    box(-7, 7, -2, 2, 18, 32, '#2c2a3a', 'metal'),
    box(-6, -0.4, -2.3, 2.3, 19.2, 30.6, '#d94f4f', 'fabric'), box(0.4, 6, -2.3, 2.3, 19.2, 30.6, '#4f7fd9', 'fabric'),
    // Painted tiles on both halves, and a start button between them.
    ...[0, 1, 2].flatMap((k) => [box(-5 + k * 1.7, -4 + k * 1.7, 2.4, 2.8, 21, 22.4 + k, '#f4b0b0'), box(1 + k * 1.7, 2 + k * 1.7, 2.4, 2.8, 21, 22.4 + k, '#b0c8f4')]),
    cyl(0, 2.6, 1.4, 25, 26, '#ffc857', '#ffe08a'),
    ...[-5, -2.5, 0, 2.5, 5].map((x) => ball(x, 2.4, 33, 0.8, '#ffe28a')),
  ],
};

/** Coffee machine: a steel body, a glass window with beans, a nozzle and a lit button. */
const coffeeMachine: Recipe = {
  name: 'Machine à café',
  parts: [
    box(-6, 6, -5, 5, 0, 30, '#6b3f2a', 'wood'),
    box(-6.4, 6.4, -5.4, 5.4, 30, 33, '#8a5a3a', 'wood'),
    box(-4.5, 4.5, 5, 5.6, 14, 28, '#2a2a38', 'metal'),
    box(-3.5, 3.5, 5.5, 6, 18, 27, '#8fc8e8', 'glass'),
    ...[0, 1, 2, 3].map((k) => ball(-2.4 + k * 1.6, 5.8, 19 + (k % 2) * 1.8, 0.9, '#4a2a18')),
    box(-1, 1, 5, 7, 11, 13.5, '#c4c8d0', 'metal'), box(-3, 3, 4, 8, 0.5, 2, '#c4c8d0', 'metal'),
    cyl(0, 6.4, 1.8, 2, 7, '#f4efe6', '#6a3e22'),
    cyl(-3.4, 5.6, 0.9, 9, 10, '#e0503a', '#ff8a70'), cyl(3.4, 5.6, 0.9, 9, 10, '#4fa86a', '#8affa0'),
    pix(-5, 5.2, 22, 1, 1, '#ffffff'),
  ],
};

/** A juice stand: a striped awning, a counter, a glass dispenser of orange juice. */
const juiceStand: Recipe = {
  name: 'Stand de jus',
  parts: [
    box(-7, -5.5, -6, 6, 0, 24, WOOD_DARK, 'wood'), box(5.5, 7, -6, 6, 0, 24, WOOD_DARK, 'wood'),
    box(-7, 7, -6, 6, 0, 12, WOOD, 'planks'), box(-7.6, 7.6, -6.6, 6.6, 12, 14, '#c98f5e', 'planks'),
    box(-2.5, 2.5, -2, 2, 14, 24, '#d8f0f4', 'glass'), box(-2.1, 2.1, -1.6, 1.6, 14, 21, '#ff9a2a', 'water'),
    cyl(0, 0, 0.9, 24, 26, '#c4c8d0', '#e0e4ea'),
    ...[0, 1, 2].map((k) => ball(-5 + k * 2.6, 3.6, 15.4, 1.1, ['#ff9a2a', '#ffd23a', '#7ac84f'][k]!)),
    box(-8, 8, -7, 7, 24, 26, '#e0503a', 'stripes'), box(-8.4, 8.4, 4, 8, 22, 24.4, '#fff6e0', 'stripes'),
  ],
};

/** An ice cream cart: two wheels, a candy parasol, tubs of colour. */
const iceCart: Recipe = {
  name: 'Chariot de glaces',
  parts: [
    cyl(-6, 5, 4, 0, 1.4, '#c98f5e', '#e0b080'), cyl(-6, -5, 4, 0, 1.4, '#c98f5e', '#e0b080'),
    box(-7, 7, -5, 5, 4, 16, '#8ad0e0', 'metal'), box(-7.4, 7.4, -5.4, 5.4, 16, 18, '#fff6f0'),
    cyl(-3.4, -1.5, 1.8, 18, 19.4, '#ffb6d0', '#ffd0e0'), cyl(0, -1.5, 1.8, 18, 19.4, '#fff0c0', '#fff8e0'), cyl(3.4, -1.5, 1.8, 18, 19.4, '#b6e8c0', '#d0f4d8'),
    cyl(-3.4, 2, 1.8, 18, 19.4, '#d9a35a', '#e8c080'), cyl(0, 2, 1.8, 18, 19.4, '#c8b0f0', '#e0d0f8'), cyl(3.4, 2, 1.8, 18, 19.4, '#ffd0a0', '#ffe4c8'),
    cyl(0, 0, 0.5, 18, 36, '#c4c8d0'),
    box(-8, 8, -8, 8, 36, 37, '#ff7aa8', 'stripes'), box(-5, 5, -5, 5, 37, 39, '#ffb6d0', 'stripes'), ball(0, 0, 40, 1.2, '#fff6f0'),
  ],
};

/** A flower box: a wooden planter overflowing with blooms. */
const flowerBox: Recipe = {
  name: 'Bac de fleurs',
  parts: [
    box(-7, 7, -4, 4, 0, 8, WOOD, 'planks'), box(-7.4, 7.4, -4.4, 4.4, 8, 9, WOOD_DARK),
    box(-6.6, 6.6, -3.6, 3.6, 8.6, 10, '#4a2f1a', 'grass'),
    ...[-5, -2.5, 0, 2.5, 5].flatMap((x, k) => [
      box(x - 0.2, x + 0.2, -0.2, 0.2, 9, 13 + (k % 3), '#3f9a46'),
      ball(x, 0, 14 + (k % 3), 1.8, ['#ff7aa8', '#ffe05a', '#ff9a5a', '#b78cff', '#ff7aa8'][k]!),
      pix(x - 0.5, 0, 14.5 + (k % 3), 1, 1, '#fff6f0'),
    ]),
  ],
};

/** A tailor's stand: a round base, a pole, a plain wooden torso where the look is drawn over by the game. */
const mannequin: Recipe = {
  name: 'Mannequin',
  parts: [
    cyl(0, 0, 6, 0, 2, WOOD_DARK, WOOD), cyl(0, 0, 0.9, 2, 12, '#c4c8d0'),
    box(-0.8, 0.8, -0.8, 0.8, 11, 13, WOOD_DARK),
  ],
};

/** A sign on a post: a board with lines that stand for writing. */
const sign: Recipe = {
  name: 'Panneau',
  parts: [
    box(-0.9, 0.9, -0.9, 0.9, 0, 18, WOOD_DARK, 'wood'),
    box(-7, 7, -1.2, 1.2, 16, 30, '#d9b27a', 'planks'), box(-7.4, 7.4, -1.5, 1.5, 15, 16, WOOD), box(-7.4, 7.4, -1.5, 1.5, 30, 31, WOOD),
    ...[0, 1, 2].map((k) => box(-5, 5 - k * 2, 1.2, 1.6, 25 - k * 3.4, 26.4 - k * 3.4, '#6a4628')),
  ],
};

/** A jukebox: an arched cabinet, a lit window, a record on a turntable, rows of bulbs that chase each other. */
const BULBS = ['#ff7aa8', '#ffe05a', '#6be2a3', '#7ac8ff', '#ff9a5a'];
const jukeboxFrame = (k: number): Recipe => ({
  name: 'Juke-box',
  parts: [
    box(-7, 7, -6, 6, 0, 3, WOOD_DARK, 'wood'),
    box(-7, 7, -6, 6, 3, 28, '#b8453a', 'wood'), box(-7.4, 7.4, -6.4, 6.4, 3, 6, '#8a2f28'),
    box(-6, 6, 6, 6.6, 8, 24, '#2a2140', 'metal'),
    box(-5, 5, 6.6, 7, 10, 22, '#ffe08a'),
    cyl(0, 6.9, 3.6, 12, 12.4, '#1b1530', '#2a2140'), cyl(0, 6.9, 1, 12.4, 12.8, '#ffc857', '#ffe08a'),
    // The record turns: a bright mark goes round it.
    pix(-3 + (k % 4) * 2, 6.9, 12.8 + (k % 2), 1, 1, '#ffffff'),
    ...[0, 1, 2, 3, 4].map((n) => ball(-4 + n * 2, 6.9, 19.4, 0.7, BULBS[(n + k) % 5]!)),
    box(-7.4, 7.4, -6.4, 6.4, 28, 31, '#d8c08a', 'metal'), box(-5, 5, -5, 5, 31, 34, '#d8c08a', 'metal'), box(-2.5, 2.5, -2.5, 2.5, 34, 36, '#d8c08a'),
    ...[-6, -3, 0, 3, 6].map((x, n) => ball(x, 6.6, 27, 0.9, (n + k) % 2 ? '#ffe28a' : '#ff9a5a')),
    glow(0, 7, 16, 18, '#ffd070', 0.4 + (k % 2) * 0.12),
  ],
});
const jukebox: Recipe = jukeboxFrame(0);

/** An aquarium on a stand: water, sand, a plant, and fish that swim from one frame to the next. */
const aquariumFrame = (k: number): Recipe => {
  const swim = (phase: number, y: number, z: number, c: string, c2: string): Part[] => {
    const x = -4 + ((phase + k * 3) % 24);
    return [ball(x, y, z, 1.7, c), box(x - 3, x - 1.6, y - 0.4, y + 0.4, z - 0.6, z + 0.6, c2), pix(x + 0.9, y, z + 0.4, 0.5, 0.5, '#1b1530')];
  };
  return {
    name: 'Grand aquarium',
    size: [2, 1],
    parts: [
      box(-7, 7, -5, 5, 0, 3, WOOD_DARK, 'wood'), box(17, 23, -5, 5, 0, 3, WOOD_DARK, 'wood'), box(-7, 23, -5, 5, 8, 11, WOOD_DARK, 'wood'),
      box(-7, -5, -5, 5, 3, 8, WOOD), box(21, 23, -5, 5, 3, 8, WOOD),
      // Tank: sand, water, glass.
      box(-6, 22, -4, 4, 11, 13, '#e6d4a0', 'grass'),
      box(-6, 22, -4, 4, 13, 31, '#3f9ad0', 'water'),
      box(-6.4, -5.6, -4.4, 4.4, 11, 32, '#cfe8f4', 'glass'), box(21.6, 22.4, -4.4, 4.4, 11, 32, '#cfe8f4', 'glass'),
      box(-6.4, 22.4, 3.6, 4.4, 11, 32, '#cfe8f4', 'glass'),
      box(-7, 23, -5, 5, 31.4, 33.4, '#2a2140', 'metal'),
      // Rocks, weed that sways, a plant.
      ball(2, -1, 14, 2.4, '#8d8f94'), ball(5, 0, 13.4, 1.8, '#a0a2a8'),
      box(14 + (k % 2) * 0.4, 14.6 + (k % 2) * 0.4, -1, 0, 13, 22, '#3f9a46'), box(15.4 - (k % 2) * 0.4, 16 - (k % 2) * 0.4, 0, 1, 13, 19, '#58b552'),
      ...swim(0, 0, 24, '#ff9a2a', '#ffb860'), ...swim(11, 1, 19, '#ffd23a', '#fff08a'), ...swim(17 + k, -1, 27, '#7ac8ff', '#bfe8f8'),
      // Bubbles rising.
      pix(18, 0, 15 + ((k * 3) % 12), 0.5, 0.5, '#e6f6ff'), pix(18.6, 0.4, 17 + ((k * 3) % 11), 0.5, 0.5, '#e6f6ff'),
      glow(8, 0, 22, 22, '#8fd0ff', 0.4),
    ],
  };
};

/** The board that starts the statues game: an ice-blue plaque with a frozen figure. */
const statuesBoard: Recipe = {
  name: 'Tableau des statues',
  parts: [
    box(-6, -4, -1.5, 1.5, 0, 22, WOOD_DARK, 'wood'), box(4, 6, -1.5, 1.5, 0, 22, WOOD_DARK, 'wood'),
    box(-7, 7, -2, 2, 18, 32, '#2c2a3a', 'metal'),
    box(-6, 6, -2.3, 2.3, 19.2, 30.6, '#8fd0f0', 'glass'),
    cyl(0, 2.6, 2, 21, 27, '#e6f6ff', '#ffffff'), ball(0, 2.6, 29, 1.8, '#e6f6ff'),
    pix(-3, 2.6, 24, 1, 1, '#ffffff'), pix(3, 2.6, 26, 1, 1, '#ffffff'),
    ...[-5, -2.5, 0, 2.5, 5].map((x) => ball(x, 2.4, 33, 0.8, '#bfe8f8')),
  ],
};

/** The kick-off pad: a round plinth and a football on top. */
const kickoff: Recipe = {
  name: 'Coup d’envoi',
  parts: [
    cyl(0, 0, 7, 0, 3, '#4f9a5a', '#6bbf6f'), cyl(0, 0, 5, 3, 3.6, '#f4efe6', '#ffffff'),
    ball(0, 0, 9, 4.6, '#f4efe6'),
    pix(-1, -1, 12, 2, 2, '#2c2a3a'), pix(-3, 0, 9, 1.5, 1.5, '#2c2a3a'), pix(2, 1, 8, 1.5, 1.5, '#2c2a3a'),
  ],
};

/** A goal: two posts and a crossbar with a net, in the colour of the team that defends it. */
const goalOf = (name: string, c: string, dark: string): Recipe => ({
  name,
  parts: [
    box(-7, -5.6, -7, 7, 0, 3, dark),
    box(-7, -5.6, -7, -5.6, 0, 26, '#f4efe6', 'metal'), box(-7, -5.6, 5.6, 7, 0, 26, '#f4efe6', 'metal'),
    box(-7, -5.6, -7, 7, 24.6, 26, '#f4efe6', 'metal'),
    box(-5.6, -4.4, -5.6, 5.6, 2, 24, c, 'weave'),
    box(-5.6, 3, -5.6, -4.6, 2, 22, c, 'weave'), box(-5.6, 3, 4.6, 5.6, 2, 22, c, 'weave'),
    pix(-6, -5, 25, 1, 1, '#ffffff'),
  ],
});

export function mechanismPieces(): MechanismPiece[] {
  return [
    { key: 'portillon', category: 'decor', recipe: gateClosed, extras: { price: 40, pressable: true, gate: { open: gateOpen } } },
    { key: 'tableaucouleurs', category: 'tech', recipe: gameBoard, extras: { price: 90, pressable: true, game: 'paint' } },
    { key: 'machinecafe', category: 'tech', recipe: coffeeMachine, extras: { price: 50, pressable: true, vendor: 1 } },
    { key: 'standjus', category: 'tech', recipe: juiceStand, extras: { price: 60, pressable: true, vendor: 2 } },
    { key: 'chariotglaces', category: 'tech', recipe: iceCart, extras: { price: 60, pressable: true, vendor: 3 } },
    { key: 'bacfleurs', category: 'decor', recipe: flowerBox, extras: { price: 40, pressable: true, vendor: 6 } },
    { key: 'mannequin', category: 'decor', recipe: mannequin, extras: { price: 80, mannequin: true } },
    { key: 'panneau', category: 'decor', recipe: sign, extras: { price: 30, sign: true } },
    { key: 'jukebox', category: 'tech', recipe: jukebox, extras: { price: 150, pressable: true, jukebox: true, frames: [1, 2, 3, 4].map(jukeboxFrame), frameMs: 260 } },
    { key: 'aquariumgrand', category: 'decor', recipe: aquariumFrame(0), extras: { price: 220, frames: [1, 2, 3, 4, 5].map(aquariumFrame), frameMs: 320 } },
    { key: 'tableaustatues', category: 'tech', recipe: statuesBoard, extras: { price: 90, pressable: true, game: 'freeze' } },
    { key: 'coupdenvoi', category: 'tech', recipe: kickoff, extras: { price: 90, pressable: true, game: 'soccer' } },
    { key: 'butrouge', category: 'decor', recipe: goalOf('But rouge', '#e0564f', '#a8302c'), extras: { price: 60, goal: 0 } },
    { key: 'butbleu', category: 'decor', recipe: goalOf('But bleu', '#4f7fe0', '#2f509c'), extras: { price: 60, goal: 1 } },
    { key: 'canonconfettis', category: 'tech', recipe: cannon, extras: { price: 70, pressable: true, confetti: true } },
  ];
}
