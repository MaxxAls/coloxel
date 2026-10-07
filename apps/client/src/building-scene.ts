import { Container, Graphics, Text, type Ticker } from 'pixi.js';
import { floorStyle, wallStyle } from '@coloxel/render';
import { ringAndWait } from './bell';
import { api, apartmentTitle, type BuildingApartment } from './api';
import { FONT, type Scene, type SceneHost } from './scene';

// The building seen from the street, at twice the resolution of the first version.
const W = 600;
const CELL_W = 100;
const CELL_H = 70;
const ROOF_H = 76;
const HALL_H = 90;
const STREET_H = 44;
const REFRESH_MS = 4000;
/** The sky, skyline and street reach this far on each side of the scene, to fill the whole window. */
const EDGE = 1800;

interface Layout {
  floors: number;
  perFloor: number;
  /** Left edge of the building body. */
  x0: number;
  /** Top of the topmost floor. */
  y0: number;
  height: number;
}

function layoutFor(apartments: BuildingApartment[]): Layout {
  const floors = Math.max(6, ...apartments.map((a) => a.floor));
  const perFloor = Math.max(5, ...apartments.map((a) => a.slot + 1));
  const x0 = Math.floor((W - perFloor * CELL_W) / 2);
  return { floors, perFloor, x0, y0: ROOF_H, height: ROOF_H + floors * CELL_H + HALL_H + STREET_H };
}

const cellRect = (l: Layout, a: BuildingApartment) => ({
  x: l.x0 + a.slot * CELL_W + 3,
  y: l.y0 + (l.floors - a.floor) * CELL_H + 3,
  w: CELL_W - 6,
  h: CELL_H - 6,
});

const hallRect = (l: Layout) => ({
  x: l.x0 + Math.floor((l.perFloor * CELL_W) / 2) - 100,
  y: l.y0 + l.floors * CELL_H + 12,
  w: 200,
  h: HALL_H - 14,
});

const shortName = (name: string) => (name.length > 9 ? name.slice(0, 9) : name);

function statusText(a: BuildingApartment): string {
  if (!a.owner) return 'Appartement libre';
  const people = a.visitors > 0 ? ` · ${a.visitors} ${a.visitors > 1 ? 'personnes' : 'personne'} dedans` : '';
  if (a.mine) return `${a.name ?? 'Ton appart'}${people}`;
  const owner = a.name ? ` · ${a.owner.nickname}` : '';
  return `${apartmentTitle(a.name, a.owner.nickname)}${owner} · ${a.open ? 'ouvert' : 'fermé'}${people}`;
}

const hash = (n: number, salt = 0) => {
  let h = Math.imul(n + 1, 0x9e3779b1) ^ Math.imul(salt + 7, 0x85ebca6b);
  h ^= h >>> 15;
  h = Math.imul(h, 0x2c1b3c6d);
  h ^= h >>> 12;
  return (h >>> 0) / 4294967296;
};

type Color = number;
const rect = (g: Graphics, x: number, y: number, w: number, h: number, color: Color, alpha = 1) => {
  g.rect(x, y, w, h).fill({ color, alpha });
};
const mixColor = (a: Color, b: Color, t: number): Color => {
  const ch = (shift: number) => Math.round(((a >> shift) & 255) * (1 - t) + ((b >> shift) & 255) * t);
  return (ch(16) << 16) | (ch(8) << 8) | ch(0);
};
const lighten = (c: Color, t: number) => mixColor(c, 0xffffff, t);
const darken = (c: Color, t: number) => mixColor(c, 0x000000, t);

// ----- Static pieces: sky, skyline, street ---------------------------------------------

