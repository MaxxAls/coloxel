import {
  ANCHOR_X, ANCHOR_Y, LIMITS, SPRITE_H, SPRITE_W,
  type Part, type Sprite,
} from './types';

const OUTLINE = '#1b1530';

export function isHex(c: unknown): c is string {
  return typeof c === 'string' && /^#[0-9a-fA-F]{6}$/.test(c);
}

function hex(c: unknown): string {
  return isHex(c) ? c : '#999999';
}

function rgb(c: string): [number, number, number] {
  return [parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16), parseInt(c.slice(5, 7), 16)];
}

/** Mix a colour toward black (f < 0) or white (f > 0). */
export function shade(c: string, f: number): string {
  const [r, g, b] = rgb(hex(c));
  const t = f < 0 ? 0 : 255;
  const k = Math.abs(f);
  return '#' + [r, g, b]
    .map((v) => Math.round(v + (t - v) * k).toString(16).padStart(2, '0'))
    .join('');
}

function num(v: unknown, lo: number, hi: number, d: number): number {
  const n = Number(v);
  return Math.max(lo, Math.min(hi, Number.isFinite(n) ? n : d));
}

/** Screen position of a recipe point inside the sprite. */
export function project(x: number, y: number, z: number): [number, number] {
  return [ANCHOR_X + (x - y), ANCHOR_Y + (x + y) / 2 - z];
}

class Canvas {
  readonly data = new Uint8ClampedArray(SPRITE_W * SPRITE_H * 4);

  fill(x: number, y: number, w: number, h: number, c: string): void {
    const [r, g, b] = rgb(c);
    const x0 = Math.max(0, Math.round(x)), y0 = Math.max(0, Math.round(y));
    const x1 = Math.min(SPRITE_W, Math.round(x) + Math.round(w));
    const y1 = Math.min(SPRITE_H, Math.round(y) + Math.round(h));
    for (let yy = y0; yy < y1; yy++) {
      for (let xx = x0; xx < x1; xx++) {
        const i = (yy * SPRITE_W + xx) * 4;
        this.data[i] = r; this.data[i + 1] = g; this.data[i + 2] = b; this.data[i + 3] = 255;
      }
    }
  }

  px(x: number, y: number, c: string): void {
    this.fill(x, y, 1, 1, c);
  }

  poly(pts: [number, number][], c: string): void {
    const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
    const inside = (px: number, py: number): boolean => {
      let k = false;
      for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
        const [a, b] = pts[i]!, [cx, d] = pts[j]!;
        if ((b > py) !== (d > py) && px < ((cx - a) * (py - b)) / (d - b) + a) k = !k;
      }
      return k;
    };
    for (let y = Math.floor(Math.min(...ys)); y <= Math.ceil(Math.max(...ys)); y++) {
      for (let x = Math.floor(Math.min(...xs)); x <= Math.ceil(Math.max(...xs)); x++) {
        if (inside(x + 0.5, y + 0.5)) this.px(x, y, c);
      }
    }
  }

  ellipse(cx: number, cy: number, rx: number, ry: number, c: string): void {
    if (rx < 0.5 || ry < 0.5) return;
    for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++) {
      for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
        const a = (x + 0.5 - cx) / rx, b = (y + 0.5 - cy) / ry;
        if (a * a + b * b <= 1) this.px(x, y, c);
      }
    }
  }
}

