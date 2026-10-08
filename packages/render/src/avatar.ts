// The avatar: a person with a slender body and long legs, in shaded tones with a hard outline.
// A look (packages/render/src/look.ts) says what they wear; this file draws it
// from shaded shapes, then outlines it with the style guide's 1 px #1b1530.
// Pure pixels, no DOM: the room, the wardrobe and the shop all use it.

import { CLOTH_COLORS, HAIR_COLORS, SKIN_TONES, type Look } from './look';

export const OUTLINE = 0x1b1530;

/**
 * The five drawings of an avatar; the room mirrors them to get eight directions.
 * front: straight toward the viewer. front34 and back34: turned toward the right, seen from the front or the back.
 * side: in profile, facing right. back: straight away from the viewer.
 */
export type Facing = 'front' | 'front34' | 'side' | 'back34' | 'back';
/** Does this view show the face (and so the front of the clothes)? */
export const showsFace = (f: Facing) => f === 'front' || f === 'front34' || f === 'side';
/** 0 standing, 1 and 2 the two steps of a walk. */
export type Frame = 0 | 1 | 2;

/**
 * The drawing code places the body on a compact 30 x 58 sketch; a vertical warp then stretches it into a person
 * (see `BODY_WARP`): the head keeps its size, the torso and arms grow by a quarter, the legs almost double.
 * The avatar is drawn at RES times the resolution of its design grid: the room shows it at 1 / RES of the zoom.
 */
export const RES = 2;
/** Where the torso starts and ends on the sketch, where the legs end (the top of a planted shoe), and how much each part grows. */
const WARP_TORSO = [25.5, 40.5, 1.25] as const;
const WARP_LEGS = [40.5, 49, 1.9] as const;
/** Sketch y to design y: identity above the torso, stretched over the torso and the legs, shifted below. */
export function BODY_WARP(y: number): number {
  const [t0, t1, kt] = WARP_TORSO;
  const [, l1, kl] = WARP_LEGS;
  if (y <= t0) return y;
  if (y <= t1) return t0 + (y - t0) * kt;
  const torsoEnd = t0 + (t1 - t0) * kt;
  if (y <= l1) return torsoEnd + (y - t1) * kl;
  return torsoEnd + (l1 - t1) * kl + (y - l1);
}
/** How much broader the body is than the sketch, around its middle: shoulders nearly as wide as the head. */
const BODY_SPREAD = 1.22;
/** How much taller the person is than the sketch. */
const GROWTH = BODY_WARP(58) - 58;
/** How much the torso alone grows: a seated person keeps the legs of the sketch. */
const TORSO_GROWTH = BODY_WARP(WARP_TORSO[1]) - WARP_TORSO[1];
/** The warp of a seated person: the torso grows, the legs (folded at the knee) are only moved down. */
const SIT_WARP = (y: number) => (y <= WARP_TORSO[1] ? BODY_WARP(y) : y + TORSO_GROWTH);
export const AVATAR_W = 30 * RES;
/** Tall enough for the head of a seated player to sit above the seat, and for the legs to reach the floor. */
export const AVATAR_H = Math.ceil(58 + GROWTH) * RES;
/** A player lying down, drawn along the iso axis: wider and flatter. */
export const LIE_W = 84 * RES;
export const LIE_H = 60 * RES;

/** How the avatar is posed: standing (or walking), sitting, or lying down. */
export type Pose = 'stand' | 'sit' | 'lie';

export function avatarSize(pose: Pose): { w: number; h: number } {
  return pose === 'lie' ? { w: LIE_W, h: LIE_H } : { w: AVATAR_W, h: AVATAR_H };
}

export type RGB = [number, number, number];
export const rgb = (c: number): RGB => [(c >> 16) & 255, (c >> 8) & 255, c & 255];
export function tone(c: RGB, f: number): RGB {
  const t = f < 0 ? 0 : 255;
  const k = Math.min(1, Math.abs(f));
  return [Math.round(c[0] + (t - c[0]) * k), Math.round(c[1] + (t - c[1]) * k), Math.round(c[2] + (t - c[2]) * k)];
}
export function mix2(a: RGB, b: RGB, t: number): RGB {
  return [Math.round(a[0] + (b[0] - a[0]) * t), Math.round(a[1] + (b[1] - a[1]) * t), Math.round(a[2] + (b[2] - a[2]) * t)];
}
/**
 * A tiny shaded-shape painter on a transparent canvas. Shapes are given in design units (one unit is `k` pixels
 * of the canvas) and sampled pixel by pixel, so a bigger `k` gives finer curves, finer shading and a finer outline.
 */
export class Painter {
  readonly px: (RGB | null)[];
  /** Size of the canvas, in pixels. */
  readonly w: number;
  readonly h: number;
  /** Everything drawn is moved by this much (in design units): the same drawing code serves every pose. */
  ox = 0;
  oy = 0;

  constructor(
    designW: number,
    designH: number,
    readonly k = 1,
  ) {
    this.w = designW * k;
    this.h = designH * k;
    this.px = new Array(this.w * this.h).fill(null);
  }

  /** While set, what is drawn is moved sideways by this function (a turned head), and dropped where `keepX` says no. */
  mapX: ((x: number) => number) | null = null;
  keepX: ((x: number) => boolean) | null = null;
  /**
   * While set, every y given to a shape goes through this warp (the body of the sketch becomes a taller person).
   * `rigidAt` keeps a part at its own size, only moved as much as the warp moves that point (shoes), and `postY`
   * moves everything after the warp (a foot lifted in a step).
   */
  warpY: ((y: number) => number) | null = null;
  rigidAt: number | null = null;
  postY = 0;
  /** While set, every x given to a shape is spread around the middle of the body by this factor (broader shoulders). */
  spreadX = 1;

  private wx(x: number): number {
    return this.spreadX === 1 ? x : HX + (x - HX) * this.spreadX;
  }

  private wy(y: number): number {
    if (!this.warpY) return y + this.postY;
    const shift = this.rigidAt !== null ? this.warpY(this.rigidAt) - this.rigidAt : null;
    return (shift !== null ? y + shift : this.warpY(y)) + this.postY;
  }

  /** Writes one canvas pixel. */
  private put(fx: number, fy: number, c: RGB): void {
    if (fx < 0 || fy < 0 || fx >= this.w || fy >= this.h) return;
    this.px[fy * this.w + fx] = c;
  }

  /** Paints the canvas pixel under the design point (u, v), given as a pixel index: it goes through the turn and the offset. */
  private paint(u: number, v: number, c: RGB): void {
    if (this.keepX && !this.keepX(u)) return;
    const x = this.mapX ? this.mapX(u) : u;
    this.put(Math.floor((x + this.ox + 0.5) * this.k), Math.floor((v + this.oy + 0.5) * this.k), c);
  }

  /** One whole design pixel (k x k canvas pixels): for the bold marks of a drawing. */
  set(x: number, y: number, c: RGB): void {
    y = this.wy(y);
    x = this.wx(x);
    if (this.keepX && !this.keepX(x)) return;
    if (this.mapX) x = this.mapX(x);
    const xi = Math.round(x + this.ox) * this.k, yi = Math.round(y + this.oy) * this.k;
    for (let dy = 0; dy < this.k; dy++) for (let dx = 0; dx < this.k; dx++) this.put(xi + dx, yi + dy, c);
  }

  /** One canvas pixel (the finest mark there is): for the fine details of a face, a strand, a lace. */
  dot(x: number, y: number, c: RGB): void {
    this.paint(this.wx(x), this.wy(y), c);
  }

  /** A flat rectangle with exact edges, in design units. */
  rect(x0: number, y0: number, x1: number, y1: number, c: RGB): void {
    x0 = this.wx(x0);
    x1 = this.wx(x1);
    y0 = this.wy(y0);
    y1 = this.wy(y1);
    const k = this.k;
    for (let fy = Math.round(y0 * k); fy < Math.round(y1 * k); fy++) {
      for (let fx = Math.round(x0 * k); fx < Math.round(x1 * k); fx++) this.paint((fx + 0.5) / k - 0.5, (fy + 0.5) / k - 0.5, c);
    }
  }

  get(x: number, y: number): RGB | null {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return null;
    return this.px[y * this.w + x] ?? null;
  }

