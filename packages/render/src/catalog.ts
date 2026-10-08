import { bigPieces } from './catalog-big';
import { decorPieces } from './catalog-decor';
import { mechanismPieces } from './catalog-mechanisms';
import { wallPieces } from './catalog-walls';
import type { Part, Recipe } from './types';

// The base catalogue: free, unlimited furniture drawn by hand, in the same
// recipe format as player creations and rendered by the same engine. These are
// NOT creations: no number, no creator, no edition, never tradeable (the server
// stores them apart from `items`).

export type FurnitureCategory = 'sleep' | 'seat' | 'table' | 'storage' | 'light' | 'decor' | 'tech';

export interface CatalogueEntry {
  /** Stable identifier stored with each owned copy. Never reused for another object. */
  key: string;
  name: string;
  category: FurnitureCategory;
  /** In Pixels. 0 for the base furniture, which stays free and unlimited. */
  price: number;
  recipe: Recipe;
  /** The piece lights its surroundings: a warm halo at height z (recipe units), drawn by the client. */
  glow?: { z: number; color: number; radius: number; flicker?: boolean };
  /** A little life in the piece, played by the client. */
  anim?: 'sway' | 'flicker';
  /** A player can sit on the piece, or lie on it. The server decides who may, and when. */
  interaction?: 'sit' | 'lie';
  /**
   * Things can be put on it (a table, a desk, a chest of drawers): its top is this high, in recipe units. A small
   * piece placed on its cell stands on it instead of beside it.
   */
  surface?: number;
  /** A moving belt: whoever stands on it is carried one cell along its turn (0 +i, 1 +j, 2 -i, 3 -j) every second. */
  roller?: boolean;
  /** A booth: whoever steps in comes out of the next booth of the apartment. */
  teleport?: boolean;
  /** A crate: a click from a cell next to it slides it one cell away, if there is room. */
  pushable?: boolean;
  /**
   * A toy of chance, for show only: a die shows 1 to 6, a wheel stops on a colour, a bottle points at someone, an egg
   * cracks and hatches into a chick of a colour nobody knows in advance. Nothing is ever won or lost with them.
   */
  toy?: 'dice' | 'wheel' | 'bottle' | 'egg';
  /** Offered nowhere (not in the shop, not free to take): one only gets it another way (a chick hatches from an egg). */
  hidden?: boolean;
  /** Lies on the floor: players walk over it (rugs, pressure plates, portals) instead of around it. */
  walkable?: boolean;
  /** Clicking it sets off the mechanisms of the apartment (a button). */
  pressable?: boolean;
  /**
   * A gate: the owner opens and closes it with a click. Closed (the recipe) it blocks the way; open (`open`)
   * players walk through. The state is the placement's `lit` flag.
   */
  gate?: { open: Recipe };
  /** A click throws confetti for the whole room. */
  confetti?: boolean;
  /** Wears the look of whoever dresses it (the owner), drawn by the client from the placement's data. */
  mannequin?: boolean;
  /** Shows a short text written by the owner (the placement's data) to whoever clicks it. */
  sign?: boolean;
  /**
   * Other looks of the piece, played after the recipe in a loop (water running, lights chasing, fish swimming).
   * Every frame has the same size and footprint as the recipe; the server draws frame k on request (?f=k).
   */
  frames?: Recipe[];
  /** How long each frame stays, in milliseconds. */
  frameMs?: number;
  /**
   * Hangs on a wall instead of standing on the floor: the recipe is drawn against the plane x = -8 (the left wall)
   * and turned once for the right wall. It takes no floor tile and nobody walks around it.
   */
  wall?: boolean;
  /** A click changes the tune of the room (see jukebox.ts). */
  jukebox?: boolean;
  /** A click puts this hand item (see hand.ts) in the hand of a player standing next to the piece. */
  vendor?: number;
  /** A click starts a team game in the room (the colour race): the server runs it. */
  game?: 'paint' | 'freeze' | 'soccer';
  /** A football goal of this team (0 red, 1 blue): the other team scores in it. */
  goal?: 0 | 1;
}

/** A piece that gives light can be switched on and off by whoever owns the apartment. */
export const isSwitchable = (entry: CatalogueEntry | undefined): boolean => !!entry?.glow;

// ----- Tiny builders keeping the recipes readable ---------------------------------

const box = (x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, c: string): Part => ({
  t: 'box', x0, x1, y0, y1, z0, z1, c,
});
const cyl = (x: number, y: number, r: number, z0: number, z1: number, side: string, top?: string): Part => ({
  t: 'cyl', x, y, r, z0, z1, side, ...(top ? { top } : {}),
});
const ball = (x: number, y: number, z: number, r: number, c: string): Part => ({ t: 'sphere', x, y, z, r, c });
const quad = (c: string, ...pts: [number, number, number][]): Part => ({ t: 'quad', pts, c });
const pix = (x: number, y: number, z: number, w: number, h: number, c: string): Part => ({ t: 'pix', x, y, z, w, h, c });

/** Four legs at the corners of a footprint. */
const legs = (x: number, y: number, inset: number, z1: number, c: string, size = 1.2): Part[] =>
  [[-1, -1], [1, -1], [-1, 1], [1, 1]].map(([sx, sy]) =>
    box(sx! * (x - inset) - size / 2, sx! * (x - inset) + size / 2, sy! * (y - inset) - size / 2, sy! * (y - inset) + size / 2, 0, z1, c),
  );

const WOOD = '#8b5e3c';
const WOOD_DARK = '#6e4a2c';
const WOOD_LIGHT = '#c98f5e';
const CREAM = '#f4efe6';
const GOLD = '#ffc857';
const INK = '#2a2140';

/**
 * A padded block: the body, then a slightly smaller top layer, so that the edge reads as a rounded seam
 * (the engine draws a line between the two). Used for cushions, armrests and seats.
 */
const padded = (x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, c: string, top: string): Part[] => [
  box(x0, x1, y0, y1, z0, z1 - 0.9, c),
  box(x0 + 0.4, x1 - 0.4, y0 + 0.4, y1 - 0.4, z1 - 0.9, z1, top),
];

const bed: Recipe = {
  name: 'Lit douillet',
  parts: [
    ...legs(7, 6, 0.8, 2.4, WOOD_DARK, 1.6),
    box(-7, 7, -6.2, 6.2, 2.4, 5, WOOD),
    // A panelled headboard with gilded knobs, a low footboard.
    box(-8, -6.6, -6.6, 6.6, 2.4, 17, WOOD_DARK),
    quad(WOOD, [-6.6, -5.6, 7], [-6.6, -0.6, 7], [-6.6, -0.6, 15], [-6.6, -5.6, 15]),
    quad(WOOD, [-6.6, 0.6, 7], [-6.6, 5.6, 7], [-6.6, 5.6, 15], [-6.6, 0.6, 15]),
    ball(-7.3, -6.4, 17.6, 0.9, GOLD),
    ball(-7.3, 6.4, 17.6, 0.9, GOLD),
    // A thick mattress, two plump pillows.
    ...padded(-6.6, 6.6, -5.8, 5.8, 5, 8.4, CREAM, '#fffaf0'),
    ...padded(-6.3, -3.2, -5.2, -0.4, 8.4, 10.8, '#fff3d6', '#ffffff'),
    ...padded(-6.3, -3.2, 0.4, 5.2, 8.4, 10.8, '#ffe4ec', '#fff6f9'),
    // The duvet, its turned-down edge, and a fold hanging over the side.
    ...padded(-2.4, 6.9, -6.1, 6.1, 7.6, 10.4, '#e2483d', '#ff8a80'),
    box(-2.8, -1.4, -6.1, 6.1, 8, 10.8, '#ffa8a0'),
    quad('#d8382d', [-2.4, 6.1, 5.6], [6.9, 6.1, 5.6], [6.9, 6.1, 9.6], [-2.4, 6.1, 9.6]),
    pix(2, -3, 10.4, 1, 1, GOLD),
    pix(4.4, 1, 10.4, 1, 1, GOLD),
    pix(1, 3.4, 10.4, 1, 1, GOLD),
    box(6.6, 8, -6.6, 6.6, 2.4, 9, WOOD_DARK),
    box(6.4, 8.2, -6.8, 6.8, 9, 9.8, WOOD),
  ],
};