function drawPart(cv: Canvas, p: Part): void {
  const L = -LIMITS.xy, R = LIMITS.xy, Z = LIMITS.z;
  const P = project;
  switch (p.t) {
    case 'box': {
      const x0 = num(p.x0, L, R, -4), x1 = num(p.x1, L, R, 4);
      const y0 = num(p.y0, L, R, -4), y1 = num(p.y1, L, R, 4);
      const z0 = num(p.z0, 0, Z, 0), z1 = num(p.z1, 0, Z, 4);
      const base = hex(p.c ?? p.top);
      const top = hex(p.top ?? base);
      const left = hex(p.left ?? shade(base, -0.18));
      const right = hex(p.right ?? shade(base, -0.34));
      cv.poly([P(x1, y0, z0), P(x1, y1, z0), P(x1, y1, z1), P(x1, y0, z1)], right);
      cv.poly([P(x0, y1, z0), P(x1, y1, z0), P(x1, y1, z1), P(x0, y1, z1)], left);
      cv.poly([P(x0, y0, z1), P(x1, y0, z1), P(x1, y1, z1), P(x0, y1, z1)], top);
      return;
    }
    case 'quad': {
      if (!Array.isArray(p.pts) || p.pts.length < 3) return;
      const pts = p.pts.slice(0, LIMITS.maxQuadPoints)
        .map((a) => P(num(a?.[0], L, R, 0), num(a?.[1], L, R, 0), num(a?.[2], 0, Z, 0)));
      cv.poly(pts, hex(p.c));
      return;
    }
    case 'cyl': {
      const r = num(p.r, 0.5, 12, 3);
      const z0 = num(p.z0, 0, Z, 0), z1 = num(p.z1, 0, Z, 6);
      const [cx, cb] = P(num(p.x, L, R, 0), num(p.y, L, R, 0), z0);
      const ct = cb - (z1 - z0);
      const rx = r * 1.41, ry = rx / 2;
      const side = hex(p.side), top = hex(p.top ?? shade(side, 0.18));
      const h = Math.max(0, Math.round(cb - ct));
      cv.ellipse(cx, cb, rx, ry, shade(side, -0.2));
      cv.fill(cx - rx, ct, rx, h, side);
      cv.fill(cx, ct, rx, h, shade(side, -0.2));
      cv.ellipse(cx, ct, rx, ry, top);
      return;
    }
    case 'sphere': {
      const r = num(p.r, 0.5, 14, 3);
      const [cx, cy] = P(num(p.x, L, R, 0), num(p.y, L, R, 0), num(p.z, 0, Z, 4));
      const c = hex(p.c), dark = shade(c, -0.28), light = shade(c, 0.35);
      for (let y = Math.floor(cy - r); y <= Math.ceil(cy + r); y++) {
        for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++) {
          const dx = x + 0.5 - cx, dy = y + 0.5 - cy;
          if (dx * dx + dy * dy <= r * r) {
            const s = (dx + dy) / r;
            cv.px(x, y, s > 0.55 ? dark : s < -0.75 ? light : c);
          }
        }
      }
      return;
    }
    case 'circle': {
      const r = num(p.r, 0.5, 12, 2);
      const [cx, cy] = P(num(p.x, L, R, 0), num(p.y, L, R, 0), num(p.z, 0, Z, 2));
      cv.ellipse(cx, cy, r, r, hex(p.c));
      if (p.c2) cv.ellipse(cx, cy, r / 2, r / 2, hex(p.c2));
      return;
    }
    case 'pix': {
      const [x, y] = P(num(p.x, L, R, 0), num(p.y, L, R, 0), num(p.z, 0, Z, 0));
      cv.fill(x, y, num(p.w, 1, 8, 1), num(p.h, 1, 8, 1), hex(p.c));
      return;
    }
    default:
      return;
  }
}

/**
 * Turn a recipe into pixels. Never throws: unknown or malformed parts are
 * skipped or clamped, so a bad model answer can at worst look wrong.
 * Parts are painted in order (back to front is the recipe's job).
 */
export function renderSprite(parts: readonly unknown[]): Sprite {
  const cv = new Canvas();
  for (const p of (Array.isArray(parts) ? parts : []).slice(0, LIMITS.maxParts)) {
    if (p && typeof p === 'object' && 't' in p) drawPart(cv, p as Part);
  }

  const d = cv.data, n = SPRITE_W * SPRITE_H;
  const solid = new Uint8Array(n);
  for (let i = 0; i < n; i++) solid[i] = d[i * 4 + 3]! > 40 ? 1 : 0;

  const [or, og, ob] = rgb(OUTLINE);
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

  const mask = new Uint8Array(n);
  for (let i = 0; i < n; i++) mask[i] = d[i * 4 + 3]! > 40 ? 1 : 0;
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
