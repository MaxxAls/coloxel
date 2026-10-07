import type pg from 'pg';

/** Why Coloxs moved. Stored on every ledger line (and checked by the database). */
export type ColoxKind = 'pack' | 'purchase' | 'sale' | 'royalty' | 'refund' | 'chargeback' | 'staff';

/**
 * Add Coloxs to a player. Returns the new balance. The balance itself is moved by a database
 * trigger on the ledger line, so this is the only way in. Runs inside the transaction of
 * whatever the Coloxs come from (a sale, a payment, a royalty...).
 */
export async function creditColoxs(client: pg.PoolClient, userId: string, amount: number, kind: ColoxKind, detail?: string): Promise<number> {
  if (!Number.isInteger(amount) || amount <= 0) throw new Error('A credit must be a positive whole number of Coloxs');
  await client.query('INSERT INTO colox_ledger (user_id, delta, kind, detail) VALUES ($1, $2, $3, $4)', [userId, amount, kind, detail ?? null]);
  return balanceOf(client, userId);
}

/**
 * Take Coloxs from a player. Returns the new balance, or null when there are not enough.
 * The row is locked first so two spends at the same time cannot both pass the check.
 */
export async function debitColoxs(client: pg.PoolClient, userId: string, amount: number, kind: ColoxKind, detail?: string): Promise<number | null> {
  if (!Number.isInteger(amount) || amount <= 0) throw new Error('A debit must be a positive whole number of Coloxs');
  const { rows } = await client.query<{ coloxs: number }>('SELECT coloxs FROM users WHERE id = $1 FOR UPDATE', [userId]);
  if (!rows[0] || rows[0].coloxs < amount) return null;
  await client.query('INSERT INTO colox_ledger (user_id, delta, kind, detail) VALUES ($1, $2, $3, $4)', [userId, -amount, kind, detail ?? null]);
  return rows[0].coloxs - amount;
}

async function balanceOf(client: pg.PoolClient, userId: string): Promise<number> {
  const { rows } = await client.query<{ coloxs: number }>('SELECT coloxs FROM users WHERE id = $1', [userId]);
  return rows[0]!.coloxs;
}

/**
 * Consistency check meant to run every day: every balance must equal the sum of its ledger lines.
 * Returns the players for whom it does not (an empty list is the healthy answer).
 */
export async function findColoxMismatches(db: pg.Pool | pg.PoolClient): Promise<{ userId: string; balance: number; ledger: number }[]> {
  const { rows } = await db.query<{ id: string; coloxs: number; ledger: string }>(
    `SELECT u.id, u.coloxs, coalesce(sum(l.delta), 0) AS ledger
       FROM users u LEFT JOIN colox_ledger l ON l.user_id = u.id
      GROUP BY u.id, u.coloxs
     HAVING u.coloxs <> coalesce(sum(l.delta), 0)`,
  );
  return rows.map((r) => ({ userId: r.id, balance: r.coloxs, ledger: Number(r.ledger) }));
}
