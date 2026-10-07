import type pg from 'pg';
import { itemMaskedSql } from '../moderation/masking';

// Single place deciding who may see into an apartment. The owner always can;
// others depend on the owner's apartment_access: everybody in the building, the
// owner's friends only, or friends plus whoever the owner let in at the door.
// `host` is the apartment owner's users row; `viewer` is the SQL parameter holding the viewer's id.
export const apartmentAccessSql = (viewer: string) => {
  const friend =
    `EXISTS (SELECT 1 FROM friendships fr WHERE fr.status = 'accepted' AND ` +
    `((fr.requester_id = host.id AND fr.addressee_id = ${viewer}) OR (fr.requester_id = ${viewer} AND fr.addressee_id = host.id)))`;
  const letIn = `EXISTS (SELECT 1 FROM bell_grants bg WHERE bg.owner_id = host.id AND bg.visitor_id = ${viewer} AND bg.expires_at > now())`;
  const expelled = `EXISTS (SELECT 1 FROM apartment_bans ab WHERE ab.owner_id = host.id AND ab.user_id = ${viewer} AND ab.expires_at > now())`;
  return (
    `(host.id = ${viewer} OR (NOT ${expelled} AND (host.apartment_access = 'building'` +
    ` OR (host.apartment_access = 'friends' AND ${friend})` +
    ` OR (host.apartment_access = 'bell' AND (${friend} OR ${letIn})))))`
  );
};
export const APARTMENT_ACCESS_SQL = apartmentAccessSql('$2');

// Can `viewerId` see the sprite of `itemId`? Either they own it, or it is
// placed in an apartment they may enter and has not been masked by reports or the staff.
// The staff sees every creation: that is what they review.
// Returns the recipe when allowed.
export async function findViewableItemRecipe<R>(pool: pg.Pool, itemId: string, viewerId: string): Promise<R | null> {
  const { rows } = await pool.query<{ recipe: R }>(
    `SELECT i.recipe
       FROM items i
       LEFT JOIN placements p ON p.item_id = i.id
       LEFT JOIN users host ON host.id = p.user_id
      WHERE i.id = $1
        AND (i.owner_id = $2 OR EXISTS (SELECT 1 FROM users v WHERE v.id = $2 AND v.role <> 'user') OR (p.item_id IS NOT NULL AND ${APARTMENT_ACCESS_SQL} AND NOT ${itemMaskedSql('i')})
             OR (EXISTS (SELECT 1 FROM listings l WHERE l.item_id = i.id AND l.status = 'active' AND l.expires_at > now()) AND NOT ${itemMaskedSql('i')}))`,
    [itemId, viewerId],
  );
  return rows[0]?.recipe ?? null;
}

/** Was this player shown out of the apartment by its owner, not long ago? */
export async function isExpelled(pool: pg.Pool, hostId: string, viewerId: string): Promise<boolean> {
  const { rowCount } = await pool.query('SELECT 1 FROM apartment_bans WHERE owner_id = $1 AND user_id = $2 AND expires_at > now()', [hostId, viewerId]);
  return (rowCount ?? 0) > 0;
}

// Can `viewerId` walk into `hostId`'s apartment? Same rule as the sprites.
export async function canEnterApartment(pool: pg.Pool, hostId: string, viewerId: string): Promise<boolean> {
  const { rowCount } = await pool.query(
    `SELECT 1 FROM users host WHERE host.id = $1 AND ${APARTMENT_ACCESS_SQL}`,
    [hostId, viewerId],
  );
  return (rowCount ?? 0) > 0;
}
