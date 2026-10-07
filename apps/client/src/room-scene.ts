import { Container, Graphics, Sprite, Text, type Ticker } from 'pixi.js';
import { ANCHOR_X, ANCHOR_Y, catalogueEntry } from '@coloxel/render';
import { api, apartmentTitle, type FurnitureItem, type InventoryItem } from './api';
import { createApartmentSettings } from './apartment-settings';
import { AVATAR_H, lookFor, type Facing, type Frame, type Look } from './avatar';
import { HALL_LOOK, apartmentLook, diamond, roomSprite } from './draw';
import { createPanel } from './panel';
import { joinApartment, joinHall, type BuildingRoom, type PlayerState } from './realtime';
import { OY, ROOM_H, ROOM_W, TH, TW, tileAt, tileCenter } from './room';
import { FONT, type Scene, type SceneHost } from './scene';
import { avatarTexture, furnitureTexture, glowTexture, itemTexture } from './textures';
import { createVisitPanel } from './visit-panel';

const STEP_MS = 150;
/** Screen pixels per millisecond: one cell (about 36 px) per server step, a little faster to catch up. */
const WALK_SPEED = 0.26;
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
  /** When the avatar next blinks, and a personal phase so that nobody breathes in sync. */
  blinkAt: number;
  phase: number;
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
  const toRoom = (ev: MouseEvent) => host.pointer(ev);
  const ownerId = target.kind === 'apartment' ? target.ownerId : null;
  const mine = ownerId === user.id;

  // What the room contains, as the server tells it.
  let visitedTitle = '';
  let visitedOwner = '';
  let items: InventoryItem[] = [];
  let furniture: FurnitureItem[] = [];
  let look = { floor: 'parquet', wall: 'violet' };
  if (target.kind === 'apartment' && !mine) {
    const visit = await api.apartment(target.ownerId);
    if (!visit.ok) return { error: visit.status === 404 ? 'Cet appartement est fermé.' : visit.error };
    visitedOwner = visit.data.owner.nickname;
    visitedTitle = apartmentTitle(visit.data.name, visit.data.owner.nickname);
    items = visit.data.items;
    furniture = visit.data.furniture;
    look = { floor: visit.data.floor, wall: visit.data.wall };
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
  host.stage.addChild(world);

  // The room itself: the hall's fixed look, or the floor and wallpaper the owner chose.
  let floor: Sprite | null = null;
  function drawFloor() {
    floor?.destroy();
    floor = roomSprite(target.kind === 'hall' ? HALL_LOOK : apartmentLook(look.floor, look.wall));
    floor.zIndex = -3;
    world.addChild(floor);
  }
  drawFloor();

  const marks = new Graphics();
  marks.zIndex = -1;
  world.addChild(marks);

  const itemSprites = new Map<string, Sprite>();
  const occupied = new Set<string>();
  const blocked = (i: number, j: number) => occupied.has(cellKey(i, j));
  let selected: string | null = null;

  // ----- Panel -------------------------------------------------------------
  let inspect: (item: InventoryItem | FurnitureItem) => void = () => {};
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
      onThrow: async (id) => {
        const res = await api.throwFurniture(id);
        panel.setMessage(res.ok ? 'Meuble jeté.' : res.error);
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
      const [res, mineRes] = await Promise.all([api.inventory(), api.myApartment()]);
      if (!res.ok) {
        if (res.status === 401) location.reload();
        panel.setMessage(res.error);
        return;
      }
      items = res.data.items;
      furniture = res.data.furniture;
      if (selected && !items.some((it) => it.id === selected) && !furniture.some((f) => f.id === selected)) selected = null;
      panel.setItems(items);
      panel.setFurniture(furniture);
      panel.setSelected(selected);
      syncItems();
      if (mineRes.ok && (mineRes.data.floorStyle !== look.floor || mineRes.data.wallStyle !== look.wall)) {
        look = { floor: mineRes.data.floorStyle, wall: mineRes.data.wallStyle };
        drawFloor();
      }
    };
    panelElement = panel.element;
    // Name and opening of the apartment sit right under the player's name.
    panelElement.children[0]?.after(createApartmentSettings());
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
            title: visitedTitle,
            subtitle: `Appartement de ${visitedOwner}, tu es en visite.`,
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
  /** Everything standing in the room: creations and base furniture alike, on the same rule of one object per cell. */
  const placedThings = () => [
    ...items.flatMap((it) =>
      it.placement ? [{ id: it.id, placement: it.placement, key: null as string | null, texture: () => itemTexture(it.id) }] : [],
    ),
    ...furniture.flatMap((f) =>
      f.placement ? [{ id: f.id, placement: f.placement, key: f.key as string | null, texture: () => furnitureTexture(f.key) }] : [],
    ),
  ];

  interface Prop {
    sprite: Sprite;
    anim?: 'sway' | 'flicker';
    phase: number;
  }
  const props = new Map<string, Prop>();
  const lights = new Map<string, { sprite: Sprite; flicker: boolean; base: number; phase: number }>();

  function syncItems() {
    occupied.clear();
    const placed = new Set<string>();
    for (const thing of placedThings()) {
      const { i, j } = thing.placement;
      occupied.add(cellKey(i, j));
      placed.add(thing.id);
      const entry = thing.key ? catalogueEntry(thing.key) : undefined;
      let prop = props.get(thing.id);
      if (!prop) {
        const s = new Sprite();
        // The pivot is the point on the floor: swaying then rocks the object around its base.
        s.pivot.set(ANCHOR_X, ANCHOR_Y);
        itemSprites.set(thing.id, s);
        world.addChild(s);
        prop = { sprite: s, anim: entry?.anim, phase: Math.random() * 6 };
        props.set(thing.id, prop);
        thing.texture().then(
          (t) => {
            if (!s.destroyed) s.texture = t;
          },
          () => s.destroy(),
        );
        if (entry?.glow) {
          const halo = new Sprite(glowTexture());
          halo.anchor.set(0.5);
          halo.blendMode = 'add';
          halo.tint = entry.glow.color;
          halo.width = halo.height = entry.glow.radius * 2;
          halo.alpha = 0.55;
          world.addChild(halo);
          lights.set(thing.id, { sprite: halo, flicker: !!entry.glow.flicker, base: 0.55, phase: Math.random() * 6 });
        }
      }
      const { x, y } = tileCenter(i, j);
      prop.sprite.position.set(x, y);
      prop.sprite.zIndex = i + j;
      const light = lights.get(thing.id);
      if (light && entry?.glow) {
        light.sprite.position.set(x, y - entry.glow.z * 2);
        light.sprite.zIndex = i + j + 0.2;
      }
    }
    for (const [id, prop] of props) {
      if (placed.has(id)) continue;
      prop.sprite.destroy();
      props.delete(id);
      itemSprites.delete(id);
      lights.get(id)?.sprite.destroy();
      lights.delete(id);
    }
  }
  if (mine) await refreshOwn();
  else syncItems();

  // ----- Players -----------------------------------------------------------
  const views = new Map<string, PlayerView>();
  const fract = (v: number) => v - Math.floor(v);
  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

  function addView(p: PlayerState): PlayerView {
    const look = lookFor(p.id);
    const box = new Container();
    const shadow = new Graphics();
    diamond(shadow, 0, 1, 15, 7.5);
    shadow.fill({ color: 0x1b1530, alpha: 0.32 });
    diamond(shadow, 0, 1, 9, 4.5);
    shadow.fill({ color: 0x1b1530, alpha: 0.2 });
    const body = new Sprite(avatarTexture(look, 'front', 0));
    body.anchor.set(0.5, 1);
    body.position.set(0, 10);
    const label = new Text({
      text: p.nickname,
      style: {
        fontFamily: FONT,
        fontSize: 8,
        fill: p.id === user.id ? 0xffc857 : 0xffffff,
        stroke: { color: 0x1b1530, width: 3 },
      },
      resolution: 2,
    });
    label.anchor.set(0.5, 1);
    label.position.set(0, 10 - AVATAR_H - 4);
    box.addChild(shadow, body, label);
    world.addChild(box);
    const { x, y } = tileCenter(p.i, p.j);
    const view: PlayerView = {
      box,
      body,
      look,
      x,
      y,
      cell: { i: p.i, j: p.j },
      facing: 'front',
      flip: 1,
      moving: false,
      blinkAt: performance.now() + 1500 + Math.random() * 4000,
      phase: Math.random() * 6,
    };
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
      // Now and then the eyes close for a moment; standing still, the avatar breathes.
      let blink = false;
      if (now >= view.blinkAt) {
        blink = now < view.blinkAt + 130;
        if (!blink) view.blinkAt = now + 2200 + Math.random() * 4500;
      }
      view.body.texture = avatarTexture(view.look, view.facing, frame, blink && !view.moving && view.facing === 'front');
      view.body.scale.x = view.flip;
      const bob = view.moving && !reduceMotion ? Math.abs(Math.sin(now / STEP_MS)) * 3 : 0;
      const breath = !view.moving && !reduceMotion && Math.sin(now / 520 + view.phase) > 0.55 ? 1 : 0;
      view.body.y = 10 - Math.round(bob) - breath;
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
        const here =
          items.find((it) => it.placement?.i === cell.i && it.placement?.j === cell.j) ??
          furniture.find((f) => f.placement?.i === cell.i && f.placement?.j === cell.j);
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
  // Dust drifting in the sunbeam of an apartment.
  const dust = new Graphics();
  dust.zIndex = 9000;
  world.addChild(dust);
  const motes = Array.from({ length: 22 }, (_, k) => ({ a: Math.random() * 6, b: Math.random(), speed: 0.6 + Math.random() * 0.8, k }));

  const tick = (ticker: Ticker) => {
    const now = performance.now();
    syncPlayers(ticker.deltaMS, now);

    if (!reduceMotion) {
      for (const prop of props.values()) {
        if (prop.anim === 'sway') prop.sprite.skew.x = Math.sin(now / 900 + prop.phase) * 0.035;
        else if (prop.anim === 'flicker') prop.sprite.tint = Math.sin(now / 90 + prop.phase) + Math.sin(now / 37) > 1.2 ? 0xd9e8ff : 0xffffff;
      }
      for (const light of lights.values()) {
        const wobble = light.flicker ? 0.12 * Math.sin(now / 70 + light.phase) + 0.08 * Math.sin(now / 23) : 0.05 * Math.sin(now / 700 + light.phase);
        light.sprite.alpha = Math.max(0.1, light.base + wobble);
      }
    }
    dust.clear();
    if (target.kind === 'apartment' && !reduceMotion) {
      for (const m of motes) {
        const t = (now / 1000) * m.speed * 0.12 + m.a;
        // Motes live inside the beam of sunlight on the floor, floating upward.
        const v = fract(t) * 3.6;
        const u = 3.1 + 0.55 * v + 0.2 + (Math.sin(t * 7 + m.k) * 0.5 + m.b * 1.2);
        const c = tileCenter(u - 0.5, v - 0.5);
        const lift = fract(t * 1.7 + m.b) * 60;
        const alpha = 0.25 + 0.5 * Math.abs(Math.sin(now / 500 + m.k * 1.3));
        dust.rect(Math.round(c.x), Math.round(c.y - lift), 2, 2).fill({ color: 0xfff5cf, alpha });
      }
    }

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
    refresh: () => (mine ? refreshOwn() : undefined),
    destroy() {
      closing = true;
      abort.abort();
      app.ticker.remove(tick);
      void room.leave();
      world.destroy({ children: true });
    },
  };
}
