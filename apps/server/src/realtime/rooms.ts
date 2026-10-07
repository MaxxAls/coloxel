import { Room, ServerError, type AuthContext, type Client } from '@colyseus/core';
import { schema, t, type SchemaType } from '@colyseus/schema';
import type pg from 'pg';
import { z } from 'zod';
import { catalogueEntry } from '@coloxel/render';
import { N, findPath, inGrid, type Cell } from '@coloxel/world';
import { canEnterApartment } from '../apartments/access';
import { loadAppearance } from '../avatar/routes';
import type { SessionUser } from '../auth/routes';
import { ChatLimiter, REFUSAL_MESSAGES, judgeChatText, logChat } from '../chat/chat';
import { SUSPENDED, USER_TOPIC, liveSanction, sanctionText, type UserEvent } from '../moderation/sanctions';
import { authenticateConnection } from './auth';
import { WHERE_KEY, roomLabel, type Location, type WhereEntry } from './where';

/** One cell per step: a calm, continuous walk, about half a second per cell. */
export const STEP_MS = 480;
/** How a player is posed: on their feet, sitting, or lying down. */
export const POSE = { stand: 0, sit: 1, lie: 2 } as const;
type Interaction = 'sit' | 'lie';
/** Close code sent to a visitor when the owner closes the apartment on them. */
export const CLOSED_BY_OWNER = 4003;
/** Presence topic carrying the changes of one apartment. */
export const apartmentTopic = (ownerId: string) => `apartment:${ownerId.toLowerCase()}`;
export const SPAWN: Cell = { i: 7, j: 0 };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const Player = schema(
  {
    id: t.string(),
    nickname: t.string(),
    i: t.uint8(),
    j: t.uint8(),
    pose: t.uint8(),
    /** The player's look, as JSON of plain numbers (see packages/render/src/look.ts). */
    look: t.string(),
    /** Active companion as "species:colour:name", or empty. */
    pet: t.string(),
  },
  'Player',
);
export type Player = SchemaType<typeof Player>;

export const RoomState = schema({ players: t.map(Player) }, 'RoomState');
export type RoomState = SchemaType<typeof RoomState>;

export interface RealtimeDeps {
  pool: pg.Pool;
  allowedOrigins: readonly string[];
}

// Wired by startRealtime() before any room is created.
let deps: RealtimeDeps | null = null;
export function configureRooms(d: RealtimeDeps) {
  deps = d;
}
const needDeps = () => {
  if (!deps) throw new Error('realtime rooms are not configured');
  return deps;
};

const moveSchema = z.object({ i: z.number().int(), j: z.number().int() }).strict();
const chatSchema = z.object({ text: z.string() }).strict();

type AuthedClient = Client<{ auth: SessionUser }>;

// onAuth always ran before any handler: a client without identity cannot be here.
function userOf(client: AuthedClient): SessionUser {
  if (!client.auth) throw new ServerError(401, 'Non connecté');
  return client.auth;
}

/**
 * Shared behaviour of the hall and the apartments. The server owns positions:
 * a client only says "I want to go to (i, j)"; the server finds the path and
 * moves the player one cell per step. Who the player is comes from the
 * session (client.auth), never from a message.
 */
abstract class BuildingRoom extends Room<{ state: RoomState; client: AuthedClient }> {
  override maxClients = 50;
  // Past this a client is disconnected, which keeps a flooding client from
  // loading the room: the other players are unaffected.
  override maxMessagesPerSecond = 20;

  private paths = new Map<string, Cell[]>();
  private clientsByUser = new Map<string, AuthedClient>();
  private lastRefresh = new Map<string, number>();
  private chatLimiter = new ChatLimiter();
  private chatChain: Promise<void> = Promise.resolve();
  /** A player walking to a seat or a bed takes the pose when they arrive. */
  private pending = new Map<string, { cell: Cell; pose: number }>();

  /** Where this room is: the hall, or the apartment of its owner. */
  protected abstract location(): Location;

