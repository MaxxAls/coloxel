import type { CatalogueEntry, FurnitureCategory } from './catalog';
import type { Part, Recipe, Texture } from './types';

// Base furniture that covers several tiles. Same recipe format as everything else,
// with a `size` and the new materials. The origin (0, 0) is the centre of the first
// tile; the next tile along x (or y) is 16 further.

type Extras = Partial<Omit<CatalogueEntry, 'key' | 'name' | 'category' | 'recipe'>>;
export interface BigPiece {
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
const quad = (c: string, tex: Texture | undefined, ...pts: [number, number, number][]): Part => ({
  t: 'quad', pts, c, ...(tex ? { tex } : {}),
});
const pix = (x: number, y: number, z: number, w: number, h: number, c: string): Part => ({ t: 'pix', x, y, z, w, h, c });
const glow = (x: number, y: number, z: number, r: number, c: string, a = 0.6): Part => ({ t: 'glow', x, y, z, r, c, a });

const WOOD = '#8b5e3c';
const WOOD_DARK = '#5e3d24';
const WOOD_LIGHT = '#c98f5e';
const CREAM = '#f4efe6';
const STONE = '#9a9ca2';
const LEAF = ['#2f7a3a', '#3f9a46', '#58b552', '#276b34'];

/** Small deterministic generator, so a recipe built with loops is the same on every machine. */
const rng = (seed: number) => () => {
  seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
  return seed / 4294967296;
};

// ---------------------------------------------------------------------------------

const grandLit: Recipe = {
  name: 'Grand lit double',
  size: [2, 1],
  parts: [
    box(-7.5, -5.5, -7.5, -5.5, 0, 3, WOOD_DARK), box(-7.5, -5.5, 5.5, 7.5, 0, 3, WOOD_DARK),
    box(21.5, 23.5, -7.5, -5.5, 0, 3, WOOD_DARK), box(21.5, 23.5, 5.5, 7.5, 0, 3, WOOD_DARK),
    box(-7, 23, -7.5, 7.5, 3, 7, WOOD, 'planks'),
    // Headboard: panelled, with a crown.
    box(-8, -5.5, -8, 8, 3, 24, WOOD_DARK, 'wood'),
    box(-8.4, -5.1, -8.6, 8.6, 24, 26, WOOD),
    box(-7.7, -5.8, -6.5, -0.7, 10, 21, WOOD, 'planks'),
    box(-7.7, -5.8, 0.7, 6.5, 10, 21, WOOD, 'planks'),
    box(22, 24, -7.5, 7.5, 3, 12, WOOD_DARK, 'wood'),
    box(21.7, 24.3, -8, 8, 12, 13.2, WOOD),
    // Mattress and sheets.
    box(-5.5, 22, -7, 7, 7, 11, CREAM, 'fabric'),
    box(-5.5, 22, -7.2, -7, 7, 11.2, '#e6dccb'),
    // Quilt: striped, with a folded edge and a throw.
    box(4, 22, -7.4, 7.4, 11, 13.4, '#4f7fb8', 'stripes'),
    box(2.2, 4.4, -7.4, 7.4, 11, 13.8, CREAM, 'fabric'),
    box(14, 18, -7.6, 7.6, 13.4, 14, '#d86a5a', 'checker'),
    // Pillows with a dent.
    box(-5, 1, -6.6, -0.6, 11, 15, '#fff4dc', 'fabric'), box(-5, 1, 0.6, 6.6, 11, 15, '#ffe0e8', 'fabric'),
    ball(-2, -3.6, 15, 2.4, '#fffaf0'), ball(-2, 3.6, 15, 2.4, '#fff0f4'),
    pix(-4, -5, 15, 2, 0.5, '#ffffff'), pix(-4, 1.4, 15, 2, 0.5, '#ffffff'),
    // A cushion and a soft toy.
    box(5.5, 8.5, -2, 2, 14, 17, '#e3a23b', 'weave'), ball(7, 0, 19, 1.6, '#c98f5e'), ball(7, -1.2, 21, 0.9, '#c98f5e'), ball(7, 1.2, 21, 0.9, '#c98f5e'),
  ],
};

const canapeAngle: Recipe = {
  name: 'Canapé d’angle',
  size: [2, 2],
  parts: [
    // Plinth of the L.
    box(-8, 24, -8, 8, 0, 3, WOOD_DARK), box(-8, 8, 8, 24, 0, 3, WOOD_DARK),
    // Back rests, along y and along x.
    box(-8, 24, -8, -3, 3, 20, '#a8473d', 'fabric'), box(-8, -3, -3, 24, 3, 20, '#a8473d', 'fabric'),
    box(-8.2, 24.2, -8.4, -6, 17, 21, '#be5a4e', 'fabric'), box(-8.4, -6, -3, 24.2, 17, 21, '#be5a4e', 'fabric'),
    // Seat cushions.
    ...[0, 1, 2].map((k) => box(-3 + k * 9, 5.6 + k * 9, -2, 7.5, 3, 10, k % 2 ? '#c4625a' : '#b8564d', 'fabric')),
    ...[0, 1].map((k) => box(-3, 7.5, 9 + k * 8, 16.6 + k * 8, 3, 10, k % 2 ? '#b8564d' : '#c4625a', 'fabric')),
    // Arms.
    box(22, 24.4, -3, 8, 3, 15, '#a8473d', 'fabric'), box(-3, 8, 22.5, 24.4, 3, 15, '#a8473d', 'fabric'),
    // Throw pillows and a blanket.
    box(0, 4, -4, -0.5, 10, 17, '#f0c14a', 'dots'), box(14, 18, -4, -0.5, 10, 17, '#4f9a9a', 'stripes'),
    box(-4, -0.5, 10, 14, 10, 17, '#4f9a9a', 'stripes'),
    box(8, 16, 1, 6.5, 10, 11.6, '#e8dcc0', 'weave'),
    pix(1, -3, 16, 1.5, 0.5, '#fff5c8'), pix(15, -3, 16, 1.5, 0.5, '#aee4e4'),
  ],
};

const piano: Recipe = {
  name: 'Piano de salon',
  size: [2, 1],
  parts: [
    box(-7, -4, -5, 5, 0, 8, '#2c2230', 'wood'), box(19, 22, -5, 5, 0, 8, '#2c2230', 'wood'),
    // Body, with a lid and a music stand.
    box(-8, 24, -6, 4, 8, 30, '#3a2c3e', 'wood'),
    box(-8.5, 24.5, -6.5, 4.6, 30, 32, '#2a1f2e'),
    box(-4, 20, 3.9, 4.4, 14, 26, '#4a384c', 'planks'),
    // The pedal board and keys.
    box(-6.5, 22.5, 4, 10, 8, 10.5, '#2a1f2e'),
    box(-5.5, 21.5, 4.6, 9.4, 10.5, 12, '#fbf6ea'),
    ...Array.from({ length: 13 }, (_, k) => pix(-5 + k * 2, 9, 12, 0.5, 0.5, '#bfb6a3')),
    ...Array.from({ length: 9 }, (_, k) => box(-3.4 + (k + (k > 2 ? 1 : 0) + (k > 5 ? 1 : 0)) * 2, -2.2 + (k + (k > 2 ? 1 : 0) + (k > 5 ? 1 : 0)) * 2, 5.4, 8, 12, 14, '#1d1722')),
    // Candle holders on the lid, lit.
    cyl(-4, -1, 1, 32, 36, '#d6b25a'), cyl(20, -1, 1, 32, 36, '#d6b25a'),
    pix(-4.2, -1, 36, 0.5, 1.5, '#ffe9a0'), pix(19.8, -1, 36, 0.5, 1.5, '#ffe9a0'),
    glow(-4, -1, 37, 11, '#ffd070', 0.5), glow(20, -1, 37, 11, '#ffd070', 0.5),
    // Sheet music.
    quad('#f2ecd8', undefined, [2, 3.8, 18], [14, 3.8, 18], [14, 3.8, 25], [2, 3.8, 25]),
    ...[0, 1, 2, 3].map((k) => pix(3, 3.8, 19.5 + k * 1.5, 10, 0.5, '#6b5b6e')),
  ],
};

const bibliotheque: Recipe = {
  name: 'Grande bibliothèque',
  size: [2, 1],
  parts: (() => {
    const r = rng(7);
    const spines = ['#b5453a', '#3f6fa0', '#d9a441', '#4f8a5a', '#7a4f8a', '#e8dcc0', '#c97a3a', '#2f4f6f'];
    const parts: Part[] = [
      box(-8, 24, -7, 6, 0, 3, WOOD_DARK),
      box(-8, -6, -7, 6, 3, 58, WOOD, 'wood'), box(22, 24, -7, 6, 3, 58, WOOD, 'wood'), box(-8, 24, -7, -5, 3, 58, WOOD_DARK, 'planks'),
      box(-8.4, 24.4, -7.4, 6.4, 58, 61, WOOD_LIGHT, 'planks'),
    ];
    // Four shelves of books, standing, leaning, with gaps.
    for (let shelf = 0; shelf < 4; shelf++) {
      const z0 = 6 + shelf * 13;
      parts.push(box(-6, 22, -5, 6, z0, z0 + 1.4, WOOD_LIGHT, 'planks'));
      let x = -5.4;
      while (x < 20.5) {
        const w = 1.2 + r() * 1.6, hgt = 7 + r() * 4;
        if (r() < 0.12) { x += 2.2; continue; }
        parts.push(box(x, x + w, -3.5, 4.5, z0 + 1.4, z0 + 1.4 + hgt, spines[Math.floor(r() * spines.length)]!));
        x += w + 0.1;
      }
    }
    // A ladder, a globe and a small lamp on top.
    parts.push(ball(4, 0, 64, 3, '#4f9a9a'), cyl(4, 0, 0.8, 61, 62.5, WOOD_DARK), pix(2.4, -1, 65, 1, 1, '#aee4e4'));
    parts.push(cyl(18, 0, 1.4, 61, 66, '#d6b25a'), box(16, 20.4, -2.2, 2.2, 66, 70, '#fff0c0'), glow(18, 0, 68, 14, '#ffd070', 0.55));
    return parts;
  })(),
};

const fontaine: Recipe = {
  name: 'Grande fontaine',
  size: [2, 2],
  parts: [
    // Basin: four stone walls around a water surface.
    box(-7, 23, -7, 23, 0, 4, STONE, 'stone'),
    quad('#3f9ad0', 'water', [-5, -5, 4.4], [21, -5, 4.4], [21, 21, 4.4], [-5, 21, 4.4]),
    box(-8, 24, -8, -5, 0, 9, STONE, 'stone'), box(-8, -5, -5, 24, 0, 9, STONE, 'stone'),
    box(21, 24, -5, 24, 0, 9, STONE, 'stone'), box(-5, 21, 21, 24, 0, 9, STONE, 'stone'),
    quad('#3f9ad0', 'water', [-5, -5, 7], [21, -5, 7], [21, 21, 7], [-5, 21, 7]),
    box(-8.4, 24.4, -8.4, -4.6, 9, 10.5, '#b4b6bc', 'stone'), box(-8.4, -4.6, -4.6, 24.4, 9, 10.5, '#b4b6bc', 'stone'),
    box(20.6, 24.4, -4.6, 24.4, 9, 10.5, '#b4b6bc', 'stone'), box(-4.6, 20.6, 20.6, 24.4, 9, 10.5, '#b4b6bc', 'stone'),
    // Central column, two bowls, a jet.
    cyl(8, 8, 4.5, 7, 16, '#aeb0b6', '#c4c6cc'), cyl(8, 8, 9, 16, 19, '#b4b6bc', '#3f9ad0'), cyl(8, 8, 2, 19, 28, '#aeb0b6', '#c4c6cc'),
    cyl(8, 8, 6, 28, 30.5, '#b4b6bc', '#4aa8d8'), ball(8, 8, 36, 3, '#bfe8f8'),
    pix(7, 8, 31, 1, 7, '#e6f6ff'), pix(4, 8, 31, 0.5, 4, '#bfe8f8'), pix(11, 8, 31, 0.5, 4, '#bfe8f8'),
    // Ripples and lily pads.
    pix(-1, 4, 7.2, 3, 0.5, '#bfe8f8'), pix(14, 14, 7.2, 3, 0.5, '#bfe8f8'), pix(0, 16, 7.2, 3, 0.5, '#bfe8f8'),
    ball(15, 2, 7.6, 2, '#4f9a5a'), pix(15, 1, 9, 1, 1, '#ffb6c8'), ball(1, 14, 7.6, 1.6, '#4f9a5a'),
    glow(8, 8, 20, 30, '#8fd0ff', 0.35),
  ],
};

const grandArbre: Recipe = {
  name: 'Grand chêne',
  size: [2, 2],
  parts: (() => {
    const r = rng(21);
    const parts: Part[] = [
      // Roots and trunk, bark made of logs.
      box(2, 14, 2, 14, 0, 4, '#6a4a2c', 'logs'),
      cyl(8, 8, 4.6, 0, 34, '#7a5230', '#8a6240'),
      box(5, 11, 5, 11, 20, 50, '#6a4a2c', 'logs'),
    ];
    // Foliage: back to front, high to low, clumps of spheres.
    const clumps: [number, number, number, number][] = [
      [3, 3, 56, 13], [13, 3, 56, 12], [3, 13, 56, 12], [13, 13, 58, 13], [8, 8, 66, 14],
      [-1, 8, 46, 11], [17, 8, 46, 11], [8, -1, 46, 11], [8, 17, 48, 11],
    ];
    for (const [x, y, z, rad] of clumps) parts.push(ball(x, y, z, rad, LEAF[Math.floor(r() * 3)]!));
    for (let k = 0; k < 16; k++) {
      parts.push(ball(-2 + r() * 20, -2 + r() * 20, 44 + r() * 28, 3.5 + r() * 3, LEAF[Math.floor(r() * LEAF.length)]!));
    }
    // Light catching the leaves, and a few acorns.
    for (let k = 0; k < 14; k++) parts.push(pix(-3 + r() * 22, -3 + r() * 22, 46 + r() * 28, 1, 1, '#9ad66a'));
    for (let k = 0; k < 3; k++) parts.push(ball(2 + r() * 12, 2 + r() * 12, 47 + r() * 6, 0.9, '#c98f3a'));
    return parts;
  })(),
};

const tableBanquet: Recipe = {
  name: 'Table de banquet',
  size: [3, 1],
  parts: (() => {
    const parts: Part[] = [
      // Benches, then the table.
      box(-7, 39, -8, -4.5, 7, 9, WOOD_LIGHT, 'planks'), box(-6, -4.5, -8, -4.5, 0, 7, WOOD_DARK), box(37, 38.5, -8, -4.5, 0, 7, WOOD_DARK),
      box(-7, 39, 4.5, 8, 7, 9, WOOD_LIGHT, 'planks'), box(-6, -4.5, 4.5, 8, 0, 7, WOOD_DARK), box(37, 38.5, 4.5, 8, 0, 7, WOOD_DARK),
      box(-3, -1, -3, -1, 0, 14, WOOD_DARK), box(-3, -1, 1, 3, 0, 14, WOOD_DARK),
      box(35, 37, -3, -1, 0, 14, WOOD_DARK), box(35, 37, 1, 3, 0, 14, WOOD_DARK),
      box(-8, 40, -4, 4, 14, 16.5, WOOD, 'planks'),
      // A runner down the middle.
      box(-6, 38, -1.5, 1.5, 16.5, 16.9, '#a8473d', 'stripes'),
    ];
    // Place settings, both sides.
    for (let k = 0; k < 4; k++) {
      const x = 2 + k * 9.5;
      parts.push(cyl(x, -2.6, 1.8, 16.5, 17.2, '#f4efe6', '#fffaf0'), cyl(x, 2.6, 1.8, 16.5, 17.2, '#f4efe6', '#fffaf0'));
      parts.push(cyl(x + 3, -2.8, 0.6, 16.5, 19.5, '#d6b25a', '#f0d27a'), cyl(x + 3, 2.8, 0.6, 16.5, 19.5, '#d6b25a', '#f0d27a'));
    }
    // Bread, fruit, two candles.
    parts.push(box(10, 16, -1, 1, 16.9, 19, '#d49a52', 'weave'), ball(18, 0, 19, 2.6, '#c8d23a'), ball(20, 0.6, 18.6, 1.8, '#e0503a'), ball(19, -1, 18.6, 1.8, '#e0503a'));
    for (const x of [2, 31]) {
      parts.push(cyl(x, 0, 1, 16.9, 23, '#f4efe6'), pix(x - 0.3, -0.3, 23.5, 0.5, 1.5, '#ffe28a'), glow(x, 0, 25, 14, '#ffd070', 0.6));
    }
    return parts;
  })(),
};

export function bigPieces(): BigPiece[] {
  return [
    { key: 'grandlit', category: 'sleep', recipe: grandLit, extras: { price: 120, interaction: 'lie' } },
    { key: 'canapeangle', category: 'seat', recipe: canapeAngle, extras: { price: 180, interaction: 'sit' } },
    { key: 'pianosalon', category: 'decor', recipe: piano, extras: { price: 300 } },
    { key: 'bibliotheque', category: 'storage', recipe: bibliotheque, extras: { price: 150 } },
    { key: 'fontaine', category: 'decor', recipe: fontaine, extras: { price: 240 } },
    { key: 'grandchene', category: 'decor', recipe: grandArbre, extras: { price: 200, anim: 'sway' } },
    { key: 'banquet', category: 'table', recipe: tableBanquet, extras: { price: 140 } },
  ];
}