  /** A rounded limb between two points, lit from the upper left. */
  capsule(x0: number, y0: number, x1: number, y1: number, r: number, color: RGB): void {
    const steps = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0) / 0.5));
    const along = (shift: number, radius: number, c: RGB) => {
      for (let k = 0; k <= steps; k++) {
        const t = k / steps;
        this.ball(x0 + (x1 - x0) * t + shift * -0.35, y0 + (y1 - y0) * t + shift * -0.7, radius, radius, c, { flat: true });
      }
    };
    along(-r * 0.25, r, tone(color, -0.2));
    along(0, r * 0.85, color);
    along(r * 0.28, r * 0.42, tone(color, 0.16));
  }

  /** A ball lit from the upper left: a highlight, the base, a shade and a deeper rim, in clear bands. */
  ball(
    cx: number,
    cy: number,
    rx: number,
    ry: number,
    color: RGB,
    opts: { clip?: (x: number, y: number) => boolean; flat?: boolean } = {},
  ): void {
    // A clipped ball is cut along lines of the sketch: keep the clip in sketch space.
    if (this.warpY && !opts.clip) {
      cy = this.wy(cy);
      cx = this.wx(cx);
    }
    const k = this.k;
    for (let fy = Math.floor((cy - ry) * k); fy <= Math.ceil((cy + ry) * k); fy++) {
      for (let fx = Math.floor((cx - rx) * k); fx <= Math.ceil((cx + rx) * k); fx++) {
        const x = (fx + 0.5) / k, y = (fy + 0.5) / k;
        const a = (x - cx) / rx, b = (y - cy) / ry;
        const d = a * a + b * b;
        if (d > 1 || (opts.clip && !opts.clip(x - 0.5, y - 0.5))) continue;
        if (opts.flat) {
          this.paint(x - 0.5, y - 0.5, color);
          continue;
        }
        const lam = -0.45 * a - 0.6 * b + 0.55 * Math.sqrt(1 - d);
        this.paint(x - 0.5, y - 0.5, lam > 0.55 ? tone(color, 0.18) : lam > 0.3 ? tone(color, 0.08) : lam > -0.15 ? color : lam > -0.4 ? tone(color, -0.12) : tone(color, -0.24));
      }
    }
  }

  /** A box with rounded corners, a light left edge and top, a dark right edge and bottom. */
  block(x0: number, y0: number, x1: number, y1: number, color: RGB, radius = 1.5, shadeRight = true): void {
    x0 = this.wx(x0);
    x1 = this.wx(x1);
    y0 = this.wy(y0);
    y1 = this.wy(y1);
    const k = this.k;
    const e = 2 / k;
    for (let fy = Math.floor(y0 * k); fy < Math.ceil(y1 * k); fy++) {
      for (let fx = Math.floor(x0 * k); fx < Math.ceil(x1 * k); fx++) {
        const x = (fx + 0.5) / k, y = (fy + 0.5) / k;
        const cx = Math.max(x0 + radius, Math.min(x1 - radius, x));
        const cy = Math.max(y0 + radius, Math.min(y1 - radius, y));
        if (Math.hypot(x - cx, y - cy) > radius) continue;
        let f = 0;
        if (x < x0 + e) f += 0.1;
        else if (x < x0 + e * 1.8) f += 0.04;
        if (y < y0 + e) f += 0.08;
        if (shadeRight && x >= x1 - e) f -= 0.14;
        else if (shadeRight && x >= x1 - e * 1.8) f -= 0.05;
        if (y >= y1 - 1 / k * 2 + 1 / k) f -= 0.1;
        this.paint(x - 0.5, y - 0.5, tone(color, f));
      }
    }
  }

  /** Paints every canvas pixel (given as design pixel coordinates) where `colorAt` returns a colour. */
  fill(x0: number, y0: number, x1: number, y1: number, colorAt: (x: number, y: number, fx: number, fy: number) => RGB | null): void {
    const k = this.k;
    for (let fy = Math.floor(y0 * k); fy < Math.ceil(y1 * k); fy++) {
      for (let fx = Math.floor(x0 * k); fx < Math.ceil(x1 * k); fx++) {
        const u = (fx + 0.5) / k - 0.5, v = (fy + 0.5) / k - 0.5;
        const c = colorAt(u, v, fx, fy);
        if (c) this.paint(u, v, c);
      }
    }
  }
}


// ----- Colours of a look --------------------------------------------------------

interface Palette {
  skin: RGB;
  hair: RGB;
  top: RGB;
  bottom: RGB;
  shoes: RGB;
  hat: RGB;
  extra: RGB;
}

/** Colours replaced by the caller (the sign-in scene dresses its walkers in any colour). */
export interface Tint {
  top?: number;
  hair?: number;
}

const WHITE: RGB = [250, 248, 240];
const GOLD: RGB = [255, 200, 87];

function paletteOf(look: Look, tint: Tint): Palette {
  const cloth = (k: number) => rgb(CLOTH_COLORS[k] ?? CLOTH_COLORS[0]!);
  return {
    skin: rgb(SKIN_TONES[look.skin] ?? SKIN_TONES[0]!),
    hair: rgb(tint.hair ?? HAIR_COLORS[look.hairColor] ?? HAIR_COLORS[0]!),
    top: tint.top !== undefined ? rgb(tint.top) : cloth(look.topColor),
    bottom: cloth(look.bottomColor),
    shoes: cloth(look.shoesColor),
    hat: cloth(look.hatColor),
    extra: cloth(look.extraColor),
  };
}

/**
 * Where the limbs go for a given frame. A step is a real stride: the planted leg reaches forward
 * (toward the way the avatar faces, down-right before the mirror), the other one trails and lifts,
 * and the arms swing opposite to the legs.
 */
function swing(frame: Frame, wide = 1) {
  const l = frame === 1; // left leg trails and lifts
  const r = frame === 2; // right leg trails and lifts
  return {
    legL: l ? -3.5 : r ? 1.2 : 0, // vertical offset of each foot (negative = lifted)
    legR: r ? -3.5 : l ? 1.2 : 0,
    legLx: (l ? -2.2 : r ? 2.2 : 0) * wide, // horizontal offset of each leg
    legRx: (r ? -2.2 : l ? 2.2 : 0) * wide,
    armL: l ? 3.2 : r ? -3.2 : 0,
    armR: r ? 3.2 : l ? -3.2 : 0,
  };
}

// The look is a big head on a short, sturdy body, drawn in flat tones with a hard outline.
// Head: a rounded square, 20 wide and 19 tall. Everything on it is placed relative to these.
const HX = 15;
const HL = 5;
const HR = 25;
const HT = 6;
const HB = 25;
const EYE_X = [10.8, 19.2] as const;
// Torso.
const TL = 8.5;
const TR = 21.5;
const T0 = 25.5;
const T1 = 40.5;

// ----- Head -----------------------------------------------------------------------

/** How a head turns: features are squeezed toward the side the face looks to. */
function turnHead(p: Painter, facing: Facing): void {
  if (facing === 'front34') {
    p.mapX = (x) => HX + (x - HX) * 0.8 + 2.2;
    p.keepX = null;
  } else if (facing === 'side') {
    p.mapX = (x) => HX + (x - HX) * 0.55 + 3.6;
    // Only the eye, brow, cheek and glasses lens nearest to us are seen.
    p.keepX = (x) => x >= HX - 0.5;
  }
}

const isDark = (c: RGB) => c[0] * 0.3 + c[1] * 0.59 + c[2] * 0.11 < 115;

function drawFace(p: Painter, look: Look, pal: Palette, blink: boolean): void {
  const dark = rgb(OUTLINE);
  const skin = pal.skin;
  const darkSkin = isDark(skin);
  // The iris takes its colour from the hair: warm for brown, cold for blue, never the same grey.
  const iris = mix2(tone(pal.hair, -0.1), [90, 110, 170], 0.4);
  const brow = tone(pal.hair, -0.25);
  for (const ex of EYE_X) {
    if (blink || look.eyes === 2) {
      // Closed, or sleepy: a line under a heavy lid, with a lash at the outer corner.
      p.rect(ex - 1.9, 18.8, ex + 1.9, 19.4, dark);
      if (look.eyes === 2) {
        p.rect(ex - 1.9, 17.6, ex + 1.9, 18.8, tone(skin, -0.16));
        p.rect(ex + (ex < 15 ? -2.5 : 2), 18.4, ex + (ex < 15 ? -2 : 2.5), 19.2, dark);
      }
    } else if (look.eyes === 1) {
      // Laughing eyes: little arches.
      for (let t = -2; t <= 1.6; t += 0.4) p.rect(ex + t, 19.8 - (1 - (t / 2) ** 2) * 1.3, ex + t + 0.5, 20.3 - (1 - (t / 2) ** 2) * 1.3, dark);
    } else if (look.eyes === 3) {
      // Bright eyes: a big iris full of light.
      p.ball(ex, 18.8, 2.2, 2.6, WHITE, { flat: true });
      p.ball(ex, 18.9, 1.7, 2.2, iris, { flat: true });
      p.ball(ex, 19.1, 0.95, 1.3, dark, { flat: true });
      p.rect(ex - 1.1, 17.4, ex - 0.4, 18.1, WHITE);
      p.rect(ex + 0.1, 17.4, ex + 0.5, 17.9, WHITE);
      p.rect(ex + 0.5, 19.8, ex + 1.1, 20.4, mix2(iris, WHITE, 0.55));
      p.rect(ex - 2.2, 16.6, ex + 2.2, 17.2, dark);
    } else {
      // Round eyes: the white of the eye, a coloured iris, a pupil, a spark and a lash line.
      p.ball(ex, 18.8, 1.8, 2.1, WHITE, { flat: true });
      p.ball(ex + 0.1, 18.9, 1.2, 1.7, iris, { flat: true });
      p.ball(ex + 0.1, 19.1, 0.65, 1, dark, { flat: true });
      p.rect(ex - 0.5, 18, ex + 0.1, 18.6, WHITE);
      p.rect(ex - 2, 16.7, ex + 2, 17.3, dark);
      p.rect(ex + (ex < 15 ? -2.5 : 2), 17.2, ex + (ex < 15 ? -2 : 2.5), 17.8, dark);
    }
    // Eyebrows: a thin arch.
    p.rect(ex - 2, 15.2, ex + 2, 15.8, brow);
    p.rect(ex + (ex < 15 ? -2.5 : 2), 15.6, ex + (ex < 15 ? -2 : 2.5), 16.2, brow);
  }
  // A soft blush and a small nose.
  for (const cx of [8.6, 21.4]) p.ball(cx, 21.8, 1.5, 0.9, mix2(skin, [244, 120, 130], 0.32), { flat: true });
  p.rect(14.6, 20.4, 15.4, 21.4, tone(skin, -0.22));
  p.rect(14.1, 21.4, 15.9, 21.9, tone(skin, -0.12));
  p.rect(14.8, 19.8, 15.2, 20.3, tone(skin, 0.1));
  const mouth: RGB = darkSkin ? [0xd2, 0x6a, 0x72] : [0xa8, 0x3a, 0x3f];
  const lip = mix2(skin, [244, 140, 150], 0.4);
  if (look.mouth === 1) {
    p.ball(15, 23.6, 3, 1.6, [0x7a, 0x2a, 0x35], { flat: true });
    p.rect(12.6, 22.2, 17.4, 23.1, WHITE);
    p.rect(13.8, 24.2, 16.2, 24.8, [240, 120, 140]);
  } else if (look.mouth === 2) {
    p.rect(13.4, 23.3, 16.6, 23.9, mouth);
    p.rect(13.9, 23.9, 16.1, 24.3, lip);
  } else if (look.mouth === 3) {
    p.ball(15, 23.6, 1.3, 1.7, [0x7a, 0x2a, 0x35], { flat: true });
    p.rect(14.6, 22.8, 15.4, 23.3, lip);
  } else {
    // A small smile: a curved line with its corners turned up, and a light lip under it.
    for (let t = -2.6; t <= 2.6; t += 0.4) p.rect(15 + t - 0.25, 23.9 - 0.16 * t * t, 15 + t + 0.25, 24.4 - 0.16 * t * t, mouth);
    p.rect(13.8, 24.5, 16.2, 25, lip);
  }
}

