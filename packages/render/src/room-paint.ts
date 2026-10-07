// Paints a whole room (floor, walls, decor) pixel by pixel into an RGBA buffer.
// Pure code, no DOM and no PixiJS: the room is a texture made once per look,
// and the same function can be run in tests or a preview script.

import type { FloorPattern, WallPattern } from './catalog';
import { N, OX, OY, ROOM_H, ROOM_W, TH, TW, WALL_H } from './room';

type RGB = [number, number, number];

export interface RoomLook {
  floor: { a: number; b: number; line: number; pattern: FloorPattern };
  wall: { left: number; right: number; trim: number; pattern: WallPattern };
  /** What hangs on the walls: a sunny window and a door, or the hall's glass doors. */
  decor: 'apartment' | 'hall';
}

const OUTLINE: RGB = [0x1b, 0x15, 0x30];
const rgb = (c: number): RGB => [(c >> 16) & 255, (c >> 8) & 255, c & 255];
const clamp = (v: number, lo = 0, hi = 255) => Math.max(lo, Math.min(hi, v));

/** Toward black (f < 0) or white (f > 0). */
function tone(c: RGB, f: number): RGB {
  const t = f < 0 ? 0 : 255;
  const k = Math.min(1, Math.abs(f));
  return [Math.round(c[0] + (t - c[0]) * k), Math.round(c[1] + (t - c[1]) * k), Math.round(c[2] + (t - c[2]) * k)];
}
const mix = (a: RGB, b: RGB, t: number): RGB => [
  Math.round(a[0] + (b[0] - a[0]) * t),
  Math.round(a[1] + (b[1] - a[1]) * t),
  Math.round(a[2] + (b[2] - a[2]) * t),
];