const chair: Recipe = {
  name: 'Chaise bistrot',
  parts: [
    ...legs(4.5, 4.5, 0.7, 7, WOOD_DARK),
    box(-4.5, 4.5, -4.5, 4.5, 7, 9, '#d9a05b'),
    box(-4.5, 4.5, -4.5, 4.5, 9, 9.6, '#f0be78'),
    box(-4.8, -3.4, -4.5, 4.5, 9, 18, '#d9a05b'),
    box(-4.8, -3.4, -3.5, 3.5, 12.5, 16, '#e8b46b'),
    pix(2, 2, 9.6, 2, 1, '#fff3d6'),
  ],
};

const table: Recipe = {
  name: 'Table ronde',
  parts: [
    cyl(0, 0, 4, 0, 1.2, '#8b5e3c', '#a8764a'),
    cyl(0, 0, 1.4, 1.2, 10, WOOD_DARK, '#8b5e3c'),
    cyl(0, 0, 7.4, 10, 12, WOOD_LIGHT, '#e0a874'),
    pix(-3, -2, 12, 2, 1, '#f6d0a4'),
    pix(3, 2, 12, 1, 1, '#f6d0a4'),
    cyl(-2, 1, 3.2, 12, 12.5, '#f4efe6', '#fffaf0'),
    cyl(2.5, -2, 1.1, 12, 16, '#4fc3c3', '#8ee0e0'),
    ball(2.5, -2, 17.4, 1.5, '#ff8fb1'),
    ball(3.4, -2.6, 16.6, 1, '#ffc857'),
    pix(-3, 0, 13, 1, 1, '#e2483d'),
    pix(-2, 1.4, 13, 1, 1, '#ffc857'),
  ],
};

const SOFA = { frame: '#2f5aa0', body: '#3f74c8', cushion: '#5a90e0', light: '#7fb0f2', wood: '#5e3d24' };
const sofa: Recipe = {
  name: 'Canapé câlin',
  parts: [
    // Feet, then the frame that the cushions sit in.
    ...[[-5.2, -7.2], [-5.2, 7.2], [5.2, -7.2], [5.2, 7.2]].map(([x, y]) => box(x! - 0.7, x! + 0.7, y! - 0.7, y! + 0.7, 0, 2, SOFA.wood)),
    box(-6, 6, -8, 8, 2, 5, SOFA.frame),
    // The back, against the far side, with its two cushions.
    ...padded(-6, -3.4, -8, 8, 5, 16, SOFA.body, SOFA.cushion),
    // The far armrest.
    ...padded(-6, 6, -8, -6, 5, 11.5, SOFA.body, SOFA.light),
    // Seat cushions, then the cushions of the back, plump and a little leaning.
    ...padded(-3.4, 5.8, -6, -0.1, 5, 8.6, SOFA.cushion, SOFA.light),
    ...padded(-3.4, 5.8, 0.1, 6, 5, 8.6, SOFA.cushion, SOFA.light),
    ...padded(-3.4, -1.6, -5.8, -0.3, 8.6, 14.6, SOFA.cushion, SOFA.light),
    ...padded(-3.4, -1.6, 0.3, 5.8, 8.6, 14.6, SOFA.cushion, SOFA.light),
    // A yellow pillow in the corner.
    ...padded(-1.6, 0.6, -5.6, -2.8, 8.6, 12.4, '#e9b23a', '#ffd46a'),
    // The near armrest comes last: it hides the end of the seat.
    ...padded(-6, 6, 6, 8, 5, 11.5, SOFA.body, SOFA.light),
    // Piping along the front of the frame, and a stitch on each seat cushion.
    quad(SOFA.light, [6, -8, 4.2], [6, 8, 4.2], [6, 8, 4.6], [6, -8, 4.6]),
    pix(5.8, -3, 8.6, 0.5, 0.5, SOFA.frame),
    pix(5.8, 3, 8.6, 0.5, 0.5, SOFA.frame),
  ],
};

const CHAIR_PINK = { frame: '#b8436f', body: '#d9608f', cushion: '#f285ab', light: '#ffadc7' };
const armchair: Recipe = {
  name: 'Fauteuil rose',
  parts: [
    ...[[-4.4, -4.4], [-4.4, 4.4], [4.4, -4.4], [4.4, 4.4]].map(([x, y]) => box(x! - 0.6, x! + 0.6, y! - 0.6, y! + 0.6, 0, 2, WOOD_DARK)),
    box(-5.5, 5.5, -5.5, 5.5, 2, 5, CHAIR_PINK.frame),
    ...padded(-5.5, -2.8, -5.5, 5.5, 5, 16, CHAIR_PINK.body, CHAIR_PINK.cushion),
    ...padded(-5.5, 5.5, -5.5, -3.6, 5, 11, CHAIR_PINK.body, CHAIR_PINK.light),
    ...padded(-2.8, 5.3, -3.6, 3.6, 5, 8.4, CHAIR_PINK.cushion, CHAIR_PINK.light),
    ...padded(-2.8, -1.2, -3.4, 3.4, 8.4, 14.2, CHAIR_PINK.cushion, CHAIR_PINK.light),
    ...padded(-5.5, 5.5, 3.6, 5.5, 5, 11, CHAIR_PINK.body, CHAIR_PINK.light),
    quad(CHAIR_PINK.light, [5.5, -5.5, 4.2], [5.5, 5.5, 4.2], [5.5, 5.5, 4.6], [5.5, -5.5, 4.6]),
  ],
};

const lamp: Recipe = {
  name: 'Lampadaire',
  parts: [
    cyl(0, 0, 3, 0, 1.6, INK, '#4a3f7a'),
    cyl(0, 0, 0.8, 1.6, 22, '#4a3f7a', '#6c61a3'),
    cyl(0, 0, 4.4, 22, 30, '#ffd870', '#fff3d6'),
    cyl(0, 0, 3.2, 30, 30.6, '#ffe9a8', '#fffbe8'),
    pix(-2, 3, 25, 1, 3, '#fff3d6'),
    pix(2, 2, 27, 1, 2, '#fff3d6'),
  ],
};

const plant: Recipe = {
  name: 'Ficus joyeux',
  parts: [
    // A glazed pot, a slim trunk, and the leaves in layers, from the bottom up.
    cyl(0, 0, 3.8, 0, 8, '#3f74c8', '#5a3a22'),
    cyl(0, 0, 4.3, 7.4, 9, '#5a90e0', '#6e4a2c'),
    cyl(0, 0, 3.6, 9, 9.3, '#4a2f1c', '#5a3a22'),
    pix(-2.6, 2.6, 4, 0.5, 3, '#2f5aa0'),
    cyl(0, 0, 0.7, 9.3, 18, '#6e4a2c', '#8b5e3c'),
    ...crownOfLeaves(7, 15, 6.5, 6, 2.2, 0.2, ['#2f7a3a', '#3f9a46', '#357f3c']),
    ...crownOfLeaves(6, 20, 5.2, 7, 2, 0.7, ['#3f9a46', '#58b552', '#4aa84c']),
    ...crownOfLeaves(5, 25, 3.6, 7, 1.8, 0.1, ['#58b552', '#6fca62']),
  ],
};

const cactus: Recipe = {
  name: 'Cactus câlin',
  parts: [
    cyl(0, 0, 3.4, 0, 5.5, '#e2483d', '#5a3a22'),
    cyl(0, 0, 2.3, 5.5, 17, '#4fb35a', '#6fcf6a'),
    cyl(-3.4, 0, 1.2, 9, 14, '#4fb35a', '#6fcf6a'),
    box(-3.4, -1.6, -0.8, 0.8, 8, 9.6, '#4fb35a'),
    cyl(3.6, 1, 1.2, 11, 15.5, '#4fb35a', '#6fcf6a'),
    box(1.8, 3.6, 0.2, 1.8, 10, 11.6, '#4fb35a'),
    ball(0.4, -0.2, 18, 1.4, '#ff8fb1'),
    pix(2, 1, 12, 1, 1, '#d9f5c8'),
    pix(-1, 2, 8, 1, 1, '#d9f5c8'),
  ],
};

