// Room geometry and pathfinding. Pure logic, no DOM and no PixiJS, so it can be tested.

export const N = 8;
export const TW = 32;
export const TH = 16;
export const OX = 150;
export const OY = 80;

export interface Cell {
  i: number;
  j: number;
}

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

const STEPS: readonly [number, number][] = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

/**
 * Shortest 4-directional path from `from` to `to`, excluding `from`, including `to`.
 * Blocked cells are impassable. Returns [] when the target is unreachable, blocked or equal to `from`.
 */
export function findPath(from: Cell, to: Cell, blocked: (i: number, j: number) => boolean): Cell[] {
  const inGrid = (i: number, j: number) => i >= 0 && j >= 0 && i < N && j < N;
  if (!inGrid(to.i, to.j) || blocked(to.i, to.j)) return [];
  const key = (c: Cell) => c.i * N + c.j;
  const prev = new Map<number, Cell | null>([[key(from), null]]);
  const queue: Cell[] = [from];
  for (let head = 0; head < queue.length; head++) {
    const cur = queue[head]!;
    if (cur.i === to.i && cur.j === to.j) break;
    for (const [di, dj] of STEPS) {
      const next = { i: cur.i + di, j: cur.j + dj };
      if (!inGrid(next.i, next.j) || prev.has(key(next)) || blocked(next.i, next.j)) continue;
      prev.set(key(next), cur);
      queue.push(next);
    }
  }
  if (!prev.has(key(to))) return [];
  const path: Cell[] = [];
  for (let c: Cell | null | undefined = to; c && !(c.i === from.i && c.j === from.j); c = prev.get(key(c))) {
    path.unshift(c);
  }
  return path;
}
