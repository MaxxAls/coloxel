import { describe, expect, it } from 'vitest';
import { AVATAR_H, AVATAR_W, OUTLINE, avatarPixels, lookFor, type Frame } from '../src/avatar';

const alpha = (px: Uint8ClampedArray, x: number, y: number) => px[(y * AVATAR_W + x) * 4 + 3]!;
const rgb = (px: Uint8ClampedArray, x: number, y: number) => {
  const o = (y * AVATAR_W + x) * 4;
  return (px[o]! << 16) | (px[o + 1]! << 8) | px[o + 2]!;
};

describe('avatar', () => {
  it('draws every facing and frame at the same size, without clipping', () => {
    const look = lookFor('someone');
    for (const facing of ['front', 'back'] as const) {
      for (const frame of [0, 1, 2] as Frame[]) {
        const px = avatarPixels(look, facing, frame);
        expect(px).toHaveLength(AVATAR_W * AVATAR_H * 4);
        expect([...px].some((v, k) => k % 4 === 3 && v > 0)).toBe(true);
        // Nothing is clipped: the edges of the canvas only hold outline.
        for (let y = 0; y < AVATAR_H; y++) {
          for (const x of [0, AVATAR_W - 1]) if (alpha(px, x, y) > 0) expect(rgb(px, x, y)).toBe(OUTLINE);
        }
      }
    }
  });

  it('outlines the silhouette with the style guide color', () => {
    const px = avatarPixels(lookFor('x'));
    let y = 0;
    while (alpha(px, 5, y) === 0) y++;
    expect(rgb(px, 5, y)).toBe(OUTLINE);
  });

  it('gives the same player the same look, and different players different ones', () => {
    expect(lookFor('abc')).toEqual(lookFor('abc'));
    const looks = new Set(Array.from({ length: 40 }, (_, k) => JSON.stringify(lookFor(`player-${k}`))));
    expect(looks.size).toBeGreaterThan(30);
  });

  it('walking frames differ from standing and from each other', () => {
    const look = lookFor('walker');
    const stand = avatarPixels(look, 'front', 0);
    expect(avatarPixels(look, 'front', 1)).not.toEqual(stand);
    expect(avatarPixels(look, 'front', 2)).not.toEqual(avatarPixels(look, 'front', 1));
  });
});
