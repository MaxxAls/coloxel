import type { Server as HttpServer } from 'node:http';
import { Server, matchMaker } from '@colyseus/core';
import { RedisPresence } from '@colyseus/redis-presence';
import { WebSocketTransport } from '@colyseus/ws-transport';
import type pg from 'pg';
import { ApartmentRoom, HallRoom, configureRooms } from './rooms';

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
  occupancy(): Promise<Map<string, number>>;
  close(): Promise<void>;
}

export async function startRealtime({
  pool,
  port = Number(process.env.REALTIME_PORT ?? 2567),
  redisUrl = process.env.REDIS_URL,
  allowedOrigins = (process.env.CLIENT_ORIGINS ?? 'http://localhost:5173').split(',').map((o) => o.trim()),
}: RealtimeOptions): Promise<Realtime> {
  configureRooms({ pool, allowedOrigins });

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
    async occupancy() {
      const rooms = await matchMaker.query({ name: 'apartment' });
      const present = new Map<string, number>();
      for (const room of rooms) {
        const ownerId = (room.metadata as { ownerId?: string } | undefined)?.ownerId;
        if (ownerId && room.clients > 0) present.set(ownerId, (present.get(ownerId) ?? 0) + room.clients);
      }
      return present;
    },
    close: () => server.gracefullyShutdown(false),
  };
}