  /** Room-specific entry check (the hall is open to every signed-in player). */
  protected async authorize(_user: SessionUser): Promise<void> {}

  /** Cells nobody can walk onto, and among them the seats and beds. The hall holds none. */
  protected async layout(): Promise<{ blocked: Set<number>; seats: Map<number, Interaction> }> {
    return { blocked: new Set(), seats: new Map() };
  }

  /** Is someone already sitting or lying on this cell? */
  private taken(i: number, j: number, except?: string): boolean {
    let found = false;
    this.state.players.forEach((p, id) => {
      if (id !== except && p.i === i && p.j === j && p.pose !== POSE.stand) found = true;
    });
    return found;
  }

  /** After the decor changed: whoever sits or lies where there is no longer a seat gets back on their feet. */
  protected async revalidatePoses(): Promise<void> {
    const { seats } = await this.layout();
    this.state.players.forEach((p, id) => {
      if (p.pose !== POSE.stand && !seats.has(p.i * N + p.j)) {
        p.pose = POSE.stand;
        this.pending.delete(id);
      }
    });
  }

  override async onAuth(_client: Client, _options: unknown, context: AuthContext) {
    const { pool, allowedOrigins } = needDeps();
    const user = await authenticateConnection(pool, context, allowedOrigins);
    await this.authorize(user);
    return user;
  }

  /** The staff sanctioned a player: if they are here, they are told, or shown out. Wherever the room runs. */
  private onUserEvent = (event: UserEvent) => {
    if (!event || typeof event.userId !== 'string') return;
    for (const client of [...this.clients]) {
      if ((client.auth as SessionUser | undefined)?.id !== event.userId) continue;
      if (event.kind === 'suspension' || event.kind === 'ban') client.leave(SUSPENDED, event.text);
      else client.send('notice', { id: event.id, kind: event.kind, text: event.text });
    }
  };

  override onCreate(_options?: unknown) {
    this.setState(new RoomState());
    void this.presence.subscribe(USER_TOPIC, this.onUserEvent);
    this.setSimulationInterval(() => this.step(), STEP_MS);

    // The player changed what they wear or which companion follows them: read it again from the database.
    // The message carries nothing; what everybody sees always comes from the server's own records.
    this.onMessage('refresh', async (client) => {
      const { id } = userOf(client);
      const player = this.state.players.get(id);
      const now = Date.now();
      if (!player || now - (this.lastRefresh.get(id) ?? 0) < 400) return;
      this.lastRefresh.set(id, now);
      const appearance = await loadAppearance(needDeps().pool, id);
      player.look = JSON.stringify(appearance.look);
      player.pet = appearance.pet;
    });

    // Chat. The author is the session's player, the text is checked, journaled and only then shown to the room.
    // A blocked message is told to its author alone; nobody else sees anything.
    this.onMessage('chat', (client, message) => {
      const parsed = chatSchema.safeParse(message);
      if (!parsed.success) return;
      // One at a time, in order of arrival: messages are shown in the order they were written.
      this.chatChain = this.chatChain.then(() => this.handleChat(client, parsed.data.text)).catch(() => {});
    });

    this.onMessage('move', async (client, message) => {
      const parsed = moveSchema.safeParse(message);
      if (!parsed.success || !inGrid(parsed.data.i, parsed.data.j)) return;
      const { id } = userOf(client);
      const player = this.state.players.get(id);
      if (!player) return;
      const { blocked, seats } = await this.layout();
      const target = parsed.data;
      // A seat or a bed that is free can be walked onto: that is how one sits down. Everything else placed is in the way.
      const kind = seats.get(target.i * N + target.j);
      const usable = kind !== undefined && !this.taken(target.i, target.j, id);
      const path = findPath({ i: player.i, j: player.j }, target, (i, j) =>
        blocked.has(i * N + j) && !(usable && i === target.i && j === target.j),
      );
      if (path.length) {
        // Any new walk gets the player back on their feet first.
        player.pose = POSE.stand;
        this.paths.set(id, path);
        if (usable) this.pending.set(id, { cell: target, pose: kind === 'lie' ? POSE.lie : POSE.sit });
        else this.pending.delete(id);
      } else {
        this.paths.delete(id);
        this.pending.delete(id);
      }
    });
  }