/** Is this pixel on the head, grown by `grow` all around? */
const insideHead = (x: number, y: number, grow = 0.4) => {
  const rad = 4.6 + grow;
  const cx = Math.max(HL - grow + rad, Math.min(HR + grow - rad, x + 0.5));
  const cy = Math.max(HT - grow + rad, Math.min(HB + grow - rad, y + 0.5));
  return Math.hypot(x + 0.5 - cx, y + 0.5 - cy) <= rad;
};

/** Fills the hair where `inside` says so: a light top, a glossy arc, thin strands, a darker lower right. */
function cap(p: Painter, hair: RGB, inside: (x: number, y: number) => boolean, skin?: RGB): void {
  const e = 1 / p.k;
  p.fill(2, 2, 28, 27, (x, y, fx, fy) => {
    if (!inside(x, y)) return null;
    // A glossy arc follows the round of the skull; strands run down from the crown; the lower right is in shade.
    const arc = Math.hypot((x + 0.5 - HX) * 0.95, y + 0.5 - 13.4);
    let f = 0;
    if (arc > 8.7 && arc < 10 && x < 19 && y < 13) f += 0.2;
    else if (arc > 7.4 && arc <= 8.7 && x < 19 && y < 13) f += 0.07;
    if (x >= 22 || (y > 14 && x + y > 36)) f -= 0.13;
    if (y > 7.5 && (fx * 5 + Math.floor(fy / 5) * 3) % 8 === 0) f -= 0.09;
    // The hair just above the edge of the fringe is a little darker: it is thicker there.
    if (!inside(x, y + e * 1.5) && y > 9) f -= 0.12;
    return tone(hair, f);
  });
  // The fringe casts a thin shadow on the forehead.
  if (skin) p.fill(HL, HT, HR, 22, (x, y) => (inside(x, y - e) && !inside(x, y) && insideHead(x, y, 0) ? tone(skin, -0.16) : null));
}

/** A lock of hair hanging from y0 to y1, swaying a little: the pieces of long hair, braids and bobs are made of these. */
function lock(p: Painter, hair: RGB, x0: number, w: number, y0: number, y1: number, wave: number, edge = 1): void {
  for (let y = y0; y <= y1; y++) {
    const sx = x0 + Math.sin(y * 0.55 + x0) * wave;
    for (let k = 0; k < w; k++) {
      const x = Math.round(sx + k);
      let f = k === 0 ? 0.12 : k >= w - 1 ? -0.17 : 0;
      if ((y + k * 2) % 6 === 0) f -= 0.07;
      // The ends of the lock taper into a point.
      if (y > y1 - 1 - edge && (k === 0 || k >= w - 1)) continue;
      p.set(x, y, tone(hair, f));
    }
  }
}

function drawHair(p: Painter, look: Look, facing: Facing, pal: Palette): void {
  const hair = pal.hair;
  const front = showsFace(facing);
  const style = look.hair;
  if (style === 9) {
    // Bald: just a shine on the head.
    p.set(10, 8, tone(pal.skin, 0.3));
    p.set(11, 7.4, tone(pal.skin, 0.3));
    p.set(12, 7, tone(pal.skin, 0.3));
    return;
  }
  if (style === 7) {
    // Afro: a big round cloud around the face.
    p.ball(HX, 11.8, 11.4, 10.4, hair, {
      clip: (x, y) => !front || !(y >= 13.6 && x >= 7.2 && x < 22.8 && insideHead(x, y, -0.6)),
    });
    for (const [x, y] of [[9, 5], [10.4, 4], [12, 3.4]] as const) p.set(x, y, tone(hair, 0.3));
    return;
  }
  if (style === 8) {
    // Mohawk: shaved sides, a crest down the middle.
    p.block(12.8, 2, 17.2, front ? 13.4 : 22, hair, 1.4);
    for (const [sx, h] of [[13.4, 3], [15, 4], [16.6, 3]] as const) for (let k = 0; k < h; k++) p.set(sx, 2 - k * 0.5, tone(hair, 0.1));
    p.set(14, 4, tone(hair, 0.32));
    p.set(14, 6, tone(hair, 0.32));
    return;
  }
  const jag = (x: number) => (Math.floor(x) % 3 === 0 ? 1 : 0);
  const bangs = (x: number): number => {
    if (style === 5) return 15.8 - (x - 4) * 0.3;
    if (style === 2) return 11 + jag(x) * 0.6;
    if (style === 11) return 11.4 + Math.sin(x * 0.9) * 1.3;
    if (style === 12) return 11.6 + jag(x) * 1.6;
    if (style === 13) return 10.4 + jag(x);
    if (style === 14) return 9.4;
    if (style === 15 || style === 16) return 11 + Math.min(3, Math.abs(x + 0.5 - HX) * 0.6);
    if (style === 17) return 12.8;
    if (style === 18) return 9.2;
    return 12.2 + jag(x);
  };
  const narrow = (x: number) => style !== 14 || Math.abs(x + 0.5 - HX) < 8.2;
  const limit = (x: number) => bangs(x) + (Math.abs(x + 0.5 - HX) > 8.6 ? 5 : 0);
  cap(p, hair, (x, y) => insideHead(x, y, 1.4) && narrow(x) && (front ? y < limit(x) || (facing === 'side' && x < HX - 2.4 && y < 21) : y < 22.5), pal.skin);

  const ribbon = tone(hair, 0.45);
  if (style === 1 || style === 4) {
    // Long hair falls behind and beside the face; a bob stops at the chin.
    const drop = style === 1 ? 33 : 24;
    for (const side of [-1, 1]) {
      const x0 = side < 0 ? 3.4 : 23.2;
      p.block(x0, 11, x0 + 3.4, drop, hair, 1.4, side > 0);
    }
    if (!front) p.block(5, 14, 25, drop - 1, hair, 2.4);
  } else if (style === 2) {
    for (const [sx, h] of [[8.5, 4], [11.8, 5], [15, 6], [18.2, 5], [21.5, 4]] as const) {
      for (let k = 0; k < h; k++) {
        const w = Math.max(0, 1.8 - k * 0.36);
        for (let dx = -w; dx <= w; dx++) p.set(sx + dx, 7 - k, k > h - 3 ? tone(hair, 0.15) : hair);
      }
    }
  } else if (style === 3) {
    p.ball(15, 4, 3, 2.8, hair);
    p.set(13.6, 3, tone(hair, 0.3));
    p.set(14.6, 2.6, tone(hair, 0.3));
  } else if (style === 6) {
    // Pigtails, tied with little ribbons.
    for (const x0 of [1.8, 25]) {
      p.block(x0, 13.4, x0 + 3.2, 26, hair, 1.5, x0 > 15);
      p.block(x0 - 0.2, 12.6, x0 + 3.4, 14.4, ribbon, 0.6);
    }
  } else if (style === 10) {
    // A ponytail: at the back of the head, swinging out to one side from the front.
    if (front) {
      p.block(24.4, 10, 28.4, 30, hair, 1.8, true);
      p.block(24, 9.4, 28.8, 11.4, ribbon, 0.6);
    } else {
      p.block(12.8, 9, 17.2, 32, hair, 1.8);
      p.block(12.4, 9, 17.6, 10.8, ribbon, 0.6);
    }
  }
  else if (style === 11) {
    // Long wavy hair: two heavy locks in front of the shoulders, a curtain behind.
    if (front) {
      lock(p, hair, 2.8, 4.4, 11, 37, 1.1);
      lock(p, hair, 22.8, 4.4, 11, 37, 1.1);
    } else {
      lock(p, hair, 4.4, 21, 13, 36, 0.9, 2);
    }
  } else if (style === 12) {
    // Shaggy, messy mid-length hair, longer on one side.
    if (front) {
      lock(p, hair, 3.4, 3.6, 11, 26, 0.7);
      lock(p, hair, 23, 3.6, 11, 22, 0.7);
    } else {
      lock(p, hair, 4.6, 21, 13, 25, 0.5, 2);
    }
  } else if (style === 13) {
    // Curls: a cloud of little balls around the head.
    const curls: [number, number, number][] = [[6.6, 10.4, 3.6], [10, 6.6, 3.8], [15, 5.4, 4.2], [20, 6.6, 3.8], [23.4, 10.4, 3.6], [5.6, 15.4, 2.8], [24.4, 15.4, 2.8]];
    for (const [cx, cy, r] of curls) p.ball(cx, cy, r, r, hair);
    if (!front) for (const [cx, cy, r] of [[9, 17, 3.6], [15, 19, 4.2], [21, 17, 3.6], [6.6, 20, 2.8], [23.4, 20, 2.8]] as const) p.ball(cx, cy, r, r, hair);
  } else if (style === 14) {
    // A quiff swept up and back, with the sides shaved close.
    p.ball(17, 6.6, 8.8, 5.4, hair, { clip: (_x, y) => y < 10.6 });
    for (const [qx, qy] of [[11.4, 6.2], [12.4, 5.2], [13.8, 4.4], [15.4, 3.8], [17.2, 3.6]] as const) p.set(qx, qy, tone(hair, 0.35));
    for (let y = 5; y < 10; y++) p.set(20.6, y, tone(hair, -0.2));
    for (const sx of [5.4, 24.6]) for (let y = 8; y < 15; y++) p.set(sx, y, tone(hair, -0.3));
  } else if (style === 15) {
    // Two braids over the shoulders, tied with ribbons.
    for (const cx of [4.8, 25.2]) {
      for (let k = 0; k < 10; k++) p.ball(cx + (k % 2 ? 0.6 : -0.6), 15 + k * 2, 2.3, 1.7, k % 2 ? hair : tone(hair, -0.16), { flat: true });
      p.block(cx - 2.4, 35, cx + 2.4, 37, ribbon, 0.6);
    }
  } else if (style === 16) {
    // Two buns, high on each side of the head.
    for (const cx of [8, 22]) {
      p.ball(cx, 5.8, 3.8, 3.6, hair);
      p.set(cx - 1.4, 4.4, tone(hair, 0.32));
      p.set(cx - 0.4, 3.8, tone(hair, 0.32));
      p.block(cx - 2.2, 8.6, cx + 2.2, 9.8, ribbon, 0.4);
    }
  }
  // A strand of light on top of the head.
  if (front || style !== 3) {
    for (const [x, y] of [[8.4, 9], [9.4, 8], [10.8, 7.2], [12.6, 6.6]] as const) p.set(x, y, tone(hair, 0.35));
  }
}