function drawSky(g: Graphics, l: Layout) {
  g.clear();
  const H = l.height;
  const left = -EDGE, width = W + 2 * EDGE;
  // Dusk sky: deep violet at the top, warm rose near the street. The first and last colors run on past the scene.
  const stops = [0x140d3a, 0x1d1250, 0x2a1a63, 0x3a2277, 0x502c86, 0x6c3790, 0x8f4592, 0xb55a8f];
  const bands = 40;
  rect(g, left, -EDGE, width, EDGE + 2, stops[0]!);
  for (let k = 0; k < bands; k++) {
    const t = (k / (bands - 1)) * (stops.length - 1);
    const i = Math.min(stops.length - 2, Math.floor(t));
    rect(g, left, Math.floor((k * H) / bands), width, Math.ceil(H / bands) + 1, mixColor(stops[i]!, stops[i + 1]!, t - i));
  }
  rect(g, left, H, width, EDGE, stops[stops.length - 1]!);

  // Moon with craters and a halo.
  g.circle(500, 42, 30).fill({ color: 0xfff3d6, alpha: 0.08 });
  g.circle(500, 42, 20).fill({ color: 0xfff3d6, alpha: 0.12 });
  g.circle(500, 42, 14).fill(0xfff3d6);
  g.circle(496, 38, 3).fill({ color: 0xe6d7b4, alpha: 0.9 });
  g.circle(505, 46, 2.4).fill({ color: 0xe6d7b4, alpha: 0.9 });
  g.circle(503, 36, 1.6).fill({ color: 0xe6d7b4, alpha: 0.9 });

  // Skylines behind the building, with lit windows, all along the street.
  const base = l.y0 + l.floors * CELL_H + 12;
  const bodyLeft = l.x0 - 30, bodyRight = l.x0 + l.perFloor * CELL_W + 30;
  for (let x = left, n = 0; x < left + width; n++) {
    const w = 34 + Math.floor(hash(n, 21) * 26);
    const h = 90 + Math.floor(hash(n, 22) * 150);
    if (x + w > bodyLeft && x < bodyRight) {
      x += w + 4;
      continue;
    }
    const color = [0x2a1a63, 0x261758, 0x2c1c68][n % 3]!;
    rect(g, x, base - h, w, h, color);
    rect(g, x, base - h, w, 3, lighten(color, 0.1));
    if (hash(n, 23) > 0.6) rect(g, x + w / 2 - 1, base - h - 14, 2, 14, color);
    for (let wy = base - h + 10; wy < base - 12; wy += 14) {
      for (let wx = x + 6; wx < x + w - 8; wx += 11) {
        const r = hash(wx * 31 + wy, n);
        if (r < 0.38) rect(g, wx, wy, 5, 7, r < 0.12 ? 0xffe9a8 : 0xffc857, 0.7);
      }
    }
    x += w + 4;
  }

  // Street: sidewalk, curb, asphalt, lane marks.
  const sy = l.y0 + l.floors * CELL_H + HALL_H;
  rect(g, left, sy - 8, width, 8, 0x4a3f7a);
  rect(g, left, sy - 8, width, 2, 0x6c61a3);
  for (let x = left; x < left + width; x += 24) rect(g, x, sy - 8, 1, 8, 0x3b3366);
  rect(g, left, sy, width, STREET_H + EDGE, 0x1b1530);
  rect(g, left, sy, width, 4, 0x35295a);
  for (let x = left + 12; x < left + width; x += 52) rect(g, x, sy + 24, 26, 4, 0x6c61a3);

  // Lamp posts with their halos, and trees, along the sidewalk.
  for (let lx = -EDGE + 24; lx < W + EDGE; lx += 300) {
    if (lx > bodyLeft - 20 && lx < bodyRight + 20 && lx > 100 && lx < W - 100) continue;
    rect(g, lx - 2, sy - 62, 4, 54, 0x1b1530);
    rect(g, lx - 8, sy - 66, 16, 5, 0x1b1530);
    g.circle(lx, sy - 62, 20).fill({ color: 0xffe9a8, alpha: 0.1 });
    g.circle(lx, sy - 62, 12).fill({ color: 0xffe9a8, alpha: 0.16 });
    g.circle(lx, sy - 60, 5).fill(0xffe9a8);
  }
  for (let tx = -EDGE + 78; tx < W + EDGE; tx += 300) {
    if (tx > bodyLeft - 40 && tx < bodyRight + 40 && tx > 100 && tx < W - 100) continue;
    rect(g, tx - 3, sy - 40, 6, 32, 0x4a3326);
    for (const [dx, dy, r, c] of [[-10, -50, 14, 0x2f7a46], [10, -52, 14, 0x3a8f52], [0, -62, 14, 0x48a65f], [-4, -46, 10, 0x2a6a3e]] as const) {
      g.circle(tx + dx, sy + dy, r).fill(c);
    }
    g.circle(tx - 6, sy - 66, 3).fill({ color: 0x9be8a8, alpha: 0.7 });
  }
}