/** Deterministic noise in [0, 1). */
function noise(x: number, y: number): number {
  let h = Math.imul(x | 0, 0x27d4eb2d) ^ Math.imul(y | 0, 0x165667b1);
  h ^= h >>> 15;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
/** Smooth value noise, for blotches that are bigger than a pixel. */
function smooth(x: number, y: number): number {
  const xi = Math.floor(x), yi = Math.floor(y);
  const fx = x - xi, fy = y - yi;
  const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
  const a = noise(xi, yi), b = noise(xi + 1, yi), c = noise(xi, yi + 1), d = noise(xi + 1, yi + 1);
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
}
const fract = (v: number) => v - Math.floor(v);
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
const bayer = (x: number, y: number) => (BAYER[((y & 3) << 2) | (x & 3)]! + 0.5) / 16;

// ----- Geometry -----------------------------------------------------------------------

const TOP_Y = OY - TH / 2;
/** Half the room's width on screen, and the drop of a wall's bottom edge from the corner to its end. */
const HALF_W = (N * TW) / 2;
const DROP = (N * TH) / 2;
const SLAB = 12;
const CAP = 7;

type Hit =
  | { kind: 'floor'; u: number; v: number }
  | { kind: 'left' | 'right'; u: number; v: number }
  | null;

/** What a canvas pixel shows: floor cell coordinates (0..8), or wall coordinates (u in cells from the corner, v in px up). */
function locate(px: number, py: number): Hit {
  const dx = px + 0.5 - OX, dy = py + 0.5 - OY;
  const fi = (dx / (TW / 2) + dy / (TH / 2)) / 2 + 0.5;
  const fj = (dy / (TH / 2) - dx / (TW / 2)) / 2 + 0.5;
  if (fi >= 0 && fi < N && fj >= 0 && fj < N) return { kind: 'floor', u: fi, v: fj };
  const sl = (OX - (px + 0.5)) / HALF_W;
  if (sl > 0 && sl <= 1) {
    const v = TOP_Y + DROP * sl - (py + 0.5);
    if (v >= 0 && v < WALL_H) return { kind: 'left', u: N * sl, v };
  }
  const sr = (px + 0.5 - OX) / HALF_W;
  if (sr > 0 && sr <= 1) {
    const v = TOP_Y + DROP * sr - (py + 0.5);
    if (v >= 0 && v < WALL_H) return { kind: 'right', u: N * sr, v };
  }
  return null;
}

// ----- Floor ----------------------------------------------------------------------------

function floorColor(look: RoomLook, u: number, v: number, px: number, py: number): RGB {
  const a = rgb(look.floor.a), b = rgb(look.floor.b), line = rgb(look.floor.line);
  const g = (amount: number) => (noise(px, py) - 0.5) * amount;
  switch (look.floor.pattern) {
    case 'planks': {
      const board = Math.floor(v * 2), bf = fract(v * 2);
      const jointLen = 2.5;
      const off = noise(board, 7) * jointLen;
      const seg = Math.floor((u + off) / jointLen);
      const key = board * 131 + seg * 17;
      let c = mix(a, b, noise(key, 3));
      c = tone(c, (noise(key, 9) - 0.5) * 0.1);
      // Long streaks of grain along the board.
      const streak = noise(Math.floor((u + off) * 26) + key, board);
      c = tone(c, (streak - 0.5) * 0.09 + g(0.04));
      const jointDist = fract((u + off) / jointLen) * jointLen;
      if (bf < 0.075 || jointDist < 0.035) return mix(c, line, 0.85);
      if (bf < 0.15) return tone(c, 0.09);
      if (bf > 0.93) return tone(c, -0.05);
      return c;
    }
    case 'checker': {
      const iu = Math.floor(u), iv = Math.floor(v);
      const fu = u - iu, fv = v - iv;
      let c = (iu + iv) & 1 ? a : b;
      c = tone(c, g(0.04));
      if (fu < 0.03 || fv < 0.03) return mix(c, line, 0.9);
      if (fu < 0.07 || fv < 0.07) return tone(c, 0.1);
      if (fu > 0.95 || fv > 0.95) return tone(c, -0.08);
      return c;
    }
    case 'tiles': {
      const tu = u * 2, tv = v * 2;
      const iu = Math.floor(tu), iv = Math.floor(tv);
      const fu = tu - iu, fv = tv - iv;
      let c = mix(a, b, noise(iu, iv) * 0.8);
      c = tone(c, (noise(iu, iv + 50) - 0.5) * 0.06 + g(0.03));
      if (fu < 0.06 || fv < 0.06) return mix(c, line, 0.8);
      if (fu < 0.13 || fv < 0.13) return tone(c, 0.12);
      if (fu > 0.9 || fv > 0.9) return tone(c, -0.08);
      // A glint across some tiles.
      if (noise(iu, iv + 99) > 0.8 && Math.abs(fu - fv) < 0.06) return tone(c, 0.2);
      return c;
    }
    case 'carpet': {
      const cell = ((Math.floor(u * 2) + Math.floor(v * 2)) & 1 ? 0.025 : -0.015);
      const t = smooth(u * 3, v * 3);
      let c = mix(a, b, t);
      c = tone(c, cell + (noise(px, py) - 0.5) * 0.11);
      if (noise(px >> 1, py) > 0.93) c = tone(c, 0.07);
      return c;
    }
    case 'stone': {
      const row = Math.floor(v * 2), rf = fract(v * 2);
      const off = (row & 1) * 0.75;
      const su = (u + off) / 1.5;
      const stone = Math.floor(su), sf = fract(su);
      const key = row * 57 + stone;
      let c = mix(a, b, noise(key, 5));
      c = tone(c, (noise(key, 11) - 0.5) * 0.08 + g(0.07));
      if (rf < 0.07 || sf * 1.5 < 0.05) return mix(c, line, 0.8);
      if (rf < 0.14 || sf * 1.5 < 0.1) return tone(c, 0.08);
      if (noise(px * 3, py * 7) > 0.96) return tone(c, -0.1);
      return c;
    }
    case 'grass': {
      const t = smooth(u * 1.6, v * 1.6) * 0.7 + smooth(u * 5, v * 5) * 0.3;
      let c = mix(a, b, t);
      c = tone(c, g(0.05));
      const n = noise(px, py);
      if (n > 0.82) c = tone(c, 0.3);
      else if (noise(px, py - 1) > 0.82) c = tone(c, -0.16);
      else if (noise(px + 1, py) > 0.9) c = tone(c, 0.1);
      if (n > 0.9985) return rgb(([0xffffff, 0xffe27a, 0xff9ec4][Math.floor(noise(px, py + 3) * 3)]!) | 0);
      return c;
    }
    case 'sand': {
      const t = smooth(u * 1.4, v * 1.4);
      let c = mix(a, b, t);
      const ripple = Math.sin((u * 1.2 + v * 0.5) * 7 + smooth(u * 3, v * 3) * 3);
      if (ripple > 0.82) c = tone(c, -0.07);
      else if (ripple < -0.9) c = tone(c, 0.05);
      const n = noise(px, py);
      if (n > 0.965) c = tone(c, 0.1);
      else if (n < 0.03) c = tone(c, -0.1);
      return tone(c, g(0.03));
    }
    default:
      return a;
  }
}

// ----- Walls ----------------------------------------------------------------------------

/** Wall decoration cell, with a repeating unit in cells (u) and px (v). */
function wallPattern(look: RoomLook, base: RGB, u: number, v: number, px: number, py: number): RGB {
  const n = (amount: number) => (noise(px, py) - 0.5) * amount;
  switch (look.wall.pattern) {
    case 'stripes': {
      const f = fract(u * 2);
      let c = tone(base, n(0.03));
      if (f < 0.5) c = tone(c, 0.075);
      if (f < 0.04 || (f > 0.5 && f < 0.54)) c = tone(c, -0.06);
      return c;
    }
    case 'dots': {
      const row = Math.floor(v / 26);
      const uu = u * 2 + (row & 1 ? 0.5 : 0);
      const cu = (fract(uu) - 0.5) * 16;
      const cv = (v - row * 26 - 13);
      let c = tone(base, n(0.03));
      const d2 = cu * cu + cv * cv;
      if (d2 < 9) c = tone(base, 0.16 + n(0.03));
      else if (d2 < 14) c = tone(base, -0.05);
      return c;
    }
    case 'damask': {
      const row = Math.floor(v / 30);
      const uu = u * 2 + (row & 1 ? 0.5 : 0);
      const cu = (fract(uu) - 0.5) * 16;
      const cv = v - row * 30 - 15;
      let c = tone(base, n(0.03));
      const m = Math.abs(cu) * 1.2 + Math.abs(cv) * 0.6;
      if (m < 5) c = tone(base, 0.13 + n(0.02));
      else if (m < 8 && Math.abs(cu) < 2.5) c = tone(base, 0.08);
      else if (Math.abs(cu) < 1 && Math.abs(cv) < 13) c = tone(base, 0.06);
      return c;
    }
    case 'panels': {
      // Wainscot below a chair rail, plain wall above.
      const rail = 46;
      let c = tone(base, n(0.03));
      if (v < rail) {
        const f = fract(u);
        const inner = f > 0.12 && f < 0.88 && v > 9 && v < rail - 8;
        c = tone(base, -0.1 + n(0.03));
        if (inner) {
          c = tone(base, -0.02 + n(0.03));
          if (f < 0.17 || v < 14) c = tone(base, -0.14);
          else if (f > 0.83 || v > rail - 13) c = tone(base, 0.1);
        }
      } else if (v < rail + 4) {
        c = tone(look.wall.trim ? rgb(look.wall.trim) : base, v > rail + 2 ? 0.1 : -0.1);
      }
      return c;
    }
    case 'brick': {
      const row = Math.floor(v / 9), rf = fract(v / 9);
      const uu = u * 4 + (row & 1) * 0.5;
      const bf = fract(uu);
      const key = row * 41 + Math.floor(uu);
      let c = tone(base, (noise(key, 3) - 0.5) * 0.14 + n(0.05));
      if (rf < 0.14 || bf < 0.06) c = tone(base, -0.22 + n(0.03));
      else if (rf > 0.86) c = tone(c, -0.05);
      else if (rf < 0.3) c = tone(c, 0.05);
      return c;
    }
    case 'leaves': {
      // Scattered leaves: a short diagonal of two tones on a jittered grid.
      const gu = Math.floor(u * 3), gv = Math.floor(v / 17);
      const ju = (noise(gu, gv) - 0.5) * 0.25, jv = (noise(gu + 40, gv) - 0.5) * 6;
      const lu = (fract(u * 3) - 0.5 - ju) * 10.7, lv = v - gv * 17 - 8.5 - jv;
      let c = tone(base, n(0.03));
      const along = lu * 0.8 + lv * 0.6, across = -lu * 0.6 + lv * 0.8;
      if (noise(gu + 9, gv + 9) > 0.35 && Math.abs(across) < 2.4 - Math.abs(along) * 0.28 && Math.abs(along) < 6) {
        c = tone(base, across > 0 ? -0.14 : 0.16);
      }
      return c;
    }
    case 'stars': {
      const gu = Math.floor(u * 2.5), gv = Math.floor(v / 20);
      if (noise(gu, gv) > 0.45) {
        const cu = (fract(u * 2.5) - 0.5 + (noise(gu + 3, gv) - 0.5) * 0.4) * 12.8;
        const cv = v - gv * 20 - 10 + (noise(gu + 5, gv) - 0.5) * 6;
        const big = noise(gu + 7, gv) > 0.8;
        const d = Math.abs(cu) + Math.abs(cv);
        if ((Math.abs(cu) < 1 && Math.abs(cv) < (big ? 4 : 2.4)) || (Math.abs(cv) < 1 && Math.abs(cu) < (big ? 4 : 2.4)) || d < 1.6) {
          return mix(tone(base, 0.55), [255, 240, 200], 0.4);
        }
      }
      return tone(base, n(0.04));
    }
    default:
      return tone(base, n(0.035) + (smooth(u * 2, v / 14) - 0.5) * 0.03);
  }
}

function wallColor(look: RoomLook, side: 'left' | 'right', u: number, v: number, px: number, py: number): RGB {
  const base = rgb(side === 'left' ? look.wall.left : look.wall.right);
  const trim = rgb(look.wall.trim);
  const vf = v / WALL_H;
  // Lit from above, darker in the corner and low on the wall (ambient occlusion).
  const light = 0.06 * vf - 0.09 * (1 - vf) * (1 - vf) - Math.max(0, 1 - u / 0.7) * 0.13 - Math.max(0, (u - 7) / 1) * 0.03;

  // Cornice and skirting board.
  if (v >= WALL_H - 9) {
    if (v >= WALL_H - 3) return tone(trim, side === 'left' ? 0.0 : -0.12);
    if (v >= WALL_H - 5) return tone(trim, side === 'left' ? -0.12 : -0.22);
    return tone(base, -0.22);
  }
  if (v < 15) {
    const t = tone(trim, side === 'left' ? -0.1 : -0.24);
    if (v >= 13) return tone(t, 0.18);
    if (v < 2) return tone(t, -0.3);
    return tone(t, (noise(px, py) - 0.5) * 0.04);
  }

  let c = wallPattern(look, base, u, v, px, py);
  c = tone(c, light);

  // Decor, in wall coordinates.
  const deco = look.decor === 'apartment' ? apartmentDecor(side, u, v, px, py, c) : hallDecor(side, u, v, px, py, c);
  return deco ?? c;
}

const inRect = (u: number, v: number, u0: number, u1: number, v0: number, v1: number) => u >= u0 && u < u1 && v >= v0 && v < v1;

function apartmentDecor(side: 'left' | 'right', u: number, v: number, px: number, py: number, wall: RGB): RGB | null {
  if (side === 'right') {
    // A window: frame, sky with clouds and sun, cross bars, sill and curtains.
    const [u0, u1, v0, v1] = [3.1, 4.75, 38, 100];
    if (inRect(u, v, u0 - 0.5, u0 - 0.05, v0 - 8, v1 + 8) || inRect(u, v, u1 + 0.05, u1 + 0.5, v0 - 8, v1 + 8)) {
      // Curtains with soft vertical folds.
      const fold = Math.sin(u * 42) * 0.07 + (noise(px, py) - 0.5) * 0.03;
      const edge = v > v1 + 5 ? -0.12 : 0;
      return tone([0xf2, 0x7e, 0xa6], fold + edge - (inRect(u, v, u0 - 0.5, u0 - 0.05, v0, v1) ? 0 : 0.0));
    }
    if (inRect(u, v, u0 - 0.1, u1 + 0.1, v0 - 5, v0)) return tone([0xf4, 0xef, 0xe6], v < v0 - 3 ? 0.1 : -0.12);
    if (inRect(u, v, u0, u1, v0, v1)) {
      const f = (u - u0) / (u1 - u0), h = (v - v0) / (v1 - v0);
      const bar = Math.abs(f - 0.5) < 0.035 || Math.abs(h - 0.5) < 0.03;
      const frame = f < 0.07 || f > 0.93 || h < 0.05 || h > 0.95;
      if (bar || frame) return tone([0x6e, 0x4a, 0x2c], f > 0.5 ? -0.12 : 0.04);
      // Sky: bluer at the top, pale at the horizon, a sun and a few clouds.
      let c = mix([0x74, 0xb9, 0xf2], [0xd6, 0xee, 0xff], 1 - h);
      const sun = Math.hypot((f - 0.75) * 40, (h - 0.82) * 56);
      if (sun < 5) c = [0xff, 0xf2, 0xb0];
      else if (sun < 10) c = mix(c, [0xff, 0xf2, 0xb0], 0.3 * (1 - (sun - 5) / 5));
      const cloud = smooth(u * 9, v / 6 + 3);
      if (cloud > 0.66 && h > 0.2 && h < 0.8) c = mix(c, [255, 255, 255], 0.7);
      // A reflection on the glass.
      if (Math.abs((f - h * 0.5) - 0.18) < 0.03 && h > 0.1 && h < 0.9) c = tone(c, 0.2);
      return c;
    }
    return null;
  }
  // A framed picture and the door, on the left wall.
  const [pu0, pu1, pv0, pv1] = [1.2, 2.7, 56, 92];
  if (inRect(u, v, pu0, pu1, pv0, pv1)) {
    const f = (u - pu0) / (pu1 - pu0), h = (v - pv0) / (pv1 - pv0);
    if (f < 0.08 || f > 0.92 || h < 0.1 || h > 0.9) return tone([0xe0, 0xa0, 0x30], f < 0.5 ? 0.1 : -0.15);
    const hill = 0.38 + Math.sin(f * 9) * 0.08;
    let c: RGB = h > hill ? mix([0x8e, 0xc0, 0xf5], [0xd6, 0xee, 0xff], 1 - h) : mix([0x4f, 0xb3, 0x5a], [0x3f, 0x8a, 0x4a], 1 - h / hill);
    if (Math.hypot((f - 0.7) * 34, (h - 0.72) * 26) < 4) c = [0xff, 0xe2, 0x7a];
    return c;
  }
  const [du0, du1, dv1] = [4.15, 5.85, 94];
  if (inRect(u, v, du0 - 0.1, du1 + 0.1, 0, dv1 + 4)) {
    const f = (u - du0) / (du1 - du0);
    if (f < 0 || f > 1 || v > dv1 || false) return tone([0x4a, 0x3f, 0x7a], f < 0.5 ? 0 : -0.12);
    const wood: RGB = [0xd9, 0xa0, 0x5b];
    let c = tone(wood, (noise(px >> 1, py) - 0.5) * 0.06 + (v / dv1) * 0.04);
    // Two raised panels.
    for (const [a0, a1] of [[10, 42], [52, 84]] as const) {
      if (f > 0.14 && f < 0.86 && v > a0 && v < a1) {
        c = tone(wood, 0.02);
        if (f < 0.19 || v < a0 + 3) c = tone(wood, -0.18);
        else if (f > 0.81 || v > a1 - 3) c = tone(wood, 0.16);
      }
    }
    // Brass knob.
    const k = Math.hypot((f - 0.84) * 50, v - 46);
    if (k < 3.2) return k < 1.2 ? [0xff, 0xf0, 0xa8] : [0xe0, 0xa0, 0x30];
    return c;
  }
  void wall;
  return null;
}

function hallDecor(side: 'left' | 'right', u: number, v: number, px: number, py: number, wall: RGB): RGB | null {
  if (side === 'right') {
    // Double glass doors with a lit sign.
    const [u0, u1, v1] = [2.8, 6.2, 98];
    if (inRect(u, v, u0 - 0.15, u1 + 0.15, 0, v1 + 10)) {
      const f = (u - u0) / (u1 - u0);
      if (v > v1) return v > v1 + 5 ? tone([0xff, 0xc8, 0x57], 0.1) : tone([0xff, 0xc8, 0x57], -0.15);
      if (f < 0 || f > 1) return tone([0x35, 0x50, 0x8c], f < 0.5 ? 0 : -0.15);
      const bar = Math.abs(f - 0.5) < 0.025 || f < 0.04 || f > 0.96 || v > v1 - 4 || (v > 40 && v < 43);
      if (bar) return tone([0x35, 0x50, 0x8c], f > 0.5 ? -0.1 : 0.05);
      let c = mix([0x8e, 0xc8, 0xf5], [0xdc, 0xf0, 0xff], v / v1);
      const diag = fract((f * 3.4 + v / 90) * 0.9);
      if (diag > 0.1 && diag < 0.2) c = tone(c, 0.16);
      if (Math.abs(f - 0.44) < 0.018 && v > 44 && v < 56) return [0xff, 0xc8, 0x57];
      if (Math.abs(f - 0.56) < 0.018 && v > 44 && v < 56) return [0xff, 0xc8, 0x57];
      return c;
    }
    return null;
  }
  // Pillars with flutes, and wall lamps with a pool of light.
  for (const [p0, p1] of [[0.7, 1.45], [6.55, 7.3]] as const) {
    if (inRect(u, v, p0, p1, 0, WALL_H - 9)) {
      const f = (u - p0) / (p1 - p0);
      const flute = Math.floor(f * 6);
      let c = tone([0xff, 0xf3, 0xd6], f < 0.3 ? 0.1 : f > 0.7 ? -0.2 : -0.04);
      if (fract(f * 6) < 0.12) c = tone(c, -0.1);
      if (v < 10 || v > WALL_H - 22) c = tone(c, 0.05 - (flute % 2) * 0.0);
      return tone(c, (noise(px, py) - 0.5) * 0.04);
    }
  }
  for (const lu of [3.4, 5.3]) {
    const d = Math.hypot((u - lu) * 32, v - 74);
    if (d < 4) return d < 2 ? [0xff, 0xf6, 0xcc] : [0xff, 0xd8, 0x70];
    if (d < 40) return tone(wall, 0.2 * (1 - d / 40) * (bayer(px, py) < 0.85 ? 1 : 0.4));
  }
  return null;
}

// ----- Floor decor and light ------------------------------------------------------------

function floorDecor(look: RoomLook, c: RGB, u: number, v: number, px: number, py: number): RGB {
  let out = c;
  // Contact shadow along the walls.
  const wallDist = Math.min(u, v);
  if (wallDist < 0.45) out = tone(out, -0.16 * (1 - wallDist / 0.45) * (bayer(px, py) < 0.8 ? 1 : 0.5));

  if (look.decor === 'hall') {
    // A red carpet down the middle with a gold border and a woven pattern.
    if (inRect(u, v, 0.9, 7.1, 3, 5)) {
      const fu = u - 0.9, fv = v - 3;
      const edge = Math.min(fv, 2 - fv, fu, 6.2 - fu);
      let r: RGB = [0xc0, 0x44, 0x5a];
      r = tone(r, (noise(px, py) - 0.5) * 0.08);
      if (edge < 0.07) r = [0xe0, 0xa0, 0x30];
      else if (edge < 0.16) r = [0x8f, 0x2c, 0x40];
      else if (((Math.floor(fu * 2) + Math.floor(fv * 4)) & 1) === 0 && edge > 0.3) r = tone(r, 0.06);
      if (Math.abs(fract(fu * 2) - 0.5) + Math.abs(fract(fv * 4) - 0.5) < 0.22 && edge > 0.3) r = tone(r, 0.14);
      return wallDist < 0.45 ? tone(r, -0.1) : r;
    }
    return out;
  }
  // A beam of sunlight from the window, soft and dithered at its edges.
  const bu = u - (3.1 + 0.55 * v), bw = 1.65;
  if (v < 4.3 && bu > 0 && bu < bw) {
    const fade = Math.min(1, bu / 0.2, (bw - bu) / 0.2, (4.3 - v) / 0.8);
    if (fade > bayer(px, py)) out = tone(out, 0.12 + (noise(px >> 1, py >> 1) - 0.5) * 0.03);
    // The window bars cast their shadow in the beam.
    if (Math.abs(fract(bu / bw * 2) - 0.5) < 0.05 && fade > 0.6) out = tone(out, -0.07);
  }
  return out;
}

// ----- The whole room -------------------------------------------------------------------

/** One RGBA pixel of the room, or null where the canvas stays empty. */
function pixelAt(look: RoomLook, px: number, py: number): RGB | null {
  const hit = locate(px, py);
  if (hit) {
    if (hit.kind === 'floor') return floorDecor(look, floorColor(look, hit.u, hit.v, px, py), hit.u, hit.v, px, py);
    return wallColor(look, hit.kind, hit.u, hit.v, px, py);
  }

  // The thickness of the floor along its two front edges.
  for (let t = 1; t <= SLAB; t++) {
    const above = locate(px, py - t);
    if (above && above.kind === 'floor') {
      const base = rgb(look.floor.a);
      const left = px < OX;
      let c = tone(base, left ? -0.4 : -0.55);
      c = tone(c, (noise(px, py) - 0.5) * 0.05 - (t / SLAB) * 0.06);
      if (t === 1) c = tone(rgb(look.floor.b), left ? -0.15 : -0.3);
      return c;
    }
  }
  // The thickness of the walls: a cap on top and a cut face at each end.
  for (let t = 1; t <= CAP; t++) {
    const l = locate(px + t, py + t / 2);
    if (l && l.kind === 'left') {
      const trim = rgb(look.wall.trim);
      return l.v >= WALL_H - 2 ? tone(trim, 0.08 - (t / CAP) * 0.1) : tone(rgb(look.wall.left), -0.38 - (t / CAP) * 0.05);
    }
    const r = locate(px - t, py + t / 2);
    if (r && r.kind === 'right') {
      const trim = rgb(look.wall.trim);
      return r.v >= WALL_H - 2 ? tone(trim, -0.08 - (t / CAP) * 0.1) : tone(rgb(look.wall.right), -0.48 - (t / CAP) * 0.05);
    }
  }
  return null;
}

/** The painted room as RGBA bytes, ROOM_W x ROOM_H. Transparent outside the room. */
export function paintRoom(look: RoomLook): Uint8ClampedArray {
  const data = new Uint8ClampedArray(ROOM_W * ROOM_H * 4);
  for (let y = 0; y < ROOM_H; y++) {
    for (let x = 0; x < ROOM_W; x++) {
      const c = pixelAt(look, x, y);
      if (!c) continue;
      const i = (y * ROOM_W + x) * 4;
      data[i] = clamp(c[0]); data[i + 1] = clamp(c[1]); data[i + 2] = clamp(c[2]); data[i + 3] = 255;
    }
  }
  // Outline: every empty pixel touching the room, in the style guide's color.
  const solid = (x: number, y: number) => x >= 0 && y >= 0 && x < ROOM_W && y < ROOM_H && data[(y * ROOM_W + x) * 4 + 3] === 255;
  const outline: number[] = [];
  for (let y = 0; y < ROOM_H; y++) {
    for (let x = 0; x < ROOM_W; x++) {
      if (!solid(x, y) && (solid(x - 1, y) || solid(x + 1, y) || solid(x, y - 1) || solid(x, y + 1))) outline.push(y * ROOM_W + x);
    }
  }
  for (const i of outline) {
    data[i * 4] = OUTLINE[0]; data[i * 4 + 1] = OUTLINE[1]; data[i * 4 + 2] = OUTLINE[2]; data[i * 4 + 3] = 255;
  }
  return data;
}
