import type pg from 'pg';
import { DEFAULT_LAYOUT, hasFloor, isValidLayout, presetByKey, wallBehind, type RoomLayout } from '@coloxel/world';

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
    const { rows } = await client.query<{ i: number; j: number; w: number; h: number; layer: number }>('SELECT i, j, w, h, layer FROM placements WHERE user_id = $1', [ownerId]);
    // A big piece needs a floor under every tile it covers, and a piece on a wall needs the wall to still be there.
    const gone = rows.filter((r) => {
      if (r.layer) return !wallBehind(layout, r.layer === 1 ? 'left' : 'right', r.i, r.j);
      for (let a = 0; a < r.w; a++) for (let b = 0; b < r.h; b++) if (!hasFloor(layout, r.i + a, r.j + b)) return true;
      return false;
    });
    for (const r of gone) await client.query('DELETE FROM placements WHERE user_id = $1 AND i = $2 AND j = $3 AND layer = $4', [ownerId, r.i, r.j, r.layer]);
    await client.query('COMMIT');
    return gone.length;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}
