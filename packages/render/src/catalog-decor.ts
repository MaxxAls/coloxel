import type { BigPiece } from './catalog-big';
import type { Part, Recipe, Texture } from './types';

// Small pieces that make a room feel lived in: things to put along the walls, in the corners, next to a sofa.
// A room holds one piece per cell, so the pieces that sit on furniture come with their furniture (flowers on
// their stand, a computer on its desk). Same recipe format as everything else: the viewer sees the top, the
// side facing +y (on the left) and the side facing +x (on the right); parts go from the back to the front.

const box = (x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, c: string, tex?: Texture): Part => ({
  t: 'box', x0, x1, y0, y1, z0, z1, c, ...(tex ? { tex } : {}),
});
const cyl = (x: number, y: number, r: number, z0: number, z1: number, side: string, top?: string): Part => ({
  t: 'cyl', x, y, r, z0, z1, side, ...(top ? { top } : {}),
});
const ball = (x: number, y: number, z: number, r: number, c: string): Part => ({ t: 'sphere', x, y, z, r, c });
const quad = (c: string, ...pts: [number, number, number][]): Part => ({ t: 'quad', pts, c });
const pix = (x: number, y: number, z: number, w: number, h: number, c: string): Part => ({ t: 'pix', x, y, z, w, h, c });
const glow = (x: number, y: number, z: number, r: number, c: string, a = 0.6): Part => ({ t: 'glow', x, y, z, r, c, a });

const INK = '#2a2140';
const STEEL = '#8a8fa0';
const STEEL_DARK = '#5a5f70';
const WOOD = '#8b5e3c';
const WOOD_DARK = '#5e3d24';
const WOOD_LIGHT = '#c98f5e';

/** Four thin legs at the corners of a rectangle. */
const legs = (x0: number, x1: number, y0: number, y1: number, z1: number, c: string, t = 0.6): Part[] =>
  [[x0, y0], [x1, y0], [x0, y1], [x1, y1]].map(([x, y]) => box(x! - t, x! + t, y! - t, y! + t, 0, z1, c));

const guitar: Recipe = {
  name: 'Guitare sur pied',
  parts: [
    // The stand: a tripod and an upright.
    box(-3.4, -2.6, -2.4, 2.4, 0, 1, INK),
    box(-3.4, 2, -0.4, 0.4, 0, 1, INK),
    box(-3.4, -2.6, -0.4, 0.4, 1, 14, INK),
    // The body: two rounded lobes, a sound hole, a bridge.
    cyl(-1.6, 0, 3.6, 3, 4.4, '#b8622c', '#e08a44'),
    cyl(-1.6, 0, 2.8, 4.4, 5.8, '#c86e34', '#f0a058'),
    quad('#c86e34', [-1, -3.2, 3], [-1, 3.2, 3], [-1, 2.4, 12], [-1, -2.4, 12]),
    quad('#f0a058', [-0.6, -3, 3.4], [-0.6, 3, 3.4], [-0.6, 2.2, 11.6], [-0.6, -2.2, 11.6]),
    ball(-0.4, 0, 8.6, 1.1, '#3a2316'),
    box(-0.6, -0.2, -1.4, 1.4, 5, 5.6, '#3a2316'),
    // The neck, the frets and the head.
    box(-0.9, -0.3, -0.5, 0.5, 12, 24, '#4a2f1c'),
    pix(-0.3, -0.3, 15, 0.5, 0.5, '#e6e0f0'),
    pix(-0.3, -0.3, 18, 0.5, 0.5, '#e6e0f0'),
    pix(-0.3, -0.3, 21, 0.5, 0.5, '#e6e0f0'),
    box(-1, -0.2, -0.9, 0.9, 24, 27, '#2a1a10'),
    quad('#f4efe6', [-0.25, -0.15, 5.2], [-0.25, 0.15, 5.2], [-0.25, 0.15, 24], [-0.25, -0.15, 24]),
  ],
};

