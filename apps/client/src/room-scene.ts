import { Container, Graphics, Sprite, Text, type Texture, type Ticker } from 'pixi.js';
import { RES, catalogueEntry, frameFor, isSwitchable, normalizeSize, parseLook, rotatedSize } from '@coloxel/render';
import { api, apartmentTitle, furnitureSpriteUrl, itemSpriteUrl, type FurnitureItem, type InventoryItem } from './api';
import { createApartmentSettings } from './apartment-settings';
import { createShapeEditor } from './room-shape';
import { createRulesEditor } from './rules-editor';
import { createChat, type ChatMessage } from './chat-ui';
import { showAlert, showSummon } from './alerts';
import { showNotice } from './notice-dialog';
import { wallet } from './wallet';
import { lookFor, showsFace, type Facing, type Frame, type Look, type Pose } from './avatar';
import { HALL_LOOK, apartmentLook, diamond, roomSprite } from './draw';
import { createFurniCard, type FurniAction } from './furni-card';
import { createInfoCard, type InfoCard } from './info-card';
import { createPanel, type Panel } from './panel';
import { showPlayerCard } from './player-card';
import { showRing } from './bell';
import { openReportDialog } from './report-dialog';
import { CLOSED_BY_OWNER, EXPELLED, KICKED, SUSPENDED, joinApartment, joinHall, type BuildingRoom, type PlayerState } from './realtime';
import { hasFloor, levelAt, DEFAULT_LAYOUT, type RoomLayout } from '@coloxel/world';
import { N, OY, ROOM_H, ROOM_W, TH, TW, setRoomLayout, tileAt, tileCenter } from './room';
import { FONT, type Scene, type SceneHost } from './scene';
import { askText } from './ask-dialog';
import { createMusic } from './music';
import { handTexture, avatarTexture, furnitureTexture, glowTexture, itemTexture, petTexture } from './textures';

