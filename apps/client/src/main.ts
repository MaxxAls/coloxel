import { Application, Container, Graphics, Sprite, Texture } from 'pixi.js';
import { ANCHOR_X, ANCHOR_Y, SEEDS, renderSprite, type Recipe } from '@coloxel/render';
import { N, OX, OY, TH, TW, findPath, tileAt, tileCenter, type Cell } from './room';

const W = 300, H = 216;
const STEP_MS = 150;

function recipeTexture(recipe: Recipe): Texture {
  const s = renderSprite(recipe.parts);
  const cv = document.createElement('canvas');
  cv.width = s.width;
  cv.height = s.height;
  cv.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(s.data), s.width, s.height), 0, 0);
  const tex = Texture.from(cv);
  tex.source.scaleMode = 'nearest';
  return tex;
}

function diamond(g: Graphics, cx: number, cy: number, hw: number, hh: number) {
  g.poly([cx, cy - hh, cx + hw, cy, cx, cy + hh, cx - hw, cy]);
}

function drawRoom(): Graphics {
  const g = new Graphics();
  const L = N * (TW / 2), WH = 58, topY = OY - TH / 2;
  g.poly([OX - L, topY + L / 2, OX, topY, OX, topY - WH, OX - L, topY + L / 2 - WH]).fill(0x8a7fc0);
  g.poly([OX, topY, OX + L, topY + L / 2, OX + L, topY + L / 2 - WH, OX, topY - WH]).fill(0x6c61a3);
  // Window on the right wall: frame, sky, cross bars.
  const wx = OX + 40, wy = topY - 45;
  const slope = (x: number) => (x - OX) / 2;
  g.poly([wx, wy + slope(wx), wx + 28, wy + slope(wx + 28), wx + 28, wy + slope(wx + 28) + 30, wx, wy + slope(wx) + 30]).fill(0x4a3f7a);
  g.poly([wx + 2, wy + slope(wx + 2) + 2, wx + 26, wy + slope(wx + 26) + 2, wx + 26, wy + slope(wx + 26) + 28, wx + 2, wy + slope(wx + 2) + 28]).fill(0x9fd3f0);
  g.poly([wx + 13, wy + slope(wx + 13) + 2, wx + 15, wy + slope(wx + 15) + 2, wx + 15, wy + slope(wx + 15) + 28, wx + 13, wy + slope(wx + 13) + 28]).fill(0x4a3f7a);
  for (let i = 0; i < N; i++) {
    for (let j = 0; j < N; j++) {
      const { x, y } = tileCenter(i, j);
      diamond(g, x, y, TW / 2, TH / 2);
      g.fill((i + j) % 2 ? 0xc79a62 : 0xb88b56);
    }
  }
  return g;
}

const AVATAR = [
  '  hhhhh  ', ' hhhhhhh ', ' hsssssh ', ' ssesess ', ' sssssss ', '  sssss  ',
  '   sss   ', '  ttttt  ', ' ttttttt ', 'sttttttts', 'sttttttts', 's ttttt s',
  '  ppppp  ', '  pp pp  ', '  pp pp  ', '  pp pp  ', '  pp pp  ', ' kkk kkk ',
];
const AVATAR_COLORS: Record<string, number> = {
  h: 0x4a2c1a, s: 0xf1c27d, e: 0x222222, t: 0xe2483d, p: 0x2b4a8b, k: 0x1a1a1a,
};

function avatarTexture(): Texture {
  const cv = document.createElement('canvas');
  cv.width = AVATAR[0]!.length;
  cv.height = AVATAR.length;
  const ctx = cv.getContext('2d')!;
  AVATAR.forEach((row, y) =>
    [...row].forEach((ch, x) => {
      const color = AVATAR_COLORS[ch];
      if (color === undefined) return;
      ctx.fillStyle = `#${color.toString(16).padStart(6, '0')}`;
      ctx.fillRect(x, y, 1, 1);
    }),
  );
  const tex = Texture.from(cv);
  tex.source.scaleMode = 'nearest';
  return tex;
}

async function main() {
  const app = new Application();
  await app.init({ width: W, height: H, background: 0x120f22, antialias: false, roundPixels: true });
  document.body.appendChild(app.canvas);

  const scale = Math.max(1, Math.floor(Math.min(innerWidth / W, innerHeight / H)));
  app.canvas.style.width = `${W * scale}px`;
  app.canvas.style.height = `${H * scale}px`;

  const world = new Container();
  world.sortableChildren = true;
  app.stage.addChild(world);

  const room = drawRoom();
  room.zIndex = -2;
  world.addChild(room);

  const hoverMark = new Graphics();
  hoverMark.zIndex = -1;
  world.addChild(hoverMark);

  // Example placements. Phase 1: these come from GET /api/inventory.
  const placed: { recipe: Recipe; i: number; j: number }[] = [
    { recipe: SEEDS[1]!, i: 0, j: 0 },
    { recipe: SEEDS[0]!, i: 2, j: 5 },
    { recipe: SEEDS[2]!, i: 4, j: 5 },
  ];
  const occupied = new Set(placed.map((p) => `${p.i},${p.j}`));
  const blocked = (i: number, j: number) => occupied.has(`${i},${j}`);
  for (const p of placed) {
    const s = new Sprite(recipeTexture(p.recipe));
    const { x, y } = tileCenter(p.i, p.j);
    s.position.set(x - ANCHOR_X, y - ANCHOR_Y);
    s.zIndex = p.i + p.j;
    world.addChild(s);
  }

  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const stepMs = reduceMotion ? 60 : STEP_MS;

  const avatar = new Sprite(avatarTexture());
  const shadow = new Graphics();
  diamond(shadow, 0, 0, 6, 3);
  shadow.fill({ color: 0x000000, alpha: 0.25 });
  world.addChild(shadow, avatar);

  let pos: Cell = { i: 5, j: 2 };
  let path: Cell[] = [];
  let stepAt = 0;
  let hover: Cell | null = null;

  const place = (bob: number) => {
    const { x, y } = tileCenter(pos.i, pos.j);
    shadow.position.set(x, y);
    avatar.position.set(x - 4, y - 19 - bob);
    shadow.zIndex = pos.i + pos.j + 0.4;
    avatar.zIndex = pos.i + pos.j + 0.5;
  };
  place(0);

  const toRoom = (ev: PointerEvent) => {
    const r = app.canvas.getBoundingClientRect();
    return { x: ((ev.clientX - r.left) * W) / r.width, y: ((ev.clientY - r.top) * H) / r.height };
  };
  app.canvas.addEventListener('pointermove', (ev) => {
    const { x, y } = toRoom(ev);
    hover = tileAt(x, y);
    hoverMark.clear();
    if (!hover) return;
    const c = tileCenter(hover.i, hover.j);
    diamond(hoverMark, c.x, c.y, TW / 2, TH / 2);
    hoverMark.fill({ color: blocked(hover.i, hover.j) ? 0xff8a80 : 0xffc857, alpha: 0.4 });
  });
  app.canvas.addEventListener('pointerleave', () => {
    hover = null;
    hoverMark.clear();
  });
  app.canvas.addEventListener('click', (ev) => {
    const { x, y } = toRoom(ev);
    const target = tileAt(x, y);
    if (!target) return;
    // Walk from the cell the avatar is on now; the current step finishes first.
    path = findPath(pos, target, blocked);
  });

  app.ticker.add(() => {
    const now = performance.now();
    if (path.length && now - stepAt > stepMs) {
      pos = path.shift()!;
      stepAt = now;
    }
    place(path.length && !reduceMotion ? Math.floor(now / STEP_MS) % 2 : 0);
  });
}

main();
