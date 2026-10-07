import { Container, Graphics, Sprite, Text, type Ticker } from 'pixi.js';
import { ANCHOR_X, ANCHOR_Y, catalogueEntry, isSwitchable, parseLook } from '@coloxel/render';
import { api, apartmentTitle, type FurnitureItem, type InventoryItem } from './api';
import { createApartmentSettings } from './apartment-settings';
import { createChat, type ChatMessage } from './chat-ui';
import { showNotice } from './notice-dialog';
import { wallet } from './wallet';
import { lookFor, showsFace, type Facing, type Frame, type Look, type Pose } from './avatar';
import { HALL_LOOK, apartmentLook, diamond, roomSprite } from './draw';
import { createPanel } from './panel';
import { showPlayerCard } from './player-card';
import { openReportDialog } from './report-dialog';
import { CLOSED_BY_OWNER, SUSPENDED, joinApartment, joinHall, type BuildingRoom, type PlayerState } from './realtime';
import { OY, ROOM_H, ROOM_W, TH, TW, tileAt, tileCenter } from './room';
import { FONT, type Scene, type SceneHost } from './scene';
import { avatarTexture, furnitureTexture, glowTexture, itemTexture, petTexture } from './textures';
import { createVisitPanel } from './visit-panel';

/** Same as the server's step: one cell every 480 ms. */
const STEP_MS = 480;
/** Screen pixels per millisecond: one cell (about 36 px) per server step, a touch faster so that the avatar never waits for the next step. */
const WALK_SPEED = (Math.hypot(TW / 2, TH / 2) / STEP_MS) * 1.08;
/** Avatars are drawn at the same two screen pixels per unit as the furniture: about 1.4 cells tall. */
const BODY_SCALE = 1.5;
const cellKey = (i: number, j: number) => `${i},${j}`;

export type RoomTarget = { kind: 'hall' } | { kind: 'apartment'; ownerId: string };

interface PetView {
  box: Container;
  sprite: Sprite;
  label: Text;
  species: string;
  color: number;
  x: number;
  y: number;
  flip: 1 | -1;
  /** When the companion last moved, to sit down once it has been still for a while. */
  movedAt: number;
}

/** A look from what the server broadcast: anything unreadable falls back to the player's default one. */
function lookOf(raw: string, id: string): Look {
  try {
    return parseLook(JSON.parse(raw)) ?? lookFor(id);
  } catch {
    return lookFor(id);
  }
}

interface PlayerView {
  box: Container;
  body: Sprite;
  look: Look;
  /** The look as the server sent it, to notice when it changes. */
  lookRaw: string;
  /** The companion following this player, if any. */
  pet: PetView | null;
  petRaw: string;
  x: number;
  y: number;
  cell: { i: number; j: number };
  facing: Facing;
  flip: 1 | -1;
  moving: boolean;
  /** When the avatar last covered ground: it keeps its walking legs for a moment between two cells. */
  movedAt: number;
  pose: Pose;
  label: Text;
  shadow: Graphics;
  /** The little z's floating up from a sleeper. */
  zzz: Text[];
  /** When the avatar next blinks, and a personal phase so that nobody breathes in sync. */
  blinkAt: number;
  phase: number;
}

/**
 * Which way the avatar faces for a step of (di, dj). On screen an axis step goes along a diagonal of
 * the room and a diagonal step goes straight up, down, left or right: eight directions from five
 * drawings, the others being mirrors.
 */
function facingFor(di: number, dj: number): { facing: Facing; flip: 1 | -1 } {
  const a = Math.sign(di);
  const b = Math.sign(dj);
  if (a > 0 && b === 0) return { facing: 'front34', flip: 1 }; // down-right
  if (a === 0 && b > 0) return { facing: 'front34', flip: -1 }; // down-left
  if (a < 0 && b === 0) return { facing: 'back34', flip: -1 }; // up-left
  if (a === 0 && b < 0) return { facing: 'back34', flip: 1 }; // up-right
  if (a > 0 && b > 0) return { facing: 'front', flip: 1 }; // straight down
  if (a < 0 && b < 0) return { facing: 'back', flip: 1 }; // straight up
  if (a > 0) return { facing: 'side', flip: 1 }; // right
  return { facing: 'side', flip: -1 }; // left
}