const bookshelf: Recipe = {
  name: 'Étagère à livres',
  parts: [
    box(-4, -3, -7, 7, 0, 36, WOOD_DARK),
    box(-4, 4, -7, -6, 0, 36, WOOD),
    box(-4, 4, 6, 7, 0, 36, WOOD),
    box(-4, 4, -7, 7, 0, 1.4, WOOD),
    box(-4, 4, -7, 7, 11, 12.2, WOOD),
    box(-4, 4, -7, 7, 23, 24.2, WOOD),
    box(-4.5, 4.5, -7.5, 7.5, 36, 37.6, '#a8764a'),
    box(-2.5, 3, -5.6, -3.6, 1.4, 10, '#e2483d'),
    box(-2.5, 3, -3.5, -2.2, 1.4, 9, '#4a8fe2'),
    box(-2.5, 3, -2, -0.2, 1.4, 10.4, GOLD),
    box(-2.5, 3, 1, 3, 1.4, 8.4, '#5fc46a'),
    box(-2.5, 3, 3.4, 5.6, 1.4, 9.6, '#b36bd6'),
    box(-2.5, 3, -5.6, -2, 12.2, 21, '#ff8fb1'),
    box(-2.5, 3, -1, 1, 12.2, 20, '#4fc3c3'),
    cyl(1, 4, 1.8, 12.2, 17, '#d9774a', '#5a3a22'),
    ball(1, 4, 19, 2.2, '#5fc46a'),
    box(-2.5, 3, -5, -2.6, 24.2, 33, '#f08a3c'),
    box(-2.5, 3, 0, 4, 24.2, 30, '#3b3366'),
    pix(-1, 1, 33, 2, 1, '#fff3d6'),
  ],
};

const rug: Recipe = {
  name: 'Tapis moelleux',
  parts: [
    box(-8, 8, -8, 8, 0, 0.8, '#c0445a'),
    box(-6.5, 6.5, -6.5, 6.5, 0.8, 1.2, '#f0bf5a'),
    box(-5, 5, -5, 5, 1.2, 1.6, '#e87a8c'),
    cyl(0, 0, 2.4, 1.6, 2, '#ffd0e0', '#fff3d6'),
    pix(-6, -6, 1.2, 1, 1, '#c0445a'),
    pix(6, 6, 1.2, 1, 1, '#c0445a'),
  ],
};


// ----- Pieces for mechanisms ----------------------------------------------------------------

const pressurePlate: Recipe = {
  name: 'Plaque de pression',
  parts: [
    box(-7.5, 7.5, -7.5, 7.5, 0, 1.2, '#3b3366'),
    box(-6.5, 6.5, -6.5, 6.5, 1.2, 1.8, '#8f86bf'),
    box(-5, 5, -5, 5, 1.8, 2.2, '#c9b8ff'),
    cyl(0, 0, 2, 2.2, 2.8, '#ffc857', '#fff3d6'),
    pix(-6, -6, 1.8, 1, 1, '#3b3366'),
    pix(6, -6, 1.8, 1, 1, '#3b3366'),
    pix(-6, 6, 1.8, 1, 1, '#3b3366'),
    pix(6, 6, 1.8, 1, 1, '#3b3366'),
  ],
};

const redButton: Recipe = {
  name: 'Bouton rouge',
  parts: [
    box(-6, 6, -6, 6, 0, 2.5, '#3b3366'),
    cyl(0, 0, 4.6, 2.5, 11, '#6b5bb8', '#8f86bf'),
    cyl(0, 0, 4, 11, 12, '#2a2140', '#3b3366'),
    cyl(0, 0, 3, 12, 15.5, '#e2483d', '#ff8a80'),
    pix(-1.5, -1.5, 15.5, 1, 1, '#ffd6d0'),
  ],
};

const portalPad: Recipe = {
  name: 'Portail',
  parts: [
    cyl(0, 0, 7.6, 0, 1.4, '#3b3366', '#5a4d99'),
    cyl(0, 0, 6.2, 1.4, 2.2, '#3e8fe0', '#7cc4ff'),
    cyl(0, 0, 4.6, 2.2, 2.6, '#2a2a6e', '#3b3b9a'),
    cyl(0, 0, 3.2, 2.6, 3, '#8ac8ff', '#e6f6ff'),
    pix(-3, 1, 3, 1, 1, '#ffffff'),
    pix(2, -2, 3, 1, 1, '#ffffff'),
    pix(0, 3, 3, 1, 1, '#d8f0ff'),
  ],
};

const wardrobe: Recipe = {
  name: 'Armoire ancienne',
  parts: [
    box(-5, 5, -7, 7, 0, 41, '#a8764a'),
    box(-5.6, 5.6, -7.6, 7.6, 41, 44, '#c98f5e'),
    box(-5.4, 5.4, -7.4, 7.4, 0, 3, WOOD_DARK),
    quad('#b98556', [5, -6.4, 5], [5, -0.5, 5], [5, -0.5, 38], [5, -6.4, 38]),
    quad('#b98556', [5, 0.5, 5], [5, 6.4, 5], [5, 6.4, 38], [5, 0.5, 38]),
    quad('#c99a6a', [5, -5.4, 7], [5, -1.5, 7], [5, -1.5, 34], [5, -5.4, 34]),
    quad('#c99a6a', [5, 1.5, 7], [5, 5.4, 7], [5, 5.4, 34], [5, 1.5, 34]),
    box(5, 5.8, -1.6, -0.9, 18, 24, GOLD),
    box(5, 5.8, 0.9, 1.6, 18, 24, GOLD),
    pix(-3, 7.6, 40, 2, 1, '#e0b080'),
  ],
};

const desk: Recipe = {
  name: 'Bureau d’écolier',
  parts: [
    box(-5, 5, -8, -6, 0, 13, WOOD_DARK),
    box(-5, 5, 2, 8, 0, 13, WOOD),
    quad('#a8764a', [5, 2.6, 8.4], [5, 7.4, 8.4], [5, 7.4, 12], [5, 2.6, 12]),
    quad('#a8764a', [5, 2.6, 1.2], [5, 7.4, 1.2], [5, 7.4, 7.6], [5, 2.6, 7.6]),
    pix(5, 5, 10, 2, 1, GOLD),
    pix(5, 5, 4, 2, 1, GOLD),
    box(-5.4, 5.4, -8.4, 8.4, 13, 15, WOOD_LIGHT),
    box(-3.5, 0.5, -5, 1, 15, 15.8, '#d8d2ee'),
    quad('#3e6fb0', [-3.5, -5, 15.8], [-3.5, 1, 15.8], [-3.5, 1, 22], [-3.5, -5, 22]),
    quad('#8ec0f5', [-3.5, -4, 17], [-3.5, -1, 17], [-3.5, -1, 20], [-3.5, -4, 20]),
    cyl(2.5, 4.5, 1.2, 15, 18, '#e2483d', '#fff3d6'),
    box(1.5, 4, -4, -1, 15, 15.6, '#f4efe6'),
  ],
};

const nightstand: Recipe = {
  name: 'Table de chevet',
  parts: [
    ...legs(4, 4, 0.7, 4, WOOD_DARK),
    box(-4, 4, -4, 4, 4, 11, '#c98f5e'),
    box(-4.4, 4.4, -4.4, 4.4, 11, 12.2, '#e0a874'),
    quad('#b98556', [4, -3.2, 5.2], [4, 3.2, 5.2], [4, 3.2, 10], [4, -3.2, 10]),
    pix(4, 0, 7.4, 2, 1, GOLD),
    cyl(-1, -1, 1.2, 12.2, 15, '#4a3f7a', '#6c61a3'),
    cyl(-1, -1, 3, 15, 19.5, '#ffd870', '#fff3d6'),
  ],
};

