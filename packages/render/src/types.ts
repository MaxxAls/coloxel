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

/** A small block of screen pixels anchored at a projected point. */
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

export const SPRITE_W = 96;
export const SPRITE_H = 112;
/** Pixel of the sprite that sits on the centre of its floor tile. */
export const ANCHOR_X = 48;
export const ANCHOR_Y = 88;

/** Bounds every renderer and validator agrees on. */
export const LIMITS = {
  xy: 14,
  z: 70,
  maxParts: 80,
  maxQuadPoints: 6,
} as const;
