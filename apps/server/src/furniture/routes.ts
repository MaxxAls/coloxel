import type { FastifyInstance } from 'fastify';
import type pg from 'pg';
import { z } from 'zod';
import { CATALOGUE, FLOORS, STARTER_KIT, WALLS, catalogueEntry, renderSprite } from '@coloxel/render';
import type { NotifyApartment } from '../building/routes';
import { NO_GUARDS, type RateGuards } from '../rate-limit';
import { spriteToPng } from '../sprite-png';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A generous ceiling per player: "unlimited" in practice, but not a way to fill the database. */
export const MAX_FURNITURE_PER_PLAYER = 500;

/** Furnish a new apartment: the starter kit, already placed. Run inside the sign-up transaction. */
export async function giveStarterKit(client: pg.PoolClient, userId: string): Promise<void> {
  for (const piece of STARTER_KIT) {
    const { rows } = await client.query<{ id: string }>(
      'INSERT INTO furniture (owner_id, catalogue_key) VALUES ($1, $2) RETURNING id',
      [userId, piece.key],
    );
    await client.query('INSERT INTO placements (furniture_id, user_id, i, j) VALUES ($1, $2, $3, $4)', [
      rows[0]!.id,
      userId,
      piece.i,
      piece.j,
    ]);
  }
}

const takeSchema = z.object({ key: z.string('Meuble invalide') }).strict();

export function registerFurnitureRoutes(
  app: FastifyInstance,
  pool: pg.Pool,
  guards: RateGuards = NO_GUARDS,
  notify?: NotifyApartment,
) {
  // Sprites of base furniture never change for a given key: render once, keep.
  const pngCache = new Map<string, Buffer>();

  app.get('/api/catalogue', async (req, reply) => {
    if (!req.user) return reply.code(401).send({ error: 'Non connecté' });
    return {
      furniture: CATALOGUE.map((e) => ({ key: e.key, name: e.name, category: e.category, price: e.price })),
      floors: FLOORS.map((f) => ({ id: f.id, name: f.name, a: f.a, b: f.b })),
      walls: WALLS.map((w) => ({ id: w.id, name: w.name, left: w.left, right: w.right })),
    };
  });

  // Same engine as every other sprite, drawn on demand from the catalogue.
  app.get<{ Params: { key: string } }>('/api/catalogue/:key.png', async (req, reply) => {
    if (!req.user) return reply.code(401).send({ error: 'Non connecté' });
    const entry = catalogueEntry(req.params.key);
    if (!entry) return reply.code(404).send({ error: 'Meuble introuvable' });
    let png = pngCache.get(entry.key);
    if (!png) {
      png = spriteToPng(renderSprite(entry.recipe.parts));
      pngCache.set(entry.key, png);
    }
    return reply.header('cache-control', 'private, max-age=86400').type('image/png').send(png);
  });

  // Take a piece: free, and as many copies as wanted. Nothing here touches
  // `items` or the numbering sequence.
  app.post('/api/furniture', { preHandler: guards.furniture }, async (req, reply) => {
    const user = req.user;
    if (!user) return reply.code(401).send({ error: 'Non connecté' });
    const parsed = takeSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? 'Meuble invalide' });
    const entry = catalogueEntry(parsed.data.key);
    if (!entry) return reply.code(404).send({ error: 'Meuble introuvable' });

    const { rows } = await pool.query<{ id: string }>(
      `INSERT INTO furniture (owner_id, catalogue_key)
       SELECT $1, $2 WHERE (SELECT count(*) FROM furniture WHERE owner_id = $1) < $3
       RETURNING id`,
      [user.id, entry.key, MAX_FURNITURE_PER_PLAYER],
    );
    if (!rows[0]) {
      return reply.code(409).send({ error: `Tu as déjà ${MAX_FURNITURE_PER_PLAYER} meubles : range-en avant d’en prendre d’autres.` });
    }
    return reply.code(201).send({ furniture: { id: rows[0].id, key: entry.key, name: entry.name, placement: null } });
  });

  // Throw a copy away. It costs nothing to take another one.
  app.delete<{ Params: { id: string } }>('/api/furniture/:id', async (req, reply) => {
    if (!req.user) return reply.code(401).send({ error: 'Non connecté' });
    if (!UUID.test(req.params.id)) return reply.code(404).send({ error: 'Meuble introuvable' });
    const { rowCount } = await pool.query('DELETE FROM furniture WHERE id = $1 AND owner_id = $2', [
      req.params.id,
      req.user.id,
    ]);
    if (rowCount === 0) return reply.code(404).send({ error: 'Meuble introuvable' });
    notify?.(req.user.id, 'decor');
    return reply.code(204).send();
  });
}
