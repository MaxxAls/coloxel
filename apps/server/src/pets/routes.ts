import type { FastifyInstance } from 'fastify';
import type pg from 'pg';
import { z } from 'zod';
import { FILTER_MESSAGES, filterText } from '../moderation/text-filter';
import { NO_GUARDS, type RateGuards } from '../rate-limit';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface PetRow {
  id: string;
  species: string;
  color: number;
  name: string;
  active: boolean;
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
    const { rows } = await pool.query<PetRow>(
      `SELECT p.id, p.species, p.color, p.name, (u.active_pet_id = p.id) AS active
         FROM pets p JOIN users u ON u.id = p.owner_id
        WHERE p.owner_id = $1 ORDER BY p.created_at`,
      [userId],
    );
    return rows;
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
