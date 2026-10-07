import type { Server as HttpServer } from 'node:http';
import { Server, matchMaker } from '@colyseus/core';
import { RedisPresence } from '@colyseus/redis-presence';
import { WebSocketTransport } from '@colyseus/ws-transport';
import type pg from 'pg';
import type { Presence } from '../building/routes';
import { ApartmentRoom, HallRoom, apartmentTopic, configureRooms } from './rooms';
import { makeQuestRecorder } from '../quests/engine';
import { USER_TOPIC, type NotifyUser } from '../moderation/sanctions';
import { WHERE_KEY, locationOf, type Location, type WhereEntry } from './where';

export interface RealtimeOptions {
  pool: pg.Pool;
  /** 0 picks a free port (tests). */
  port?: number;
  /** Without it, presence stays in memory: fine for one process, not for several. */
  redisUrl?: string;
  /** Browser origins allowed to open a connection. */
  allowedOrigins?: readonly string[];
}

export interface Realtime {
  server: Server;
  port: number;
  /** Players currently inside each apartment, by owner id (for the building view). */
  occupancy(): Promise<Presence>;
  /** Tell the room of an apartment, wherever it runs, that its access or decor changed. */
  notifyApartment(ownerId: string, kind: 'access' | 'decor' | 'rules'): void;
  /** Tell the rooms, wherever they run, that a player was sanctioned: it takes effect on their open connection. */
  notifyUser: NotifyUser;
  /** Where each of these players is, among those connected right now. */
  locate(userIds: string[]): Promise<Map<string, Location>>;
  close(): Promise<void>;
}

export async function startRealtime({
  pool,
  port = Number(process.env.REALTIME_PORT ?? 2567),
  redisUrl = process.env.REDIS_URL,
  allowedOrigins = (process.env.CLIENT_ORIGINS ?? 'http://localhost:5173').split(',').map((o) => o.trim()),
}: RealtimeOptions): Promise<Realtime> {
  configureRooms({
    pool,
    allowedOrigins,
    quest: makeQuestRecorder(pool, (event) => void matchMaker.presence.publish(USER_TOPIC, event)),
  });

  const presence = redisUrl ? new RedisPresence(redisUrl) : undefined;
  const server = new Server({
    transport: new WebSocketTransport(),
    presence,
    greet: false,
    gracefullyShutdown: false,
  });
  server.define('hall', HallRoom);
  server.define('apartment', ApartmentRoom).filterBy(['ownerId']);

  await server.listen(port);
  const http = (server.transport as unknown as { server: HttpServer }).server;
  const address = http.address();
  const actualPort = typeof address === 'object' && address ? address.port : port;

  return {
    server,
    port: actualPort,
    notifyApartment(ownerId, kind) {
      void matchMaker.presence.publish(apartmentTopic(ownerId), kind);
    },
    notifyUser(event) {
      void matchMaker.presence.publish(USER_TOPIC, event);
    },
    async locate(userIds) {
      const found = new Map<string, Location>();
      if (!userIds.length) return found;
      const [entries, rooms] = await Promise.all([matchMaker.presence.hgetall(WHERE_KEY), matchMaker.query({})]);
      // A process that died leaves its players behind in the store: only rooms that still exist count.
      const live = new Set(rooms.map((r) => r.roomId));
      for (const id of userIds) {
        const raw = entries[id];
        if (!raw) continue;
        try {
          const entry = JSON.parse(raw) as WhereEntry;
          const at = live.has(entry.roomId) ? locationOf(entry.room) : null;
          if (at) found.set(id, at);
        } catch {
          // An unreadable entry is no entry.
        }
      }
      return found;
    },
    async occupancy() {
      const rooms = await matchMaker.query({ name: 'apartment' });
      const apartments = new Map<string, number>();
      for (const room of rooms) {
        const ownerId = (room.metadata as { ownerId?: string } | undefined)?.ownerId;
        if (ownerId && room.clients > 0) apartments.set(ownerId, (apartments.get(ownerId) ?? 0) + room.clients);
      }
      const halls = await matchMaker.query({ name: 'hall' });
      return { apartments, hall: halls.reduce((n, room) => n + room.clients, 0) };
    },
    close: () => server.gracefullyShutdown(false),
  };
}
