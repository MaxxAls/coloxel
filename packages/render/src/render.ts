import {
  ANCHOR_X, ANCHOR_Y, LIMITS, SCALE, SPRITE_H, SPRITE_W,
  type Part, type Sprite,
} from './types';

type RGB = [number, number, number];

const OUTLINE: RGB = [0x1b, 0x15, 0x30];

export function isHex(c: unknown): c is string {
  return typeof c === 'string' && /^#[0-9a-fA-F]{6}$/.test(c);
}

function hex(c: unknown): string {
  return isHex(c) ? c : '#999999';
}

function rgb(c: string): RGB {
  return [parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16), parseInt(c.slice(5, 7), 16)];
}

const toHex = (c: RGB) => '#' + c.map((v) => v.toString(16).padStart(2, '0')).join('');

/** Mix an RGB colour toward black (f < 0) or white (f > 0). */
function tone(c: RGB, f: number): RGB {
  const t = f < 0 ? 0 : 255;
  const k = Math.min(1, Math.abs(f));
  return [Math.round(c[0] + (t - c[0]) * k), Math.round(c[1] + (t - c[1]) * k), Math.round(c[2] + (t - c[2]) * k)];
}

/** Mix a colour toward black (f < 0) or white (f > 0). */
export function shade(c: string, f: number): string {
  return toHex(tone(rgb(hex(c)), f));
}

function num(v: unknown, lo: number, hi: number, d: number): number {
  const n = Number(v);
  return Math.max(lo, Math.min(hi, Number.isFinite(n) ? n : d));
}

/** Screen position of a recipe point inside the sprite. */
export function project(x: number, y: number, z: number): [number, number] {
  return [ANCHOR_X + SCALE * (x - y), ANCHOR_Y + SCALE * ((x + y) / 2 - z)];
}

/** Deterministic noise in [0, 1): the same pixel always gets the same grain, on every machine. */
function noise(x: number, y: number): number {
  let h = Math.imul(x | 0, 0x27d4eb2d) ^ Math.imul(y | 0, 0x165667b1);
  h ^= h >>> 15;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
/** Ordered-dither threshold in (0, 1) for a pixel: turns smooth gradients into pixel-art bands. */
const bayer = (x: number, y: number) => (BAYER[((y & 3) << 2) | (x & 3)]! + 0.5) / 16;

type Paint = RGB | ((x: number, y: number) => RGB);

class Canvas {
  readonly data = new Uint8ClampedArray(SPRITE_W * SPRITE_H * 4);

  put(x: number, y: number, c: RGB): void {
    if (x < 0 || y < 0 || x >= SPRITE_W || y >= SPRITE_H) return;
    const i = (y * SPRITE_W + x) * 4;
    this.data[i] = c[0]; this.data[i + 1] = c[1]; this.data[i + 2] = c[2]; this.data[i + 3] = 255;
  }

  private paint(x: number, y: number, p: Paint): void {
    this.put(x, y, typeof p === 'function' ? p(x, y) : p);
  }

  rect(x: number, y: number, w: number, h: number, p: Paint): void {
    const x0 = Math.max(0, Math.round(x)), y0 = Math.max(0, Math.round(y));
    const x1 = Math.min(SPRITE_W, Math.round(x) + Math.round(w));
    const y1 = Math.min(SPRITE_H, Math.round(y) + Math.round(h));
    for (let yy = y0; yy < y1; yy++) for (let xx = x0; xx < x1; xx++) this.paint(xx, yy, p);
  }

  poly(pts: [number, number][], p: Paint): void {
    const xs = pts.map((q) => q[0]), ys = pts.map((q) => q[1]);
    const inside = (px: number, py: number): boolean => {
      let k = false;
      for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
        const [a, b] = pts[i]!, [cx, d] = pts[j]!;
        if ((b > py) !== (d > py) && px < ((cx - a) * (py - b)) / (d - b) + a) k = !k;
      }
      return k;
    };
    const yMin = Math.max(0, Math.floor(Math.min(...ys))), yMax = Math.min(SPRITE_H - 1, Math.ceil(Math.max(...ys)));
    const xMin = Math.max(0, Math.floor(Math.min(...xs))), xMax = Math.min(SPRITE_W - 1, Math.ceil(Math.max(...xs)));
    for (let y = yMin; y <= yMax; y++) {
      for (let x = xMin; x <= xMax; x++) if (inside(x + 0.5, y + 0.5)) this.paint(x, y, p);
    }
  }

  /** A one pixel line (Bresenham) between two projected points. */
  line(ax: number, ay: number, bx: number, by: number, c: RGB): void {
    let x0 = Math.round(ax), y0 = Math.round(ay);
    const x1 = Math.round(bx), y1 = Math.round(by);
    const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
    let err = dx + dy;
    for (let guard = 0; guard < 4096; guard++) {
      this.put(x0, y0, c);
      if (x0 === x1 && y0 === y1) break;
      const e2 = 2 * err;
      if (e2 >= dy) { err += dy; x0 += sx; }
      if (e2 <= dx) { err += dx; y0 += sy; }
    }
  }

  ellipse(cx: number, cy: number, rx: number, ry: number, p: Paint): void {
    if (rx < 0.5 || ry < 0.5) return;
    for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++) {
      for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
        const a = (x + 0.5 - cx) / rx, b = (y + 0.5 - cy) / ry;
        if (a * a + b * b <= 1) this.paint(x, y, p);
      }
    }
  }
}

