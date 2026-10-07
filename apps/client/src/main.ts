import { Application, Container, Graphics, Sprite, Texture } from 'pixi.js';
import { ANCHOR_X, ANCHOR_Y, SEEDS, renderSprite, type Recipe } from '@coloxel/render';

// Room geometry, same as the prototype: 8 x 8 tiles, 2:1 isometric.
const N = 8, TW = 32, TH = 16;
const W = 300, H = 216, OX = 150, OY = 80;
const tile = (i: number, j: number) => ({ x: OX + (i - j) * (TW / 2), y: OY + (i + j) * (TH / 2) });

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

function drawRoom(): Graphics {
  const g = new Graphics();
  const L = N * (TW / 2), WH = 58, topY = OY - TH / 2;
  g.poly([OX - L, topY + L / 2, OX, topY, OX, topY - WH, OX - L, topY + L / 2 - WH]).fill(0x8a7fc0);
  g.poly([OX, topY, OX + L, topY + L / 2, OX + L, topY + L / 2 - WH, OX, topY - WH]).fill(0x6c61a3);
  for (let i = 0; i < N; i++) {
    for (let j = 0; j < N; j++) {
      const { x, y } = tile(i, j);
      g.poly([x, y - TH / 2, x + TW / 2, y, x, y + TH / 2, x - TW / 2, y]).fill((i + j) % 2 ? 0xc79a62 : 0xb88b56);
    }
  }
  return g;
}

async function main() {
  const app = new Application();
  await app.init({ width: W, height: H, background: 0x120f22, antialias: false, roundPixels: true });
  document.body.appendChild(app.canvas);

  const scale = Math.max(1, Math.floor(Math.min(innerWidth / W, innerHeight / H)));
  app.canvas.style.width = `${W * scale}px`;
  app.canvas.style.height = `${H * scale}px`;

  const world = new Container();
  app.stage.addChild(world);
  world.addChild(drawRoom());

  // Example placements. Phase 1: these come from GET /api/inventory.
  const placed: { recipe: Recipe; i: number; j: number }[] = [
    { recipe: SEEDS[1]!, i: 0, j: 0 },
    { recipe: SEEDS[0]!, i: 2, j: 5 },
    { recipe: SEEDS[2]!, i: 4, j: 5 },
  ];
  placed.sort((a, b) => a.i + a.j - (b.i + b.j));
  for (const p of placed) {
    const s = new Sprite(recipeTexture(p.recipe));
    const { x, y } = tile(p.i, p.j);
    s.position.set(x - ANCHOR_X, y - ANCHOR_Y);
    world.addChild(s);
  }
}

main();
