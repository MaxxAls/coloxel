import type { FastifyInstance } from 'fastify';
import type pg from 'pg';
import { z } from 'zod';
import type { NotifyApartment } from '../building/routes';
import type { NotifyUser } from '../moderation/sanctions';
import { NO_GUARDS, type RateGuards } from '../rate-limit';
import type { Locate } from '../realtime/where';
import { canEnterApartment } from './access';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Somebody the owner let in at the door may stay a quarter of an hour; they ring again after that. */
export const BELL_GRANT_MINUTES = 15;
/** Somebody shown out stays out for half an hour. */
export const EXPEL_MINUTES = 30;
/** The same visitor rings the same door at most once in this many milliseconds. */
export const RING_COOLDOWN_MS = 20_000;

const answerSchema = z.object({ visitorId: z.string().regex(UUID, 'Visiteur invalide'), accept: z.boolean('Réponse invalide') }).strict();

/**
 * What the owner of an apartment can do about who comes in: answer the doorbell, and show
 * somebody out. The owner is always the session's player and the apartment is theirs.
 */
export function registerVisitorRoutes(
  app: FastifyInstance,
  pool: pg.Pool,
  deps: { notifyUser?: NotifyUser; notifyApartment?: NotifyApartment; locate?: Locate },
  guards: RateGuards = NO_GUARDS,
) {
  const lastRing = new Map<string, number>();

  // Ring at someone's door. Only an apartment on the doorbell can be rung at, and only by someone who is not already welcome.
  app.post<{ Params: { ownerId: string } }>('/api/apartments/:ownerId/ring', { preHandler: guards.social }, async (req, reply) => {
    if (!req.user) return reply.code(401).send({ error: 'Non connecté' });
    const { ownerId } = req.params;
    if (!UUID.test(ownerId) || ownerId.toLowerCase() === req.user.id) return reply.code(404).send({ error: 'Appartement introuvable' });
    const owner = ownerId.toLowerCase();
    const row = await pool.query<{ apartment_access: string }>('SELECT apartment_access FROM users WHERE id = $1', [owner]);
    if (row.rows[0]?.apartment_access !== 'bell') return reply.code(404).send({ error: 'Appartement introuvable' });
    if (await canEnterApartment(pool, owner, req.user.id)) return { status: 'open' };

    const key = `${req.user.id}:${owner}`;
    const now = Date.now();
    if (now - (lastRing.get(key) ?? 0) < RING_COOLDOWN_MS) return reply.code(429).send({ error: 'Tu as déjà sonné, patiente un instant.' });
    const expelled = await pool.query('SELECT 1 FROM apartment_bans WHERE owner_id = $1 AND user_id = $2 AND expires_at > now()', [owner, req.user.id]);
    if (expelled.rowCount) return reply.code(403).send({ error: 'Le propriétaire ne veut pas de visite de ta part pour le moment.' });
    if (deps.locate && !(await deps.locate([owner])).has(owner)) {
      return reply.code(409).send({ error: 'Le propriétaire n’est pas là pour répondre. Réessaie plus tard.' });
    }
    lastRing.set(key, now);
    deps.notifyUser?.({ userId: owner, kind: 'ring', visitorId: req.user.id, nickname: req.user.nickname });
    return reply.code(202).send({ status: 'ringing' });
  });

  // The owner says yes or no. A yes lets the visitor in for a while; both are told at once.
  app.post('/api/apartment/bell/answer', async (req, reply) => {
    if (!req.user) return reply.code(401).send({ error: 'Non connecté' });
    const parsed = answerSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? 'Requête invalide' });
    const { visitorId, accept } = parsed.data;
    const visitor = visitorId.toLowerCase();
    if (visitor === req.user.id) return reply.code(400).send({ error: 'C’est toi !' });
    const who = await pool.query<{ nickname: string }>('SELECT nickname FROM users WHERE id = $1', [visitor]);
    if (!who.rows[0]) return reply.code(404).send({ error: 'Joueur introuvable' });
    if (accept) {
      await pool.query(
        `INSERT INTO bell_grants (owner_id, visitor_id, expires_at) VALUES ($1, $2, now() + make_interval(mins => $3))
         ON CONFLICT (owner_id, visitor_id) DO UPDATE SET expires_at = EXCLUDED.expires_at`,
        [req.user.id, visitor, BELL_GRANT_MINUTES],
      );
      // A player the owner showed out is welcome again when the owner says so.
      await pool.query('DELETE FROM apartment_bans WHERE owner_id = $1 AND user_id = $2', [req.user.id, visitor]);
    }
    deps.notifyUser?.({
      userId: visitor,
      kind: 'bell-answer',
      ownerId: req.user.id,
      accepted: accept,
      text: accept ? `${req.user.nickname} t’ouvre la porte !` : `${req.user.nickname} n’ouvre pas pour le moment.`,
    });
    return { ok: true };
  });

  // Show a visitor out. They cannot come back for a while, and whatever let them in no longer counts.
  app.post<{ Params: { userId: string } }>('/api/apartment/visitors/:userId/expel', { preHandler: guards.social }, async (req, reply) => {
    if (!req.user) return reply.code(401).send({ error: 'Non connecté' });
    const { userId } = req.params;
    if (!UUID.test(userId) || userId.toLowerCase() === req.user.id) return reply.code(404).send({ error: 'Joueur introuvable' });
    const target = userId.toLowerCase();
    const found = await pool.query('SELECT 1 FROM users WHERE id = $1', [target]);
    if (!found.rowCount) return reply.code(404).send({ error: 'Joueur introuvable' });
    await pool.query(
      `INSERT INTO apartment_bans (owner_id, user_id, expires_at) VALUES ($1, $2, now() + make_interval(mins => $3))
       ON CONFLICT (owner_id, user_id) DO UPDATE SET expires_at = EXCLUDED.expires_at`,
      [req.user.id, target, EXPEL_MINUTES],
    );
    await pool.query('DELETE FROM bell_grants WHERE owner_id = $1 AND visitor_id = $2', [req.user.id, target]);
    // The apartment's room checks who may still be inside and shows the expelled one out.
    deps.notifyApartment?.(req.user.id, 'access');
    return { ok: true };
  });
}