/** Grain: a tiny, deterministic brightness jitter that makes flat surfaces read as material. */
const grain = (x: number, y: number, amount = 0.07) => (noise(x, y) - 0.5) * amount;

/** Footprint of what stands on the floor, to cast a soft shadow under it. */
interface Footprint {
  x0: number; x1: number; y0: number; y1: number; height: number; any: boolean;
}

function addFootprint(f: Footprint, x0: number, x1: number, y0: number, y1: number, top: number): void {
  if (!f.any) {
    f.x0 = x0; f.x1 = x1; f.y0 = y0; f.y1 = y1; f.any = true;
  } else {
    f.x0 = Math.min(f.x0, x0); f.x1 = Math.max(f.x1, x1);
    f.y0 = Math.min(f.y0, y0); f.y1 = Math.max(f.y1, y1);
  }
  f.height = Math.max(f.height, top);
}

function drawPart(cv: Canvas, p: Part, fp: Footprint): void {
  const L = -LIMITS.xy, R = LIMITS.xy, Z = LIMITS.z;
  const P = project;
  switch (p.t) {
    case 'box': {
      const x0 = num(p.x0, L, R, -4), x1 = num(p.x1, L, R, 4);
      const y0 = num(p.y0, L, R, -4), y1 = num(p.y1, L, R, 4);
      const z0 = num(p.z0, 0, Z, 0), z1 = num(p.z1, 0, Z, 4);
      if (z0 <= 20) addFootprint(fp, x0, x1, y0, y1, z1);
      const base = rgb(hex(p.c ?? p.top));
      const top = rgb(hex(p.top ?? toHex(base)));
      const left = p.left ? rgb(hex(p.left)) : tone(base, -0.18);
      const right = p.right ? rgb(hex(p.right)) : tone(base, -0.34);

      // Side faces: lit a little at the top, darker toward the floor (ambient occlusion), plus grain.
      const side = (pts: [number, number][], color: RGB): void => {
        const ys = pts.map((q) => q[1]);
        const yTop = Math.min(...ys), yBot = Math.max(...ys);
        const span = Math.max(1, yBot - yTop);
        cv.poly(pts, (x, y) => tone(color, 0.07 - 0.17 * ((y - yTop) / span) + grain(x, y)));
      };
      side([P(x1, y0, z0), P(x1, y1, z0), P(x1, y1, z1), P(x1, y0, z1)], right);
      side([P(x0, y1, z0), P(x1, y1, z0), P(x1, y1, z1), P(x0, y1, z1)], left);
      cv.poly(
        [P(x0, y0, z1), P(x1, y0, z1), P(x1, y1, z1), P(x0, y1, z1)],
        (x, y) => tone(top, grain(x, y, 0.06)),
      );

      // Edges: a light line where the top meets the sides, a dark one on the vertical corner.
      const hi = tone(top, 0.24);
      const [ax, ay] = P(x0, y1, z1), [bx, by] = P(x1, y1, z1), [cx2, cy2] = P(x1, y0, z1);
      cv.line(ax, ay, bx, by, hi);
      cv.line(cx2, cy2, bx, by, tone(top, 0.12));
      if ((z1 - z0) * SCALE >= 4) {
        const [dx, dy] = P(x1, y1, z0);
        cv.line(bx, by + 1, dx, dy - 1, tone(base, -0.42));
      }
      return;
    }
    case 'quad': {
      if (!Array.isArray(p.pts) || p.pts.length < 3) return;
      const pts = p.pts.slice(0, LIMITS.maxQuadPoints)
        .map((a) => P(num(a?.[0], L, R, 0), num(a?.[1], L, R, 0), num(a?.[2], 0, Z, 0)));
      const c = rgb(hex(p.c));
      const ys = pts.map((q) => q[1]);
      const yTop = Math.min(...ys), span = Math.max(1, Math.max(...ys) - yTop);
      cv.poly(pts, (x, y) => tone(c, 0.05 - 0.1 * ((y - yTop) / span) + grain(x, y, 0.05)));
      return;
    }
    case 'cyl': {
      const r = num(p.r, 0.5, 12, 3);
      const cxu = num(p.x, L, R, 0), cyu = num(p.y, L, R, 0);
      const z0 = num(p.z0, 0, Z, 0), z1 = num(p.z1, 0, Z, 6);
      if (z0 <= 20) addFootprint(fp, cxu - r, cxu + r, cyu - r, cyu + r, z1);
      const [cx, cb] = P(cxu, cyu, z0);
      const height = (z1 - z0) * SCALE;
      const ct = cb - height;
      const rx = r * 1.41 * SCALE, ry = rx / 2;
      const side = rgb(hex(p.side));
      const top = rgb(hex(p.top ?? toHex(tone(side, 0.18))));
      const TONES = [-0.34, -0.22, -0.1, 0, 0.1, 0.2];
      // Curved side: light from the upper left, banded like pixel art, darker toward the floor.
      for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
        const nx = Math.max(-1, Math.min(1, (x + 0.5 - cx) / rx));
        const nz = Math.sqrt(1 - nx * nx);
        const lam = -0.6 * nx + 0.55 * nz;
        const yb = cb + ry * nz;
        for (let y = Math.floor(ct); y < yb; y++) {
          const idx = Math.max(0, Math.min(5, Math.round((lam * 0.5 + 0.5) * 5 + (bayer(x, y) - 0.5) * 0.8)));
          const fall = height > 0 ? 0.1 * Math.min(1, Math.max(0, (y - ct) / (height + ry))) : 0;
          cv.put(x, y, tone(side, TONES[idx]! - fall + grain(x, y, 0.04)));
        }
      }
      // A thin glint along the curved side.
      if (height >= 8) {
        const gx = Math.round(cx - rx * 0.4);
        for (let y = Math.round(ct + ry * 0.6); y < cb - 2; y++) if ((y & 3) !== 3) cv.put(gx, y, tone(side, 0.34));
      }
      // Top disc, with a soft highlight and a slightly darker rim.
      cv.ellipse(cx, ct, rx, ry, (x, y) => {
        const a = (x + 0.5 - cx) / rx, b = (y + 0.5 - ct) / ry;
        const d = a * a + b * b;
        const lit = -0.5 * a - 0.5 * b;
        return tone(top, (d > 0.8 ? -0.1 : 0) + (lit > 0.35 ? 0.1 : 0) + grain(x, y, 0.05));
      });
      return;
    }
    case 'sphere': {
      const r = num(p.r, 0.5, 14, 3) * SCALE;
      const sx = num(p.x, L, R, 0), sy = num(p.y, L, R, 0), sz = num(p.z, 0, Z, 4);
      if (sz - r / SCALE <= 12) addFootprint(fp, sx - r / SCALE * 0.9, sx + r / SCALE * 0.9, sy - r / SCALE * 0.9, sy + r / SCALE * 0.9, sz + r / SCALE);
      const [cx, cy] = P(sx, sy, sz);
      const c = rgb(hex(p.c));
      const TONES = [-0.42, -0.28, -0.14, 0, 0.12, 0.24];
      for (let y = Math.floor(cy - r); y <= Math.ceil(cy + r); y++) {
        for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++) {
          const dx = (x + 0.5 - cx) / r, dy = (y + 0.5 - cy) / r;
          const d2 = dx * dx + dy * dy;
          if (d2 > 1) continue;
          const nz = Math.sqrt(1 - d2);
          // Light from the upper left and the viewer's side.
          const lam = -0.5 * dx - 0.6 * dy + 0.62 * nz;
          if (lam > 0.93 && r >= 3) { cv.put(x, y, tone(c, 0.62)); continue; }
          // Bounce light on the lower right rim keeps the dark side from going flat.
          const bounce = d2 > 0.62 && dx + dy > 0.4 ? 0.12 : 0;
          const idx = Math.max(0, Math.min(5, Math.round(((lam + 1) / 2) * 5 + (bayer(x, y) - 0.5) * 0.9)));
          cv.put(x, y, tone(c, TONES[idx]! + bounce + grain(x, y, 0.04)));
        }
      }
      return;
    }
    case 'circle': {
      const r = num(p.r, 0.5, 12, 2) * SCALE;
      const [cx, cy] = P(num(p.x, L, R, 0), num(p.y, L, R, 0), num(p.z, 0, Z, 2));
      const c = rgb(hex(p.c));
      cv.ellipse(cx, cy, r, r, (x, y) => {
        const a = (x + 0.5 - cx) / r, b = (y + 0.5 - cy) / r;
        return tone(c, (a * a + b * b > 0.72 ? -0.14 : 0) + (-a - b > 0.9 ? 0.12 : 0) + grain(x, y, 0.04));
      });
      if (p.c2) cv.ellipse(cx, cy, r / 2, r / 2, rgb(hex(p.c2)));
      return;
    }
    case 'pix': {
      const [x, y] = P(num(p.x, L, R, 0), num(p.y, L, R, 0), num(p.z, 0, Z, 0));
      const w = Math.max(1, Math.round(num(p.w, 0.5, 8, 1) * SCALE));
      const h = Math.max(1, Math.round(num(p.h, 0.5, 8, 1) * SCALE));
      cv.rect(x, y, w, h, rgb(hex(p.c)));
      return;
    }
    default:
      return;
  }
}

