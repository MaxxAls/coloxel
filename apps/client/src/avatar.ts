// The avatar is drawn by the shared render package (pure pixels, also used by the website);
// this file only puts it on a canvas for the browser.
import { avatarPixels, avatarSize, lookFor, type Facing, type Frame, type Look, type Pose, type Tint } from '@coloxel/render';

export {
  AVATAR_H,
  AVATAR_W,
  LIE_H,
  LIE_W,
  OUTLINE,
  Painter,
  RES,
  avatarPixels,
  avatarSize,
  lookFor,
  mix2,
  outlinePixels,
  rgb,
  showsFace,
  tone,
  type Facing,
  type Frame,
  type Look,
  type Pose,
  type RGB,
  type Tint,
} from '@coloxel/render';

/** One frame of the avatar on a canvas. */
export function avatarFrame(
  look: Look,
  facing: Facing = 'front',
  frame: Frame = 0,
  blink = false,
  pose: Pose = 'stand',
  tint: Tint = {},
): HTMLCanvasElement {
  const { w, h } = avatarSize(pose);
  const cv = document.createElement('canvas');
  cv.width = w;
  cv.height = h;
  cv.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(avatarPixels(look, facing, frame, blink, pose, tint)), w, h), 0, 0);
  return cv;
}

/** Standing front view, optionally with another shirt or hair color (used by the sign-in scene). */
export function avatarCanvas(shirt?: number, hair?: number): HTMLCanvasElement {
  return avatarFrame(lookFor('sign-in'), 'front', 0, false, 'stand', { top: shirt, hair });
}