const tv: Recipe = {
  name: 'Télé rétro',
  parts: [
    // A low cabinet: two doors with knobs, a drawer line, a lighter top.
    box(-4, 4, -8, 8, 0, 1.2, '#3e2716'),
    box(-4, 4, -8, 8, 1.2, 8, '#6a4428'),
    box(-4.2, 4.2, -8.2, 8.2, 8, 8.8, '#8a5a34'),
    quad('#5a3a22', [4, -7.2, 1.8], [4, -0.3, 1.8], [4, -0.3, 6.8], [4, -7.2, 6.8]),
    quad('#5a3a22', [4, 0.3, 1.8], [4, 7.2, 1.8], [4, 7.2, 6.8], [4, 0.3, 6.8]),
    pix(4, -1.4, 4.6, 0.5, 0.5, '#ffc857'),
    pix(4, 1.2, 4.6, 0.5, 0.5, '#ffc857'),
    // The screen on its foot: a dark bezel, a blue picture, a diagonal glare.
    box(-1.2, 1.2, -2, 2, 8.8, 9.6, INK),
    box(-0.4, 0.4, -0.6, 0.6, 9.6, 11, INK),
    box(-1, 1, -7.6, 7.6, 11, 23.4, '#1b1530'),
    quad('#3e6fb0', [1, -6.8, 12], [1, 6.8, 12], [1, 6.8, 22.4], [1, -6.8, 22.4]),
    quad('#5a8fd8', [1, -6.8, 12], [1, 6.8, 12], [1, 6.8, 15], [1, -6.8, 15]),
    quad('#8ec0f5', [1, -5.6, 21.6], [1, -3.6, 21.6], [1, 0.6, 13], [1, -1.4, 13]),
    quad('#b8d8fa', [1, -2.6, 21.6], [1, -1.8, 21.6], [1, 2.4, 13], [1, 1.6, 13]),
    pix(1, 6, 11.4, 1, 0.5, '#5fc46a'),
  ],
};

const fridge: Recipe = {
  name: 'Frigo givré',
  parts: [
    box(-5.5, 5.5, -5.5, 5.5, 0, 2.4, '#8f86bf'),
    box(-5, 5, -5, 5, 2.4, 38, '#d8d2ee'),
    box(-5.2, 5.2, -5.2, 5.2, 36, 38.4, '#e8e2f8'),
    quad('#b4acd8', [5, -4.8, 24.4], [5, 4.8, 24.4], [5, 4.8, 25.4], [5, -4.8, 25.4]),
    quad('#bdb5de', [-4.8, 5, 24.4], [4.8, 5, 24.4], [4.8, 5, 25.4], [-4.8, 5, 25.4]),
    box(5, 5.8, 3, 3.9, 28, 34, '#8f86bf'),
    box(5, 5.8, 3, 3.9, 14, 21, '#8f86bf'),
    quad('#fff3d6', [5, -4, 26.6], [5, -1.4, 26.6], [5, -1.4, 30.4], [5, -4, 30.4]),
    pix(5, -3.4, 29.4, 0.5, 2, '#a8a0d0'),
    pix(5, -3.4, 28.4, 1.5, 0.5, '#a8a0d0'),
    pix(5, -0.4, 33, 1, 1, '#e2483d'),
    pix(5, -2.2, 12, 1, 1, '#ffc857'),
    pix(5, -3.6, 35, 3, 0.5, '#8f86bf'),
    pix(-2, 5, 33, 1, 1, '#ffffff'),
    pix(-3.4, 5, 30, 0.5, 4, '#ffffff'),
  ],
};

const dresser: Recipe = {
  name: 'Commode douce',
  parts: [
    box(-5, 5, -8, 8, 0, 18, '#a8764a'),
    box(-5.5, 5.5, -8.5, 8.5, 18, 20, '#c98f5e'),
    quad('#b98556', [5, -7.2, 2.4], [5, 7.2, 2.4], [5, 7.2, 6.4], [5, -7.2, 6.4]),
    quad('#b98556', [5, -7.2, 7.4], [5, 7.2, 7.4], [5, 7.2, 11.4], [5, -7.2, 11.4]),
    quad('#b98556', [5, -7.2, 12.4], [5, 7.2, 12.4], [5, 7.2, 16.4], [5, -7.2, 16.4]),
    box(5, 5.8, -0.9, 0.9, 3.8, 5, GOLD),
    box(5, 5.8, -0.9, 0.9, 8.8, 10, GOLD),
    box(5, 5.8, -0.9, 0.9, 13.8, 15, GOLD),
    ...legs(4.4, 7.4, 0, 1, WOOD_DARK, 1.4),
    cyl(-1, -4, 1.4, 20, 25, '#4fc3c3', '#8ee0e0'),
    ball(-1, -4, 26.5, 1.4, '#ff8fb1'),
  ],
};

const mirror: Recipe = {
  name: 'Miroir sur pied',
  parts: [
    box(-2.4, 2.4, -6, -4.4, 0, 3, WOOD_DARK),
    box(-2.4, 2.4, 4.4, 6, 0, 3, WOOD_DARK),
    box(-1, 1, -5.6, 5.6, 3, 33, '#d9a05b'),
    quad('#cfe8f7', [1, -4.4, 5], [1, 4.4, 5], [1, 4.4, 30.6], [1, -4.4, 30.6]),
    quad('#eaf6ff', [1, -3.6, 18], [1, -1.6, 18], [1, 1.2, 28], [1, -0.8, 28]),
    quad('#a8d4ee', [1, 1, 6], [1, 3.4, 6], [1, 3.4, 9], [1, 1.4, 9]),
    ball(0, 0, 34.4, 1.6, GOLD),
  ],
};

const pouf: Recipe = {
  name: 'Pouf bonbon',
  parts: [
    // A round cushion: a darker base band, the plump body, a soft top with a sunken button.
    cyl(0, 0, 5.2, 0, 1.4, '#c98d1e', '#e8a92a'),
    cyl(0, 0, 5.6, 1.4, 7.2, '#f2c230', '#ffd95a'),
    cyl(0, 0, 4.8, 7.2, 8.4, '#ffd95a', '#ffe58a'),
    cyl(0, 0, 0.9, 8.4, 8.6, '#d9a21f', '#c98d1e'),
    // Seams down the side.
    pix(-3.4, 3.4, 6.6, 0.5, 2.4, '#d9a21f'),
    pix(0.4, 5.2, 5.8, 0.5, 2.4, '#d9a21f'),
    pix(3.6, 3.4, 4.6, 0.5, 2.4, '#d9a21f'),
  ],
};

const clock: Recipe = {
  name: 'Horloge comtoise',
  parts: [
    box(-3.6, 3.6, -3.6, 3.6, 0, 3, WOOD_DARK),
    box(-3, 3, -3, 3, 3, 42, WOOD),
    box(-3.8, 3.8, -3.8, 3.8, 31, 33, '#a8764a'),
    box(-3.8, 3.8, -3.8, 3.8, 41.4, 43.4, '#a8764a'),
    ball(0, 0, 45, 2.2, '#a8764a'),
    { t: 'circle', x: 3, y: 0, z: 37, r: 3.9, c: '#8a5a2c' },
    { t: 'circle', x: 3, y: 0, z: 37, r: 3.2, c: '#f4efe6' },
    pix(3, 0, 40, 0.5, 3, INK),
    pix(3, 0, 37, 2, 0.5, INK),
    pix(3, 0, 40.4, 0.5, 0.5, '#e2483d'),
    pix(3, 2.4, 37, 0.5, 0.5, INK),
    pix(3, -2.4, 37, 0.5, 0.5, INK),
    pix(3, 0, 34.2, 0.5, 0.5, INK),
    quad('#5a3a22', [3, -2, 5], [3, 2, 5], [3, 2, 27], [3, -2, 27]),
    quad('#7a4e2c', [3, -1.4, 7], [3, 1.4, 7], [3, 1.4, 25], [3, -1.4, 25]),
    { t: 'circle', x: 3, y: 0, z: 12, r: 2.4, c: GOLD, c2: '#fff3d6' },
    pix(3, 0, 26, 0.5, 14, '#c99a6a'),
  ],
};

const chest: Recipe = {
  name: 'Coffre aux trésors',
  parts: [
    box(-5, 5, -7, 7, 0, 9, WOOD),
    box(-5.4, 5.4, -7.4, 7.4, 9, 12, '#a8764a'),
    quad(GOLD, [5, -6, 0.8], [5, -4.6, 0.8], [5, -4.6, 11.4], [5, -6, 11.4]),
    quad(GOLD, [5, 4.6, 0.8], [5, 6, 0.8], [5, 6, 11.4], [5, 4.6, 11.4]),
    box(5, 5.8, -1.2, 1.2, 6, 11, '#e0a030'),
    pix(5, 0, 8, 2, 2, INK),
    pix(-3, -5, 12, 3, 1, '#c99a6a'),
  ],
};

