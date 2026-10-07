import type { FastifyInstance } from 'fastify';
import type pg from 'pg';
import { z } from 'zod';
import { withTransaction } from '../db/pool';
import { NO_GUARDS, type RateGuards } from '../rate-limit';

/** Pixels everybody gets once a day, just for coming by. */
export const DAILY_PIXELS = 50;

/**
 * Take Pixels from a player. Returns the new balance, or null when there are
 * not enough: the balance can never go below zero (also a database check).
 * Runs inside the transaction of whatever the Pixels pay for.
 */
export async function spendPixels(client: pg.PoolClient, userId: string, amount: number, reason: string): Promise<number | null> {
  if (amount <= 0) return null;
  const { rows } = await client.query<{ pixels: number }>(
    'UPDATE users SET pixels = pixels - $2 WHERE id = $1 AND pixels >= $2 RETURNING pixels',
    [userId, amount],
  );
  if (!rows[0]) return null;
  await client.query('INSERT INTO pixel_ledger (user_id, delta, reason) VALUES ($1, $2, $3)', [userId, -amount, reason]);
  return rows[0].pixels;
}

export async function grantPixels(client: pg.PoolClient, userId: string, amount: number, reason: string): Promise<number> {
  const { rows } = await client.query<{ pixels: number }>(
    'UPDATE users SET pixels = pixels + $2 WHERE id = $1 RETURNING pixels',
    [userId, amount],
  );
  await client.query('INSERT INTO pixel_ledger (user_id, delta, reason) VALUES ($1, $2, $3)', [userId, amount, reason]);
  return rows[0]!.pixels;
}

const redeemSchema = z.object({ code: z.string('Code invalide').trim().min(3, 'Code invalide').max(24, 'Code invalide') }).strict();

export function registerWalletRoutes(app: FastifyInstance, pool: pg.Pool, guards: RateGuards = NO_GUARDS) {
  app.get('/api/wallet', async (req, reply) => {
    if (!req.user) return reply.code(401).send({ error: 'Non connecté' });
    const { rows } = await pool.query<{ pixels: number; daily_available: boolean }>(
      'SELECT pixels, (last_daily IS NULL OR last_daily < current_date) AS daily_available FROM users WHERE id = $1',
      [req.user.id],
    );
    const row = rows[0];
    if (!row) return reply.code(401).send({ error: 'Non connecté' });
    return { pixels: row.pixels, dailyAvailable: row.daily_available, dailyPixels: DAILY_PIXELS };
  });

  // Once per calendar day: the update only matches when today's reward has not been taken.
  app.post('/api/wallet/daily', { preHandler: guards.shop }, async (req, reply) => {
    const user = req.user;
    if (!user) return reply.code(401).send({ error: 'Non connecté' });
    const pixels = await withTransaction(pool, async (client) => {
      const { rowCount } = await client.query(
        'UPDATE users SET last_daily = current_date WHERE id = $1 AND (last_daily IS NULL OR last_daily < current_date)',
        [user.id],
      );
      if (!rowCount) return null;
      return grantPixels(client, user.id, DAILY_PIXELS, 'Récompense du jour');
    });
    if (pixels === null) return reply.code(409).send({ error: 'Tu as déjà pris ta récompense du jour. À demain !' });
    return { pixels, gained: DAILY_PIXELS };
  });

  app.post('/api/wallet/redeem', { preHandler: guards.shop }, async (req, reply) => {
    const user = req.user;
    if (!user) return reply.code(401).send({ error: 'Non connecté' });
    const parsed = redeemSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? 'Code invalide' });
    const code = parsed.data.code.toUpperCase();

    const result = await withTransaction(pool, async (client) => {
      const found = await client.query<{ pixels: number }>(
        'SELECT pixels FROM redeem_codes WHERE code = $1 AND (expires_at IS NULL OR expires_at > now())',
        [code],
      );
      if (!found.rows[0]) return 'unknown' as const;
      // The primary key (code, player) is what makes a code usable once.
      const used = await client.query('INSERT INTO redeem_uses (code, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [code, user.id]);
      if (!used.rowCount) return 'used' as const;
      const gained = found.rows[0].pixels;
      return { pixels: await grantPixels(client, user.id, gained, `Code ${code}`), gained };
    });
    if (result === 'unknown') return reply.code(404).send({ error: 'Ce code n’existe pas ou n’est plus valable.' });
    if (result === 'used') return reply.code(409).send({ error: 'Tu as déjà utilisé ce code.' });
    return result;
  });
}
