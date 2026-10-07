import { Texture } from 'pixi.js';
import { avatarFrame, type Facing, type Frame, type Look } from './avatar';
import { furnitureSpriteUrl, itemSpriteUrl } from './api';

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

export const itemTexture = (id: string) => loadTexture(`item:${id}`, itemSpriteUrl(id));
export const furnitureTexture = (key: string) => loadTexture(`furniture:${key}`, furnitureSpriteUrl(key));

const avatarCache = new Map<string, Texture>();
export function avatarTexture(look: Look, facing: Facing, frame: Frame): Texture {
  const key = `${look.skin}.${look.hair}.${look.hairStyle}.${look.shirt}.${look.pants}.${facing}.${frame}`;
  let tex = avatarCache.get(key);
  if (!tex) {
    tex = nearest(Texture.from(avatarFrame(look, facing, frame)));
    avatarCache.set(key, tex);
  }
  return tex;
}