  private async handleChat(client: AuthedClient, rawText: string) {
    const { id } = userOf(client);
    const player = this.state.players.get(id);
    if (!player) return;
    const refuse = (reason: string, text: string) => client.send('chat-refused', { reason, message: text });
    if (!this.chatLimiter.allow(id)) return refuse('rate', REFUSAL_MESSAGES.rate);
    const verdict = judgeChatText(rawText);
    if (!verdict.ok && verdict.reason !== 'filtered') return refuse(verdict.reason, verdict.message);
    const room = roomLabel(this.location());
    const { pool } = needDeps();
    try {
      // A muted player is told so; what they write is journaled, and shown to nobody.
      const mute = await liveSanction(pool, id, ['mute']);
      if (mute) {
        await logChat(pool, { userId: id, room, text: verdict.text, blocked: true, reason: 'muted' });
        return refuse('muted', sanctionText('mute', mute.reason, mute.expiresAt));
      }
      if (!verdict.ok) {
        await logChat(pool, { userId: id, room, text: verdict.text, blocked: true, reason: verdict.detail });
        return refuse(verdict.reason, verdict.message);
      }
      const messageId = await logChat(pool, { userId: id, room, text: verdict.text, blocked: false });
      this.broadcast('chat', { id: messageId, from: id, nickname: player.nickname, text: verdict.text });
    } catch {
      // Not journaled, not shown: every message shown is a message the staff can find.
      refuse('error', 'Ton message n’a pas pu être envoyé, réessaie.');
    }
  }

  /** The free cell closest to the door: not under an object, not under another player. */
  private spawnCell(blocked: Set<number>): Cell {
    const taken = new Set<number>(blocked);
    this.state.players.forEach((p) => taken.add(p.i * N + p.j));
    let best: Cell | null = null;
    let bestDistance = Infinity;
    for (let i = 0; i < N; i++) {
      for (let j = 0; j < N; j++) {
        const d = Math.abs(i - SPAWN.i) + Math.abs(j - SPAWN.j);
        if (!taken.has(i * N + j) && d < bestDistance) {
          best = { i, j };
          bestDistance = d;
        }
      }
    }
    return best ?? SPAWN;
  }

  override async onJoin(client: AuthedClient) {
    const user = userOf(client);
    const { blocked } = await this.layout();
    // One seat per player: a second connection replaces the first.
    const previous = this.clientsByUser.get(user.id);
    if (previous && previous !== client) previous.leave(4000, 'Connecté ailleurs');
    this.clientsByUser.set(user.id, client);

    const player = new Player();
    player.id = user.id;
    player.nickname = user.nickname;
    const appearance = await loadAppearance(needDeps().pool, user.id);
    player.look = JSON.stringify(appearance.look);
    player.pet = appearance.pet;
    // A second connection of the same player replaces the first: its old cell is free again.
    this.state.players.delete(user.id);
    const spawn = this.spawnCell(blocked);
    player.i = spawn.i;
    player.j = spawn.j;
    player.pose = POSE.stand;
    this.paths.delete(user.id);
    this.pending.delete(user.id);
    this.state.players.set(user.id, player);
    // Friends can see where we are.
    const entry: WhereEntry = { room: roomLabel(this.location()), roomId: this.roomId };
    await this.presence.hset(WHERE_KEY, user.id, JSON.stringify(entry)).catch(() => {});
  }

  override onDispose() {
    void this.presence.unsubscribe(USER_TOPIC, this.onUserEvent);
  }

