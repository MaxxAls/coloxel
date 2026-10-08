// Draws every texture on a box plus a lit lamp to a PNG, to judge the look by eye.
// Usage: npx tsx apps/server/scripts/preview-textures.ts out.png
import { writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { SPRITE_H, SPRITE_W, TEXTURES, renderSprite } from '@coloxel/render';

const COLORS: Record<string, string> = {
  wood: '#9a6a3e', planks: '#b98a52', logs: '#a9743f', stone: '#8d8f94', brick: '#b5533c', tile: '#9fc7d6',
  fabric: '#c85a7a', weave: '#c9a35e', thatch: '#c8a24e', grass: '#4f9a3c', leaves: '#3f8a3a', metal: '#9aa3ad',
  stripes: '#5a82c8', checker: '#d8d0c0', dots: '#d86a6a', marble: '#d9d6d2', glass: '#8fc8e8', water: '#3f9ad0',
};

const tiles = TEXTURES.map((tex) => renderSprite([
  { t: 'box', x0: -7, x1: 7, y0: -7, y1: 7, z0: 0, z1: 14, c: COLORS[tex] ?? '#999999', tex },
]));
const lamp = renderSprite([
  { t: 'cyl', x: 0, y: 0, r: 3, z0: 0, z1: 2, side: '#6a4a2a' },
  { t: 'cyl', x: 0, y: 0, r: 1, z0: 2, z1: 14, side: '#8a6a3a' },
  { t: 'cyl', x: 0, y: 0, r: 5, z0: 14, z1: 22, side: '#f1d9a0', top: '#fff0c0' },
  { t: 'glow', x: 0, y: 0, z: 17, r: 22, c: '#ffd070', a: 0.8 },
]);
const all = [...tiles, lamp];
const cols = 6, rows = Math.ceil(all.length / cols);
const W = cols * SPRITE_W, H = rows * SPRITE_H;
const rgba = Buffer.alloc(W * H * 4, 0);
for (let i = 0; i < W * H; i++) { rgba[i * 4] = 0x2a; rgba[i * 4 + 1] = 0x24; rgba[i * 4 + 2] = 0x3c; rgba[i * 4 + 3] = 255; }
all.forEach((sp, n) => {
  const ox = (n % cols) * SPRITE_W, oy = Math.floor(n / cols) * SPRITE_H;
  for (let y = 0; y < SPRITE_H; y++) for (let x = 0; x < SPRITE_W; x++) {
    const s = (y * SPRITE_W + x) * 4, d = ((oy + y) * W + ox + x) * 4, a = sp.data[s + 3]! / 255;
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
writeFileSync(process.argv[2] ?? 'textures.png', Buffer.concat([
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0)),
]));
