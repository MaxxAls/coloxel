import { describe, expect, it } from 'vitest';
import { N, tileAt, tileCenter } from '../src/room';

describe('tileAt', () => {
  it('is the inverse of tileCenter for every tile', () => {
    for (let i = 0; i < N; i++) {
      for (let j = 0; j < N; j++) {
        const { x, y } = tileCenter(i, j);
        expect(tileAt(x, y)).toEqual({ i, j });
      }
    }
  });

  it('returns null outside the grid', () => {
    const { x, y } = tileCenter(-1, 0);
    expect(tileAt(x, y)).toBeNull();
    const far = tileCenter(N, N);
    expect(tileAt(far.x, far.y)).toBeNull();
  });
});
