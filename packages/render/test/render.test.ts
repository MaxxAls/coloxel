import { describe, expect, it } from 'vitest';
import { SEEDS, SPRITE_H, SPRITE_W, renderSprite, spriteHash } from '../src';

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
});