function drawHat(p: Painter, look: Look, facing: Facing, pal: Palette): void {
  const c = pal.hat;
  const front = showsFace(facing);
  switch (look.hat) {
    case 1: {
      // A cap with a visor.
      p.ball(HX, 10, 11, 7.2, c, { clip: (_x, y) => y < 10.8 });
      if (front) p.block(3.6, 10.2, 26.4, 12.8, tone(c, -0.22), 0.9, true);
      else p.block(6, 10.2, 24, 12, tone(c, -0.15), 0.8);
      p.set(HX, 3.6, tone(c, 0.3));
      break;
    }
    case 2: {
      // A beanie with a pompom.
      const b = tone(c, -0.05);
      p.ball(HX, 10, 11.2, 8, b, { clip: (_x, y) => y < 10.6 });
      for (let x = 5; x < 26; x++) if (x % 2 === 0) p.set(x, 10, tone(b, -0.18));
      p.block(4, 10.6, 26, 13.4, tone(b, 0.12), 1.2);
      p.ball(HX, 3.6, 2.5, 2.5, tone(b, 0.35));
      break;
    }
    case 3: {
      // A golden crown, one gem in the colour of the hat.
      p.block(6, 6.4, 24, 10, GOLD, 0.8);
      for (const [cx, h] of [[7.4, 3], [11.2, 4], [15, 5], [18.8, 4], [22.6, 3]] as const) {
        for (let k = 0; k < h; k++) {
          const w = Math.max(0, 1.2 - k * 0.26);
          for (let dx = -w; dx <= w; dx += 0.5) p.set(cx + dx, 6.4 - k, k === h - 1 ? tone(GOLD, 0.35) : GOLD);
        }
      }
      p.set(15, 8.2, c);
      p.set(10.6, 8.2, tone(c, 0.2));
      p.set(19.4, 8.2, tone(c, 0.2));
      break;
    }
    case 4: {
      // A top hat.
      p.block(3.4, 8.4, 26.6, 11, tone(c, -0.35), 0.9);
      p.block(8.4, 1.4, 21.6, 9.4, c, 1.2);
      p.block(8.4, 6.4, 21.6, 8.6, tone(c, 0.45), 0.5, false);
      p.set(10.4, 3, tone(c, 0.4));
      p.set(10.4, 4.2, tone(c, 0.4));
      break;
    }
    case 5: {
      // Cat ears on a headband.
      p.block(4.6, 8, 25.4, 10.2, tone(c, -0.1), 0.8);
      for (const side of [-1, 1]) {
        for (let k = 0; k < 7; k++) {
          const half = 3 - k * 0.42;
          const cx = HX + side * (6.4 - k * 0.25);
          for (let dx = -half; dx <= half; dx += 0.5) p.set(cx + dx, 8 - k, k > 4 ? tone(c, 0.15) : c);
        }
        for (let k = 0; k < 3; k++) p.set(HX + side * (6.4 - k * 0.25), 7 - k, [255, 170, 190]);
      }
      break;
    }
    case 6: {
      // A sweatband.
      p.block(4.2, 8.6, 25.8, 11.6, c, 0.8);
      for (let x = 5; x < 25.6; x += 3) p.set(x, 10, tone(c, 0.35));
      break;
    }
    case 7: {
      // A wizard hat: a bent cone with a brim and a golden star.
      p.block(2.4, 9, 27.6, 11.8, tone(c, -0.25), 1.2);
      for (let k = 0; k <= 7; k++) {
        const half = Math.max(0.6, 8 - k);
        const cx = HX + k * k * 0.04;
        for (let x = cx - half; x <= cx + half; x += 0.5) p.set(x, 9 - k, k % 3 === 0 ? tone(c, -0.12) : c);
      }
      p.block(7, 7.6, 23, 9.4, GOLD, 0.4);
      for (const [sx, sy] of [[14, 5], [13, 5], [15, 5], [14, 4], [14, 6]] as const) p.set(sx, sy, [255, 230, 130]);
      break;
    }
    case 8: {
      // A crown of flowers on a vine.
      for (let x = 6; x <= 24; x += 0.5) p.set(x, 8.2 + ((x - 15) / 9) ** 2 * 2.4, [63, 155, 75]);
      const petals: RGB[] = [c, WHITE, [255, 160, 190], c, WHITE];
      [7.6, 11.4, 15, 18.6, 22.4].forEach((cx, k) => {
        const cy = 7.8 + ((cx - 15) / 9) ** 2 * 2.4;
        for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]] as const) p.set(cx + dx, cy + dy, petals[k]!);
        p.set(cx, cy, [255, 214, 90]);
      });
      break;
    }
    case 9: {
      // Headphones: a band over the head, a cushion over each ear.
      for (let t = 0; t <= 1; t += 0.02) {
        const a = Math.PI * (1 - t);
        const hx = HX + Math.cos(a) * 10.8;
        const hy = 17 - Math.sin(a) * 13.4;
        p.set(hx, hy, c);
        p.set(hx, hy + 1, tone(c, -0.2));
      }
      for (const side of [-1, 1]) {
        const x0 = side < 0 ? 2.4 : 23.8;
        p.block(x0, 14.4, x0 + 3.8, 22.4, tone(c, side < 0 ? -0.05 : -0.25), 1.6, side > 0);
        p.block(x0 + (side < 0 ? 0.6 : 0.8), 15.6, x0 + 2.8 + (side < 0 ? 0.4 : 0.6), 21, tone(c, 0.25), 1);
      }
      break;
    }
    case 10: {
      // A beret, tilted to one side, with a little stalk.
      p.ball(13.4, 8.6, 11, 5.2, c, { clip: (x, y) => y < 11.4 && insideHead(x, y, 2.4) });
      p.block(5, 9.4, 24, 11.2, tone(c, -0.2), 0.8);
      p.set(17.4, 3.4, tone(c, -0.3));
      p.set(17.4, 2.6, tone(c, -0.3));
      p.set(9, 6, tone(c, 0.3));
      p.set(10, 5.4, tone(c, 0.3));
      break;
    }
    case 11: {
      // A hood: it wraps the head, and leaves the face open.
      const opening = (x: number, y: number) => front && y >= 11.2 && insideHead(x, y, -0.2);
      p.ball(HX, 13.2, 12.6, 11.8, c, { clip: (x, y) => !opening(x, y) });
      const hood = (x: number, y: number) => ((x + 0.5 - HX) / 12.6) ** 2 + ((y + 0.5 - 13.2) / 11.8) ** 2 <= 1 && !opening(x, y);
      if (front) {
        // The edge of the hood around the face is in shadow, and a drawstring hangs on each side.
        for (let y = 2; y < 27; y++) {
          for (let x = 2; x < 28; x++) {
            if (hood(x, y) && (opening(x - 1, y) || opening(x + 1, y) || opening(x, y + 1))) p.set(x, y, tone(c, -0.3));
          }
        }
        for (const x of [11.6, 18.4]) for (let y = 26; y < 31; y++) p.set(x, y, WHITE);
      }
      for (let y = 4; y < 12; y++) p.set(HX, y, tone(c, -0.18));
      break;
    }
    case 12: {
      // A bandana knotted at the side, with white dots.
      p.block(4.2, 8.6, 25.8, 12, c, 0.8);
      for (let x = 6; x < 25; x += 3) p.set(x, 10.2, WHITE);
      p.set(26.4, 10, c);
      p.set(27.4, 10.8, c);
      p.set(26.6, 11.8, tone(c, -0.2));
      p.set(27.6, 12.8, tone(c, -0.2));
      break;
    }
    case 13: {
      // A cowboy hat: a wide curled brim and a dented crown.
      p.block(1.8, 9.2, 28.2, 12.2, tone(c, -0.2), 1.4);
      p.set(2, 8.4, tone(c, -0.2));
      p.set(28, 8.4, tone(c, -0.2));
      p.block(8.6, 2.6, 21.4, 10, c, 2.2);
      p.block(8.6, 7.4, 21.4, 9, tone(c, -0.35), 0.4, false);
      for (let y = 3.2; y < 6.4; y++) p.set(15, y, tone(c, -0.3));
      p.set(10.4, 4.4, tone(c, 0.3));
      p.set(10.4, 5.4, tone(c, 0.3));
      break;
    }
    case 14: {
      // A straw hat with a ribbon in the colour of the hat.
      const straw: RGB = [228, 188, 108];
      p.ball(HX, 10.6, 14, 3.6, tone(straw, -0.08));
      p.ball(HX, 7, 8.4, 5.4, straw, { clip: (_x, y) => y < 10 });
      p.block(6.6, 7.6, 23.4, 9.8, c, 0.6);
      for (let x = 3; x < 28; x += 2) p.set(x, 11 + (x % 4 === 1 ? 0 : -1), tone(straw, -0.2));
      for (let x = 8; x < 22; x += 2) p.set(x, 5 + (x % 4 === 0 ? 0 : 1), tone(straw, 0.15));
      break;
    }
    default:
      break;
  }
}

