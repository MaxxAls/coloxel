// Room screen geometry. Grid and pathfinding live in @coloxel/world, shared with the server.

import { N } from '@coloxel/world';

export { N };
// Rooms are drawn at twice the old resolution: one cell is 64 x 32 px on the canvas.
export const TW = 64;
export const TH = 32;
export const OX = 300;
export const OY = 148;
/** Height of the side walls, and the size of the room canvas. */
export const WALL_H = 116;
export const ROOM_W = 600;
export const ROOM_H = 400;

/** Screen position of the center of a tile. */
export function tileCenter(i: number, j: number): { x: number; y: number } {
  return { x: OX + (i - j) * (TW / 2), y: OY + (i + j) * (TH / 2) };
}

/** Tile under a screen point, or null outside the grid. */
export function tileAt(x: number, y: number): { i: number; j: number } | null {
  const a = (x - OX) / (TW / 2);
  const b = (y - OY) / (TH / 2);
  const i = Math.round((a + b) / 2);
  const j = Math.round((b - a) / 2);
  return i >= 0 && j >= 0 && i < N && j < N ? { i, j } : null;
}
