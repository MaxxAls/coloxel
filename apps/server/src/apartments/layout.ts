import type pg from 'pg';
import { DEFAULT_LAYOUT, hasFloor, isValidLayout, presetByKey, type RoomLayout } from '@coloxel/world';

/** The shape of a player's apartment. A stored shape that no longer passes validation falls back to the square. */
export async function loadLayout(db: pg.Pool | pg.PoolClient, ownerId: string): Promise<RoomLayout> {
  const { rows } = await db.query<{ layout: unknown }>('SELECT layout FROM apartments WHERE owner_id = $1', [ownerId]);
  const stored = rows[0]?.layout;
  return isValidLayout(stored) ? { cells: stored.cells, door: { i: stored.door.i, j: stored.door.j } } : DEFAULT_LAYOUT;
}

/** Pick a ready-made shape by its key. */
export const layoutOfPreset = (key: string): RoomLayout | null => presetByKey(key)?.layout ?? null;

/**
 * Change the shape of an apartment. Whatever was placed where there is no floor any more goes back to the inventory. Returns how many pieces went back, or null when the
 * player has no apartment.
 */
export async function saveLayout(pool: pg.Pool, ownerId: string, layout: RoomLayout): Promise<number | null> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const updated = await client.query('UPDATE apartments SET layout = $1 WHERE owner_id = $2', [JSON.stringify(layout), ownerId]);
    if (updated.rowCount === 0) {
      await client.query('ROLLBACK');
      return null;
    }
    const { rows } = await client.query<{ i: number; j: number }>('SELECT i, j FROM placements WHERE user_id = $1', [ownerId]);
    const gone = rows.filter((r) => !hasFloor(layout, r.i, r.j));
    for (const r of gone) await client.query('DELETE FROM placements WHERE user_id = $1 AND i = $2 AND j = $3', [ownerId, r.i, r.j]);
    await client.query('COMMIT');
    return gone.length;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}
