import cookie from '@fastify/cookie';
import Fastify from 'fastify';
import type pg from 'pg';
import { PNG } from 'pngjs';
import { SEEDS, renderSprite, type Sprite } from '@coloxel/render';
import { registerAuthRoutes } from './auth/routes';

export function spriteToPng(sprite: Sprite): Buffer {
  const png = new PNG({ width: sprite.width, height: sprite.height });
  png.data = Buffer.from(sprite.data);
  return PNG.sync.write(png);
}

export interface ServerDeps {
  /** Without a pool only the database-free routes are served (used by some tests). */
  pool?: pg.Pool;
}

export function buildServer({ pool }: ServerDeps = {}) {
  const app = Fastify({ logger: process.env.NODE_ENV !== 'test' });
  app.register(cookie);

  app.get('/health', async () => ({ ok: true }));

  // Server-side render of the example objects. Phase 1 replaces this with
  // /api/items/:id.png backed by PostgreSQL (see docs/phase-1-alpha-solo.md).
  app.get<{ Params: { index: string } }>('/api/seeds/:index.png', async (req, reply) => {
    const seed = SEEDS[Number(req.params.index)];
    if (!seed) return reply.code(404).send({ error: 'Objet introuvable' });
    return reply.type('image/png').send(spriteToPng(renderSprite(seed.parts)));
  });

  if (pool) app.register(async (scope) => registerAuthRoutes(scope, pool));

  return app;
}
