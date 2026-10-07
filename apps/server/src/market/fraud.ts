import type pg from 'pg';

export type FraudKind = 'back_and_forth' | 'new_account_spree' | 'price_outlier' | 'one_sided_trade';

/** Is this player shut out of the market by the staff right now? */
export const marketBlockedSql = (alias = 'u') =>
  `EXISTS (SELECT 1 FROM market_blocks mb WHERE mb.user_id = ${alias}.id AND (mb.expires_at IS NULL OR mb.expires_at > now()))`;

export async function isMarketBlocked(db: pg.Pool | pg.PoolClient, userId: string): Promise<boolean> {
  const { rowCount } = await db.query(`SELECT 1 FROM users u WHERE u.id = $1 AND ${marketBlockedSql('u')}`, [userId]);
  return (rowCount ?? 0) > 0;
}

/** Raise a flag for the staff, unless the same one is already waiting. */
async function flag(client: pg.PoolClient, kind: FraudKind, userId: string, otherId: string | null, itemId: string | null, detail: string) {
  await client.query(
    `INSERT INTO fraud_flags (kind, user_id, other_user_id, item_id, detail)
     SELECT $1, $2, $3, $4, $5
      WHERE NOT EXISTS (
        SELECT 1 FROM fraud_flags WHERE status = 'open' AND kind = $1 AND user_id = $2 AND item_id IS NOT DISTINCT FROM $4::uuid
      )`,
    [kind, userId, otherId, itemId, detail.slice(0, 300)],
  );
}

/** Patterns worth a look in a sale that just happened. Runs in the sale's transaction; it only writes flags. */
export async function detectSaleFraud(
  client: pg.PoolClient,
  sale: { itemId: string; sellerId: string; buyerId: string; price: number },
): Promise<void> {
  // The same item going back and forth between the same two players within a week.
  const back = await client.query(
    `SELECT 1 FROM item_owners
      WHERE item_id = $1 AND created_at > now() - interval '7 days' AND kind IN ('sale', 'trade')
        AND ((from_user = $2 AND to_user = $3) OR (from_user = $3 AND to_user = $2))
      OFFSET 1 LIMIT 1`,
    [sale.itemId, sale.sellerId, sale.buyerId],
  );
  if (back.rowCount) {
    await flag(client, 'back_and_forth', sale.buyerId, sale.sellerId, sale.itemId, 'Le même objet passe d’un compte à l’autre en moins d’une semaine.');
  }

  // A very young account that buys a lot.
  const spree = await client.query<{ n: string }>(
    `SELECT count(*) AS n FROM market_sales s JOIN users u ON u.id = s.buyer_id
      WHERE s.buyer_id = $1 AND s.created_at > now() - interval '24 hours' AND u.created_at > now() - interval '24 hours'`,
    [sale.buyerId],
  );
  if (Number(spree.rows[0]!.n) >= 3) {
    await flag(client, 'new_account_spree', sale.buyerId, null, null, `Un compte de moins de 24 h a déjà acheté ${spree.rows[0]!.n} objets.`);
  }

  // A price far above what the market has been paying lately.
  const recent = await client.query<{ median: number | null; n: string }>(
    `SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY price) AS median, count(*) AS n
       FROM (SELECT price FROM market_sales WHERE reversed_at IS NULL ORDER BY id DESC OFFSET 1 LIMIT 20) last`,
  );
  const { median, n } = recent.rows[0]!;
  if (Number(n) >= 5 && median !== null && sale.price >= 100 && sale.price > Number(median) * 10) {
    await flag(client, 'price_outlier', sale.buyerId, sale.sellerId, sale.itemId, `Vendu ${sale.price} Coloxs alors que le prix médian récent est de ${Math.round(Number(median))}.`);
  }
}

/** A trade where one side gives several objects and gets nothing: the usual shape of a gift between accounts of the same person. */
export async function detectTradeFraud(client: pg.PoolClient, trade: { aId: string; bId: string; gaveA: number; gaveB: number }): Promise<void> {
  const [giver, receiver, count] = trade.gaveA >= trade.gaveB ? [trade.aId, trade.bId, trade.gaveA] : [trade.bId, trade.aId, trade.gaveB];
  if (count >= 3 && Math.min(trade.gaveA, trade.gaveB) === 0) {
    await flag(client, 'one_sided_trade', receiver, giver, null, `Échange à sens unique : ${count} objets donnés, rien en retour.`);
  }
}
