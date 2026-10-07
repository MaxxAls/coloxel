import type { FastifyInstance } from 'fastify';
import type pg from 'pg';
import { z } from 'zod';
import { withTransaction } from '../db/pool';
import { outranks } from '../staff/roles';
import { requireStaff } from '../site/settings';
import { creditColoxs, debitColoxs, findColoxMismatches } from '../wallet/coloxs';

const NUMERIC = /^\d{1,15}$/;
const blockSchema = z
  .object({
    nickname: z.string().trim().min(1).max(40),
    reason: z.string().transform((s) => s.trim()).pipe(z.string().min(3, 'Donne une raison (3 caractères au moins)').max(300)),
    minutes: z.number().int().min(1).max(365 * 24 * 60).optional(),
  })
  .strict();
const nicknameSchema = z.object({ nickname: z.string().trim().min(1).max(40) }).strict();
const noteSchema = z.object({ note: z.string().transform((s) => s.trim()).pipe(z.string().min(3, 'Explique pourquoi (3 caractères au moins)').max(300)) }).strict();

/** What the staff does about the market: suspicious operations, a player's transactions, undoing a sale, shutting someone out, the economy. */
export function registerMarketStaffRoutes(app: FastifyInstance, pool: pg.Pool) {
  const log = (staffId: string, command: string, args: string) =>
    pool.query('INSERT INTO staff_log (staff_id, command, args) VALUES ($1, $2, $3)', [staffId, command, args.slice(0, 400)]).catch(() => undefined);

  app.get<{ Querystring: { status?: string } }>('/api/staff/market/flags', async (req, reply) => {
    if (!(await requireStaff(pool, req, reply, 'market.view'))) return;
    const status = req.query.status === 'handled' ? 'handled' : 'open';
    const { rows } = await pool.query(
      `SELECT f.id, f.kind, f.detail, f.status, f.created_at, f.item_id, u.nickname AS player, o.nickname AS other, it.serial
         FROM fraud_flags f JOIN users u ON u.id = f.user_id LEFT JOIN users o ON o.id = f.other_user_id LEFT JOIN items it ON it.id = f.item_id
        WHERE f.status = $1 ORDER BY f.id DESC LIMIT 100`,
      [status],
    );
    return {
      flags: rows.map((r) => ({ id: Number(r.id), kind: r.kind, detail: r.detail, status: r.status, at: r.created_at, itemId: r.item_id, serial: r.serial, player: r.player, other: r.other })),
    };
  });

  app.post<{ Params: { id: string } }>('/api/staff/market/flags/:id/handle', async (req, reply) => {
    const staff = await requireStaff(pool, req, reply, 'market.view');
    if (!staff) return;
    if (!NUMERIC.test(req.params.id)) return reply.code(404).send({ error: 'Introuvable' });
    const { rowCount } = await pool.query("UPDATE fraud_flags SET status = 'handled', handled_by = $2, handled_at = now() WHERE id = $1 AND status = 'open'", [req.params.id, staff.id]);
    if (!rowCount) return reply.code(404).send({ error: 'Introuvable ou déjà traité' });
    return reply.code(204).send();
  });

  // Everything the market knows about one player.
  app.get<{ Querystring: { nickname?: string } }>('/api/staff/market/player', async (req, reply) => {
    if (!(await requireStaff(pool, req, reply, 'market.view'))) return;
    const found = await pool.query<{ id: string; nickname: string; coloxs: number; created_at: Date }>(
      'SELECT id, nickname, coloxs, created_at FROM users WHERE lower(nickname) = lower($1)',
      [(req.query.nickname ?? '').trim()],
    );
    const p = found.rows[0];
    if (!p) return reply.code(404).send({ error: 'Aucun joueur de ce nom' });
    const [sales, trades, listings, ledger, block] = await Promise.all([
      pool.query(
        `SELECT s.id, s.price, s.commission, s.royalty, s.created_at, s.reversed_at, it.serial, it.name, se.nickname AS seller, bu.nickname AS buyer
           FROM market_sales s JOIN items it ON it.id = s.item_id JOIN users se ON se.id = s.seller_id JOIN users bu ON bu.id = s.buyer_id
          WHERE s.seller_id = $1 OR s.buyer_id = $1 ORDER BY s.id DESC LIMIT 30`,
        [p.id],
      ),
      pool.query(
        `SELECT t.id, t.status, t.created_at, a.nickname AS a, b.nickname AS b,
                (SELECT count(*) FROM trade_offers o WHERE o.trade_id = t.id AND o.giver_id = t.a_id)::int AS gave_a,
                (SELECT count(*) FROM trade_offers o WHERE o.trade_id = t.id AND o.giver_id = t.b_id)::int AS gave_b
           FROM trades t JOIN users a ON a.id = t.a_id JOIN users b ON b.id = t.b_id
          WHERE t.a_id = $1 OR t.b_id = $1 ORDER BY t.created_at DESC LIMIT 15`,
        [p.id],
      ),
      pool.query(
        `SELECT l.id, l.price, l.expires_at, it.serial, it.name FROM listings l JOIN items it ON it.id = l.item_id
          WHERE l.seller_id = $1 AND l.status = 'active' ORDER BY l.created_at DESC`,
        [p.id],
      ),
      pool.query('SELECT delta, kind, detail, created_at FROM colox_ledger WHERE user_id = $1 ORDER BY id DESC LIMIT 30', [p.id]),
      pool.query('SELECT reason, expires_at, created_at FROM market_blocks WHERE user_id = $1 AND (expires_at IS NULL OR expires_at > now())', [p.id]),
    ]);
    return {
      player: { id: p.id, nickname: p.nickname, coloxs: p.coloxs, since: p.created_at },
      block: block.rows[0] ? { reason: block.rows[0].reason, until: block.rows[0].expires_at } : null,
      sales: sales.rows.map((r) => ({
        id: Number(r.id),
        serial: r.serial,
        name: r.name,
        seller: r.seller,
        buyer: r.buyer,
        price: r.price,
        commission: r.commission,
        royalty: r.royalty,
        at: r.created_at,
        reversed: !!r.reversed_at,
      })),
      trades: trades.rows.map((r) => ({ id: r.id, status: r.status, at: r.created_at, a: r.a, b: r.b, gaveA: r.gave_a, gaveB: r.gave_b })),
      listings: listings.rows.map((r) => ({ id: r.id, serial: r.serial, name: r.name, price: r.price, expiresAt: r.expires_at })),
      ledger: ledger.rows.map((r) => ({ delta: r.delta, kind: r.kind, detail: r.detail, at: r.created_at })),
    };
  });

  // Undo a sale: the item goes back to the seller, the buyer is refunded, what the seller and the creator were
  // paid is taken back. A reversing line in the ledger for each; nothing is erased. Refused when it cannot be done cleanly.
  app.post<{ Params: { id: string } }>('/api/staff/market/sales/:id/reverse', async (req, reply) => {
    const staff = await requireStaff(pool, req, reply, 'market.manage');
    if (!staff) return;
    if (!NUMERIC.test(req.params.id)) return reply.code(404).send({ error: 'Vente introuvable' });
    const parsed = noteSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? 'Explique pourquoi' });

    const result = await withTransaction(pool, async (client) => {
      const found = await client.query<{ item_id: string; seller_id: string; buyer_id: string; creator_id: string; price: number; royalty: number; seller_net: number; reversed_at: Date | null }>(
        'SELECT item_id, seller_id, buyer_id, creator_id, price, royalty, seller_net, reversed_at FROM market_sales WHERE id = $1 FOR UPDATE',
        [req.params.id],
      );
      const s = found.rows[0];
      if (!s) return 'missing' as const;
      if (s.reversed_at) return 'done' as const;
      const item = await client.query<{ owner_id: string; listed: boolean; traded: boolean }>(
        `SELECT it.owner_id, EXISTS (SELECT 1 FROM listings l WHERE l.item_id = it.id AND l.status = 'active') AS listed,
                EXISTS (SELECT 1 FROM trade_offers o WHERE o.item_id = it.id AND o.live) AS traded
           FROM items it WHERE it.id = $1 FOR UPDATE`,
        [s.item_id],
      );
      const it = item.rows[0]!;
      if (it.owner_id !== s.buyer_id) return 'moved' as const;
      if (it.listed || it.traded) return 'busy' as const;

      const involved = [...new Set([s.seller_id, s.buyer_id, s.creator_id])].sort();
      const balances = await client.query<{ id: string; coloxs: number; nickname: string }>('SELECT id, coloxs, nickname FROM users WHERE id = ANY($1::uuid[]) ORDER BY id FOR UPDATE', [involved]);
      const owed = new Map<string, number>([[s.seller_id, s.seller_net]]);
      if (s.royalty > 0) owed.set(s.creator_id, (owed.get(s.creator_id) ?? 0) + s.royalty);
      const short = balances.rows.filter((b) => (owed.get(b.id) ?? 0) > b.coloxs);
      if (short.length) return { short: short.map((b) => b.nickname) };

      const label = `Vente annulée par l’équipe (vente ${req.params.id})`;
      await debitColoxs(client, s.seller_id, s.seller_net, 'chargeback', label);
      if (s.royalty > 0) await debitColoxs(client, s.creator_id, s.royalty, 'chargeback', label);
      await creditColoxs(client, s.buyer_id, s.price, 'refund', label);
      await client.query('DELETE FROM placements WHERE item_id = $1', [s.item_id]);
      await client.query('UPDATE items SET owner_id = $2 WHERE id = $1', [s.item_id, s.seller_id]);
      await client.query("INSERT INTO item_owners (item_id, from_user, to_user, kind) VALUES ($1, $2, $3, 'reversal')", [s.item_id, s.buyer_id, s.seller_id]);
      await client.query('UPDATE market_sales SET reversed_at = now(), reversed_by = $2, reversal_note = $3 WHERE id = $1', [req.params.id, staff.id, parsed.data.note]);
      return 'ok' as const;
    });
    if (result === 'missing') return reply.code(404).send({ error: 'Vente introuvable' });
    if (result === 'done') return reply.code(409).send({ error: 'Cette vente est déjà annulée' });
    if (result === 'moved') return reply.code(409).send({ error: 'L’objet n’est plus chez l’acheteur : il a changé de mains depuis. Annule d’abord la suite.' });
    if (result === 'busy') return reply.code(409).send({ error: 'L’objet est en vente ou dans un échange. Attends ou retire-le d’abord.' });
    if (result !== 'ok') return reply.code(409).send({ error: `Impossible d’annuler proprement : ${result.short.join(', ')} n’a plus assez de Coloxs pour rendre ce qu’il a reçu. Ferme le marché à cette personne et règle-le à la main.` });
    await log(staff.id, 'market:reverse', `vente ${req.params.id} : ${parsed.data.note}`);
    return reply.code(204).send();
  });

  app.post('/api/staff/market/block', async (req, reply) => {
    const staff = await requireStaff(pool, req, reply, 'market.manage');
    if (!staff) return;
    const parsed = blockSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? 'Demande invalide' });
    const target = await pool.query<{ id: string; role: string }>('SELECT id, role FROM users WHERE lower(nickname) = lower($1)', [parsed.data.nickname]);
    const t = target.rows[0];
    if (!t) return reply.code(404).send({ error: 'Aucun joueur de ce nom' });
    if (t.id === staff.id || !outranks(staff.role, t.role)) return reply.code(403).send({ error: 'Tu ne peux pas fermer le marché à ce joueur.' });
    await pool.query(
      `INSERT INTO market_blocks (user_id, reason, blocked_by, expires_at)
       VALUES ($1, $2, $3, CASE WHEN $4::int IS NULL THEN NULL ELSE now() + make_interval(mins => $4::int) END)
       ON CONFLICT (user_id) DO UPDATE SET reason = EXCLUDED.reason, blocked_by = EXCLUDED.blocked_by, created_at = now(), expires_at = EXCLUDED.expires_at`,
      [t.id, parsed.data.reason, staff.id, parsed.data.minutes ?? null],
    );
    await log(staff.id, 'market:block', `${parsed.data.nickname} : ${parsed.data.reason}`);
    return reply.code(204).send();
  });

  app.post('/api/staff/market/unblock', async (req, reply) => {
    const staff = await requireStaff(pool, req, reply, 'market.manage');
    if (!staff) return;
    const parsed = nicknameSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Demande invalide' });
    const { rowCount } = await pool.query('DELETE FROM market_blocks WHERE user_id = (SELECT id FROM users WHERE lower(nickname) = lower($1))', [parsed.data.nickname]);
    if (!rowCount) return reply.code(404).send({ error: 'Ce joueur n’a pas le marché fermé' });
    await log(staff.id, 'market:unblock', parsed.data.nickname);
    return reply.code(204).send();
  });

  // The page that tells whether the market holds: money in the game, money destroyed, prices, who holds what.
  app.get('/api/staff/economy', async (req, reply) => {
    if (!(await requireStaff(pool, req, reply, 'market.view'))) return;
    const one = async <T>(sql: string) => (await pool.query(sql)).rows[0] as T;
    const [money, burned, day, activity, perDay, holders, series, flags, blocks, mismatches] = await Promise.all([
      one<{ circulating: string; bought: string; given: string; refunded: string }>(
        `SELECT (SELECT coalesce(sum(coloxs), 0) FROM users) AS circulating,
                (SELECT coalesce(sum(delta), 0) FROM colox_ledger WHERE kind = 'pack') AS bought,
                (SELECT coalesce(sum(delta), 0) FROM colox_ledger WHERE kind = 'staff') AS given,
                (SELECT coalesce(sum(delta), 0) FROM colox_ledger WHERE kind = 'refund') AS refunded`,
      ),
      one<{ burned: string }>('SELECT coalesce(sum(commission), 0) AS burned FROM market_sales WHERE reversed_at IS NULL'),
      one<{ n: string; volume: string; median: number | null }>(
        `SELECT count(*) AS n, coalesce(sum(price), 0) AS volume, percentile_cont(0.5) WITHIN GROUP (ORDER BY price) AS median
           FROM market_sales WHERE reversed_at IS NULL AND created_at > now() - interval '24 hours'`,
      ),
      one<{ listings: string; trades_open: string; trades_done: string; sales_total: string }>(
        `SELECT (SELECT count(*) FROM listings WHERE status = 'active' AND expires_at > now()) AS listings,
                (SELECT count(*) FROM trades WHERE status = 'open') AS trades_open,
                (SELECT count(*) FROM trades WHERE status = 'done') AS trades_done,
                (SELECT count(*) FROM market_sales WHERE reversed_at IS NULL) AS sales_total`,
      ),
      pool.query<{ day: string; n: string; volume: string; median: number | null }>(
        `SELECT to_char(d::date, 'YYYY-MM-DD') AS day, count(s.id) AS n, coalesce(sum(s.price), 0) AS volume,
                percentile_cont(0.5) WITHIN GROUP (ORDER BY s.price) AS median
           FROM generate_series(current_date - 13, current_date, interval '1 day') d
           LEFT JOIN market_sales s ON s.reversed_at IS NULL AND s.created_at >= d AND s.created_at < d + interval '1 day'
          GROUP BY d ORDER BY d`,
      ),
      pool.query<{ nickname: string; n: string }>(
        `SELECT u.nickname, count(*) AS n FROM items it JOIN users u ON u.id = it.owner_id GROUP BY u.nickname ORDER BY count(*) DESC, u.nickname LIMIT 5`,
      ),
      pool.query<{ name: string; edition_size: number; nickname: string; held: string }>(
        `SELECT DISTINCT ON (it.series_id) it.name, it.edition_size, u.nickname, count(*) OVER (PARTITION BY it.series_id, it.owner_id) AS held
           FROM items it JOIN users u ON u.id = it.owner_id WHERE it.series_id IS NOT NULL
          ORDER BY it.series_id, count(*) OVER (PARTITION BY it.series_id, it.owner_id) DESC`,
      ),
      one<{ n: string }>("SELECT count(*) AS n FROM fraud_flags WHERE status = 'open'"),
      one<{ n: string }>('SELECT count(*) AS n FROM market_blocks WHERE expires_at IS NULL OR expires_at > now()'),
      findColoxMismatches(pool),
    ]);
    return {
      coloxs: { circulating: Number(money.circulating), bought: Number(money.bought), givenByStaff: Number(money.given), refunded: Number(money.refunded), destroyed: Number(burned.burned) },
      last24h: { sales: Number(day.n), volume: Number(day.volume), medianPrice: day.median === null ? null : Math.round(day.median) },
      activity: { listings: Number(activity.listings), tradesOpen: Number(activity.trades_open), tradesDone: Number(activity.trades_done), salesTotal: Number(activity.sales_total) },
      perDay: perDay.rows.map((r) => ({ day: r.day, sales: Number(r.n), volume: Number(r.volume), medianPrice: r.median === null ? null : Math.round(r.median) })),
      topHolders: holders.rows.map((r) => ({ nickname: r.nickname, items: Number(r.n) })),
      // For each limited series, the player holding the most copies: a series cornered by one account shows here.
      concentration: series.rows
        .map((r) => ({ name: r.name, size: r.edition_size, nickname: r.nickname, held: Number(r.held) }))
        .filter((r) => r.held >= 3)
        .sort((a, b) => b.held / b.size - a.held / a.size)
        .slice(0, 10),
      flagsOpen: Number(flags.n),
      marketBlocks: Number(blocks.n),
      ledgerMismatches: mismatches.length,
    };
  });
}
