import type { FastifyInstance } from 'fastify';
import type pg from 'pg';
import { z } from 'zod';
import { catalogueEntry } from '@coloxel/render';
import { hasFloor } from '@coloxel/world';
import { loadLayout } from '../apartments/layout';
import type { NotifyApartment } from '../building/routes';
import type { QuestRecorder } from '../quests/engine';
import { itemMaskedSql } from '../moderation/masking';

export const GRID_SIZE = 8;

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
  masked: boolean;
  listing_id: string | null;
  listing_price: number | null;
}

export function registerInventoryRoutes(app: FastifyInstance, pool: pg.Pool, notify?: NotifyApartment, quest?: QuestRecorder) {
  app.get('/api/inventory', async (req, reply) => {
    if (!req.user) return reply.code(401).send({ error: 'Non connecté' });
    const { rows } = await pool.query<InventoryRow>(
      `SELECT it.id, it.serial, it.name, it.description, it.edition_number, it.edition_size,
              cr.nickname AS creator, it.created_at, p.i, p.j, p.rot, ${itemMaskedSql('it')} AS masked,
              ls.id AS listing_id, ls.price AS listing_price
       FROM items it
       JOIN users cr ON cr.id = it.creator_id
       LEFT JOIN placements p ON p.item_id = it.id
       LEFT JOIN listings ls ON ls.item_id = it.id AND ls.status = 'active' AND ls.expires_at > now()
       WHERE it.owner_id = $1
       ORDER BY it.serial`,
      [req.user.id],
    );
    const owned = await pool.query<{ id: string; catalogue_key: string; i: number | null; j: number | null; rot: number | null; lit: boolean | null }>(
      `SELECT f.id, f.catalogue_key, p.i, p.j, p.rot, p.lit
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
        placement: r.i === null || r.j === null ? null : { i: r.i, j: r.j, rot: r.rot ?? 0 },
        on: r.lit ?? true,
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
        placement: r.i === null || r.j === null ? null : { i: r.i, j: r.j, rot: r.rot ?? 0 },
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
    const { itemId, i, j, rot } = parsed.data;

    // A creation or a piece of base furniture: the same rule for both, and the
    // object must belong to the player.
    const creation = await pool.query('SELECT 1 FROM items WHERE id = $1 AND owner_id = $2', [itemId, user.id]);
    const furniture =
      creation.rowCount === 0
        ? await pool.query('SELECT 1 FROM furniture WHERE id = $1 AND owner_id = $2', [itemId, user.id])
        : null;
    if (creation.rowCount === 0 && furniture?.rowCount === 0) return reply.code(404).send({ error: 'Objet introuvable' });
    const column = creation.rowCount ? 'item_id' : 'furniture_id';

    // Only where there is a floor.
    const shape = await loadLayout(pool, user.id);
    if (!hasFloor(shape, i, j)) return reply.code(400).send({ error: 'Il n’y a pas de sol ici' });

    let saved: { rows: { rot: number }[] };
    try {
      // The UNIQUE (user_id, i, j) constraint arbitrates concurrent requests.
      saved = await pool.query<{ rot: number }>(
        `INSERT INTO placements (${column}, user_id, i, j, rot) VALUES ($1, $2, $3, $4, COALESCE($5::smallint, 0))
         ON CONFLICT (${column}) DO UPDATE SET i = EXCLUDED.i, j = EXCLUDED.j, rot = COALESCE($5::smallint, placements.rot), placed_at = now()
         RETURNING rot`,
        [itemId, user.id, i, j, rot ?? null],
      );
    } catch (err) {
      if ((err as { code?: string }).code === '23505') {
        return reply.code(409).send({ error: 'Cette case est déjà occupée' });
      }
      if ((err as { code?: string }).code === 'P0409') {
        return reply.code(409).send({ error: 'Cet objet est en vente sur le marché' });
      }
      throw err;
    }
    notify?.(user.id, 'decor');
    // Each object counts once, however often it is moved.
    quest?.(user.id, 'place', itemId);
    return { placement: { itemId, i, j, rot: saved.rows[0]?.rot ?? 0 } };
  });

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
    notify?.(user.id, 'decor');
    return reply.code(204).send();
  });
}
