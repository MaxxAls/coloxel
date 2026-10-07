import { describe, expect, it } from 'vitest';
import { N, findPath, inGrid } from '../src';

const free = () => false;

describe('findPath', () => {
  it('walks case by case, excluding the start and including the target', () => {
    const path = findPath({ i: 0, j: 0 }, { i: 2, j: 1 }, free);
    expect(path).toHaveLength(3);
    expect(path[2]).toEqual({ i: 2, j: 1 });
    let prev = { i: 0, j: 0 };
    for (const c of path) {
      expect(Math.abs(c.i - prev.i) + Math.abs(c.j - prev.j)).toBe(1);
      prev = c;
    }
  });

  it('goes around blocked cells', () => {
    const wall = (i: number, j: number) => i === 1 && j < N - 1;
    const path = findPath({ i: 0, j: 0 }, { i: 2, j: 0 }, wall);
    expect(path.length).toBeGreaterThan(2);
    expect(path.some((c) => wall(c.i, c.j))).toBe(false);
    expect(path.at(-1)).toEqual({ i: 2, j: 0 });
  });

  it('returns [] for a blocked target, an unreachable target, the same cell or out of grid', () => {
    expect(findPath({ i: 0, j: 0 }, { i: 3, j: 3 }, (i, j) => i === 3 && j === 3)).toEqual([]);
    expect(findPath({ i: 0, j: 0 }, { i: 5, j: 5 }, (i, j) => i === 1 || (i === 0 && j === 1))).toEqual([]);
    expect(findPath({ i: 2, j: 2 }, { i: 2, j: 2 }, free)).toEqual([]);
    expect(findPath({ i: 0, j: 0 }, { i: N, j: 0 }, free)).toEqual([]);
  });
});

describe('inGrid', () => {
  it('accepts only integer cells inside the grid', () => {
    expect(inGrid(0, 0)).toBe(true);
    expect(inGrid(N - 1, N - 1)).toBe(true);
    expect(inGrid(N, 0)).toBe(false);
    expect(inGrid(-1, 3)).toBe(false);
    expect(inGrid(1.5, 2)).toBe(false);
    expect(inGrid(Number.NaN, 2)).toBe(false);
  });
});
