/** A 3D point in recipe space: x and y on the floor (one tile spans -8..8), z up. */
export type Vec3 = [number, number, number];

/** Surface materials a box or a quad can wear: the engine paints the pattern, the recipe only names it. */
export const TEXTURES = [
  'wood', 'planks', 'stone', 'brick', 'tile', 'fabric', 'weave', 'thatch', 'logs',
  'grass', 'leaves', 'metal', 'stripes', 'checker', 'dots', 'marble', 'glass', 'water',
] as const;
export type Texture = (typeof TEXTURES)[number];
export const isTexture = (v: unknown): v is Texture => typeof v === 'string' && (TEXTURES as readonly string[]).includes(v);

export interface BoxPart {
  t: 'box';
  x0: number; x1: number; y0: number; y1: number; z0: number; z1: number;
  /** Base colour; side faces are shaded automatically unless overridden. */
  c: string;
  top?: string; left?: string; right?: string;
  /** Material pattern drawn over every face (shaded from the face colours). */
  tex?: Texture;
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
  tex?: Texture;
}

/** A soft halo of light (lamp, window, fire): brightens what is under it and fades out. */
export interface GlowPart {
  t: 'glow';
  x: number; y: number; z: number; r: number;
  c: string;
  /** 0.1 to 1, default 0.6. */
  a?: number;
}

/** A small block anchored at a projected point; w and h are in recipe units (0.5 to 8), SCALE pixels each. */
export interface PixPart {
  t: 'pix';
  x: number; y: number; z: number; w: number; h: number;
  c: string;
}

export type Part = BoxPart | CylPart | SpherePart | CirclePart | QuadPart | PixPart | GlowPart;

/** Footprint on the floor, in tiles: [along x (i), along y (j)]. One tile unless the recipe says otherwise. */
export type Size = [number, number];

export interface Recipe {
  name: string;
  parts: Part[];
  /** Missing means 1 x 1. A bigger piece covers w x h tiles; the recipe origin stays the centre of its first tile. */
  size?: Size;
}

export interface Sprite {
  width: number;
  height: number;
  /** RGBA, row major, `width * height * 4` bytes. */
  data: Uint8ClampedArray;
  /** 1 where the sprite is opaque (outline included), for hit testing. */
  mask: Uint8Array;
  /** Pixel of the sprite that sits on the centre of the first floor tile. */
  ax: number;
  ay: number;
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
  maxParts: 200,
  maxQuadPoints: 6,
} as const;

/** Biggest footprint a piece may cover, per side. */
export const MAX_SIDE = 3;
/** Floor span of one tile, in recipe units. */
export const TILE_UNITS = 16;

/** Clean a size from untrusted data: integers from 1 to MAX_SIDE, 1 x 1 when anything is off. */
export function normalizeSize(v: unknown): Size {
  if (!Array.isArray(v) || v.length < 2) return [1, 1];
  const side = (n: unknown) => {
    const k = Math.round(Number(n));
    return Number.isFinite(k) ? Math.max(1, Math.min(MAX_SIDE, k)) : 1;
  };
  return [side(v[0]), side(v[1])];
}

/** Size of a piece after quarter turns: an odd count swaps the sides. */
export function rotatedSize(size: Size, turns: number): Size {
  return Math.abs(Math.trunc(turns)) % 2 === 1 ? [size[1], size[0]] : [size[0], size[1]];
}

/** Range of recipe coordinates a piece of this size may use. */
export function boundsFor(size: Size) {
  const [w, h] = size;
  const taller = Math.max(w, h) - 1;
  return {
    xMin: -LIMITS.xy, xMax: TILE_UNITS * (w - 1) + LIMITS.xy,
    yMin: -LIMITS.xy, yMax: TILE_UNITS * (h - 1) + LIMITS.xy,
    zMax: LIMITS.z + 24 * taller,
  };
}

/** Pixel frame of a sprite for a footprint: size of the image and where the first tile's centre sits. */
export function frameFor(size: Size): { width: number; height: number; ax: number; ay: number } {
  const [w, h] = size;
  const extraZ = 24 * (Math.max(w, h) - 1);
  return {
    width: SCALE * (96 + TILE_UNITS * (w + h - 2)),
    height: SCALE * (112 + 8 * (w + h - 2) + extraZ),
    ax: SCALE * (48 + TILE_UNITS * (h - 1)),
    ay: SCALE * (88 + extraZ),
  };
}

