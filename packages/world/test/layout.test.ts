import { describe, expect, it } from 'vitest';
import { LAYOUT_PRESETS, N, canStep, findPath, floorCount, layoutProblem, levelAt, reachableFromDoor, voidKeys, wallBehind } from '../src';

const preset = (key: string) => LAYOUT_PRESETS.find((p) => p.key === key)!.layout;
const grid = (...r: string[]) => r.join('');

describe('room layouts', () => {
  it('every preset is valid and fully reachable from its door', () => {
    for (const p of LAYOUT_PRESETS) {
      expect(layoutProblem(p.layout), p.key).toBeNull();
      expect(reachableFromDoor(p.layout).size, p.key).toBe(floorCount(p.layout));
    }
  });

  it('reads levels and voids', () => {
    // Sketched shapes: each cell of the 8 x 8 sketch is 2 x 2 cells of the grid.
    const stairs = preset('stairs');
    expect(levelAt(stairs, 15, 0)).toBe(0);
    expect(levelAt(stairs, 0, 6)).toBe(3);
    const ring = preset('ring');
    expect(levelAt(ring, 6, 6)).toBeNull();
    expect(voidKeys(ring).has(6 * N + 6)).toBe(true);
    expect(levelAt(ring, 9, 0)).toBe(0);
    expect(levelAt(ring, N, 0)).toBeNull();
    // The square leaves the rest of the grid empty.
    expect(levelAt(preset('square'), 9, 9)).toBe(0);
    expect(levelAt(preset('square'), 10, 0)).toBeNull();
  });

  it('refuses bad shapes', () => {
    const base = preset('square');
    expect(layoutProblem(null)).not.toBeNull();
    expect(layoutProblem({ ...base, cells: base.cells.slice(1) })).not.toBeNull();
    expect(layoutProblem({ ...base, cells: base.cells.replace(/0/g, '9') })).not.toBeNull();
    expect(layoutProblem({ ...base, door: { i: N, j: 0 } })).not.toBeNull();
    // A door on a cell without floor.
    expect(layoutProblem({ ...base, door: { i: 12, j: 0 } })).not.toBeNull();
    // A door in the middle of the floor.
    expect(layoutProblem({ ...base, door: { i: 3, j: 3 } })).not.toBeNull();
    // Too small.
    expect(layoutProblem({ cells: '000000000' + 'x'.repeat(N * N - 9), door: { i: 0, j: 0 } })).not.toBeNull();
    // Islands: part of the floor cannot be reached.
    const islands = grid(...Array<string>(N).fill('0000x0000000x000'));
    expect(layoutProblem({ cells: islands, door: { i: 0, j: 0 } })).not.toBeNull();
    // A cliff of two levels cuts the room in two.
    const cliff = grid(...Array<string>(N).fill('0000000022222222'));
    expect(layoutProblem({ cells: cliff, door: { i: 0, j: 0 } })).not.toBeNull();
  });

  it('only steps one level at a time, and findPath obeys', () => {
    const stage = preset('stage');
    expect(canStep(stage, { i: 0, j: 7 }, { i: 0, j: 8 })).toBe(true);
    expect(canStep(stage, { i: 0, j: 11 }, { i: 0, j: 12 })).toBe(true);
    expect(canStep(stage, { i: 7, j: 12 }, { i: 8, j: 12 })).toBe(false);
    const blocked = (i: number, j: number) => voidKeys(stage).has(i * N + j);
    const path = findPath({ i: N - 1, j: 0 }, { i: 0, j: N - 1 }, blocked, (a, b) => canStep(stage, a, b));
    expect(path.length).toBeGreaterThan(0);
    let prev = { i: N - 1, j: 0 };
    for (const c of path) {
      expect(canStep(stage, prev, c)).toBe(true);
      prev = c;
    }
  });

  it('puts a wall behind the first floor tile of each row and column', () => {
    const square = preset('large');
    // In a plain square the left wall is behind i = 0 and the right wall behind j = 0, and nowhere else.
    for (let k = 0; k < N; k++) {
      expect(wallBehind(square, 'left', 0, k)).toBe(true);
      expect(wallBehind(square, 'right', k, 0)).toBe(true);
    }
    expect(wallBehind(square, 'left', 1, 3)).toBe(false);
    expect(wallBehind(square, 'right', 3, 1)).toBe(false);
    // The corner has both.
    expect(wallBehind(square, 'left', 0, 0) && wallBehind(square, 'right', 0, 0)).toBe(true);
    // Outside the grid, or where there is no floor, there is no wall.
    expect(wallBehind(square, 'left', -1, 2)).toBe(false);
    expect(wallBehind(square, 'right', 3, N)).toBe(false);
    // With a hole at the start of a row the wall moves to the next tile that has a floor.
    const cells = '0'.repeat(N * N).split('');
    cells[0 * N + 3] = 'x';
    const holed = { ...square, cells: cells.join('') };
    expect(wallBehind(holed, 'left', 0, 3)).toBe(false);
    expect(wallBehind(holed, 'left', 1, 3)).toBe(true);
    expect(wallBehind(holed, 'left', 2, 3)).toBe(false);
  });
});
