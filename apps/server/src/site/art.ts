import { PNG } from 'pngjs';
import {
  ANCHOR_X,
  ANCHOR_Y,
  ROOM_H,
  RES,
  ROOM_W,
  avatarPixels,
  avatarSize,
  catalogueEntry,
  floorStyle,
  lookFor,
  paintRoom,
  renderSprite,
  tileCenter,
  wallStyle,
  type Facing,
  type Look,
  type Pose,
  type RoomLook,
} from '@coloxel/render';

// Pictures for the website, drawn by the same engines as the game itself (the room painter, the sprite
// renderer, the avatar painter): what visitors see on the site is what players will find inside.

interface Canvas {
  w: number;
  h: number;
  data: Uint8ClampedArray;
}

const blank = (w: number, h: number): Canvas => ({ w, h, data: new Uint8ClampedArray(w * h * 4) });

/** Draw `src` over the canvas ("source over"), enlarged by `scale` without smoothing (shrunk, it is averaged). */
function over(dst: Canvas, src: ArrayLike<number>, sw: number, sh: number, dx: number, dy: number, scale = 1): void {
  if (scale < 1) {
    // Shrinking: every pixel of the result is the average of the pixels it covers, weighted by their opacity.
    const tw = Math.max(1, Math.round(sw * scale));
    const th = Math.max(1, Math.round(sh * scale));
    const small = new Uint8ClampedArray(tw * th * 4);
    for (let y = 0; y < th; y++) {
      for (let x = 0; x < tw; x++) {
        const x0 = Math.floor(x / scale), x1 = Math.min(sw, Math.max(x0 + 1, Math.ceil((x + 1) / scale)));
        const y0 = Math.floor(y / scale), y1 = Math.min(sh, Math.max(y0 + 1, Math.ceil((y + 1) / scale)));
        let r = 0, g = 0, b = 0, a = 0, n = 0;
        for (let sy = y0; sy < y1; sy++) {
          for (let sx = x0; sx < x1; sx++) {
            const i = (sy * sw + sx) * 4;
            const al = src[i + 3]!;
            r += src[i]! * al;
            g += src[i + 1]! * al;
            b += src[i + 2]! * al;
            a += al;
            n++;
          }
        }
        const o = (y * tw + x) * 4;
        if (a > 0) {
          small[o] = r / a;
          small[o + 1] = g / a;
          small[o + 2] = b / a;
          small[o + 3] = a / n;
        }
      }
    }
    over(dst, small, tw, th, dx, dy, 1);
    return;
  }
  const tw = Math.round(sw * scale);
  const th = Math.round(sh * scale);
  for (let y = 0; y < th; y++) {
    const py = Math.round(dy) + y;
    if (py < 0 || py >= dst.h) continue;
    const sy = Math.min(sh - 1, Math.floor(y / scale));
    for (let x = 0; x < tw; x++) {
      const px = Math.round(dx) + x;
      if (px < 0 || px >= dst.w) continue;
      const si = (sy * sw + Math.min(sw - 1, Math.floor(x / scale))) * 4;
      const a = src[si + 3]! / 255;
      if (a === 0) continue;
      const di = (py * dst.w + px) * 4;
      const da = dst.data[di + 3]! / 255;
      const oa = a + da * (1 - a);
      for (let c = 0; c < 3; c++) dst.data[di + c] = (src[si + c]! * a + dst.data[di + c]! * da * (1 - a)) / oa;
      dst.data[di + 3] = oa * 255;
    }
  }
}

/** A soft oval under a standing figure, as the game draws it. */
function shadow(dst: Canvas, cx: number, cy: number, rx: number, ry: number, alpha = 0.3): void {
  for (let y = -ry; y <= ry; y++) {
    const half = Math.round(rx * Math.sqrt(1 - (y / ry) ** 2));
    const row = new Uint8ClampedArray(Math.max(1, half * 2) * 4);
    for (let x = 0; x < half * 2; x++) {
      row[x * 4] = 27;
      row[x * 4 + 1] = 21;
      row[x * 4 + 2] = 48;
      row[x * 4 + 3] = alpha * 255;
    }
    over(dst, row, Math.max(1, half * 2), 1, cx - half, cy + y);
  }
}

const toPng = (c: Canvas) => {
  const png = new PNG({ width: c.w, height: c.h });
  png.data = Buffer.from(c.data.buffer, c.data.byteOffset, c.data.byteLength);
  return PNG.sync.write(png);
};

/** A player standing, as everybody sees them in the game. */
export function avatarPng(look: Look, scale = 5, facing: Facing = 'front', pose: Pose = 'stand'): Buffer {
  const { w, h } = avatarSize(pose);
  const out = blank(Math.round((w * scale) / RES), Math.round((h * scale) / RES));
  over(out, avatarPixels(look, facing, 0, false, pose), w, h, 0, 0, scale / RES);
  return toPng(out);
}

// ----- The scene of the home page ---------------------------------------------------------

