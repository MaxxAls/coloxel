// Draws every piece of the catalogue on one sheet, zoomed, to judge the drawing up close.
// Usage: npx tsx apps/server/scripts/preview-catalogue.ts out.png [zoom] [key,key,...]
import { writeFileSync } from 'node:fs';
import { PNG } from 'pngjs';
import { CATALOGUE, renderRecipe } from '@coloxel/render';

const zoom = Number(process.argv[3] ?? 2);
const only = process.argv[4]?.split(',');
const pieces = only ? CATALOGUE.filter((e) => only.includes(e.key)) : CATALOGUE;
const sprites = pieces.map((e) => renderRecipe(e.recipe, 0));
const cols = Math.min(8, sprites.length);
const cellW = Math.max(...sprites.map((s) => s.width)), cellH = Math.max(...sprites.map((s) => s.height));
const rows = Math.ceil(sprites.length / cols);
const W = cols * cellW * zoom, H = rows * cellH * zoom;
const png = new PNG({ width: W, height: H });
for (let k = 0; k < W * H; k++) png.data.set([0x4a, 0x44, 0x5c, 255], k * 4);
sprites.forEach((sp, n) => {
  const ox = (n % cols) * cellW + ((cellW - sp.width) >> 1), oy = Math.floor(n / cols) * cellH + (cellH - sp.height);
  for (let y = 0; y < sp.height; y++) for (let x = 0; x < sp.width; x++) {
    const s = (y * sp.width + x) * 4, a = sp.data[s + 3]! / 255;
    if (!a) continue;
    for (let dy = 0; dy < zoom; dy++) for (let dx = 0; dx < zoom; dx++) {
      const d = (((oy + y) * zoom + dy) * W + (ox + x) * zoom + dx) * 4;
      for (let c = 0; c < 3; c++) png.data[d + c] = Math.round(sp.data[s + c]! * a + png.data[d + c]! * (1 - a));
    }
  }
});
writeFileSync(process.argv[2] ?? 'catalogue.png', PNG.sync.write(png));
