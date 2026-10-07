import { describe, expect, it } from 'vitest';
import { SPRITE_VERSION } from '@coloxel/render';
import { furnitureSpriteUrl, itemSpriteUrl } from '../src/api';

describe('sprite urls', () => {
  it('carry the sprite version, so a browser never reuses images drawn by an older engine', () => {
    expect(SPRITE_VERSION).toBeGreaterThanOrEqual(2);
    expect(itemSpriteUrl('abc')).toBe(`/api/items/abc.png?v=${SPRITE_VERSION}`);
    expect(furnitureSpriteUrl('lit')).toBe(`/api/catalogue/lit.png?v=${SPRITE_VERSION}`);
  });
});
