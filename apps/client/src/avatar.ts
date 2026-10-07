// Chibi avatar at twice the old resolution: a big round head with sparkling eyes
// and rosy cheeks, a little body with swinging arms, and a few variations
// (hair, clothes, hats, glasses) picked from the player's id so that neighbours
// look different. Drawn from shaded shapes, then outlined with the style
// guide's 1 px #1b1530.

export const OUTLINE = 0x1b1530;

export interface Look {
  skin: number;
  hair: number;
  /** 0 short, 1 long, 2 spiky, 3 bun, 4 bob. */
  hairStyle: 0 | 1 | 2 | 3 | 4;
  shirt: number;
  /** 0 plain, 1 striped, 2 hoodie, 3 star. */
  shirtStyle: 0 | 1 | 2 | 3;
  pants: number;
  /** 0 none, 1 cap, 2 beanie, 3 glasses. */
  accessory: 0 | 1 | 2 | 3;
}

export type Facing = 'front' | 'back';
/** 0 standing, 1 and 2 the two steps of a walk. */
export type Frame = 0 | 1 | 2;

const SKINS = [0xf6d3b3, 0xe8b88a, 0xc98f5e, 0x9a6a43, 0x6b4427];
const HAIRS = [0x2a1a14, 0x5a3420, 0xb5651d, 0xe0b04a, 0xd04a6a, 0x4a6fd0, 0x7d4fc9, 0x3aa17e];
const SHIRTS = [0xe2483d, 0x35b57c, 0xf2c230, 0x4a8fe2, 0xb36bd6, 0xff8fb1, 0xf08a3c, 0x4fc3c3];
const PANTS = [0x2b4a8b, 0x3b3366, 0x5a4a3a, 0x2f5d50, 0x6b6b7a];

export const DEFAULT_LOOK: Look = {
  skin: SKINS[0]!,
  hair: HAIRS[1]!,
  hairStyle: 0,
  shirt: SHIRTS[0]!,
  shirtStyle: 0,
  pants: PANTS[0]!,
  accessory: 0,
};

/** Stable pseudo-random look from any string (a player id). */
export function lookFor(seed: string): Look {
  let h = 2166136261;
  for (let k = 0; k < seed.length; k++) h = Math.imul(h ^ seed.charCodeAt(k), 16777619);
  const pick = <T>(list: readonly T[]) => {
    h = Math.imul(h ^ (h >>> 15), 2246822507) >>> 0;
    h = Math.imul(h ^ (h >>> 13), 3266489909) >>> 0;
    return list[((h ^ (h >>> 16)) >>> 0) % list.length]!;
  };
  return {
    skin: pick(SKINS),
    hair: pick(HAIRS),
    hairStyle: pick([0, 1, 2, 3, 4] as const),
    shirt: pick(SHIRTS),
    shirtStyle: pick([0, 1, 2, 3] as const),
    pants: pick(PANTS),
    // Half of the players wear nothing special on their head.
    accessory: pick([0, 0, 0, 1, 2, 3] as const),
  };
}

export const AVATAR_W = 30;
export const AVATAR_H = 50;

type RGB = [number, number, number];
const rgb = (c: number): RGB => [(c >> 16) & 255, (c >> 8) & 255, c & 255];
function tone(c: RGB, f: number): RGB {
  const t = f < 0 ? 0 : 255;
  const k = Math.min(1, Math.abs(f));
  return [Math.round(c[0] + (t - c[0]) * k), Math.round(c[1] + (t - c[1]) * k), Math.round(c[2] + (t - c[2]) * k)];
}
function mix2(a: RGB, b: RGB, t: number): RGB {
  return [Math.round(a[0] + (b[0] - a[0]) * t), Math.round(a[1] + (b[1] - a[1]) * t), Math.round(a[2] + (b[2] - a[2]) * t)];
}
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
const bayer = (x: number, y: number) => (BAYER[((y & 3) << 2) | (x & 3)]! + 0.5) / 16;

/** A tiny shaded-shape painter on a transparent canvas. */
class Painter {
  readonly px: (RGB | null)[] = new Array(AVATAR_W * AVATAR_H).fill(null);

  set(x: number, y: number, c: RGB): void {
    const xi = Math.round(x), yi = Math.round(y);
    if (xi < 0 || yi < 0 || xi >= AVATAR_W || yi >= AVATAR_H) return;
    this.px[yi * AVATAR_W + xi] = c;
  }

