import type { FastifyInstance } from 'fastify';
import type pg from 'pg';
import { z } from 'zod';
import type { NotifyApartment } from '../building/routes';
import { withTransaction } from '../db/pool';
import { blockedUserSql } from '../moderation/sanctions';
import { itemMaskedSql } from '../moderation/masking';
import { NO_GUARDS, type RateGuards } from '../rate-limit';
import type { Locate } from '../realtime/where';
import { detectTradeFraud, isMarketBlocked, marketBlockedSql } from './fraud';

const SHUT = 'Le marché t’est fermé pour le moment, les échanges aussi.';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** What one side may put on the table, and how long a quiet trade stays open. */
export const MAX_TRADE_ITEMS = 10;
export const TRADE_IDLE_MINUTES = 15;

const startSchema = z.object({ nickname: z.string('Pseudo invalide').trim().min(1, 'Écris le pseudo d’un joueur').max(40, 'Pseudo invalide') }).strict();
const offerSchema = z
  .object({ itemIds: z.array(z.string('Objet invalide').regex(UUID, 'Objet invalide'), 'Objets invalides').max(MAX_TRADE_ITEMS, `${MAX_TRADE_ITEMS} objets au maximum par côté`) })
  .strict();
const versionSchema = z.object({ version: z.number('Version invalide').int('Version invalide') }).strict();

interface TradeRow {
  id: string;
  a_id: string;
  b_id: string;
  status: string;
  version: number;
  a_accepted: boolean;
  b_accepted: boolean;
  a_confirmed: boolean;
  b_confirmed: boolean;
}

async function endTrade(client: pg.PoolClient, tradeId: string, status: 'done' | 'cancelled' | 'expired') {
  await client.query('UPDATE trades SET status = $2, closed_at = now(), updated_at = now() WHERE id = $1', [tradeId, status]);
  await client.query('UPDATE trade_offers SET live = false WHERE trade_id = $1', [tradeId]);
}

/** A trade nobody touched for a while is closed: its items are free again. */
async function expireIdle(db: pg.Pool | pg.PoolClient) {
  const stale = await db.query<{ id: string }>(
    `UPDATE trades SET status = 'expired', closed_at = now() WHERE status = 'open' AND updated_at < now() - make_interval(mins => $1) RETURNING id`,
    [TRADE_IDLE_MINUTES],
  );
  if (stale.rows.length) await db.query('UPDATE trade_offers SET live = false WHERE trade_id = ANY($1::uuid[])', [stale.rows.map((r) => r.id)]);
}

export interface TradeSide {
  accepted: boolean;
  confirmed: boolean;
  items: { id: string; serial: number; name: string; editionNumber: number; editionSize: number; creator: string }[];
}
export interface TradeView {
  id: string;
  version: number;
  partner: string;
  /** 'offer' while the sides are still arranging; 'confirm' once both accepted: the final look at what changes hands. */
  stage: 'offer' | 'confirm';
  mine: TradeSide;
  theirs: TradeSide;
}

async function viewFor(db: pg.Pool | pg.PoolClient, t: TradeRow, me: string): Promise<TradeView> {
  const iAmA = t.a_id === me;
  const partnerId = iAmA ? t.b_id : t.a_id;
  const partner = await db.query<{ nickname: string }>('SELECT nickname FROM users WHERE id = $1', [partnerId]);
  const offers = await db.query<{ giver_id: string; id: string; serial: number; name: string; edition_number: number; edition_size: number; creator: string }>(
    `SELECT o.giver_id, it.id, it.serial, it.name, it.edition_number, it.edition_size, cr.nickname AS creator
       FROM trade_offers o JOIN items it ON it.id = o.item_id JOIN users cr ON cr.id = it.creator_id
      WHERE o.trade_id = $1 AND o.live ORDER BY it.serial`,
    [t.id],
  );
  const side = (giver: string, accepted: boolean, confirmed: boolean): TradeSide => ({
    accepted,
    confirmed,
    items: offers.rows
      .filter((o) => o.giver_id === giver)
      .map((o) => ({ id: o.id, serial: o.serial, name: o.name, editionNumber: o.edition_number, editionSize: o.edition_size, creator: o.creator })),
  });
  return {
    id: t.id,
    version: t.version,
    partner: partner.rows[0]?.nickname ?? '?',
    stage: t.a_accepted && t.b_accepted ? 'confirm' : 'offer',
    mine: iAmA ? side(t.a_id, t.a_accepted, t.a_confirmed) : side(t.b_id, t.b_accepted, t.b_confirmed),
    theirs: iAmA ? side(t.b_id, t.b_accepted, t.b_confirmed) : side(t.a_id, t.a_accepted, t.a_confirmed),
  };
}

