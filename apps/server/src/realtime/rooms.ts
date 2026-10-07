import { Room, ServerError, type AuthContext, type Client } from '@colyseus/core';
import { schema, t, type SchemaType } from '@colyseus/schema';
import type pg from 'pg';
import { z } from 'zod';
import { findPath, inGrid, type Cell } from '@coloxel/world';
import { canEnterApartment } from '../apartments/access';
import type { SessionUser } from '../auth/routes';
import { authenticateConnection } from './auth';

export const STEP_MS = 150;
export const SPAWN: Cell = { i: 7, j: 0 };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const Player = schema(
  {
    id: t.string(),
    nickname: t.string(),
    i: t.uint8(),
    j: t.uint8(),
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

  /** Room-specific entry check (the hall is open to every signed-in player). */
  protected async authorize(_user: SessionUser): Promise<void> {}

  /** Cells nobody can walk onto. */
  protected async blockedCells(): Promise<Set<number>> {
    return new Set();
  }

  override async onAuth(_client: Client, _options: unknown, context: AuthContext) {
    const { pool, allowedOrigins } = needDeps();
    const user = await authenticateConnection(pool, context, allowedOrigins);
    await this.authorize(user);
    return user;
  }

  override onCreate(_options?: unknown) {
    this.setState(new RoomState());
    this.setSimulationInterval(() => this.step(), STEP_MS);

    this.onMessage('move', async (client, message) => {
      const parsed = moveSchema.safeParse(message);
      if (!parsed.success || !inGrid(parsed.data.i, parsed.data.j)) return;
      const { id } = userOf(client);
      const player = this.state.players.get(id);
      if (!player) return;
      const blocked = await this.blockedCells();
      const path = findPath({ i: player.i, j: player.j }, parsed.data, (i, j) => blocked.has(i * 8 + j));
      if (path.length) this.paths.set(id, path);
      else this.paths.delete(id);
    });
  }

  override onJoin(client: AuthedClient) {
    const user = userOf(client);
    // One seat per player: a second connection replaces the first.
    const previous = this.clientsByUser.get(user.id);
    if (previous && previous !== client) previous.leave(4000, 'Connecté ailleurs');
    this.clientsByUser.set(user.id, client);

    const player = new Player();
    player.id = user.id;
    player.nickname = user.nickname;
    player.i = SPAWN.i;
    player.j = SPAWN.j;
    this.paths.delete(user.id);
    this.state.players.set(user.id, player);
  }

  override onLeave(client: AuthedClient) {
    const id = userOf(client).id;
    // A replaced connection leaving must not remove the player of the new one.
    if (this.clientsByUser.get(id) !== client) return;
    this.clientsByUser.delete(id);
    this.paths.delete(id);
    this.state.players.delete(id);
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
      if (!path.length) this.paths.delete(id);
    }
  }
}

/** The common area on the ground floor. */
export class HallRoom extends BuildingRoom {}

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
    super.onCreate();
  }

  protected override async authorize(user: SessionUser) {
    // Same answer for a closed apartment and an unknown one.
    if (!(await canEnterApartment(needDeps().pool, this.ownerId, user.id))) {
      throw new ServerError(403, 'Cet appartement est fermé');
    }
  }

  protected override async blockedCells() {
    const { rows } = await needDeps().pool.query<{ i: number; j: number }>(
      'SELECT i, j FROM placements WHERE user_id = $1',
      [this.ownerId],
    );
    return new Set(rows.map((r) => r.i * 8 + r.j));
  }
}
