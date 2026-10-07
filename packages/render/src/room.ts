// Room screen geometry. Grid and pathfinding live in @coloxel/world, shared with the server.

import { N, levelAt, type RoomLayout } from '@coloxel/world';

export { N };
// Rooms are drawn at twice the old resolution: one cell is 64 x 32 px on the canvas.
export const TW = 64;
export const TH = 32;
export const OX = 300;
export const OY = 148;
/** Height of the side walls, and the size of the room canvas. */
export const WALL_H = 116;
/** How high one level of floor lifts a cell on the screen. */
export const LEVEL_PX = 12;
export const ROOM_W = 600;
export const ROOM_H = 400;

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
