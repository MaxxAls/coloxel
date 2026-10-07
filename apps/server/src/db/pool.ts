import pg from 'pg';

const DEFAULT_URL = 'postgres://coloxel:coloxel@localhost:5432/coloxel';

export function createPool(connectionString = process.env.DATABASE_URL ?? DEFAULT_URL) {
  return new pg.Pool({ connectionString });
}

/** Run fn in one transaction: commit on success, roll back on any error. */
export async function withTransaction<T>(
  pool: pg.Pool,
  fn: (client: pg.PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/** Take the next gapless item number. Must run inside the creation transaction. */
export async function nextItemSerial(client: pg.PoolClient): Promise<number> {
  const { rows } = await client.query<{ last_value: number }>(
    'UPDATE item_serial SET last_value = last_value + 1 WHERE id = 1 RETURNING last_value',
  );
  return rows[0]!.last_value;
}
