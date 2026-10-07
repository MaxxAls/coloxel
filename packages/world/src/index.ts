// Room grid and pathfinding. Pure logic shared by the client (prediction, hover)
// and the server (authoritative movement), so both agree on what a path is.

export const N = 8;

export interface Cell {
  i: number;
  j: number;
}

export const inGrid = (i: number, j: number) =>
  Number.isInteger(i) && Number.isInteger(j) && i >= 0 && j >= 0 && i < N && j < N;

/**
 * Eight ways to step. On screen the four axis steps go along the diagonals of the room and the
 * four diagonal steps go straight up, down, left and right: that is what gives an avatar eight
 * directions to face.
 */
const STEPS: readonly [number, number][] = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
  [1, 1],
  [1, -1],
  [-1, 1],
  [-1, -1],
];

/**
 * Shortest 8-directional path (a diagonal step never cuts the corner of a blocked cell) from `from` to `to`, excluding `from`, including `to`.
 * Blocked cells are impassable. Returns [] when the target is unreachable, blocked or equal to `from`.
 */
export function findPath(from: Cell, to: Cell, blocked: (i: number, j: number) => boolean): Cell[] {
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
      if (di !== 0 && dj !== 0 && (blocked(cur.i + di, cur.j) || blocked(cur.i, cur.j + dj))) continue;
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
