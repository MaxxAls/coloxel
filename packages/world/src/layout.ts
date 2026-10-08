// Shape of a room: which cells have a floor, how high each one is, and where the door is.
// Pure logic shared by the client (drawing, hover) and the server (the only judge of what is valid).

import { N, inGrid, type Cell } from './index';

/** Highest floor level. One level is `LEVEL_PX` px of height on screen. */
export const MAX_LEVEL = 4;
/** Smallest room a player may keep: below this there is no space to live in. */
export const MIN_CELLS = 12;
const VOID = 'x';

/**
 * The shape of a room. `cells` holds N * N characters, row i then column j (the same order as the
 * grid): `x` is no floor, `0` to `4` is the level of the floor. `door` is where players come in.
 */
export interface RoomLayout {
  cells: string;
  door: Cell;
}

/** Level of a cell, or null where there is no floor (or outside the grid). */
export function levelAt(layout: RoomLayout, i: number, j: number): number | null {
  if (!inGrid(i, j)) return null;
  const c = layout.cells[i * N + j];
  return c === undefined || c === VOID ? null : c.charCodeAt(0) - 48;
}

export const hasFloor = (layout: RoomLayout, i: number, j: number) => levelAt(layout, i, j) !== null;

/**
 * Is there a wall behind this cell? The left wall stands behind the first floor cell of a row (nothing with a floor
 * at a smaller i), the right wall behind the first of a column (nothing at a smaller j). Wall pieces hang there.
 */
export function wallBehind(layout: RoomLayout, side: 'left' | 'right', i: number, j: number): boolean {
  if (!hasFloor(layout, i, j)) return false;
  for (let k = (side === 'left' ? i : j) - 1; k >= 0; k--) {
    if (hasFloor(layout, side === 'left' ? k : i, side === 'left' ? j : k)) return false;
  }
  return true;
}

/** A step between two neighbouring cells: both have a floor and they differ by one level at most. */
export function canStep(layout: RoomLayout, from: Cell, to: Cell): boolean {
  const a = levelAt(layout, from.i, from.j);
  const b = levelAt(layout, to.i, to.j);
  return a !== null && b !== null && Math.abs(a - b) <= 1;
}

/** Cells without a floor, as the set of grid keys (i * N + j) that the rooms treat as blocked. */
export function voidKeys(layout: RoomLayout): Set<number> {
  const keys = new Set<number>();
  for (let k = 0; k < N * N; k++) if (layout.cells[k] === VOID) keys.add(k);
  return keys;
}

export function floorCount(layout: RoomLayout): number {
  let n = 0;
  for (let k = 0; k < N * N; k++) if (layout.cells[k] !== VOID) n++;
  return n;
}

const NEIGHBOURS: readonly [number, number][] = [
  [1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1],
];

/** Cells a player can reach from the door, walking the way the server lets them walk. */
export function reachableFromDoor(layout: RoomLayout): Set<number> {
  const seen = new Set<number>();
  if (!hasFloor(layout, layout.door.i, layout.door.j)) return seen;
  const queue: Cell[] = [layout.door];
  seen.add(layout.door.i * N + layout.door.j);
  for (let head = 0; head < queue.length; head++) {
    const cur = queue[head]!;
    for (const [di, dj] of NEIGHBOURS) {
      const next = { i: cur.i + di, j: cur.j + dj };
      if (seen.has(next.i * N + next.j) || !canStep(layout, cur, next)) continue;
      if (di !== 0 && dj !== 0 && (!canStep(layout, cur, { i: cur.i + di, j: cur.j }) || !canStep(layout, cur, { i: cur.i, j: cur.j + dj }))) continue;
      seen.add(next.i * N + next.j);
      queue.push(next);
    }
  }
  return seen;
}

/** Why a layout is refused, in French because the player reads it; null when it is fine. */
export function layoutProblem(layout: unknown): string | null {
  if (!layout || typeof layout !== 'object') return 'Forme de pièce invalide.';
  const l = layout as Partial<RoomLayout>;
  if (typeof l.cells !== 'string' || l.cells.length !== N * N || !/^[x0-4]+$/.test(l.cells)) return 'Forme de pièce invalide.';
  if (!l.door || !Number.isInteger(l.door.i) || !Number.isInteger(l.door.j) || !inGrid(l.door.i, l.door.j)) return 'La porte doit être sur la grille.';
  const layoutOk = l as RoomLayout;
  if (!hasFloor(layoutOk, l.door.i, l.door.j)) return 'La porte doit être sur une case de sol.';
  const { i, j } = l.door;
  const onEdge = i === 0 || j === 0 || i === N - 1 || j === N - 1 || NEIGHBOURS.slice(0, 4).some(([di, dj]) => !hasFloor(layoutOk, i + di, j + dj));
  if (!onEdge) return 'La porte doit être au bord de la pièce.';
  const count = floorCount(layoutOk);
  if (count < MIN_CELLS) return `La pièce doit avoir au moins ${MIN_CELLS} cases.`;
  if (reachableFromDoor(layoutOk).size !== count) return 'Toutes les cases doivent être accessibles depuis la porte (une marche fait un niveau au plus).';
  return null;
}

