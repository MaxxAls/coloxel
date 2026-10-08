import type { CatalogueEntry, FurnitureCategory } from './catalog';
import type { Part, Recipe, Texture } from './types';

// Pieces that hang on a wall. A recipe is drawn against the plane x = -8, which is the left wall seen from the
// room (a cell is 16 wide along y), and the game turns it once for the right wall. The floor is z = 0 and the wall
// is 58 high: pieces live between about 14 and 54.

type Extras = Partial<Omit<CatalogueEntry, 'key' | 'name' | 'category' | 'recipe'>>;
export interface WallPiece {
  key: string;
  category: FurnitureCategory;
  recipe: Recipe;
  extras: Extras;
}

const box = (x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, c: string, tex?: Texture): Part => ({
  t: 'box', x0, x1, y0, y1, z0, z1, c, ...(tex ? { tex } : {}),
});
const ball = (x: number, y: number, z: number, r: number, c: string): Part => ({ t: 'sphere', x, y, z, r, c });
const pix = (x: number, y: number, z: number, w: number, h: number, c: string): Part => ({ t: 'pix', x, y, z, w, h, c });
const quad = (c: string, tex: Texture | undefined, ...pts: [number, number, number][]): Part => ({ t: 'quad', pts, c, ...(tex ? { tex } : {}) });
const glow = (x: number, y: number, z: number, r: number, c: string, a = 0.6): Part => ({ t: 'glow', x, y, z, r, c, a });

const WOOD = '#9a6a3e';
const WOOD_DARK = '#6a4628';
const WOOD_LIGHT = '#c98f5e';
const GOLD = '#d6b25a';

const seaWindow: Recipe = {
  name: 'Fenêtre sur la mer',
  parts: [
    // Frame, then the view: sky, sea, sun, a sail.
    box(-8, -6.6, -6.4, 6.4, 15, 53, WOOD, 'wood'),
    box(-8, -7.2, -5, 5, 17.5, 50.5, '#8fd0f0'),
    box(-8, -7.1, -5, 5, 17.5, 31, '#3f9ad0', 'water'),
    pix(-7.1, 2.2, 44, 2.4, 2.4, '#fff2a0'), pix(-7.1, 2.8, 43, 3.6, 0.5, '#fff8c8'),
    pix(-7.1, -1.5, 34, 0.5, 4, '#f4efe6'), box(-8, -7.1, -2.4, -0.6, 31, 31.8, WOOD_DARK),
    quad('#f4efe6', undefined, [-7.1, -2.2, 32], [-7.1, -0.8, 32], [-7.1, -1.6, 38]),
    pix(-7.1, 3, 36, 2.5, 0.5, '#e6f6ff'), pix(-7.1, -4, 28, 3, 0.5, '#bfe8f8'),
    // Cross bars, sill and curtains.
    box(-8, -6.8, -0.4, 0.4, 17.5, 50.5, WOOD), box(-8, -6.8, -5, 5, 33.2, 34.2, WOOD),
    box(-8, -5.4, -7, 7, 13, 15, WOOD_LIGHT, 'planks'),
    box(-7.6, -6.2, -6.4, -3.6, 18, 54, '#c4504a', 'fabric'), box(-7.6, -6.2, 3.6, 6.4, 18, 54, '#c4504a', 'fabric'),
    box(-8, -5.6, -7, 7, 53, 55, WOOD_DARK), ball(-6.5, -6.6, 54.4, 1.2, GOLD), ball(-6.5, 6.6, 54.4, 1.2, GOLD),
  ],
};

const landscapePainting: Recipe = {
  name: 'Tableau de campagne',
  parts: [
    box(-8, -6.8, -6, 6, 22, 52, GOLD, 'wood'),
    box(-8, -7.2, -5, 5, 24, 50, '#8fc8f0'),
    // Hills, back to front, each a little thicker than the one before.
    box(-8, -7.1, -5, 5, 24, 33, '#6aae5a'), box(-8, -7.0, -5, -0.5, 24, 31, '#4f9a46'), box(-8, -6.9, 0.5, 5, 24, 30, '#3f8a3a'),
    pix(-6.9, 2, 43, 2.6, 2.6, '#ffe36a'), pix(-6.9, -3.6, 41, 4, 1, '#ffffff'), pix(-6.9, -2.8, 42, 3, 1, '#ffffff'),
    box(-8, -6.8, -1.2, -0.6, 31, 37, '#7a5230'), ball(-6.8, -0.9, 38.4, 2.2, '#2f7a3a'),
    box(-8.2, -6.6, -6.4, 6.4, 51.2, 52.6, '#e6c878'), box(-8.2, -6.6, -6.4, 6.4, 21.4, 22.8, '#b8923a'),
  ],
};

/** A hexagon around (0, y, z) in the wall plane, for round things. */
const hex = (c: string, y: number, z: number, r: number, x = -6.6): Part =>
  quad(c, undefined,
    [x, y - r, z], [x, y - r / 2, z + r * 0.87], [x, y + r / 2, z + r * 0.87], [x, y + r, z], [x, y + r / 2, z - r * 0.87], [x, y - r / 2, z - r * 0.87]);