/** A soft contact shadow on the floor under the footprint, dithered to stay pixel art. */
function castShadow(d: Uint8ClampedArray, fp: Footprint): void {
  if (!fp.any) return;
  // Light comes from the upper left: the shadow leans toward the viewer's right, further for tall objects.
  const lean = 0.8 + Math.min(4, fp.height / 12);
  const x0 = fp.x0 + lean * 0.6, x1 = fp.x1 + lean, y0 = fp.y0 + lean * 0.6, y1 = fp.y1 + lean;
  const soft = 2.6;
  for (let py = 0; py < SPRITE_H; py++) {
    for (let px = 0; px < SPRITE_W; px++) {
      const i = (py * SPRITE_W + px) * 4;
      if (d[i + 3]! !== 0) continue;
      // Back from the pixel to the floor point beneath it.
      const dx = (px + 0.5 - ANCHOR_X) / SCALE, dy = (py + 0.5 - ANCHOR_Y) / SCALE;
      const fx = dy + dx / 2, fy = dy - dx / 2;
      const ox = fx < x0 ? x0 - fx : fx > x1 ? fx - x1 : 0;
      const oy = fy < y0 ? y0 - fy : fy > y1 ? fy - y1 : 0;
      const dist = Math.hypot(ox, oy);
      if (dist >= soft) continue;
      const strength = 1 - dist / soft;
      if (strength <= bayer(px, py) * 0.9) continue;
      d[i] = OUTLINE[0]; d[i + 1] = OUTLINE[1]; d[i + 2] = OUTLINE[2]; d[i + 3] = 74;
    }
  }
}

