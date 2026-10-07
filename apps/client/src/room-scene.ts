import { Container, Graphics, Sprite, Text, type Ticker } from 'pixi.js';
import { ANCHOR_X, ANCHOR_Y } from '@coloxel/render';
import { api, type InventoryItem } from './api';
import { AVATAR_H, lookFor, type Facing, type Frame, type Look } from './avatar';
import { APARTMENT_THEME, HALL_THEME, diamond, drawRoom } from './draw';
import { createPanel } from './panel';
import { joinApartment, joinHall, type BuildingRoom, type PlayerState } from './realtime';
import { OY, TH, TW, tileAt, tileCenter } from './room';
import { FONT, type Scene, type SceneHost } from './scene';
import { avatarTexture, itemTexture } from './textures';
import { createVisitPanel } from './visit-panel';

export const ROOM_W = 300;
export const ROOM_H = 216;

const STEP_MS = 150;
/** Screen pixels per millisecond: one cell (about 18 px) per server step, a little faster to catch up. */
const WALK_SPEED = 0.13;
const cellKey = (i: number, j: number) => `${i},${j}`;

export type RoomTarget = { kind: 'hall' } | { kind: 'apartment'; ownerId: string };

interface PlayerView {
  box: Container;
  body: Sprite;
  look: Look;
  x: number;
  y: number;
  cell: { i: number; j: number };
  facing: Facing;
  flip: 1 | -1;
  moving: boolean;
}

/** Which way the avatar faces when it steps from one cell to the next. */
function facingFor(di: number, dj: number): { facing: Facing; flip: 1 | -1 } {
  if (di > 0) return { facing: 'front', flip: 1 }; // down-right
  if (dj > 0) return { facing: 'front', flip: -1 }; // down-left
  if (di < 0) return { facing: 'back', flip: -1 }; // up-left
  return { facing: 'back', flip: 1 }; // up-right
}