function drawGlasses(p: Painter, look: Look): void {
  const dark = rgb(OUTLINE);
  if (look.glasses === 1) {
    for (const ex of EYE_X) {
      for (let a = 0; a < 64; a++) {
        const t = (a / 64) * Math.PI * 2;
        p.dot(ex + Math.cos(t) * 3.4, 18.4 + Math.sin(t) * 3.4, dark);
      }
      p.dot(ex - 1.4, 16.6, WHITE);
    }
    for (let x = 14; x <= 16; x += 0.5) p.dot(x, 17.6, dark);
  } else if (look.glasses === 2) {
    for (const ex of EYE_X) {
      for (let x = ex - 3.2; x <= ex + 3.2; x += 0.5) {
        p.dot(x, 15.8, dark);
        p.dot(x, 21, dark);
      }
      for (let y = 15.8; y <= 21; y += 0.5) {
        p.dot(ex - 3.2, y, dark);
        p.dot(ex + 3.2, y, dark);
      }
      p.dot(ex - 1.8, 17, WHITE);
    }
    for (let x = 14; x <= 16; x += 0.5) p.dot(x, 16.8, dark);
  } else if (look.glasses === 3) {
    for (const ex of EYE_X) {
      p.block(ex - 3.6, 16, ex + 3.6, 21, [34, 28, 58], 1.2);
      p.dot(ex - 2, 17.2, [150, 190, 255]);
      p.dot(ex - 1, 16.8, [150, 190, 255]);
    }
    for (let x = 14; x <= 16; x += 0.5) p.dot(x, 16.6, dark);
  } else if (look.glasses === 4) {
    const pink: RGB = [255, 110, 160];
    const shape = ['.#.#.', '#####', '.###.', '..#..'];
    for (const ex of EYE_X) {
      shape.forEach((row, ry) =>
        [...row].forEach((ch, rx) => {
          if (ch === '#') p.dot(ex - 2.5 + rx, 16.4 + ry * 1.3, ry === 0 && rx === 1 ? [255, 190, 210] : pink);
        }),
      );
    }
    for (let x = 14; x <= 16; x += 0.5) p.dot(x, 17.8, dark);
  } else if (look.glasses === 5) {
    // Aviators: big teardrop lenses in a thin golden frame.
    for (const ex of EYE_X) {
      p.block(ex - 3.8, 15.6, ex + 3.8, 22, GOLD, 2.4);
      p.block(ex - 3, 16.4, ex + 3, 21.2, [86, 130, 160], 2);
      p.dot(ex - 1.8, 17.2, [200, 230, 250]);
      p.dot(ex - 0.8, 16.8, [200, 230, 250]);
    }
    for (let x = 14; x <= 16; x += 0.5) p.dot(x, 16.6, GOLD);
  } else if (look.glasses === 6) {
    // An eyepatch over one eye, held by a strap across the head.
    for (let x = 5; x < 25; x++) p.dot(x, 14 + (x - 5) * 0.06, [34, 28, 58]);
    p.block(EYE_X[0] - 3.2, 15.4, EYE_X[0] + 3.2, 21.6, [34, 28, 58], 1.8);
    p.dot(EYE_X[0] - 1.6, 17, [90, 84, 120]);
  }
}

function drawHead(p: Painter, look: Look, pal: Palette, facing: Facing, blink: boolean): void {
  // The ears first (the head hides their inner half), then a block of skin, the face (front only), hair, hat and glasses.
  if (facing !== 'side') {
    p.block(3.4, 16, 6.4, 21.8, tone(pal.skin, -0.06), 1.2);
    p.block(23.6, 16, 26.6, 21.8, tone(pal.skin, -0.2), 1.2);
  }
  p.block(HL, HT, HR, HB, pal.skin, 4.6);
  // The light comes from the upper left: a soft cheek, a shaded jaw and a shaded right side.
  p.fill(HL, 12, HR, HB + 1, (x, y) => {
    if (!insideHead(x, y, 0)) return null;
    if (y >= 23.4) return tone(pal.skin, -0.12);
    if (x >= 22.6 && y > 14) return tone(pal.skin, -0.09);
    if (x >= 6 && x < 10 && y >= 19 && y < 23) return tone(pal.skin, 0.05);
    return null;
  });
  if (facing === 'side') p.block(11.4, 16.4, 14.8, 21.8, tone(pal.skin, -0.14), 1.2);
  if (showsFace(facing)) {
    turnHead(p, facing);
    drawFace(p, look, pal, blink);
    if (facing === 'side') {
      // The nose sticks out of the profile.
      p.mapX = null;
      p.keepX = null;
      p.set(25.4, 20, tone(pal.skin, 0.06));
      p.set(26.2, 21, pal.skin);
      turnHead(p, facing);
    }
    drawGlasses(p, look);
    p.mapX = null;
    p.keepX = null;
  }
  drawHair(p, look, facing, pal);
  drawHat(p, look, facing, pal);
}

// ----- Body -----------------------------------------------------------------------

const SHOE_SOLE: RGB = [244, 239, 230];

function drawLeg(p: Painter, look: Look, pal: Palette, x0: number, off: number, seated: boolean): void {
  const covers = look.bottom === 0 || look.bottom === 2 || look.bottom === 4 || look.bottom === 6 || look.bottom === 7;
  const skirt = look.bottom === 3;
  const bottom = pal.bottom;
  const shoeTop = seated ? 47.4 : 49 + off;
  const shoeBot = seated ? 52.4 : 54.6 + off;
  const segs: [number, number][] = seated ? [[38.5, 44.4], [43.4, 48.6]] : [[39 + off * 0.5, 50 + off]];
  const clothEnd = covers ? 99 : look.bottom === 5 ? (seated ? 46.4 : 47.8 + off) : seated ? 44.4 : 43.6 + off;

  for (const [a, b] of segs) {
    const clothB = Math.min(b, clothEnd);
    if (!skirt && clothB > a) {
      p.block(x0, a, x0 + 5.4, clothB, bottom, 1.2);
      p.block(x0 + 0.3, a, x0 + 5.1, Math.min(clothB, a + 4), tone(bottom, 0.08), 0.9);
    }
    const skinA = skirt ? a : Math.max(a, clothEnd - 0.4);
    if (b > skinA && (skirt || clothEnd < b)) p.block(x0 + 0.6, skinA, x0 + 4.8, b, pal.skin, 1);
  }
  if (!skirt && !covers) p.block(x0, clothEnd - 1, x0 + 5.4, clothEnd + 0.2, tone(bottom, -0.22), 0.4, false);
  if (look.bottom === 2) {
    // A stripe down the outside of each leg, and cuffs.
    const outer = x0 < 12 ? x0 + 0.4 : x0 + 4.6;
    for (let y = 41; y < shoeTop; y += 1) p.set(outer, y, WHITE);
    p.block(x0, shoeTop - 2, x0 + 5.4, shoeTop, tone(bottom, -0.2), 0.4, false);
  } else if (look.bottom === 4) {
    p.block(x0 + 0.6, seated ? 40 : 42.2 + off * 0.5, x0 + 4.8, seated ? 43.6 : 46 + off * 0.5, tone(bottom, -0.14), 0.7);
    p.set(x0 + 2.7, seated ? 40.6 : 43 + off * 0.5, tone(bottom, 0.3));
  } else if (look.bottom === 0) {
    // Jeans: a seam of lighter stitches.
    for (let y = 42; y < shoeTop - 1; y += 2) p.set(x0 + 2.7, y + (seated ? 0 : off * 0.5), tone(bottom, 0.22));
  } else if (look.bottom === 5) {
    // Bermuda shorts: a seam and a deep hem.
    for (let y = 40; y < clothEnd - 2; y += 2) p.set(x0 + 0.9, y, tone(bottom, 0.22));
    p.block(x0, clothEnd - 2.2, x0 + 5.4, clothEnd, tone(bottom, -0.16), 0.4, false);
  } else if (look.bottom === 6) {
    // Ripped jeans: a patch of skin at the knee, frayed edges.
    const ky = seated ? 40.4 : 43 + off * 0.5;
    p.block(x0 + 1, ky, x0 + 4.4, ky + 2.4, pal.skin, 0.6);
    for (const dx of [0.4, 1.6, 2.8, 4.2]) p.set(x0 + dx, ky - 0.4, tone(bottom, 0.4));
    for (let y = 46; y < shoeTop - 1; y += 2) p.set(x0 + 2.7, y + (seated ? 0 : off * 0.5), tone(bottom, 0.22));
  } else if (look.bottom === 7) {
    // Suit trousers: a sharp crease down each leg and a dark cuff.
    for (let y = 40; y < shoeTop - 1; y++) p.set(x0 + 2.7, y + (seated ? 0 : off * 0.5), tone(bottom, 0.2));
    p.block(x0, shoeTop - 1.6, x0 + 5.4, shoeTop, tone(bottom, -0.25), 0.4, false);
  }

  // Shoes keep their size: the warp only moves them down with the end of the leg.
  p.rigidAt = shoeTop;
  const sx = x0 - 1;
  const shoe = pal.shoes;
  if (look.shoes === 3) {
    p.block(x0 - 0.4, shoeTop + 0.6, x0 + 6.2, shoeBot - 0.6, pal.skin, 1.3, true);
    for (const dx of [2.4, 3.8, 5.2]) p.set(x0 + dx, shoeBot - 1.8, tone(pal.skin, -0.25));
  } else if (look.shoes === 1) {
    // Boots: tall, with a lighter cuff.
    const top = shoeTop - 4.6;
    p.block(x0 - 0.2, top, x0 + 5.6, shoeTop + 1.4, shoe, 1);
    p.block(x0 - 0.2, top, x0 + 5.6, top + 1.4, tone(shoe, 0.25), 0.4, false);
    p.block(sx, shoeTop, x0 + 6.6, shoeBot, shoe, 1.8, true);
    p.block(sx, shoeBot - 1.4, x0 + 6.6, shoeBot, tone(shoe, -0.45), 0.5, false);
  } else if (look.shoes === 2) {
    // High-tops: up to the ankle, white toe cap and laces.
    p.block(x0 - 0.3, shoeTop - 2.4, x0 + 5.7, shoeTop + 1.4, shoe, 1);
    p.block(sx, shoeTop, x0 + 6.6, shoeBot, shoe, 1.8, true);
    p.block(x0 + 3.8, shoeBot - 3.2, x0 + 6.6, shoeBot - 0.8, SHOE_SOLE, 1);
    p.block(sx, shoeBot - 1.2, x0 + 6.6, shoeBot, SHOE_SOLE, 0.4, false);
    p.set(x0 + 2.6, shoeTop - 1.2, WHITE);
    p.set(x0 + 2.6, shoeTop + 0.2, WHITE);
  } else if (look.shoes === 4) {
    // Sandals: bare feet, a sole and two straps.
    p.block(sx + 0.4, shoeTop + 0.8, x0 + 6.4, shoeBot - 0.6, pal.skin, 1.4, true);
    p.block(sx, shoeBot - 1.4, x0 + 6.6, shoeBot, shoe, 0.5, false);
    for (const dy of [1.6, 3.2]) p.block(x0 - 0.2, shoeTop + dy - 0.4, x0 + 6, shoeTop + dy + 0.8, shoe, 0.3, false);
  } else if (look.shoes === 5) {
    // Dress shoes: dark and shiny, with a thin sole and a heel.
    const dk = tone(shoe, -0.3);
    p.block(sx, shoeTop + 0.4, x0 + 6.6, shoeBot - 0.6, dk, 1.8, true);
    p.block(sx, shoeBot - 1.2, x0 + 6.6, shoeBot, tone(dk, -0.4), 0.4, false);
    p.set(x0 + 3, shoeTop + 1.2, tone(dk, 0.5));
    p.set(x0 + 4, shoeTop + 1.2, tone(dk, 0.5));
    p.set(x0 + 5, shoeTop + 2, tone(dk, 0.4));
    p.block(x0, shoeTop - 1.2, x0 + 4.8, shoeTop + 1, dk, 0.8);
  } else if (look.shoes === 6) {
    // Ankle boots: a short shaft, a zip, a chunky heel.
    p.block(x0 - 0.2, shoeTop - 3.4, x0 + 5.6, shoeTop + 1.4, shoe, 1);
    p.block(sx, shoeTop, x0 + 6.6, shoeBot, shoe, 1.8, true);
    p.block(sx, shoeBot - 1.6, x0 + 6.6, shoeBot, tone(shoe, -0.5), 0.4, false);
    for (let y = shoeTop - 2.6; y < shoeTop + 1; y++) p.set(x0 + 4.6, y, tone(shoe, 0.4));
    p.set(x0 + 2.6, shoeTop - 3, tone(shoe, 0.3));
  } else {
    // Trainers: a white sole and a hint of laces.
    p.block(sx, shoeTop, x0 + 6.6, shoeBot, shoe, 2, true);
    p.block(sx, shoeBot - 1.4, x0 + 6.6, shoeBot, SHOE_SOLE, 0.5, false);
    p.set(x0 + 3, shoeTop + 1, WHITE);
    p.set(x0 + 4.4, shoeTop + 1, WHITE);
  }
  p.rigidAt = null;
}

