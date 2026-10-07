import { furnitureSpriteUrl } from './api';

/**
 * Base furniture sprites are small in their 96 x 112 frame: show them zoomed on
 * the object (nearest-neighbour, like everywhere), inside a box of fixed size.
 */
export function furnitureThumb(key: string, size: 'sm' | 'lg'): HTMLElement {
  const box = document.createElement('span');
  box.className = `thumb ${size}`;
  const img = document.createElement('img');
  img.src = furnitureSpriteUrl(key);
  img.alt = '';
  img.width = 96;
  img.height = 112;
  box.append(img);
  return box;
}