const speaker: Recipe = {
  name: 'Enceinte colonne',
  parts: [
    box(-3.4, 3.4, -3.4, 3.4, 0, 1, INK),
    box(-3, 3, -3, 3, 1, 28, '#2e2a3a'),
    box(-3.2, 3.2, -3.2, 3.2, 28, 29, '#4a4560'),
    // Two cones and a tweeter on the front, with a blue light.
    { t: 'circle', x: 3, y: 0, z: 9, r: 2.2, c: '#1b1825', c2: '#5a5670' },
    { t: 'circle', x: 3, y: 0, z: 17, r: 2.2, c: '#1b1825', c2: '#5a5670' },
    { t: 'circle', x: 3, y: 0, z: 24, r: 1.1, c: '#1b1825', c2: '#8a86a0' },
    pix(3, -2, 3, 0.5, 0.5, '#5ab8ff'),
    glow(3, -2, 3, 3, '#5ab8ff', 0.4),
  ],
};

const books: Recipe = {
  name: 'Pile de livres',
  parts: [
    box(-4.5, 3.5, -3, 3, 0, 1.6, '#c0445a'),
    box(-4.3, 3.3, -2.8, 2.8, 0.2, 1.4, '#f4efe6'),
    box(-4, 4, -3.4, 2.6, 1.6, 3, '#3f74c8'),
    box(-3.8, 3.8, -3.2, 2.4, 1.8, 2.8, '#f4efe6'),
    box(-3.6, 3, -2.4, 3.2, 3, 4.6, '#2f9e7a'),
    box(-3.4, 2.8, -2.2, 3, 3.2, 4.4, '#f4efe6'),
    box(-3, 3.4, -2.8, 2, 4.6, 5.8, '#ffc857'),
    box(-2.8, 3.2, -2.6, 1.8, 4.8, 5.6, '#f4efe6'),
    // A mug of tea on top.
    cyl(0, -0.4, 1.4, 5.8, 8.4, '#f4efe6', '#7a4a2a'),
    box(1.2, 2, -0.8, 0, 6.4, 7.8, '#f4efe6'),
  ],
};

const arcLamp: Recipe = {
  name: 'Lampe arc',
  parts: [
    // A marble foot, a curved steel arm, a dome shade.
    box(-5, -1.4, -5, -1.4, 0, 2.2, '#e6e0f0', 'marble'),
    box(-3.6, -2.8, -3.6, -2.8, 2.2, 30, STEEL),
    box(-3.6, 2, -3.6, -2.8, 30, 31, STEEL),
    box(1.2, 2, -3.6, 3.6, 30, 31, STEEL),
    box(1.2, 2, 2.8, 3.6, 24, 31, STEEL),
    cyl(1.6, 3.2, 3.2, 21, 24.6, '#2e2a3a', '#4a4560'),
    cyl(1.6, 3.2, 2.4, 20.2, 21, '#fff3c0', '#fff8e0'),
    glow(1.6, 3.2, 19, 12, '#ffd870', 0.7),
  ],
};

const coatRack: Recipe = {
  name: 'Portemanteau',
  parts: [
    cyl(0, 0, 3, 0, 1, WOOD_DARK, WOOD),
    cyl(0, 0, 0.7, 1, 34, WOOD, WOOD_LIGHT),
    ball(0, 0, 34.6, 1.2, WOOD_LIGHT),
    // A coat, a scarf and a hat hanging on the hooks.
    box(-2.6, -1, -2.4, 2.4, 18, 31, '#4a5a8a'),
    box(-2.8, -0.8, -2.6, 2.6, 29, 31.4, '#3a4870'),
    box(1, 2.4, -1, 1, 20, 31.4, '#d9605a'),
    pix(1.2, 1, 20, 1, 1, '#ffc857'),
    cyl(0.4, 2, 2.2, 31, 32, '#3a2a1a', '#5a3a22'),
    cyl(0.4, 2, 1.3, 32, 34, '#3a2a1a', '#4a3020'),
  ],
};

