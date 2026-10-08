// A sheet of avatars in every pose and view, zoomed, to check how they are drawn.
// Usage: npx tsx apps/server/scripts/preview-avatars.ts out.png
import { writeFileSync } from 'node:fs';
import { PNG } from 'pngjs';
import { avatarPixels, avatarSize, lookFor, type Facing, type Frame, type Pose } from '@coloxel/render';

const ZOOM = 3;
const views: [Facing, Frame, Pose][] = [
  ['front', 0, 'stand'],
  ['front34', 1, 'stand'],
  ['side', 2, 'stand'],
  ['back34', 0, 'stand'],
  ['back', 0, 'stand'],
  ['front34', 0, 'sit'],
  ['back34', 0, 'sit'],
  ['front', 0, 'lie'],
];
const looks = ['alice', 'bob', 'chloe', 'dmitri', 'emma', 'farid'].map(lookFor);
const cellW = Math.max(...views.map((v) => avatarSize(v[2]).w)) + 8;
const cellH = Math.max(...views.map((v) => avatarSize(v[2]).h)) + 8;
const W = views.length * cellW * ZOOM, H = looks.length * cellH * ZOOM;
const png = new PNG({ width: W, height: H });
png.data.fill(0);
for (let k = 0; k < W * H; k++) png.data.set([58, 52, 84, 255], k * 4);
looks.forEach((look, row) => {
  views.forEach(([facing, frame, pose], col) => {
    const { w, h } = avatarSize(pose);
    const px = avatarPixels(look, facing, frame, false, pose);
    const ox = col * cellW + 4, oy = row * cellH + 4 + (cellH - 8 - h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const a = px[(y * w + x) * 4 + 3]!;
      if (!a) continue;
      for (let dy = 0; dy < ZOOM; dy++) for (let dx = 0; dx < ZOOM; dx++) {
        const d = (((oy + y) * ZOOM + dy) * W + (ox + x) * ZOOM + dx) * 4;
        png.data.set(px.subarray((y * w + x) * 4, (y * w + x) * 4 + 4), d);
      }
    }
  });
});
writeFileSync(process.argv[2] ?? 'avatars.png', PNG.sync.write(png));