const sameRoom = (a: { kind: string; ownerId?: string } | undefined, b: { kind: string; ownerId?: string } | undefined) =>
  !!a && !!b && a.kind === b.kind && (a.ownerId ?? '').toLowerCase() === (b.ownerId ?? '').toLowerCase();

/**
 * Trades between players: creations only, both sides in the same room, two acceptances then a final
 * confirmation that shows number and creator of every object. The swap is one transaction.
 */
export function registerTradeRoutes(app: FastifyInstance, pool: pg.Pool, locate?: Locate, notify?: NotifyApartment, guards: RateGuards = NO_GUARDS) {
  const myOpenTrade = async (db: pg.Pool | pg.PoolClient, userId: string) => {
    const { rows } = await db.query<TradeRow>("SELECT * FROM trades WHERE status = 'open' AND (a_id = $1 OR b_id = $1)", [userId]);
    return rows[0];
  };

  app.get('/api/trades/current', async (req, reply) => {
    const user = req.user;
    if (!user) return reply.code(401).send({ error: 'Non connecté' });
    await expireIdle(pool);
    const t = await myOpenTrade(pool, user.id);
    return { trade: t ? await viewFor(pool, t, user.id) : null };
  });

  app.post('/api/trades', { preHandler: guards.market }, async (req, reply) => {
    const user = req.user;
    if (!user) return reply.code(401).send({ error: 'Non connecté' });
    const parsed = startSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? 'Demande invalide' });
    if (!locate) return reply.code(503).send({ error: 'Les échanges ne sont pas disponibles pour le moment' });

    if (await isMarketBlocked(pool, user.id)) return reply.code(403).send({ error: SHUT });
    const target = await pool.query<{ id: string; blocked: boolean }>(
      `SELECT u.id, (${blockedUserSql('u')} OR ${marketBlockedSql('u')}) AS blocked FROM users u WHERE lower(u.nickname) = lower($1)`,
      [parsed.data.nickname],
    );
    const other = target.rows[0];
    if (!other) return reply.code(404).send({ error: 'Aucun joueur de ce nom' });
    if (other.id === user.id) return reply.code(400).send({ error: 'Tu ne peux pas échanger avec toi-même' });
    if (other.blocked) return reply.code(409).send({ error: 'Ce joueur n’est pas disponible' });

    // Both must be in the same room right now: the server asks where each one is.
    const places = await locate([user.id, other.id]);
    if (!sameRoom(places.get(user.id), places.get(other.id))) {
      return reply.code(409).send({ error: 'Vous devez être dans la même salle pour échanger.' });
    }

    const result = await withTransaction(pool, async (client) => {
      await expireIdle(client);
      await client.query('SELECT id FROM users WHERE id = ANY($1::uuid[]) ORDER BY id FOR UPDATE', [[user.id, other.id].sort()]);
      if (await myOpenTrade(client, user.id)) return 'busy' as const;
      if (await myOpenTrade(client, other.id)) return 'busy-other' as const;
      const { rows } = await client.query<TradeRow>('INSERT INTO trades (a_id, b_id) VALUES ($1, $2) RETURNING *', [user.id, other.id]);
      return viewFor(client, rows[0]!, user.id);
    });
    if (result === 'busy') return reply.code(409).send({ error: 'Tu as déjà un échange en cours' });
    if (result === 'busy-other') return reply.code(409).send({ error: 'Ce joueur est déjà en échange' });
    return reply.code(201).send({ trade: result });
  });

  // Replace what I put on the table. Everything agreed so far is cleared.
  app.put<{ Params: { id: string } }>('/api/trades/:id/offer', { preHandler: guards.market }, async (req, reply) => {
    const user = req.user;
    if (!user) return reply.code(401).send({ error: 'Non connecté' });
    if (!UUID.test(req.params.id)) return reply.code(404).send({ error: 'Échange introuvable' });
    const parsed = offerSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? 'Offre invalide' });
    const ids = [...new Set(parsed.data.itemIds)].sort();
    if (await isMarketBlocked(pool, user.id)) return reply.code(403).send({ error: SHUT });

    const result = await withTransaction(pool, async (client) => {
      await expireIdle(client);
      const found = await client.query<TradeRow>("SELECT * FROM trades WHERE id = $1 AND status = 'open' AND (a_id = $2 OR b_id = $2) FOR UPDATE", [req.params.id, user.id]);
      const t = found.rows[0];
      if (!t) return 'missing' as const;
      if (ids.length) {
        // Locked in a fixed order, like every other move of an item.
        const items = await client.query<{ id: string; owner_id: string; masked: boolean; listed: boolean; traded: boolean }>(
          `SELECT it.id, it.owner_id, ${itemMaskedSql('it')} AS masked,
                  EXISTS (SELECT 1 FROM listings l WHERE l.item_id = it.id AND l.status = 'active') AS listed,
                  EXISTS (SELECT 1 FROM trade_offers o WHERE o.item_id = it.id AND o.live AND o.trade_id <> $2) AS traded
             FROM items it WHERE it.id = ANY($1::uuid[]) ORDER BY it.id FOR UPDATE`,
          [ids, t.id],
        );
        if (items.rows.length !== ids.length || items.rows.some((r) => r.owner_id !== user.id)) return 'not-yours' as const;
        if (items.rows.some((r) => r.masked)) return 'masked' as const;
        if (items.rows.some((r) => r.listed)) return 'listed' as const;
        if (items.rows.some((r) => r.traded)) return 'traded' as const;
      }
      await client.query('DELETE FROM trade_offers WHERE trade_id = $1 AND giver_id = $2', [t.id, user.id]);
      for (const id of ids) await client.query('INSERT INTO trade_offers (trade_id, item_id, giver_id) VALUES ($1, $2, $3)', [t.id, id, user.id]);
      const { rows } = await client.query<TradeRow>(
        `UPDATE trades SET version = version + 1, a_accepted = false, b_accepted = false, a_confirmed = false, b_confirmed = false, updated_at = now()
          WHERE id = $1 RETURNING *`,
        [t.id],
      );
      return viewFor(client, rows[0]!, user.id);
    });
    if (result === 'missing') return reply.code(404).send({ error: 'Échange introuvable ou terminé' });
    if (result === 'not-yours') return reply.code(404).send({ error: 'Un des objets n’est pas à toi' });
    if (result === 'masked') return reply.code(409).send({ error: 'Un des objets est en cours de revue' });
    if (result === 'listed') return reply.code(409).send({ error: 'Un des objets est en vente sur le marché' });
    if (result === 'traded') return reply.code(409).send({ error: 'Un des objets est déjà dans un autre échange' });
    return { trade: result };
  });

  // First step (accept the offers), then second step (confirm after seeing number and creator of everything).
  // The version sent is the one the player saw: if the table changed since, nothing counts.
  for (const step of ['accept', 'confirm'] as const) {
    app.post<{ Params: { id: string } }>(`/api/trades/:id/${step}`, { preHandler: guards.market }, async (req, reply) => {
      const user = req.user;
      if (!user) return reply.code(401).send({ error: 'Non connecté' });
      if (!UUID.test(req.params.id)) return reply.code(404).send({ error: 'Échange introuvable' });
      const parsed = versionSchema.safeParse(req.body);
      if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? 'Version invalide' });
      if (await isMarketBlocked(pool, user.id)) return reply.code(403).send({ error: SHUT });

      const result = await withTransaction(pool, async (client) => {
        await expireIdle(client);
        const found = await client.query<TradeRow>("SELECT * FROM trades WHERE id = $1 AND status = 'open' AND (a_id = $2 OR b_id = $2) FOR UPDATE", [req.params.id, user.id]);
        const t = found.rows[0];
        if (!t) return 'missing' as const;
        if (t.version !== parsed.data.version) return 'changed' as const;
        const iAmA = t.a_id === user.id;
        const offered = await client.query('SELECT 1 FROM trade_offers WHERE trade_id = $1 AND live LIMIT 1', [t.id]);
        if (!offered.rowCount) return 'empty' as const;

        if (step === 'accept') {
          const { rows } = await client.query<TradeRow>(`UPDATE trades SET ${iAmA ? 'a_accepted' : 'b_accepted'} = true, updated_at = now() WHERE id = $1 RETURNING *`, [t.id]);
          return { trade: await viewFor(client, rows[0]!, user.id), done: false, removed: [] as string[] };
        }
        if (!(t.a_accepted && t.b_accepted)) return 'early' as const;
        const { rows } = await client.query<TradeRow>(`UPDATE trades SET ${iAmA ? 'a_confirmed' : 'b_confirmed'} = true, updated_at = now() WHERE id = $1 RETURNING *`, [t.id]);
        const now = rows[0]!;
        if (!(now.a_confirmed && now.b_confirmed)) return { trade: await viewFor(client, now, user.id), done: false, removed: [] as string[] };

        // Both confirmed: swap everything now, or nothing.
        const swap = await executeTrade(client, now);
        if (swap !== 'ok') return swap;
        return { trade: null, done: true, removed: [now.a_id, now.b_id] };
      });
      if (result === 'missing') return reply.code(404).send({ error: 'Échange introuvable ou terminé' });
      if (result === 'changed') return reply.code(409).send({ error: 'L’échange a changé entre-temps. Regarde-le de nouveau.' });
      if (result === 'empty') return reply.code(409).send({ error: 'Il n’y a rien sur la table' });
      if (result === 'early') return reply.code(409).send({ error: 'Les deux joueurs doivent d’abord accepter' });
      if (result === 'invalid') return reply.code(409).send({ error: 'L’échange ne peut plus avoir lieu : un objet a changé de situation. Il a été annulé.' });
      for (const id of result.removed) notify?.(id, 'decor');
      return { trade: result.trade, done: result.done };
    });
  }

  app.delete<{ Params: { id: string } }>('/api/trades/:id', async (req, reply) => {
    const user = req.user;
    if (!user) return reply.code(401).send({ error: 'Non connecté' });
    if (!UUID.test(req.params.id)) return reply.code(404).send({ error: 'Échange introuvable' });
    const cancelled = await withTransaction(pool, async (client) => {
      const found = await client.query<TradeRow>("SELECT * FROM trades WHERE id = $1 AND status = 'open' AND (a_id = $2 OR b_id = $2) FOR UPDATE", [req.params.id, user.id]);
      if (!found.rows[0]) return false;
      await endTrade(client, req.params.id, 'cancelled');
      return true;
    });
    if (!cancelled) return reply.code(404).send({ error: 'Échange introuvable ou terminé' });
    return reply.code(204).send();
  });
}

