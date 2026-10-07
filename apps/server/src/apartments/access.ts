import type pg from 'pg';

// Single place deciding who may see into an apartment. The owner always can;
// others depend on the owner's apartment_access. 'friends' fails closed until
// the friends list exists, so no visitor gets in by accident.
// `host` is the apartment owner's users row; `viewer` is the SQL parameter holding the viewer's id.
export const apartmentAccessSql = (viewer: string) => `(host.id = ${viewer} OR host.apartment_access = 'building')`;
export const APARTMENT_ACCESS_SQL = apartmentAccessSql('$2');

// Can `viewerId` see the sprite of `itemId`? Either they own it, or it is
// placed in an apartment they may enter. Returns the recipe when allowed.
export async function findViewableItemRecipe<R>(pool: pg.Pool, itemId: string, viewerId: string): Promise<R | null> {
  const { rows } = await pool.query<{ recipe: R }>(
    `SELECT i.recipe
       FROM items i
       LEFT JOIN placements p ON p.item_id = i.id
       LEFT JOIN users host ON host.id = p.user_id
      WHERE i.id = $1
        AND (i.owner_id = $2 OR (p.item_id IS NOT NULL AND ${APARTMENT_ACCESS_SQL}))`,
    [itemId, viewerId],
  );
  return rows[0]?.recipe ?? null;
}

// Can `viewerId` walk into `hostId`'s apartment? Same rule as the sprites.
export async function canEnterApartment(pool: pg.Pool, hostId: string, viewerId: string): Promise<boolean> {
  const { rowCount } = await pool.query(
    `SELECT 1 FROM users host WHERE host.id = $1 AND ${APARTMENT_ACCESS_SQL}`,
    [hostId, viewerId],
  );
  return (rowCount ?? 0) > 0;
}
