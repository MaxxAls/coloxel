// The avatar: a big head on a short, sturdy body, in flat tones with a hard outline.
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

export const AVATAR_W = 30;
/** Tall enough for the head of a seated player to sit above the seat, and for the legs to reach the floor. */
export const AVATAR_H = 58;
/** A player lying down, drawn along the iso axis: wider and flatter. */
export const LIE_W = 66;
export const LIE_H = 50;

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
/** A tiny shaded-shape painter on a transparent canvas. */
export class Painter {
  readonly px: (RGB | null)[];
  /** Everything drawn is moved by this much: the same drawing code serves every pose. */
  ox = 0;
  oy = 0;

  constructor(
    readonly w: number,
    readonly h: number,
  ) {
    this.px = new Array(w * h).fill(null);
  }

  /** While set, what is drawn is moved sideways by this function (a turned head), and dropped where `keepX` says no. */
  mapX: ((x: number) => number) | null = null;
  keepX: ((x: number) => boolean) | null = null;

  set(x: number, y: number, c: RGB): void {
    if (this.keepX && !this.keepX(x)) return;
    if (this.mapX) x = this.mapX(x);
    const xi = Math.round(x + this.ox), yi = Math.round(y + this.oy);
    if (xi < 0 || yi < 0 || xi >= this.w || yi >= this.h) return;
    this.px[yi * this.w + xi] = c;
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

  /** A ball lit from the upper left: highlight, base, shade and a deeper rim, with dithered seams. */
  ball(
    cx: number,
    cy: number,
    rx: number,
    ry: number,
    color: RGB,
    opts: { clip?: (x: number, y: number) => boolean; flat?: boolean } = {},
  ): void {
    for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++) {
      for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
        const a = (x + 0.5 - cx) / rx, b = (y + 0.5 - cy) / ry;
        const d = a * a + b * b;
        if (d > 1 || (opts.clip && !opts.clip(x, y))) continue;
        if (opts.flat) {
          this.set(x, y, color);
          continue;
        }
        const lam = -0.45 * a - 0.6 * b + 0.55 * Math.sqrt(1 - d);
        // Hard bands, no dithering: a crisp pixel-art look with three clear tones.
        this.set(x, y, lam > 0.5 ? tone(color, 0.14) : lam > -0.22 ? color : tone(color, -0.2));
      }
    }
  }

  /** A box with rounded corners, a light left edge and top, a dark right edge and bottom. */
  block(x0: number, y0: number, x1: number, y1: number, color: RGB, radius = 1.5, shadeRight = true): void {
    for (let y = Math.floor(y0); y < Math.ceil(y1); y++) {
      for (let x = Math.floor(x0); x < Math.ceil(x1); x++) {
        const cx = Math.max(x0 + radius, Math.min(x1 - radius, x + 0.5));
        const cy = Math.max(y0 + radius, Math.min(y1 - radius, y + 0.5));
        if (Math.hypot(x + 0.5 - cx, y + 0.5 - cy) > radius) continue;
        let f = 0;
        if (x < x0 + 1.5) f += 0.1;
        if (y < y0 + 1.5) f += 0.08;
        if (shadeRight && x >= x1 - 2.5) f -= 0.14;
        if (y >= y1 - 1.5) f -= 0.1;
        this.set(x, y, tone(color, f));
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
  for (const ex of EYE_X) {
    if (blink || look.eyes === 2) {
      // Closed, or sleepy: a line under a heavy lid, with a lash at the outer corner.
      for (let dx = -1.8; dx <= 1.8; dx += 0.9) p.set(ex + dx, 19, dark);
      if (look.eyes === 2) {
        for (let dx = -1.8; dx <= 1.8; dx += 0.9) p.set(ex + dx, 18, tone(skin, -0.18));
        p.set(ex + (ex < 15 ? -2.6 : 2.6), 18.6, dark);
      }
    } else if (look.eyes === 1) {
      // Laughing eyes: little arches.
      for (const [dx, dy] of [[-2, 1], [-1, 0], [0, -0.4], [1, 0], [2, 1]] as const) p.set(ex + dx, 19 + dy, dark);
    } else if (look.eyes === 3) {
      // Bright eyes: a coloured iris with two lights.
      p.block(ex - 2, 16.6, ex + 2, 20.6, iris, 0.6);
      p.block(ex - 1, 17.4, ex + 1, 20, dark, 0.3);
      p.set(ex - 1.5, 17, WHITE);
      p.set(ex - 0.5, 17, WHITE);
      p.set(ex + 1, 19.6, mix2(iris, WHITE, 0.5));
    } else {
      // Round eyes: two small dark dots, a light pixel in the corner. As little as a face needs.
      if (darkSkin) p.block(ex - 2, 16.6, ex + 2, 20.4, WHITE, 0.8);
      p.block(ex - 1, 17, ex + 1, 20, dark, 0.3);
      p.set(ex - 1, 17.5, WHITE);
    }
  }
  // Eyebrows, short and flat.
  const brow = tone(pal.hair, -0.25);
  for (const bx of EYE_X) for (let dx = -1.5; dx <= 1.5; dx++) p.set(bx + dx, 15.2, brow);
  // A soft blush and a small nose.
  for (const cx of [8.6, 21.4]) p.set(cx, 21.4, mix2(skin, [244, 120, 130], 0.32));
  p.set(15, 20.4, tone(skin, -0.24));
  p.set(15, 21.4, tone(skin, -0.12));
  const mouth: RGB = darkSkin ? [0xd2, 0x6a, 0x72] : [0xa8, 0x3a, 0x3f];
  if (look.mouth === 1) {
    p.block(12.6, 22.6, 17.4, 24.4, [0x7a, 0x2a, 0x35], 0.8);
    for (let x = 13; x <= 17; x++) p.set(x, 22.8, WHITE);
  } else if (look.mouth === 2) {
    for (let x = 13.6; x <= 16.6; x++) p.set(x, 23.2, mouth);
  } else if (look.mouth === 3) {
    p.block(14, 22.4, 16, 24.6, [0x7a, 0x2a, 0x35], 0.6);
  } else {
    // A small smile: a flat line with its corners turned up.
    for (const [mx, my] of [[12.6, 22.4], [13.6, 23.2], [14.6, 23.2], [15.6, 23.2], [16.6, 23.2], [17.6, 22.4]] as const) p.set(mx, my, mouth);
  }
}

/** Is this pixel on the head, grown by `grow` all around? */
const insideHead = (x: number, y: number, grow = 0.4) => {
  const rad = 4.6 + grow;
  const cx = Math.max(HL - grow + rad, Math.min(HR + grow - rad, x + 0.5));
  const cy = Math.max(HT - grow + rad, Math.min(HB + grow - rad, y + 0.5));
  return Math.hypot(x + 0.5 - cx, y + 0.5 - cy) <= rad;
};

/** Fills the hair where `inside` says so: a light top, a darker right side, a few strands. */
function cap(p: Painter, hair: RGB, inside: (x: number, y: number) => boolean): void {
  for (let y = 2; y < 27; y++) {
    for (let x = 2; x < 28; x++) {
      if (!inside(x, y)) continue;
      let f = 0;
      if (y < 8 && x < 20) f += 0.13;
      if (x >= 23) f -= 0.14;
      if ((x * 5 + y * 3) % 13 === 0) f -= 0.07;
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
    return 12.2 + jag(x);
  };
  const limit = (x: number) => bangs(x) + (Math.abs(x + 0.5 - HX) > 8.6 ? 5 : 0);
  cap(p, hair, (x, y) => insideHead(x, y, 1.4) && (front ? y < limit(x) || (facing === 'side' && x < HX - 2.4 && y < 21) : y < 22.5));

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
    default:
      break;
  }
}

function drawGlasses(p: Painter, look: Look): void {
  const dark = rgb(OUTLINE);
  if (look.glasses === 1) {
    for (const ex of EYE_X) {
      for (let a = 0; a < 24; a++) {
        const t = (a / 24) * Math.PI * 2;
        p.set(ex + Math.cos(t) * 3.4, 18.4 + Math.sin(t) * 3.4, dark);
      }
      p.set(ex - 1.4, 16.6, WHITE);
    }
    for (let x = 14; x <= 16; x++) p.set(x, 17.6, dark);
  } else if (look.glasses === 2) {
    for (const ex of EYE_X) {
      for (let x = ex - 3.2; x <= ex + 3.2; x += 0.5) {
        p.set(x, 15.8, dark);
        p.set(x, 21, dark);
      }
      for (let y = 15.8; y <= 21; y += 0.5) {
        p.set(ex - 3.2, y, dark);
        p.set(ex + 3.2, y, dark);
      }
      p.set(ex - 1.8, 17, WHITE);
    }
    for (let x = 14; x <= 16; x++) p.set(x, 16.8, dark);
  } else if (look.glasses === 3) {
    for (const ex of EYE_X) {
      p.block(ex - 3.6, 16, ex + 3.6, 21, [34, 28, 58], 1.2);
      p.set(ex - 2, 17.2, [150, 190, 255]);
      p.set(ex - 1, 16.8, [150, 190, 255]);
    }
    for (let x = 14; x <= 16; x++) p.set(x, 16.6, dark);
  } else if (look.glasses === 4) {
    const pink: RGB = [255, 110, 160];
    const shape = ['.#.#.', '#####', '.###.', '..#..'];
    for (const ex of EYE_X) {
      shape.forEach((row, ry) =>
        [...row].forEach((ch, rx) => {
          if (ch === '#') p.set(ex - 2.5 + rx, 16.4 + ry * 1.3, ry === 0 && rx === 1 ? [255, 190, 210] : pink);
        }),
      );
    }
    for (let x = 14; x <= 16; x++) p.set(x, 17.8, dark);
  }
}

function drawHead(p: Painter, look: Look, pal: Palette, facing: Facing, blink: boolean): void {
  // The ears first (the head hides their inner half), then a block of skin, the face (front only), hair, hat and glasses.
  if (facing !== 'side') {
    p.block(3.4, 16, 6.4, 21.8, tone(pal.skin, -0.06), 1.2);
    p.block(23.6, 16, 26.6, 21.8, tone(pal.skin, -0.2), 1.2);
  }
  p.block(HL, HT, HR, HB, pal.skin, 4.6);
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
  const covers = look.bottom === 0 || look.bottom === 2 || look.bottom === 4;
  const skirt = look.bottom === 3;
  const bottom = pal.bottom;
  const shoeTop = seated ? 47.4 : 49 + off;
  const shoeBot = seated ? 52.4 : 54.6 + off;
  const segs: [number, number][] = seated ? [[38.5, 44.4], [43.4, 48.6]] : [[39 + off * 0.5, 50 + off]];
  const clothEnd = covers ? 99 : seated ? 44.4 : 45.6 + off;

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
  }

  // Shoes.
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
  } else {
    // Trainers: a white sole and a hint of laces.
    p.block(sx, shoeTop, x0 + 6.6, shoeBot, shoe, 2, true);
    p.block(sx, shoeBot - 1.4, x0 + 6.6, shoeBot, SHOE_SOLE, 0.5, false);
    p.set(x0 + 3, shoeTop + 1, WHITE);
    p.set(x0 + 4.4, shoeTop + 1, WHITE);
  }
}