/**
 * The swap itself. Items are locked in id order and checked once more: still owned by the giver, not
 * on sale, not masked, and neither player sanctioned. If anything is off the trade is cancelled and nothing moves.
 */
async function executeTrade(client: pg.PoolClient, t: TradeRow): Promise<'ok' | 'invalid'> {
  const offers = await client.query<{ item_id: string; giver_id: string }>('SELECT item_id, giver_id FROM trade_offers WHERE trade_id = $1 AND live ORDER BY item_id', [t.id]);
  const ids = offers.rows.map((o) => o.item_id);
  const items = await client.query<{ id: string; owner_id: string; masked: boolean; listed: boolean }>(
    `SELECT it.id, it.owner_id, ${itemMaskedSql('it')} AS masked,
            EXISTS (SELECT 1 FROM listings l WHERE l.item_id = it.id AND l.status = 'active') AS listed
       FROM items it WHERE it.id = ANY($1::uuid[]) ORDER BY it.id FOR UPDATE`,
    [ids],
  );
  const giver = new Map(offers.rows.map((o) => [o.item_id, o.giver_id]));
  const blocked = await client.query(`SELECT 1 FROM users u WHERE u.id IN ($1, $2) AND (${blockedUserSql('u')} OR ${marketBlockedSql('u')})`, [t.a_id, t.b_id]);
  const wrong =
    items.rows.length !== ids.length || items.rows.some((r) => r.owner_id !== giver.get(r.id) || r.masked || r.listed) || (blocked.rowCount ?? 0) > 0;
  if (wrong) {
    await endTrade(client, t.id, 'cancelled');
    return 'invalid';
  }
  for (const it of items.rows) {
    const to = giver.get(it.id) === t.a_id ? t.b_id : t.a_id;
    await client.query('DELETE FROM placements WHERE item_id = $1', [it.id]);
    await client.query('UPDATE items SET owner_id = $2 WHERE id = $1', [it.id, to]);
    await client.query("INSERT INTO item_owners (item_id, from_user, to_user, kind) VALUES ($1, $2, $3, 'trade')", [it.id, giver.get(it.id), to]);
  }
  await endTrade(client, t.id, 'done');
  const gaveA = offers.rows.filter((o) => o.giver_id === t.a_id).length;
  await detectTradeFraud(client, { aId: t.a_id, bId: t.b_id, gaveA, gaveB: offers.rows.length - gaveA });
  return 'ok';
}
