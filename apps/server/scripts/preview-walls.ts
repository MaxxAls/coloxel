// Hangs every wall piece on the walls of a painted room, to see how they sit. Usage: npx tsx apps/server/scripts/preview-walls.ts out.png
import { writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { CATALOGUE, ROOM_H, ROOM_W, floorStyle, paintRoom, renderRecipe, tileCenter, wallStyle, DEFAULT_FLOOR, DEFAULT_WALL } from '@coloxel/render';

const f = floorStyle(DEFAULT_FLOOR), w = wallStyle(DEFAULT_WALL);
const rgba = paintRoom({
  floor: { a: f.a, b: f.b, line: f.line, pattern: f.pattern },
  wall: { left: w.left, right: w.right, trim: w.trim, pattern: w.pattern },
  decor: 'apartment',
});
const buf = Buffer.from(rgba.buffer, rgba.byteOffset, rgba.byteLength);
const over = (sp: { data: Uint8ClampedArray; width: number; height: number; ax: number; ay: number }, cx: number, cy: number) => {
  for (let y = 0; y < sp.height; y++) for (let x = 0; x < sp.width; x++) {
    const a = sp.data[(y * sp.width + x) * 4 + 3]! / 255;
    if (a === 0) continue;
    const px = Math.round(cx - sp.ax + x), py = Math.round(cy - sp.ay + y);
    if (px < 0 || py < 0 || px >= ROOM_W || py >= ROOM_H) continue;
    const d = (py * ROOM_W + px) * 4;
    for (let c = 0; c < 3; c++) buf[d + c] = Math.round(sp.data[(y * sp.width + x) * 4 + c]! * a + buf[d + c]! * (1 - a));
  }
};
const pieces = CATALOGUE.filter((e) => e.wall);
// Left wall: cells (0, j), turn 0. Right wall: cells (i, 0), turn 1. Alternate the pieces between them.
pieces.forEach((e, k) => {
  const left = k % 2 === 0;
  const slot = 1 + Math.floor(k / 2) * 2;
  const cell = left ? { i: 0, j: slot } : { i: slot, j: 0 };
  const c = tileCenter(cell.i, cell.j);
  over(renderRecipe(e.recipe, left ? 0 : 1), c.x, c.y);
});
const W = ROOM_W, H = ROOM_H;
const crcT = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc = (b: Buffer) => { let c = 0xffffffff; for (const v of b) c = crcT[(c ^ v) & 255]! ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const chunk = (t: string, d: Buffer) => {
  const len = Buffer.alloc(4); len.writeUInt32BE(d.length);
  const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td));
  return Buffer.concat([len, td, c]);
};
const raw = Buffer.alloc((W * 4 + 1) * H);
for (let y = 0; y < H; y++) { raw[y * (W * 4 + 1)] = 0; buf.copy(raw, y * (W * 4 + 1) + 1, y * W * 4, (y + 1) * W * 4); }
const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4); ihdr[8] = 8; ihdr[9] = 6;
writeFileSync(process.argv[2] ?? 'walls.png', Buffer.concat([
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0)),
]));
