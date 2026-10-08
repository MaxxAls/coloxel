import type { FastifyInstance } from 'fastify';
import type pg from 'pg';
import { z } from 'zod';
import { LOOK_ITEMS, MAX_PETS, SLOTS, catalogueEntry, petSpecies } from '@coloxel/render';
import { withTransaction } from '../db/pool';
import { MAX_FURNITURE_PER_PLAYER } from '../furniture/routes';
import { checkPetName } from '../pets/routes';
import type { QuestRecorder } from '../quests/engine';
import { NO_GUARDS, type RateGuards } from '../rate-limit';
import { spendPixels } from '../wallet/routes';

/** A purchase that cannot go through: rolls the transaction back and tells the player why. */
class Refused extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

const buySchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('furniture'), key: z.string() }).strict(),
  z.object({ kind: z.literal('clothing'), slot: z.enum(SLOTS), piece: z.number().int().min(0).max(63) }).strict(),
  z
    .object({ kind: z.literal('pet'), species: z.string(), color: z.number().int().min(0).max(15), name: z.string().trim().min(1).max(20) })
    .strict(),
]);

const broke = () => new Refused(402, 'Tu n’as pas assez de Pixels pour ça.');

/**
 * The shop: everything that costs Pixels goes through here. The price is read
 * from the code-side catalogues, never from the request, and the payment and
 * the goods happen in one transaction.
 */
export function registerShopRoutes(app: FastifyInstance, pool: pg.Pool, guards: RateGuards = NO_GUARDS, quest?: QuestRecorder) {
  app.post('/api/shop/buy', { preHandler: guards.shop }, async (req, reply) => {
    const user = req.user;
    if (!user) return reply.code(401).send({ error: 'Non connecté' });
    const parsed = buySchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Achat invalide' });
    const order = parsed.data;

    try {
      const result = await withTransaction(pool, async (client) => {
        if (order.kind === 'furniture') {
          const entry = catalogueEntry(order.key);
          if (!entry || entry.hidden) throw new Refused(404, 'Meuble introuvable');
          const { rows } = await client.query<{ id: string }>(
            `INSERT INTO furniture (owner_id, catalogue_key)
             SELECT $1, $2 WHERE (SELECT count(*) FROM furniture WHERE owner_id = $1) < $3
             RETURNING id`,
            [user.id, entry.key, MAX_FURNITURE_PER_PLAYER],
          );
          if (!rows[0]) throw new Refused(409, `Tu as déjà ${MAX_FURNITURE_PER_PLAYER} meubles : range-en avant d’en prendre d’autres.`);
          let pixels: number | null = null;
          if (entry.price > 0) {
            pixels = await spendPixels(client, user.id, entry.price, `Meuble : ${entry.name}`);
            if (pixels === null) throw broke();
          }
          return { pixels, furniture: { id: rows[0].id, key: entry.key, name: entry.name, placement: null } };
        }

        if (order.kind === 'clothing') {
          const piece = LOOK_ITEMS[order.slot][order.piece];
          if (!piece) throw new Refused(404, 'Vêtement introuvable');
          if (piece.price === 0) throw new Refused(400, 'Ce vêtement est déjà à toi.');
          const inserted = await client.query(
            'INSERT INTO wardrobe (user_id, slot, piece) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING',
            [user.id, order.slot, order.piece],
          );
          if (!inserted.rowCount) throw new Refused(409, 'Tu as déjà ce vêtement.');
          const pixels = await spendPixels(client, user.id, piece.price, `Vêtement : ${piece.name}`);
          if (pixels === null) throw broke();
          return { pixels, clothing: { slot: order.slot, piece: order.piece } };
        }

        const species = petSpecies(order.species);
        if (!species || order.color >= species.colors.length) throw new Refused(404, 'Compagnon introuvable');
        const refusedName = checkPetName(order.name);
        if (refusedName) throw new Refused(400, refusedName);
        // Serialise adoptions of one player, so two parallel orders cannot go past the limit.
        await client.query('SELECT id FROM users WHERE id = $1 FOR UPDATE', [user.id]);
        const count = await client.query<{ n: string }>('SELECT count(*) AS n FROM pets WHERE owner_id = $1', [user.id]);
        if (Number(count.rows[0]!.n) >= MAX_PETS) throw new Refused(409, `Tu as déjà ${MAX_PETS} compagnons.`);
        const pixels = await spendPixels(client, user.id, species.price, `Compagnon : ${species.name}`);
        if (pixels === null) throw broke();
        const { rows } = await client.query<{ id: string }>(
          'INSERT INTO pets (owner_id, species, color, name) VALUES ($1, $2, $3, $4) RETURNING id',
          [user.id, species.key, order.color, order.name],
        );
        // The first companion comes along right away.
        await client.query('UPDATE users SET active_pet_id = COALESCE(active_pet_id, $2) WHERE id = $1', [user.id, rows[0]!.id]);
        return { pixels, pet: { id: rows[0]!.id, species: species.key, color: order.color, name: order.name } };
      });
      quest?.(user.id, 'buy');
      return reply.code(201).send(result);
    } catch (err) {
      if (err instanceof Refused) return reply.code(err.status).send({ error: err.message });
      throw err;
    }
  });
}
