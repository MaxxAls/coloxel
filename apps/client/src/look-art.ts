import { RES, type Look, type Slot } from '@coloxel/render';
import { avatarFrame, type Facing, type Frame, type Pose } from './avatar';

// Little pictures of avatars for the wardrobe and the shop. Pixel art, so they
// are drawn at their own size and zoomed by the browser without smoothing.

/** The avatar in a canvas the browser shows at `zoom` screen pixels per pixel of its design grid (the sprite is RES times finer). */
export function lookCanvas(look: Look, opts: { zoom?: number; facing?: Facing; frame?: Frame; pose?: Pose; blink?: boolean } = {}): HTMLCanvasElement {
  const cv = avatarFrame(look, opts.facing ?? 'front', opts.frame ?? 0, opts.blink ?? false, opts.pose ?? 'stand');
  const zoom = (opts.zoom ?? 3) / RES;
  cv.className = 'pixel-art';
  cv.style.width = `${cv.width * zoom}px`;
  cv.style.height = `${cv.height * zoom}px`;
  return cv;
}

/** Which part of the standing avatar shows a given kind of piece: x, y, width, height. */
const CROPS: Record<Slot | 'face', [number, number, number, number]> = {
  face: [5, 7, 20, 22],
  hair: [3, 2, 24, 28],
  hat: [3, 0, 24, 28],
  glasses: [5, 7, 20, 22],
  top: [3, 22, 24, 24],
  extra: [0, 16, 30, 32],
  bottom: [4, 36, 22, 22],
  shoes: [4, 40, 22, 18],
};

/** A thumbnail of the avatar wearing `look`, cropped on the part that matters for this slot. */
export function thumbCanvas(look: Look, area: Slot | 'face', zoom = 3): HTMLCanvasElement {
  const [sx, sy, sw, sh] = CROPS[area];
  const source = avatarFrame(look, area === 'extra' && look.extra === 2 ? 'back' : 'front', 0, false, 'stand');
  const cv = document.createElement('canvas');
  cv.width = sw * RES;
  cv.height = sh * RES;
  cv.getContext('2d')!.drawImage(source, sx * RES, sy * RES, sw * RES, sh * RES, 0, 0, sw * RES, sh * RES);
  cv.className = 'pixel-art';
  cv.style.width = `${sw * zoom}px`;
  cv.style.height = `${sh * zoom}px`;
  return cv;
}