export async function createRoomScene(host: SceneHost, target: RoomTarget): Promise<Scene | { error: string }> {
  const { app, user } = host;
  const toRoom = (ev: MouseEvent) => host.pointer(ev);
  const ownerId = target.kind === 'apartment' ? target.ownerId : null;
  const mine = ownerId === user.id;

  // What the room contains, as the server tells it.
  let visitedTitle = '';
  let visitedOwner = '';
  let visitedNamed = false;
  let items: InventoryItem[] = [];
  let furniture: FurnitureItem[] = [];
  let look = { floor: 'parquet', wall: 'violet' };
  if (target.kind === 'apartment' && !mine) {
    const visit = await api.apartment(target.ownerId);
    if (!visit.ok) return { error: visit.status === 404 ? 'Cet appartement est fermé.' : visit.error };
    visitedOwner = visit.data.owner.nickname;
    visitedNamed = visit.data.name !== null;
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
  let setPresent: (players: PlayerState[]) => void = () => {};
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
    panel.setMessage('Clique sur une chaise ou un lit pour t’y installer, sur une lampe pour l’allumer ou l’éteindre. Clic droit sur un objet : sa fiche.');
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
    // Name and opening of the apartment sit right under the player's name, then who is visiting.
    const settings = createApartmentSettings();
    panelElement.children[0]?.after(settings);
    const visitors = document.createElement('p');
    visitors.className = 'present small';
    visitors.setAttribute('role', 'status');
    settings.after(visitors);
    setPresent = (players) => {
      const others = players.filter((p) => p.id !== user.id).map((p) => p.nickname);
      visitors.textContent = others.length ? `Chez toi : ${others.join(', ')}` : 'Personne ne te rend visite pour l’instant.';
    };
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
            report: {
              named: visitedNamed,
              run: (what) => {
                const notify = (text: string) => host.notify(text);
                if (what.kind === 'item') openReportDialog({ kind: 'item', id: what.item.id, label: `la création « ${what.item.name} »` }, notify);
                else if (what.kind === 'apartment_name') openReportDialog({ kind: 'apartment_name', id: ownerId!, label: `le nom de l’appart de ${visitedOwner}` }, notify);
                else openReportDialog({ kind: 'apartment', id: ownerId!, label: `l’appart de ${visitedOwner}` }, notify);
              },
            },
            links: [
              ['Retour chez moi', () => host.go({ kind: 'apartment', ownerId: user.id })],
              ['L’immeuble', () => host.go({ kind: 'building' })],
            ],
          },
    );
    inspect = (item) => visit.inspect(item);
    setPresent = (players) => visit.setPresent(players.length);
    panelElement = visit.element;
  }

  // ----- Objects -----------------------------------------------------------
  /** Everything standing in the room: creations and base furniture alike, on the same rule of one object per cell. */
  const placedThings = () => [
    ...items.flatMap((it) =>
      it.placement ? [{ id: it.id, placement: it.placement, key: null as string | null, on: true, texture: () => itemTexture(it.id) }] : [],
    ),
    ...furniture.flatMap((f) =>
      f.placement ? [{ id: f.id, placement: f.placement, key: f.key as string | null, on: f.on !== false, texture: () => furnitureTexture(f.key) }] : [],
    ),
  ];

  interface Prop {
    on: boolean;
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
        prop = { on: true, sprite: s, anim: entry?.anim, phase: Math.random() * 6 };
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
      // A switched-off lamp is dim and gives no light.
      prop.on = thing.on;
      prop.sprite.tint = thing.on ? 0xffffff : 0x8c8ca6;
      const halo = lights.get(thing.id);
      if (halo) halo.sprite.visible = thing.on;
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

  const POSES: Pose[] = ['stand', 'sit', 'lie'];
  /** The four phases of a walk: a step, a passing, the other step, a passing. */
  const WALK: Frame[] = [1, 0, 2, 0];

  function addView(p: PlayerState): PlayerView {
    const look = lookOf(p.look, p.id);
    const box = new Container();
    const shadow = new Graphics();
    diamond(shadow, 0, 1, 15, 7.5);
    shadow.fill({ color: 0x1b1530, alpha: 0.32 });
    diamond(shadow, 0, 1, 9, 4.5);
    shadow.fill({ color: 0x1b1530, alpha: 0.2 });
    const body = new Sprite(avatarTexture(look, 'front', 0));
    body.anchor.set(0.5, 1);
    body.position.set(0, 10 * BODY_SCALE);
    body.scale.set(BODY_SCALE);
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
    label.position.set(0, -36);
    const zzz = ['z', 'Z', 'z'].map((ch) => {
      const t = new Text({ text: ch, style: { fontFamily: FONT, fontSize: 8, fill: 0xe9d6ff, stroke: { color: 0x1b1530, width: 3 } }, resolution: 2 });
      t.anchor.set(0.5);
      t.visible = false;
      return t;
    });
    box.addChild(shadow, body, label, ...zzz);
    world.addChild(box);
    const { x, y } = tileCenter(p.i, p.j);
    const view: PlayerView = {
      box,
      body,
      look,
      lookRaw: p.look,
      pet: null,
      petRaw: '',
      x,
      y,
      cell: { i: p.i, j: p.j },
      facing: 'front34',
      flip: 1,
      moving: false,
      movedAt: 0,
      pose: 'stand',
      label,
      shadow,
      zzz,
      blinkAt: performance.now() + 1500 + Math.random() * 4000,
      phase: Math.random() * 6,
    };
    box.position.set(x, y);
    views.set(p.id, view);
    return view;
  }

  /** A companion trails its owner: it keeps a little distance, sits when the owner stops, and hops after them when they leave. */
  function syncPet(view: PlayerView, p: PlayerState, deltaMs: number, now: number) {
    if (view.petRaw !== p.pet) {
      view.petRaw = p.pet;
      view.pet?.box.destroy({ children: true });
      view.pet = null;
      const [species, color, ...name] = p.pet.split(':');
      if (species) {
        const box = new Container();
        const shadow = new Graphics();
        diamond(shadow, 0, 1, 9, 4.5);
        shadow.fill({ color: 0x1b1530, alpha: 0.3 });
        const sprite = new Sprite(petTexture(species, Number(color) || 0, 0));
        sprite.anchor.set(0.5, 1);
        sprite.position.set(0, 5);
        const label = new Text({ text: name.join(':'), style: { fontFamily: FONT, fontSize: 7, fill: 0xfff3d6, stroke: { color: 0x1b1530, width: 3 } }, resolution: 2 });
        label.anchor.set(0.5, 0);
        label.position.set(0, 9);
        box.addChild(shadow, sprite, label);
        world.addChild(box);
        // It starts beside its owner.
        view.pet = { box, sprite, label, species, color: Number(color) || 0, x: view.x - 22, y: view.y + 6, flip: 1, movedAt: now };
      }
    }
    const pet = view.pet;
    if (!pet) return;
    const dx = view.x - pet.x;
    const dy = view.y - pet.y;
    const dist = Math.hypot(dx, dy);
    const keep = view.moving ? 26 : 30;
    if (dist > 6 * TW) {
      pet.x = view.x - 22;
      pet.y = view.y + 6;
    } else if (dist > keep) {
      const step = Math.min((reduceMotion ? 1 : WALK_SPEED * 0.95) * deltaMs, dist - keep);
      pet.x += (dx / dist) * step;
      pet.y += (dy / dist) * step;
      pet.movedAt = now;
      if (Math.abs(dx) > 2) pet.flip = dx > 0 ? 1 : -1;
    }
    const walking = now - pet.movedAt < 180;
    const frame: 0 | 1 | 2 = walking && !reduceMotion ? ((Math.floor(now / 130) % 2) as 0 | 1) : now - pet.movedAt > 900 ? 2 : 0;
    pet.sprite.texture = petTexture(pet.species, pet.color, frame);
    pet.sprite.scale.x = pet.flip;
    const hop = walking && pet.species === 'lapin' && !reduceMotion ? Math.abs(Math.sin(now / 90)) * 3 : 0;
    pet.sprite.position.y = 5 - Math.round(hop);
    pet.box.position.set(Math.round(pet.x), Math.round(pet.y));
    pet.box.zIndex = (pet.y - OY) / (TH / 2) + 0.5;
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
      view.pose = POSES[p.pose] ?? 'stand';
      if (view.lookRaw !== p.look) {
        view.lookRaw = p.look;
        view.look = lookOf(p.look, p.id);
      }
      const goal = tileCenter(p.i, p.j);
      const dx = goal.x - view.x;
      const dy = goal.y - view.y;
      const dist = Math.hypot(dx, dy);
      // Walking is information, not decoration: it keeps its pace and its legs even when the system asks for less motion.
      const reach = WALK_SPEED * deltaMs;
      if (dist <= reach || dist > 4 * TW) {
        view.x = goal.x;
        view.y = goal.y;
      } else {
        view.x += (dx / dist) * reach;
        view.y += (dy / dist) * reach;
      }
      if (Math.hypot(goal.x - view.x, goal.y - view.y) > 0.5) view.movedAt = now;
      view.moving = now - view.movedAt < 90;
      const seated = view.pose !== 'stand' && !view.moving;
      const pose: Pose = seated ? view.pose : 'stand';

      const phase = Math.floor(now / (STEP_MS / 4)) % 4;
      const frame: Frame = view.moving ? WALK[phase]! : 0;
      // Now and then the eyes close for a moment (a sleeper's stay closed); standing still, the avatar breathes.
      let blink = pose === 'lie';
      if (!blink && now >= view.blinkAt) {
        blink = now < view.blinkAt + 130;
        if (!blink) view.blinkAt = now + 2200 + Math.random() * 4500;
      }
      // Sitting and lying down face the same way as the furniture: toward the viewer's right.
      const facing: Facing = pose === 'stand' ? view.facing : 'front34';
      view.body.texture = avatarTexture(view.look, facing, frame, blink && !view.moving && showsFace(facing), pose);
      view.body.scale.set((pose === 'stand' ? view.flip : 1) * BODY_SCALE, BODY_SCALE);
      // The avatar glides at a constant pace: no bounce while walking.
      const bob = 0;
      const breath = !view.moving && !reduceMotion && Math.sin(now / 520 + view.phase) > 0.55 ? 1 : 0;
      if (pose === 'lie') {
        view.body.anchor.set(0.5, 0.5);
        view.body.position.set(8 * BODY_SCALE, -17 * BODY_SCALE);
      } else {
        view.body.anchor.set(0.5, 1);
        // Seated, the avatar sits a little forward of the middle of the seat.
        view.body.position.set(pose === 'sit' ? 3 * BODY_SCALE : 0, (pose === 'sit' ? 9 : 10) * BODY_SCALE - Math.round(bob) - (pose === 'stand' ? breath * BODY_SCALE : 0));
      }
      view.shadow.visible = pose === 'stand';
      view.label.position.set(pose === 'lie' ? -10 : 0, pose === 'lie' ? -70 : pose === 'sit' ? -67 : -54 - Math.round(bob));
      view.zzz.forEach((zed, k) => {
        zed.visible = pose === 'lie' && !reduceMotion;
        if (!zed.visible) return;
        const t = fract(now / 2200 + k / 3);
        zed.position.set(-6 + t * 18 + k * 2, -62 - t * 26);
        zed.alpha = Math.sin(t * Math.PI);
        zed.scale.set(0.6 + t * 0.6);
      });
      view.box.position.set(Math.round(view.x), Math.round(view.y));
      view.box.zIndex = (view.y - OY) / (TH / 2) + 0.5;
      syncPet(view, p, deltaMs, now);
    }
    for (const [id, view] of views) {
      if (seen.has(id)) continue;
      view.box.destroy({ children: true });
      view.pet?.box.destroy({ children: true });
      views.delete(id);
    }
    setPresent(players);
  }

  // ----- Chat --------------------------------------------------------------
  // What the server lets through shows as a bubble over the speaker and as a line in the panel.
  const chat = createChat({
    me: user.id,
    say: (text) => room.say(text),
    onReport: (message) => openReportDialog({ kind: 'message', id: message.id, label: `ce message de ${message.nickname}` }, (text) => host.notify(text)),
  });
  document.body.append(chat.bar);
  panelElement.querySelector('.present')?.after(chat.log);

  const overlay = new Container();
  overlay.zIndex = 8500;
  world.addChild(overlay);
  interface Bubble {
    box: Container;
    until: number;
    width: number;
    height: number;
  }
  const bubbles = new Map<string, Bubble>();
  const BUBBLE_MAX_WIDTH = 150;

  function showBubble(message: ChatMessage) {
    bubbles.get(message.from)?.box.destroy({ children: true });
    bubbles.delete(message.from);
    const text = new Text({
      text: message.text,
      style: { fontFamily: 'system-ui, sans-serif', fontSize: 11, fontWeight: '600', fill: 0x1b1530, wordWrap: true, wordWrapWidth: BUBBLE_MAX_WIDTH, breakWords: true },
      resolution: 2,
    });
    const width = Math.ceil(text.width) + 12;
    const height = Math.ceil(text.height) + 8;
    const box = new Container();
    const back = new Graphics();
    back.roundRect(-width / 2, -height - 5, width, height, 5).fill(0xffffff).stroke({ color: 0x1b1530, width: 1.5 });
    back.poly([-4, -5, 4, -5, 0, 0]).fill(0xffffff);
    text.position.set(-width / 2 + 6, -height - 1);
    box.addChild(back, text);
    overlay.addChild(box);
    bubbles.set(message.from, { box, until: performance.now() + Math.min(9000, 3500 + message.text.length * 60), width, height: height + 5 });
  }

  function layoutBubbles(now: number) {
    for (const [id, bubble] of bubbles) {
      const view = views.get(id);
      if (!view || now > bubble.until) {
        bubble.box.destroy({ children: true });
        bubbles.delete(id);
        continue;
      }
      // Above the name tag, and never out of the room's picture.
      const x = Math.min(ROOM_W - bubble.width / 2 - 4, Math.max(bubble.width / 2 + 4, Math.round(view.box.x)));
      const y = Math.max(bubble.height + 4, Math.round(view.box.y + view.label.y - 12));
      bubble.box.position.set(x, y);
      bubble.box.alpha = Math.min(1, (bubble.until - now) / 500);
    }
  }

  room.onChat((message) => {
    chat.add(message);
    showBubble(message);
  });
  room.onChatRefused((refusal) => {
    chat.refused(refusal.message);
    host.notify(refusal.message);
  });

  // ----- Input -------------------------------------------------------------
  let hover: { i: number; j: number } | null = null;
  let goal: { i: number; j: number } | null = null;

  /** A piece of base furniture on this cell that can be sat on or lain on, and that nobody is using. */
  const seatAt = (cell: { i: number; j: number }): boolean => {
    const piece = furniture.find((f) => f.placement?.i === cell.i && f.placement?.j === cell.j);
    if (!piece || !catalogueEntry(piece.key)?.interaction) return false;
    return !room.players().some((q) => q.i === cell.i && q.j === cell.j && q.pose !== 0 && q.id !== user.id);
  };

  app.canvas.addEventListener(
    'pointermove',
    (ev) => {
      const { x, y } = toRoom(ev);
      hover = tileAt(x, y);
    },
    { signal: abort.signal },
  );
  app.canvas.addEventListener('pointerleave', () => (hover = null), { signal: abort.signal });
  // Right click: the card of whatever stands there, seat or not.
  app.canvas.addEventListener(
    'contextmenu',
    (ev) => {
      ev.preventDefault();
      const { x, y } = toRoom(ev);
      const cell = tileAt(x, y);
      if (!cell) return;
      const here =
        items.find((it) => it.placement?.i === cell.i && it.placement?.j === cell.j) ??
        furniture.find((f) => f.placement?.i === cell.i && f.placement?.j === cell.j);
      if (here) inspect(here);
    },
    { signal: abort.signal },
  );
  /** Another player standing under the pointer, if any. */
  const playerAt = (x: number, y: number) => {
    let found: { id: string; nickname: string } | null = null;
    let best = Infinity;
    for (const [id, view] of views) {
      if (id === user.id) continue;
      // About one cell wide and as tall as an avatar standing, or lying on a bed.
      if (Math.abs(x - view.x) > 15 || y < view.y - 62 || y > view.y + 8) continue;
      if (view.y < best && found) continue;
      best = view.y;
      found = { id, nickname: view.label.text };
    }
    return found;
  };

  app.canvas.addEventListener(
    'click',
    async (ev) => {
      const { x, y } = toRoom(ev);
      const who = !selected ? playerAt(x, y) : null;
      if (who) {
        showPlayerCard({
          id: who.id,
          nickname: who.nickname,
          at: { x: ev.clientX, y: ev.clientY },
          notify: (text) => host.notify(text),
          onFriendsChanged: () => host.friendsChanged(),
          onReport: () => openReportDialog({ kind: 'player', id: who.id, label: `le joueur ${who.nickname}` }, (text) => host.notify(text)),
        });
        return;
      }
      const cell = tileAt(x, y);
      if (!cell) return;
      // In our own apartment, a click on a lamp, the fireplace or the TV switches it on or off.
      if (!selected && mine) {
        const light = furniture.find((f) => f.placement?.i === cell.i && f.placement?.j === cell.j && isSwitchable(catalogueEntry(f.key)));
        if (light) {
          const res = await api.setLight(light.id, light.on === false);
          if (!res.ok) setMessage(res.error);
          await refreshOwn();
          return;
        }
      }
      if (!selected && seatAt(cell)) {
        // A free chair, sofa, pouf or bed: the server walks us there and sits or lies us down.
        goal = cell;
        room.moveTo(cell.i, cell.j);
        return;
      }
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
    layoutBubbles(now);

    if (!reduceMotion) {
      for (const prop of props.values()) {
        if (prop.anim === 'sway') prop.sprite.skew.x = Math.sin(now / 900 + prop.phase) * 0.035;
        else if (prop.anim === 'flicker' && prop.on) prop.sprite.tint = Math.sin(now / 90 + prop.phase) + Math.sin(now / 37) > 1.2 ? 0xd9e8ff : 0xffffff;
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
      marks.fill({ color: seatAt(hover) && !selected ? 0x8ac8ff : blocked(hover.i, hover.j) ? 0xff8a80 : selected ? 0x8affa0 : 0xffc857, alpha: 0.45 });
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

  // The owner rearranged the apartment while we are visiting: show what is there now.
  async function reloadVisit() {
    if (mine || target.kind !== 'apartment') return;
    const visit = await api.apartment(target.ownerId);
    if (closing || !visit.ok) return;
    items = visit.data.items;
    furniture = visit.data.furniture;
    syncItems();
    if (visit.data.floor !== look.floor || visit.data.wall !== look.wall) {
      look = { floor: visit.data.floor, wall: visit.data.wall };
      drawFloor();
    }
  }
  room.onMessage('decor', () => void reloadVisit());

  let closing = false;
  // A challenge was completed: the Pixels are already ours, the server paid them.
  room.onQuest((text) => {
    host.notify(text);
    void wallet.refresh();
  });

  // The staff speaks to us (a warning, a mute) while we are here.
  room.onNotice((notice) => {
    showNotice(notice.text, notice.id !== undefined && notice.kind === 'warning' ? () => void api.noticesSeen([notice.id!]) : undefined);
  });

  room.onClosed((code) => {
    if (closing) return;
    if (code === SUSPENDED) {
      // The account was just suspended or banned: the session is gone, signing in again says why.
      host.notify('Ton compte a été suspendu.');
      setTimeout(() => location.reload(), 1200);
      return;
    }
    host.notify(code === CLOSED_BY_OWNER ? 'Le propriétaire vient de fermer son appart.' : 'Tu as été déconnecté de la salle.');
    host.go({ kind: 'building' });
  });

  return {
    panel: panelElement,
    size: { w: ROOM_W, h: ROOM_H },
    refresh: () => (mine ? refreshOwn() : undefined),
    refreshAppearance: () => room.refreshAppearance(),
    destroy() {
      closing = true;
      chat.destroy();
      abort.abort();
      app.ticker.remove(tick);
      void room.leave();
      world.destroy({ children: true });
    },
  };
}