  override async onLeave(client: AuthedClient) {
    const id = userOf(client).id;
    // A replaced connection leaving must not remove the player of the new one.
    if (this.clientsByUser.get(id) !== client) return;
    this.clientsByUser.delete(id);
    this.lastRefresh.delete(id);
    this.chatLimiter.forget(id);
    this.paths.delete(id);
    this.pending.delete(id);
    this.state.players.delete(id);
    // Forget our place, unless the player already is somewhere else (they joined another room before this one noticed).
    try {
      const raw = await this.presence.hget(WHERE_KEY, id);
      if (raw && (JSON.parse(raw) as WhereEntry).roomId === this.roomId) await this.presence.hdel(WHERE_KEY, id);
    } catch {
      // The presence store is a convenience for friends lists: a failure here must not break leaving.
    }
  }

  private step() {
    for (const [id, path] of this.paths) {
      const player = this.state.players.get(id);
      const next = path.shift();
      if (!player || !next) {
        this.paths.delete(id);
        continue;
      }
      player.i = next.i;
      player.j = next.j;
      if (!path.length) {
        this.paths.delete(id);
        // Arrived: sit down or lie down, unless someone got there first.
        const want = this.pending.get(id);
        this.pending.delete(id);
        if (want && want.cell.i === next.i && want.cell.j === next.j && !this.taken(next.i, next.j, id)) player.pose = want.pose;
      }
    }
  }
}

/** The common area on the ground floor. */
export class HallRoom extends BuildingRoom {
  protected override location(): Location {
    return { kind: 'hall' };
  }
}

/** One room per open apartment, keyed by its owner. */
export class ApartmentRoom extends BuildingRoom {
  override maxClients = 20;
  // Taken from the creation options once, then fixed: a client cannot pick
  // another apartment by forging the options of a later join.
  private ownerId = '';

  override onCreate(options?: { ownerId?: unknown }) {
    if (typeof options?.ownerId !== 'string' || !UUID.test(options.ownerId)) {
      throw new ServerError(400, 'Appartement invalide');
    }
    this.ownerId = options.ownerId.toLowerCase();
    // Lets the building view count who is inside.
    void this.setMetadata({ ownerId: this.ownerId });
    super.onCreate();
    // The owner changes the door or the decor through the API: this room, wherever it runs, hears of it.
    this.presence.subscribe(apartmentTopic(this.ownerId), this.onChange);
  }

  override onDispose() {
    super.onDispose();
    void this.presence.unsubscribe(apartmentTopic(this.ownerId), this.onChange);
  }

  protected override location(): Location {
    return { kind: 'apartment', ownerId: this.ownerId };
  }

  private onChange = (kind: unknown) => {
    if (kind === 'decor') {
      void this.revalidatePoses().then(() => this.broadcast('decor'));
    }
    else if (kind === 'access') void this.sendOutUnwelcome();
  };

  /** Visitors who may no longer enter (door closed, or opened to friends only) are shown out at once. */
  private async sendOutUnwelcome() {
    const { pool } = needDeps();
    for (const client of [...this.clients]) {
      const user = client.auth as SessionUser | undefined;
      if (!user || user.id.toLowerCase() === this.ownerId) continue;
      if (!(await canEnterApartment(pool, this.ownerId, user.id))) client.leave(CLOSED_BY_OWNER, 'Le propriétaire a fermé son appart');
    }
  }

  protected override async authorize(user: SessionUser) {
    // Same answer for a closed apartment and an unknown one.
    if (!(await canEnterApartment(needDeps().pool, this.ownerId, user.id))) {
      throw new ServerError(403, 'Cet appartement est fermé');
    }
  }

  protected override async layout() {
    const { rows } = await needDeps().pool.query<{ i: number; j: number; key: string | null }>(
      `SELECT p.i, p.j, f.catalogue_key AS key
         FROM placements p LEFT JOIN furniture f ON f.id = p.furniture_id
        WHERE p.user_id = $1`,
      [this.ownerId],
    );
    const blocked = new Set<number>();
    const seats = new Map<number, Interaction>();
    for (const r of rows) {
      blocked.add(r.i * N + r.j);
      // Only base furniture can be used: a creation is whatever its maker invented.
      const use = r.key ? catalogueEntry(r.key)?.interaction : undefined;
      if (use) seats.set(r.i * N + r.j, use);
    }
    return { blocked, seats };
  }
}
