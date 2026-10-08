import { describe, expect, it } from 'vitest';
import {
  CATALOGUE,
  FLOORS,
  LIMITS,
  frameFor,
  normalizeSize,
  rotatedSize,
  STARTER_KIT,
  WALLS,
  catalogueEntry,
  renderRecipe,
  spriteHash,
} from '@coloxel/render';
import { validateRecipe } from '../src';

describe('base catalogue', () => {
  it('has unique keys and names; the base twenty are free, the rest has a price', () => {
    expect(CATALOGUE.length).toBeGreaterThanOrEqual(20);
    expect(CATALOGUE.filter((e) => e.price === 0).length).toBeGreaterThanOrEqual(20);
    expect(new Set(CATALOGUE.map((e) => e.key)).size).toBe(CATALOGUE.length);
    expect(new Set(CATALOGUE.map((e) => e.name)).size).toBe(CATALOGUE.length);
    for (const e of CATALOGUE) {
      expect(e.key).toMatch(/^[a-z]+$/);
      expect(Number.isInteger(e.price) && e.price >= 0).toBe(true);
    }
  });

  it('passes through validateRecipe untouched, like any other recipe', () => {
    for (const e of CATALOGUE) {
      const r = validateRecipe({ nom: e.name, parts: e.recipe.parts, size: e.recipe.size });
      expect(r.ok, e.key).toBe(true);
      if (r.ok) expect(r.recipe.parts, e.key).toEqual(e.recipe.parts.map((p) => expect.objectContaining({ t: p.t })));
      expect(e.recipe.parts.length, e.key).toBeLessThanOrEqual(LIMITS.maxParts);
    }
  });

  it('renders every piece as a distinct, non-empty sprite that stays inside the frame', () => {
    const hashes = new Set<string>();
    for (const e of CATALOGUE) {
      const sprite = renderRecipe(e.recipe);
      const frame = frameFor(normalizeSize(e.recipe.size));
      const W = frame.width, H = frame.height;
      expect(sprite.width).toBe(W);
      expect(sprite.height).toBe(H);
      const opaque = sprite.mask.reduce((n, v) => n + v, 0);
      expect(opaque, e.key).toBeGreaterThan(80);
      // Nothing touches the border of the sprite: it would be clipped.
      for (let x = 0; x < W; x++) {
        expect(sprite.mask[x], `${e.key} top`).toBe(0);
        expect(sprite.mask[(H - 1) * W + x], `${e.key} bottom`).toBe(0);
      }
      for (let y = 0; y < H; y++) {
        expect(sprite.mask[y * W], `${e.key} left`).toBe(0);
        expect(sprite.mask[y * W + W - 1], `${e.key} right`).toBe(0);
      }
      // A turned piece must stay in its frame too.
      for (const turns of [1, 2, 3]) {
        const turned = renderRecipe(e.recipe, turns);
        const f = frameFor(rotatedSize(normalizeSize(e.recipe.size), turns));
        expect([turned.width, turned.height], `${e.key} r${turns}`).toEqual([f.width, f.height]);
        for (let x = 0; x < f.width; x++) expect(turned.mask[x], `${e.key} r${turns} top`).toBe(0);
        for (let y = 0; y < f.height; y++) {
          expect(turned.mask[y * f.width], `${e.key} r${turns} left`).toBe(0);
          expect(turned.mask[y * f.width + f.width - 1], `${e.key} r${turns} right`).toBe(0);
        }
      }
      hashes.add(spriteHash(sprite));
    }
    expect(hashes.size).toBe(CATALOGUE.length);
  });

  it('draws the same pixels every time', () => {
    for (const e of CATALOGUE) {
      expect(spriteHash(renderRecipe(e.recipe))).toBe(spriteHash(renderRecipe(e.recipe)));
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
