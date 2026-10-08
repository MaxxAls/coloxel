import { Texture } from 'pixi.js';
import { avatarFrame, type Facing, type Frame, type Look, type Pose } from './avatar';
import { furnitureSpriteUrl, itemSpriteUrl } from './api';
import { petCanvas, type PetFrame } from './pets';

const nearest = (tex: Texture) => {
  tex.source.scaleMode = 'nearest';
  return tex;
};

// Sprites are rendered by the server from the stored recipe (same engine as packages/render).
const itemCache = new Map<string, Promise<Texture>>();
const loadTexture = (cacheKey: string, url: string): Promise<Texture> => {
  const id = cacheKey;
  let tex = itemCache.get(id);
  if (!tex) {
    tex = new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(nearest(Texture.from(img)));
      img.onerror = () => {
        itemCache.delete(id);
        reject(new Error('sprite load failed'));
      };
      img.src = url;
    });
    itemCache.set(id, tex);
  }
  return tex;
};

export const itemTexture = (id: string, rot = 0) => loadTexture(`item:${id}:${rot}`, itemSpriteUrl(id, rot));
export const furnitureTexture = (key: string, rot = 0, alt = false) => loadTexture(`furniture:${key}:${rot}${alt ? ':alt' : ''}`, furnitureSpriteUrl(key, rot, alt));

const avatarCache = new Map<string, Texture>();
export function avatarTexture(look: Look, facing: Facing, frame: Frame, blink = false, pose: Pose = 'stand'): Texture {
  const key = `${pose}.${Object.values(look).join(".")}.${facing}.${frame}.${blink ? 1 : 0}`;
  let tex = avatarCache.get(key);
  if (!tex) {
    // The sprite is drawn at twice the resolution it is shown at, so it is smoothed down, not sampled.
    tex = Texture.from(avatarFrame(look, facing, frame, blink, pose));
    tex.source.scaleMode = 'linear';
    avatarCache.set(key, tex);
  }
  return tex;
}

const petCache = new Map<string, Texture>();
export function petTexture(species: string, color: number, frame: PetFrame): Texture {
  const key = `${species}.${color}.${frame}`;
  let tex = petCache.get(key);
  if (!tex) {
    tex = nearest(Texture.from(petCanvas(species, color, frame)));
    petCache.set(key, tex);
  }
  return tex;
}

let glow: Texture | null = null;
/** A soft round halo, white at the centre: tinted and drawn additively to light things up. */
export function glowTexture(): Texture {
  if (!glow) {
    const size = 128;
    const cv = document.createElement('canvas');
    cv.width = size;
    cv.height = size;
    const ctx = cv.getContext('2d')!;
    const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    g.addColorStop(0, 'rgba(255,255,255,0.9)');
    g.addColorStop(0.35, 'rgba(255,255,255,0.35)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
    glow = Texture.from(cv);
  }
  return glow;
}
