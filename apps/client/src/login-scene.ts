// Animated pixel-art backdrop for the sign-in screen: a dusk city with two
// cut-away apartment buildings. The objects in the rooms come from the shared
// render engine, so they look exactly like the ones players invent.
import { SEEDS, renderSprite, ANCHOR_X, ANCHOR_Y } from '@coloxel/render';
import { avatarCanvas } from './avatar';

const W = 640;
const H = 360;
const FPS = 20;

const SKY = ['#1a1046', '#26135a', '#3a1a6e', '#5a2582', '#8a2f8e', '#c0408f', '#ec5f84', '#ff8f7a', '#ffc27a'];
const WALLS = ['#8a7fc0', '#e58fb0', '#7fc4c0', '#f0b86e', '#9a8ae0', '#86c47a'];
const FLOORS = ['#b88b56', '#a67a49', '#c79a62'];

function rand(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function spriteCanvas(parts: readonly unknown[]): HTMLCanvasElement {
  const s = renderSprite(parts);
  const cv = document.createElement('canvas');
  cv.width = s.width;
  cv.height = s.height;
  cv.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(s.data), s.width, s.height), 0, 0);
  return cv;
}

interface Room {
  x: number;
  y: number;
  w: number;
  h: number;
  wall: string;
  floor: string;
  object: number; // index in `objects`, or -1
  objectDx: number;
  walker: number; // avatar index, or -1
  window: boolean;
}

