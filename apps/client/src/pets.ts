// Companions, drawn like the avatars: a few shaded shapes, then the 1 px outline.
// Seen from the side, facing right; the room flips them when they walk the other way.

import { petSpecies } from '@coloxel/render';
import { OUTLINE, Painter, outlinePixels, rgb, tone, type RGB } from './avatar';

export const PET_W = 30;
export const PET_H = 26;

/** 0 and 1 are the two steps of a walk, 2 is sitting still. */
export type PetFrame = 0 | 1 | 2;

const WHITE: RGB = [250, 248, 240];
const PINK: RGB = [255, 160, 190];
const DARK = rgb(OUTLINE);

export function petPixels(species: string, color: number, frame: PetFrame): Uint8ClampedArray {
  const def = petSpecies(species);
  const look = def?.colors[color] ?? def?.colors[0];
  const body = rgb(look?.body ?? 0xc98a4a);
  const accent = rgb(look?.accent ?? 0xf6d9ad);
  const p = new Painter(PET_W, PET_H);
  const sit = frame === 2;
  // The body drops a little when sitting; a rabbit hops instead of walking.
  const hop = species === 'lapin' && frame === 1 ? -2 : 0;
  const by = (sit ? 14 : 12) + hop;

  const legs = (xs: number[], len: number, color: RGB) => {
    xs.forEach((x, k) => {
      const lift = !sit && (k + frame) % 2 === 0 && frame === 1 && species !== 'lapin' ? -1.6 : 0;
      p.block(x, by + 2 + lift, x + 2, by + 2 + len + lift, color, 0.7);
      p.block(x - 0.2, by + len + lift, x + 2.2, by + 2.4 + len + lift, tone(color, -0.18), 0.6);
    });
  };

  if (species === 'chien') {
    legs([6.4, 8.8, 14.4, 16.8], sit ? 3 : 5, tone(body, -0.1));
    // Tail up, wagging.
    p.capsule(5.5, by - 1, frame === 1 ? 2.4 : 3.4, by - 5.4, 1.1, tone(body, -0.05));
    p.ball(11.5, by, 7.4, 4.8, body);
    p.ball(12, by + 2.4, 5.4, 2.2, accent);
    p.ball(19.4, by - 3.6, 4.2, 3.8, body);
    p.block(21.4, by - 3.4, 26.4, by - 0.4, accent, 1.2);
    p.ball(26, by - 2.6, 1.1, 0.9, DARK, { flat: true });
    // A floppy ear and a spot around the eye.
    p.block(16.2, by - 7.4, 18.8, by - 1.2, tone(body, -0.28), 1.1);
    p.ball(20.6, by - 4.6, 0.9, 1, DARK, { flat: true });
    p.set(20.2, by - 5, WHITE);
  } else if (species === 'lapin') {
    legs([7.2, 9.4, 13.8, 16], sit ? 2 : 3, tone(body, -0.1));
    p.ball(5, by, 2.5, 2.5, WHITE);
    p.ball(11, by, 6.2, 4.6, body);
    p.ball(11.4, by + 2.2, 4.4, 2, accent);
    p.ball(17.6, by - 3.2, 3.8, 3.4, body);
    // Long ears, pink inside.
    p.block(15.2, by - 12.4, 17.6, by - 4.4, body, 1.1);
    p.block(15.8, by - 11.4, 17, by - 5.4, accent, 0.5);
    p.block(18.4, by - 11.4, 20.6, by - 4.2, tone(body, -0.1), 1.1);
    p.block(18.9, by - 10.4, 20.1, by - 5.2, accent, 0.5);
    p.ball(20.8, by - 2.4, 0.9, 0.8, PINK, { flat: true });
    p.ball(19.2, by - 3.8, 0.9, 1, DARK, { flat: true });
    p.set(18.8, by - 4.2, WHITE);
  } else if (species === 'canard') {
    // Orange feet, a round body, a head with a beak.
    for (const x of [8.8, 13]) {
      const lift = !sit && frame === 1 && x > 10 ? -1.2 : 0;
      p.block(x, by + 3.6 + lift, x + 3, by + 5.2 + lift, accent, 0.5);
    }
    p.ball(11, by, 7.2, 5.2, body);
    p.capsule(4.8, by - 2.4, 2.8, by - 3.4, 1.4, tone(body, -0.08));
    p.ball(12.2, by + 0.4, 4, 2.8, tone(body, -0.12));
    p.ball(18, by - 6.2, 3.8, 3.6, body);
    p.block(20.6, by - 6.2, 25.6, by - 3.8, accent, 1);
    p.ball(19.6, by - 7, 0.9, 1, DARK, { flat: true });
    p.set(19.2, by - 7.4, WHITE);
    p.set(17, by - 9.6, tone(body, 0.2));
    p.set(16, by - 9.2, tone(body, 0.2));
  } else {
    // A cat (the default): pointed ears, a long curved tail.
    legs([6.6, 9, 14.4, 16.8], sit ? 3 : 5, tone(body, -0.1));
    p.capsule(4.8, by - 0.6, 2.4, by - 4.6, 1.1, tone(body, -0.08));
    p.capsule(2.4, by - 4.6, frame === 1 ? 3.6 : 2, by - 8.6, 1.1, tone(body, -0.08));
    p.ball(11.2, by, 7, 4.6, body);
    p.ball(11.6, by + 2.4, 5, 2.1, accent);
    p.ball(18.8, by - 3.8, 4, 3.6, body);
    for (const [ex, tip] of [[16.8, 19.2], [20.4, 22]] as const) {
      for (let k = 0; k < 4; k++) {
        const half = 1.6 - k * 0.38;
        for (let dx = -half; dx <= half; dx += 0.5) p.set((ex + tip) / 2 + (ex < 18 ? -0.6 : 0.6) + dx, by - 7 - k, k === 3 ? tone(body, 0.1) : body);
      }
      p.set((ex + tip) / 2 + (ex < 18 ? -0.6 : 0.6), by - 7.2, PINK);
    }
    p.ball(20.2, by - 4.2, 0.9, 1, DARK, { flat: true });
    p.set(19.8, by - 4.6, WHITE);
    p.set(22.6, by - 2.8, PINK);
    for (const dy of [0, 1.2]) p.set(23.6, by - 3 + dy, tone(accent, -0.1));
  }
  return outlinePixels(p);
}

export function petCanvas(species: string, color: number, frame: PetFrame): HTMLCanvasElement {
  const cv = document.createElement('canvas');
  cv.width = PET_W;
  cv.height = PET_H;
  cv.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(petPixels(species, color, frame)), PET_W, PET_H), 0, 0);
  return cv;
}