const standingMirror: Recipe = {
  name: 'Psyché dorée',
  parts: [
    box(-2.4, -1, -5, -4, 0, 30, WOOD_LIGHT),
    box(-2.4, -1, 4, 5, 0, 30, WOOD_LIGHT),
    box(-2.4, 3, -5, -4, 0, 1, WOOD_LIGHT),
    box(-2.4, 3, 4, 5, 0, 1, WOOD_LIGHT),
    // The glass, framed in gold, with two streaks of light.
    box(-1.6, -0.8, -4, 4, 4, 28, '#e0a030'),
    quad('#b8d8f0', [-0.8, -3.4, 5], [-0.8, 3.4, 5], [-0.8, 3.4, 27], [-0.8, -3.4, 27]),
    quad('#e6f4ff', [-0.8, -2.6, 20], [-0.8, -1.6, 20], [-0.8, 1, 27], [-0.8, 0, 27]),
    quad('#e6f4ff', [-0.8, -1, 12], [-0.8, -0.4, 12], [-0.8, 2.4, 19], [-0.8, 1.8, 19]),
  ],
};

const crates: Recipe = {
  name: 'Caisses en bois',
  parts: [
    box(-6, 1, -6, 1, 0, 7, WOOD, 'planks'),
    box(-5.6, 0.6, -5.6, 0.6, 7, 13, WOOD_LIGHT, 'planks'),
    box(1.4, 6.5, -2, 4, 0, 6, '#a87444', 'planks'),
    box(-4, 3, 2, 7, 0, 5, WOOD_LIGHT, 'planks'),
    // Stencilled marks and a few apples in the open crate.
    pix(1, -3, 4, 2, 1, WOOD_DARK),
    pix(6.5, 0, 3, 1.5, 1, WOOD_DARK),
    ball(-1.8, 4, 5.6, 1.1, '#d9382d'),
    ball(0.2, 5, 5.6, 1.1, '#e85a40'),
    ball(-0.6, 3.4, 6.2, 1.1, '#6fbf4a'),
  ],
};

const camera: Recipe = {
  name: 'Caméra sur trépied',
  parts: [
    // Three legs spreading from the head of the tripod.
    quad(INK, [-0.3, 0, 22], [0.3, 0, 22], [-4.6, -3, 0], [-5.2, -3, 0]),
    quad(INK, [-0.3, 0, 22], [0.3, 0, 22], [-4.6, 3.4, 0], [-5.2, 3.4, 0]),
    quad('#3a3450', [-0.3, 0, 22], [0.3, 0, 22], [4.8, 0.3, 0], [4.2, 0.3, 0]),
    box(-0.8, 0.8, -0.8, 0.8, 21, 23, '#3a3450'),
    // The camera: a body, a lens, a red light and a viewfinder.
    box(-3.4, 2.4, -2, 2, 23, 28, '#2a2833'),
    box(-3, 2, -1.6, 1.6, 28, 29.4, '#3a3845'),
    cyl(3.6, 0, 1.6, 23.6, 27, '#1b1825', '#4a4860'),
    { t: 'circle', x: 5.2, y: 0, z: 25.3, r: 1.2, c: '#2a2a3a', c2: '#6aa6ee' },
    pix(2.4, 1.6, 27.6, 0.5, 0.5, '#ff4d4d'),
    glow(2.4, 1.6, 27.6, 2.4, '#ff4d4d', 0.5),
  ],
};

const bonsai: Recipe = {
  name: 'Bonsaï',
  parts: [
    box(-4.5, 4.5, -3.2, 3.2, 0, 3, '#3f6aa8'),
    box(-4.2, 4.2, -2.9, 2.9, 3, 3.4, '#5a3a22'),
    pix(-3, 3.2, 1.2, 6, 0.5, '#6a90d0'),
    // A twisted trunk and three cloud-like crowns.
    box(-0.6, 0.6, -0.6, 0.6, 3.4, 8, '#5a3a22'),
    box(-0.6, 2.6, -0.6, 0.6, 7, 8.2, '#5a3a22'),
    box(1.6, 2.6, -0.6, 0.6, 8, 11, '#5a3a22'),
    ball(-2.4, 0, 9.4, 2.6, '#2f7a3a'),
    ball(2.2, -0.6, 12.4, 2.8, '#3f9a46'),
    ball(-0.2, 1, 14.6, 2.4, '#58b552'),
    pix(2, -1, 14, 1, 0.5, '#a8f0a0'),
  ],
};

