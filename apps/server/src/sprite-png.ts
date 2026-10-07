import { PNG } from 'pngjs';
import type { Sprite } from '@coloxel/render';

export function spriteToPng(sprite: Sprite): Buffer {
  const png = new PNG({ width: sprite.width, height: sprite.height });
  png.data = Buffer.from(sprite.data);
  return PNG.sync.write(png);
}
