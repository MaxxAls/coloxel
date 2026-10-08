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
import { DEFAULT_LAYOUT, hasFloor, wallBehind } from '@coloxel/world';
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

  it('animated pieces have frames of the same footprint that draw differently and stay in their frame', () => {
    const animated = CATALOGUE.filter((e) => e.frames?.length);
    expect(animated.map((e) => e.key)).toEqual(expect.arrayContaining(['fontaine', 'jukebox', 'aquariumgrand']));
    for (const e of animated) {
      expect(e.frameMs, e.key).toBeGreaterThanOrEqual(100);
      const base = renderRecipe(e.recipe);
      const seen = new Set([spriteHash(base)]);
      for (const [k, frame] of e.frames!.entries()) {
        expect(normalizeSize(frame.size), `${e.key} frame ${k + 1}`).toEqual(normalizeSize(e.recipe.size));
        expect(frame.parts.length, `${e.key} frame ${k + 1}`).toBeLessThanOrEqual(LIMITS.maxParts);
        const sprite = renderRecipe(frame);
        expect([sprite.width, sprite.height]).toEqual([base.width, base.height]);
        for (let x = 0; x < sprite.width; x++) {
          expect(sprite.mask[x], `${e.key} f${k + 1} top`).toBe(0);
          expect(sprite.mask[(sprite.height - 1) * sprite.width + x], `${e.key} f${k + 1} bottom`).toBe(0);
        }
        for (let y = 0; y < sprite.height; y++) {
          expect(sprite.mask[y * sprite.width], `${e.key} f${k + 1} left`).toBe(0);
          expect(sprite.mask[y * sprite.width + sprite.width - 1], `${e.key} f${k + 1} right`).toBe(0);
        }
        seen.add(spriteHash(sprite));
      }
      // Every frame is a different picture: otherwise it would not move.
      expect(seen.size, e.key).toBe(e.frames!.length + 1);
    }
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
  it('furnishes the room of a new apartment, every piece on its own floor tiles or on a wall, the door left free', () => {
    const keys = STARTER_KIT.map((k) => k.key);
    // A lived-in room: somewhere to sleep, to sit, a light, a table and a plant at least.
    expect(STARTER_KIT.length).toBeGreaterThanOrEqual(15);
    for (const category of ['sleep', 'seat', 'light', 'table', 'decor'] as const) {
      expect(keys.some((k) => catalogueEntry(k)?.category === category), category).toBe(true);
    }
    const taken = new Set<string>();
    for (const k of STARTER_KIT) {
      const entry = catalogueEntry(k.key);
      expect(entry, k.key).toBeDefined();
      const rot = k.rot ?? 0;
      if (entry!.wall) {
        // A wall piece hangs on the left wall (turn 0) or the right one (turn 1), where there is a wall.
        expect(rot === 0 || rot === 1, k.key).toBe(true);
        expect(wallBehind(DEFAULT_LAYOUT, rot === 0 ? 'left' : 'right', k.i, k.j), k.key).toBe(true);
        const key = `${k.i},${k.j},wall${rot}`;
        expect(taken.has(key), key).toBe(false);
        taken.add(key);
        continue;
      }
      const [w, h] = rotatedSize(normalizeSize(entry!.recipe.size), rot);
      for (let a = 0; a < w; a++) {
        for (let b = 0; b < h; b++) {
          const cell = `${k.i + a},${k.j + b}`;
          expect(hasFloor(DEFAULT_LAYOUT, k.i + a, k.j + b), `${k.key} at ${cell}`).toBe(true);
          expect(taken.has(cell), `${k.key} at ${cell}`).toBe(false);
          taken.add(cell);
        }
      }
    }
    // The door, where players arrive, stays free.
    expect(taken.has(`${DEFAULT_LAYOUT.door.i},${DEFAULT_LAYOUT.door.j}`)).toBe(false);
  });
});

describe('floors and wallpapers', () => {
  it('offer at least ten styles each, with unique ids', () => {
    expect(FLOORS.length).toBeGreaterThanOrEqual(10);
    expect(WALLS.length).toBeGreaterThanOrEqual(10);
    expect(new Set(FLOORS.map((f) => f.id)).size).toBe(FLOORS.length);
    expect(new Set(WALLS.map((w) => w.id)).size).toBe(WALLS.length);
  });
});