const flowerStand: Recipe = {
  name: 'Sellette fleurie',
  parts: [
    // A round wooden stand, a blue vase, a bunch of flowers.
    cyl(0, 0, 2.6, 0, 1, WOOD_DARK, WOOD),
    cyl(0, 0, 0.9, 1, 13, WOOD, WOOD_LIGHT),
    cyl(0, 0, 3.6, 13, 14, WOOD_DARK, WOOD_LIGHT),
    cyl(0, 0, 1.8, 14, 19, '#3f74c8', '#2f5aa0'),
    cyl(0, 0, 1.2, 19, 20, '#5a90e0', '#2f5aa0'),
    quad('#3f9a46', [-0.2, -2.6, 21], [0, 0, 20], [0.2, -3.6, 24], [0, -2.4, 23.4]),
    quad('#3f9a46', [0.2, 2.6, 21], [0, 0, 20], [-0.2, 3.6, 24], [0, 2.4, 23.4]),
    ball(-1.4, -2.2, 25, 1.5, '#ff6f91'),
    ball(1.6, 2, 24.4, 1.5, '#ffc857'),
    ball(0.2, 0, 27, 1.6, '#ff8fb1'),
    ball(-1.6, 1.8, 26.4, 1.3, '#b78cff'),
    ball(1.8, -1.6, 26.8, 1.3, '#f4efe6'),
  ],
};

const wasteBin: Recipe = {
  name: 'Corbeille à papier',
  parts: [
    cyl(0, 0, 2.8, 0, 7, STEEL_DARK, '#2e2a3a'),
    cyl(0, 0, 3, 7, 7.6, STEEL, '#2e2a3a'),
    // Crumpled paper sticking out.
    ball(-0.6, 0.4, 7.6, 1.3, '#f4efe6'),
    ball(1, -0.6, 8, 1.1, '#e6e0d0'),
  ],
};

const computerDesk: Recipe = {
  name: 'Bureau d’ordinateur',
  parts: [
    ...legs(-6, 6, -7, 7, 12, STEEL_DARK),
    box(-6.6, 6.6, -7.6, 7.6, 12, 13.2, '#7aa8d8'),
    box(-6.4, 6.4, -7.4, 7.4, 13.2, 13.4, '#a8d0f0'),
    // The screen on its foot, a keyboard, a mouse, a mug and a small plant.
    box(-5, -3.6, -1.2, 1.2, 13.4, 14, INK),
    box(-4.6, -4, -0.4, 0.4, 14, 17, INK),
    box(-5.2, -3.8, -6, 6, 17, 26, '#1b1825'),
    quad('#3e6fb0', [-3.8, -5.4, 17.8], [-3.8, 5.4, 17.8], [-3.8, 5.4, 25.2], [-3.8, -5.4, 25.2]),
    quad('#8ec0f5', [-3.8, -4.6, 24.4], [-3.8, -3, 24.4], [-3.8, -0.4, 18.6], [-3.8, -2, 18.6]),
    box(-1.6, 2.4, -4.4, 4.4, 13.4, 14.2, '#e6e0f0'),
    pix(0.2, -3, 14.2, 3, 0.5, '#b8b2d0'),
    box(0.6, 2, 5.2, 6.2, 13.4, 14.2, '#e6e0f0'),
    cyl(3.6, -5.6, 1, 13.4, 15.6, '#ff6f91', '#7a4a2a'),
    cyl(-4.6, 6.2, 1, 13.4, 15, '#c0683a', '#5a3a22'),
    ball(-4.6, 6.2, 16.4, 1.5, '#3f9a46'),
  ],
};