export async function createRoomScene(host: SceneHost, target: RoomTarget): Promise<Scene | { error: string }> {
  const { app, user } = host;
  const ownerId = target.kind === 'apartment' ? target.ownerId : null;
  const mine = ownerId === user.id;

  // What the room contains, as the server tells it.
  let visitedOwner = '';
  let items: InventoryItem[] = [];
  if (target.kind === 'apartment' && !mine) {
    const visit = await api.apartment(target.ownerId);
    if (!visit.ok) return { error: visit.status === 404 ? 'Cet appartement est fermé.' : visit.error };
    visitedOwner = visit.data.owner.nickname;
    items = visit.data.items;
  }

  const joined = target.kind === 'hall' ? await joinHall() : await joinApartment(target.ownerId);
  if (!joined.ok) {
    if (joined.status === 401) location.reload();
    return { error: joined.error };
  }
  const room: BuildingRoom = joined.room;

  const abort = new AbortController();
  const world = new Container();
  world.sortableChildren = true;
  app.stage.addChild(world);

  const floor = drawRoom(target.kind === 'hall' ? HALL_THEME : APARTMENT_THEME);
  floor.zIndex = -3;
  world.addChild(floor);

  const marks = new Graphics();
  marks.zIndex = -1;
  world.addChild(marks);

  const itemSprites = new Map<string, Sprite>();
  const occupied = new Set<string>();
  const blocked = (i: number, j: number) => occupied.has(cellKey(i, j));
  let selected: string | null = null;

  // ----- Panel -------------------------------------------------------------
  let inspect: (item: InventoryItem) => void = () => {};
  let setMessage: (text: string) => void = () => {};
  let refreshOwn: () => Promise<void> = async () => {};
  let setPresent: (count: number) => void = () => {};
  let panelElement: HTMLElement;

  if (mine) {
    const panel = createPanel(user, {
      onChange: () => void refreshOwn(),
      onSelect: (id) => {
        selected = id;
        panel.setSelected(id);
        panel.setMessage(id ? 'Clique sur une case libre pour poser l’objet.' : '');
      },
      onPickUp: async (id) => {
        const res = await api.pickUp(id);
        panel.setMessage(res.ok ? 'Objet repris dans ton inventaire.' : res.error);
        await refreshOwn();
      },
      onLogout: async () => {
        await api.logout();
        location.reload();
      },
    });
    inspect = (item) => panel.inspect(item.id);
    setMessage = panel.setMessage;
    refreshOwn = async () => {
      const res = await api.inventory();
      if (!res.ok) {
        if (res.status === 401) location.reload();
        panel.setMessage(res.error);
        return;
      }
      items = res.data.items;
      if (selected && !items.some((it) => it.id === selected)) selected = null;
      panel.setItems(items);
      panel.setSelected(selected);
      syncItems();
    };
    panelElement = panel.element;
    void panel.refreshCharges();
  } else {
    const visit = createVisitPanel(
      target.kind === 'hall'
        ? {
            title: 'Le hall',
            subtitle: 'Le rez-de-chaussée de l’immeuble.',
            links: [
              ['Mon appart', () => host.go({ kind: 'apartment', ownerId: user.id })],
              ['L’immeuble', () => host.go({ kind: 'building' })],
            ],
          }
        : {
            title: `Chez ${visitedOwner}`,
            subtitle: 'Tu es en visite.',
            links: [
              ['Retour chez moi', () => host.go({ kind: 'apartment', ownerId: user.id })],
              ['L’immeuble', () => host.go({ kind: 'building' })],
            ],
          },
    );
    inspect = (item) => visit.inspect(item);
    setPresent = visit.setPresent;
    panelElement = visit.element;
  }

  // ----- Objects -----------------------------------------------------------
  function syncItems() {
    occupied.clear();
    const placed = new Set<string>();
    for (const item of items) {
      if (!item.placement) continue;
      const { i, j } = item.placement;
      occupied.add(cellKey(i, j));
      placed.add(item.id);
      let s = itemSprites.get(item.id);
      if (!s) {
        s = new Sprite();
        itemSprites.set(item.id, s);
        world.addChild(s);
        const sprite = s;
        itemTexture(item.id).then(
          (t) => {
            if (!sprite.destroyed) sprite.texture = t;
          },
          () => sprite.destroy(),
        );
      }
      const { x, y } = tileCenter(i, j);
      s.position.set(x - ANCHOR_X, y - ANCHOR_Y);
      s.zIndex = i + j;
    }
    for (const [id, s] of itemSprites) {
      if (placed.has(id)) continue;
      s.destroy();
      itemSprites.delete(id);
    }
  }
  if (mine) await refreshOwn();
  else syncItems();

  // ----- Players -----------------------------------------------------------
  const views = new Map<string, PlayerView>();
  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

  function addView(p: PlayerState): PlayerView {
    const look = lookFor(p.id);
    const box = new Container();
    const shadow = new Graphics();
    diamond(shadow, 0, 0, 7, 3.5);
    shadow.fill({ color: 0x000000, alpha: 0.28 });
    const body = new Sprite(avatarTexture(look, 'front', 0));
    body.anchor.set(0.5, 1);
    body.position.set(0, 4);
    const label = new Text({
      text: p.nickname,
      style: {
        fontFamily: FONT,
        fontSize: 8,
        fill: p.id === user.id ? 0xffc857 : 0xffffff,
        stroke: { color: 0x1b1530, width: 2 },
      },
    });
    label.anchor.set(0.5, 1);
    label.position.set(0, 4 - AVATAR_H - 2);
    box.addChild(shadow, body, label);
    world.addChild(box);
    const { x, y } = tileCenter(p.i, p.j);
    const view: PlayerView = { box, body, look, x, y, cell: { i: p.i, j: p.j }, facing: 'front', flip: 1, moving: false };
    box.position.set(x, y);
    views.set(p.id, view);
    return view;
  }

  function syncPlayers(deltaMs: number, now: number) {
    const players = room.players();
    const seen = new Set<string>();
    for (const p of players) {
      seen.add(p.id);
      const view = views.get(p.id) ?? addView(p);
      if (view.cell.i !== p.i || view.cell.j !== p.j) {
        const f = facingFor(p.i - view.cell.i, p.j - view.cell.j);
        view.facing = f.facing;
        view.flip = f.flip;
        view.cell = { i: p.i, j: p.j };
      }
      const goal = tileCenter(p.i, p.j);
      const dx = goal.x - view.x;
      const dy = goal.y - view.y;
      const dist = Math.hypot(dx, dy);
      const reach = (reduceMotion ? 1 : WALK_SPEED) * deltaMs;
      if (dist <= reach || dist > 4 * TW) {
        view.x = goal.x;
        view.y = goal.y;
      } else {
        view.x += (dx / dist) * reach;
        view.y += (dy / dist) * reach;
      }
      view.moving = Math.hypot(goal.x - view.x, goal.y - view.y) > 0.5;

      const stride = Math.floor(now / 120) % 2 === 0 ? 1 : 2;
      const frame: Frame = view.moving && !reduceMotion ? (stride as Frame) : 0;
      view.body.texture = avatarTexture(view.look, view.facing, frame);
      view.body.scale.x = view.flip;
      const bob = view.moving && !reduceMotion ? Math.abs(Math.sin(now / STEP_MS)) * 1.5 : 0;
      view.body.y = 4 - Math.round(bob);
      view.box.position.set(Math.round(view.x), Math.round(view.y));
      view.box.zIndex = (view.y - OY) / (TH / 2) + 0.5;
    }
    for (const [id, view] of views) {
      if (seen.has(id)) continue;
      view.box.destroy({ children: true });
      views.delete(id);
    }
    setPresent(players.length);
  }

  // ----- Input -------------------------------------------------------------
  const toRoom = (ev: PointerEvent | MouseEvent) => {
    const r = app.canvas.getBoundingClientRect();
    return { x: ((ev.clientX - r.left) * ROOM_W) / r.width, y: ((ev.clientY - r.top) * ROOM_H) / r.height };
  };
  let hover: { i: number; j: number } | null = null;
  let goal: { i: number; j: number } | null = null;

  app.canvas.addEventListener(
    'pointermove',
    (ev) => {
      const { x, y } = toRoom(ev);
      hover = tileAt(x, y);
    },
    { signal: abort.signal },
  );
  app.canvas.addEventListener('pointerleave', () => (hover = null), { signal: abort.signal });
  app.canvas.addEventListener(
    'click',
    async (ev) => {
      const { x, y } = toRoom(ev);
      const cell = tileAt(x, y);
      if (!cell) return;
      if (!selected) {
        // Clicking an item opens its card instead of walking onto it.
        const here = items.find((it) => it.placement?.i === cell.i && it.placement?.j === cell.j);
        if (here) {
          inspect(here);
          return;
        }
      }
      if (selected && mine) {
        // The server validates ownership and that the cell is free; we only send the intention.
        const res = await api.place(selected, cell.i, cell.j);
        if (res.ok) {
          selected = null;
          setMessage('Objet posé.');
        } else {
          setMessage(res.error);
        }
        await refreshOwn();
        return;
      }
      if (blocked(cell.i, cell.j)) return;
      goal = cell;
      // We only say where we want to go: the server computes the path and moves us.
      room.moveTo(cell.i, cell.j);
    },
    { signal: abort.signal },
  );

  // ----- Frame loop --------------------------------------------------------
  const tick = (ticker: Ticker) => {
    const now = performance.now();
    syncPlayers(ticker.deltaMS, now);

    marks.clear();
    if (hover) {
      const c = tileCenter(hover.i, hover.j);
      diamond(marks, c.x, c.y, TW / 2, TH / 2);
      marks.fill({ color: blocked(hover.i, hover.j) ? 0xff8a80 : selected ? 0x8affa0 : 0xffc857, alpha: 0.4 });
    }
    const me = views.get(user.id);
    if (goal && me && (me.cell.i !== goal.i || me.cell.j !== goal.j)) {
      // Where we are heading: a small pulsing ring, until we get there.
      const c = tileCenter(goal.i, goal.j);
      const pulse = 0.5 + 0.5 * Math.sin(now / 160);
      diamond(marks, c.x, c.y, TW / 2 - 4 + pulse * 2, TH / 2 - 2 + pulse);
      marks.stroke({ color: 0xffffff, width: 1, alpha: 0.6 });
    } else if (goal) {
      goal = null;
    }
  };
  app.ticker.add(tick);

  let closing = false;
  room.onClosed(() => {
    if (closing) return;
    host.notify('Tu as été déconnecté de la salle.');
    host.go({ kind: 'building' });
  });

  return {
    panel: panelElement,
    size: { w: ROOM_W, h: ROOM_H },
    destroy() {
      closing = true;
      abort.abort();
      app.ticker.remove(tick);
      void room.leave();
      world.destroy({ children: true });
    },
  };
}
