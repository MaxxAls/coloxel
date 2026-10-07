import type { FastifyInstance } from 'fastify';
import type pg from 'pg';
import { z } from 'zod';
import { findViewableItemRecipe } from '../apartments/access';
import type { NotifyApartment } from '../building/routes';
import { withTransaction } from '../db/pool';
import { blockedUserSql } from '../moderation/sanctions';
import { itemMaskedSql } from '../moderation/masking';
import { NO_GUARDS, type RateGuards } from '../rate-limit';
import { creditColoxs, debitColoxs } from '../wallet/coloxs';
import { marketConfig, splitSale } from './config';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PAGE = 40;

const listSchema = z
  .object({
    itemId: z.string('Objet invalide').regex(UUID, 'Objet invalide'),
    price: z.number('Prix invalide').int('Le prix doit être un nombre entier de Coloxs'),
  })
  .strict();

/** Offers that ran out of time stop being offers: the item is free again. */
async function expireListings(db: pg.Pool | pg.PoolClient) {
  await db.query("UPDATE listings SET status = 'expired', closed_at = now() WHERE status = 'active' AND expires_at <= now()");
}

const SORTS: Record<string, string> = {
  recent: 'l.created_at DESC',
  price_asc: 'l.price ASC, l.created_at DESC',
  price_desc: 'l.price DESC, l.created_at DESC',
  serial: 'it.serial ASC',
};

interface ListingRow {
  id: string;
  price: number;
  expires_at: Date;
  created_at: Date;
  seller_id: string;
  seller: string;
  item_id: string;
  serial: number;
  name: string;
  description: string;
  edition_number: number;
  edition_size: number;
  creator: string;
  masked: boolean;
  total: string;
}

