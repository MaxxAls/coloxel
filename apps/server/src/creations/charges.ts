import type pg from 'pg';
import { withTransaction } from '../db/pool';

export const DAILY_CHARGES = 5;

type Queryable = pg.Pool | pg.PoolClient;

/** Grant today's refill once per user and Paris day. Caller must hold the user row lock. */
async function ensureRefill(client: pg.PoolClient, userId: string) {
  await client.query(
    `INSERT INTO creation_charges (user_id, delta, reason, day)
     SELECT $1, $2, 'refill', (now() AT TIME ZONE 'Europe/Paris')::date
     WHERE NOT EXISTS (
       SELECT 1 FROM creation_charges
       WHERE user_id = $1 AND reason = 'refill' AND day = (now() AT TIME ZONE 'Europe/Paris')::date
     )`,
    [userId, DAILY_CHARGES],
  );
}

async function balanceToday(client: Queryable, userId: string): Promise<number> {
  const { rows } = await client.query<{ balance: number }>(
    `SELECT COALESCE(SUM(delta), 0)::int AS balance FROM creation_charges
     WHERE user_id = $1 AND day = (now() AT TIME ZONE 'Europe/Paris')::date`,
    [userId],
  );
  return rows[0]!.balance;
}

const lockUser = (client: pg.PoolClient, userId: string) =>
  client.query('SELECT 1 FROM users WHERE id = $1 FOR UPDATE', [userId]);

export function getCharges(pool: pg.Pool, userId: string): Promise<number> {
  return withTransaction(pool, async (c) => {
    await lockUser(c, userId);
    await ensureRefill(c, userId);
    return balanceToday(c, userId);
  });
}

export interface Reservation {
  chargeId: number;
  day: string;
  remaining: number;
}

/**
 * Spend one charge up front. The per-user row lock serializes concurrent
 * requests of the same player, so they can never spend more than they have,
 * and the model call itself happens outside any transaction.
 */
export function reserveCharge(pool: pg.Pool, userId: string): Promise<Reservation | null> {
  return withTransaction(pool, async (c) => {
    await lockUser(c, userId);
    await ensureRefill(c, userId);
    const balance = await balanceToday(c, userId);
    if (balance <= 0) return null;
    const { rows } = await c.query<{ id: string; day: string }>(
      `INSERT INTO creation_charges (user_id, delta, reason, day)
       VALUES ($1, -1, 'spend', (now() AT TIME ZONE 'Europe/Paris')::date) RETURNING id, day::text`,
      [userId],
    );
    return { chargeId: Number(rows[0]!.id), day: rows[0]!.day, remaining: balance - 1 };
  });
}

/** Give a reserved charge back (model refusal, invalid recipe, model error). */
export async function refundCharge(pool: pg.Pool, userId: string, reservation: Reservation): Promise<void> {
  await pool.query(`INSERT INTO creation_charges (user_id, delta, reason, day) VALUES ($1, 1, 'refund', $2)`, [
    userId,
    reservation.day,
  ]);
}
