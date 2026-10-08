import { describe, expect, it } from 'vitest';
import { LAYOUT_PRESETS } from '@coloxel/world';
import { FLOORS, WALLS } from '@coloxel/render';
import { ROOM_H, ROOM_W } from '../src/room';
import { paintRoom, type RoomLook } from '../src/room-paint';

const lookOf = (floorId: string, wallId: string, decor: RoomLook['decor'] = 'apartment'): RoomLook => {
  const f = FLOORS.find((x) => x.id === floorId)!;
  const w = WALLS.find((x) => x.id === wallId)!;
  return {
    floor: { a: f.a, b: f.b, line: f.line, pattern: f.pattern },
    wall: { left: w.left, right: w.right, trim: w.trim, pattern: w.pattern },
    decor,
  };
};

const alphaAt = (px: Uint8ClampedArray, x: number, y: number) => px[(y * ROOM_W + x) * 4 + 3]!;
const opaque = (px: Uint8ClampedArray) => {
  let n = 0;
  for (let i = 3; i < px.length; i += 4) if (px[i] === 255) n++;
  return n;
};

describe('room painter', () => {
  it('paints a full room of the canvas size, transparent in the corners, solid in the middle', () => {
    const px = paintRoom(lookOf('parquet', 'violet'), LAYOUT_PRESETS.find((p) => p.key === 'large')!.layout);
    expect(px).toHaveLength(ROOM_W * ROOM_H * 4);
    for (const [x, y] of [[0, 0], [ROOM_W - 1, 0], [0, ROOM_H - 1], [ROOM_W - 1, ROOM_H - 1]] as const) {
      expect(alphaAt(px, x, y)).toBe(0);
    }
    expect(alphaAt(px, ROOM_W / 2, ROOM_H / 2)).toBe(255);
    // The room fills a good part of the canvas.
    expect(opaque(px)).toBeGreaterThan(ROOM_W * ROOM_H * 0.3);
  });

  it('paints every floor and every wallpaper of the catalogue, without ever failing', () => {
    for (const f of FLOORS) {
      const px = paintRoom(lookOf(f.id, 'violet'));
      expect(opaque(px), f.id).toBeGreaterThan(50000);
    }
    for (const w of WALLS) {
      const px = paintRoom(lookOf('parquet', w.id));
      expect(opaque(px), w.id).toBeGreaterThan(50000);
    }
  });

  it('draws the same room every time', () => {
    const a = paintRoom(lookOf('herbe', 'foret'));
    const b = paintRoom(lookOf('herbe', 'foret'));
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(true);
  });

  it('gives different floors and different walls different pictures', () => {
    const base = Buffer.from(paintRoom(lookOf('parquet', 'violet')));
    expect(Buffer.from(paintRoom(lookOf('damier', 'violet'))).equals(base)).toBe(false);
    expect(Buffer.from(paintRoom(lookOf('parquet', 'nuit'))).equals(base)).toBe(false);
    expect(Buffer.from(paintRoom(lookOf('parquet', 'violet', 'hall'))).equals(base)).toBe(false);
  });

  it('outlines the room with the style guide color', () => {
    const px = paintRoom(lookOf('parquet', 'violet'));
    // Scan down the middle column: the first opaque pixel is the outline above the corner of the walls.
    let y = 0;
    while (alphaAt(px, ROOM_W / 2, y) === 0) y++;
    const o = (y * ROOM_W + ROOM_W / 2) * 4;
    expect([px[o], px[o + 1], px[o + 2]]).toEqual([0x1b, 0x15, 0x30]);
  });
});
