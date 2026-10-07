// Room screen geometry. Grid and pathfinding live in @coloxel/world, shared with the server.

import { N, type Cell } from '@coloxel/world';

export { N, findPath, type Cell } from '@coloxel/world';
export const TW = 32;
export const TH = 16;
export const OX = 150;
export const OY = 80;

/** Screen position of the center of a tile. */
export function tileCenter(i: number, j: number): { x: number; y: number } {
  return { x: OX + (i - j) * (TW / 2), y: OY + (i + j) * (TH / 2) };
}

/** Tile under a screen point, or null outside the grid. */
export function tileAt(x: number, y: number): Cell | null {
  const a = (x - OX) / (TW / 2);
  const b = (y - OY) / (TH / 2);
  const i = Math.round((a + b) / 2);
  const j = Math.round((b - a) / 2);
  return i >= 0 && j >= 0 && i < N && j < N ? { i, j } : null;
}