/**
 * Turn a recipe into pixels. Never throws: unknown or malformed parts are
 * skipped or clamped, so a bad model answer can at worst look wrong.
 * Parts are painted in order (back to front is the recipe's job).
 */
export function renderSprite(parts: readonly unknown[]): Sprite {
  const cv = new Canvas();
  const fp: Footprint = { x0: 0, x1: 0, y0: 0, y1: 0, height: 0, any: false };
  for (const p of (Array.isArray(parts) ? parts : []).slice(0, LIMITS.maxParts)) {
    if (p && typeof p === 'object' && 't' in p) drawPart(cv, p as Part, fp);
  }

  const d = cv.data, n = SPRITE_W * SPRITE_H;
  const solid = new Uint8Array(n);
  for (let i = 0; i < n; i++) solid[i] = d[i * 4 + 3]! > 40 ? 1 : 0;

  const [or, og, ob] = OUTLINE;
  for (let y = 0; y < SPRITE_H; y++) {
    for (let x = 0; x < SPRITE_W; x++) {
      const i = y * SPRITE_W + x;
      if (solid[i]) continue;
      const touches =
        (x > 0 && solid[i - 1]) || (x < SPRITE_W - 1 && solid[i + 1]) ||
        (y > 0 && solid[i - SPRITE_W]) || (y < SPRITE_H - 1 && solid[i + SPRITE_W]);
      if (touches) { d[i * 4] = or; d[i * 4 + 1] = og; d[i * 4 + 2] = ob; d[i * 4 + 3] = 255; }
    }
  }

  // What can be clicked is the object and its outline, not its shadow.
  const mask = new Uint8Array(n);
  for (let i = 0; i < n; i++) mask[i] = d[i * 4 + 3]! > 40 ? 1 : 0;
  castShadow(d, fp);
  return { width: SPRITE_W, height: SPRITE_H, data: d, mask };
}

/** Stable FNV-1a hash of a sprite's pixels, to check client and server agree. */
export function spriteHash(s: Sprite): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.data.length; i++) {
    h ^= s.data[i]!;
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}