function drawArms(p: Painter, look: Look, pal: Palette, frame: Frame): void {
  const o = swing(frame);
  const sleeveless = look.top === 7;
  const short = look.top === 0 || look.top === 1 || look.top === 3 || look.top === 8 || look.top === 9 || look.top === 13 || look.top === 14;
  const sleeve = look.top === 5 ? tone(pal.top, -0.1) : look.top === 13 ? tone(WHITE, -0.04) : pal.top;
  for (const [x0, off] of [[4.2, o.armL], [21.6, o.armR]] as const) {
    p.block(x0 + 0.3, 26.6 + off, x0 + 3.9, 38.4 + off, pal.skin, 1.4, x0 > 15);
    if (!sleeveless) {
      const end = short ? 33 : 37.4;
      p.block(x0, 26.2 + off, x0 + 4.2, end + off, sleeve, 1.8, x0 > 15);
      p.block(x0, end - 1.6 + off, x0 + 4.2, end + off, tone(sleeve, short ? -0.12 : 0.14), 0.5, false);
      if (look.top === 1) for (let y = 28; y < end; y += 3) for (let x = x0; x < x0 + 4; x++) p.set(x, y + off, tone(sleeve, 0.24));
      if (look.top === 11) {
        // Plaid sleeves.
        for (let y = 28; y < end; y += 3) for (let x = x0; x < x0 + 4; x++) p.set(x, y + off, tone(sleeve, -0.16));
        for (let x = x0 + 1; x < x0 + 4; x += 3) for (let y = 27; y < end; y++) p.set(x, y + off, tone(sleeve, -0.12));
      } else if (look.top === 12) {
        p.block(x0, end - 2.4 + off, x0 + 4.2, end + off, tone(sleeve, -0.3), 0.4, false);
      } else if (look.top === 14) {
        for (let x = x0; x < x0 + 4; x++) p.set(x, end - 1.6 + off, WHITE);
      } else if (look.top === 10) {
        for (let y = 28; y < end - 2; y += 4) for (let x = x0 + 0.6; x < x0 + 4; x += 2) p.set(x, y + off, tone(sleeve, 0.4));
      }
    }
    p.ball(x0 + 2.1, 40.4 + off, 2.4, 2.4, pal.skin);
  }
}