function drawArms(p: Painter, look: Look, pal: Palette, frame: Frame): void {
  const o = swing(frame);
  const sleeveless = look.top === 7;
  const short = look.top === 0 || look.top === 1 || look.top === 3 || look.top === 8 || look.top === 9;
  const sleeve = look.top === 5 ? tone(pal.top, -0.1) : pal.top;
  for (const [x0, off] of [[4.2, o.armL], [21.6, o.armR]] as const) {
    p.block(x0 + 0.3, 26.6 + off, x0 + 3.9, 38.4 + off, pal.skin, 1.4, x0 > 15);
    if (!sleeveless) {
      const end = short ? 33 : 37.4;
      p.block(x0, 26.2 + off, x0 + 4.2, end + off, sleeve, 1.8, x0 > 15);
      p.block(x0, end - 1.6 + off, x0 + 4.2, end + off, tone(sleeve, short ? -0.12 : 0.14), 0.5, false);
      if (look.top === 1) for (let y = 28; y < end; y += 3) for (let x = x0; x < x0 + 4; x++) p.set(x, y + off, tone(sleeve, 0.24));
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
  } else {
    p.block(TL, T0, TR, T1, t, 2.2);
    p.block(TL + 0.4, T1 - 2.4, TR - 0.4, T1, belt, 0.8, true);
  }

  if (style === 6) {
    p.block(12, 23.4, 18, 27.8, t, 1);
    for (let y = 24; y < 27.6; y += 1.4) for (let x = 12.4; x < 17.8; x++) p.set(x, y, tone(t, -0.14));
  } else if (front && style !== 4 && style !== 7) {
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
  drawBehind(p, look, pal, frame);

  for (const [x0, off] of seated ? ([[9.3, 0], [15.3, 0]] as const) : ([[9.3 + o.legLx, o.legL], [15.3 + o.legRx, o.legR]] as const)) {
    drawLeg(p, look, pal, x0, off, seated);
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
  const hips = at(shoulders, 13);
  const knees = at(hips, 10);
  const feet = at(knees, 8);

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
  const mid = HX + p.ox;
  for (let y = Math.max(0, Math.round(from + p.oy)); y < p.h; y++) {
    const row = p.px.slice(y * p.w, (y + 1) * p.w);
    for (let x = 0; x < p.w; x++) {
      const sx = Math.round(mid + (x - mid) / k);
      p.px[y * p.w + x] = sx >= 0 && sx < p.w ? (row[sx] ?? null) : null;
    }
  }
}

function build(look: Look, tint: Tint, facing: Facing, frame: Frame, blink: boolean, pose: Pose): Painter {
  const { w, h } = avatarSize(pose);
  const p = new Painter(w, h);
  const pal = paletteOf(look, tint);
  if (pose === 'lie') {
    // The body is drawn lower on the canvas than the head; drawLying moves the head itself.
    p.ox = -1;
    p.oy = 7;
    drawLying(p, look, pal);
  } else if (pose === 'sit') {
    // Hips at seat height: the upper body is raised, the legs hang from the knees down to the floor.
    p.oy = 3;
    drawBody(p, look, pal, facing, 0, true);
    drawHead(p, look, pal, facing, blink);
  } else {
    drawBody(p, look, pal, facing, frame);
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