export function registerMarketRoutes(app: FastifyInstance, pool: pg.Pool, notify?: NotifyApartment, guards: RateGuards = NO_GUARDS) {
  // The market rules the client needs to show prices and fees: the server still computes everything itself.
  app.get('/api/market/rules', async (req, reply) => {
    if (!req.user) return reply.code(401).send({ error: 'Non connecté' });
    return marketConfig();
  });

  // Browse the offers, or list one's own with mine=1.
  app.get<{ Querystring: Record<string, string | undefined> }>('/api/market/listings', async (req, reply) => {
    const user = req.user;
    if (!user) return reply.code(401).send({ error: 'Non connecté' });
    await expireListings(pool);

    const q = req.query;
    const mine = q.mine === '1';
    const params: unknown[] = [];
    const where = ["l.status = 'active'", 'l.expires_at > now()'];
    if (mine) {
      params.push(user.id);
      where.push(`l.seller_id = $${params.length}`);
    } else {
      // Others see neither masked creations nor the offers of a suspended or banned player.
      where.push(`NOT ${itemMaskedSql('it')}`, `NOT ${blockedUserSql('se')}`);
    }
    const text = (q.q ?? '').trim().slice(0, 60);
    if (text) {
      params.push(`%${text.replace(/[\\%_]/g, '\\$&')}%`);
      where.push(`(it.name ILIKE $${params.length} OR cr.nickname ILIKE $${params.length})`);
    }
    const creator = (q.creator ?? '').trim().slice(0, 30);
    if (creator) {
      params.push(creator.toLowerCase());
      where.push(`lower(cr.nickname) = $${params.length}`);
    }
    const bound = (value: string | undefined, op: '>=' | '<=') => {
      const n = Number(value);
      if (value === undefined || value === '' || !Number.isInteger(n) || n < 0 || n > 2_000_000_000) return;
      params.push(n);
      where.push(`l.price ${op} $${params.length}`);
    };
    bound(q.min, '>=');
    bound(q.max, '<=');
    if (q.series === '1') where.push('it.edition_size > 1');
    const offset = Math.max(0, Math.min(100_000, Number.parseInt(q.offset ?? '0', 10) || 0));
    params.push(PAGE, offset);

    const { rows } = await pool.query<ListingRow>(
      `SELECT l.id, l.price, l.expires_at, l.created_at, l.seller_id, se.nickname AS seller,
              it.id AS item_id, it.serial, it.name, it.description, it.edition_number, it.edition_size,
              cr.nickname AS creator, ${itemMaskedSql('it')} AS masked, count(*) OVER () AS total
         FROM listings l
         JOIN items it ON it.id = l.item_id
         JOIN users cr ON cr.id = it.creator_id
         JOIN users se ON se.id = l.seller_id
        WHERE ${where.join(' AND ')}
        ORDER BY ${SORTS[q.sort ?? ''] ?? SORTS.recent}
        LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params,
    );
    return {
      total: rows[0] ? Number(rows[0].total) : 0,
      listings: rows.map((r) => ({
        id: r.id,
        price: r.price,
        expiresAt: r.expires_at,
        seller: r.seller,
        mine: r.seller_id === user.id,
        underReview: r.masked,
        item: {
          id: r.item_id,
          serial: r.serial,
          name: r.name,
          description: r.description,
          editionNumber: r.edition_number,
          editionSize: r.edition_size,
          creator: r.creator,
        },
      })),
    };
  });

  // Put a creation on sale. It leaves the apartment and waits in escrow until sold, withdrawn or expired.
  app.post('/api/market/listings', { preHandler: guards.market }, async (req, reply) => {
    const user = req.user;
    if (!user) return reply.code(401).send({ error: 'Non connecté' });
    const parsed = listSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? 'Offre invalide' });
    const { itemId, price } = parsed.data;
    const config = marketConfig();
    if (price < config.minPrice || price > config.maxPrice) {
      return reply.code(400).send({ error: `Le prix doit être entre ${config.minPrice} et ${config.maxPrice} Coloxs` });
    }

    const result = await withTransaction(pool, async (client) => {
      await expireListings(client);
      // The row lock orders this against placing, trading or buying the same item.
      const found = await client.query<{ owner_id: string; masked: boolean }>(
        `SELECT it.owner_id, ${itemMaskedSql('it')} AS masked FROM items it WHERE it.id = $1 FOR UPDATE`,
        [itemId],
      );
      if (!found.rows[0] || found.rows[0].owner_id !== user.id) return 'missing' as const;
      if (found.rows[0].masked) return 'masked' as const;
      const active = await client.query<{ n: string }>("SELECT count(*) AS n FROM listings WHERE seller_id = $1 AND status = 'active'", [user.id]);
      if (Number(active.rows[0]!.n) >= config.maxActiveListings) return 'full' as const;
      const unplaced = await client.query('DELETE FROM placements WHERE item_id = $1', [itemId]);
      try {
        const { rows } = await client.query<{ id: string; expires_at: Date }>(
          `INSERT INTO listings (item_id, seller_id, price, expires_at) VALUES ($1, $2, $3, now() + make_interval(days => $4))
           RETURNING id, expires_at`,
          [itemId, user.id, price, config.listingDays],
        );
        return { listing: rows[0]!, unplaced: (unplaced.rowCount ?? 0) > 0 };
      } catch (err) {
        if ((err as { code?: string }).code === '23505') return 'listed' as const;
        throw err;
      }
    });
    if (result === 'missing') return reply.code(404).send({ error: 'Objet introuvable' });
    if (result === 'masked') return reply.code(409).send({ error: 'Cet objet est en cours de revue, il ne peut pas être vendu' });
    if (result === 'listed') return reply.code(409).send({ error: 'Cet objet est déjà en vente' });
    if (result === 'full') return reply.code(409).send({ error: `Tu as déjà ${config.maxActiveListings} objets en vente` });
    if (result.unplaced) notify?.(user.id, 'decor');
    return reply.code(201).send({ id: result.listing.id, price, expiresAt: result.listing.expires_at });
  });

  // Withdraw an offer: the item comes back to the inventory.
  app.delete<{ Params: { id: string } }>('/api/market/listings/:id', { preHandler: guards.market }, async (req, reply) => {
    const user = req.user;
    if (!user) return reply.code(401).send({ error: 'Non connecté' });
    if (!UUID.test(req.params.id)) return reply.code(404).send({ error: 'Offre introuvable' });
    const { rowCount } = await pool.query(
      "UPDATE listings SET status = 'cancelled', closed_at = now() WHERE id = $1 AND seller_id = $2 AND status = 'active'",
      [req.params.id, user.id],
    );
    if (!rowCount) return reply.code(404).send({ error: 'Offre introuvable ou déjà terminée' });
    return reply.code(204).send();
  });

  // Buy: the item, the money, the royalty and the history change together, or not at all.
  app.post<{ Params: { id: string } }>('/api/market/listings/:id/buy', { preHandler: guards.market }, async (req, reply) => {
    const user = req.user;
    if (!user) return reply.code(401).send({ error: 'Non connecté' });
    if (!UUID.test(req.params.id)) return reply.code(404).send({ error: 'Offre introuvable' });

    const result = await withTransaction(pool, async (client) => {
      await expireListings(client);
      // Two buyers of the same offer queue up here; the second finds it sold.
      const found = await client.query<{
        id: string;
        item_id: string;
        seller_id: string;
        price: number;
        status: string;
        expires_at: Date;
        creator_id: string;
        owner_id: string;
        serial: number;
        name: string;
        masked: boolean;
        seller_blocked: boolean;
      }>(
        `SELECT l.id, l.item_id, l.seller_id, l.price, l.status, l.expires_at, it.creator_id, it.owner_id, it.serial, it.name,
                ${itemMaskedSql('it')} AS masked, ${blockedUserSql('se')} AS seller_blocked
           FROM listings l
           JOIN items it ON it.id = l.item_id
           JOIN users se ON se.id = l.seller_id
          WHERE l.id = $1
          FOR UPDATE OF l`,
        [req.params.id],
      );
      const l = found.rows[0];
      if (!l || l.status !== 'active') return 'gone' as const;
      if (l.seller_id === user.id) return 'own' as const;
      if (l.masked || l.seller_blocked || l.owner_id !== l.seller_id) return 'unavailable' as const;

      // Every account involved is locked in one fixed order, so crossed purchases cannot deadlock.
      const involved = [...new Set([user.id, l.seller_id, l.creator_id])].sort();
      await client.query('SELECT id FROM users WHERE id = ANY($1::uuid[]) ORDER BY id FOR UPDATE', [involved]);

      const split = splitSale(l.price, l.creator_id === user.id || l.creator_id === l.seller_id);
      const label = `n° ${String(l.serial).padStart(4, '0')} ${l.name}`.slice(0, 80);
      const balance = await debitColoxs(client, user.id, l.price, 'purchase', label);
      if (balance === null) return 'poor' as const;
      await creditColoxs(client, l.seller_id, split.sellerNet, 'sale', label);
      if (split.royalty > 0) await creditColoxs(client, l.creator_id, split.royalty, 'royalty', label);

      await client.query('UPDATE items SET owner_id = $2 WHERE id = $1', [l.item_id, user.id]);
      await client.query("INSERT INTO item_owners (item_id, from_user, to_user, kind, price) VALUES ($1, $2, $3, 'sale', $4)", [l.item_id, l.seller_id, user.id, l.price]);
      await client.query(
        `INSERT INTO market_sales (listing_id, item_id, seller_id, buyer_id, creator_id, price, commission, royalty, seller_net)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [l.id, l.item_id, l.seller_id, user.id, l.creator_id, l.price, split.commission, split.royalty, split.sellerNet],
      );
      await client.query("UPDATE listings SET status = 'sold', closed_at = now() WHERE id = $1", [l.id]);
      return { itemId: l.item_id, price: l.price, coloxs: balance, ...split };
    });

    if (result === 'gone') return reply.code(409).send({ error: 'Cette offre n’existe plus : elle est vendue, retirée ou terminée.' });
    if (result === 'own') return reply.code(409).send({ error: 'Tu ne peux pas acheter ta propre offre' });
    if (result === 'unavailable') return reply.code(409).send({ error: 'Cet objet n’est plus disponible' });
    if (result === 'poor') return reply.code(402).send({ error: 'Tu n’as pas assez de Coloxs' });
    return result;
  });

  // Who owned a creation, from its birth: visible to whoever can see the creation itself.
  app.get<{ Params: { id: string } }>('/api/items/:id/history', async (req, reply) => {
    const user = req.user;
    if (!user) return reply.code(401).send({ error: 'Non connecté' });
    if (!UUID.test(req.params.id)) return reply.code(404).send({ error: 'Objet introuvable' });
    if (!(await findViewableItemRecipe(pool, req.params.id, user.id))) return reply.code(404).send({ error: 'Objet introuvable' });
    const { rows } = await pool.query<{ kind: string; from_name: string | null; to_name: string; price: number | null; created_at: Date }>(
      `SELECT o.kind, f.nickname AS from_name, t.nickname AS to_name, o.price, o.created_at
         FROM item_owners o
         LEFT JOIN users f ON f.id = o.from_user
         JOIN users t ON t.id = o.to_user
        WHERE o.item_id = $1
        ORDER BY o.id`,
      [req.params.id],
    );
    return { history: rows.map((r) => ({ kind: r.kind, from: r.from_name, to: r.to_name, price: r.price, at: r.created_at })) };
  });
}
