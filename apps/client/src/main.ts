import { Application, Container, Graphics, Sprite, Texture } from 'pixi.js';
import { ANCHOR_X, ANCHOR_Y } from '@coloxel/render';
import { api, itemSpriteUrl, type InventoryItem, type User } from './api';
import { avatarCanvas } from './avatar';
import { showAuthScreen } from './auth-screen';
import { createPanel } from './panel';
import { N, OX, OY, TH, TW, findPath, tileAt, tileCenter, type Cell } from './room';

const W = 300, H = 216;
const STEP_MS = 150;
const PANEL_WIDTH = 320;

// Sprites are rendered by the server from the stored recipe (same engine as packages/render).
const textureCache = new Map<string, Promise<Texture>>();
function itemTexture(id: string): Promise<Texture> {
  let tex = textureCache.get(id);
  if (!tex) {
    tex = new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const t = Texture.from(img);
        t.source.scaleMode = 'nearest';
        resolve(t);
      };
      img.onerror = () => {
        textureCache.delete(id);
        reject(new Error('sprite load failed'));
      };
      img.src = itemSpriteUrl(id);
    });
    textureCache.set(id, tex);
  }
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

function avatarTexture(): Texture {
  const tex = Texture.from(avatarCanvas());
  tex.source.scaleMode = 'nearest';
  return tex;
}

async function startGame(user: User) {
  const app = new Application();
  await app.init({ width: W, height: H, background: 0x120f22, antialias: false, roundPixels: true });

  const layout = document.createElement('div');
  layout.className = 'game';
  document.body.append(layout);
  layout.append(app.canvas);

  const fit = () => {
    const room = Math.max(280, innerWidth - (innerWidth > 760 ? PANEL_WIDTH + 48 : 0));
    const scale = Math.max(1, Math.floor(Math.min(room / W, (innerHeight - 24) / H)));
    app.canvas.style.width = `${W * scale}px`;
    app.canvas.style.height = `${H * scale}px`;
  };
  fit();
  addEventListener('resize', fit);

  const world = new Container();
  world.sortableChildren = true;
  app.stage.addChild(world);

  const room = drawRoom();
  room.zIndex = -2;
  world.addChild(room);

  const hoverMark = new Graphics();
  hoverMark.zIndex = -1;
  world.addChild(hoverMark);

  let items: InventoryItem[] = [];
  let selected: string | null = null;
  const sprites = new Map<string, Sprite>();
  const occupied = new Set<string>();
  const blocked = (i: number, j: number) => occupied.has(`${i},${j}`);

  const panel = createPanel(user, {
    onChange: () => void refresh(),
    onSelect: (id) => {
      selected = id;
      panel.setSelected(id);
      panel.setMessage(id ? 'Clique sur une case libre pour poser l’objet.' : '');
    },
    onPickUp: async (id) => {
      const res = await api.pickUp(id);
      panel.setMessage(res.ok ? 'Objet repris dans ton inventaire.' : res.error);
      await refresh();
    },
    onLogout: async () => {
      await api.logout();
      location.reload();
    },
  });
  layout.append(panel.element);

  // The server owns the room state: redraw it from the inventory after every change.
  const syncRoom = () => {
    occupied.clear();
    const placed = new Set<string>();
    for (const item of items) {
      if (!item.placement) continue;
      const { i, j } = item.placement;
      occupied.add(`${i},${j}`);
      placed.add(item.id);
      let s = sprites.get(item.id);
      if (!s) {
        s = new Sprite();
        sprites.set(item.id, s);
        world.addChild(s);
        const sprite = s;
        itemTexture(item.id).then((t) => (sprite.texture = t), () => sprite.destroy());
      }
      const { x, y } = tileCenter(i, j);
      s.position.set(x - ANCHOR_X, y - ANCHOR_Y);
      s.zIndex = i + j;
    }
    for (const [id, s] of sprites) {
      if (placed.has(id)) continue;
      s.destroy();
      sprites.delete(id);
    }
  };

  const refresh = async () => {
    const res = await api.inventory();
    if (!res.ok) {
      if (res.status === 401) location.reload();
      panel.setMessage(res.error);
      return;
    }
    items = res.data.items;
    if (selected && !items.some((it) => it.id === selected && !it.placement)) selected = null;
    panel.setItems(items);
    panel.setSelected(selected);
    syncRoom();
  };
  await Promise.all([refresh(), panel.refreshCharges()]);

  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const stepMs = reduceMotion ? 60 : STEP_MS;

  const avatar = new Sprite(avatarTexture());
  const shadow = new Graphics();
  diamond(shadow, 0, 0, 6, 3);
  shadow.fill({ color: 0x000000, alpha: 0.25 });
  world.addChild(shadow, avatar);

  let pos: Cell = { i: 7, j: 0 };
  let path: Cell[] = [];
  let stepAt = 0;

  const place = (bob: number) => {
    const { x, y } = tileCenter(pos.i, pos.j);
    shadow.position.set(x, y);
    avatar.position.set(x - 4, y - 19 - bob);
    shadow.zIndex = pos.i + pos.j + 0.4;
    avatar.zIndex = pos.i + pos.j + 0.5;
  };
  place(0);

  const toRoom = (ev: PointerEvent | MouseEvent) => {
    const r = app.canvas.getBoundingClientRect();
    return { x: ((ev.clientX - r.left) * W) / r.width, y: ((ev.clientY - r.top) * H) / r.height };
  };
  app.canvas.addEventListener('pointermove', (ev) => {
    const { x, y } = toRoom(ev);
    const hover = tileAt(x, y);
    hoverMark.clear();
    if (!hover) return;
    const c = tileCenter(hover.i, hover.j);
    diamond(hoverMark, c.x, c.y, TW / 2, TH / 2);
    hoverMark.fill({ color: blocked(hover.i, hover.j) ? 0xff8a80 : selected ? 0x8affa0 : 0xffc857, alpha: 0.4 });
  });
  app.canvas.addEventListener('pointerleave', () => hoverMark.clear());
  app.canvas.addEventListener('click', async (ev) => {
    const { x, y } = toRoom(ev);
    const target = tileAt(x, y);
    if (!target) return;
    if (selected) {
      // The server validates ownership and that the cell is free; we only send the intention.
      const res = await api.place(selected, target.i, target.j);
      if (res.ok) {
        selected = null;
        panel.setMessage('Objet posé.');
      } else {
        panel.setMessage(res.error);
      }
      await refresh();
      return;
    }
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

async function main() {
  const me = await api.me();
  const user = me.ok ? me.data.user : await showAuthScreen();
  await startGame(user);
}

main();
