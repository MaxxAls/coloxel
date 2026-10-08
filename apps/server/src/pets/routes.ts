import type { FastifyInstance } from 'fastify';
import type pg from 'pg';
import { z } from 'zod';
import { FED_SPAN_MS, JOY_SPAN_MS, PET_TRICKS, PET_XP_FEED, PET_XP_PLAY, careReadyAfterMs, petLevel, petMood, petNeed, xpForLevel } from '@coloxel/render';
import { FILTER_MESSAGES, filterText } from '../moderation/text-filter';
import { NO_GUARDS, type RateGuards } from '../rate-limit';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface PetRow {
  id: string;
  species: string;
  color: number;
  name: string;
  active: boolean;
  /** 0 to 100, worked out when read. */
  hunger: number;
  joy: number;
  mood: 'happy' | 'ok' | 'sad';
  xp: number;
  level: number;
  /** XP of the next level, or null at the top. */
  nextLevelXp: number | null;
  tricks: string[];
}

interface PetDbRow {
  id: string;
  species: string;
  color: number;
  name: string;
  active: boolean;
  xp: number;
  since_fed_ms: number;
  since_played_ms: number;
}

/** What a client sees of a companion: the stored fields, and its needs and level worked out from them. */
export function describePet(r: PetDbRow): PetRow {
  const hunger = petNeed(r.since_fed_ms, FED_SPAN_MS);
  const joy = petNeed(r.since_played_ms, JOY_SPAN_MS);
  const level = petLevel(r.xp);
  return {
    id: r.id, species: r.species, color: r.color, name: r.name, active: r.active,
    hunger, joy, mood: petMood(hunger, joy), xp: r.xp, level,
    nextLevelXp: level >= 10 ? null : xpForLevel(level + 1),
    tricks: PET_TRICKS.filter((t) => t.level <= level).map((t) => t.key),
  };
}

/** A pet's name is read by other players: same filter as apartment names and chat. */
export function checkPetName(name: string): string | null {
  const verdict = filterText(name);
  return verdict.ok ? null : FILTER_MESSAGES[verdict.reason];
}

const nameSchema = z.object({ name: z.string('Nom invalide').trim().min(1, 'Donne un nom à ton compagnon').max(20, 'Ce nom est trop long (20 caractères au maximum)') }).strict();
const activeSchema = z.object({ id: z.union([z.string(), z.null()]) }).strict();

export function registerPetRoutes(app: FastifyInstance, pool: pg.Pool, guards: RateGuards = NO_GUARDS) {
  const list = async (userId: string): Promise<PetRow[]> => {
    const { rows } = await pool.query<PetDbRow>(
      `SELECT p.id, p.species, p.color, p.name, (u.active_pet_id = p.id) AS active, p.xp,
              (extract(epoch FROM now() - p.fed_at) * 1000)::float8 AS since_fed_ms,
              (extract(epoch FROM now() - p.played_at) * 1000)::float8 AS since_played_ms
         FROM pets p JOIN users u ON u.id = p.owner_id
        WHERE p.owner_id = $1 ORDER BY p.created_at`,
      [userId],
    );
    return rows.map(describePet);
  };

  app.get('/api/pets', async (req, reply) => {
    if (!req.user) return reply.code(401).send({ error: 'Non connecté' });
    return { pets: await list(req.user.id) };
  });

  // Who comes along: one companion at a time, or none.
  app.put('/api/pets/active', { preHandler: guards.shop }, async (req, reply) => {
    const user = req.user;
    if (!user) return reply.code(401).send({ error: 'Non connecté' });
    const parsed = activeSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Compagnon invalide' });
    const { id } = parsed.data;
    if (id === null) {
      await pool.query('UPDATE users SET active_pet_id = NULL WHERE id = $1', [user.id]);
    } else {
      if (!UUID.test(id)) return reply.code(404).send({ error: 'Compagnon introuvable' });
      const { rowCount } = await pool.query(
        'UPDATE users SET active_pet_id = $2 WHERE id = $1 AND EXISTS (SELECT 1 FROM pets WHERE id = $2 AND owner_id = $1)',
        [user.id, id],
      );
      if (!rowCount) return reply.code(404).send({ error: 'Compagnon introuvable' });
    }
    return { pets: await list(user.id) };
  });

  app.patch<{ Params: { id: string } }>('/api/pets/:id', { preHandler: guards.shop }, async (req, reply) => {
    const user = req.user;
    if (!user) return reply.code(401).send({ error: 'Non connecté' });
    if (!UUID.test(req.params.id)) return reply.code(404).send({ error: 'Compagnon introuvable' });
    const parsed = nameSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? 'Nom invalide' });
    const refused = checkPetName(parsed.data.name);
    if (refused) return reply.code(400).send({ error: refused });
    const { rowCount } = await pool.query('UPDATE pets SET name = $3 WHERE id = $1 AND owner_id = $2', [req.params.id, user.id, parsed.data.name]);
    if (!rowCount) return reply.code(404).send({ error: 'Compagnon introuvable' });
    return { pets: await list(user.id) };
  });

  // Care. Free, but it only works once the need is there (below the threshold), and it earns experience.
  const care = (column: 'fed_at' | 'played_at', span: number, xp: number, refusal: string) =>
    async (req: { user?: { id: string } | null; params: { id: string } }, reply: { code: (n: number) => { send: (b: unknown) => unknown } }) => {
      const user = req.user;
      if (!user) return reply.code(401).send({ error: 'Non connecté' });
      if (!UUID.test(req.params.id)) return reply.code(404).send({ error: 'Compagnon introuvable' });
      // One statement: the check and the update cannot be split by a second request.
      const { rowCount } = await pool.query(
        `UPDATE pets SET ${column} = now(), xp = xp + $3
          WHERE id = $1 AND owner_id = $2 AND extract(epoch FROM now() - ${column}) * 1000 >= $4`,
        [req.params.id, user.id, xp, careReadyAfterMs(span)],
      );
      if (!rowCount) {
        const exists = await pool.query('SELECT 1 FROM pets WHERE id = $1 AND owner_id = $2', [req.params.id, user.id]);
        return reply.code(exists.rowCount ? 409 : 404).send({ error: exists.rowCount ? refusal : 'Compagnon introuvable' });
      }
      return { pets: await list(user.id) };
    };
  app.post<{ Params: { id: string } }>('/api/pets/:id/feed', { preHandler: guards.shop }, care('fed_at', FED_SPAN_MS, PET_XP_FEED, 'Il n’a pas faim pour l’instant.'));
  app.post<{ Params: { id: string } }>('/api/pets/:id/play', { preHandler: guards.shop }, care('played_at', JOY_SPAN_MS, PET_XP_PLAY, 'Il n’a pas envie de jouer pour l’instant.'));

  // Letting a companion go does not refund it.
  app.delete<{ Params: { id: string } }>('/api/pets/:id', { preHandler: guards.shop }, async (req, reply) => {
    const user = req.user;
    if (!user) return reply.code(401).send({ error: 'Non connecté' });
    if (!UUID.test(req.params.id)) return reply.code(404).send({ error: 'Compagnon introuvable' });
    const { rowCount } = await pool.query('DELETE FROM pets WHERE id = $1 AND owner_id = $2', [req.params.id, user.id]);
    if (!rowCount) return reply.code(404).send({ error: 'Compagnon introuvable' });
    return { pets: await list(user.id) };
  });
}