  get(x: number, y: number): RGB | null {
    if (x < 0 || y < 0 || x >= AVATAR_W || y >= AVATAR_H) return null;
    return this.px[y * AVATAR_W + x] ?? null;
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
        const level = lam + (bayer(x, y) - 0.5) * 0.28;
        this.set(x, y, level > 0.62 ? tone(color, 0.16) : level > 0.12 ? color : level > -0.28 ? tone(color, -0.14) : tone(color, -0.27));
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

/** Where the limbs go for a given frame: arms swing opposite to the legs. */
function pose(frame: Frame) {
  return {
    legL: frame === 1 ? -2 : frame === 2 ? 1 : 0, // vertical offset of each foot (negative = lifted)
    legR: frame === 2 ? -2 : frame === 1 ? 1 : 0,
    armL: frame === 1 ? 1.5 : frame === 2 ? -1.5 : 0,
    armR: frame === 2 ? 1.5 : frame === 1 ? -1.5 : 0,
  };
}

function drawHair(p: Painter, look: Look, facing: Facing, hair: RGB): void {
  const cx = 15;
  const front = facing === 'front';
  const inHead = (x: number, y: number) => ((x + 0.5 - cx) / 10) ** 2 + ((y + 0.5 - 16) / 9.6) ** 2 <= 1;
  // The cap of hair covering the top of the head, with a fringe at the front.
  const bangs = (x: number) =>
    14 + (Math.abs(x + 0.5 - cx) > 6 ? 5 : 0) + (Math.floor(x) % 3 === 0 ? 1.5 : 0) + (look.hairStyle === 2 ? -2 : 0);
  p.ball(cx, 16, 10, 9.6, hair, { clip: (x, y) => inHead(x, y) && (front ? y < bangs(x) : y < 24) });
  if (look.hairStyle === 1 || look.hairStyle === 4) {
    // Long hair falls behind and beside the face; a bob stops at the chin.
    const drop = look.hairStyle === 1 ? 33 : 26;
    for (const side of [-1, 1]) {
      const x0 = side < 0 ? 4 : 22.5;
      p.block(x0, 14, x0 + 3.6, drop, hair, 1.6, side > 0);
    }
    if (!front) p.block(6, 20, 24, drop - 2, hair, 3);
  }
  if (look.hairStyle === 2) {
    // Spikes along the top.
    for (const [sx, sy, h] of [[8, 8, 5], [12, 5, 6], [16, 4, 7], [20, 6, 6], [23, 9, 4]] as const) {
      for (let k = 0; k < h; k++) {
        const w = Math.max(0, 2.2 - k * 0.4);
        for (let dx = -w; dx <= w; dx++) p.set(sx + dx, sy - k + 2, k > h - 3 ? tone(hair, 0.15) : hair);
      }
    }
  }
  if (look.hairStyle === 3) {
    p.ball(15, 5, 4.6, 4.2, hair);
    p.set(13, 3, tone(hair, 0.3));
    p.set(14, 3, tone(hair, 0.3));
  }
  // A strand of light on top of the head.
  if (front || look.hairStyle !== 3) {
    p.set(11, 8, tone(hair, 0.35));
    p.set(12, 7.5, tone(hair, 0.35));
    p.set(13, 7, tone(hair, 0.3));
    p.set(10, 9, tone(hair, 0.28));
  }
}

function drawAccessory(p: Painter, look: Look, facing: Facing): void {
  const cx = 15;
  if (look.accessory === 1) {
    // A cap with a visor.
    const c = rgb(look.shirt);
    p.ball(cx, 14.5, 10.4, 7.6, c, { clip: (_x, y) => y < 15 });
    if (facing === 'front') p.block(6, 14, 24, 16.4, tone(c, -0.2), 1, true);
    else p.block(9, 14, 21, 16, tone(c, -0.15), 1);
    p.set(cx, 8, tone(c, 0.3));
  } else if (look.accessory === 2) {
    // A beanie with a pompom.
    const c = tone(rgb(look.shirt), -0.05);
    p.ball(cx, 14, 10.6, 8.4, c, { clip: (_x, y) => y < 14.6 });
    for (let x = 5; x < 25; x++) if (x % 2 === 0) p.set(x, 13, tone(c, -0.18));
    p.block(5.2, 13.6, 24.8, 16, tone(c, 0.12), 1.2);
    p.ball(cx, 5, 2.4, 2.4, tone(c, 0.35));
  } else if (look.accessory === 3 && facing === 'front') {
    // Round glasses.
    const dark = rgb(OUTLINE);
    for (const ex of [10.8, 19.2]) {
      for (let a = 0; a < 24; a++) {
        const t = (a / 24) * Math.PI * 2;
        p.set(ex + Math.cos(t) * 3.4, 17.2 + Math.sin(t) * 3.4, dark);
      }
      p.set(ex - 1.4, 15.6, [255, 255, 255]);
    }
    for (let x = 14; x <= 16; x++) p.set(x, 17, dark);
  }
}

function drawFace(p: Painter, look: Look, blink: boolean): void {
  const dark = rgb(OUTLINE);
  const skin = rgb(look.skin);
  // Eyes: big and shiny, or closed.
  for (const ex of [10.8, 19.2]) {
    if (blink) {
      for (let dx = -2; dx <= 2; dx++) p.set(ex + dx, 18, dark);
      continue;
    }
    p.ball(ex, 17.6, 2.3, 3.2, dark, { flat: true });
    p.set(ex - 0.8, 16, [255, 255, 255]);
    p.set(ex - 0.8, 15.4, [255, 255, 255]);
    p.set(ex + 0.9, 19.2, tone([255, 255, 255], -0.15));
  }
  // Eyebrows.
  const brow = tone(rgb(look.hair), -0.25);
  for (const [bx, dir] of [[10.5, 1], [19.5, -1]] as const) {
    for (let dx = -2; dx <= 2; dx++) p.set(bx + dx, 12.6 + dir * dx * 0.12, brow);
  }
  // Rosy cheeks, a small nose and a smile.
  for (const cxp of [7.2, 22.8]) {
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -2; dx <= 2; dx++) {
        if (Math.abs(dx) + Math.abs(dy) * 1.4 <= 2.4) p.set(cxp + dx, 21.2 + dy, mix2(skin, [240, 110, 120], 0.55));
      }
    }
  }
  p.set(15, 20.4, tone(skin, -0.2));
  const mouth: RGB = [0xa8, 0x3a, 0x3f];
  for (const [mx, my] of [[12.6, 22.6], [13.6, 23.4], [14.6, 23.7], [15.6, 23.7], [16.6, 23.4], [17.6, 22.6]] as const) p.set(mx, my, mouth);
}

