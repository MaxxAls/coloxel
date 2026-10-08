import { Container, Sprite } from 'pixi.js';
import { glowTexture } from './textures';

/**
 * What makes a room stand on the night instead of floating in it: a soft shadow on the "ground" under the slab,
 * and a pool of light in the colour of the walls spilling out around it. Sits below the room, never intercepts clicks.
 */
export function createAura() {
  const root = new Container();
  root.eventMode = 'none';

  const light = new Sprite(glowTexture());
  light.anchor.set(0.5);
  light.blendMode = 'add';
  light.alpha = 0.34;

  const shadow = new Sprite(glowTexture());
  shadow.anchor.set(0.5);
  shadow.tint = 0x000000;
  shadow.alpha = 0.7;

  root.addChild(light, shadow);
  return {
    root,
    /** Follow the part of the canvas the room covers. */
    place(b: { x: number; y: number; w: number; h: number }) {
      light.position.set(b.x + b.w / 2, b.y + b.h * 0.5);
      light.scale.set((b.w * 1.8) / 128, (b.h * 1.6) / 128);
      shadow.position.set(b.x + b.w / 2, b.y + b.h * 0.92);
      shadow.scale.set((b.w * 1.1) / 128, (b.h * 0.3) / 128);
    },
    /** Tint the spill of light with the wall colour (0xRRGGBB), brightened so that dark wallpapers still glow. */
    setColor(wall: number) {
      const r = (wall >> 16) & 255, g = (wall >> 8) & 255, b = wall & 255;
      const lift = (v: number) => Math.min(255, Math.round(v * 0.7 + 90));
      light.tint = (lift(r) << 16) | (lift(g) << 8) | lift(b);
    },
    /** A slow breath, so that the light feels alive. */
    tick(now: number) {
      light.alpha = 0.32 + 0.04 * Math.sin(now / 1800);
    },
  };
}