function drawBody(g: Graphics, l: Layout) {
  g.clear();
  const { x0, y0, floors, perFloor } = l;
  const bw = perFloor * CELL_W;
  const bodyTop = y0 - 10;
  const bodyH = floors * CELL_H + HALL_H + 10;

  // Brick wall of the facade, in two tones of violet with a joint pattern.
  rect(g, x0 - 8, bodyTop, bw + 16, bodyH, 0x32286a);
  for (let y = bodyTop, row = 0; y < bodyTop + bodyH; y += 8, row++) {
    rect(g, x0 - 8, y, bw + 16, 1, 0x241a52);
    for (let x = x0 - 8 + (row & 1) * 8; x < x0 + bw + 8; x += 16) rect(g, x, y, 1, 8, 0x241a52);
    for (let x = x0 - 8; x < x0 + bw + 8; x += 16) {
      const r = hash(x * 3 + y, 11);
      if (r < 0.22) rect(g, x + 1 + (row & 1) * 8, y + 1, 14, 6, 0x3a2f78, 0.7);
    }
  }
  // Pilasters on both sides.
  for (const px of [x0 - 8, x0 + bw]) {
    rect(g, px, bodyTop, 8, bodyH, 0x4a3f7a);
    rect(g, px, bodyTop, 2, bodyH, 0x6c61a3);
    rect(g, px + 6, bodyTop, 2, bodyH, 0x1b1530);
  }

  // Roof: parapet with coping, water tank, chimney, dish.
  rect(g, x0 - 14, y0 - 22, bw + 28, 12, 0x4a3f7a);
  rect(g, x0 - 14, y0 - 22, bw + 28, 3, 0x8a7fc0);
  rect(g, x0 - 14, y0 - 12, bw + 28, 2, 0x1b1530);
  for (let x = x0 - 8; x < x0 + bw + 8; x += 18) rect(g, x, y0 - 18, 6, 6, 0x35295a);
  rect(g, x0 + 22, y0 - 54, 34, 32, 0x6b4a36);
  for (let x = x0 + 26; x < x0 + 56; x += 7) rect(g, x, y0 - 54, 1, 32, 0x4a3326);
  rect(g, x0 + 18, y0 - 58, 42, 6, 0x4a3326);
  rect(g, x0 + 24, y0 - 22, 4, 6, 0x4a3326);
  rect(g, x0 + 52, y0 - 22, 4, 6, 0x4a3326);
  rect(g, x0 + bw - 70, y0 - 44, 16, 22, 0x6c4a42);
  rect(g, x0 + bw - 72, y0 - 48, 20, 5, 0x4a3326);
  g.circle(x0 + bw - 110, y0 - 36, 12).fill(0xd8d2ee);
  g.circle(x0 + bw - 110, y0 - 36, 8).fill(0x9a92c8);
  rect(g, x0 + bw - 112, y0 - 36, 3, 14, 0x8a7fc0);

  // Ledges and railings between the floors.
  for (let f = 0; f <= floors; f++) {
    const y = y0 + f * CELL_H;
    rect(g, x0, y - 3, bw, 6, 0x1b1530);
    rect(g, x0, y - 2, bw, 2, 0x6c61a3);
  }
  for (let s = 0; s <= perFloor; s++) rect(g, x0 + s * CELL_W - 2, y0, 4, floors * CELL_H, 0x1b1530);
}

function drawHall(g: Graphics, l: Layout) {
  g.clear();
  const h = hallRect(l);
  // Planters and benches on both sides of the door.
  for (const side of [-1, 1]) {
    const px = side < 0 ? h.x - 52 : h.x + h.w + 24;
    rect(g, px, h.y + h.h - 22, 28, 22, 0x6b4a36);
    rect(g, px - 2, h.y + h.h - 24, 32, 4, 0x8a5e3c);
    for (const [dx, dy, r, c] of [[6, -34, 8, 0x3f9b4b], [16, -38, 9, 0x4fb35a], [24, -32, 7, 0x5fc46a]] as const) {
      g.circle(px + dx, h.y + h.h + dy + 12, r).fill(c);
    }
  }
  // The door: frame, glass, a handle on each leaf, a lit sign under a striped awning.
  rect(g, h.x - 8, h.y - 8, h.w + 16, h.h + 8, 0x4a3f7a);
  rect(g, h.x - 8, h.y - 8, 3, h.h + 8, 0x6c61a3);
  rect(g, h.x, h.y + 26, h.w, h.h - 26, 0x9fd3f0);
  rect(g, h.x, h.y + 26, h.w, 8, lighten(0x9fd3f0, 0.4));
  rect(g, h.x + h.w / 2 - 2, h.y + 26, 4, h.h - 26, 0x4a3f7a);
  rect(g, h.x + h.w / 2 - 12, h.y + 46, 3, 14, 0xffc857);
  rect(g, h.x + h.w / 2 + 9, h.y + 46, 3, 14, 0xffc857);
  rect(g, h.x + 6, h.y + h.h - 6, h.w - 12, 4, 0x2a2140);
  rect(g, h.x + 30, h.y + 4, h.w - 60, 20, 0x1b1530);
  rect(g, h.x + 30, h.y + 4, h.w - 60, 2, 0x35295a);
  const stripe = (h.w + 16) / 14;
  for (let k = 0; k < 14; k++) rect(g, h.x - 8 + k * stripe, h.y - 14, stripe + 0.5, 10, k % 2 ? 0xfff3d6 : 0xe2483d);
  rect(g, h.x - 8, h.y - 4, h.w + 16, 2, 0x8a2a2a);
}

