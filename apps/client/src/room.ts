// Room screen geometry: shared with the server and the website (packages/render), grid and pathfinding in packages/world.

import { DEFAULT_LAYOUT, levelAt, type RoomLayout } from '@coloxel/world';
import { tileAt as tileAtIn, tileCenter as tileCenterIn } from '@coloxel/render';

export { N, findPath, type Cell } from '@coloxel/world';
export { LEVEL_PX, OX, OY, ROOM_H, ROOM_W, TH, TW, WALL_H } from '@coloxel/render';

// The shape of the room on screen. One room is shown at a time: the scene sets it when it enters a room and
// whenever the owner changes it, and everything that places something on a cell (avatars, furniture, marks, clicks)
// follows the floor's level from here.
let shape: RoomLayout = DEFAULT_LAYOUT;
export const setRoomLayout = (layout: RoomLayout) => {
  shape = layout;
};
export const roomLayout = () => shape;

/** Screen position of a cell's center, on its level. Fractions (effects between two cells) take the nearest cell's level. */
export function tileCenter(i: number, j: number): { x: number; y: number } {
  return tileCenterIn(i, j, levelAt(shape, Math.round(i), Math.round(j)) ?? 0);
}

/** The cell under a screen point: none where there is no floor. */
export const tileAt = (x: number, y: number) => tileAtIn(x, y, shape);