function drawTorso(p: Painter, look: Look, pal: Palette, facing: Facing): void {
  const t = pal.top;
  const front = showsFace(facing);
  const style = look.top;
  const belt = tone(pal.bottom, -0.3);

  // Neck and collar.
  p.block(12.6, 23.4, 17.4, 27.6, tone(pal.skin, -0.12), 0.8);

  if (style === 8) {
    // A dress: the torso flares into a skirt.
    p.block(TL, T0, TR, 36, t, 2);
    p.block(7, 34.4, 23, 46, t, 1.6);
    p.block(TL, 33.6, TR, 35.6, tone(t, -0.25), 0.6);
    p.block(7, 44.4, 23, 46, tone(t, 0.22), 0.5, false);
    for (let x = 9; x < 23; x += 3) for (let y = 36; y < 44; y++) p.set(x, y, tone(t, -0.12));
  } else if (style === 7) {
    p.block(TL + 0.6, 28, TR - 0.6, T1, t, 2);
    p.block(TL + 0.4, T1 - 2.4, TR - 0.4, T1, belt, 0.8, true);
    // The shoulders and chest above the tank top are bare skin.
    p.block(TL + 0.6, T0, TR - 0.6, 28.6, pal.skin, 1);
    p.block(10, T0, 12.6, 29, t, 0.6);
    p.block(17.4, T0, 20, 29, t, 0.6);
  } else if (style === 15) {
    // A long coat: it covers the hips and flares a little.
    p.block(TL - 0.6, T0, TR + 0.6, 47, t, 2.2);
    p.block(TL - 1, 42, TR + 1, 47.2, t, 1.4);
    p.block(TL - 1, 45.6, TR + 1, 47.2, tone(t, -0.25), 0.4, false);
  } else if (style === 13) {
    // A waistcoat over a white shirt.
    p.block(TL, T0, TR, T1, tone(WHITE, -0.04), 2.2);
    p.block(TL + 0.4, T1 - 2.4, TR - 0.4, T1, belt, 0.8, true);
  } else {
    p.block(TL, T0, TR, T1, t, 2.2);
    p.block(TL + 0.4, T1 - 2.4, TR - 0.4, T1, belt, 0.8, true);
  }

  // Folds: a shadow under each arm, and creases at the waist.
  if (style !== 7) {
    for (let y = 27; y < 33; y++) {
      p.set(TL + 0.5, y, tone(t, -0.17));
      p.set(TR - 1.5, y, tone(t, -0.2));
    }
  }
  for (const [cx, dy] of [[11.4, 0], [18.4, 1]] as const) {
    for (let k = 0; k < 4; k++) p.set(cx + (cx < 15 ? k * 0.35 : -k * 0.35), 33.4 + dy + k, tone(t, -0.14));
  }

  if (style === 6) {
    p.block(12, 23.4, 18, 27.8, t, 1);
    for (let y = 24; y < 27.6; y += 1.4) for (let x = 12.4; x < 17.8; x++) p.set(x, y, tone(t, -0.14));
  } else if (front && style !== 4 && style !== 7 && style < 10) {
    for (let x = 12; x <= 18; x++) p.set(x, 27.2 - Math.abs(x - 15) * 0.2, tone(t, -0.25));
    if (style === 0 || style === 8) for (let x = 12; x <= 18; x++) p.set(x, 26.2, tone(t, 0.18));
  }

  if (style === 1) {
    for (let y = 27; y < 39; y += 3) for (let x = TL; x < TR; x++) p.set(x, y, tone(t, 0.24));
  } else if (style === 2) {
    // A hood around the neck, and a front pocket.
    p.ball(15, 26.4, 7.4, 2.8, tone(t, -0.16));
    p.block(12.6, 23.4, 17.4, 26.6, tone(pal.skin, -0.12), 0.8);
    if (front) {
      p.block(10.5, 33, 19.5, 38, tone(t, -0.14), 1);
      for (const x of [13, 17]) {
        p.set(x, 28, WHITE);
        p.set(x, 29, WHITE);
        p.set(x, 30, WHITE);
      }
    }
  } else if (style === 3 && front) {
    const star: RGB = [255, 230, 130];
    for (const [sx, sy] of [[15, 29], [15, 30], [15, 31], [14, 30], [16, 30], [13, 30], [17, 30], [14, 31], [16, 31], [14, 32], [16, 32]] as const) p.set(sx, sy, star);
  } else if (style === 4) {
    // Shirt and tie: a white collar and a red tie.
    if (front) {
      for (let k = 0; k < 4; k++) {
        p.set(12.6 - k * 0.4, 25.6 + k, WHITE);
        p.set(17.4 + k * 0.4, 25.6 + k, WHITE);
      }
      p.block(14, 26.8, 16, 28.8, [200, 50, 60], 0.4);
      p.block(14.2, 28.8, 15.8, 36.4, [200, 50, 60], 0.4);
      p.block(14.4, 36.4, 15.6, 38, tone([200, 50, 60], -0.2), 0.3);
      p.set(15, 30, [255, 130, 140]);
      for (const y of [37, 38.6]) p.set(11.4, y, tone(t, 0.3));
    } else {
      p.block(11.6, 25.6, 18.4, 27, WHITE, 0.4);
    }
  } else if (style === 5) {
    // A jacket over a white shirt, with lapels, buttons and pockets.
    if (front) {
      p.block(13, 25.6, 17, T1, WHITE, 0.4);
      for (let k = 0; k < 8; k++) {
        p.set(13 - k * 0.12, 26 + k, tone(t, -0.28));
        p.set(17 + k * 0.12, 26 + k, tone(t, -0.28));
        p.set(12 - k * 0.1, 26 + k, tone(t, -0.14));
        p.set(18 + k * 0.1, 26 + k, tone(t, -0.14));
      }
      for (const y of [34, 37]) {
        p.set(12, y, GOLD);
        p.set(18, y, GOLD);
      }
      p.block(9.6, 36, 12.4, 37.2, tone(t, -0.22), 0.3);
      p.block(17.6, 36, 20.4, 37.2, tone(t, -0.22), 0.3);
    } else {
      p.block(14.6, 26, 15.4, 39, tone(t, -0.18), 0.2);
    }
  } else if (style === 6) {
    for (let x = 10; x < 21; x += 2) for (let y = 28; y < 39; y++) if (y % 4 !== 0) p.set(x, y, tone(t, -0.1));
    p.block(TL + 0.2, T1 - 2.4, TR - 0.2, T1 - 0.2, tone(t, -0.2), 0.4, false);
  } else if (style === 10) {
    // A knitted jumper: a ribbed collar and hem, a band of zigzags across the chest.
    p.block(12, 23.8, 18, 27.6, tone(t, -0.14), 1);
    for (let x = 12.6; x < 18; x += 1.6) for (let y = 24.4; y < 27; y++) p.set(x, y, tone(t, -0.28));
    p.block(TL, T1 - 2.6, TR, T1, tone(t, -0.16), 0.6, false);
    for (let x = TL + 1; x < TR; x += 2) for (let y = T1 - 2.4; y < T1; y++) p.set(x, y, tone(t, -0.3));
    for (let x = TL + 0.6; x < TR - 0.4; x++) {
      p.set(x, 30.6 + (Math.floor(x) % 4 < 2 ? 0 : 1.4), tone(t, 0.5));
      p.set(x, 34 + (Math.floor(x) % 4 < 2 ? 1.4 : 0), tone(t, -0.28));
    }
    for (let x = TL + 1; x < TR; x += 3) p.set(x, 32.4, WHITE);
  } else if (style === 11) {
    // A plaid shirt: crossing lines, a placket with buttons, a pointed collar.
    for (let x = TL + 1; x < TR; x += 3) for (let y = T0 + 1; y < T1 - 2; y++) p.set(x, y, tone(t, -0.14));
    for (let y = T0 + 3; y < T1 - 2; y += 3) for (let x = TL + 1; x < TR; x++) p.set(x, y, Math.floor(x - TL - 1) % 3 === 0 ? tone(t, -0.3) : tone(t, -0.16));
    if (front) {
      for (let y = 27; y < T1 - 2; y++) p.set(15, y, tone(t, -0.34));
      for (const y of [29.4, 32.4, 35.4]) p.set(16, y, WHITE);
      for (let k = 0; k < 4; k++) {
        p.set(12.8 - k * 0.5, 25.6 + k, tone(t, 0.4));
        p.set(17.2 + k * 0.5, 25.6 + k, tone(t, 0.4));
      }
    } else {
      p.block(12, 25.4, 18, 27, tone(t, 0.3), 0.4);
    }
  } else if (style === 12) {
    // A bomber jacket: ribbed collar and hem, a zip, slanted pockets.
    p.block(11, 24.4, 19, 27.6, tone(t, -0.3), 1);
    for (let x = 11.6; x < 18.6; x += 1.6) p.set(x, 25.6, tone(t, -0.45));
    p.block(TL, T1 - 3.2, TR, T1, tone(t, -0.3), 0.6, false);
    for (let x = TL + 1; x < TR; x += 2) for (let y = T1 - 3; y < T1; y++) p.set(x, y, tone(t, -0.45));
    if (front) {
      for (let y = 27.4; y < T1 - 3; y++) p.set(15, y, tone(WHITE, -0.1));
      p.set(15, 28, GOLD);
      for (const [px, dir] of [[10.6, 1], [19.4, -1]] as const) for (let k = 0; k < 4; k++) p.set(px + dir * k * 0.5, 35 + k * 0.5, tone(t, -0.3));
    } else {
      p.block(13.4, 27.6, 16.6, 38, tone(t, -0.12), 0.6);
    }
    for (let y = 28; y < 33; y++) p.set(TL + 1.2, y, tone(t, 0.3));
  } else if (style === 13) {
    // The two panels of the waistcoat leave a V of white shirt; a few buttons.
    if (front) {
      p.block(TL, T0, 12.8, T1, t, 1.6);
      p.block(17.2, T0, TR, T1, t, 1.6);
      for (let k = 0; k < 5; k++) {
        p.set(12.8 + k * 0.4, 25.6 + k, tone(t, -0.3));
        p.set(17.2 - k * 0.4, 25.6 + k, tone(t, -0.3));
      }
      for (const y of [30.6, 33.4, 36.2]) p.set(16.4, y, GOLD);
      p.block(9.6, 35.6, 12, 36.6, tone(t, -0.25), 0.3);
    } else {
      p.block(TL, T0 + 1, TR, T1, t, 2);
    }
    for (let x = 13.4; x < 17.6; x++) p.set(x, 25.6, tone(WHITE, -0.2));
  } else if (style === 14) {
    // A sports shirt: white stripes down the sides, a V collar, a number.
    for (const x of [TL + 1.4, TR - 2.4]) for (let y = T0 + 0.4; y < T1 - 1; y++) p.set(x, y, tone(WHITE, -0.05));
    for (let k = 0; k < 4; k++) {
      p.set(12.6 + k * 0.6, 26 + k, WHITE);
      p.set(17.4 - k * 0.6, 26 + k, WHITE);
    }
    if (front) {
      for (const [nx, ny] of [[13, 31], [14, 31], [15, 31], [16, 31], [16, 32], [15.6, 33], [15, 34], [14.6, 35], [14.2, 36]] as const) p.set(nx, ny, WHITE);
    } else {
      for (const [nx, ny] of [[13, 29], [14, 29], [15, 29], [16, 29], [16, 30], [15.6, 31], [15, 32], [14.6, 33], [14.2, 34]] as const) p.set(nx, ny, WHITE);
    }
  } else if (style === 15) {
    // Wide lapels, two rows of buttons, a belt with a buckle.
    p.block(TL - 0.6, 36.2, TR + 0.6, 38.4, tone(t, -0.35), 0.5);
    p.set(15, 37.2, GOLD);
    p.set(16, 37.2, GOLD);
    if (front) {
      for (let k = 0; k < 8; k++) {
        p.set(13.2 - k * 0.15, 25.6 + k, tone(t, -0.32));
        p.set(16.8 + k * 0.15, 25.6 + k, tone(t, -0.32));
        p.set(12 - k * 0.15, 25.6 + k, tone(t, 0.12));
        p.set(18 + k * 0.15, 25.6 + k, tone(t, 0.12));
      }
      for (const y of [30, 33.4, 40, 43.4]) for (const x of [12.4, 17.6]) p.set(x, y, GOLD);
      for (let y = 26; y < 47; y++) p.set(15, y, tone(t, -0.3));
    } else {
      for (let y = 26; y < 46; y++) p.set(15, y, tone(t, -0.28));
    }
  } else if (style === 9) {
    // Overalls: a bib and straps in the colour of the trousers, over the T-shirt.
    const bib = pal.bottom;
    p.block(10.2, 25.6, 12.6, 33, bib, 0.6);
    p.block(17.4, 25.6, 19.8, 33, bib, 0.6);
    if (front) {
      p.block(10.6, 32, 19.4, T1, bib, 1);
      p.block(12.4, 35, 17.6, 38.4, tone(bib, -0.15), 0.6);
      p.set(11, 33, GOLD);
      p.set(19, 33, GOLD);
    } else {
      p.block(10.2, 33, 19.8, T1, bib, 1);
    }
  }
}

/** What is worn behind the body: wings and a cape. */
function drawBehind(p: Painter, look: Look, pal: Palette, frame: Frame): void {
  const flap = frame === 0 ? 0 : 1;
  if (look.extra === 3) {
    for (const side of [-1, 1]) {
      const cx = 15 + side * 10.6;
      p.ball(cx, 31 - flap, 3.2, 10, [244, 242, 250]);
      p.ball(cx + side * 0.2, 38 - flap, 2.5, 4.6, tone([244, 242, 250], -0.08));
      for (let k = 0; k < 3; k++) p.set(cx - side * 0.4, 26 + k * 3.4 - flap, tone([244, 242, 250], -0.2));
    }
  } else if (look.extra === 6) {
    // Bat wings: a bony arm and a membrane with scalloped edges.
    const wing = tone(pal.extra, -0.15);
    for (const side of [-1, 1]) {
      const cx = 15 + side * 10.2;
      p.ball(cx, 27 - flap, 3.6, 10.4, wing);
      for (const [dx, y, r] of [[-2, 37.4, 1.6], [0, 38.6, 2.2], [2, 37.4, 1.6]] as const) p.ball(cx + dx * side, y - flap, r, r, tone(wing, -0.1));
      for (let y = 18; y < 36; y++) p.set(cx - side * 0.4, y - flap, tone(wing, 0.28));
      for (const dx of [-1.8, 1.6]) for (let y = 30; y < 38; y++) p.set(cx + dx * side, y - flap, tone(wing, -0.3));
    }
  } else if (look.extra === 7) {
    // A fox tail: bushy, with a white tip, behind the right leg.
    p.ball(24.4, 43, 3.6, 6, pal.extra);
    p.ball(25.6, 48.4, 2.4, 2.6, WHITE);
    p.set(23, 40, tone(pal.extra, 0.3));
    p.set(23.4, 41, tone(pal.extra, 0.3));
  } else if (look.extra === 4) {
    const cape = pal.extra;
    p.block(6.8, 26, 23.2, 50 - flap, cape, 2);
    p.block(6.8, 47, 23.2, 50 - flap, tone(cape, -0.22), 0.6, false);
    p.block(7, 26, 8.8, 47, tone(cape, 0.14), 0.5, false);
  }
}