// ----- One apartment, seen from the street ----------------------------------------------

function drawApartment(g: Graphics, a: BuildingApartment, r: { x: number; y: number; w: number; h: number }) {
  if (!a.owner) {
    // Free: dark, waiting for a neighbour, with a small for-rent board.
    rect(g, r.x, r.y, r.w, r.h, 0x211a40);
    rect(g, r.x + r.w - 36, r.y + 10, 26, 28, 0x171230);
    rect(g, r.x + r.w - 36, r.y + 10, 26, 2, 0x35295a);
    rect(g, r.x + 12, r.y + r.h - 30, 34, 18, 0x4a3f7a);
    rect(g, r.x + 14, r.y + r.h - 28, 30, 14, 0x6c5a2a);
    for (let k = 0; k < 4; k++) rect(g, r.x + 18 + k * 6, r.y + r.h - 24, 3, 6, 0xffc857, 0.8);
    rect(g, r.x + 28, r.y + r.h - 12, 2, 12, 0x4a3f7a);
    return;
  }
  const wall = wallStyle(a.wall);
  const floor = floorStyle(a.floorStyle);
  const floorH = 15;
  const wallH = r.h - floorH;

  // Wall with its light from the window and a shadow under the ceiling.
  rect(g, r.x, r.y, r.w, wallH, wall.left);
  rect(g, r.x + r.w / 2, r.y, r.w / 2, wallH, wall.right, 0.55);
  rect(g, r.x, r.y, r.w, 5, 0x000000, 0.22);
  rect(g, r.x, r.y + 5, r.w, 3, 0x000000, 0.1);
  switch (wall.pattern) {
    case 'stripes':
      for (let x = 0; x < r.w; x += 12) rect(g, r.x + x, r.y, 6, wallH, 0xffffff, 0.1);
      break;
    case 'dots':
      for (let y = 12; y < wallH; y += 12) for (let x = 6 + ((y / 12) & 1) * 6; x < r.w; x += 12) g.circle(r.x + x, r.y + y, 1.6).fill({ color: 0xffffff, alpha: 0.28 });
      break;
    case 'damask':
      for (let y = 12; y < wallH; y += 16) {
        for (let x = 8 + ((y / 16) & 1) * 8; x < r.w; x += 16) g.poly([r.x + x, r.y + y - 4, r.x + x + 3, r.y + y, r.x + x, r.y + y + 4, r.x + x - 3, r.y + y]).fill({ color: 0xffffff, alpha: 0.16 });
      }
      break;
    case 'panels':
      rect(g, r.x, r.y + wallH - 18, r.w, 18, 0x000000, 0.12);
      rect(g, r.x, r.y + wallH - 19, r.w, 2, 0xffffff, 0.3);
      break;
    case 'brick':
      for (let y = 0; y < wallH; y += 6) rect(g, r.x, r.y + y, r.w, 1, 0x000000, 0.16);
      break;
    case 'leaves':
      for (let k = 0; k < 14; k++) g.ellipse(r.x + 6 + hash(k, a.id) * (r.w - 12), r.y + 10 + hash(k, a.id + 5) * (wallH - 14), 3, 1.6).fill({ color: 0xffffff, alpha: 0.2 });
      break;
    case 'stars':
      for (let k = 0; k < 16; k++) rect(g, r.x + 4 + hash(k, a.id) * (r.w - 8), r.y + 8 + hash(k, a.id + 5) * (wallH - 12), 2, 2, 0xfff3d6, 0.7);
      break;
    default:
      break;
  }

  // Floor with planks, and the skirting board.
  for (let x = 0; x < r.w; x += 12) rect(g, r.x + x, r.y + wallH, Math.min(12, r.w - x), floorH, (x / 12) & 1 ? floor.b : floor.a);
  for (let x = 0; x < r.w; x += 12) rect(g, r.x + x, r.y + wallH, 1, floorH, floor.line, 0.45);
  rect(g, r.x, r.y + wallH - 3, r.w, 3, lighten(wall.trim, 0.1));
  rect(g, r.x, r.y + wallH, r.w, 2, 0x000000, 0.22);

  // The window on the right, with curtains and a warm glow.
  const wx = r.x + r.w - 36, wy = r.y + 10;
  g.circle(wx + 13, wy + 14, 26).fill({ color: 0xffe9a8, alpha: 0.12 });
  rect(g, wx - 2, wy - 2, 30, 34, 0x4a3326);
  rect(g, wx, wy, 26, 30, 0x74b9f2);
  rect(g, wx, wy + 16, 26, 14, 0xcfe9ff);
  rect(g, wx + 12, wy, 2, 30, 0x4a3326);
  rect(g, wx, wy + 14, 26, 2, 0x4a3326);
  rect(g, wx - 4, wy - 2, 6, 34, 0xf27ea6);
  rect(g, wx + 24, wy - 2, 6, 34, 0xf27ea6);
  rect(g, wx - 3, wy - 2, 1, 34, 0xffb3cb);
  rect(g, wx + 27, wy - 2, 1, 34, 0xc9547a);
  rect(g, wx - 4, wy + 31, 34, 3, 0xf4efe6);

  // Two pieces of furniture, picked from the apartment's number.
  const picks = [Math.floor(hash(a.id) * 5), (Math.floor(hash(a.id, 3) * 4) + 1 + Math.floor(hash(a.id) * 5)) % 5];
  const slots = [r.x + 8, r.x + 44];
  picks.forEach((pick, k) => {
    const fx = slots[k]!;
    const fy = r.y + wallH; // floor line
    switch (pick) {
      case 0: // standing lamp with a glow
        g.circle(fx + 8, fy - 30, 16).fill({ color: 0xffd870, alpha: 0.16 });
        rect(g, fx + 7, fy - 28, 2, 28, 0x2a2140);
        rect(g, fx + 2, fy - 36, 12, 9, 0xffd870);
        rect(g, fx + 2, fy - 36, 12, 2, 0xfff3d6);
        rect(g, fx + 4, fy - 2, 8, 2, 0x2a2140);
        break;
      case 1: // plant
        rect(g, fx + 2, fy - 10, 12, 10, 0xd9774a);
        rect(g, fx + 1, fy - 12, 14, 3, 0xe8895a);
        g.circle(fx + 5, fy - 18, 5).fill(0x3f9b4b);
        g.circle(fx + 11, fy - 20, 6).fill(0x4fb35a);
        g.circle(fx + 8, fy - 25, 4).fill(0x6fcf6a);
        break;
      case 2: // bed
        rect(g, fx, fy - 16, 38, 6, 0x6e4a2c);
        rect(g, fx, fy - 22, 4, 22, 0x6e4a2c);
        rect(g, fx + 4, fy - 20, 34, 6, 0xf4efe6);
        rect(g, fx + 14, fy - 20, 24, 6, 0xe2483d);
        rect(g, fx + 5, fy - 23, 10, 4, 0xfff3d6);
        rect(g, fx + 36, fy - 10, 3, 10, 0x6e4a2c);
        break;
      case 3: // bookshelf
        rect(g, fx, fy - 34, 22, 34, 0x8b5e3c);
        rect(g, fx + 2, fy - 32, 18, 30, 0x4a3326);
        for (let sh = 0; sh < 3; sh++) {
          rect(g, fx + 2, fy - 22 + sh * -10 + 20 - 10, 18, 2, 0x8b5e3c);
          for (let b = 0; b < 5; b++) rect(g, fx + 3 + b * 3.4, fy - 31 + sh * 10, 3, 8, [0xe2483d, 0x4a8fe2, 0xffc857, 0x5fc46a, 0xb36bd6][(b + sh) % 5]!);
        }
        break;
      default: // framed picture and a small sofa
        rect(g, fx + 2, fy - 36, 22, 16, 0xe0a030);
        rect(g, fx + 4, fy - 34, 18, 12, 0x8ec0f5);
        rect(g, fx + 4, fy - 28, 18, 6, 0x4fb35a);
        rect(g, fx, fy - 12, 28, 12, 0x4a8fe2);
        rect(g, fx, fy - 18, 28, 7, 0x3f78c4);
        rect(g, fx + 3, fy - 17, 8, 5, 0x6aa6ee);
        break;
    }
  });

  if (!a.open && !a.mine) {
    // Closed to this player: shaded, with a padlock.
    rect(g, r.x, r.y, r.w, r.h, 0x1a1046, 0.6);
    const lx = r.x + r.w / 2 - 8, ly = r.y + r.h / 2 - 6;
    rect(g, lx, ly + 8, 16, 12, 0xffc857);
    rect(g, lx, ly + 8, 16, 2, lighten(0xffc857, 0.5));
    rect(g, lx + 3, ly, 3, 10, 0xffc857);
    rect(g, lx + 10, ly, 3, 10, 0xffc857);
    rect(g, lx + 3, ly - 2, 10, 3, 0xffc857);
    rect(g, lx + 7, ly + 12, 2, 4, 0x4a3326);
  }
  if (a.mine) {
    for (const [x, y, w, h] of [[r.x - 3, r.y - 3, r.w + 6, 3], [r.x - 3, r.y + r.h, r.w + 6, 3], [r.x - 3, r.y, 3, r.h], [r.x + r.w, r.y, 3, r.h]] as const) {
      rect(g, x, y, w, h, 0xffc857);
    }
  }
}