export const isValidLayout = (layout: unknown): layout is RoomLayout => layoutProblem(layout) === null;

const rows = (...r: string[]) => r.join('');

export interface LayoutPreset {
  key: string;
  name: string;
  layout: RoomLayout;
}

/** The ready-made shapes offered when a player picks or changes the shape of an apartment. */
export const LAYOUT_PRESETS: readonly LayoutPreset[] = [
  {
    key: 'square',
    name: 'Carré',
    layout: {
      cells: rows('00000000', '00000000', '00000000', '00000000', '00000000', '00000000', '00000000', '00000000'),
      door: { i: 7, j: 0 },
    },
  },
  {
    key: 'studio',
    name: 'Studio',
    layout: {
      cells: rows('xxxxxxxx', 'x000000x', 'x000000x', 'x000000x', 'x000000x', 'x000000x', 'x000000x', 'xxxxxxxx'),
      door: { i: 6, j: 1 },
    },
  },
  {
    key: 'corridor',
    name: 'Couloir',
    layout: {
      cells: rows('xxxxxxxx', 'xxxxxxxx', '00000000', '00000000', '00000000', 'xxxxxxxx', 'xxxxxxxx', 'xxxxxxxx'),
      door: { i: 4, j: 0 },
    },
  },
  {
    key: 'ell',
    name: 'En L',
    layout: {
      cells: rows('000xxxxx', '000xxxxx', '000xxxxx', '000xxxxx', '000xxxxx', '00000000', '00000000', '00000000'),
      door: { i: 7, j: 7 },
    },
  },
  {
    key: 'cross',
    name: 'Croix',
    layout: {
      cells: rows('xx0000xx', 'xx0000xx', '00000000', '00000000', '00000000', '00000000', 'xx0000xx', 'xx0000xx'),
      door: { i: 7, j: 2 },
    },
  },
  {
    key: 'ring',
    name: 'Anneau',
    layout: {
      cells: rows('00000000', '00000000', '00xxxx00', '00xxxx00', '00xxxx00', '00xxxx00', '00000000', '00000000'),
      door: { i: 7, j: 0 },
    },
  },
  {
    key: 'two-rooms',
    name: 'Deux pièces',
    layout: {
      cells: rows('xxxxxxxx', 'xxxxxxxx', '000xx000', '00000000', '000xx000', '000xx000', 'xxxxxxxx', 'xxxxxxxx'),
      door: { i: 5, j: 0 },
    },
  },
  {
    key: 'triangle',
    name: 'Triangle',
    layout: {
      cells: rows('0xxxxxxx', '00xxxxxx', '000xxxxx', '0000xxxx', '00000xxx', '000000xx', '0000000x', '00000000'),
      door: { i: 7, j: 0 },
    },
  },
  {
    key: 'stage',
    name: 'Estrade',
    layout: {
      cells: rows('00001122', '00001122', '00001122', '00001122', '00000000', '00000000', '00000000', '00000000'),
      door: { i: 7, j: 0 },
    },
  },
  {
    key: 'stairs',
    name: 'Escalier',
    layout: {
      cells: rows('33333333', '33333333', '22222222', '22222222', '11111111', '11111111', '00000000', '00000000'),
      door: { i: 7, j: 0 },
    },
  },
  {
    key: 'ledge',
    name: 'Corniche',
    layout: {
      cells: rows('11111111', '10000000', '10000000', '10000000', '10000000', '10000000', '10000000', '10000000'),
      door: { i: 7, j: 7 },
    },
  },
];

export const DEFAULT_LAYOUT: RoomLayout = LAYOUT_PRESETS[0]!.layout;

export const presetByKey = (key: string): LayoutPreset | undefined => LAYOUT_PRESETS.find((p) => p.key === key);

/** Same shape, for comparing a stored layout with a preset. */
export const sameLayout = (a: RoomLayout, b: RoomLayout) => a.cells === b.cells && a.door.i === b.door.i && a.door.j === b.door.j;
