import { describe, expect, it } from 'vitest';
import { DEFAULT_LAYOUT, LAYOUT_PRESETS, levelAt } from '@coloxel/world';
import { LEVEL_PX, ROOM_H, ROOM_W, floorStyle, paintRoom, tileAt, tileCenter, wallStyle } from '../src';

const look = () => {
  const f = floorStyle('planks');
  const w = wallStyle('stripes');
  return {
    floor: { a: f.a, b: f.b, line: f.line, pattern: f.pattern },
    wall: { left: w.left, right: w.right, trim: w.trim, pattern: w.pattern },
    decor: 'apartment' as const,
  };
};
const alphaAt = (d: Uint8ClampedArray, x: number, y: number) => d[(Math.round(y) * ROOM_W + Math.round(x)) * 4 + 3]!;
const same = (a: Uint8ClampedArray, b: Uint8ClampedArray) => Buffer.from(a).equals(Buffer.from(b));
const preset = (key: string) => LAYOUT_PRESETS.find((p) => p.key === key)!.layout;

describe('paintRoom with a shape', () => {
  it('paints the same pixels with no shape as with the default one', () => {
    expect(same(paintRoom(look()), paintRoom(look(), DEFAULT_LAYOUT))).toBe(true);
  });

  it('leaves the courtyard of a ring empty and paints floor under every other cell', () => {
    const ring = preset('ring');
    const data = paintRoom(look(), ring);
    expect(data.length).toBe(ROOM_W * ROOM_H * 4);
    const hole = tileCenter(6, 6);
    expect(alphaAt(data, hole.x, hole.y)).toBe(0);
    const side = tileCenter(13, 2);
    expect(alphaAt(data, side.x, side.y)).toBe(255);
  });

  it('lifts a raised cell on the screen', () => {
    const stage = preset('stage');
    expect(levelAt(stage, 0, 15)).toBe(2);
    const flat = tileCenter(0, 15);
    const raised = tileCenter(0, 15, 2);
    expect(flat.y - raised.y).toBe(2 * LEVEL_PX);
    expect(alphaAt(paintRoom(look(), stage), raised.x, raised.y)).toBe(255);
  });

  it('is deterministic for every preset', () => {
    for (const p of LAYOUT_PRESETS) expect(same(paintRoom(look(), p.layout), paintRoom(look(), p.layout)), p.key).toBe(true);
  });
});

describe('tileAt with a shape', () => {
  it('finds the cell under a point, flat or raised, and nothing where there is no floor', () => {
    const ring = preset('ring');
    for (const [i, j] of [[0, 0], [15, 15], [12, 2]] as const) {
      const c = tileCenter(i, j);
      expect(tileAt(c.x, c.y, ring)).toEqual({ i, j });
    }
    const hole = tileCenter(6, 6);
    expect(tileAt(hole.x, hole.y, ring)).toBeNull();
    const stage = preset('stage');
    const up = tileCenter(0, 15, levelAt(stage, 0, 15)!);
    expect(tileAt(up.x, up.y, stage)).toEqual({ i: 0, j: 15 });
    // The same shape-less lookup still behaves like before.
    expect(tileAt(tileCenter(2, 5).x, tileCenter(2, 5).y)).toEqual({ i: 2, j: 5 });
  });
});
