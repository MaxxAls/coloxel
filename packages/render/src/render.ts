import {
  ANCHOR_X, ANCHOR_Y, LIMITS, SCALE, TILE_UNITS, boundsFor, frameFor, isTexture, normalizeSize, rotatedSize,
  type Part, type Recipe, type Size, type Sprite, type Texture,
} from './types';

type Frame = ReturnType<typeof frameFor>;

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
export function project(x: number, y: number, z: number, frame?: Pick<Frame, 'ax' | 'ay'>): [number, number] {
  return [(frame?.ax ?? ANCHOR_X) + SCALE * (x - y), (frame?.ay ?? ANCHOR_Y) + SCALE * ((x + y) / 2 - z)];
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

const fract = (v: number) => v - Math.floor(v);
/** Smooth value noise: blotches bigger than a pixel. */
function smooth(x: number, y: number): number {
  const xi = Math.floor(x), yi = Math.floor(y);
  const fx = x - xi, fy = y - yi;
  const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
  const a = noise(xi, yi), b = noise(xi + 1, yi), c = noise(xi, yi + 1), d = noise(xi + 1, yi + 1);
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
}

/**
 * Brightness offset of a material at a point of a face. (u, v) are the face
 * coordinates in recipe units (v is height on a side face, depth on a top);
 * (px, py) are sprite pixels, for grain. The result is added to the face tone,
 * so a texture always follows the colours and the lighting of the recipe.
 */
function texture(t: Texture, u: number, v: number, px: number, py: number): number {
  switch (t) {
    case 'planks': {
      const row = Math.floor(v / 2.5), rf = fract(v / 2.5);
      const off = noise(row, 5) * 9, seg = Math.floor((u + off) / 9);
      const joint = fract((u + off) / 9) * 9 < 0.5;
      const base = (noise(row * 31 + seg, 2) - 0.5) * 0.16;
      return rf < 0.1 || joint ? -0.3 : base + (noise(Math.floor(u * 5) + row * 7, row) - 0.5) * 0.06 + (rf > 0.8 ? 0.05 : 0);
    }
    case 'wood': {
      const row = Math.floor(v / 4), rf = fract(v / 4);
      const grainLine = noise(Math.floor((u + noise(row, 1) * 20) * 3), Math.floor(v * 1.2));
      return (rf < 0.08 ? -0.26 : 0) + (grainLine - 0.5) * 0.14 + (noise(row, 4) - 0.5) * 0.1;
    }
    case 'logs': {
      const row = Math.floor(v / 3.5), rf = fract(v / 3.5);
      const round = rf < 0.15 ? -0.34 : rf < 0.42 ? 0.1 : rf > 0.8 ? -0.14 : 0;
      const knot = noise(Math.floor(u / 12) + row, 8) < 0.12 && rf > 0.3 && rf < 0.7 ? -0.18 : 0;
      return round + knot + (noise(Math.floor(u * 2) + row * 13, row) - 0.5) * 0.1;
    }
    case 'stone': {
      const row = Math.floor(v / 3.5), rf = fract(v / 3.5);
      const w = 5 + noise(row, 3) * 4, off = noise(row, 6) * 12, col = Math.floor((u + off) / w);
      const cf = fract((u + off) / w);
      if (rf < 0.12 || cf * w < 0.5) return -0.34;
      const b = (noise(col * 17 + row, 5) - 0.5) * 0.22;
      return b + (rf > 0.75 ? -0.06 : rf < 0.3 ? 0.07 : 0) + (noise(px, py) - 0.5) * 0.06;
    }
    case 'brick': {
      const row = Math.floor(v / 2), rf = fract(v / 2);
      const col = Math.floor((u + (row & 1) * 2) / 4), cf = fract((u + (row & 1) * 2) / 4);
      if (rf < 0.2 || cf * 4 < 0.4) return -0.3;
      return (noise(col * 13 + row, 9) - 0.5) * 0.2 + (rf > 0.7 ? -0.05 : 0.04);
    }
    case 'tile': {
      const cu = fract(u / 4), cv = fract(v / 4);
      if (cu < 0.07 || cv < 0.07) return -0.22;
      return (noise(Math.floor(u / 4), Math.floor(v / 4)) - 0.5) * 0.1 + (cu < 0.2 && cv < 0.2 ? 0.08 : 0);
    }
    case 'fabric':
      return ((px + py) & 1 ? 0.045 : -0.045) + (noise(px >> 1, py >> 1) - 0.5) * 0.04;
    case 'weave':
      return (((px >> 1) + (py >> 1)) & 1 ? 0.07 : -0.07) + ((px & 1) === (py & 1) ? 0.02 : -0.02);
    case 'thatch': {
      const row = Math.floor(v / 3), rf = fract(v / 3);
      const straw = noise(Math.floor(u * 2.5) + row * 11, row);
      return rf < 0.14 ? -0.32 : (straw - 0.5) * 0.26 + (1 - rf) * 0.1 - 0.04;
    }
    case 'grass': {
      const blade = noise(px, py >> 1);
      const clump = smooth(u / 3, v / 3);
      return (blade - 0.5) * 0.2 + (clump - 0.5) * 0.24 + (blade > 0.88 ? 0.12 : 0);
    }
    case 'leaves': {
      const a = smooth(u / 2.2 + 3, v / 2.2), b = smooth(u / 1.1, v / 1.1 + 9);
      const m = a * 0.65 + b * 0.35;
      const q = m < 0.36 ? -0.3 : m < 0.5 ? -0.12 : m < 0.64 ? 0.02 : 0.15;
      return q + (noise(px, py) > 0.93 ? 0.12 : 0);
    }
    case 'metal': {
      const streak = noise(Math.floor(u * 0.7), Math.floor(v * 5));
      return (streak - 0.5) * 0.14 + (fract(v / 6) < 0.1 ? 0.1 : 0);
    }
    case 'stripes':
      return fract(u / 6) < 0.5 ? 0.08 : -0.1;
    case 'checker':
      return (Math.floor(u / 3) + Math.floor(v / 3)) & 1 ? 0.12 : -0.1;
    case 'dots': {
      const du = fract(u / 4) - 0.5, dv = fract(v / 4) - 0.5;
      return du * du + dv * dv < 0.07 ? 0.2 : -0.02;
    }
    case 'marble': {
      const vein = Math.abs(smooth(u / 5, v / 5) - 0.5), fine = Math.abs(smooth(u / 2 + 7, v / 2) - 0.5);
      return (vein < 0.035 ? -0.2 : fine < 0.02 ? -0.1 : 0) + (smooth(u / 9, v / 9) - 0.5) * 0.14;
    }
    case 'glass': {
      const d = fract((u + v) / 9);
      return d < 0.08 ? 0.28 : d > 0.14 && d < 0.2 ? 0.12 : 0;
    }
    case 'water': {
      const wave = Math.sin(u * 0.9 + smooth(u / 4, v / 2) * 5 + v * 1.7);
      return wave > 0.8 ? 0.22 : wave < -0.7 ? -0.12 : (noise(px, py) - 0.5) * 0.04;
    }
    default:
      return 0;
  }
}

/** Face coordinates (u, v) of a sprite pixel, for each kind of box face. */
function faceUV(face: 'r' | 'l' | 't', frame: Frame, px: number, py: number, x1: number, y1: number, z1: number): [number, number] {
  const a = (px + 0.5 - frame.ax) / SCALE, b = (py + 0.5 - frame.ay) / SCALE;
  if (face === 'r') {
    const y = x1 - a;
    return [y, (x1 + y) / 2 - b];
  }
  if (face === 'l') {
    const x = y1 + a;
    return [x, (x + y1) / 2 - b];
  }
  return [a / 2 + b + z1, b + z1 - a / 2];
}

type Paint = RGB | ((x: number, y: number) => RGB);

class Canvas {
  readonly data: Uint8ClampedArray;
  /** Footprint this canvas was made for: it decides how far a part may reach. */
  size: Size = [1, 1];
  readonly width: number;
  readonly height: number;

  /** Which part painted each pixel (1 + its index), so that the parts can be told apart once drawn. */
  readonly owner: Uint16Array;
  /** The part being drawn. */
  part = 0;

  constructor(readonly frame: Frame) {
    this.width = frame.width;
    this.height = frame.height;
    this.data = new Uint8ClampedArray(this.width * this.height * 4);
    this.owner = new Uint16Array(this.width * this.height);
  }

  put(x: number, y: number, c: RGB): void {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return;
    const i = (y * this.width + x) * 4;
    this.data[i] = c[0]; this.data[i + 1] = c[1]; this.data[i + 2] = c[2]; this.data[i + 3] = 255;
    this.owner[y * this.width + x] = this.part;
  }

  private paint(x: number, y: number, p: Paint): void {
    this.put(x, y, typeof p === 'function' ? p(x, y) : p);
  }

  rect(x: number, y: number, w: number, h: number, p: Paint): void {
    const x0 = Math.max(0, Math.round(x)), y0 = Math.max(0, Math.round(y));
    const x1 = Math.min(this.width, Math.round(x) + Math.round(w));
    const y1 = Math.min(this.height, Math.round(y) + Math.round(h));
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
    const yMin = Math.max(0, Math.floor(Math.min(...ys))), yMax = Math.min(this.height - 1, Math.ceil(Math.max(...ys)));
    const xMin = Math.max(0, Math.floor(Math.min(...xs))), xMax = Math.min(this.width - 1, Math.ceil(Math.max(...xs)));
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

  /** Light that brightens what is already drawn and leaves a faint halo (alpha stays under the silhouette threshold). */
  glow(cx: number, cy: number, r: number, c: RGB, strength: number): void {
    for (let y = Math.max(0, Math.floor(cy - r)); y <= Math.min(this.height - 1, Math.ceil(cy + r)); y++) {
      for (let x = Math.max(0, Math.floor(cx - r)); x <= Math.min(this.width - 1, Math.ceil(cx + r)); x++) {
        const d = Math.hypot(x + 0.5 - cx, (y + 0.5 - cy) * 1.15) / r;
        if (d >= 1) continue;
        // Four pixel-art bands instead of a smooth fade.
        const k = Math.floor((1 - d) * (1 - d) * strength * 4 + bayer(x, y) * 0.9) / 4;
        if (k <= 0) continue;
        const i = (y * this.width + x) * 4;
        const alpha = this.data[i + 3]!;
        if (alpha > 40) {
          for (let ch = 0; ch < 3; ch++) {
            const v = this.data[i + ch]!;
            this.data[i + ch] = Math.min(255, v + (255 - v) * k * 0.45 + c[ch]! * k * 0.35);
          }
        } else {
          this.data[i] = c[0]; this.data[i + 1] = c[1]; this.data[i + 2] = c[2];
          this.data[i + 3] = Math.max(alpha, Math.min(38, Math.round(k * 70)));
        }
      }
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

/**
 * Grain: a tiny, deterministic brightness jitter. Kept faint: surfaces read as clean flat tones, the way pixel art
 * is drawn by hand, and the material comes from the textures.
 */
const grain = (x: number, y: number, amount = 0.07) => (noise(x, y) - 0.5) * amount * 0.3;

/** Below this many pixels a part is a detail (a button, a knob, a spark): it is not ringed with a line. */
const DETAIL_PX = 14;

/**
 * Lines between the parts: a pixel of a part that touches a part drawn after it (so in front of it) is darkened,
 * which rings every piece of an object with a one pixel line, like hand-drawn pixel art. Tiny details are left alone.
 */
function drawPartLines(cv: Canvas): void {
  const { width: W, height: H, owner, data } = cv;
  const area = new Map<number, number>();
  for (let i = 0; i < owner.length; i++) if (owner[i]) area.set(owner[i]!, (area.get(owner[i]!) ?? 0) + 1);
  const marked: number[] = [];
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      const a = owner[i]!;
      if (!a || data[i * 4 + 3]! < 200) continue;
      const front = (j: number) => {
        const b = owner[j]!;
        return b > a && data[j * 4 + 3]! >= 200 && (area.get(b) ?? 0) >= DETAIL_PX;
      };
      if ((x > 0 && front(i - 1)) || (x < W - 1 && front(i + 1)) || (y > 0 && front(i - W)) || (y < H - 1 && front(i + W))) marked.push(i);
    }
  }
  for (const i of marked) {
    for (let c = 0; c < 3; c++) data[i * 4 + c] = Math.round(data[i * 4 + c]! * 0.45 + OUTLINE[c]! * 0.55);
  }
}

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
  const B = boundsFor(cv.size);
  const XL = B.xMin, XR = B.xMax, YL = B.yMin, YR = B.yMax, Z = B.zMax;
  const P = (x: number, y: number, z: number) => project(x, y, z, cv.frame);
  switch (p.t) {
    case 'box': {
      const x0 = num(p.x0, XL, XR, -4), x1 = num(p.x1, XL, XR, 4);
      const y0 = num(p.y0, YL, YR, -4), y1 = num(p.y1, YL, YR, 4);
      const z0 = num(p.z0, 0, Z, 0), z1 = num(p.z1, 0, Z, 4);
      if (z0 <= 20) addFootprint(fp, x0, x1, y0, y1, z1);
      const base = rgb(hex(p.c ?? p.top));
      const top = rgb(hex(p.top ?? toHex(base)));
      const left = p.left ? rgb(hex(p.left)) : tone(base, -0.18);
      const right = p.right ? rgb(hex(p.right)) : tone(base, -0.34);

      // Side faces: lit a little at the top, darker toward the floor (ambient occlusion), plus grain.
      const tx = isTexture(p.tex) ? p.tex : null;
      const side = (pts: [number, number][], color: RGB, face: 'r' | 'l'): void => {
        const ys = pts.map((q) => q[1]);
        const yTop = Math.min(...ys), yBot = Math.max(...ys);
        const span = Math.max(1, yBot - yTop);
        cv.poly(pts, (x, y) => {
          let f = 0.07 - 0.17 * ((y - yTop) / span) + grain(x, y);
          if (tx) {
            const [u, v] = faceUV(face, cv.frame, x, y, x1, y1, z1);
            f += texture(tx, u, v, x, y);
          }
          return tone(color, f);
        });
      };
      side([P(x1, y0, z0), P(x1, y1, z0), P(x1, y1, z1), P(x1, y0, z1)], right, 'r');
      side([P(x0, y1, z0), P(x1, y1, z0), P(x1, y1, z1), P(x0, y1, z1)], left, 'l');
      cv.poly(
        [P(x0, y0, z1), P(x1, y0, z1), P(x1, y1, z1), P(x0, y1, z1)],
        (x, y) => {
          let f = grain(x, y, 0.06);
          if (tx) {
            const [u, v] = faceUV('t', cv.frame, x, y, x1, y1, z1);
            f += texture(tx, u, v, x, y);
          }
          return tone(top, f);
        },
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
        .map((a) => P(num(a?.[0], XL, XR, 0), num(a?.[1], YL, YR, 0), num(a?.[2], 0, Z, 0)));
      const c = rgb(hex(p.c));
      const ys = pts.map((q) => q[1]);
      const yTop = Math.min(...ys), span = Math.max(1, Math.max(...ys) - yTop);
      const qt = isTexture(p.tex) ? p.tex : null;
      // A quad is a flat sheet: texture it in screen units (2 pixels per unit) so any orientation reads the same.
      cv.poly(pts, (x, y) => tone(c, 0.05 - 0.1 * ((y - yTop) / span) + grain(x, y, 0.05) + (qt ? texture(qt, x / SCALE, y / SCALE, x, y) : 0)));
      return;
    }
    case 'cyl': {
      const r = num(p.r, 0.5, 12, 3);
      const cxu = num(p.x, XL, XR, 0), cyu = num(p.y, YL, YR, 0);
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
      const sx = num(p.x, XL, XR, 0), sy = num(p.y, YL, YR, 0), sz = num(p.z, 0, Z, 4);
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
      const [cx, cy] = P(num(p.x, XL, XR, 0), num(p.y, YL, YR, 0), num(p.z, 0, Z, 2));
      const c = rgb(hex(p.c));
      cv.ellipse(cx, cy, r, r, (x, y) => {
        const a = (x + 0.5 - cx) / r, b = (y + 0.5 - cy) / r;
        return tone(c, (a * a + b * b > 0.72 ? -0.14 : 0) + (-a - b > 0.9 ? 0.12 : 0) + grain(x, y, 0.04));
      });
      if (p.c2) cv.ellipse(cx, cy, r / 2, r / 2, rgb(hex(p.c2)));
      return;
    }
    case 'pix': {
      const [x, y] = P(num(p.x, XL, XR, 0), num(p.y, YL, YR, 0), num(p.z, 0, Z, 0));
      const w = Math.max(1, Math.round(num(p.w, 0.5, 8, 1) * SCALE));
      const h = Math.max(1, Math.round(num(p.h, 0.5, 8, 1) * SCALE));
      cv.rect(x, y, w, h, rgb(hex(p.c)));
      return;
    }
    case 'glow': {
      const [x, y] = P(num(p.x, XL, XR, 0), num(p.y, YL, YR, 0), num(p.z, 0, Z, 0));
      cv.glow(x, y, num(p.r, 1, 30, 8) * SCALE, rgb(hex(p.c)), num(p.a, 0.1, 1, 0.6));
      return;
    }
    default:
      return;
  }
}

/** A soft contact shadow on the floor under the footprint, dithered to stay pixel art. */
function castShadow(d: Uint8ClampedArray, fp: Footprint, frame: Frame): void {
  if (!fp.any) return;
  // Light comes from the upper left: the shadow leans toward the viewer's right, further for tall objects.
  const lean = 0.8 + Math.min(4, fp.height / 12);
  const x0 = fp.x0 + lean * 0.6, x1 = fp.x1 + lean, y0 = fp.y0 + lean * 0.6, y1 = fp.y1 + lean;
  const soft = 2.6;
  for (let py = 0; py < frame.height; py++) {
    for (let px = 0; px < frame.width; px++) {
      const i = (py * frame.width + px) * 4;
      if (d[i + 3]! !== 0) continue;
      // Back from the pixel to the floor point beneath it.
      const dx = (px + 0.5 - frame.ax) / SCALE, dy = (py + 0.5 - frame.ay) / SCALE;
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
export function renderSprite(parts: readonly unknown[], size?: Size): Sprite {
  const footprint = normalizeSize(size);
  const frame = frameFor(footprint);
  const cv = new Canvas(frame);
  cv.size = footprint;
  const fp: Footprint = { x0: 0, x1: 0, y0: 0, y1: 0, height: 0, any: false };
  (Array.isArray(parts) ? parts : []).slice(0, LIMITS.maxParts).forEach((p, k) => {
    cv.part = k + 1;
    if (p && typeof p === 'object' && 't' in p) drawPart(cv, p as Part, fp);
  });
  drawPartLines(cv);

  const W = frame.width, H = frame.height;
  const d = cv.data, n = W * H;
  const solid = new Uint8Array(n);
  for (let i = 0; i < n; i++) solid[i] = d[i * 4 + 3]! > 40 ? 1 : 0;

  const [or, og, ob] = OUTLINE;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      if (solid[i]) continue;
      const touches =
        (x > 0 && solid[i - 1]) || (x < W - 1 && solid[i + 1]) ||
        (y > 0 && solid[i - W]) || (y < H - 1 && solid[i + W]);
      if (touches) { d[i * 4] = or; d[i * 4 + 1] = og; d[i * 4 + 2] = ob; d[i * 4 + 3] = 255; }
    }
  }

  // What can be clicked is the object and its outline, not its shadow.
  const mask = new Uint8Array(n);
  for (let i = 0; i < n; i++) mask[i] = d[i * 4 + 3]! > 40 ? 1 : 0;
  castShadow(d, fp, frame);
  return { width: W, height: H, data: d, mask, ax: frame.ax, ay: frame.ay };
}

/** Draw a whole recipe turned by quarter turns: the parts are rotated around the middle of its footprint, then drawn on the right frame. */
export function renderRecipe(recipe: Pick<Recipe, 'parts' | 'size'>, turns = 0): Sprite {
  const size = normalizeSize(recipe.size);
  return renderSprite(rotateParts(recipe.parts, turns, size), rotatedSize(size, turns));
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

/**
 * Turn a recipe by quarter turns around the centre of its tile (x, y -> -y, x),
 * so a piece of furniture can face another way. Flat screen-facing parts (circles,
 * pixels) only move: they keep facing the player. Pure and total: unknown parts pass through.
 */
export function rotateParts<P extends { t?: unknown }>(parts: readonly P[], turns: number, size?: Size): P[] {
  const n = ((Math.trunc(turns) % 4) + 4) % 4;
  if (n === 0) return [...parts];
  // Turn around the middle of the footprint, then slide into the rotated footprint (sides swap on an odd count).
  const [w, h] = normalizeSize(size);
  const [w2, h2] = rotatedSize([w, h], n);
  const cx = (TILE_UNITS * (w - 1)) / 2, cy = (TILE_UNITS * (h - 1)) / 2;
  const nx = (TILE_UNITS * (w2 - 1)) / 2, ny = (TILE_UNITS * (h2 - 1)) / 2;
  const spin = (x: number, y: number): [number, number] => {
    let rx = x - cx, ry = y - cy;
    for (let k = 0; k < n; k++) [rx, ry] = [-ry, rx];
    return [rx + nx, ry + ny];
  };
  const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
  return parts.map((raw) => {
    const p = raw as unknown as Record<string, unknown>;
    switch (p.t) {
      case 'box': {
        if (!num(p.x0) || !num(p.x1) || !num(p.y0) || !num(p.y1)) return raw;
        const a = spin(p.x0, p.y0);
        const b = spin(p.x1, p.y1);
        return { ...p, x0: Math.min(a[0], b[0]), x1: Math.max(a[0], b[0]), y0: Math.min(a[1], b[1]), y1: Math.max(a[1], b[1]) } as unknown as P;
      }
      case 'cyl':
      case 'sphere':
      case 'circle':
      case 'glow':
      case 'pix': {
        if (!num(p.x) || !num(p.y)) return raw;
        const [x, y] = spin(p.x, p.y);
        return { ...p, x, y } as unknown as P;
      }
      case 'quad': {
        if (!Array.isArray(p.pts)) return raw;
        const pts = (p.pts as unknown[]).map((pt) => {
          if (!Array.isArray(pt) || !num(pt[0]) || !num(pt[1])) return pt;
          const [x, y] = spin(pt[0], pt[1]);
          return [x, y, pt[2]];
        });
        return { ...p, pts } as unknown as P;
      }
      default:
        return raw;
    }
  });
}
