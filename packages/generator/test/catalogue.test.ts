import { describe, expect, it } from 'vitest';
import {
  CATALOGUE,
  FLOORS,
  LIMITS,
  SPRITE_H,
  SPRITE_W,
  STARTER_KIT,
  WALLS,
  catalogueEntry,
  renderSprite,
  spriteHash,
} from '@coloxel/render';
import { validateRecipe } from '../src';

describe('base catalogue', () => {
  it('has about twenty pieces with unique keys and names, all free', () => {
    expect(CATALOGUE.length).toBeGreaterThanOrEqual(20);
    expect(new Set(CATALOGUE.map((e) => e.key)).size).toBe(CATALOGUE.length);
    expect(new Set(CATALOGUE.map((e) => e.name)).size).toBe(CATALOGUE.length);
    for (const e of CATALOGUE) {
      expect(e.key).toMatch(/^[a-z]+$/);
      expect(e.price).toBe(0);
    }
  });

  it('passes through validateRecipe untouched, like any other recipe', () => {
    for (const e of CATALOGUE) {
      const r = validateRecipe({ nom: e.name, parts: e.recipe.parts });
      expect(r.ok, e.key).toBe(true);
      if (r.ok) expect(r.recipe.parts, e.key).toEqual(e.recipe.parts.map((p) => expect.objectContaining({ t: p.t })));
      expect(e.recipe.parts.length, e.key).toBeLessThanOrEqual(LIMITS.maxParts);
    }
  });

  it('renders every piece as a distinct, non-empty sprite that stays inside the frame', () => {
    const hashes = new Set<string>();
    for (const e of CATALOGUE) {
      const sprite = renderSprite(e.recipe.parts);
      expect(sprite.width).toBe(SPRITE_W);
      expect(sprite.height).toBe(SPRITE_H);
      const opaque = sprite.mask.reduce((n, v) => n + v, 0);
      expect(opaque, e.key).toBeGreaterThan(80);
      // Nothing touches the border of the sprite: it would be clipped.
      for (let x = 0; x < SPRITE_W; x++) {
        expect(sprite.mask[x], `${e.key} top`).toBe(0);
        expect(sprite.mask[(SPRITE_H - 1) * SPRITE_W + x], `${e.key} bottom`).toBe(0);
      }
      for (let y = 0; y < SPRITE_H; y++) {
        expect(sprite.mask[y * SPRITE_W], `${e.key} left`).toBe(0);
        expect(sprite.mask[y * SPRITE_W + SPRITE_W - 1], `${e.key} right`).toBe(0);
      }
      hashes.add(spriteHash(sprite));
    }
    expect(hashes.size).toBe(CATALOGUE.length);
  });

  it('draws the same pixels every time', () => {
    for (const e of CATALOGUE) {
      expect(spriteHash(renderSprite(e.recipe.parts))).toBe(spriteHash(renderSprite(e.recipe.parts)));
    }
  });

  it('finds a piece by key, and nothing for an unknown key', () => {
    expect(catalogueEntry('lit')?.name).toBe('Lit douillet');
    expect(catalogueEntry('licorne')).toBeUndefined();
    expect(catalogueEntry('__proto__')).toBeUndefined();
  });
});

describe('starter kit', () => {
  it('is a bed, a table, a chair, a lamp and a plant on distinct cells of the room', () => {
    expect(STARTER_KIT.map((k) => k.key).sort()).toEqual(['chaise', 'ficus', 'lampadaire', 'lit', 'table']);
    const cells = new Set(STARTER_KIT.map((k) => `${k.i},${k.j}`));
    expect(cells.size).toBe(STARTER_KIT.length);
    for (const k of STARTER_KIT) {
      expect(catalogueEntry(k.key), k.key).toBeDefined();
      expect(k.i >= 0 && k.i < 8 && k.j >= 0 && k.j < 8).toBe(true);
      // The door and the spawn point (7, 0) stay free.
      expect(`${k.i},${k.j}`).not.toBe('7,0');
      expect(k.i === 0 && k.j >= 4 && k.j <= 6, 'in front of the door').toBe(false);
    }
  });
});

describe('floors and wallpapers', () => {
  it('offer ten styles each, with unique ids', () => {
    expect(FLOORS).toHaveLength(10);
    expect(WALLS).toHaveLength(10);
    expect(new Set(FLOORS.map((f) => f.id)).size).toBe(10);
    expect(new Set(WALLS.map((w) => w.id)).size).toBe(10);
  });
});
