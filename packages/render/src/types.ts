/** A 3D point in recipe space: x and y on the floor (one tile spans -8..8), z up. */
export type Vec3 = [number, number, number];

export interface BoxPart {
  t: 'box';
  x0: number; x1: number; y0: number; y1: number; z0: number; z1: number;
  /** Base colour; side faces are shaded automatically unless overridden. */
  c: string;
  top?: string; left?: string; right?: string;
}

export interface CylPart {
  t: 'cyl';
  x: number; y: number; r: number; z0: number; z1: number;
  side: string;
  top?: string;
}

export interface SpherePart {
  t: 'sphere';
  x: number; y: number; z: number; r: number;
  c: string;
}

/** A flat disc facing the screen (wheels, eyes, buttons). */
export interface CirclePart {
  t: 'circle';
  x: number; y: number; z: number; r: number;
  c: string;
  c2?: string;
}

export interface QuadPart {
  t: 'quad';
  pts: Vec3[];
  c: string;
}

/** A small block anchored at a projected point; w and h are in recipe units (0.5 to 8), SCALE pixels each. */
export interface PixPart {
  t: 'pix';
  x: number; y: number; z: number; w: number; h: number;
  c: string;
}

export type Part = BoxPart | CylPart | SpherePart | CirclePart | QuadPart | PixPart;

export interface Recipe {
  name: string;
  parts: Part[];
}

export interface Sprite {
  width: number;
  height: number;
  /** RGBA, row major, `width * height * 4` bytes. */
  data: Uint8ClampedArray;
  /** 1 where the sprite is opaque (outline included), for hit testing. */
  mask: Uint8Array;
}

/**
 * Recipes are drawn at twice the resolution of their coordinates: one unit of a
 * recipe is SCALE sprite pixels. The recipe format did not change, so every
 * object keeps its shape and simply gets finer, shaded detail.
 */
export const SCALE = 2;
/**
 * Version of the sprite format. Clients put it in sprite URLs so that browsers
 * never keep showing images drawn by an older engine (they are cached for long).
 * Bump it whenever the size or the look of rendered sprites changes.
 */
export const SPRITE_VERSION = 2;
export const SPRITE_W = 96 * SCALE;
export const SPRITE_H = 112 * SCALE;
/** Pixel of the sprite that sits on the centre of its floor tile. */
export const ANCHOR_X = 48 * SCALE;
export const ANCHOR_Y = 88 * SCALE;

/** Bounds every renderer and validator agrees on. */
export const LIMITS = {
  xy: 14,
  z: 70,
  maxParts: 80,
  maxQuadPoints: 6,
} as const;
