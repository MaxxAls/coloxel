import { Graphics, Sprite, Texture } from 'pixi.js';
import { floorStyle, wallStyle } from '@coloxel/render';
import { DEFAULT_LAYOUT, type RoomLayout } from '@coloxel/world';
import { paintRoom, type RoomLook } from './room-paint';
import { ROOM_H, ROOM_W } from './room';

export function diamond(g: Graphics, cx: number, cy: number, hw: number, hh: number) {
  g.poly([cx, cy - hh, cx + hw, cy, cx, cy + hh, cx - hw, cy]);
}

/** The look of an apartment: a floor and a wallpaper from the catalogue. */
export function apartmentLook(floor: string, wall: string): RoomLook {
  const f = floorStyle(floor);
  const w = wallStyle(wall);
  return {
    floor: { a: f.a, b: f.b, line: f.line, pattern: f.pattern },
    wall: { left: w.left, right: w.right, trim: w.trim, pattern: w.pattern },
    decor: 'apartment',
  };
}

/** The hall: dark and cream marble, paneled walls, big glass doors and a red carpet. */
export const HALL_LOOK: RoomLook = {
  floor: { a: 0xf4efe6, b: 0x4a3f7a, line: 0x2a2140, pattern: 'checker' },
  wall: { left: 0xf0e2c4, right: 0xd9c8a4, trim: 0xffffff, pattern: 'panels' },
  decor: 'hall',
};

// A painted room takes a fraction of a second: keep the ones already made.
const cache = new Map<string, Texture>();

export function roomTexture(look: RoomLook, layout: RoomLayout = DEFAULT_LAYOUT): Texture {
  const key = JSON.stringify([look, layout]);
  let tex = cache.get(key);
  if (!tex) {
    const canvas = document.createElement('canvas');
    canvas.width = ROOM_W;
    canvas.height = ROOM_H;
    canvas.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(paintRoom(look, layout)), ROOM_W, ROOM_H), 0, 0);
    tex = Texture.from(canvas);
    tex.source.scaleMode = 'nearest';
    if (cache.size >= 12) cache.delete(cache.keys().next().value!);
    cache.set(key, tex);
  }
  return tex;
}

export function roomSprite(look: RoomLook, layout: RoomLayout = DEFAULT_LAYOUT): Sprite {
  return new Sprite(roomTexture(look, layout));
}
