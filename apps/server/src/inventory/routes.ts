import type { FastifyInstance, FastifyReply } from 'fastify';
import type pg from 'pg';
import { z } from 'zod';
import { catalogueEntry, normalizeSize, rotatedSize, stackable, type Size } from '@coloxel/render';
import { N, hasFloor, wallBehind } from '@coloxel/world';
import { hasRights } from '../apartments/access';
import { dropOrphanStacks, loadLayout } from '../apartments/layout';
import type { NotifyApartment } from '../building/routes';
import type { QuestRecorder } from '../quests/engine';
import { itemMaskedSql } from '../moderation/masking';

/** Cells along each side of the room grid (shared with the client and the rooms). */
export const GRID_SIZE = N;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const coordinate = z
  .number('Case invalide')
  .int('Case invalide')
  .min(0, 'Case hors de la grille')
  .max(GRID_SIZE - 1, 'Case hors de la grille');

const placementSchema = z.object({
  itemId: z.string('Objet invalide').regex(UUID, 'Objet invalide'),
  i: coordinate,
  j: coordinate,
  // Quarter turns; left out, a move keeps the way the piece already faces.
  rot: z.number('Orientation invalide').int('Orientation invalide').min(0, 'Orientation invalide').max(3, 'Orientation invalide').optional(),
});

interface InventoryRow {
  id: string;
  serial: number;
  name: string;
  description: string;
  edition_number: number;
  edition_size: number;
  creator: string;
  created_at: Date;
  i: number | null;
  j: number | null;
  rot: number | null;
  w: number | null;
  h: number | null;
  z: number | null;
  size: unknown;
  masked: boolean;
  listing_id: string | null;
  listing_price: number | null;
}