export async function createBuildingScene(host: SceneHost): Promise<Scene | { error: string }> {
  const { app } = host;
  const first = await api.building();
  if (!first.ok) {
    if (first.status === 401) location.reload();
    return { error: first.error };
  }
  let apartments = first.data.apartments;
  let layout = layoutFor(apartments);

  const abort = new AbortController();
  const world = new Container();
  host.stage.addChild(world);

  const sky = new Graphics();
  const body = new Graphics();
  const cells = new Graphics();
  const hall = new Graphics();
  const live = new Graphics();
  const highlight = new Graphics();
  const labels = new Container();
  const hallSign = new Text({
    text: 'HALL',
    style: { fontFamily: FONT, fontSize: 16, fill: 0xffc857 },
    resolution: 2,
  });
  hallSign.anchor.set(0.5, 0);
  world.addChild(sky, body, cells, hall, live, highlight, labels, hallSign);

  // Fixed stars, so the sky does not flicker on every redraw.
  const stars = Array.from({ length: 220 }, (_, k) => ({
    x: ((k * 97 + 13) % (W + 2 * 700)) - 700,
    y: ((k * 53 + 7) % 560) - 300,
    phase: k * 1.7,
    big: k % 7 === 0,
  }));

  /** Everything that does not move: redrawn only when the building's data changes. */
  function drawStatic() {
    drawSky(sky, layout);
    drawBody(body, layout);
    cells.clear();
    for (const a of apartments) drawApartment(cells, a, cellRect(layout, a));
    drawHall(hall, layout);
    const h = hallRect(layout);
    hallSign.position.set(h.x + h.w / 2, h.y + 7);
  }

  /** Stars, clouds, smoke, the car in the street, the people in their apartments. */
  function drawLive(now: number) {
    live.clear();
    for (const s of stars) {
      const twinkle = 0.5 + 0.5 * Math.sin(now / 600 + s.phase);
      rect(live, s.x, s.y, s.big ? 3 : 2, s.big ? 3 : 2, 0xfff3d6, 0.3 + 0.6 * twinkle);
    }
    for (const [k, y] of [[0, 90], [1, 150], [2, 40]] as const) {
      const speed = 380 + k * 160;
      const x = ((now / speed + k * 230) % (W + 1600)) - 800;
      live.ellipse(x, y, 40, 9).fill({ color: 0xe9d6ff, alpha: 0.12 });
      live.ellipse(x + 22, y - 6, 26, 8).fill({ color: 0xe9d6ff, alpha: 0.12 });
    }
    const { x0, y0, floors, perFloor } = layout;
    const bw = perFloor * CELL_W;
    // The antenna's light blinks, and smoke rises from the chimney.
    rect(live, x0 + bw - 30, y0 - 46, 3, 24, 0x1b1530);
    live.circle(x0 + bw - 28, y0 - 48, 4).fill(Math.sin(now / 500) > 0 ? 0xff5a5a : 0x7a2a3a);
    for (let k = 0; k < 4; k++) {
      const t = ((now / 2600 + k / 4) % 1);
      live.circle(x0 + bw - 62 + Math.sin(t * 6 + k) * 6 + t * 14, y0 - 50 - t * 44, 4 + t * 8).fill({ color: 0xd8d2ee, alpha: 0.35 * (1 - t) });
    }
    // A car now and then crosses the street.
    const sy = y0 + floors * CELL_H + HALL_H;
    const cycle = (now / 1000) % 22;
    if (cycle < 9) {
      const cx = -60 + (cycle / 9) * (W + 120);
      const cy = sy + 30;
      live.ellipse(cx + 30, cy + 15, 34, 4).fill({ color: 0x000000, alpha: 0.35 });
      rect(live, cx, cy - 4, 60, 14, 0xe2483d);
      rect(live, cx + 14, cy - 14, 32, 12, 0xc93a30);
      rect(live, cx + 18, cy - 12, 10, 8, 0x9fd3f0);
      rect(live, cx + 30, cy - 12, 12, 8, 0x9fd3f0);
      live.circle(cx + 14, cy + 11, 6).fill(0x1b1530);
      live.circle(cx + 46, cy + 11, 6).fill(0x1b1530);
      live.circle(cx + 14, cy + 11, 2.4).fill(0xb4acd8);
      live.circle(cx + 46, cy + 11, 2.4).fill(0xb4acd8);
      rect(live, cx + 58, cy, 4, 5, 0xffe9a8);
      live.poly([cx + 62, cy - 1, cx + 100, cy - 8, cx + 100, cy + 12, cx + 62, cy + 6]).fill({ color: 0xffe9a8, alpha: 0.14 });
    }
    // People at home: shadows of residents, swaying a little.
    for (const a of apartments) {
      if (!a.owner || a.visitors <= 0) continue;
      const r = cellRect(layout, a);
      const count = Math.min(3, a.visitors);
      for (let k = 0; k < count; k++) {
        const sway = Math.sin(now / 700 + k * 2 + a.id) * 2;
        const fx = r.x + 26 + k * 20 + sway;
        const fy = r.y + r.h - 12;
        live.ellipse(fx, fy + 1, 7, 2).fill({ color: 0x000000, alpha: 0.3 });
        live.circle(fx, fy - 21, 5.6).fill({ color: 0x1b1530, alpha: 0.86 });
        live.roundRect(fx - 7, fy - 16, 14, 14, 5).fill({ color: 0x1b1530, alpha: 0.86 });
        live.rect(fx - 5, fy - 4, 4, 5).fill({ color: 0x1b1530, alpha: 0.86 });
        live.rect(fx + 1, fy - 4, 4, 5).fill({ color: 0x1b1530, alpha: 0.86 });
      }
    }
  }

  function rebuildLabels() {
    labels.removeChildren().forEach((c) => c.destroy());
    for (const a of apartments) {
      if (!a.owner) continue;
      const r = cellRect(layout, a);
      const name = shortName(a.owner.nickname);
      const plate = new Graphics();
      plate.roundRect(r.x + 3, r.y + 3, name.length * 8 + 8, 14, 3).fill({ color: 0x1b1530, alpha: 0.72 });
      labels.addChild(plate);
      const t = new Text({
        text: name,
        style: { fontFamily: FONT, fontSize: 8, fill: a.mine ? 0xffc857 : 0xffffff },
        resolution: 2,
      });
      t.position.set(r.x + 7, r.y + 7);
      labels.addChild(t);
    }
  }

  // ----- Panel -------------------------------------------------------------
  const panel = document.createElement('aside');
  panel.className = 'panel building-panel';
  const title = document.createElement('h2');
  title.textContent = 'L’immeuble';
  const intro = document.createElement('p');
  intro.className = 'muted small';
  intro.textContent = 'Clique sur un appartement éclairé pour y entrer, ou sur un appart à sonnette pour sonner. Les silhouettes montrent qui est chez soi.';
  const legend = document.createElement('ul');
  legend.className = 'legend';
  for (const [swatch, text] of [
    ['mine', 'Ton appart'],
    ['open', 'Ouvert aux visiteurs'],
    ['closed', 'Fermé'],
    ['empty', 'Libre'],
  ] as const) {
    const li = document.createElement('li');
    const dot = document.createElement('span');
    dot.className = `swatch ${swatch}`;
    li.append(dot, text);
    legend.append(li);
  }
  const summary = document.createElement('p');
  summary.className = 'present small';
  summary.setAttribute('role', 'status');
  const buttons = document.createElement('div');
  buttons.className = 'visit-links';
  const goHome = document.createElement('button');
  goHome.type = 'button';
  goHome.className = 'primary';
  goHome.textContent = 'Mon appart';
  goHome.addEventListener('click', () => host.go({ kind: 'apartment', ownerId: host.user.id }));
  const goHall = document.createElement('button');
  goHall.type = 'button';
  goHall.textContent = 'Le hall';
  goHall.addEventListener('click', () => host.go({ kind: 'hall' }));
  buttons.append(goHome, goHall);
  panel.append(title, intro, legend, summary, buttons);

  const updateSummary = () => {
    const inside = apartments.reduce((n, a) => n + a.visitors, 0);
    const taken = apartments.filter((a) => a.owner).length;
    summary.textContent = `${taken}/${apartments.length} appartements habités · ${inside} ${inside > 1 ? 'personnes chez elles' : 'personne chez elle'}`;
  };

  // ----- Pointer -----------------------------------------------------------
  const tooltip = document.createElement('div');
  tooltip.className = 'tooltip';
  tooltip.hidden = true;
  document.body.append(tooltip);

  type Hit = { kind: 'apartment'; apartment: BuildingApartment } | { kind: 'hall' } | null;
  const toGame = (ev: PointerEvent | MouseEvent) => host.pointer(ev);
  const hit = (x: number, y: number): Hit => {
    const h = hallRect(layout);
    if (x >= h.x - 8 && x <= h.x + h.w + 8 && y >= h.y - 14 && y <= h.y + h.h) return { kind: 'hall' };
    for (const a of apartments) {
      const r = cellRect(layout, a);
      if (x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h) return { kind: 'apartment', apartment: a };
    }
    return null;
  };
  let hovered: Hit = null;

  app.canvas.addEventListener(
    'pointermove',
    (ev) => {
      const p = toGame(ev);
      hovered = hit(p.x, p.y);
      app.canvas.style.cursor = hovered && (hovered.kind === 'hall' || hovered.apartment.owner) ? 'pointer' : 'default';
      if (!hovered) {
        tooltip.hidden = true;
        return;
      }
      tooltip.textContent = hovered.kind === 'hall' ? 'Le hall · rez-de-chaussée' : statusText(hovered.apartment);
      tooltip.style.left = `${ev.clientX + 14}px`;
      tooltip.style.top = `${ev.clientY + 14}px`;
      tooltip.hidden = false;
    },
    { signal: abort.signal },
  );
  app.canvas.addEventListener(
    'pointerleave',
    () => {
      hovered = null;
      tooltip.hidden = true;
    },
    { signal: abort.signal },
  );
  app.canvas.addEventListener(
    'click',
    (ev) => {
      const p = toGame(ev);
      const target = hit(p.x, p.y);
      if (!target) return;
      if (target.kind === 'hall') return host.go({ kind: 'hall' });
      const a = target.apartment;
      if (!a.owner) return host.notify('Cet appartement est libre : un nouveau voisin arrivera bientôt.');
      if (a.mine || a.open) return host.go({ kind: 'apartment', ownerId: a.owner.id });
      if (a.canRing) return void ringAndWait(host, a.owner.id, a.owner.nickname);
      host.notify(`L’appartement de ${a.owner.nickname} est fermé.`);
    },
    { signal: abort.signal },
  );

  // ----- Refresh and frame loop --------------------------------------------
  const apply = (next: BuildingApartment[]) => {
    apartments = next;
    layout = layoutFor(next);
    drawStatic();
    rebuildLabels();
    updateSummary();
  };
  apply(apartments);

  const timer = setInterval(async () => {
    const res = await api.building();
    if (res.ok) apply(res.data.apartments);
  }, REFRESH_MS);

  const tick = (_ticker: Ticker) => {
    const now = performance.now();
    drawLive(now);
    highlight.clear();
    if (hovered) {
      const r = hovered.kind === 'hall' ? hallRect(layout) : cellRect(layout, hovered.apartment);
      highlight.rect(r.x, r.y, r.w, r.h).stroke({ color: 0xffffff, width: 3, alpha: 0.9 });
    }
  };
  app.ticker.add(tick);

  return {
    panel,
    get size() {
      return { w: W, h: layout.height };
    },
    destroy() {
      abort.abort();
      clearInterval(timer);
      app.ticker.remove(tick);
      tooltip.remove();
      app.canvas.style.cursor = 'default';
      world.destroy({ children: true });
    },
  };
}