/** Same as the server's step: one cell every 480 ms. */
const STEP_MS = 480;
/** Screen pixels per millisecond: one cell (about 36 px) per server step, a touch faster so that the avatar never waits for the next step. */
const WALK_SPEED = (Math.hypot(TW / 2, TH / 2) / STEP_MS) * 1.08;
/** Avatars are drawn at the same two screen pixels per unit as the furniture: about 1.4 cells tall. */
/** Screen pixels of the world for one pixel of the avatar's design grid; the sprite itself has RES times finer pixels. */
const PX = 1.5;
const BODY_SCALE = PX / RES;
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
  /** A trick it is doing: what, and until when (it started 900 ms or 6 s before). */
  trick?: { kind: string; since: number; until: number };
  /** A little "..." over a sad companion. */
  mood?: Text;
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
  /** What the avatar holds, drawn next to its hand. */
  hand: Sprite;
  handId: number;
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
  let shape: RoomLayout = DEFAULT_LAYOUT;
  if (target.kind === 'apartment' && !mine) {
    const visit = await api.apartment(target.ownerId);
    if (!visit.ok) return { error: visit.status === 404 ? 'Cet appartement est fermé.' : visit.error };
    visitedOwner = visit.data.owner.nickname;
    visitedNamed = visit.data.name !== null;
    visitedTitle = apartmentTitle(visit.data.name, visit.data.owner.nickname);
    items = visit.data.items;
    furniture = visit.data.furniture;
    look = { floor: visit.data.floor, wall: visit.data.wall };
    shape = visit.data.layout;
  } else if (mine) {
    const own = await api.myApartment();
    if (own.ok) {
      look = { floor: own.data.floorStyle, wall: own.data.wallStyle };
      shape = own.data.layout;
    }
  }
  setRoomLayout(shape);

  const joined = target.kind === 'hall' ? await joinHall() : await joinApartment(target.ownerId);
  if (!joined.ok) {
    if (joined.status === 401) location.reload();
    return { error: joined.error };
  }
  const room: BuildingRoom = joined.room;
  // Handy for end-to-end scripts (development only).
  if (import.meta.env.DEV) (window as unknown as { __room: BuildingRoom }).__room = room;

  const abort = new AbortController();
  const world = new Container();
  world.sortableChildren = true;
  host.stage.addChild(world);

  // The room itself: the hall's fixed look, or the floor and wallpaper the owner chose.
  let floor: Sprite | null = null;
  function drawFloor() {
    floor?.destroy();
    floor = roomSprite(target.kind === 'hall' ? HALL_LOOK : apartmentLook(look.floor, look.wall), shape);
    floor.zIndex = -3;
    world.addChild(floor);
  }
  drawFloor();

  /** The owner changed the look or the shape of the room: paint it again, and everything standing on it follows. */
  function changeRoom(floorId: string, wallId: string, layout: RoomLayout) {
    const reshaped = layout.cells !== shape.cells || layout.door.i !== shape.door.i || layout.door.j !== shape.door.j;
    if (floorId === look.floor && wallId === look.wall && !reshaped) return;
    look = { floor: floorId, wall: wallId };
    shape = layout;
    setRoomLayout(shape);
    drawFloor();
    if (reshaped) {
      drawFloorMask();
      syncItems();
    }
  }

  const marks = new Graphics();
  marks.zIndex = -1;
  world.addChild(marks);

  const itemSprites = new Map<string, Sprite>();
  const occupied = new Set<string>();
  const blocked = (i: number, j: number) => occupied.has(cellKey(i, j)) || !hasFloor(shape, i, j);
  let selected: string | null = null;

  /** Does a placed piece cover this tile? A big piece covers w x h tiles from its first one. */
  const covers = (p: { i: number; j: number; w?: number; h?: number }, cell: { i: number; j: number }) =>
    cell.i >= p.i && cell.i < p.i + (p.w ?? 1) && cell.j >= p.j && cell.j < p.j + (p.h ?? 1);
  /** The footprint the selected piece would have if put down now: its size, turned the way it already faces. */
  const selectedFootprint = (): [number, number] => {
    const piece = items.find((it) => it.id === selected) ?? furniture.find((f) => f.id === selected);
    if (!piece) return [1, 1];
    return rotatedSize(normalizeSize(piece.size), piece.placement?.rot ?? 0);
  };

  // ----- Around the room: the card of a piece, the windows, the banner -----------------
  const furniCard = createFurniCard();
  const setMessage = (text: string) => host.notify(text);
  let refreshOwn: () => Promise<void> = async () => {};
  /** Our furniture was read again: what shows it by name (the mechanisms) draws itself again. */
  let onFurniture: () => void = () => {};
  let setPresent: (players: PlayerState[]) => void = () => {};
  let inventory: Panel | null = null;
  let inventoryElement: HTMLElement | undefined;
  let apartmentElement: HTMLElement | undefined;
  let info: InfoCard;

  // While a piece is chosen, a banner says so: the next click on a free cell puts it there.
  const banner = document.createElement('div');
  banner.className = 'placing-banner';
  banner.hidden = true;
  const bannerText = document.createElement('span');
  const bannerCancel = document.createElement('button');
  bannerCancel.type = 'button';
  bannerCancel.textContent = 'Annuler';
  banner.append(bannerText, bannerCancel);
  document.body.append(banner);
  const nameOfPiece = (id: string) => items.find((it) => it.id === id)?.name ?? furniture.find((f) => f.id === id)?.name ?? 'cet objet';
  function select(id: string | null) {
    selected = id;
    inventory?.setSelected(id);
    banner.hidden = id === null;
    if (id) bannerText.textContent = `Pose « ${nameOfPiece(id)} » : clique sur une case libre.`;
  }
  bannerCancel.addEventListener('click', () => select(null));

  const date = (iso: string) => new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });

  /** What a piece says about itself, and what the player may do with it: shown next to the bottom bar. */
  function inspect(piece: InventoryItem | FurnitureItem) {
    const creation = 'serial' in piece;
    const actions: FurniAction[] = [];
    const lines: string[] = [];
    if (creation) {
      lines.push(`« ${piece.description} »`);
      lines.push(`N° ${String(piece.serial).padStart(4, '0')} · Exemplaire ${piece.editionNumber}/${piece.editionSize}`);
      lines.push(`Créé par ${piece.creator} le ${date(piece.createdAt)}${piece.underReview ? ' · En revue : les autres joueurs ne le voient plus pour l’instant.' : ''}`);
    } else {
      lines.push('Mobilier de base · gratuit, en quantité illimitée.');
      lines.push('Ni numéroté, ni échangeable.');
      // A sign says what its owner wrote, to everybody who looks at it.
      if (catalogueEntry(piece.key)?.sign) lines.unshift((piece as FurnitureItem).data ? `« ${(piece as FurnitureItem).data} »` : 'Le panneau est vide.');
    }
    if (mine) {
      if (piece.placement) {
        actions.push({ label: 'Déplacer', kind: 'primary', run: () => (furniCard.hide(), select(piece.id)) });
        const where = piece.placement;
        actions.push({
          label: 'Pivoter',
          run: async () => {
            const res = await api.place(piece.id, where.i, where.j, (where.rot + 1) % 4);
            if (!res.ok) setMessage(res.error);
            await refreshOwn();
            furniCard.hide();
          },
        });
        const pieceEntry = creation ? undefined : catalogueEntry(piece.key);
        if (pieceEntry?.mannequin) {
          actions.push({
            label: 'Habiller',
            run: async () => {
              const res = await api.dressMannequin(piece.id);
              setMessage(res.ok ? 'Le mannequin porte ta tenue.' : res.error);
              await refreshOwn();
              furniCard.hide();
            },
          });
        }
        if (pieceEntry?.sign) {
          actions.push({
            label: 'Écrire',
            run: async () => {
              furniCard.hide();
              const text = await askText({
                title: 'Panneau',
                label: 'Ce que dit le panneau (vide pour l’effacer)',
                value: (piece as FurnitureItem).data ?? '',
                maxLength: 120,
                allowEmpty: true,
                confirm: 'Écrire',
              });
              if (text === null) return;
              const res = await api.writeSign(piece.id, text);
              if (!res.ok) setMessage(res.error);
              await refreshOwn();
            },
          });
        }
        if (!creation && isSwitchable(catalogueEntry(piece.key))) {
          const lit = piece.on !== false;
          actions.push({
            label: lit ? 'Éteindre' : 'Allumer',
            run: async () => {
              const res = await api.setLight(piece.id, !lit);
              if (!res.ok) setMessage(res.error);
              await refreshOwn();
              furniCard.hide();
            },
          });
        }
        actions.push({
          label: 'Ranger',
          run: async () => {
            const res = await api.pickUp(piece.id);
            setMessage(res.ok ? 'Objet repris dans ton inventaire.' : res.error);
            furniCard.hide();
            await refreshOwn();
          },
        });
      } else {
        actions.push({ label: 'Poser', kind: 'primary', run: () => (furniCard.hide(), select(piece.id)) });
      }
      if (!creation) {
        actions.push({
          label: 'Jeter',
          kind: 'danger',
          run: async () => {
            const res = await api.throwFurniture(piece.id);
            setMessage(res.ok ? 'Meuble jeté.' : res.error);
            furniCard.hide();
            await refreshOwn();
          },
        });
      }
    } else if (creation) {
      actions.push({
        label: 'Signaler',
        run: () => {
          furniCard.hide();
          openReportDialog({ kind: 'item', id: piece.id, label: `la création « ${piece.name} »` }, (text) => host.notify(text));
        },
      });
    }
    furniCard.show({
      image: creation ? itemSpriteUrl(piece.id, piece.placement?.rot) : furnitureSpriteUrl(piece.key, piece.placement?.rot),
      name: piece.name,
      lines,
      actions,
      // The story of a creation: who made it and who owned it since.
      more: creation
        ? async () => {
            const res = await api.itemHistory(piece.id);
            if (!res.ok) return [];
            return res.data.history.map((h) =>
              h.kind === 'creation'
                ? `Créé par ${h.to}`
                : h.kind === 'sale'
                  ? `Vendu à ${h.to} (${h.price} Coloxs)`
                  : h.kind === 'trade'
                    ? `Échangé avec ${h.to}`
                    : `Rendu à ${h.to} (vente annulée)`,
            );
          }
        : undefined,
    });
  }

  const HINT = 'Clique sur une case pour t’y rendre, sur un siège pour t’asseoir. Clic sur un objet : sa fiche.';
  const hint = document.createElement('p');
  hint.className = 'muted small';
  hint.textContent = HINT;

  if (mine) {
    inventory = createPanel(user, {
      onChange: () => void refreshOwn(),
      onSelect: (id) => {
        select(id);
        // The window is in the way of the room: let the player click.
        if (id) host.openWindow(null);
      },
      onPickUp: async (id) => {
        const res = await api.pickUp(id);
        setMessage(res.ok ? 'Objet repris dans ton inventaire.' : res.error);
        await refreshOwn();
      },
      onInspect: (id) => {
        const piece = items.find((it) => it.id === id) ?? furniture.find((f) => f.id === id);
        if (!piece) return;
        host.openWindow(null);
        inspect(piece);
      },
    });
    inventoryElement = inventory.element;
    refreshOwn = async () => {
      const [res, mineRes] = await Promise.all([api.inventory(), api.myApartment()]);
      if (!res.ok) {
        if (res.status === 401) location.reload();
        setMessage(res.error);
        return;
      }
      items = res.data.items;
      furniture = res.data.furniture;
      onFurniture();
      if (selected && !items.some((it) => it.id === selected) && !furniture.some((f) => f.id === selected)) select(null);
      inventory?.setItems(items);
      inventory?.setFurniture(furniture);
      inventory?.setSelected(selected);
      syncItems();
      if (mineRes.ok) changeRoom(mineRes.data.floorStyle, mineRes.data.wallStyle, mineRes.data.layout);
    };
    // Name, opening and mechanisms of the apartment live in a window of their own.
    apartmentElement = document.createElement('div');
    apartmentElement.className = 'apartment-body';
    const rulesEditor = createRulesEditor({
      furniture: () => furniture,
      pickCell: (done) => {
        pickingCell = done;
        // The window would hide the room the player has to click on.
        host.openWindow(null);
      },
      notify: (text) => host.notify(text),
    });
    apartmentElement.append(createApartmentSettings(), createShapeEditor(), rulesEditor.element);
    onFurniture = () => rulesEditor.rerender();
    info = createInfoCard({
      title: 'Mon appart',
      actions: [
        { label: 'Inventaire', run: () => host.openWindow('inventory') },
        { label: 'Réglages', run: () => host.openWindow('apartment') },
        { label: 'Historique', run: () => host.openWindow('history') },
      ],
      extra: [hint],
    });
    setPresent = (players) => {
      const others = players.filter((p) => p.id !== user.id).map((p) => p.nickname);
      info.present.textContent = others.length ? `Chez toi : ${others.join(', ')}` : 'Personne ne te rend visite pour l’instant.';
    };
    void inventory.refreshCharges();
  } else if (target.kind === 'hall') {
    info = createInfoCard({
      title: 'Le hall',
      subtitle: 'Le rez-de-chaussée de l’immeuble.',
      actions: [
        { label: 'Mon appart', run: () => host.go({ kind: 'apartment', ownerId: user.id }) },
        { label: 'L’immeuble', run: () => host.go({ kind: 'building' }) },
        { label: 'Historique', run: () => host.openWindow('history') },
      ],
      extra: [hint],
    });
    setPresent = (players) => (info.present.textContent = players.length > 1 ? `${players.length} personnes ici` : 'Tu es seul ici');
  } else {
    const notify = (text: string) => host.notify(text);
    info = createInfoCard({
      title: visitedTitle,
      subtitle: `Appartement de ${visitedOwner}, tu es en visite.`,
      actions: [
        { label: 'Retour chez moi', run: () => host.go({ kind: 'apartment', ownerId: user.id }) },
        { label: 'L’immeuble', run: () => host.go({ kind: 'building' }) },
        { label: 'Historique', run: () => host.openWindow('history') },
        ...(visitedNamed ? [{ label: 'Signaler le nom', quiet: true, run: () => openReportDialog({ kind: 'apartment_name' as const, id: ownerId!, label: `le nom de l’appart de ${visitedOwner}` }, notify) }] : []),
        { label: 'Signaler l’appart', quiet: true, run: () => openReportDialog({ kind: 'apartment', id: ownerId!, label: `l’appart de ${visitedOwner}` }, notify) },
      ],
      extra: [hint],
    });
    setPresent = (players) => (info.present.textContent = players.length > 1 ? `${players.length} personnes ici` : 'Tu es seul ici');
  }

  // ----- Objects -----------------------------------------------------------
  /** Everything standing in the room: creations and base furniture alike, on the same rule of one object per cell. */
  const placedThings = () => [
    ...items.flatMap((it) =>
      it.placement ? [{ id: it.id, placement: it.placement, key: null as string | null, data: null as string | null, on: true, texture: (rot: number, _alt: boolean, _frame: number) => itemTexture(it.id, rot) }] : [],
    ),
    ...furniture.flatMap((f) =>
      f.placement ? [{ id: f.id, placement: f.placement, key: f.key as string | null, data: f.data ?? null, on: f.on !== false, texture: (rot: number, alt: boolean, frame: number) => furnitureTexture(f.key, rot, alt, frame) }] : [],
    ),
  ];

  interface Prop {
    on: boolean;
    sprite: Sprite;
    anim?: 'sway' | 'flicker';
    phase: number;
    /** Quarter turns of the texture on screen; -1 until the first one has loaded. */
    rot: number;
    /** The second look of a piece that has two (a gate standing open). */
    alt: boolean;
    /** An animated piece: its looks in order (index 0 is the recipe itself), loaded after a turn, and which one shows. */
    frames?: Texture[];
    frameIdx?: number;
    frameMs?: number;
    /** A mannequin wears a look: an avatar drawn on the piece. */
    dummy?: Sprite;
    dummyRaw?: string;
  }
  const props = new Map<string, Prop>();
  const lights = new Map<string, { sprite: Sprite; flicker: boolean; base: number; phase: number }>();

  function syncItems() {
    occupied.clear();
    const placed = new Set<string>();
    for (const thing of placedThings()) {
      const { i, j } = thing.placement;
      placed.add(thing.id);
      const entry = thing.key ? catalogueEntry(thing.key) : undefined;
      // A rug, a pressure plate, a portal lies on the floor: one walks over it.
      // A rug lies on the floor, and an open gate lets players through.
      if (!entry?.walkable && !(entry?.gate && thing.on)) {
        for (let a = 0; a < (thing.placement.w ?? 1); a++) for (let b = 0; b < (thing.placement.h ?? 1); b++) occupied.add(cellKey(i + a, j + b));
      }
      let prop = props.get(thing.id);
      if (!prop) {
        const s = new Sprite();
        itemSprites.set(thing.id, s);
        world.addChild(s);
        prop = { on: true, sprite: s, anim: entry?.anim, phase: Math.random() * 6, rot: -1, alt: false, frameMs: entry?.frameMs };
        props.set(thing.id, prop);
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
      // Turned: the server draws the piece again from the other side.
      const rot = thing.placement.rot;
      const alt = !!entry?.gate && thing.on;
      if (prop.rot !== rot || prop.alt !== alt) {
        const first = prop.rot < 0;
        prop.rot = rot;
        prop.alt = alt;
        const s = prop.sprite;
        // The other looks of an animated piece load in the background; until they are there it stays on the first.
        prop.frames = undefined;
        prop.frameIdx = 0;
        const count = entry?.frames?.length ?? 0;
        if (count) {
          void Promise.all(Array.from({ length: count + 1 }, (_, k) => thing.texture(rot, alt, k))).then(
            (all) => {
              if (!s.destroyed && prop!.rot === rot && prop!.alt === alt) prop!.frames = all;
            },
            () => {},
          );
        }
        thing.texture(rot, alt, 0).then(
          (t) => {
            if (!s.destroyed && prop!.rot === rot && prop!.alt === alt) s.texture = t;
          },
          () => {
            if (first) s.destroy();
          },
        );
      }
      // A switched-off lamp is dim and gives no light.
      prop.on = thing.on;
      prop.sprite.tint = thing.on || !isSwitchable(entry) ? 0xffffff : 0x8c8ca6;
      const halo = lights.get(thing.id);
      if (halo) halo.sprite.visible = thing.on;
      // The pivot is the first tile's centre: swaying rocks the object around its base, and a big piece's frame is bigger.
      const frame = frameFor([thing.placement.w ?? 1, thing.placement.h ?? 1]);
      prop.sprite.pivot.set(frame.ax, frame.ay);
      const { x, y } = tileCenter(i, j);
      prop.sprite.position.set(x, y);
      if (entry?.mannequin) {
        const raw = thing.data ?? '';
        if (prop.dummyRaw !== raw) {
          prop.dummyRaw = raw;
          prop.dummy?.destroy();
          prop.dummy = undefined;
          if (raw) {
            const body = new Sprite(avatarTexture(lookOf(raw, thing.id), 'front34', 0));
            body.anchor.set(0.5, 1);
            body.scale.set(BODY_SCALE);
            world.addChild(body);
            prop.dummy = body;
          }
        }
        if (prop.dummy) {
          prop.dummy.position.set(x, y + 4 * PX);
          prop.dummy.zIndex = i + j + 0.3;
        }
      }
      // Drawn in front of what stands behind its far corner, behind what stands in front of its near corner.
      prop.sprite.zIndex = i + j + (thing.placement.w ?? 1) - 1 + (thing.placement.h ?? 1) - 1 - (entry?.walkable ? 0.6 : 0);
      const light = lights.get(thing.id);
      if (light && entry?.glow) {
        light.sprite.position.set(x, y - entry.glow.z * 2);
        light.sprite.zIndex = i + j + (thing.placement.w ?? 1) + (thing.placement.h ?? 1) - 2 + 0.2;
      }
    }
    for (const [id, prop] of props) {
      if (placed.has(id)) continue;
      prop.sprite.destroy();
      prop.dummy?.destroy();
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
    body.position.set(0, 10 * PX);
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
    const hand = new Sprite();
    hand.anchor.set(0.5, 1);
    hand.scale.set(2);
    hand.visible = false;
    box.addChild(shadow, body, hand, label, ...zzz);
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
      hand,
      handId: 0,
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
        const mood = new Text({ text: '…', style: { fontFamily: FONT, fontSize: 9, fill: 0xbfc8ff, stroke: { color: 0x1b1530, width: 3 } }, resolution: 2 });
        mood.anchor.set(0.5, 1);
        mood.position.set(0, -14);
        mood.visible = false;
        box.addChild(shadow, sprite, label, mood);
        world.addChild(box);
        // It starts beside its owner.
        view.pet = { box, sprite, label, species, color: Number(color) || 0, x: view.x - 22, y: view.y + 6, flip: 1, movedAt: now, mood };
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
    // A trick lasts a moment (sitting, six seconds); walking away ends a sit.
    const trick = pet.trick && now < pet.trick.until && !(pet.trick.kind === 'assis' && walking) ? pet.trick : undefined;
    const sad = p.petMood === 2;
    let frame: 0 | 1 | 2 = walking && !reduceMotion ? ((Math.floor(now / 130) % 2) as 0 | 1) : now - pet.movedAt > 900 || sad ? 2 : 0;
    if (trick?.kind === 'assis') frame = 2;
    pet.sprite.texture = petTexture(pet.species, pet.color, frame);
    // A sad companion is paler and says nothing but "…".
    pet.sprite.tint = sad ? 0x9aa0c0 : 0xffffff;
    if (pet.mood) pet.mood.visible = sad;
    let flip = pet.flip;
    let jump = 0;
    if (trick && !reduceMotion) {
      const t = now - trick.since;
      if (trick.kind === 'saute') jump = Math.abs(Math.sin(t / 150)) * 9;
      if (trick.kind === 'tourne') flip = (Math.floor(t / 110) % 2 === 0 ? 1 : -1) as 1 | -1;
    }
    pet.sprite.scale.x = flip;
    const hop = (walking && pet.species === 'lapin' && !reduceMotion ? Math.abs(Math.sin(now / 90)) * 3 : 0) + jump;
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
      const dancing = p.emote === 1 && pose === 'stand' && !view.moving;
      // A dancer sways and turns from side to side.
      const turn = dancing ? (Math.floor(now / 340) % 2 === 0 ? 1 : -1) : view.flip;
      view.body.scale.set((pose === 'stand' ? turn : 1) * BODY_SCALE, BODY_SCALE);
      view.body.rotation = dancing && !reduceMotion ? Math.sin(now / 170) * 0.14 : 0;
      // The avatar glides at a constant pace: no bounce while walking.
      const bob = dancing && !reduceMotion ? Math.abs(Math.sin(now / 170)) * 5 : 0;
      const breath = !view.moving && !reduceMotion && Math.sin(now / 520 + view.phase) > 0.55 ? 1 : 0;
      if (pose === 'lie') {
        view.body.anchor.set(0.5, 0.5);
        view.body.position.set(8 * PX, -17 * PX);
      } else {
        view.body.anchor.set(0.5, 1);
        // Seated, the avatar sits a little forward of the middle of the seat.
        view.body.position.set(pose === 'sit' ? 3 * PX : 0, (pose === 'sit' ? 4 : 10) * PX - Math.round(bob) - (pose === 'stand' ? breath * PX : 0));
      }
      // What the avatar holds: in front, on the side of the hand that faces the viewer; a sleeper holds nothing.
      if (view.handId !== p.hand) {
        view.handId = p.hand;
        const tex = p.hand ? handTexture(p.hand) : null;
        if (tex) view.hand.texture = tex;
      }
      view.hand.visible = view.handId !== 0 && pose !== 'lie' && !!handTexture(view.handId);
      if (view.hand.visible) view.hand.position.set(7 * PX * (pose === 'stand' ? turn : 1), (pose === 'sit' ? -9 : -14) * PX - Math.round(bob));
      // A player frozen in the statues game is ice-blue.
      view.body.tint = race.frozen.has(p.id) ? 0x9fd8ff : 0xffffff;
      view.shadow.visible = pose === 'stand';
      view.label.position.set(pose === 'lie' ? -10 : 0, pose === 'lie' ? -70 : pose === 'sit' ? -71 : -64 - Math.round(bob));
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
  // What the server lets through shows as a bubble over the speaker, and the bubbles pile up: a new one pushes the older ones
  // above it up, so that a conversation reads from the bottom to the top. The history window keeps them all, with a way to report.
  const chat = createChat({
    me: user.id,
    say: (text) => room.say(text),
    onReport: (message) => openReportDialog({ kind: 'message', id: message.id, label: `ce message de ${message.nickname}` }, (text) => host.notify(text)),
  });

  const overlay = new Container();
  overlay.zIndex = 8500;
  world.addChild(overlay);
  interface Bubble {
    box: Container;
    from: string;
    until: number;
    width: number;
    height: number;
    /** How far above the speaker the bubble is going, and how far it has got. */
    lift: number;
    shown: number;
    /** Where the speaker was last seen: the bubble stays there if they leave. */
    x: number;
    y: number;
  }
  const bubbles: Bubble[] = [];
  const BUBBLE_MAX_WIDTH = 150;
  const NAME_COLORS = [0xd6405f, 0x2f7fd6, 0x238a5a, 0xb8741a, 0x7a52c9, 0xc2306f, 0x1f8a9d];
  const colorOf = (id: string) => NAME_COLORS[[...id].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7) % NAME_COLORS.length]!;
  const anchorOf = (from: string, fallback: { x: number; y: number }) => {
    const view = views.get(from);
    return view ? { x: Math.round(view.box.x), y: Math.round(view.box.y + view.label.y - 12) } : fallback;
  };

  function showBubble(message: ChatMessage) {
    const name = new Text({ text: message.nickname, style: { fontFamily: 'system-ui, sans-serif', fontSize: 10, fontWeight: '800', fill: colorOf(message.from) }, resolution: 2 });
    const text = new Text({
      text: message.text,
      style: { fontFamily: 'system-ui, sans-serif', fontSize: 11, fontWeight: '600', fill: 0x1b1530, wordWrap: true, wordWrapWidth: BUBBLE_MAX_WIDTH, breakWords: true },
      resolution: 2,
    });
    const width = Math.ceil(Math.max(text.width, name.width)) + 14;
    const height = Math.ceil(name.height + text.height) + 8;
    const box = new Container();
    const back = new Graphics();
    back.roundRect(-width / 2, -height - 5, width, height, 5).fill(0xffffff).stroke({ color: 0x1b1530, width: 1.5 });
    back.poly([-4, -5, 4, -5, 0, 0]).fill(0xffffff);
    name.position.set(-width / 2 + 7, -height - 1);
    text.position.set(-width / 2 + 7, -height - 1 + Math.ceil(name.height));
    box.addChild(back, name, text);
    overlay.addChild(box);

    const anchor = anchorOf(message.from, { x: ROOM_W / 2, y: ROOM_H / 2 });
    const bubble: Bubble = { box, from: message.from, until: performance.now() + Math.min(13000, 6000 + message.text.length * 70), width, height: height + 5, lift: 0, shown: 0, x: anchor.x, y: anchor.y };
    // Whoever speaks at about the same place pushes the older bubbles up.
    for (const other of bubbles) {
      const there = anchorOf(other.from, other);
      if (Math.abs(there.x - anchor.x) < (other.width + width) / 2 + 4) other.lift += bubble.height + 3;
    }
    bubbles.push(bubble);
  }

  function layoutBubbles(now: number, deltaMs: number) {
    for (let k = bubbles.length - 1; k >= 0; k--) {
      const bubble = bubbles[k]!;
      if (now > bubble.until || bubble.lift > 320) {
        bubble.box.destroy({ children: true });
        bubbles.splice(k, 1);
        continue;
      }
      const anchor = anchorOf(bubble.from, bubble);
      bubble.x = anchor.x;
      bubble.y = anchor.y;
      // Slide up to the place it was pushed to.
      bubble.shown += (bubble.lift - bubble.shown) * Math.min(1, (deltaMs / 1000) * 12);
      // Never out of the room's picture.
      const x = Math.min(ROOM_W - bubble.width / 2 - 4, Math.max(bubble.width / 2 + 4, bubble.x));
      const y = Math.max(bubble.height + 4, bubble.y - Math.round(bubble.shown));
      bubble.box.position.set(x, y);
      // Fading out at the end, and as it climbs away from its speaker.
      bubble.box.alpha = Math.min(1, (bubble.until - now) / 700) * Math.max(0.35, 1 - bubble.lift / 420);
    }
  }

  room.onChat((message) => {
    chat.add(message);
    showBubble(message);
  });
  room.onSystem((text) => chat.system(text));
  room.onChatRefused((refusal) => {
    chat.refused(refusal.message);
    host.notify(refusal.message);
  });

  // ----- Input -------------------------------------------------------------
  let hover: { i: number; j: number } | null = null;
  let goal: { i: number; j: number } | null = null;

  /** A piece of base furniture on this cell that can be sat on or lain on, and that nobody is using. */
  const seatAt = (cell: { i: number; j: number }): boolean => {
    const piece = furniture.find((f) => f.placement && covers(f.placement, cell));
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
        items.find((it) => it.placement && covers(it.placement, cell)) ??
        furniture.find((f) => f.placement && covers(f.placement, cell));
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

  /** The mechanisms editor asked for a cell: the next click on the room answers it. */
  let pickingCell: ((cell: { i: number; j: number }) => void) | null = null;

  app.canvas.addEventListener(
    'click',
    async (ev) => {
      const { x, y } = toRoom(ev);
      // A click elsewhere puts the card of a piece away (a click on a piece shows its own).
      furniCard.hide();
      if (pickingCell) {
        const picked = tileAt(x, y);
        if (picked) {
          pickingCell(picked);
          pickingCell = null;
        }
        return;
      }
      const who = !selected ? playerAt(x, y) : null;
      if (who) {
        showPlayerCard({
          id: who.id,
          nickname: who.nickname,
          at: { x: ev.clientX, y: ev.clientY },
          notify: (text) => host.notify(text),
          onFriendsChanged: () => host.friendsChanged(),
          onExpel: mine
            ? async () => {
                const res = await api.expel(who.id);
                host.notify(res.ok ? `${who.nickname} a été invité à sortir.` : res.error);
              }
            : undefined,
          onReport: () => openReportDialog({ kind: 'player', id: who.id, label: `le joueur ${who.nickname}` }, (text) => host.notify(text)),
        });
        return;
      }
      const cell = tileAt(x, y);
      if (!cell) return;
      // A button sets off the mechanisms of the apartment: the server checks it is one, and what happens.
      if (!selected) {
        const button = furniture.find((f) => f.placement && covers(f.placement, cell) && catalogueEntry(f.key)?.pressable);
        if (button) {
          room.use(cell.i, cell.j);
          return;
        }
      }
      // In our own apartment, a click on a lamp, the fireplace or the TV switches it on or off.
      if (!selected && mine) {
        const light = furniture.find((f) => f.placement && covers(f.placement, cell) && isSwitchable(catalogueEntry(f.key)));
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
          items.find((it) => it.placement && covers(it.placement, cell)) ??
          furniture.find((f) => f.placement && covers(f.placement, cell) && !catalogueEntry(f.key)?.walkable);
        if (here) {
          inspect(here);
          return;
        }
      }
      if (selected && mine) {
        // The server validates ownership and that the cell is free; we only send the intention.
        const res = await api.place(selected, cell.i, cell.j);
        if (res.ok) {
          select(null);
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

  // ----- Flashes -------------------------------------------------------------
  // The server says where a rule just did something: a ring spreads out on the floor for a moment.
  const fxLayer = new Graphics();
  fxLayer.zIndex = 8800;
  world.addChild(fxLayer);
  const flashes: { i: number; j: number; color: number; at: number }[] = [];
  const FLASH_MS = 750;
  room.onFx((fx) => {
    if (flashes.length < 24) flashes.push({ ...fx, at: performance.now() });
  });
  // What a rule says to us, shown like a thought of the apartment.
  room.onRuleMessage((text) => {
    host.notify(text);
    chat.system(text);
  });

  // ----- Party: lights and confetti, thrown by the hosts ---------------------------------
  const partyLayer = new Graphics();
  partyLayer.zIndex = 8900;
  partyLayer.blendMode = 'add';
  world.addChild(partyLayer);
  // The lights stay on the floor: they do not spill over the walls or outside the room.
  const floorMask = new Graphics();
  function drawFloorMask() {
    floorMask.clear();
    for (let i = 0; i < N; i++) {
      for (let j = 0; j < N; j++) {
        const level = levelAt(shape, i, j);
        if (level === null) continue;
        const c = tileCenter(i, j);
        floorMask.poly([c.x, c.y - TH / 2, c.x + TW / 2, c.y, c.x, c.y + TH / 2, c.x - TW / 2, c.y]).fill(0xffffff);
      }
    }
  }
  drawFloorMask();
  world.addChild(floorMask);
  partyLayer.mask = floorMask;
  const confettiLayer = new Graphics();
  confettiLayer.zIndex = 9200;
  world.addChild(confettiLayer);
  interface Piece {
    x: number;
    y: number;
    vx: number;
    vy: number;
    size: number;
    color: number;
    life: number;
    spin: number;
  }
  const confetti: Piece[] = [];
  const CONFETTI_COLORS = [0xff5a7a, 0xffc857, 0x6be2a3, 0x5ab8ff, 0xb78cff, 0xff9a5a, 0xffffff];
  room.onConfetti(() => {
    if (reduceMotion) return;
    for (let k = 0; k < 110 && confetti.length < 260; k++) {
      confetti.push({
        x: Math.random() * ROOM_W,
        y: -10 - Math.random() * 60,
        vx: (Math.random() - 0.5) * 60,
        vy: 70 + Math.random() * 150,
        size: 3 + Math.floor(Math.random() * 3),
        color: CONFETTI_COLORS[Math.floor(Math.random() * CONFETTI_COLORS.length)]!,
        life: 2.6 + Math.random() * 1.8,
        spin: Math.random() * 6,
      });
    }
  });

  // ----- Team games ----------------------------------------------------------------
  // The server runs the game (colour race, statues, football) and says who is on which team, which tiles got painted,
  // who is frozen, where the ball is: here we only draw.
  const TEAM_COLORS = [0xe0564f, 0x4f7fe0];
  const TEAM_LABELS = ['Rouge', 'Bleu'];
  const ROLE_LABELS = ['Gardien', 'Coureur'];
  const paintLayer = new Graphics();
  paintLayer.zIndex = -0.5;
  world.addChild(paintLayer);
  const hud = document.createElement('div');
  hud.className = 'game-hud';
  hud.hidden = true;
  document.body.append(hud);
  type Kind = 'paint' | 'freeze' | 'soccer';
  let race: {
    kind: Kind;
    running: boolean;
    endsAt: number;
    teams: Record<string, number>;
    painted: Map<string, number>;
    frozen: Set<string>;
    scores: [number, number];
  } = { kind: 'paint', running: false, endsAt: 0, teams: {}, painted: new Map(), frozen: new Set(), scores: [0, 0] };
  let paintDirty = false;
  let hudHold = 0;
  // The ball of football: drawn on the floor, it glides to where the server says it is.
  const ball = { layer: new Graphics(), i: 0, j: 0, x: 0, y: 0, shown: false };
  ball.layer.visible = false;
  world.addChild(ball.layer);
  const placeBall = (i: number, j: number, snap: boolean) => {
    const c = tileCenter(i, j);
    ball.i = i;
    ball.j = j;
    if (snap || !ball.shown) {
      ball.x = c.x;
      ball.y = c.y;
    }
    ball.shown = true;
    ball.layer.visible = true;
  };
  const drawBall = (deltaMs: number) => {
    if (!ball.shown) return;
    const target = tileCenter(ball.i, ball.j);
    const k = reduceMotion ? 1 : Math.min(1, deltaMs / 120);
    ball.x += (target.x - ball.x) * k;
    ball.y += (target.y - ball.y) * k;
    const moving = Math.hypot(target.x - ball.x, target.y - ball.y) > 2;
    const hop = moving && !reduceMotion ? Math.abs(Math.sin(performance.now() / 70)) * 5 : 0;
    ball.layer.clear();
    ball.layer.ellipse(ball.x, ball.y + 2, 6, 3).fill({ color: 0x1b1530, alpha: 0.3 });
    ball.layer.circle(ball.x, ball.y - 6 - hop, 6).fill({ color: 0xf4efe6 }).stroke({ color: 0x1b1530, width: 1 });
    ball.layer.circle(ball.x - 1, ball.y - 7 - hop, 2).fill({ color: 0x2c2a3a });
    ball.layer.circle(ball.x + 3, ball.y - 4 - hop, 1.4).fill({ color: 0x2c2a3a });
    ball.layer.zIndex = ball.i + ball.j + 0.45;
  };
  const redrawPaint = () => {
    paintLayer.clear();
    for (const [key, team] of race.painted) {
      const [i, j] = key.split(',').map(Number) as [number, number];
      const c = tileCenter(i, j);
      diamond(paintLayer, c.x, c.y, TW / 2 - 1, TH / 2 - 1);
      paintLayer.fill({ color: TEAM_COLORS[team] ?? 0xffffff, alpha: 0.5 });
    }
    paintDirty = false;
  };
  const scoreOf = () => {
    const s = [0, 0];
    for (const t of race.painted.values()) s[t] = (s[t] ?? 0) + 1;
    return s as [number, number];
  };
  const clock = (now: number) => {
    const left = Math.max(0, Math.ceil((race.endsAt - now) / 1000));
    return `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`;
  };
  const drawHud = (now: number) => {
    if (race.running) {
      const mine = race.teams[user.id];
      if (race.kind === 'paint') {
        const [a, b] = scoreOf();
        const you = mine === undefined ? 'Tu regardes la partie' : `Tu es dans l’équipe ${TEAM_LABELS[mine]}`;
        hud.textContent = `${TEAM_LABELS[0]} ${a} · ${b} ${TEAM_LABELS[1]} · ${clock(now)} · ${you}`;
      } else if (race.kind === 'soccer') {
        const you = mine === undefined ? 'Tu regardes le match' : `Tu es dans l’équipe ${TEAM_LABELS[mine]}`;
        hud.textContent = `${TEAM_LABELS[0]} ${race.scores[0]} · ${race.scores[1]} ${TEAM_LABELS[1]} · ${clock(now)} · ${you}`;
      } else {
        const runners = Object.values(race.teams).filter((t) => t === 1).length;
        const you = mine === undefined ? 'Tu regardes la partie' : mine === 0 ? 'Tu es gardien : fige les coureurs' : race.frozen.has(user.id) ? 'Tu es gelé : un coureur doit venir te délivrer' : 'Tu es coureur : fuis, et délivre les gelés';
        hud.textContent = `Gelés ${race.frozen.size}/${runners} · ${clock(now)} · ${you}`;
      }
      hud.hidden = false;
    } else if (now < hudHold) {
      hud.hidden = false;
    } else {
      hud.hidden = true;
    }
  };
  room.onGame({
    onStart: (snap) => {
      const kind = snap.kind ?? 'paint';
      race = {
        kind, running: snap.running, endsAt: snap.endsAt, teams: snap.teams,
        painted: new Map(snap.cells.map(([i, j, t]) => [`${i},${j}`, t])),
        frozen: new Set(snap.frozen ?? []), scores: snap.scores ?? [0, 0],
      };
      paintDirty = true;
      if (kind === 'soccer' && snap.ball) placeBall(snap.ball.i, snap.ball.j, true);
      const mine = snap.teams[user.id];
      if (snap.running && mine !== undefined) {
        if (kind === 'paint') setMessage(`Course des couleurs : tu es dans l’équipe ${TEAM_LABELS[mine]}. Marche sur un maximum de cases !`);
        else if (kind === 'soccer') setMessage(`Football : tu es dans l’équipe ${TEAM_LABELS[mine]}. Marche sur le ballon pour le pousser vers le but adverse !`);
        else setMessage(mine === 0 ? 'Statues : tu es gardien. Touche les coureurs pour les geler !' : 'Statues : tu es coureur. Fuis les gardiens, et délivre les gelés en les touchant !');
      }
    },
    onPaint: (p) => {
      race.painted.set(`${p.i},${p.j}`, p.team);
      paintDirty = true;
    },
    onFreeze: ({ id, frozen }) => {
      if (frozen) race.frozen.add(id);
      else race.frozen.delete(id);
      if (id === user.id) setMessage(frozen ? 'Tu es gelé ! Un coureur doit venir te toucher.' : 'Te voilà délivré, cours !');
    },
    onBall: (b) => placeBall(b.i, b.j, false),
    onGoal: (g) => {
      race.scores = g.scores;
      placeBall(g.ball.i, g.ball.j, true);
      setMessage(`But pour l’équipe ${TEAM_LABELS[g.team]} ! ${g.scores[0]} à ${g.scores[1]}`);
    },
    onEnd: (end) => {
      race.running = false;
      const kind = end.kind ?? 'paint';
      let text: string;
      if (kind === 'freeze') text = end.winner === 0 ? 'Les gardiens ont gelé tous les coureurs !' : 'Les coureurs ont tenu jusqu’au bout !';
      else if (end.winner === null) text = `Égalité ${end.scores[0]} à ${end.scores[1]} !`;
      else text = `Équipe ${TEAM_LABELS[end.winner]} gagnante : ${end.scores[end.winner]} contre ${end.scores[1 - end.winner]} !`;
      hud.textContent = text;
      hudHold = Date.now() + 8000;
      setMessage(text);
      race.frozen.clear();
      ball.shown = false;
      ball.layer.visible = false;
      // The painted floor stays a few seconds, then is wiped.
      setTimeout(() => {
        if (!race.running) {
          race.painted.clear();
          paintDirty = true;
        }
      }, 8000);
    },
  });

  // ----- The jukebox -------------------------------------------------------------------
  const music = createMusic();
  const soundButton = document.createElement('button');
  soundButton.type = 'button';
  soundButton.className = 'sound-toggle';
  soundButton.hidden = true;
  const drawSound = () => {
    soundButton.textContent = music.muted() ? '♪ ✕' : '♪';
    soundButton.title = music.muted() ? 'Remettre le son' : 'Couper le son';
    soundButton.setAttribute('aria-label', soundButton.title);
  };
  drawSound();
  soundButton.addEventListener('click', () => {
    music.setMuted(!music.muted());
    drawSound();
  });
  document.body.append(soundButton);
  room.onMusic((trackId, elapsed) => {
    soundButton.hidden = trackId === 0;
    if (trackId) music.play(trackId, elapsed);
    else music.stop();
  });

  // A companion shows off what it has learnt, at the word of its owner.
  room.onPetTrick((owner, kind) => {
    const view = views.get(owner);
    const pet = view?.pet;
    if (!view || !pet) return;
    const now = performance.now();
    if (kind === 'viens') {
      pet.x = view.x - 22;
      pet.y = view.y + 6;
      pet.movedAt = now;
      return;
    }
    pet.trick = { kind, since: now, until: now + (kind === 'assis' ? 6000 : 1000) };
  });

  /** A colour that goes round the wheel: hue in degrees. */
  const wheel = (hue: number) => {
    const h = ((hue % 360) + 360) % 360 / 60;
    const x = 1 - Math.abs((h % 2) - 1);
    const [r, g, b] = h < 1 ? [1, x, 0] : h < 2 ? [x, 1, 0] : h < 3 ? [0, 1, x] : h < 4 ? [0, x, 1] : h < 5 ? [x, 0, 1] : [1, 0, x];
    return (Math.round(r * 255) << 16) | (Math.round(g * 255) << 8) | Math.round(b * 255);
  };

  function drawParty(now: number, deltaMs: number) {
    partyLayer.clear();
    if (room.lights()) {
      // A wash of colour over the room, and spots sweeping the floor (still, when the system asks for less motion).
      const clock = reduceMotion ? 0 : now;
      partyLayer.rect(0, 0, ROOM_W, ROOM_H).fill({ color: wheel(clock / 25), alpha: 0.07 });
      for (let k = 0; k < 6; k++) {
        const t = clock / 1500 + k * 1.1;
        const x = ROOM_W / 2 + Math.cos(t * 0.9 + k) * 190;
        const y = 240 + Math.sin(t * 1.3 + k * 2) * 70;
        partyLayer.ellipse(x, y, 95, 46).fill({ color: wheel(clock / 18 + k * 60), alpha: 0.2 });
        partyLayer.ellipse(x, y, 45, 22).fill({ color: 0xffffff, alpha: 0.12 });
      }
    }
    confettiLayer.clear();
    const dt = deltaMs / 1000;
    for (let k = confetti.length - 1; k >= 0; k--) {
      const p = confetti[k]!;
      p.life -= dt;
      if (p.life <= 0 || p.y > ROOM_H + 10) {
        confetti.splice(k, 1);
        continue;
      }
      p.x += (p.vx + Math.sin(now / 200 + p.spin) * 30) * dt;
      p.y += p.vy * dt;
      confettiLayer.rect(Math.round(p.x), Math.round(p.y), p.size, Math.max(2, p.size - 1 - Math.round(Math.abs(Math.sin(now / 150 + p.spin)) * 2))).fill({ color: p.color, alpha: Math.min(1, p.life) });
    }
  }

  function drawFlashes(now: number) {
    fxLayer.clear();
    for (let k = flashes.length - 1; k >= 0; k--) {
      const f = flashes[k]!;
      const age = (now - f.at) / FLASH_MS;
      if (age >= 1) {
        flashes.splice(k, 1);
        continue;
      }
      const c = tileCenter(f.i, f.j);
      for (const [grow, alpha] of [[0.5 + age * 0.9, 1 - age], [0.3 + age * 0.6, (1 - age) * 0.6]] as const) {
        diamond(fxLayer, c.x, c.y, (TW / 2) * grow, (TH / 2) * grow);
        fxLayer.stroke({ color: f.color, width: 3, alpha });
      }
      diamond(fxLayer, c.x, c.y, TW / 2, TH / 2);
      fxLayer.fill({ color: f.color, alpha: 0.3 * (1 - age) });
    }
  }

  // ----- Frame loop --------------------------------------------------------
  // Dust drifting in the sunbeam of an apartment.
  const dust = new Graphics();
  dust.zIndex = 9000;
  world.addChild(dust);
  const motes = Array.from({ length: 22 }, (_, k) => ({ a: Math.random() * 6, b: Math.random(), speed: 0.6 + Math.random() * 0.8, k }));

  const tick = (ticker: Ticker) => {
    const now = performance.now();
    syncPlayers(ticker.deltaMS, now);
    layoutBubbles(now, ticker.deltaMS);
    drawFlashes(now);
    drawParty(now, ticker.deltaMS);

    if (!reduceMotion) {
      for (const prop of props.values()) {
        // Animated pieces: water runs, lights chase, fish swim. Each piece has its own phase so that two never beat together.
        if (prop.frames && prop.frames.length > 1) {
          const idx = Math.floor(now / (prop.frameMs ?? 250) + prop.phase) % prop.frames.length;
          if (idx !== prop.frameIdx) {
            prop.frameIdx = idx;
            prop.sprite.texture = prop.frames[idx]!;
          }
        }
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

    if (paintDirty) redrawPaint();
    drawBall(ticker.deltaMS);
    drawHud(Date.now());
    marks.clear();
    if (hover) {
      // Putting a piece down: every tile it would cover is shown, green if all are free, red if one is not.
      const [w, h] = selected ? selectedFootprint() : [1, 1];
      let free = true;
      for (let a = 0; a < w; a++) for (let b = 0; b < h; b++) if (blocked(hover.i + a, hover.j + b) || hover.i + a >= N || hover.j + b >= N) free = false;
      for (let a = 0; a < w; a++) {
        for (let b = 0; b < h; b++) {
          const c = tileCenter(hover.i + a, hover.j + b);
          diamond(marks, c.x, c.y, TW / 2, TH / 2);
          marks.fill({ color: seatAt(hover) && !selected ? 0x8ac8ff : !free ? 0xff8a80 : selected ? 0x8affa0 : 0xffc857, alpha: 0.45 });
        }
      }
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
    // Our own apartment: a rule just lit or put out something, read it again.
    if (mine) return void refreshOwn();
    if (target.kind !== 'apartment') return;
    const visit = await api.apartment(target.ownerId);
    if (closing || !visit.ok) return;
    items = visit.data.items;
    furniture = visit.data.furniture;
    syncItems();
    changeRoom(visit.data.floor, visit.data.wall, visit.data.layout);
  }
  room.onMessage('decor', () => void reloadVisit());

  let closing = false;
  // The staff speaks: announcements, a call to join them, or a trip to where a player is.
  room.onAlert((alert) => showAlert(alert, (target) => host.go(target)));
  room.onSummon((from, target) => showSummon(from, target, (t) => host.go(t)));
  room.onGoto((target) => host.go(target));

  // Somebody rings at our door, or answers a ring of ours.
  room.onRing((ring) => showRing(ring.visitorId, ring.nickname, (text) => host.notify(text)));
  room.onBellAnswer((answer) => host.notify(answer.text));

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
    host.notify(
      code === CLOSED_BY_OWNER
        ? 'Le propriétaire vient de fermer son appart.'
        : code === EXPELLED
          ? 'Le propriétaire t’a invité à sortir.'
          : code === KICKED
            ? 'Un membre de l’équipe t’a fait sortir de la salle.'
            : 'Tu as été déconnecté de la salle.',
    );
    host.go({ kind: 'building' });
  });

  return {
    info: info.element,
    inventory: inventoryElement,
    apartment: apartmentElement,
    history: chat.log,
    chatBar: chat.bar,
    size: { w: ROOM_W, h: ROOM_H },
    refresh: () => (mine ? refreshOwn() : undefined),
    refreshAppearance: () => room.refreshAppearance(),
    destroy() {
      closing = true;
      chat.destroy();
      furniCard.destroy();
      banner.remove();
      hud.remove();
      ball.layer.destroy();
      soundButton.remove();
      music.destroy();
      abort.abort();
      app.ticker.remove(tick);
      void room.leave();
      world.destroy({ children: true });
    },
  };
}