function drawBody(p: Painter, look: Look, facing: Facing, frame: Frame): void {
  const skin = rgb(look.skin), shirt = rgb(look.shirt), pants = rgb(look.pants);
  const o = pose(frame);

  // Legs and shoes first (they sit behind the shirt's hem).
  for (const [x0, off] of [[9, o.legL], [15.4, o.legR]] as const) {
    p.block(x0, 38 + off * 0.5, x0 + 5.6, 44.4 + off, pants, 1.3);
    p.block(x0 - 1.2, 43.4 + off, x0 + 6.4, 47.4 + off, rgb(0x2a2140), 1.8, true);
    p.block(x0 - 1.2, 46.2 + off, x0 + 6.4, 47.4 + off, tone(rgb(0x2a2140), -0.4), 0.5, false);
    p.set(x0 + 0.6, 44.2 + off, tone(rgb(0x6c61a3), 0.1));
    p.set(x0 + 1.6, 44.2 + off, tone(rgb(0x6c61a3), 0.1));
  }

  // Arms (behind the torso), with hands.
  for (const [x0, off] of [[4.4, o.armL], [21.4, o.armR]] as const) {
    p.block(x0, 27.4 + off, x0 + 4.4, 35.4 + off, shirt, 2, x0 > 15);
    p.ball(x0 + 2.2, 36.4 + off, 2.3, 2.3, skin);
  }

  // Torso with its hem and belt.
  p.block(8.4, 25.4, 21.6, 38.6, shirt, 2.2);
  p.block(8.8, 36.2, 21.2, 39, tone(pants, -0.3), 0.8, true);
  // Neck and collar.
  p.block(12.6, 23.2, 17.4, 26.4, tone(skin, -0.12), 1);
  if (facing === 'front') {
    for (let x = 12; x <= 18; x++) p.set(x, 26.8 - Math.abs(x - 15) * 0.2, tone(shirt, -0.25));
    if (look.shirtStyle === 0) for (let x = 12; x <= 18; x++) p.set(x, 25.4, tone(shirt, 0.18));
  }
  if (look.shirtStyle === 1) {
    for (let y = 28; y < 36; y += 3) for (let x = 9; x < 21; x++) p.set(x, y, tone(shirt, 0.22));
  } else if (look.shirtStyle === 2) {
    if (facing === 'front') {
      p.block(10.6, 31, 19.4, 35.6, tone(shirt, -0.14), 1);
      p.set(13, 27, [250, 250, 250]);
      p.set(13, 28, [250, 250, 250]);
      p.set(17, 27, [250, 250, 250]);
      p.set(17, 28, [250, 250, 250]);
    } else {
      p.ball(15, 27.4, 4.6, 2.4, tone(shirt, -0.12));
    }
  } else if (look.shirtStyle === 3 && facing === 'front') {
    const star: RGB = [255, 230, 130];
    for (const [sx, sy] of [[15, 29], [15, 30], [15, 31], [14, 30], [16, 30], [13, 30], [17, 30], [14, 31], [16, 31], [14, 32], [16, 32]] as const) {
      p.set(sx, sy, star);
    }
  }
}

