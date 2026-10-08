// Size of the room grid, in its own module so that every other one can read it while they load.

/** Cells along each side of the grid. A room uses any part of it: walls stand behind its back edges. */
export const N = 16;

export const inGrid = (i: number, j: number) =>
  Number.isInteger(i) && Number.isInteger(j) && i >= 0 && j >= 0 && i < N && j < N;
