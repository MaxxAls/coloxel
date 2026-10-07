import cookie from '@fastify/cookie';
import Fastify from 'fastify';
import type pg from 'pg';
import { SEEDS, renderSprite } from '@coloxel/render';
import { registerAuthRoutes } from './auth/routes';
import { registerBuildingRoutes, type NotifyApartment, type Occupancy } from './building/routes';
import { modelFromEnv, type RecipeModel } from './creations/model';
import { registerCreationRoutes } from './creations/routes';
import { registerAvatarRoutes } from './avatar/routes';
import { registerVisitorRoutes } from './apartments/visitors';
import { registerFriendRoutes } from './friends/routes';
import { registerFurnitureRoutes } from './furniture/routes';
import { makeQuestRecorder } from './quests/engine';
import { registerQuestRoutes } from './quests/routes';
import { registerNoticeRoutes } from './moderation/notices';
import type { NotifyUser } from './moderation/sanctions';
import { registerPetRoutes } from './pets/routes';
import { registerReportRoutes } from './reports/routes';
import { registerShopRoutes } from './shop/routes';
import { registerWalletRoutes } from './wallet/routes';
import { registerInventoryRoutes } from './inventory/routes';
import type { Locate } from './realtime/where';
import { DEFAULT_LIMITS, buildRateGuards, type RateLimits } from './rate-limit';
import { spriteToPng } from './sprite-png';
import { registerStaffRoutes } from './staff/routes';

export { spriteToPng };

export interface ServerDeps {
  /** Without a pool only the database-free routes are served (used by some tests). */
  pool?: pg.Pool;
  /** Object generator. Defaults to the Anthropic API from env; null means not configured. */
  model?: RecipeModel | null;
  /** Request limits on login, registration and creations. Off under tests (NODE_ENV=test) or with DISABLE_RATE_LIMIT=true (local dev). */
  rateLimits?: RateLimits | false;
  /** ioredis client for shared counters; in-memory counters without it. */
  redis?: unknown;
  /** Players currently inside each apartment (from the realtime server). */
  occupancy?: Occupancy;
  /** Lets the apartment's room know about a change of access or decor (from the realtime server). */
  notifyApartment?: NotifyApartment;
  /** Where each connected player is (from the realtime server): friends see each other's place. */
  locate?: Locate;
  /** Lets a sanction reach a player who is connected (from the realtime server). */
  notifyUser?: NotifyUser;
}

export function buildServer({
  pool,
  model = modelFromEnv(),
  rateLimits = process.env.NODE_ENV === 'test' || process.env.DISABLE_RATE_LIMIT === 'true' ? false : DEFAULT_LIMITS,
  redis,
  occupancy,
  notifyApartment,
  locate,
  notifyUser,
}: ServerDeps = {}) {
  const quest = pool ? makeQuestRecorder(pool, (event) => notifyUser?.(event)) : undefined;
  const app = Fastify({
    logger: process.env.NODE_ENV !== 'test',
    // Behind a reverse proxy, the client IP comes from X-Forwarded-For: only trust it when told to.
    trustProxy: process.env.TRUST_PROXY === 'true',
  });
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
      const guards = await buildRateGuards(scope, rateLimits, redis);
      registerAuthRoutes(scope, pool, guards);
      registerCreationRoutes(scope, pool, model, guards, quest);
      registerInventoryRoutes(scope, pool, notifyApartment, quest);
      registerFurnitureRoutes(scope, pool, guards, notifyApartment);
      registerBuildingRoutes(scope, pool, occupancy, notifyApartment, locate);
      registerFriendRoutes(scope, pool, locate, notifyApartment, guards, quest);
      registerReportRoutes(scope, pool, guards);
      registerVisitorRoutes(scope, pool, { notifyUser, notifyApartment, locate }, guards);
      registerNoticeRoutes(scope, pool);
      registerStaffRoutes(scope, pool, notifyUser, notifyApartment);
      registerWalletRoutes(scope, pool, guards);
      registerAvatarRoutes(scope, pool, guards);
      registerShopRoutes(scope, pool, guards, quest);
      registerQuestRoutes(scope, pool);
      registerPetRoutes(scope, pool, guards);
    });
  }

  return app;
}
