// Draws the multi-tile base furniture (and a turned copy of each) to a PNG.
// Usage: npx tsx apps/server/scripts/preview-big.ts out.png
import { writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { CATALOGUE, renderRecipe } from '@coloxel/render';

const pieces = CATALOGUE.filter((e) => e.recipe.size);
const sprites = pieces.flatMap((e) => [renderRecipe(e.recipe, 0), renderRecipe(e.recipe, 1)]);
const cols = 4;
const cellW = Math.max(...sprites.map((s) => s.width)), cellH = Math.max(...sprites.map((s) => s.height));
const rows = Math.ceil(sprites.length / cols);
const W = cols * cellW, H = rows * cellH;
const rgba = Buffer.alloc(W * H * 4);
for (let i = 0; i < W * H; i++) { rgba[i * 4] = 0x4a; rgba[i * 4 + 1] = 0x44; rgba[i * 4 + 2] = 0x5c; rgba[i * 4 + 3] = 255; }
sprites.forEach((sp, n) => {
  const ox = (n % cols) * cellW + ((cellW - sp.width) >> 1), oy = Math.floor(n / cols) * cellH + (cellH - sp.height);
  for (let y = 0; y < sp.height; y++) for (let x = 0; x < sp.width; x++) {
    const s = (y * sp.width + x) * 4, d = ((oy + y) * W + ox + x) * 4, a = sp.data[s + 3]! / 255;
    for (let c = 0; c < 3; c++) rgba[d + c] = Math.round(sp.data[s + c]! * a + rgba[d + c]! * (1 - a));
  }
});
const crcT = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc = (b: Buffer) => { let c = 0xffffffff; for (const v of b) c = crcT[(c ^ v) & 255]! ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const chunk = (t: string, d: Buffer) => {
  const len = Buffer.alloc(4); len.writeUInt32BE(d.length);
  const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td));
  return Buffer.concat([len, td, c]);
};
const raw = Buffer.alloc((W * 4 + 1) * H);
for (let y = 0; y < H; y++) { raw[y * (W * 4 + 1)] = 0; rgba.copy(raw, y * (W * 4 + 1) + 1, y * W * 4, (y + 1) * W * 4); }
const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4); ihdr[8] = 8; ihdr[9] = 6;
writeFileSync(process.argv[2] ?? 'big.png', Buffer.concat([
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0)),
]));
