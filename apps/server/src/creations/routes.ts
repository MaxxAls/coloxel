import type { FastifyInstance } from 'fastify';
import type pg from 'pg';
import { z } from 'zod';
import { buildPrompt, extractJson, validateRecipe } from '@coloxel/generator';
import { renderSprite, type Recipe } from '@coloxel/render';
import { containsBannedWord } from '../auth/rules';
import { nextItemSerial, withTransaction } from '../db/pool';
import { spriteToPng } from '../sprite-png';
import { getCharges, refundCharge, reserveCharge } from './charges';
import type { RecipeModel } from './model';

const creationSchema = z.object({
  description: z
    .string()
    .transform((s) => s.replace(/\s+/g, ' ').trim())
    .pipe(
      z
        .string()
        .min(3, 'Décris ton objet en 3 caractères au moins')
        .max(200, 'Description trop longue (200 caractères max)'),
    ),
});

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PNG_CACHE_MAX = 500;

export function registerCreationRoutes(app: FastifyInstance, pool: pg.Pool, model: RecipeModel | null) {
  // Items are immutable, so a rendered sprite never goes stale.
  const pngCache = new Map<string, Buffer>();

  app.get('/api/charges', async (req, reply) => {
    if (!req.user) return reply.code(401).send({ error: 'Non connecté' });
    return { charges: await getCharges(pool, req.user.id) };
  });

  app.post('/api/creations', async (req, reply) => {
    const user = req.user;
    if (!user) return reply.code(401).send({ error: 'Non connecté' });

    const parsed = creationSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? 'Description invalide' });
    }
    const { description } = parsed.data;
    if (containsBannedWord(description)) {
      return reply.code(400).send({ error: 'Cette description n’est pas autorisée' });
    }
    if (!model) return reply.code(503).send({ error: 'Le générateur est indisponible pour le moment' });

    const reservation = await reserveCharge(pool, user.id);
    if (!reservation) {
      return reply.code(429).send({ error: 'Plus de charges pour aujourd’hui, reviens demain !', charges: 0 });
    }

    const fail = async (status: number, error: string) => {
      await refundCharge(pool, user.id, reservation);
      return reply
        .code(status)
        .send({ error: `${error} Ta charge t’a été rendue.`, charges: reservation.remaining + 1 });
    };

    let recipe: Recipe;
    try {
      const answer = await model(buildPrompt(description));
      const result = validateRecipe(extractJson(answer));
      if (!result.ok) {
        return fail(
          422,
          result.reason === 'refused'
            ? `Objet refusé : ${result.message}.`
            : 'Le générateur n’a pas réussi à dessiner cet objet.',
        );
      }
      if (containsBannedWord(result.recipe.name)) return fail(422, 'Le générateur a proposé un nom refusé.');
      recipe = result.recipe;
    } catch (err) {
      req.log.error({ err }, 'model call failed');
      return fail(502, 'Le générateur ne répond pas, réessaie dans un instant.');
    }

    try {
      const item = await withTransaction(pool, async (c) => {
        const serial = await nextItemSerial(c);
        const { rows } = await c.query<{ id: string; created_at: Date }>(
          `INSERT INTO items (serial, name, description, recipe, creator_id, owner_id)
           VALUES ($1, $2, $3, $4, $5, $5) RETURNING id, created_at`,
          [serial, recipe.name, description, JSON.stringify(recipe), user.id],
        );
        const row = rows[0]!;
        await c.query('UPDATE creation_charges SET item_id = $1 WHERE id = $2', [row.id, reservation.chargeId]);
        return { id: row.id, serial, createdAt: row.created_at };
      });
      return reply.code(201).send({
        item: {
          id: item.id,
          serial: item.serial,
          name: recipe.name,
          description,
          editionNumber: 1,
          editionSize: 1,
          creator: user.nickname,
          createdAt: item.createdAt,
        },
        charges: reservation.remaining,
      });
    } catch (err) {
      req.log.error({ err }, 'item insert failed');
      return fail(500, 'La création a échoué.');
    }
  });

  // Sprite rendered on demand by the shared engine from the stored recipe.
  app.get<{ Params: { id: string } }>('/api/items/:id.png', async (req, reply) => {
    if (!req.user) return reply.code(401).send({ error: 'Non connecté' });
    const { id } = req.params;
    if (!UUID.test(id)) return reply.code(404).send({ error: 'Objet introuvable' });

    // The cache is keyed by item, so check ownership before serving a cached sprite.
    const { rows } = await pool.query<{ recipe: Recipe }>(
      'SELECT recipe FROM items WHERE id = $1 AND owner_id = $2',
      [id, req.user.id],
    );
    if (!rows[0]) return reply.code(404).send({ error: 'Objet introuvable' });

    let png = pngCache.get(id);
    if (!png) {
      png = spriteToPng(renderSprite(rows[0].recipe.parts));
      if (pngCache.size >= PNG_CACHE_MAX) pngCache.delete(pngCache.keys().next().value!);
      pngCache.set(id, png);
    }
    return reply.header('cache-control', 'private, max-age=31536000, immutable').type('image/png').send(png);
  });
}