const entry = (
  key: string,
  category: FurnitureCategory,
  recipe: Recipe,
  extras: Partial<Pick<CatalogueEntry, 'glow' | 'anim' | 'interaction' | 'price' | 'surface' | 'roller' | 'teleport' | 'pushable' | 'toy' | 'hidden' | 'walkable' | 'pressable' | 'gate' | 'confetti' | 'game' | 'vendor' | 'mannequin' | 'sign' | 'jukebox' | 'goal' | 'frames' | 'frameMs' | 'wall'>> = {},
): CatalogueEntry => ({
  key,
  name: recipe.name,
  category,
  recipe,
  ...extras,
  price: extras.price ?? 0,
});

/** The same piece in other colours: every colour found in the map is swapped, the shape stays. */
const recolor = (base: Recipe, name: string, map: Record<string, string>): Recipe => ({
  name,
  parts: base.parts.map((p) => {
    const q = { ...p } as Record<string, unknown>;
    for (const k of ['c', 'c2', 'top', 'left', 'right', 'side']) {
      const v = q[k];
      if (typeof v === 'string' && map[v]) q[k] = map[v];
    }
    return q as unknown as Part;
  }),
});

const mintSofa = recolor(sofa, 'Canapé menthe', {
  [SOFA.frame]: '#1f7a5c', [SOFA.body]: '#2f9e7a', [SOFA.cushion]: '#3fbf94', [SOFA.light]: '#6fd8b0',
});
const sunArmchair = recolor(armchair, 'Fauteuil soleil', {
  [CHAIR_PINK.frame]: '#b87a10', [CHAIR_PINK.body]: '#e0a020', [CHAIR_PINK.cushion]: '#ffc83d', [CHAIR_PINK.light]: '#ffdf7a',
});
const starBed = recolor(bed, 'Lit étoilé', {
  '#e2483d': '#4a8fe2', '#ff8a80': '#8ec0f5', '#d8382d': '#3f78c4', '#ffa8a0': '#cfe3fa', '#ffe4ec': '#e6f0ff',
});
const lagoonRug = recolor(rug, 'Tapis lagon', {
  '#c0445a': '#2f6fb0', '#f0bf5a': '#8ec0f5', '#e87a8c': '#4a8fe2', '#ffd0e0': '#fff3d6',
});
const popChair = recolor(chair, 'Chaise pop', {
  '#d9a05b': '#e2483d', '#f0be78': '#ff7a6b', '#e8b46b': '#ff8a80',
});

const bunkBed: Recipe = {
  name: 'Lits superposés',
  parts: [
    ...legs(7.5, 6.5, 0.8, 36, WOOD_DARK, 1.6),
    box(-7, 7, -6, 6, 5, 7, WOOD),
    box(-6.8, 6.8, -5.8, 5.8, 7, 10, '#4a8fe2'),
    box(-6.5, -2.5, -4.6, 4.6, 10, 12, '#fff3d6'),
    box(-1, 6.8, -5.8, 5.8, 10, 11, '#8ec0f5'),
    box(-7, 7, -6, 6, 22, 24, WOOD),
    box(-6.8, 6.8, -5.8, 5.8, 24, 27, '#ff8fb1'),
    box(-6.5, -2.5, -4.6, 4.6, 27, 29, '#fff3d6'),
    box(-1, 6.8, -5.8, 5.8, 27, 28, '#e2483d'),
    box(-7.2, 7.2, 5.6, 6.2, 24, 31, WOOD),
    box(6.6, 7.6, 1, 1.8, 5, 29, WOOD_DARK),
    box(6.6, 7.6, 4, 4.8, 5, 29, WOOD_DARK),
    ...[9, 14, 19, 24].map((z) => box(6.6, 7.4, 1, 4.8, z, z + 1, WOOD)),
    pix(-4, 0, 29, 3, 1, '#ffffff'),
    ball(-7.5, -6, 36.5, 0.9, GOLD),
    ball(-7.5, 6, 36.5, 0.9, GOLD),
  ],
};

const piano: Recipe = {
  name: 'Piano droit',
  parts: [
    box(-4, 4, -9, -7.5, 0, 3, INK),
    box(-4, 4, 7.5, 9, 0, 3, INK),
    box(-4, 4, -9, 9, 3, 30, '#3b3366'),
    box(-4.4, 4.4, -9.4, 9.4, 30, 31.5, '#4a3f7a'),
    quad('#4a3f7a', [4, -8, 18], [4, 8, 18], [4, 8, 28], [4, -8, 28]),
    quad('#5a4d99', [4, -7, 20], [4, 7, 20], [4, 7, 26], [4, -7, 26]),
    box(4, 6.4, -8, 8, 14, 16, INK),
    box(4, 6.8, -7.4, 7.4, 16, 17, CREAM),
    ...[-5.5, -3.5, -0.5, 1.5, 3.5, 5.5].map((y) => pix(6.6, y, 17, 0.5, 1.5, INK)),
    box(2, 3, -4, 4, 31.5, 37, CREAM),
    pix(2.6, -2, 35, 3, 0.5, INK),
    pix(2.6, -2, 33.5, 4, 0.5, INK),
    pix(4.5, -3, 3, 1.5, 1, GOLD),
    pix(4.5, 3, 3, 1.5, 1, GOLD),
    pix(-3, 6, 29, 1, 1, '#8f86bf'),
  ],
};

const fireplace: Recipe = {
  name: 'Cheminée de campagne',
  parts: [
    box(-4, 4, -8, 8, 0, 26, '#a85a4a'),
    box(-4.6, 5.2, -8.6, 8.6, 26, 28, '#e0b080'),
    ...[4, 9, 14, 19, 24].map((z) => box(4, 4.6, -8, 8, z, z + 0.5, '#c0745e')),
    quad(INK, [4, -4.5, 2], [4, 4.5, 2], [4, 4.5, 15], [4, -4.5, 15]),
    quad('#ff8a3c', [4, -3.4, 2], [4, 3.4, 2], [4, 1.6, 10], [4, -1.6, 12]),
    quad('#ffc857', [4, -2, 2], [4, 2, 2], [4, 0.6, 7.4], [4, -0.8, 8.6]),
    quad('#fff3d6', [4, -0.8, 2], [4, 0.8, 2], [4, 0, 4.6]),
    box(3.6, 4.6, -3.8, 3.8, 2, 4, WOOD),
    cyl(-1, -5, 1.4, 28, 33, '#5fc46a', '#7ad778'),
    pix(0, 4, 28, 3, 3, '#fff3d6'),
    pix(0, 4.5, 31, 2, 1, '#ff8fb1'),
  ],
};

const aquarium: Recipe = {
  name: 'Aquarium',
  parts: [
    box(-4.5, 4.5, -8, 8, 0, 12, WOOD_DARK),
    box(-4.8, 4.8, -8.4, 8.4, 12, 13, WOOD),
    box(-4, 4, -7.5, 7.5, 13, 27, '#6ec6e8'),
    quad('#8ee0f5', [4, -7, 14], [4, 7, 14], [4, 7, 26], [4, -7, 26]),
    quad('#f0d9a0', [4, -7, 14], [4, 7, 14], [4, 7, 16], [4, -7, 16]),
    quad('#3f9b4b', [4, 4, 16], [4, 5.6, 16], [4, 5, 24], [4, 4.2, 24]),
    quad('#5fc46a', [4, -5.4, 16], [4, -4, 16], [4, -4.6, 22], [4, -5.2, 22]),
    pix(4, -2, 20, 2.5, 1.5, '#ff8a3c'),
    pix(4, 1.6, 22.4, 2.5, 1.5, '#ffc857'),
    pix(4, -0.4, 18, 1.5, 1, '#ff8fb1'),
    pix(4, 0.4, 24.6, 0.5, 0.5, '#ffffff'),
    pix(4, 0.8, 25.6, 0.5, 0.5, '#ffffff'),
    box(-4.4, 4.4, -7.9, 7.9, 27, 28, '#4a3f7a'),
    pix(-3, 0, 28, 3, 1, '#fff3d6'),
  ],
};