export function registerInventoryRoutes(app: FastifyInstance, pool: pg.Pool, notify?: NotifyApartment, quest?: QuestRecorder) {
  app.get('/api/inventory', async (req, reply) => {
    if (!req.user) return reply.code(401).send({ error: 'Non connecté' });
    const { rows } = await pool.query<InventoryRow>(
      `SELECT it.id, it.serial, it.name, it.description, it.edition_number, it.edition_size,
              cr.nickname AS creator, it.created_at, p.i, p.j, p.rot, p.w, p.h, p.z, it.recipe->'size' AS size, ${itemMaskedSql('it')} AS masked,
              ls.id AS listing_id, ls.price AS listing_price
       FROM items it
       JOIN users cr ON cr.id = it.creator_id
       LEFT JOIN placements p ON p.item_id = it.id
       LEFT JOIN listings ls ON ls.item_id = it.id AND ls.status = 'active' AND ls.expires_at > now()
       WHERE it.owner_id = $1
       ORDER BY it.serial`,
      [req.user.id],
    );
    const owned = await pool.query<{ id: string; catalogue_key: string; i: number | null; j: number | null; rot: number | null; w: number | null; h: number | null; z: number | null; lit: boolean | null; data: string | null }>(
      `SELECT f.id, f.catalogue_key, p.i, p.j, p.rot, p.w, p.h, p.z, p.lit, p.data
         FROM furniture f LEFT JOIN placements p ON p.furniture_id = f.id
        WHERE f.owner_id = $1
        ORDER BY f.created_at, f.id`,
      [req.user.id],
    );
    return {
      // Base furniture is listed apart: it is not a creation (no number, creator or edition).
      furniture: owned.rows.map((r) => ({
        id: r.id,
        key: r.catalogue_key,
        name: catalogueEntry(r.catalogue_key)?.name ?? r.catalogue_key,
        size: normalizeSize(catalogueEntry(r.catalogue_key)?.recipe.size),
        placement: r.i === null || r.j === null ? null : { i: r.i, j: r.j, rot: r.rot ?? 0, w: r.w ?? 1, h: r.h ?? 1, z: r.z ?? 0 },
        on: r.lit ?? true,
        data: r.data,
      })),
      items: rows.map((r) => ({
        id: r.id,
        serial: r.serial,
        name: r.name,
        description: r.description,
        editionNumber: r.edition_number,
        editionSize: r.edition_size,
        creator: r.creator,
        createdAt: r.created_at,
        // Reported by several players, or hidden by the staff: only the owner still sees it, others do not.
        underReview: r.masked,
        size: normalizeSize(r.size),
        placement: r.i === null || r.j === null ? null : { i: r.i, j: r.j, rot: r.rot ?? 0, w: r.w ?? 1, h: r.h ?? 1, z: r.z ?? 0 },
        // On the market: in escrow, it cannot be placed until the offer ends.
        listing: r.listing_id && r.listing_price !== null ? { id: r.listing_id, price: r.listing_price } : null,
      })),
    };
  });

  // Place an item, or move it if it is already placed.
  app.put('/api/placements', async (req, reply) => {
    const user = req.user;
    if (!user) return reply.code(401).send({ error: 'Non connecté' });
    const parsed = placementSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? 'Placement invalide' });
    }
    return placeFor(user.id, parsed.data, reply, true);
  });

  // A friend with the rights moves or turns a piece the owner already placed: the same rules, in the owner's name.
  app.put<{ Params: { ownerId: string } }>('/api/apartments/:ownerId/placements', async (req, reply) => {
    const me = req.user;
    if (!me) return reply.code(401).send({ error: 'Non connecté' });
    const ownerId = req.params.ownerId.toLowerCase();
    if (!UUID.test(ownerId) || !(await hasRights(pool, ownerId, me.id))) return reply.code(403).send({ error: 'Tu n’as pas les droits dans cet appart.' });
    const parsed = placementSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? 'Placement invalide' });
    }
    const placed = await pool.query('SELECT 1 FROM placements WHERE (item_id = $1 OR furniture_id = $1) AND user_id = $2', [parsed.data.itemId, ownerId]);
    if (!placed.rowCount) return reply.code(404).send({ error: 'Tu peux déplacer les objets déjà posés, pas en poser de nouveaux.' });
    return placeFor(ownerId, parsed.data, reply, false);
  });

  /** Places (or moves, or turns) a piece of `ownerId`'s in their apartment. `byOwner`: the owner did it themselves. */
  async function placeFor(ownerId: string, data: z.infer<typeof placementSchema>, reply: FastifyReply, byOwner: boolean) {
    const user = { id: ownerId };
    const { itemId, i, j, rot } = data;

    // A creation or a piece of base furniture: the same rule for both, and the
    // object must belong to the player.
    const creation = await pool.query<{ size: unknown }>("SELECT recipe->'size' AS size FROM items WHERE id = $1 AND owner_id = $2", [itemId, user.id]);
    const furniture =
      creation.rowCount === 0
        ? await pool.query<{ catalogue_key: string }>('SELECT catalogue_key FROM furniture WHERE id = $1 AND owner_id = $2', [itemId, user.id])
        : null;
    if (creation.rowCount === 0 && furniture?.rowCount === 0) return reply.code(404).send({ error: 'Objet introuvable' });
    const column = creation.rowCount ? 'item_id' : 'furniture_id';
    const baseSize: Size = creation.rowCount
      ? normalizeSize(creation.rows[0]!.size)
      : normalizeSize(catalogueEntry(furniture!.rows[0]!.catalogue_key)?.recipe.size);

    // Turned or not, the piece covers w x h tiles from (i, j): the new turn if given, else the one it already has.
    const current = await pool.query<{ rot: number }>(`SELECT rot FROM placements WHERE ${column} = $1`, [itemId]);
    let turns = rot ?? current.rows[0]?.rot ?? 0;
    const entry = furniture?.rows[0] ? catalogueEntry(furniture.rows[0].catalogue_key) : undefined;
    const onWall = !!entry?.wall;
    // A wall piece has two ways to hang, the left wall (0) and the right wall (1); a floor piece has four.
    if (onWall && turns > 1) turns = 0;
    const [w, h] = onWall ? [1, 1] : rotatedSize(baseSize, turns);
    const layer = onWall ? 1 + turns : 0;

    // Every tile it covers needs a floor, inside the grid.
    const shape = await loadLayout(pool, user.id);
    for (let a = 0; a < w; a++) {
      for (let b = 0; b < h; b++) {
        if (i + a > GRID_SIZE - 1 || j + b > GRID_SIZE - 1 || !hasFloor(shape, i + a, j + b)) {
          return reply.code(400).send({ error: w * h > 1 ? 'Cet objet ne tient pas ici : il lui faut ' + w * h + ' cases de sol libres' : 'Il n’y a pas de sol ici' });
        }
      }
    }

    // It hangs behind the first floor tile of its row (left wall) or column (right wall), where the wall is.
    if (onWall && !wallBehind(shape, turns === 0 ? 'left' : 'right', i, j)) {
      return reply.code(400).send({ error: 'Ça se pose contre un mur : choisis une case le long du mur du fond.' });
    }

    let saved: { rows: { rot: number }[] };
    let z = 0;
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      // One placement at a time per apartment: the overlap check and the insert must not interleave.
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [`placements:${user.id}`]);
      const under = await client.query<{ key: string | null; i: number; j: number; w: number; h: number; z: number }>(
        `SELECT f.catalogue_key AS key, p.i, p.j, p.w, p.h, p.z FROM placements p LEFT JOIN furniture f ON f.id = p.furniture_id
          WHERE p.user_id = $1 AND p.${column} IS DISTINCT FROM $2::uuid AND p.layer = $7::int
            AND p.i < $3::int + $5::int AND p.i + p.w > $3::int AND p.j < $4::int + $6::int AND p.j + p.h > $4::int`,
        [user.id, itemId, i, j, w, h, layer],
      );
      if (under.rowCount) {
        // Taken: it may still go on top, if what is there is one surface, bare, under its whole footprint.
        const base = under.rows.find((r) => r.z === 0);
        const others = under.rows.filter((r) => r !== base);
        const surface = base?.key ? catalogueEntry(base.key)?.surface : undefined;
        const inside = !!base && i >= base.i && j >= base.j && i + w <= base.i + base.w && j + h <= base.j + base.h;
        const fits = layer === 0 && !!base && others.length === 0 && surface !== undefined && inside && stackable(entry);
        if (!fits) {
          await client.query('ROLLBACK');
          const error =
            layer === 0 && surface !== undefined && inside && !stackable(entry)
              ? 'Ça ne se pose pas sur ce meuble'
              : layer === 0 && surface !== undefined && others.length
                ? 'Il y a déjà quelque chose dessus'
                : w * h > 1 ? 'Une case est déjà occupée' : 'Cette case est déjà occupée';
          return reply.code(409).send({ error });
        }
        z = surface!;
      }
      // The UNIQUE (user_id, i, j, layer, z) constraint still guards the first tile.
      saved = await client.query<{ rot: number }>(
        `INSERT INTO placements (${column}, user_id, i, j, rot, w, h, layer, z) VALUES ($1, $2, $3, $4, COALESCE($5::smallint, 0), $6, $7, $8, $9)
         ON CONFLICT (${column}) DO UPDATE SET i = EXCLUDED.i, j = EXCLUDED.j, rot = COALESCE($5::smallint, placements.rot), w = EXCLUDED.w, h = EXCLUDED.h, layer = EXCLUDED.layer, z = EXCLUDED.z, placed_at = now()
         RETURNING rot`,
        [itemId, user.id, i, j, onWall ? turns : (rot ?? null), w, h, layer, z],
      );
      // A surface that moved leaves what stood on it behind: back to the inventory.
      await dropOrphanStacks(client, user.id);
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      if ((err as { code?: string }).code === '23505') {
        return reply.code(409).send({ error: 'Cette case est déjà occupée' });
      }
      if ((err as { code?: string }).code === 'P0409') {
        return reply.code(409).send({ error: 'Cet objet est en vente sur le marché' });
      }
      throw err;
    } finally {
      client.release();
    }
    notify?.(user.id, 'decor');
    // Each object counts once, however often it is moved.
    if (byOwner) quest?.(user.id, 'place', itemId);
    return { placement: { itemId, i, j, rot: saved.rows[0]?.rot ?? 0, w, h, z } };
  }

  app.delete<{ Params: { itemId: string } }>('/api/placements/:itemId', async (req, reply) => {
    const user = req.user;
    if (!user) return reply.code(401).send({ error: 'Non connecté' });
    const { itemId } = req.params;
    if (!UUID.test(itemId)) return reply.code(404).send({ error: 'Objet introuvable' });

    const { rowCount } = await pool.query(
      'DELETE FROM placements WHERE (item_id = $1 OR furniture_id = $1) AND user_id = $2',
      [itemId, user.id],
    );
    if (rowCount === 0) return reply.code(404).send({ error: 'Cet objet n’est pas posé' });
    // What stood on it goes back to the inventory too.
    await dropOrphanStacks(pool, user.id);
    notify?.(user.id, 'decor');
    return reply.code(204).send();
  });
}
