import { describe, expect, it } from 'vitest';
import { ANCHOR_X, ANCHOR_Y, SCALE, SEEDS, SPRITE_H, SPRITE_W, project, renderSprite, spriteHash } from '../src';

const opaque = (d: Uint8ClampedArray) => {
  let n = 0;
  for (let i = 3; i < d.length; i += 4) if (d[i]! > 0) n++;
  return n;
};

describe('renderSprite', () => {
  it('draws every seed object', () => {
    for (const s of SEEDS) {
      const sp = renderSprite(s.parts);
      expect(sp.width).toBe(SPRITE_W);
      expect(sp.height).toBe(SPRITE_H);
      expect(opaque(sp.data)).toBeGreaterThan(50);
    }
  });

  it('is deterministic', () => {
    const a = spriteHash(renderSprite(SEEDS[0]!.parts));
    const b = spriteHash(renderSprite(SEEDS[0]!.parts));
    expect(a).toBe(b);
  });

  it('adds a dark outline around shapes', () => {
    const sp = renderSprite([{ t: 'box', x0: -4, x1: 4, y0: -4, y1: 4, z0: 0, z1: 6, c: '#ff0000' }]);
    let outline = 0;
    for (let i = 0; i < sp.data.length; i += 4) {
      if (sp.data[i] === 0x1b && sp.data[i + 1] === 0x15 && sp.data[i + 2] === 0x30) outline++;
    }
    expect(outline).toBeGreaterThan(20);
  });

  it('never throws on garbage', () => {
    const junk: unknown[] = [
      null, 42, 'box', { t: 'nope' }, { t: 'box', x0: 'a', c: 'red' },
      { t: 'quad', pts: [[1]] }, { t: 'quad', pts: 'x' }, { t: 'sphere', r: 1e9, z: -50 },
      { t: 'cyl', r: -3, z0: 99, z1: -99 }, { t: 'pix', w: 1e6, h: 1e6, c: '#00ff00' },
    ];
    expect(() => renderSprite(junk)).not.toThrow();
    expect(() => renderSprite(undefined as unknown as unknown[])).not.toThrow();
  });

  it('keeps huge shapes inside the sprite', () => {
    const sp = renderSprite([{ t: 'box', x0: -999, x1: 999, y0: -999, y1: 999, z0: 0, z1: 999, c: '#123456' }]);
    expect(sp.data.length).toBe(SPRITE_W * SPRITE_H * 4);
  });

  it('draws at twice the resolution of the recipe: one unit is two pixels', () => {
    expect(SCALE).toBe(2);
    expect(SPRITE_W).toBe(192);
    expect(SPRITE_H).toBe(224);
    const [x, y] = project(0, 0, 0);
    expect([x, y]).toEqual([ANCHOR_X, ANCHOR_Y]);
    // One unit along x moves two pixels right and one pixel down.
    const [x1, y1] = project(1, 0, 0);
    expect([x1 - x, y1 - y]).toEqual([2, 1]);
  });

  it('casts a soft shadow on the floor that is not part of the clickable shape', () => {
    const sp = renderSprite([{ t: 'box', x0: -4, x1: 4, y0: -4, y1: 4, z0: 0, z1: 12, c: '#c98f5e' }]);
    let shadow = 0;
    for (let i = 0; i < sp.mask.length; i++) {
      const a = sp.data[i * 4 + 3]!;
      if (a > 0 && a < 255) {
        shadow++;
        expect(sp.mask[i]).toBe(0);
      }
    }
    expect(shadow).toBeGreaterThan(100);
  });

  it('keeps the shadow and the grain identical from one run to the next', () => {
    const parts = [
      { t: 'cyl', x: 0, y: 0, r: 4, z0: 0, z1: 14, side: '#4fb35a' },
      { t: 'sphere', x: 0, y: 0, z: 18, r: 5, c: '#e2483d' },
    ];
    expect(spriteHash(renderSprite(parts))).toBe(spriteHash(renderSprite(parts)));
  });

  it('shades a box instead of painting it flat: lighter at the top of a side, darker at the bottom', () => {
    const sp = renderSprite([{ t: 'box', x0: -6, x1: 6, y0: -6, y1: 6, z0: 0, z1: 30, c: '#8b5e3c' }]);
    // Sample the right face (x = max side) along one column of pixels, away from edges.
    const x = ANCHOR_X + 6;
    const lum = (y: number) => {
      const o = (y * SPRITE_W + x) * 4;
      return sp.data[o]! + sp.data[o + 1]! + sp.data[o + 2]!;
    };
    const top = lum(ANCHOR_Y - 40);
    const bottom = lum(ANCHOR_Y - 6);
    expect(top).toBeGreaterThan(bottom);
  });

  it('draws half-unit pixel details', () => {
    const half = renderSprite([{ t: 'pix', x: 0, y: 0, z: 10, w: 0.5, h: 0.5, c: '#ff0000' }]);
    const one = renderSprite([{ t: 'pix', x: 0, y: 0, z: 10, w: 1, h: 1, c: '#ff0000' }]);
    const red = (sp: typeof half) => {
      let n = 0;
      for (let i = 0; i < sp.data.length; i += 4) if (sp.data[i] === 255 && sp.data[i + 1] === 0 && sp.data[i + 3] === 255) n++;
      return n;
    };
    expect(red(half)).toBe(1);
    expect(red(one)).toBe(4);
  });
});