const arcade: Recipe = {
  name: 'Borne d’arcade',
  parts: [
    box(-4, 4, -4.5, 4.5, 0, 40, '#7d4fc9'),
    box(-4, 4, -4.5, 4.5, 0, 6, '#3b3366'),
    box(4, 7, -4.5, 4.5, 18, 20, INK),
    cyl(5.5, -2, 0.5, 20, 23, '#c9c9d6'),
    ball(5.5, -2, 24, 1.3, '#e2483d'),
    pix(6.4, 1.6, 20.4, 1, 1, GOLD),
    pix(6.4, 3.2, 20.4, 1, 1, '#5fc46a'),
    quad('#1b1530', [4, -3.6, 22], [4, 3.6, 22], [4, 3.6, 35], [4, -3.6, 35]),
    quad('#5fc46a', [4, -2.8, 24], [4, -0.8, 24], [4, -0.8, 26], [4, -2.8, 26]),
    quad('#4a8fe2', [4, 0.6, 28], [4, 2.8, 28], [4, 2.8, 30], [4, 0.6, 30]),
    pix(4, -2, 32, 3, 1, '#ff8fb1'),
    pix(4, 1, 25, 2, 1, GOLD),
    box(-4, 5, -4.5, 4.5, 36, 42, INK),
    pix(5, -3, 38, 6, 1.5, '#ffd870'),
    pix(-4, 4.5, 28, 1, 8, '#a780e0'),
  ],
};

const bathtub: Recipe = {
  name: 'Baignoire à pattes',
  parts: [
    ...[[-4, -6.8], [-4, 6.8], [4, -6.8], [4, 6.8]].map(([x, y]) => cyl(x!, y!, 1, 0, 3, GOLD, '#fff3d6')),
    box(-5, 5, -8, 8, 3, 10, CREAM),
    box(-4, 4.2, -6.8, 6.8, 9, 10.2, '#8ee0f5'),
    box(-5.4, -4, -8.4, 8.4, 9, 11, '#ffffff'),
    box(4, 5.4, -8.4, 8.4, 9, 11, '#ffffff'),
    box(-4, 4, -8.4, -6.8, 9, 11, '#ffffff'),
    box(-4, 4, 6.8, 8.4, 9, 11, '#ffffff'),
    cyl(-4.5, 0, 0.8, 10, 15, '#c9c9d6', '#e6e6f0'),
    box(-4.5, -2, -0.8, 0.8, 14, 15.4, '#c9c9d6'),
    ball(0, -3, 10.6, 1.8, '#ffffff'),
    ball(1.6, 2, 10.9, 1.4, '#ffffff'),
    ball(-1, 4.4, 10.4, 1.1, '#fff6f9'),
    pix(2, -4, 12.4, 1, 1, '#ffffff'),
  ],
};

const stove: Recipe = {
  name: 'Cuisinière',
  parts: [
    box(-5, 5, -5, 5, 0, 24, '#d8d2ee'),
    box(-5.2, 5.2, -5.2, 5.2, 24, 25, '#3b3366'),
    ...[[-2.4, -2.4], [-2.4, 2.4], [2.4, -2.4], [2.4, 2.4]].map(([x, y]) => cyl(x!, y!, 1.9, 25, 25.6, INK, '#5a4d99')),
    quad('#8f86bf', [5, -4, 3], [5, 4, 3], [5, 4, 18], [5, -4, 18]),
    quad('#1b1530', [5, -3, 6], [5, 3, 6], [5, 3, 14], [5, -3, 14]),
    quad('#3b3366', [5, -2.4, 6.6], [5, 0, 6.6], [5, 0, 10], [5, -2.4, 10]),
    box(5, 5.8, -3.4, 3.4, 18.6, 19.4, '#c9c9d6'),
    pix(5, -3, 21.6, 1, 1, '#e2483d'),
    pix(5, 0, 21.6, 1, 1, GOLD),
    pix(5, 3, 21.6, 1, 1, '#5fc46a'),
    box(-5, -4.4, -5, 5, 25, 33, '#d8d2ee'),
    pix(-4.8, -1, 29, 1, 1, '#ffffff'),
  ],
};

const beanbag: Recipe = {
  name: 'Fauteuil poire',
  parts: [
    ball(0, 0, 5, 7.6, '#9b57c9'),
    ball(-3.4, 0, 10, 6, '#b36bd6'),
    ball(2.2, 0, 8.2, 4.4, '#c58be6'),
    ball(-4.4, 0, 14, 3.4, '#c58be6'),
    pix(-3, 3, 11, 1, 2, '#e6c8f5'),
    pix(2, -3, 9, 1, 1, '#e6c8f5'),
  ],
};

const stool: Recipe = {
  name: 'Tabouret rouge',
  parts: [
    cyl(0, 0, 3.8, 0, 1, INK, '#4a3f7a'),
    cyl(0, 0, 0.8, 1, 9, '#c9c9d6', '#e6e6f0'),
    cyl(0, 0, 2.8, 5, 5.6, '#c9c9d6'),
    cyl(0, 0, 4.4, 8, 10.5, '#e2483d', '#ff7a6b'),
    pix(-2, 2, 10.5, 2, 1, '#ffb0a8'),
  ],
};

const coffeeTable: Recipe = {
  name: 'Table basse vitrée',
  parts: [
    ...legs(6.5, 6.5, 0.6, 7, '#c9c9d6', 1),
    box(-7, 7, -7, 7, 7, 8.4, '#8ee0f5'),
    box(-7.2, 7.2, -7.2, 7.2, 8, 8.8, '#cfeefa'),
    box(-3, 1.5, -3, 2, 8.8, 9.6, '#f4efe6'),
    cyl(3, 3, 1.3, 8.8, 11, '#ff8fb1', '#ffc0d4'),
    pix(-1, -1, 9.6, 2, 1, '#e2483d'),
    pix(3, -4, 8.8, 1, 1, '#ffffff'),
  ],
};

const lavaLamp: Recipe = {
  name: 'Lampe à lave',
  parts: [
    cyl(0, 0, 3.2, 0, 3, '#c9c9d6', '#e6e6f0'),
    cyl(0, 0, 2.4, 3, 18, '#ff6fa8', '#ffa8c8'),
    ball(0, 0, 8, 1.6, '#ffd870'),
    ball(0.6, 0, 13, 1.1, '#ffd870'),
    cyl(0, 0, 1.4, 18, 21, '#c9c9d6', '#e6e6f0'),
    pix(-1.6, 1, 6, 1, 8, '#ffd0e0'),
  ],
};

/**
 * Pointed leaves rising from (0, 0, z0) all around: each leaf is a flat diamond from its base to its tip, bent up.
 * `count` leaves of length `reach`, starting at angle `turn`; drawn from the back (small x + y) to the front.
 */
function crownOfLeaves(count: number, z0: number, reach: number, rise: number, width: number, turn: number, greens: string[]): Part[] {
  const leaves = Array.from({ length: count }, (_, k) => {
    const a = turn + (k / count) * Math.PI * 2;
    const [cx, cy] = [Math.cos(a), Math.sin(a)];
    const tip: [number, number, number] = [cx * reach, cy * reach, z0 + rise];
    const mid: [number, number] = [cx * reach * 0.5, cy * reach * 0.5];
    const midZ = z0 + rise * 0.75;
    const side = (s: number): [number, number, number] => [mid[0] - cy * width * s, mid[1] + cx * width * s, midZ];
    return { depth: tip[0] + tip[1], part: quad(greens[k % greens.length]!, [cx * 0.6, cy * 0.6, z0], side(1), tip, side(-1)) };
  });
  return leaves.sort((p, q) => p.depth - q.depth).map((l) => l.part);
}

const monstera: Recipe = {
  name: 'Monstera géante',
  parts: [
    // A terracotta pot with a rim, and the soil.
    cyl(0, 0, 4.6, 0, 9, '#c0683a', '#5a3a22'),
    cyl(0, 0, 5.2, 8, 10.4, '#d88050', '#6e4a2c'),
    cyl(0, 0, 4.4, 10.4, 10.8, '#4a2f1c', '#5a3a22'),
    pix(-3.4, 3.4, 6, 0.5, 3, '#a85a30'),
    // Two crowns of big pointed leaves, the lower one wide and dark, the upper one shorter and lighter.
    ...crownOfLeaves(8, 10.8, 9.5, 5, 2.8, 0.3, ['#276b34', '#2f7a3a', '#3f9a46']),
    ...crownOfLeaves(7, 12, 7, 11, 2.6, 0.75, ['#3f9a46', '#58b552', '#4aa84c']),
    ...crownOfLeaves(5, 14, 4.2, 15, 2, 0.1, ['#6fca62', '#58b552']),
  ],
};