const vending: Recipe = {
  name: 'Distributeur de boissons',
  parts: [
    box(-5, 5, -6, 6, 0, 2, '#2a2833'),
    box(-5, 5, -6, 6, 2, 44, '#d9382d'),
    box(-5.2, 5.2, -6.2, 6.2, 44, 45, '#ff5a4a'),
    // A lit window with rows of cans, a slot, buttons and the tray.
    quad('#fff3e0', [5, -5, 18], [5, 2, 18], [5, 2, 41], [5, -5, 41]),
    ...[22, 28, 34].flatMap((z) =>
      [-4, -2, 0].map((y, k) => box(4.6, 5, y, y + 1.4, z, z + 3.4, ['#3f74c8', '#2f9e7a', '#ffc857'][k]!)),
    ),
    box(4.6, 5.1, -5, 2, 20.6, 21, '#c8c0b0'),
    box(4.6, 5.1, -5, 2, 26.6, 27, '#c8c0b0'),
    box(4.6, 5.1, -5, 2, 32.6, 33, '#c8c0b0'),
    quad('#2a2833', [5, 3, 30], [5, 5, 30], [5, 5, 40], [5, 3, 40]),
    pix(5, 3.6, 38, 1, 0.5, '#7dffb0'),
    pix(5, 3.6, 35, 0.5, 0.5, '#ffc857'),
    pix(5, 3.6, 33.6, 0.5, 0.5, '#ffc857'),
    quad('#1b1825', [5, -4.4, 6], [5, 1.6, 6], [5, 1.6, 11], [5, -4.4, 11]),
    glow(5, -1.5, 30, 14, '#fff3c0', 0.5),
  ],
};

const officeChair: Recipe = {
  name: 'Chaise de bureau',
  parts: [
    // Five wheels on a star, a gas lift, a padded seat, a tall back.
    ...[0, 1, 2, 3, 4].map((k) => {
      const a = (k / 5) * Math.PI * 2 + 0.3;
      return box(Math.cos(a) * 4 - 0.6, Math.cos(a) * 4 + 0.6, Math.sin(a) * 4 - 0.6, Math.sin(a) * 4 + 0.6, 0, 1.2, '#1b1825');
    }),
    quad('#3a3845', [-4, -0.4, 1.6], [4, 0.4, 1.6], [4, 0.4, 2], [-4, -0.4, 2]),
    quad('#3a3845', [-0.4, -4, 1.6], [0.4, 4, 1.6], [0.4, 4, 2], [-0.4, -4, 2]),
    cyl(0, 0, 0.7, 2, 7, STEEL, STEEL),
    box(-4.6, -2.8, -3.8, 3.8, 9, 22, '#2e2a3a'),
    box(-4.4, -2.6, -3.4, 3.4, 10, 21, '#3e3a52'),
    box(-4, 4.4, -4, 4, 7, 9.6, '#2e2a3a'),
    box(-3.6, 4, -3.6, 3.6, 9.6, 10.2, '#3e3a52'),
    box(-2.6, 2.6, -4.6, -3.8, 10, 13.2, '#1b1825'),
    box(-2.6, 2.6, 3.8, 4.6, 10, 13.2, '#1b1825'),
  ],
};

const sideTable: Recipe = {
  name: 'Guéridon et lampe',
  parts: [
    cyl(0, 0, 2.4, 0, 1, WOOD_DARK, WOOD),
    cyl(0, 0, 0.8, 1, 11, WOOD, WOOD_LIGHT),
    cyl(0, 0, 4.4, 11, 12.2, WOOD_DARK, WOOD_LIGHT),
    // A small lamp with a pleated shade, a book and glasses.
    cyl(-1.4, -1, 1.2, 12.2, 13, '#e0a030', '#ffc857'),
    cyl(-1.4, -1, 0.3, 13, 17, '#e0a030'),
    cyl(-1.4, -1, 2.6, 17, 21.4, '#f4e2b8', '#fff3d6'),
    box(0.6, 3.4, 0.4, 3, 12.2, 13, '#3f74c8'),
    box(0.8, 3.2, 0.6, 2.8, 13, 13.3, '#f4efe6'),
    glow(-1.4, -1, 19, 10, '#ffd870', 0.65),
  ],
};

