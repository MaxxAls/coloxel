import type { FastifyInstance } from 'fastify';
import type pg from 'pg';
import { FED_SPAN_MS, JOY_SPAN_MS, LOOK_ITEMS, MOOD_CODE, SLOTS, lookFor, paidPieces, parseLook, petLevel, petMood, petNeed, petSpecies, type Look, type Slot } from '@coloxel/render';
import { NO_GUARDS, type RateGuards } from '../rate-limit';

/** The look of a player: the one they saved, or the one derived from their id until they customise. */
export async function loadLook(pool: pg.Pool, userId: string): Promise<Look> {
  const { rows } = await pool.query<{ look: unknown }>('SELECT look FROM users WHERE id = $1', [userId]);
  return parseLook(rows[0]?.look) ?? lookFor(userId);
}

/** The bought pieces of a player's wardrobe, as piece ids per slot. */
export async function loadOwned(pool: pg.Pool, userId: string): Promise<Record<Slot, number[]>> {
  const { rows } = await pool.query<{ slot: Slot; piece: number }>(
    'SELECT slot, piece FROM wardrobe WHERE user_id = $1 ORDER BY slot, piece',
    [userId],
  );
  const owned = Object.fromEntries(SLOTS.map((s) => [s, [] as number[]])) as Record<Slot, number[]>;
  for (const r of rows) owned[r.slot]?.push(r.piece);
  return owned;
}

/** What others see next to a player: look and active companion, read from the database, never from a client message. */
export async function loadAppearance(pool: pg.Pool, userId: string): Promise<{ look: Look; pet: string; petMood: number; petLevel: number }> {
  const { rows } = await pool.query<{ look: unknown; species: string | null; color: number | null; name: string | null; xp: number | null; since_fed: number | null; since_played: number | null }>(
    `SELECT u.look, p.species, p.color, p.name, p.xp,
            (extract(epoch FROM now() - p.fed_at) * 1000)::float8 AS since_fed,
            (extract(epoch FROM now() - p.played_at) * 1000)::float8 AS since_played
       FROM users u LEFT JOIN pets p ON p.id = u.active_pet_id
      WHERE u.id = $1`,
    [userId],
  );
  const row = rows[0];
  const look = parseLook(row?.look) ?? lookFor(userId);
  const hasPet = !!row?.species && !!petSpecies(row.species);
  const pet = hasPet ? `${row!.species}:${row!.color ?? 0}:${row!.name ?? ''}` : '';
  const mood = hasPet ? petMood(petNeed(row!.since_fed ?? 0, FED_SPAN_MS), petNeed(row!.since_played ?? 0, JOY_SPAN_MS)) : 'happy';
  return { look, pet, petMood: MOOD_CODE[mood], petLevel: hasPet ? petLevel(row!.xp ?? 0) : 0 };
}

export function registerAvatarRoutes(app: FastifyInstance, pool: pg.Pool, guards: RateGuards = NO_GUARDS) {
  app.get('/api/me/look', async (req, reply) => {
    if (!req.user) return reply.code(401).send({ error: 'Non connecté' });
    return { look: await loadLook(pool, req.user.id), owned: await loadOwned(pool, req.user.id) };
  });

  // Wear something: the server checks that every paid piece is in the wardrobe.
  app.put('/api/me/look', { preHandler: guards.shop }, async (req, reply) => {
    const user = req.user;
    if (!user) return reply.code(401).send({ error: 'Non connecté' });
    const look = parseLook(req.body);
    if (!look) return reply.code(400).send({ error: 'Apparence invalide' });
    const owned = await loadOwned(pool, user.id);
    for (const piece of paidPieces(look)) {
      if (!owned[piece.slot].includes(piece.id)) {
        return reply.code(403).send({ error: `Tu ne possèdes pas encore « ${LOOK_ITEMS[piece.slot][piece.id]!.name} ».` });
      }
    }
    await pool.query('UPDATE users SET look = $2 WHERE id = $1', [user.id, JSON.stringify(look)]);
    return { look };
  });
}
