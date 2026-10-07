import rateLimit from '@fastify/rate-limit';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

interface Limit {
  max: number;
  /** Window in milliseconds. */
  window: number;
}

export interface RateLimits {
  loginPerIp: Limit;
  loginPerAccount: Limit;
  registerPerIp: Limit;
  creationsPerUser: Limit;
  creationsPerIp: Limit;
  furniturePerUser: Limit;
}

const MINUTE = 60_000;

export const DEFAULT_LIMITS: RateLimits = {
  loginPerIp: { max: 20, window: 15 * MINUTE },
  loginPerAccount: { max: 8, window: 15 * MINUTE },
  registerPerIp: { max: 5, window: 60 * MINUTE },
  creationsPerUser: { max: 10, window: MINUTE },
  creationsPerIp: { max: 60, window: MINUTE },
  furniturePerUser: { max: 120, window: MINUTE },
};

type Guard = (req: FastifyRequest, reply: FastifyReply) => Promise<unknown>;

/** One list of guards per protected route; empty when limits are disabled. */
export interface RateGuards {
  login: Guard[];
  register: Guard[];
  creations: Guard[];
  furniture: Guard[];
}

export const NO_GUARDS: RateGuards = { login: [], register: [], creations: [], furniture: [] };

/**
 * Brute force on login and spam of the generator are the two things that cost
 * something. Counters live in Redis when available (shared by all processes),
 * otherwise in memory.
 */
export async function buildRateGuards(
  app: FastifyInstance,
  limits: RateLimits | false,
  redis?: unknown,
): Promise<RateGuards> {
  if (!limits) return NO_GUARDS;
  await app.register(rateLimit, { global: false, redis, nameSpace: 'coloxel-rl:' });

  // A route has several limits (per IP, per account). @fastify/rate-limit runs
  // only one handler per request, so each route gets one guard that checks all
  // of its counters through createRateLimit.
  const rule = (limit: Limit, key: (req: FastifyRequest) => string, message: string) => ({
    check: app.createRateLimit({ max: limit.max, timeWindow: limit.window, keyGenerator: key }),
    message,
  });
  const guard =
    (...rules: ReturnType<typeof rule>[]): Guard =>
    async (req, reply) => {
      for (const { check, message } of rules) {
        const result = await check(req);
        // Not `isAllowed` just means "counted": the limit is hit only once isExceeded.
        if (result.isAllowed || !result.isExceeded) continue;
        return reply.code(429).header('retry-after', Math.max(1, Math.ceil(result.ttlInSeconds))).send({ error: message });
      }
    };

  const ip = (name: string) => (req: FastifyRequest) => `${name}:ip:${req.ip}`;
  const tooMany = 'Trop de tentatives, réessaie dans quelques minutes.';
  const slowDown = 'Doucement ! Réessaie dans un instant.';

  return {
    login: [
      guard(
        rule(limits.loginPerIp, ip('login'), tooMany),
        // Per account: the email being tried, whoever tries it.
        rule(
          limits.loginPerAccount,
          (req) => `login:account:${String((req.body as { email?: unknown } | null)?.email ?? '').trim().toLowerCase()}`,
          tooMany,
        ),
      ),
    ],
    register: [guard(rule(limits.registerPerIp, ip('register'), 'Trop d’inscriptions depuis cette adresse, réessaie plus tard.'))],
    creations: [
      guard(
        rule(limits.creationsPerIp, ip('creations'), slowDown),
        rule(limits.creationsPerUser, (req) => `creations:user:${req.user?.id ?? req.ip}`, slowDown),
      ),
    ],
    furniture: [guard(rule(limits.furniturePerUser, (req) => `furniture:user:${req.user?.id ?? req.ip}`, slowDown))],
  };
}