const recordPlayer: Recipe = {
  name: 'Platine vinyle',
  parts: [
    ...legs(-4.4, 4.4, -6, 6, 9, WOOD_DARK, 0.5),
    box(-5, 5, -6.6, 6.6, 9, 14, WOOD, 'wood'),
    quad(WOOD_DARK, [5, -6, 10], [5, 6, 10], [5, 6, 13], [5, -6, 13]),
    // The turntable on top, a record, the arm, and records leaning below.
    box(-4.6, 4.6, -6.2, 6.2, 14, 15, '#2a2833'),
    cyl(-0.4, -1.4, 3.8, 15, 15.4, '#1b1825', '#2e2a3a'),
    { t: 'circle', x: -0.4, y: -1.4, z: 15.4, r: 1.2, c: '#d9382d', c2: '#ffc857' },
    box(2.4, 3.2, 2.4, 4.6, 15, 16.4, STEEL),
    box(-0.4, 3.2, 2.4, 3, 16, 16.6, STEEL),
    box(-3.8, 3.8, -5.4, -4.8, 1, 8, '#3f74c8'),
    box(-3.8, 3.8, -4.6, -4, 1, 7.6, '#ff8fb1'),
    box(-3.8, 3.8, -3.8, -3.2, 1, 8.2, '#ffc857'),
  ],
};

const grayRug: Recipe = {
  name: 'Tapis gris',
  parts: [
    box(-7.6, 7.6, -7.6, 7.6, 0, 0.8, '#7a7686', 'weave'),
    box(-6.4, 6.4, -6.4, 6.4, 0.8, 1, '#9a96a8', 'weave'),
    box(-4.6, 4.6, -4.6, 4.6, 1, 1.1, '#b4b0c2', 'weave'),
  ],
};

export function decorPieces(): BigPiece[] {
  return [
    { key: 'guitare', category: 'decor', recipe: guitar, extras: { price: 45 } },
    { key: 'enceinte', category: 'tech', recipe: speaker, extras: { price: 50 } },
    { key: 'pilelivres', category: 'decor', recipe: books, extras: { price: 15 } },
    { key: 'lampearc', category: 'light', recipe: arcLamp, extras: { price: 60, glow: { z: 19, color: 0xffd870, radius: 60 } } },
    { key: 'portemanteau', category: 'storage', recipe: coatRack, extras: { price: 30 } },
    { key: 'miroirpied', category: 'decor', recipe: standingMirror, extras: { price: 45 } },
    { key: 'caisses', category: 'storage', recipe: crates, extras: { price: 20 } },
    { key: 'camera', category: 'tech', recipe: camera, extras: { price: 80 } },
    { key: 'bonsai', category: 'decor', recipe: bonsai, extras: { price: 40, anim: 'sway' } },
    { key: 'sellette', category: 'decor', recipe: flowerStand, extras: { price: 35, anim: 'sway' } },
    { key: 'corbeille', category: 'decor', recipe: wasteBin, extras: { price: 10 } },
    { key: 'bureauordi', category: 'tech', recipe: computerDesk, extras: { price: 120, glow: { z: 22, color: 0x6aa6ee, radius: 40 } } },
    { key: 'distributeur', category: 'tech', recipe: vending, extras: { price: 150, glow: { z: 30, color: 0xfff0c0, radius: 56 } } },
    { key: 'chaisebureau', category: 'seat', recipe: officeChair, extras: { price: 45, interaction: 'sit' } },
    { key: 'gueridon', category: 'light', recipe: sideTable, extras: { price: 40, glow: { z: 19, color: 0xffd870, radius: 46 } } },
    { key: 'platine', category: 'tech', recipe: recordPlayer, extras: { price: 70 } },
    { key: 'tapisgris', category: 'decor', recipe: grayRug, extras: { price: 25, walkable: true } },
  ];
}