/** What is worn over the body: a scarf, a bow tie, a backpack. */
function drawOver(p: Painter, look: Look, pal: Palette, facing: Facing): void {
  const front = showsFace(facing);
  if (look.extra === 1) {
    const scarf = pal.extra;
    p.block(9.6, 23.2, 20.4, 28, scarf, 1.6);
    p.block(9.6, 26.4, 20.4, 28, tone(scarf, -0.2), 0.5, false);
    for (let x = 10.4; x < 20; x += 2) p.set(x, 24.6, tone(scarf, 0.25));
    if (front) {
      p.block(16.4, 26.6, 20.4, 36, scarf, 1);
      p.block(16.4, 34, 20.4, 36, tone(scarf, -0.2), 0.4, false);
      for (let y = 28; y < 34; y += 2) p.set(18.4, y, tone(scarf, 0.25));
    }
  } else if (look.extra === 5) {
    const bow = pal.extra;
    if (front) {
      p.block(11.2, 25.4, 14.6, 29.2, bow, 0.8);
      p.block(15.4, 25.4, 18.8, 29.2, bow, 0.8);
      p.block(14.2, 26, 15.8, 28.6, tone(bow, -0.3), 0.4);
    } else {
      p.block(13.4, 25.4, 16.6, 27.4, tone(bow, -0.2), 0.4);
    }
  } else if (look.extra === 8) {
    // A string of pearls and a small pendant.
    const pearl = mix2(pal.extra, WHITE, 0.7);
    for (let t = -1; t <= 1; t += 0.3) p.set(15 + t * 5, 27 + (1 - t * t) * 3.4, t === 0 ? WHITE : pearl);
    p.ball(15, 32.4, 1.4, 1.4, GOLD);
    p.set(14.4, 31.8, WHITE);
  } else if (look.extra === 9) {
    // A medal on a ribbon.
    const ribbon = pal.extra;
    for (let k = 0; k < 8; k++) {
      p.set(11 + k * 0.5, 25.6 + k * 0.9, ribbon);
      p.set(12 + k * 0.5, 25.6 + k * 0.9, tone(ribbon, -0.15));
      if (front) {
        p.set(19 - k * 0.5, 25.6 + k * 0.9, ribbon);
        p.set(18 - k * 0.5, 25.6 + k * 0.9, tone(ribbon, -0.15));
      }
    }
    if (front) {
      p.ball(15, 35, 2.8, 2.8, GOLD);
      p.set(14.4, 34, WHITE);
      p.set(15.6, 35.6, tone(GOLD, -0.3));
    }
  } else if (look.extra === 10) {
    // A shoulder bag: a strap across the chest, the bag on the opposite hip.
    const bag = pal.extra;
    const m = (x: number) => (front ? x : 30 - x);
    for (let t = 0; t <= 1; t += 0.025) {
      const x = 9.8 + t * 11.4, y = 26 + t * 13;
      p.set(m(x), y, bag);
      p.set(m(x + 1.2), y, tone(bag, -0.2));
    }
    const bx = front ? 18.4 : 5.6;
    p.block(bx, 36.4, bx + 6.4, 44, tone(bag, -0.12), 1.2, front);
    p.block(bx, 36.4, bx + 6.4, 39.6, bag, 1.2, front);
    p.set(bx + 3.2, 39.2, GOLD);
    p.set(bx + 1, 37, tone(bag, 0.3));
  } else if (look.extra === 2) {
    const bag = pal.extra;
    if (front) {
      // Straps over the shoulders and the bulge of the bag at the sides.
      for (const x of [10, 18.6]) p.block(x, 26, x + 1.6, 39, tone(bag, -0.1), 0.4);
      p.block(6.8, 30, 8.8, 39, tone(bag, -0.2), 0.8);
      p.block(21.2, 30, 23.2, 39, tone(bag, -0.28), 0.8);
    } else {
      p.block(9, 26.4, 21, 41, bag, 2);
      p.block(9, 26.4, 21, 32, tone(bag, 0.14), 1.4);
      p.block(11, 34, 19, 39.6, tone(bag, -0.16), 0.8);
      p.set(15, 32, GOLD);
    }
  }
}

function drawBody(p: Painter, look: Look, pal: Palette, facing: Facing, frame: Frame, seated = false): void {
  const o = swing(frame, facing === 'side' ? 3.2 : 1);
  // Wings and capes already reach the edges of the canvas: they keep the width of the sketch.
  const spread = p.spreadX;
  p.spreadX = 1;
  drawBehind(p, look, pal, frame);
  p.spreadX = spread;

  // A leg is drawn planted, then lifted as a whole: the step does not stretch with the warp.
  for (const [x0, off] of seated ? ([[9.3, 0], [15.3, 0]] as const) : ([[9.3 + o.legLx, o.legL], [15.3 + o.legRx, o.legR]] as const)) {
    p.postY = off;
    drawLeg(p, look, pal, x0, 0, seated);
    p.postY = 0;
  }
  // A skirt hangs from the waist, over the tops of the legs.
  if (look.bottom === 3 && look.top !== 8) {
    const skirt = pal.bottom;
    p.block(7.6, 37.6, 22.4, 46.4, skirt, 1.6);
    p.block(7.6, 44.8, 22.4, 46.4, tone(skirt, 0.2), 0.5, false);
    for (let x = 9; x < 22; x += 3) for (let y = 39; y < 44; y++) p.set(x, y, tone(skirt, -0.14));
  }

  drawArms(p, look, pal, frame);
  drawTorso(p, look, pal, facing);
  drawOver(p, look, pal, facing);
}

// ----- Lying ----------------------------------------------------------------------

/**
 * Lying on the back, along the iso axis, the head up-left on the pillow and the
 * feet down-right. The body is built from rounded limbs; the head is the usual one.
 */
function drawLying(p: Painter, look: Look, pal: Palette): void {
  const skin = pal.skin, shirt = pal.top, pants = pal.bottom, shoe = pal.shoes;
  const bare = look.bottom === 1 || look.bottom === 3;
  const legColor = bare ? skin : pants;
  const d: [number, number] = [0.894, 0.447]; // one pixel along the iso x axis
  const side: [number, number] = [-0.447, 0.894]; // across the body, toward the viewer
  const head: [number, number] = [14, 9];
  const at = (from: [number, number], dist: number, across = 0): [number, number] => [
    from[0] + d[0] * dist + side[0] * across,
    from[1] + d[1] * dist + side[1] * across,
  ];
  const shoulders = at(head, 15);
  // The same person as standing: a longer torso and long legs.
  const hips = at(shoulders, 14);
  const knees = at(hips, 12);
  const feet = at(knees, 10);

  // The far arm and leg first, then the body, then what is nearest the viewer.
  p.capsule(...at(shoulders, 1, -5), ...at(hips, -1, -5.5), 2, shirt);
  p.ball(...at(hips, 1, -5.5), 1.9, 1.9, skin);
  p.capsule(...at(hips, 0, -2), ...at(feet, 0, -2), 2.6, legColor);
  p.capsule(...at(feet, 0, -2), ...at(feet, 4, -2), 2.3, look.shoes === 3 ? skin : shoe);
  p.capsule(...at(hips, 0, 2), ...at(feet, 0, 2.2), 2.8, tone(legColor, 0.05));
  p.capsule(...at(feet, 0, 2.2), ...at(feet, 4.5, 2.2), 2.5, look.shoes === 3 ? skin : shoe);
  p.capsule(...shoulders, ...hips, 4.8, shirt);
  p.capsule(...at(shoulders, 1, 6), ...at(hips, -1, 6.4), 2.1, tone(shirt, 0.04));
  p.ball(...at(hips, 1.5, 6.4), 1.9, 1.9, skin);
  p.block(...at(shoulders, -2, -3), ...at(shoulders, 3, 3), tone(shirt, -0.1), 1);
  p.ball(...at(head, 10.5, 0), 2.3, 2.3, tone(skin, -0.12));
  // The head rests on the pillow, up and to the left of the shoulders.
  p.ox = 0;
  p.oy = 3;
  drawHead(p, look, pal, 'front', true);
}

/** Turns the body below the neck: the same drawing, squeezed toward its middle, reads as a body seen at an angle. */
function squeezeBody(p: Painter, from: number, k: number): void {
  const mid = (HX + p.ox) * p.k;
  for (let y = Math.max(0, Math.round((from + p.oy) * p.k)); y < p.h; y++) {
    const row = p.px.slice(y * p.w, (y + 1) * p.w);
    for (let x = 0; x < p.w; x++) {
      const sx = Math.round(mid + (x - mid) / k);
      p.px[y * p.w + x] = sx >= 0 && sx < p.w ? (row[sx] ?? null) : null;
    }
  }
}

function build(look: Look, tint: Tint, facing: Facing, frame: Frame, blink: boolean, pose: Pose): Painter {
  const { w, h } = avatarSize(pose);
  const p = new Painter(w / RES, h / RES, RES);
  const pal = paletteOf(look, tint);
  if (pose === 'lie') {
    // The body is drawn lower on the canvas than the head; drawLying moves the head itself.
    p.ox = -1;
    p.oy = 7;
    drawLying(p, look, pal);
  } else if (pose === 'sit') {
    // Hips at seat height: the upper body is raised, the legs hang from the knees down to the floor. Only the torso
    // grows; the whole drawing goes down so that the hips stay as high above the bottom of the canvas as on the sketch.
    p.warpY = SIT_WARP;
    p.spreadX = BODY_SPREAD;
    p.oy = 3 + (h / RES - 58) - (SIT_WARP(38.5) - 38.5);
    drawBody(p, look, pal, facing, 0, true);
    p.warpY = null;
    p.spreadX = 1;
    drawHead(p, look, pal, facing, blink);
  } else {
    p.warpY = BODY_WARP;
    p.spreadX = BODY_SPREAD;
    drawBody(p, look, pal, facing, frame);
    p.warpY = null;
    p.spreadX = 1;
    if (facing === 'side') squeezeBody(p, T0 - 0.5, 0.55);
    else if (facing === 'front34' || facing === 'back34') squeezeBody(p, T0 - 0.5, 0.86);
    drawHead(p, look, pal, facing, blink);
  }
  return p;
}

/** RGBA pixels of one frame, outline included. No DOM needed. */
export function avatarPixels(
  look: Look,
  facing: Facing = 'front',
  frame: Frame = 0,
  blink = false,
  pose: Pose = 'stand',
  tint: Tint = {},
): Uint8ClampedArray {
  return outlinePixels(build(look, tint, facing, frame, blink, pose));
}

/** RGBA pixels of a painted canvas with the style guide's outline around it. */
export function outlinePixels(p: Painter): Uint8ClampedArray {
  const { w, h } = p;
  const data = new Uint8ClampedArray(w * h * 4);
  const put = (x: number, y: number, c: RGB) => {
    const o = (y * w + x) * 4;
    data[o] = c[0];
    data[o + 1] = c[1];
    data[o + 2] = c[2];
    data[o + 3] = 255;
  };
  const out = rgb(OUTLINE);
  // Outline: every empty pixel touching a filled one (4-neighbourhood), then the body on top.
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (p.get(x, y)) continue;
      if (p.get(x - 1, y) || p.get(x + 1, y) || p.get(x, y - 1) || p.get(x, y + 1)) put(x, y, out);
    }
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const c = p.get(x, y);
      if (c) put(x, y, c);
    }
  }
  return data;
}