const clock: Recipe = {
  name: 'Horloge murale',
  parts: [
    hex(WOOD_DARK, 0, 40, 8, -7.4), hex('#f4efe6', 0, 40, 6.6, -6.9),
    // Twelve hour marks, two hands, a pin.
    ...[0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11].map((h) => pix(-6.7, Math.sin((h * Math.PI) / 6) * 5.2 - 0.25, 40 + Math.cos((h * Math.PI) / 6) * 5.2, h % 3 === 0 ? 0.9 : 0.5, h % 3 === 0 ? 0.9 : 0.5, '#2a2140')),
    quad('#2a2140', undefined, [-6.6, -0.3, 40], [-6.6, 0.3, 40], [-6.6, 0.3, 45.5], [-6.6, -0.3, 45.5]),
    quad('#2a2140', undefined, [-6.6, 0, 39.7], [-6.6, 3.6, 38.4], [-6.6, 3.8, 39], [-6.6, 0, 40.3]),
    ball(-6.6, 0, 40, 0.8, '#d94f4f'),
  ],
};

const wallShelf: Recipe = {
  name: 'Étagère murale',
  parts: [
    // Bracket, board, then what stands on it.
    box(-8, -7, -6.5, -5.3, 26, 30, WOOD_DARK), box(-8, -7, 5.3, 6.5, 26, 30, WOOD_DARK),
    box(-8, -3.6, -7, 7, 30, 31.6, WOOD_LIGHT, 'planks'),
    box(-7.4, -5.2, -6, -5, 31.6, 38, '#c4504a'), box(-7.4, -5.2, -5, -3.6, 31.6, 36.5, '#3f6fa0'), box(-7.4, -5.2, -3.6, -2.6, 31.6, 37.5, '#e0b03a'),
    box(-7.4, -5.2, -2.6, -1, 31.6, 35.5, '#4f8a5a'),
    ball(2.6, 0, 36, 2.6, '#58b552'), ball(1.4, -0.6, 37.6, 1.6, '#3f9a46'), box(-7, -4.2, 0.6, 4.6, 31.6, 34.4, '#d9d0c0', 'tile'),
    box(-7.2, -5, 4.8, 6.6, 31.6, 33.2, '#6a4628'), pix(-5, 5.4, 33.6, 1, 1, '#ffe08a'),
  ],
};

const sconce: Recipe = {
  name: 'Applique lumineuse',
  parts: [
    box(-8, -7.4, -2, 2, 34, 42, GOLD, 'metal'),
    box(-7.6, -5, -0.6, 0.6, 38, 39.4, GOLD, 'metal'),
    box(-6.4, -4.2, -3, 3, 38.6, 46, '#fff0c0', 'fabric'),
    ball(-5.3, 0, 40, 1.6, '#fffbe0'),
    glow(-5.3, 0, 40, 22, '#ffd070', 0.8),
  ],
};

const banner: Recipe = {
  name: 'Bannière',
  parts: [
    box(-8, -6.6, -6.4, 6.4, 52, 54, WOOD_DARK, 'wood'), ball(-7.3, -6.8, 53, 1.3, GOLD), ball(-7.3, 6.8, 53, 1.3, GOLD),
    box(-8, -7.3, -4.8, 4.8, 22, 52, '#4f7fb8', 'stripes'),
    quad('#f4efe6', undefined, [-7.25, -3.2, 42], [-7.25, 3.2, 42], [-7.25, 3.2, 36], [-7.25, 0, 32], [-7.25, -3.2, 36]),
    ball(-7.2, 0, 38.4, 1.7, '#e0b03a'), pix(-7.2, -0.4, 36.4, 0.8, 3.6, '#e0b03a'),
    // Fringe along the bottom.
    ...[-4.2, -2.4, -0.6, 1.2, 3].map((y) => pix(-7.2, y, 22, 0.8, 1.5, '#e0b03a')),
  ],
};

const photos: Recipe = {
  name: 'Cadres photo',
  parts: [
    box(-8, -7, -6.4, -1.4, 34, 46, WOOD_DARK), box(-8, -7.2, -5.6, -2.2, 35.2, 44.8, '#a8d8f0'), ball(-7.2, -3.9, 40, 1.8, '#f2c9a0'), box(-8, -7.1, -5.6, -2.2, 35.2, 38, '#5a7aa8'),
    box(-8, -7, 0.4, 6.4, 24, 32, WOOD_LIGHT), box(-8, -7.2, 1.2, 5.6, 24.8, 31.2, '#ffd9a0'), ball(-7.2, 3.4, 28.4, 1.5, '#e0503a'), box(-8, -7.1, 1.2, 5.6, 24.8, 27, '#4f8a5a'),
    box(-8, -7, 1.6, 6.4, 38, 48, GOLD), box(-8, -7.2, 2.4, 5.6, 38.8, 47.2, '#e8e0f4'), ball(-7.2, 4, 43, 2, '#b78cff'), box(-8, -7.1, 2.4, 5.6, 38.8, 41, '#7a5ab8'),
  ],
};

export function wallPieces(): WallPiece[] {
  return [
    { key: 'fenetremer', category: 'decor', recipe: seaWindow, extras: { price: 70, wall: true } },
    { key: 'tableaucampagne', category: 'decor', recipe: landscapePainting, extras: { price: 50, wall: true } },
    { key: 'horlogemurale', category: 'decor', recipe: clock, extras: { price: 40, wall: true } },
    { key: 'etageremurale', category: 'storage', recipe: wallShelf, extras: { price: 45, wall: true } },
    { key: 'appliquelumineuse', category: 'light', recipe: sconce, extras: { price: 55, wall: true } },
    { key: 'banniere', category: 'decor', recipe: banner, extras: { price: 35, wall: true } },
    { key: 'cadresphoto', category: 'decor', recipe: photos, extras: { price: 40, wall: true } },
  ];
}
