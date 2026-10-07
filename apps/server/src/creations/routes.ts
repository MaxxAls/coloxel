import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type pg from 'pg';
import { z } from 'zod';
import { buildPrompt, extractJson, validateRecipe } from '@coloxel/generator';
import { renderSprite, rotateParts, type Recipe } from '@coloxel/render';
import { findViewableItemRecipe } from '../apartments/access';
import { containsBannedWord } from '../auth/rules';
import { NO_GUARDS, type RateGuards } from '../rate-limit';
import { nextItemSerial, withTransaction } from '../db/pool';
import { spriteToPng } from '../sprite-png';
import { EDITION_COST, EDITION_SIZES, getCharges, refundCharge, reserveCharge } from './charges';
import type { QuestRecorder } from '../quests/engine';
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
  // How many copies: 1 (default), or a limited series of 5 or 10. Costs more charges.
  edition: z
    .number('Édition invalide')
    .int('Édition invalide')
    .refine((n) => EDITION_SIZES.includes(n), 'Édition invalide : 1, 5 ou 10 exemplaires')
    .default(1),
});

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PNG_CACHE_MAX = 500;

export function registerCreationRoutes(
  app: FastifyInstance,
  pool: pg.Pool,
  model: RecipeModel | null,
  guards: RateGuards = NO_GUARDS,
  quest?: QuestRecorder,
) {
  // Items are immutable, so a rendered sprite never goes stale.
  const pngCache = new Map<string, Buffer>();

  app.get('/api/charges', async (req, reply) => {
    if (!req.user) return reply.code(401).send({ error: 'Non connecté' });
    return { charges: await getCharges(pool, req.user.id) };
  });

  app.post('/api/creations', { preHandler: guards.creations }, async (req, reply) => {
    const user = req.user;
    if (!user) return reply.code(401).send({ error: 'Non connecté' });

    const parsed = creationSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? 'Description invalide' });
    }
    const { description, edition } = parsed.data;
    if (containsBannedWord(description)) {
      return reply.code(400).send({ error: 'Cette description n’est pas autorisée' });
    }
    if (!model) return reply.code(503).send({ error: 'Le générateur est indisponible pour le moment' });

    const reservation = await reserveCharge(pool, user.id, EDITION_COST[edition]);
    if (!reservation) {
      return reply.code(429).send({
        error: edition > 1 ? `Il te faut ${EDITION_COST[edition]} charges pour une série de ${edition}, reviens demain !` : 'Plus de charges pour aujourd’hui, reviens demain !',
        charges: await getCharges(pool, user.id),
      });
    }

    const fail = async (status: number, error: string) => {
      await refundCharge(pool, user.id, reservation);
      return reply
        .code(status)
        .send({ error: `${error} Ta charge t’a été rendue.`, charges: reservation.remaining + reservation.cost });
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
      // A series is born whole: every copy in one transaction, with consecutive numbers.
      const copies = await withTransaction(pool, async (c) => {
        const seriesId = edition > 1 ? randomUUID() : null;
        const made: { id: string; serial: number; createdAt: Date; editionNumber: number }[] = [];
        for (let n = 1; n <= edition; n++) {
          const serial = await nextItemSerial(c);
          const { rows } = await c.query<{ id: string; created_at: Date }>(
            `INSERT INTO items (serial, name, description, recipe, creator_id, owner_id, edition_number, edition_size, series_id)
             VALUES ($1, $2, $3, $4, $5, $5, $6, $7, $8) RETURNING id, created_at`,
            [serial, recipe.name, description, JSON.stringify(recipe), user.id, n, edition, seriesId],
          );
          made.push({ id: rows[0]!.id, serial, createdAt: rows[0]!.created_at, editionNumber: n });
        }
        await c.query('UPDATE creation_charges SET item_id = $1 WHERE id = $2', [made[0]!.id, reservation.chargeId]);
        return made;
      });
      quest?.(user.id, 'create');
      const view = (c: (typeof copies)[number]) => ({
        id: c.id,
        serial: c.serial,
        name: recipe.name,
        description,
        editionNumber: c.editionNumber,
        editionSize: edition,
        creator: user.nickname,
        createdAt: c.createdAt,
      });
      return reply.code(201).send({ item: view(copies[0]!), items: copies.map(view), charges: reservation.remaining });
    } catch (err) {
      req.log.error({ err }, 'item insert failed');
      return fail(500, 'La création a échoué.');
    }
  });

  // Sprite rendered on demand by the shared engine from the stored recipe.
  app.get<{ Params: { id: string }; Querystring: { r?: string } }>('/api/items/:id.png', async (req, reply) => {
    if (!req.user) return reply.code(401).send({ error: 'Non connecté' });
    const { id } = req.params;
    if (!UUID.test(id)) return reply.code(404).send({ error: 'Objet introuvable' });

    // The cache is keyed by item, so check access (owner, or placed in an
    // apartment the requester may enter) before serving a cached sprite.
    const recipe = await findViewableItemRecipe<Recipe>(pool, id, req.user.id);
    if (!recipe) return reply.code(404).send({ error: 'Objet introuvable' });

    // ?r= is the number of quarter turns the piece was placed with.
    const turns = Number(req.query.r) | 0;
    const cacheKey = `${id}:${((turns % 4) + 4) % 4}`;
    let png = pngCache.get(cacheKey);
    if (!png) {
      png = spriteToPng(renderSprite(rotateParts(recipe.parts, turns)));
      if (pngCache.size >= PNG_CACHE_MAX) pngCache.delete(pngCache.keys().next().value!);
      pngCache.set(cacheKey, png);
    }
    return reply.header('cache-control', 'private, max-age=31536000, immutable').type('image/png').send(png);
  });
}
