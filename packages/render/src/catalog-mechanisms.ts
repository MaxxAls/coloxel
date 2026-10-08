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

export function mechanismPieces(): MechanismPiece[] {
  return [
    { key: 'portillon', category: 'decor', recipe: gateClosed, extras: { price: 40, pressable: true, gate: { open: gateOpen } } },
    { key: 'canonconfettis', category: 'tech', recipe: cannon, extras: { price: 70, pressable: true, confetti: true } },
  ];
}