const roundRug: Recipe = {
  name: 'Tapis rond fleuri',
  parts: [
    cyl(0, 0, 8, 0, 0.8, '#7d4fc9', '#9b6fe0'),
    cyl(0, 0, 6.4, 0.8, 1.2, '#ffc857', '#ffd870'),
    cyl(0, 0, 4.8, 1.2, 1.6, '#ff8fb1', '#ffb0c8'),
    cyl(0, 0, 2.2, 1.6, 2, '#fff3d6', '#ffffff'),
    pix(-5, 0, 1.4, 1, 1, '#7d4fc9'),
    pix(5, 0, 1.4, 1, 1, '#7d4fc9'),
    pix(0, -5, 1.4, 1, 1, '#7d4fc9'),
    pix(0, 5, 1.4, 1, 1, '#7d4fc9'),
  ],
};

const globe: Recipe = {
  name: 'Globe terrestre',
  parts: [
    cyl(0, 0, 3.4, 0, 1.4, WOOD_DARK, '#8b5e3c'),
    cyl(0, 0, 0.8, 1.4, 12, GOLD, '#fff3d6'),
    ball(0, 0, 17, 5.4, '#4a8fe2'),
    ball(-1.6, 0.8, 18, 2.4, '#5fc46a'),
    ball(2, -1.6, 15.6, 1.8, '#5fc46a'),
    ball(0.4, 2.6, 20.2, 1.4, '#7ad778'),
    pix(-3, 2, 20, 1, 1, '#cfe3fa'),
  ],
};

const teddy: Recipe = {
  name: 'Ours en peluche',
  parts: [
    ball(0, 0, 6.4, 6, '#b5651d'),
    ball(0, 0, 15, 4.6, '#c98a4a'),
    ball(-2.4, -3.8, 18.6, 1.8, '#b5651d'),
    ball(-2.4, 3.8, 18.6, 1.8, '#b5651d'),
    ball(0, -4.6, 8, 1.8, '#c98a4a'),
    ball(0, 4.6, 8, 1.8, '#c98a4a'),
    ball(4, 0, 14.4, 2, '#f6d0a4'),
    pix(4.4, -1.6, 16.2, 1, 1, INK),
    pix(4.4, 1.6, 16.2, 1, 1, INK),
    pix(5.4, 0, 14.6, 1, 1, INK),
    box(3, 3.4, -2, 2, 8, 9, '#e2483d'),
  ],
};

const boombox: Recipe = {
  name: 'Radio à cassettes',
  parts: [
    box(-3, 3, -7, 7, 0, 10, '#4a3f7a'),
    box(-3.2, 3.2, -7.2, 7.2, 9, 10.4, '#6c61a3'),
    cyl(3, -4, 2.4, 3, 7, '#2a2140'),
    cyl(3, 4, 2.4, 3, 7, '#2a2140'),
    { t: 'circle', x: 3.4, y: -4, z: 5, r: 2.2, c: '#8f86bf' },
    { t: 'circle', x: 3.4, y: 4, z: 5, r: 2.2, c: '#8f86bf' },
    quad('#8ee0f5', [3, -1.6, 4], [3, 1.6, 4], [3, 1.6, 8], [3, -1.6, 8]),
    pix(3, -0.8, 8.8, 0.5, 0.5, '#e2483d'),
    pix(3, 0.8, 8.8, 0.5, 0.5, '#ffc857'),
    box(-1.4, 1.4, 4.6, 5.4, 10, 17, '#c9c9d6'),
  ],
};

const newEntries = (): CatalogueEntry[] => [
  entry('canapementhe', 'seat', mintSofa, { price: 60, interaction: 'sit' }),
  entry('fauteuilsoleil', 'seat', sunArmchair, { price: 50, interaction: 'sit' }),
  entry('chaisepop', 'seat', popChair, { price: 25, interaction: 'sit' }),
  entry('fauteuilpoire', 'seat', beanbag, { price: 45, interaction: 'sit' }),
  entry('tabouret', 'seat', stool, { price: 20, interaction: 'sit' }),
  entry('litetoile', 'sleep', starBed, { price: 80, interaction: 'lie' }),
  entry('litsuperposes', 'sleep', bunkBed, { price: 140 }),
  entry('tablebasse', 'table', coffeeTable, { price: 40, surface: 8.8 }),
  entry('piano', 'decor', piano, { price: 220 }),
  entry('cheminee', 'decor', fireplace, { price: 180, anim: 'flicker', glow: { z: 8, color: 0xff9a40, radius: 62, flicker: true } }),
  entry('aquarium', 'decor', aquarium, { price: 160, glow: { z: 20, color: 0x6ec6e8, radius: 46 } }),
  entry('baignoire', 'decor', bathtub, { price: 120 }),
  entry('monstera', 'decor', monstera, { price: 45, anim: 'sway' }),
  entry('tapisrond', 'decor', roundRug, { price: 35, walkable: true }),
  entry('tapislagon', 'decor', lagoonRug, { price: 30, walkable: true }),
  entry('globe', 'decor', globe, { price: 55 }),
  entry('ours', 'decor', teddy, { price: 40 }),
  entry('lampelave', 'light', lavaLamp, { price: 50, glow: { z: 12, color: 0xff6fa8, radius: 40 } }),
  entry('plaque', 'tech', pressurePlate, { price: 30, walkable: true, glow: { z: 3, color: 0xffd870, radius: 22 } }),
  entry('bouton', 'tech', redButton, { price: 40, pressable: true }),
  entry('portail', 'tech', portalPad, { price: 60, walkable: true, glow: { z: 3, color: 0x5ab8ff, radius: 34 } }),
  entry('arcade', 'tech', arcade, { price: 260, anim: 'flicker', glow: { z: 30, color: 0x7d9fff, radius: 52, flicker: true } }),
  entry('cuisiniere', 'tech', stove, { price: 90 }),
  entry('radio', 'tech', boombox, { price: 50 }),
];

export const CATALOGUE: readonly CatalogueEntry[] = [
  entry('lit', 'sleep', bed, { interaction: 'lie' }),
  entry('chaise', 'seat', chair, { interaction: 'sit' }),
  entry('table', 'table', table, { surface: 12 }),
  entry('canape', 'seat', sofa, { interaction: 'sit' }),
  entry('fauteuil', 'seat', armchair, { interaction: 'sit' }),
  entry('lampadaire', 'light', lamp, { glow: { z: 27, color: 0xffd870, radius: 74 } }),
  entry('ficus', 'decor', plant, { anim: 'sway' }),
  entry('cactus', 'decor', cactus, { anim: 'sway' }),
  entry('etagere', 'storage', bookshelf),
  entry('tapis', 'decor', rug, { walkable: true }),
  entry('armoire', 'storage', wardrobe),
  entry('bureau', 'table', desk, { surface: 15 }),
  entry('chevet', 'sleep', nightstand, { surface: 12.2, glow: { z: 16, color: 0xffd870, radius: 40 } }),
  entry('tele', 'tech', tv, { anim: 'flicker', glow: { z: 15, color: 0x6aa6ee, radius: 52, flicker: true } }),
  entry('frigo', 'tech', fridge),
  entry('commode', 'storage', dresser, { surface: 20 }),
  entry('miroir', 'decor', mirror),
  entry('pouf', 'seat', pouf, { interaction: 'sit' }),
  entry('horloge', 'decor', clock),
  entry('coffre', 'storage', chest, { surface: 12 }),
  ...newEntries(),
  ...bigPieces().map((b) => entry(b.key, b.category, b.recipe, b.extras)),
  ...mechanismPieces().map((b) => entry(b.key, b.category, b.recipe, b.extras)),
  ...wallPieces().map((b) => entry(b.key, b.category, b.recipe, b.extras)),
  ...decorPieces().map((b) => entry(b.key, b.category, b.recipe, b.extras)),
];

const byKey = new Map(CATALOGUE.map((e) => [e.key, e]));
export const catalogueEntry = (key: string): CatalogueEntry | undefined => byKey.get(key);

