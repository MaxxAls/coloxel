import { catalogueEntry, frameFor, normalizeSize } from '@coloxel/render';
import { furnitureSpriteUrl } from './api';

/**
 * Base furniture sprites are small in their 96 x 112 frame: show them zoomed on
 * the object (nearest-neighbour, like everywhere), inside a box of fixed size.
 */
export function furnitureThumb(key: string, size_: 'sm' | 'lg'): HTMLElement {
  const box = document.createElement('span');
  box.className = `thumb ${size_}`;
  const img = document.createElement('img');
  img.src = furnitureSpriteUrl(key);
  img.alt = '';
  img.width = 192;
  img.height = 224;
  // A piece on several tiles has a bigger frame: centre the view on the middle of its footprint, and shrink it to fit.
  const size = normalizeSize(catalogueEntry(key)?.recipe.size);
  const [w, h] = size;
  if (w * h > 1) {
    const f = frameFor(size);
    const cx = f.ax + 16 * (w - h);
    const cy = f.ay - 30 + 8 * (w + h - 2);
    img.width = f.width;
    img.height = f.height;
    img.style.left = `calc(50% - ${cx}px)`;
    img.style.top = `calc(50% - ${cy}px)`;
    img.style.transformOrigin = `${cx}px ${cy}px`;
    img.style.transform = `scale(${((size_ === 'lg' ? 0.85 : 0.5) * 2) / (w + h)})`;
  }
  box.append(img);
  return box;
}