function build(look: Look, facing: Facing, frame: Frame, blink: boolean): Painter {
  const p = new Painter();
  const skin = rgb(look.skin), hair = rgb(look.hair);
  drawBody(p, look, facing, frame);
  // Head: a ball of skin with its ears, then the face (front only), hair and accessories.
  p.ball(5, 18, 1.8, 2.4, tone(skin, -0.06));
  p.ball(25, 18, 1.8, 2.4, tone(skin, -0.2));
  p.ball(15, 16, 10, 9.6, skin);
  if (facing === 'front') drawFace(p, look, blink);
  drawHair(p, look, facing, hair);
  drawAccessory(p, look, facing);
  return p;
}

/** RGBA pixels of one frame, outline included: AVATAR_W x AVATAR_H. No DOM needed. */
export function avatarPixels(look: Look, facing: Facing = 'front', frame: Frame = 0, blink = false): Uint8ClampedArray {
  const p = build(look, facing, frame, blink);
  const data = new Uint8ClampedArray(AVATAR_W * AVATAR_H * 4);
  const put = (x: number, y: number, c: RGB) => {
    const o = (y * AVATAR_W + x) * 4;
    data[o] = c[0];
    data[o + 1] = c[1];
    data[o + 2] = c[2];
    data[o + 3] = 255;
  };
  const out = rgb(OUTLINE);
  // Outline: every empty pixel touching a filled one (4-neighbourhood), then the body on top.
  for (let y = 0; y < AVATAR_H; y++) {
    for (let x = 0; x < AVATAR_W; x++) {
      if (p.get(x, y)) continue;
      if (p.get(x - 1, y) || p.get(x + 1, y) || p.get(x, y - 1) || p.get(x, y + 1)) put(x, y, out);
    }
  }
  for (let y = 0; y < AVATAR_H; y++) {
    for (let x = 0; x < AVATAR_W; x++) {
      const c = p.get(x, y);
      if (c) put(x, y, c);
    }
  }
  return data;
}

/** One frame of the avatar on a canvas. */
export function avatarFrame(look: Look, facing: Facing = 'front', frame: Frame = 0, blink = false): HTMLCanvasElement {
  const cv = document.createElement('canvas');
  cv.width = AVATAR_W;
  cv.height = AVATAR_H;
  cv.getContext('2d')!.putImageData(
    new ImageData(new Uint8ClampedArray(avatarPixels(look, facing, frame, blink)), AVATAR_W, AVATAR_H),
    0,
    0,
  );
  return cv;
}

/** Standing front view, optionally with another shirt or hair color (used by the sign-in scene). */
export function avatarCanvas(shirt?: number, hair?: number): HTMLCanvasElement {
  return avatarFrame({ ...DEFAULT_LOOK, shirt: shirt ?? DEFAULT_LOOK.shirt, hair: hair ?? DEFAULT_LOOK.hair });
}
