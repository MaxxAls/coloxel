import type { FastifyInstance } from 'fastify';
import type pg from 'pg';
import { z } from 'zod';

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
}

export function registerInventoryRoutes(app: FastifyInstance, pool: pg.Pool) {
  app.get('/api/inventory', async (req, reply) => {
    if (!req.user) return reply.code(401).send({ error: 'Non connecté' });
    const { rows } = await pool.query<InventoryRow>(
      `SELECT it.id, it.serial, it.name, it.description, it.edition_number, it.edition_size,
              cr.nickname AS creator, it.created_at, p.i, p.j
       FROM items it
       JOIN users cr ON cr.id = it.creator_id
       LEFT JOIN placements p ON p.item_id = it.id
       WHERE it.owner_id = $1
       ORDER BY it.serial`,
      [req.user.id],
    );
    return {
      items: rows.map((r) => ({
        id: r.id,
        serial: r.serial,
        name: r.name,
        description: r.description,
        editionNumber: r.edition_number,
        editionSize: r.edition_size,
        creator: r.creator,
        createdAt: r.created_at,
        placement: r.i === null || r.j === null ? null : { i: r.i, j: r.j },
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
    const { itemId, i, j } = parsed.data;

    const owned = await pool.query('SELECT 1 FROM items WHERE id = $1 AND owner_id = $2', [itemId, user.id]);
    if (owned.rowCount === 0) return reply.code(404).send({ error: 'Objet introuvable' });

    try {
      // The UNIQUE (user_id, i, j) constraint arbitrates concurrent requests.
      await pool.query(
        `INSERT INTO placements (item_id, user_id, i, j) VALUES ($1, $2, $3, $4)
         ON CONFLICT (item_id) DO UPDATE SET i = EXCLUDED.i, j = EXCLUDED.j, placed_at = now()`,
        [itemId, user.id, i, j],
      );
    } catch (err) {
      if ((err as { code?: string }).code === '23505') {
        return reply.code(409).send({ error: 'Cette case est déjà occupée' });
      }
      throw err;
    }
    return { placement: { itemId, i, j } };
  });

  app.delete<{ Params: { itemId: string } }>('/api/placements/:itemId', async (req, reply) => {
    const user = req.user;
    if (!user) return reply.code(401).send({ error: 'Non connecté' });
    const { itemId } = req.params;
    if (!UUID.test(itemId)) return reply.code(404).send({ error: 'Objet introuvable' });

    const { rowCount } = await pool.query('DELETE FROM placements WHERE item_id = $1 AND user_id = $2', [
      itemId,
      user.id,
    ]);
    if (rowCount === 0) return reply.code(404).send({ error: 'Cet objet n’est pas posé' });
    return reply.code(204).send();
  });
}
