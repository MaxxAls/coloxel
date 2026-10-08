// Room grid and pathfinding. Pure logic shared by the client (prediction, hover)
// and the server (authoritative movement), so both agree on what a path is.

import { N, inGrid } from './grid';

export { N, inGrid } from './grid';

export * from './layout';

export interface Cell {
  i: number;
  j: number;
}

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
 *
 * Among the shortest paths it takes the one the classic isometric games take: each step goes to the cell nearest the
 * target as the crow flies, so the path runs diagonally while it can and then straight along the floor's axis. The
 * last step is then most often straight, and a player who arrives stands turned along the floor (three quarters),
 * not facing the screen.
 */
export function findPath(
  from: Cell,
  to: Cell,
  blocked: (i: number, j: number) => boolean,
  /** Optional rule for a step between neighbours (levels of the floor), on top of `blocked`. */
  canStep?: (a: Cell, b: Cell) => boolean,
): Cell[] {
  if (!inGrid(to.i, to.j) || blocked(to.i, to.j)) return [];
  if (from.i === to.i && from.j === to.j) return [];
  const key = (c: Cell) => c.i * N + c.j;
  /** May a player walk from `cur` one step of (di, dj)? */
  const ok = (cur: Cell, di: number, dj: number): boolean => {
    const next = { i: cur.i + di, j: cur.j + dj };
    if (!inGrid(next.i, next.j) || blocked(next.i, next.j)) return false;
    if (canStep && !canStep(cur, next)) return false;
    if (di !== 0 && dj !== 0) {
      if (blocked(cur.i + di, cur.j) || blocked(cur.i, cur.j + dj)) return false;
      if (canStep && (!canStep(cur, { i: cur.i + di, j: cur.j }) || !canStep(cur, { i: cur.i, j: cur.j + dj }))) return false;
    }
    return true;
  };

  // Steps left to the target from every cell that can reach it, counted backwards from the target.
  const dist = new Map<number, number>([[key(to), 0]]);
  const queue: Cell[] = [to];
  for (let head = 0; head < queue.length && !dist.has(key(from)); head++) {
    const cur = queue[head]!;
    for (const [di, dj] of STEPS) {
      const back = { i: cur.i - di, j: cur.j - dj };
      if (!inGrid(back.i, back.j) || dist.has(key(back))) continue;
      // The player's own cell counts as free: they are standing on it.
      const isStart = back.i === from.i && back.j === from.j;
      if (!isStart && blocked(back.i, back.j)) continue;
      if (!ok(back, di, dj)) continue;
      dist.set(key(back), dist.get(key(cur))! + 1);
      queue.push(back);
    }
  }
  if (!dist.has(key(from))) return [];

  // Walk it from the start: of the steps that keep the path shortest, the one that ends nearest the target as the
  // crow flies (the classic games' heuristic), a diagonal one on a tie.
  const path: Cell[] = [];
  let cur = from;
  while (cur.i !== to.i || cur.j !== to.j) {
    const left = dist.get(key(cur))!;
    let next: Cell | null = null;
    let best = Infinity;
    for (const [di, dj] of DIAGONALS_FIRST) {
      const c = { i: cur.i + di, j: cur.j + dj };
      if (dist.get(key(c)) !== left - 1 || !ok(cur, di, dj)) continue;
      const d2 = (to.i - c.i) ** 2 + (to.j - c.j) ** 2;
      if (d2 < best) {
        best = d2;
        next = c;
      }
    }
    if (!next) return [];
    path.push(next);
    cur = next;
  }
  return path;
}

/** The eight steps, the diagonal ones first: see findPath. */
const DIAGONALS_FIRST: readonly [number, number][] = [...STEPS.slice(4), ...STEPS.slice(0, 4)];
