// Room screen geometry. Grid and pathfinding live in @coloxel/world, shared with the server.

import { N, levelAt, type RoomLayout } from '@coloxel/world';

export { N };
// One cell is 64 x 32 px on the canvas, and the game shows the canvas at its real size: the pixels stay crisp.
export const TW = 64;
export const TH = 32;
/** Height of the side walls. */
export const WALL_H = 116;
/** How high one level of floor lifts a cell on the screen. */
export const LEVEL_PX = 12;
/** The room canvas holds the whole grid (N x N cells), its walls and the slab under it, with a small margin. */
export const ROOM_W = N * TW + 32;
export const ROOM_H = N * TH + WALL_H + 72;
/** Where the back corner of the grid (the centre of cell 0, 0) is drawn on the canvas. */
export const OX = ROOM_W / 2;
export const OY = WALL_H + 36;

/** Screen position of the center of a tile; a raised floor (level) lifts it. */
export function tileCenter(i: number, j: number, level = 0): { x: number; y: number } {
  return { x: OX + (i - j) * (TW / 2), y: OY + (i + j) * (TH / 2) - level * LEVEL_PX };
}

/**
 * Tile under a screen point, or null outside the floor. Without a shape every cell is flat; with one, cells
 * without a floor are not hit, and a raised cell is looked for where it is drawn (the one in front wins).
 */
export function tileAt(x: number, y: number, layout?: RoomLayout): { i: number; j: number } | null {
  if (!layout) {
    const a = (x - OX) / (TW / 2);
    const b = (y - OY) / (TH / 2);
    const i = Math.round((a + b) / 2);
    const j = Math.round((b - a) / 2);
    return i >= 0 && j >= 0 && i < N && j < N ? { i, j } : null;
  }
  let best: { i: number; j: number } | null = null;
  for (let i = 0; i < N; i++) {
    for (let j = 0; j < N; j++) {
      const level = levelAt(layout, i, j);
      if (level === null) continue;
      const c = tileCenter(i, j, level);
      // Inside the diamond of this cell, as drawn.
      if (Math.abs(x - c.x) / (TW / 2) + Math.abs(y - c.y) / (TH / 2) > 1) continue;
      if (!best || i + j > best.i + best.j || (i + j === best.i + best.j && i > best.i)) best = { i, j };
    }
  }
  return best;
}

/**
 * The part of the canvas a room actually covers (its floor, its walls and the slab under it), so that the game can
 * centre what there is to see rather than the whole grid.
 */
export function roomBounds(layout: RoomLayout): { x: number; y: number; w: number; h: number } {
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (let i = 0; i < N; i++) {
    for (let j = 0; j < N; j++) {
      if (levelAt(layout, i, j) === null) continue;
      const c = tileCenter(i, j);
      x0 = Math.min(x0, c.x - TW / 2);
      x1 = Math.max(x1, c.x + TW / 2);
      y0 = Math.min(y0, c.y - TH / 2 - WALL_H - 8);
      y1 = Math.max(y1, c.y + TH / 2 + 16);
    }
  }
  if (x0 === Infinity) return { x: 0, y: 0, w: ROOM_W, h: ROOM_H };
  return { x: x0 - 8, y: Math.max(0, y0), w: x1 - x0 + 16, h: Math.min(ROOM_H, y1) - Math.max(0, y0) };
}
