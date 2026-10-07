import { Graphics } from 'pixi.js';
import { N, OX, OY, TH, TW, tileCenter } from './room';

export function diamond(g: Graphics, cx: number, cy: number, hw: number, hh: number) {
  g.poly([cx, cy - hh, cx + hw, cy, cx, cy + hh, cx - hw, cy]);
}

export interface RoomTheme {
  wallLeft: number;
  wallRight: number;
  trim: number;
  floorA: number;
  floorB: number;
  floorLine: number;
  /** What hangs on the walls: a sunny window or the big hall doors. */
  decor: 'apartment' | 'hall';
}

export const APARTMENT_THEME: RoomTheme = {
  wallLeft: 0x8a7fc0,
  wallRight: 0x6c61a3,
  trim: 0xe9e0ff,
  floorA: 0xb88b56,
  floorB: 0xc79a62,
  floorLine: 0x8f6a3e,
  decor: 'apartment',
};

export const HALL_THEME: RoomTheme = {
  wallLeft: 0x6fa8c9,
  wallRight: 0x5a8fb3,
  trim: 0xfff3d6,
  floorA: 0xd8d2ee,
  floorB: 0xc3bbe0,
  floorLine: 0xa79fcb,
  decor: 'hall',
};

const L = (N * TW) / 2;
const WALL_H = 58;
const TOP_Y = OY - TH / 2;

/** Height of the left wall's bottom edge at screen x. */
const leftBottom = (x: number) => TOP_Y + (OX - x) / 2;
/** Height of the right wall's bottom edge at screen x. */
const rightBottom = (x: number) => TOP_Y + (x - OX) / 2;

function wallQuad(g: Graphics, side: 'left' | 'right', x0: number, x1: number, h0: number, h1: number, lift = 0) {
  const bottom = side === 'left' ? leftBottom : rightBottom;
  g.poly([x0, bottom(x0) - h1 - lift, x1, bottom(x1) - h1 - lift, x1, bottom(x1) - h0 - lift, x0, bottom(x0) - h0 - lift]);
}

export function drawRoom(theme: RoomTheme): Graphics {
  const g = new Graphics();

  // Walls, with a light cornice on top, a skirting board and a shadowed corner.
  g.poly([OX - L, TOP_Y + L / 2, OX, TOP_Y, OX, TOP_Y - WALL_H, OX - L, TOP_Y + L / 2 - WALL_H]).fill(theme.wallLeft);
  g.poly([OX, TOP_Y, OX + L, TOP_Y + L / 2, OX + L, TOP_Y + L / 2 - WALL_H, OX, TOP_Y - WALL_H]).fill(theme.wallRight);
  wallQuad(g, 'left', OX - L, OX, WALL_H - 3, WALL_H);
  g.fill({ color: theme.trim, alpha: 0.9 });
  wallQuad(g, 'right', OX, OX + L, WALL_H - 3, WALL_H);
  g.fill({ color: theme.trim, alpha: 0.65 });
  wallQuad(g, 'left', OX - L, OX, 0, 5);
  g.fill({ color: 0x000000, alpha: 0.22 });
  wallQuad(g, 'right', OX, OX + L, 0, 5);
  g.fill({ color: 0x000000, alpha: 0.32 });
  g.rect(OX - 1, TOP_Y - WALL_H, 2, WALL_H).fill({ color: 0x000000, alpha: 0.18 });

  // Floor tiles with a thin joint.
  for (let i = 0; i < N; i++) {
    for (let j = 0; j < N; j++) {
      const { x, y } = tileCenter(i, j);
      diamond(g, x, y, TW / 2, TH / 2);
      g.fill((i + j) % 2 ? theme.floorB : theme.floorA);
      diamond(g, x, y, TW / 2, TH / 2);
      g.stroke({ color: theme.floorLine, width: 1, alpha: 0.35 });
    }
  }

  if (theme.decor === 'apartment') drawApartmentDecor(g);
  else drawHallDecor(g);
  return g;
}

function drawApartmentDecor(g: Graphics) {
  // Window on the right wall: frame, sky, cross bars, curtains.
  const wx0 = OX + 44;
  const wx1 = wx0 + 34;
  wallQuad(g, 'right', wx0 - 2, wx1 + 2, 18, 52);
  g.fill(0x4a3f7a);
  wallQuad(g, 'right', wx0, wx1, 20, 50);
  g.fill(0x9fd3f0);
  wallQuad(g, 'right', wx0, wx1, 34, 50);
  g.fill({ color: 0xffffff, alpha: 0.35 });
  wallQuad(g, 'right', (wx0 + wx1) / 2 - 1, (wx0 + wx1) / 2 + 1, 20, 50);
  g.fill(0x4a3f7a);
  wallQuad(g, 'right', wx0, wx1, 33, 35);
  g.fill(0x4a3f7a);
  wallQuad(g, 'right', wx0 - 5, wx0 + 4, 16, 54);
  g.fill(0xff8fb1);
  wallQuad(g, 'right', wx1 - 4, wx1 + 5, 16, 54);
  g.fill(0xff8fb1);
  // A patch of sunlight on the floor, under the window.
  const sun: [number, number][] = [
    [3, 0], [4, 0], [5, 3], [4, 3],
  ];
  g.poly(sun.flatMap(([i, j]) => {
    const { x, y } = tileCenter(i, j);
    return [x, y];
  })).fill({ color: 0xfff2b0, alpha: 0.14 });

  // Door on the left wall.
  const dx0 = OX - 96;
  const dx1 = OX - 66;
  wallQuad(g, 'left', dx0 - 3, dx1 + 3, 0, 48);
  g.fill(0x4a3f7a);
  wallQuad(g, 'left', dx0, dx1, 0, 45);
  g.fill(0xd9a05b);
  wallQuad(g, 'left', dx0 + 3, dx1 - 3, 4, 41);
  g.fill({ color: 0xffffff, alpha: 0.12 });
  g.circle(dx1 - 5, leftBottom(dx1 - 5) - 22, 1.6).fill(0xffc857);
}

function drawHallDecor(g: Graphics) {
  // A red carpet down the middle of the floor.
  for (let i = 1; i < N - 1; i++) {
    for (let j = 3; j <= 4; j++) {
      const { x, y } = tileCenter(i, j);
      diamond(g, x, y, TW / 2, TH / 2);
      g.fill(i === 1 || i === N - 2 ? 0xa83a52 : 0xc0445a);
    }
  }
  // Big double door on the right wall, with a lit sign above.
  const dx0 = OX + 38;
  const dx1 = OX + 86;
  wallQuad(g, 'right', dx0 - 4, dx1 + 4, 0, 52);
  g.fill(0x35508c);
  wallQuad(g, 'right', dx0, dx1, 0, 48);
  g.fill(0x9fd3f0);
  wallQuad(g, 'right', (dx0 + dx1) / 2 - 1, (dx0 + dx1) / 2 + 1, 0, 48);
  g.fill(0x35508c);
  wallQuad(g, 'right', dx0, dx1, 20, 22);
  g.fill({ color: 0x35508c, alpha: 0.7 });
  wallQuad(g, 'right', dx0 - 6, dx1 + 6, 52, 58);
  g.fill(0xffc857);
  // Pillar on the left wall.
  wallQuad(g, 'left', OX - 70, OX - 56, 0, 58);
  g.fill({ color: 0xfff3d6, alpha: 0.8 });
}