interface Placed {
  /** Catalogue key. */
  key: string;
  i: number;
  j: number;
}
interface Person {
  seed: string;
  i: number;
  j: number;
  sit?: boolean;
}
interface RoomPlan {
  floor: string;
  wall: string;
  /** Where the room's top-left corner goes on the scene. */
  x: number;
  y: number;
  things: Placed[];
  people: Person[];
}

/** Pixels of the scene for one pixel of the avatar's design grid. */
const PX = 1.5;
const BODY_SCALE = PX / RES;

const roomLook = (floor: string, wall: string): RoomLook => {
  const f = floorStyle(floor);
  const w = wallStyle(wall);
  return {
    floor: { a: f.a, b: f.b, line: f.line, pattern: f.pattern },
    wall: { left: w.left, right: w.right, trim: w.trim, pattern: w.pattern },
    decor: 'apartment',
  };
};

function drawRoom(scene: Canvas, plan: RoomPlan): void {
  const room = paintRoom(roomLook(plan.floor, plan.wall));
  over(scene, room, ROOM_W, ROOM_H, plan.x, plan.y);

  // Furniture and people are drawn back to front, like in the game.
  type Item = { depth: number; draw: () => void };
  const items: Item[] = [];
  for (const t of plan.things) {
    const entry = catalogueEntry(t.key);
    if (!entry) continue;
    const sprite = renderSprite(entry.recipe.parts);
    const c = tileCenter(t.i, t.j);
    items.push({
      depth: t.i + t.j,
      draw: () => over(scene, sprite.data, sprite.width, sprite.height, plan.x + c.x - ANCHOR_X, plan.y + c.y - ANCHOR_Y),
    });
  }
  for (const p of plan.people) {
    const pose: Pose = p.sit ? 'sit' : 'stand';
    const { w, h } = avatarSize(pose);
    const look = lookFor(p.seed);
    const c = tileCenter(p.i, p.j);
    const facing: Facing = p.sit ? 'front34' : 'front';
    const pixels = avatarPixels(look, facing, 0, false, pose);
    items.push({
      depth: p.i + p.j + 0.5,
      draw: () => {
        if (!p.sit) shadow(scene, plan.x + c.x, plan.y + c.y + 1, 15, 7);
        const dx = plan.x + c.x - (w * BODY_SCALE) / 2 + (p.sit ? 3 * PX : 0);
        const dy = plan.y + c.y + (p.sit ? 4 : 10) * PX - h * BODY_SCALE;
        over(scene, pixels, w, h, dx, dy, BODY_SCALE);
      },
    });
  }
  items.sort((a, b) => a.depth - b.depth).forEach((it) => it.draw());
}

/** Three furnished apartments, side by side and stacked, with their inhabitants: the picture of the home page. */
export function heroScenePng(): Buffer {
  const plans: RoomPlan[] = [
    {
      floor: 'chene',
      wall: 'violet',
      x: 20,
      y: 10,
      things: [
        { key: 'lit', i: 1, j: 1 },
        { key: 'chevet', i: 0, j: 3 },
        { key: 'ficus', i: 0, j: 0 },
        { key: 'armoire', i: 4, j: 0 },
        { key: 'tapisrond', i: 4, j: 4 },
        { key: 'lampadaire', i: 6, j: 1 },
        { key: 'ours', i: 3, j: 2 },
      ],
      people: [{ seed: 'hero-lia', i: 4, j: 3 }],
    },
    {
      floor: 'damier',
      wall: 'ciel',
      x: 440,
      y: 200,
      things: [
        { key: 'canapementhe', i: 1, j: 5, },
        { key: 'tablebasse', i: 3, j: 4 },
        { key: 'tele', i: 0, j: 2 },
        { key: 'aquarium', i: 0, j: 5 },
        { key: 'piano', i: 5, j: 1 },
        { key: 'monstera', i: 6, j: 6 },
        { key: 'lampelave', i: 2, j: 0 },
      ],
      people: [
        { seed: 'hero-max', i: 3, j: 6 },
        { seed: 'hero-nour', i: 5, j: 3 },
      ],
    },
    {
      floor: 'noyer',
      wall: 'bonbon',
      x: 860,
      y: 30,
      things: [
        { key: 'cheminee', i: 0, j: 3 },
        { key: 'fauteuilsoleil', i: 2, j: 3 },
        { key: 'etagere', i: 0, j: 0 },
        { key: 'table', i: 4, j: 4 },
        { key: 'chaisepop', i: 4, j: 2 },
        { key: 'cactus', i: 6, j: 0 },
        { key: 'arcade', i: 1, j: 6 },
      ],
      people: [
        { seed: 'hero-zoe', i: 5, j: 5 },
        { seed: 'hero-ali', i: 3, j: 3, sit: true },
      ],
    },
  ];
  const scene = blank(1480, 640);
  // The room behind goes first, the ones in front of it after.
  for (const plan of [...plans].sort((a, b) => a.y - b.y)) drawRoom(scene, plan);
  return toPng(scene);
}
