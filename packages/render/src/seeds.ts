import type { Recipe } from './types';

/** Example objects from the Atelier Pixel prototype. */
export const SEEDS: Recipe[] = [
  {
    name: 'Chocolatine GT',
    parts: [
      { t: 'circle', x: -6, y: -4.5, z: 2.5, r: 3, c: '#1c1c1c', c2: '#9a9a9a' },
      { t: 'circle', x: 6, y: -4.5, z: 2.5, r: 3, c: '#1c1c1c', c2: '#9a9a9a' },
      { t: 'box', x0: -9, x1: 9, y0: -4.5, y1: 4.5, z0: 2, z1: 9, c: '#e8a94a' },
      { t: 'quad', pts: [[-9, 4.5, 4], [9, 4.5, 4], [9, 4.5, 4.8], [-9, 4.5, 4.8]], c: '#9c6420' },
      { t: 'quad', pts: [[-9, 4.5, 6.4], [9, 4.5, 6.4], [9, 4.5, 7.2], [-9, 4.5, 7.2]], c: '#9c6420' },
      { t: 'quad', pts: [[9, -4.5, 5.6], [9, 4.5, 5.6], [9, 4.5, 6.4], [9, -4.5, 6.4]], c: '#7f5018' },
      { t: 'pix', x: -5, y: -2, z: 9, w: 2, h: 1, c: '#b8721f' },
      { t: 'pix', x: 4, y: 1, z: 9, w: 2, h: 1, c: '#b8721f' },
      { t: 'pix', x: -7, y: 2, z: 9, w: 1, h: 1, c: '#fff3d6' },
      { t: 'box', x0: -3, x1: 4, y0: -3.5, y1: 3.5, z0: 9, z1: 13, c: '#f0b85a' },
      { t: 'quad', pts: [[-2, 3.5, 10], [3, 3.5, 10], [3, 3.5, 12.3], [-2, 3.5, 12.3]], c: '#9ad0f5' },
      { t: 'quad', pts: [[4, -2.5, 10], [4, 2.5, 10], [4, 2.5, 12.3], [4, -2.5, 12.3]], c: '#7fb6db' },
      { t: 'box', x0: 9, x1: 10.5, y0: -4, y1: 4, z0: 4, z1: 5, c: '#6b3d22' },
      { t: 'box', x0: 9, x1: 10.5, y0: -4, y1: 4, z0: 7, z1: 8, c: '#6b3d22' },
      { t: 'pix', x: 9, y: -3.5, z: 3.2, w: 2, h: 1, c: '#ffe58a' },
      { t: 'pix', x: 9, y: 3, z: 3.2, w: 2, h: 1, c: '#ffe58a' },
      { t: 'circle', x: -6, y: 4.5, z: 2.5, r: 3, c: '#1c1c1c', c2: '#9a9a9a' },
      { t: 'circle', x: 6, y: 4.5, z: 2.5, r: 3, c: '#1c1c1c', c2: '#9a9a9a' },
    ],
  },
  {
    name: 'Monstera Zen',
    parts: [
      { t: 'cyl', x: 0, y: 0, r: 3.5, z0: 0, z1: 7, top: '#5a3a22', side: '#d9774a' },
      { t: 'sphere', x: -1, y: 1, z: 11, r: 4, c: '#3f9b4b' },
      { t: 'sphere', x: 1, y: -1, z: 14, r: 4, c: '#4fb35a' },
      { t: 'sphere', x: 0, y: 1, z: 17, r: 3, c: '#6fcf6a' },
    ],
  },
  {
    name: 'Table de mamie',
    parts: [
      { t: 'box', x0: -6, x1: -5, y0: -6, y1: -5, z0: 0, z1: 9, c: '#6e4a2c' },
      { t: 'box', x0: 5, x1: 6, y0: -6, y1: -5, z0: 0, z1: 9, c: '#6e4a2c' },
      { t: 'box', x0: -6, x1: -5, y0: 5, y1: 6, z0: 0, z1: 9, c: '#6e4a2c' },
      { t: 'box', x0: 5, x1: 6, y0: 5, y1: 6, z0: 0, z1: 9, c: '#6e4a2c' },
      { t: 'box', x0: -7, x1: 7, y0: -7, y1: 7, z0: 9, z1: 11, c: '#8b5e3c' },
      { t: 'cyl', x: 1, y: 1, r: 1.6, z0: 11, z1: 14.5, top: '#7a4a2a', side: '#f2f2f2' },
    ],
  },
];