/** Starts the animation on `canvas`. Returns a function that stops it. */
export function startLoginScene(canvas: HTMLCanvasElement): () => void {
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d')!;
  ctx.imageSmoothingEnabled = false;

  const objects = SEEDS.map((seed) => spriteCanvas(seed.parts));
  const walkers = [avatarCanvas(0xe2483d), avatarCanvas(0x35b57c, 0xd9a441), avatarCanvas(0xf2c230, 0x222222)];

  const rnd = rand(7);
  const stars = Array.from({ length: 70 }, () => ({
    x: Math.floor(rnd() * W),
    y: Math.floor(rnd() * 190),
    phase: rnd() * 6,
    big: rnd() > 0.85,
  }));
  const clouds = Array.from({ length: 6 }, (_, k) => ({
    x: rnd() * W,
    y: 70 + k * 26 + rnd() * 10,
    w: 40 + rnd() * 50,
    speed: 3 + rnd() * 5,
  }));
  const skyline = Array.from({ length: 22 }, (_, k) => ({
    x: 150 + k * 16,
    w: 12 + Math.floor(rnd() * 8),
    h: 60 + Math.floor(rnd() * 120),
    tone: rnd() > 0.5 ? '#2a1a5a' : '#341f6a',
  }));
  const sparkles = Array.from({ length: 16 }, () => ({
    x: rnd() * W,
    y: rnd() * H,
    speed: 6 + rnd() * 12,
    phase: rnd() * 6,
  }));

  // Two buildings of 2 x 3 rooms flanking the middle, where the sign-in card sits.
  const rooms: Room[] = [];
  const buildings = [
    { x: 14, y: 52 },
    { x: 454, y: 52 },
  ];
  const ROOM_W = 82;
  const ROOM_H = 94;
  buildings.forEach((b, bi) => {
    for (let r = 0; r < 3; r++) {
      for (let c = 0; c < 2; c++) {
        const k = bi * 6 + r * 2 + c;
        rooms.push({
          x: b.x + 6 + c * (ROOM_W + 4),
          y: b.y + 14 + r * (ROOM_H + 4),
          w: ROOM_W,
          h: ROOM_H,
          wall: WALLS[(k * 5 + 1) % WALLS.length]!,
          floor: FLOORS[k % FLOORS.length]!,
          object: k % 7 === 3 ? -1 : k % objects.length,
          objectDx: ((k * 13) % 24) - 12,
          walker: k % 4 === 1 ? (k >> 1) % walkers.length : -1,
          window: k % 3 !== 1,
        });
      }
    }
  });

  const px = (color: string, x: number, y: number, w: number, h: number) => {
    ctx.fillStyle = color;
    ctx.fillRect(Math.round(x), Math.round(y), w, h);
  };

  function drawSky(t: number) {
    const band = Math.ceil(250 / SKY.length);
    SKY.forEach((c, i) => px(c, 0, i * band, W, band + 1));
    // Dithered seam between bands.
    for (let i = 1; i < SKY.length; i++) {
      for (let x = 0; x < W; x += 4) px(SKY[i]!, x + (i % 2) * 2, i * band - 2, 2, 2);
    }
    px(SKY[SKY.length - 1]!, 0, 250, W, H - 250);

    for (const s of stars) {
      const on = Math.sin(t / 500 + s.phase) > -0.3;
      if (!on) continue;
      px('#fff7d6', s.x, s.y, s.big ? 2 : 1, s.big ? 2 : 1);
      if (s.big) {
        px('#fff7d6', s.x - 1, s.y, 1, 1);
        px('#fff7d6', s.x + 2, s.y, 1, 1);
        px('#fff7d6', s.x, s.y - 1, 1, 1);
        px('#fff7d6', s.x, s.y + 2, 1, 1);
      }
    }

    // Moon with craters.
    const mx = 330;
    const my = 44;
    for (let dy = -16; dy <= 16; dy++) {
      const half = Math.floor(Math.sqrt(256 - dy * dy));
      px('#fff2c4', mx - half, my + dy, half * 2, 1);
    }
    px('#ecd79a', mx - 6, my - 6, 5, 5);
    px('#ecd79a', mx + 4, my + 3, 6, 6);
    px('#ecd79a', mx - 9, my + 6, 3, 3);

    for (const c of clouds) {
      const x = ((c.x + (t / 1000) * c.speed) % (W + 120)) - 60;
      px('#ff9bb8', x, c.y, c.w, 6);
      px('#ff9bb8', x + 8, c.y - 5, c.w * 0.5, 6);
      px('#ffc7d6', x + 4, c.y - 3, c.w * 0.3, 2);
    }
  }

  function drawSkyline(t: number) {
    for (const b of skyline) {
      const top = 340 - b.h;
      px(b.tone, b.x, top, b.w, b.h);
      for (let wy = top + 6; wy < 336; wy += 9) {
        for (let wx = b.x + 3; wx < b.x + b.w - 3; wx += 5) {
          const on = ((wx * 7 + wy * 3 + Math.floor(t / 3000)) % 5) < 2;
          if (on) px('#ffd36e', wx, wy, 2, 3);
        }
      }
    }
  }

  function drawRoom(room: Room, idx: number, t: number) {
    const { x, y, w, h } = room;
    const lit = (Math.floor(t / 3500) + idx * 7) % 6 !== 0;
    px(room.wall, x, y, w, h - 26);
    px('#00000022', x, y + h - 30, w, 4); // baseboard shade
    px(room.floor, x, y + h - 26, w, 26);
    for (let i = 0; i < w; i += 14) px('#0000001a', x + i, y + h - 26, 1, 26);
    px('#00000022', x, y + h - 26, w, 2);

    if (room.window) {
      const wx = x + w - 30;
      px('#4a3f7a', wx - 2, y + 10, 24, 28);
      px('#9fd3f0', wx, y + 12, 20, 24);
      px('#ffe9a8', wx + 12, y + 14, 3, 3);
      px('#4a3f7a', wx + 9, y + 12, 2, 24);
      px('#4a3f7a', wx, y + 23, 20, 2);
    } else {
      // Framed picture.
      px('#4a3f7a', x + 12, y + 14, 22, 18);
      px('#ffc857', x + 14, y + 16, 18, 14);
      px('#e2483d', x + 18, y + 22, 8, 8);
    }

    const baseY = y + h - 14;
    if (room.object >= 0) {
      const o = objects[room.object]!;
      const bob = Math.round(Math.sin(t / 700 + idx) * 1);
      ctx.drawImage(o, x + w / 2 + room.objectDx - ANCHOR_X, baseY - ANCHOR_Y + bob);
    }

    if (room.walker >= 0) {
      const span = w - 34;
      const phase = (t / 55 + idx * 31) % (span * 2);
      const goingRight = phase < span;
      const ax = x + 8 + (goingRight ? phase : span * 2 - phase);
      const step = Math.floor(t / 150) % 2;
      const img = walkers[room.walker]!;
      ctx.save();
      if (!goingRight) {
        ctx.translate(Math.round(ax) + img.width * 2, 0);
        ctx.scale(-1, 1);
        ctx.drawImage(img, 0, baseY - img.height * 2 + 6 - step * 2, img.width * 2, img.height * 2);
      } else {
        ctx.drawImage(img, Math.round(ax), baseY - img.height * 2 + 6 - step * 2, img.width * 2, img.height * 2);
      }
      ctx.restore();
    }

    if (!lit) px('#120f2299', x, y, w, h);
  }

  function drawBuilding(bx: number, by: number, sign: boolean, t: number) {
    const bw = 2 * ROOM_W + 16;
    const bh = 3 * ROOM_H + 12 + 18 + 4;
    px('#1e1640', bx - 4, by - 4, bw + 8, bh + 8); // outline
    px('#4a3f7a', bx, by, bw, bh);
    // Roof with a sign and a blinking antenna.
    px('#2b2150', bx - 6, by - 14, bw + 12, 14);
    px('#ffc857', bx - 6, by - 14, bw + 12, 2);
    if (sign) {
      px('#e2483d', bx + 22, by - 28, 60, 14);
      for (let i = 0; i < 6; i++) px(i % 2 ? '#fff7d6' : '#ffc857', bx + 26 + i * 9, by - 24, 5, 6);
    }
    px('#2b2150', bx + bw - 24, by - 36, 3, 22);
    if (Math.floor(t / 500) % 2) px('#ff5a5a', bx + bw - 25, by - 40, 5, 5);
    // Ground floor door.
    px('#2b2150', bx + bw / 2 - 12, by + bh - 20, 24, 20);
    px('#ffc857', bx + bw / 2 + 6, by + bh - 11, 2, 2);
  }

  function drawStreet(t: number) {
    px('#1a1238', 0, 340, W, 20);
    px('#2e2260', 0, 340, W, 3);
    for (let x = -((t / 30) % 32); x < W; x += 32) px('#ffc857', x, 352, 14, 2);
    // Street lamps.
    for (const lx of [200, 440]) {
      px('#2b2150', lx, 306, 3, 34);
      px('#2b2150', lx - 4, 304, 11, 3);
      px('#ffe9a8', lx - 3, 307, 9, 3);
      px('#ffe9a822', lx - 12, 310, 27, 30);
    }
  }

  function drawSparkles(t: number) {
    for (const s of sparkles) {
      const y = H - ((s.y + (t / 1000) * s.speed) % H);
      const on = Math.sin(t / 300 + s.phase) > 0;
      if (!on) continue;
      px('#ffe28a', s.x, y, 2, 2);
      px('#ffe28a88', s.x - 2, y, 2, 2);
      px('#ffe28a88', s.x + 2, y, 2, 2);
      px('#ffe28a88', s.x, y - 2, 2, 2);
      px('#ffe28a88', s.x, y + 2, 2, 2);
    }
  }

  function frame(t: number) {
    drawSky(t);
    drawSkyline(t);
    buildings.forEach((b, i) => drawBuilding(b.x, b.y, i === 0, t));
    rooms.forEach((room, i) => drawRoom(room, i, t));
    drawStreet(t);
    drawSparkles(t);
  }

  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  frame(4000);
  if (reduceMotion) return () => {};

  let raf = 0;
  let last = 0;
  const loop = (now: number) => {
    raf = requestAnimationFrame(loop);
    if (document.hidden || now - last < 1000 / FPS) return;
    last = now;
    frame(now);
  };
  raf = requestAnimationFrame(loop);
  return () => cancelAnimationFrame(raf);
}