/**
 * May this piece stand on a surface? Things to look at may (a lamp, a plant, a computer, a player's creation: no
 * entry); what players use from the floor may not (seats, beds, rugs, plates, gates, buttons, games), nor wall
 * pieces, nor another surface.
 */
export function stackable(entry: CatalogueEntry | undefined): boolean {
  if (!entry) return true;
  return !entry.interaction && !entry.walkable && !entry.gate && !entry.pressable && !entry.wall && entry.surface === undefined && !entry.game && entry.goal === undefined && !entry.roller && !entry.teleport && !entry.pushable && !entry.toy;
}

/**
 * What a new apartment starts with, and where: a furnished room, so that a new player arrives somewhere that feels
 * lived in. Cells of the 10 x 10 room of a new apartment; the door (9, 0) and the way in stay free. `rot` turns a
 * piece; a wall piece hangs on the left wall (rot 0, cells with i = 0) or on the right wall (rot 1, cells with j = 0).
 */
export const STARTER_KIT: readonly { key: string; i: number; j: number; rot?: number }[] = [
  // The sleeping corner, against the left wall.
  { key: 'grandlit', i: 0, j: 1 },
  { key: 'chevet', i: 0, j: 0 },
  { key: 'chevet', i: 0, j: 2 },
  { key: 'commode', i: 0, j: 7 },
  { key: 'monstera', i: 0, j: 9 },
  { key: 'horlogemurale', i: 0, j: 7 },
  { key: 'cadresphoto', i: 0, j: 8 },
  // Along the right wall: a lamp, shelves, the television, a window on the sea.
  { key: 'lampadaire', i: 2, j: 0 },
  { key: 'fenetremer', i: 1, j: 0, rot: 1 },
  { key: 'etagere', i: 5, j: 0 },
  { key: 'tele', i: 6, j: 0 },
  { key: 'appliquelumineuse', i: 7, j: 0, rot: 1 },
  // The living corner, on a rug.
  { key: 'tapisrond', i: 4, j: 4 },
  { key: 'canape', i: 4, j: 6 },
  { key: 'tablebasse', i: 4, j: 3 },
  { key: 'fauteuil', i: 2, j: 4 },
  { key: 'pouf', i: 6, j: 4 },
  // A desk by the door, and small things in the far corner.
  { key: 'bureau', i: 8, j: 5 },
  { key: 'chaise', i: 7, j: 5 },
  { key: 'radio', i: 8, j: 8 },
  { key: 'lampelave', i: 9, j: 9 },
  { key: 'cactus', i: 9, j: 8 },
  { key: 'ours', i: 3, j: 9 },
  // Small things that make it lived in.
  { key: 'pilelivres', i: 1, j: 9 },
  { key: 'gueridon', i: 4, j: 7 },
  { key: 'tapisgris', i: 5, j: 5 },
  { key: 'corbeille', i: 8, j: 6 },
  { key: 'guitare', i: 6, j: 9 },
];

// ----- Floors and wallpapers: settings of the apartment, not objects -----------------

export type FloorPattern = 'planks' | 'checker' | 'tiles' | 'carpet' | 'stone' | 'grass' | 'sand';
export type WallPattern = 'damask' | 'plain' | 'stripes' | 'dots' | 'panels' | 'leaves' | 'stars' | 'brick';

export interface FloorStyle {
  id: string;
  name: string;
  a: number;
  b: number;
  line: number;
  /** How the floor is painted (see the client's room painter). */
  pattern: FloorPattern;
}

export interface WallStyle {
  id: string;
  name: string;
  left: number;
  right: number;
  trim: number;
  pattern: WallPattern;
}

export const DEFAULT_FLOOR = 'parquet';
export const DEFAULT_WALL = 'platre';

export const FLOORS: readonly FloorStyle[] = [
  { id: 'parquet', name: 'Parquet miel', a: 0xb88b56, b: 0xc79a62, line: 0x8f6a3e, pattern: 'planks' },
  { id: 'chene', name: 'Parquet chêne', a: 0xd6b27a, b: 0xe0be88, line: 0xa88652, pattern: 'planks' },
  { id: 'noyer', name: 'Parquet noyer', a: 0x7a4e32, b: 0x875a3a, line: 0x573624, pattern: 'planks' },
  { id: 'damier', name: 'Damier', a: 0xf4efe6, b: 0x4a3f7a, line: 0x2a2140, pattern: 'checker' },
  { id: 'carrelage', name: 'Carrelage bleu', a: 0x8ec0f5, b: 0x7fb2e8, line: 0x4a78b0, pattern: 'tiles' },
  { id: 'moquette', name: 'Moquette violette', a: 0x8f7bd0, b: 0x9a88d8, line: 0x6c58a8, pattern: 'carpet' },
  { id: 'rose', name: 'Moquette rose', a: 0xf2a6c0, b: 0xf7b6cd, line: 0xc27a96, pattern: 'carpet' },
  { id: 'pierre', name: 'Pierre grise', a: 0xa6a2b8, b: 0xb4b0c6, line: 0x7a7690, pattern: 'stone' },
  { id: 'herbe', name: 'Gazon', a: 0x5fb85a, b: 0x6cc666, line: 0x3f8a3c, pattern: 'grass' },
  { id: 'sable', name: 'Sable chaud', a: 0xe8cf94, b: 0xf0d9a4, line: 0xb89c62, pattern: 'sand' },
  { id: 'parquetgris', name: 'Parquet gris', a: 0x8e8a92, b: 0x9c98a2, line: 0x625e6a, pattern: 'planks' },
  { id: 'marbre', name: 'Marbre blanc', a: 0xe6e0d8, b: 0xf0ebe4, line: 0xbcb4a8, pattern: 'tiles' },
];

export const WALLS: readonly WallStyle[] = [
  { id: 'violet', name: 'Violet doux', left: 0x8a7fc0, right: 0x6c61a3, trim: 0xe9e0ff, pattern: 'damask' },
  { id: 'creme', name: 'Crème', left: 0xf0e2c4, right: 0xd9c8a4, trim: 0xffffff, pattern: 'panels' },
  { id: 'ciel', name: 'Bleu ciel', left: 0x8ec0e8, right: 0x6fa4d2, trim: 0xf0f8ff, pattern: 'stripes' },
  { id: 'bonbon', name: 'Rose bonbon', left: 0xf4a6c4, right: 0xd888a8, trim: 0xfff0f6, pattern: 'dots' },
  { id: 'menthe', name: 'Menthe', left: 0x9fe0c4, right: 0x7cc4a6, trim: 0xf0fff8, pattern: 'plain' },
  { id: 'moutarde', name: 'Moutarde', left: 0xe8c04a, right: 0xc9a23a, trim: 0xfff6d0, pattern: 'stripes' },
  { id: 'ardoise', name: 'Ardoise', left: 0x6e7490, right: 0x565c78, trim: 0xc8cce0, pattern: 'brick' },
  { id: 'bordeaux', name: 'Bordeaux', left: 0xa8485e, right: 0x883a4c, trim: 0xffd6de, pattern: 'damask' },
  { id: 'foret', name: 'Vert forêt', left: 0x4f9a6a, right: 0x3e7e56, trim: 0xd6f5e0, pattern: 'leaves' },
  { id: 'nuit', name: 'Bleu nuit', left: 0x3e4a8c, right: 0x2f3a72, trim: 0xb8c4f5, pattern: 'stars' },
  { id: 'platre', name: 'Plâtre gris', left: 0xb4b0bc, right: 0x96929f, trim: 0xe6e3ec, pattern: 'plain' },
  { id: 'beton', name: 'Béton', left: 0x86868f, right: 0x6c6c76, trim: 0xaeaeb8, pattern: 'panels' },
  { id: 'pierresombre', name: 'Pierre sombre', left: 0x66626e, right: 0x514e5a, trim: 0x8c8896, pattern: 'brick' },
  { id: 'boiserie', name: 'Boiserie', left: 0x8a5e3c, right: 0x6e4a2e, trim: 0xc49a6c, pattern: 'panels' },
];

export const floorStyle = (id: string): FloorStyle => FLOORS.find((f) => f.id === id) ?? FLOORS[0]!;
export const wallStyle = (id: string): WallStyle => WALLS.find((w) => w.id === id) ?? WALLS[0]!;
