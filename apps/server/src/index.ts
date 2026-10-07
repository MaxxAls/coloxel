import cookie from '@fastify/cookie';
import Fastify from 'fastify';
import type pg from 'pg';
import { SEEDS, renderSprite } from '@coloxel/render';
import { registerAuthRoutes } from './auth/routes';
import { modelFromEnv, type RecipeModel } from './creations/model';
import { registerCreationRoutes } from './creations/routes';
import { spriteToPng } from './sprite-png';

export { spriteToPng };

export interface ServerDeps {
  /** Without a pool only the database-free routes are served (used by some tests). */
  pool?: pg.Pool;
  /** Object generator. Defaults to the Anthropic API from env; null means not configured. */
  model?: RecipeModel | null;
}

export function buildServer({ pool, model = modelFromEnv() }: ServerDeps = {}) {
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

  if (pool) {
    app.register(async (scope) => {
      registerAuthRoutes(scope, pool);
      registerCreationRoutes(scope, pool, model);
    });
  }

  return app;
}
