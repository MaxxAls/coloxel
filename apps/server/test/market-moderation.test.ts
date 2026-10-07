import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SEEDS } from '@coloxel/render';
import type { RecipeModel } from '../src/creations/model';
import { migrate, migrateDownAll } from '../src/db/migrate';
import { createPool, withTransaction } from '../src/db/pool';
import { buildServer } from '../src/index';
import type { Location } from '../src/realtime/where';
import { creditColoxs } from '../src/wallet/coloxs';

const url = process.env.DATABASE_URL ?? 'postgres://coloxel:coloxel@localhost:5432/coloxel';
const probe = createPool(url);
const available = await probe.query('SELECT 1').then(
  () => true,
  () => false,
);
await probe.end();

const model: RecipeModel = async () => JSON.stringify({ nom: 'Lampe test', parts: SEEDS[0]!.parts });

describe.skipIf(!available)('market moderation, fraud flags and the economy (PostgreSQL)', () => {
  let pool: pg.Pool;
  let app: ReturnType<typeof buildServer>;
  const places = new Map<string, Location>();

  beforeAll(async () => {
    await migrateDownAll(url).catch(() => {});
    await migrate('up', url);
    pool = createPool(url);
    await pool.query('INSERT INTO apartments (id, floor, slot) SELECT 100 + n, 20 + n / 5, n % 5 FROM generate_series(1, 80) AS n');
    app = buildServer({ pool, model, challenges: false, locate: async (ids) => new Map([...places].filter(([id]) => ids.includes(id))) });
  });
  afterAll(async () => {
    await app?.close();
    await pool?.end();
  });

  async function signUp(nickname: string, coloxs = 0, role = 'user') {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { email: `${nickname}@test.dev`, password: 'motdepasse', nickname, birthDate: '1990-01-01' },
    });
    const id = res.json().user.id as string;
    await pool.query('DELETE FROM furniture WHERE owner_id = $1', [id]);
    if (role !== 'user') await pool.query('UPDATE users SET role = $2 WHERE id = $1', [id, role]);
    if (coloxs) await withTransaction(pool, (c) => creditColoxs(c, id, coloxs, 'staff', 'test'));
    places.set(id, { kind: 'hall' });
    return { id, sid: res.cookies.find((c) => c.name === 'coloxel_sid')!.value };
  }
  type Player = Awaited<ReturnType<typeof signUp>>;
  const as = (p: Player) => ({ coloxel_sid: p.sid });
  const send = (p: Player, method: 'GET' | 'POST' | 'PUT' | 'DELETE', path: string, payload?: object) => app.inject({ method, url: path, payload, cookies: as(p) });
  const create = async (p: Player) => (await send(p, 'POST', '/api/creations', { description: 'une lampe' })).json().item.id as string;
  const list = async (p: Player, itemId: string, price: number) => (await send(p, 'POST', '/api/market/listings', { itemId, price })).json().id as string;
  const buy = (p: Player, listingId: string) => send(p, 'POST', `/api/market/listings/${listingId}/buy`);
  const sale = async (seller: Player, buyer: Player, itemId: string, price: number) => buy(buyer, await list(seller, itemId, price));
  const coloxs = async (p: Player) => (await pool.query<{ coloxs: number }>('SELECT coloxs FROM users WHERE id = $1', [p.id])).rows[0]!.coloxs;
  const ownerOf = async (itemId: string) => (await pool.query<{ owner_id: string }>('SELECT owner_id FROM items WHERE id = $1', [itemId])).rows[0]!.owner_id;
  const flags = async (kind: string) => (await pool.query('SELECT * FROM fraud_flags WHERE kind = $1', [kind])).rows;

  describe('fraud flags', () => {
    it('flags an item that goes back and forth between the same two accounts', async () => {
      const a = await signUp('fraud1a', 500);
      const b = await signUp('fraud1b', 500);
      const item = await create(a);
      expect((await sale(a, b, item, 20)).statusCode).toBe(200);
      expect(await flags('back_and_forth')).toHaveLength(0);
      expect((await sale(b, a, item, 20)).statusCode).toBe(200);
      const found = await flags('back_and_forth');
      expect(found).toHaveLength(1);
      expect(found[0]).toMatchObject({ user_id: a.id, other_user_id: b.id, item_id: item, status: 'open' });
    });

    it('does not block anything: the sale goes through', async () => {
      const a = await signUp('fraud2a', 500);
      const b = await signUp('fraud2b', 500);
      const item = await create(a);
      await sale(a, b, item, 20);
      await sale(b, a, item, 20);
      const res = await sale(a, b, item, 20);
      expect(res.statusCode).toBe(200);
      expect(await ownerOf(item)).toBe(b.id);
    });

    it('flags a day-old account that buys several objects', async () => {
      const seller = await signUp('fraud3s');
      const newbie = await signUp('fraud3n', 500);
      for (let n = 0; n < 3; n++) await sale(seller, newbie, await create(seller), 10);
      const found = await flags('new_account_spree');
      expect(found.filter((f) => f.user_id === newbie.id)).toHaveLength(1);
    });

    it('flags a price far above what the market has been paying', async () => {
      const rich = await signUp('fraud4r', 5000);
      const sellers = await Promise.all(['fraud4a', 'fraud4b', 'fraud4c', 'fraud4d', 'fraud4e', 'fraud4f'].map((n) => signUp(n)));
      for (const s of sellers.slice(0, 5)) await sale(s, rich, await create(s), 5);
      expect(await flags('price_outlier')).toHaveLength(0);
      const dear = sellers[5]!;
      const item = await create(dear);
      await sale(dear, rich, item, 4000);
      const found = await flags('price_outlier');
      expect(found).toHaveLength(1);
      expect(found[0]).toMatchObject({ user_id: rich.id, other_user_id: dear.id, item_id: item });
    });

    it('flags a trade where one side gives several objects and gets nothing', async () => {
      const giver = await signUp('fraud5a');
      const taker = await signUp('fraud5b');
      const items = [await create(giver), await create(giver), await create(giver)];
      const id = (await send(giver, 'POST', '/api/trades', { nickname: 'fraud5b' })).json().trade.id as string;
      const v = (await send(giver, 'PUT', `/api/trades/${id}/offer`, { itemIds: items })).json().trade.version as number;
      for (const p of [giver, taker]) await send(p, 'POST', `/api/trades/${id}/accept`, { version: v });
      for (const p of [giver, taker]) await send(p, 'POST', `/api/trades/${id}/confirm`, { version: v });
      const found = await flags('one_sided_trade');
      expect(found).toHaveLength(1);
      expect(found[0]).toMatchObject({ user_id: taker.id, other_user_id: giver.id });
    });
  });

  describe('the staff view', () => {
    it('is closed to players and to roles without the right', async () => {
      const player = await signUp('view1p');
      const animateur = await signUp('view1a', 0, 'animateur');
      for (const [method, path] of [
        ['GET', '/api/staff/market/flags'],
        ['GET', '/api/staff/market/player?nickname=view1p'],
        ['GET', '/api/staff/economy'],
        ['POST', '/api/staff/market/sales/1/reverse'],
        ['POST', '/api/staff/market/block'],
      ] as const) {
        expect((await send(player, method, path, {})).statusCode, `player ${path}`).toBe(404);
        expect((await send(animateur, method, path, {})).statusCode, `animateur ${path}`).toBe(403);
      }
    });

    it('lists the open flags and lets a moderator mark one handled', async () => {
      const mod = await signUp('view2m', 0, 'moderateur');
      const list1 = (await send(mod, 'GET', '/api/staff/market/flags')).json().flags as { id: number; kind: string }[];
      expect(list1.length).toBeGreaterThan(0);
      const id = list1[0]!.id;
      expect((await send(mod, 'POST', `/api/staff/market/flags/${id}/handle`)).statusCode).toBe(204);
      expect((await send(mod, 'POST', `/api/staff/market/flags/${id}/handle`)).statusCode).toBe(404);
      const handled = (await send(mod, 'GET', '/api/staff/market/flags?status=handled')).json().flags as { id: number }[];
      expect(handled.map((f) => f.id)).toContain(id);
    });

    it('shows the transactions of a player', async () => {
      const mod = await signUp('view3m', 0, 'moderateur');
      const a = await signUp('view3a');
      const b = await signUp('view3b', 100);
      await sale(a, b, await create(a), 30);
      const sheet = (await send(mod, 'GET', '/api/staff/market/player?nickname=VIEW3B')).json();
      expect(sheet.player).toMatchObject({ nickname: 'view3b', coloxs: 70 });
      expect(sheet.sales).toEqual([expect.objectContaining({ seller: 'view3a', buyer: 'view3b', price: 30, reversed: false })]);
      expect(sheet.ledger.map((l: { kind: string }) => l.kind)).toContain('purchase');
      expect((await send(mod, 'GET', '/api/staff/market/player?nickname=nobody')).statusCode).toBe(404);
    });
  });

  describe('undoing a sale', () => {
    it('gives the item back, refunds the buyer, takes back what was paid, and keeps the ledger whole', async () => {
      const gerant = await signUp('rev1g', 0, 'gerant');
      const creator = await signUp('rev1c', 0);
      const seller = await signUp('rev1s', 200);
      const buyer = await signUp('rev1b', 500);
      const item = await create(creator);
      await sale(creator, seller, item, 10);
      const sold = await list(seller, item, 100);
      expect((await buy(buyer, sold)).statusCode).toBe(200);
      const before = { creator: await coloxs(creator), seller: await coloxs(seller), buyer: await coloxs(buyer) };
      const saleId = (await pool.query('SELECT id FROM market_sales WHERE listing_id = $1', [sold])).rows[0].id;

      const res = await send(gerant, 'POST', `/api/staff/market/sales/${saleId}/reverse`, { note: 'Achat avec le compte d’un autre' });
      expect(res.statusCode).toBe(204);
      expect(await ownerOf(item)).toBe(seller.id);
      expect(await coloxs(buyer)).toBe(before.buyer + 100);
      expect(await coloxs(seller)).toBe(before.seller - 90);
      expect(await coloxs(creator)).toBe(before.creator - 5);
      const history = (await send(seller, 'GET', `/api/items/${item}/history`)).json().history as { kind: string }[];
      expect(history.map((h) => h.kind)).toEqual(['creation', 'sale', 'sale', 'reversal']);
      const { findColoxMismatches } = await import('../src/wallet/coloxs');
      expect(await findColoxMismatches(pool)).toEqual([]);
      expect((await send(gerant, 'POST', `/api/staff/market/sales/${saleId}/reverse`, { note: 'encore' })).statusCode).toBe(409);
      const logged = await pool.query("SELECT 1 FROM staff_log WHERE command = 'market:reverse'");
      expect(logged.rowCount).toBeGreaterThan(0);
    });

    it('needs a reason and the right to do it', async () => {
      const gerant = await signUp('rev2g', 0, 'gerant');
      const mod = await signUp('rev2m', 0, 'moderateur');
      expect((await send(gerant, 'POST', '/api/staff/market/sales/1/reverse', {})).statusCode).toBe(400);
      expect((await send(mod, 'POST', '/api/staff/market/sales/1/reverse', { note: 'je veux' })).statusCode).toBe(403);
    });

    it('refuses cleanly, changing nothing, when the seller has already spent the money', async () => {
      const gerant = await signUp('rev3g', 0, 'gerant');
      const seller = await signUp('rev3s');
      const buyer = await signUp('rev3b', 100);
      const item = await create(seller);
      const listing = await list(seller, item, 50);
      await buy(buyer, listing);
      // The seller spends what they earned on something else.
      const other = await signUp('rev3o');
      const spent = await create(other);
      await sale(other, seller, spent, await coloxs(seller));
      const saleId = (await pool.query('SELECT id FROM market_sales WHERE listing_id = $1', [listing])).rows[0].id;
      const res = await send(gerant, 'POST', `/api/staff/market/sales/${saleId}/reverse`, { note: 'test' });
      expect(res.statusCode).toBe(409);
      expect(res.json().error).toMatch(/rev3s/);
      expect(await ownerOf(item)).toBe(buyer.id);
      expect(await coloxs(buyer)).toBe(50);
    });

    it('refuses when the item has changed hands since', async () => {
      const gerant = await signUp('rev4g', 0, 'gerant');
      const a = await signUp('rev4a');
      const b = await signUp('rev4b', 100);
      const c = await signUp('rev4c', 100);
      const item = await create(a);
      const first = await list(a, item, 10);
      await buy(b, first);
      await sale(b, c, item, 10);
      const saleId = (await pool.query('SELECT id FROM market_sales WHERE listing_id = $1', [first])).rows[0].id;
      expect((await send(gerant, 'POST', `/api/staff/market/sales/${saleId}/reverse`, { note: 'test' })).statusCode).toBe(409);
      expect(await ownerOf(item)).toBe(c.id);
    });
  });

  describe('shutting a player out of the market', () => {
    it('stops buying, selling, withdrawing and trading, and hides their offers', async () => {
      const gerant = await signUp('block1g', 0, 'gerant');
      const bad = await signUp('block1b', 100);
      const other = await signUp('block1o', 100);
      const offered = await create(bad);
      const listing = await list(bad, offered, 10);
      const spare = await create(bad);

      expect((await send(gerant, 'POST', '/api/staff/market/block', { nickname: 'block1b', reason: 'Fraude probable' })).statusCode).toBe(204);
      expect((await send(bad, 'POST', '/api/market/listings', { itemId: spare, price: 5 })).statusCode).toBe(403);
      expect((await send(bad, 'DELETE', `/api/market/listings/${listing}`)).statusCode).toBe(403);
      const theirs = await create(other);
      const theirListing = await list(other, theirs, 5);
      expect((await buy(bad, theirListing)).statusCode).toBe(403);
      expect((await send(bad, 'POST', '/api/trades', { nickname: 'block1o' })).statusCode).toBe(403);
      expect((await send(other, 'POST', '/api/trades', { nickname: 'block1b' })).statusCode).toBe(409);
      // Their offer is out of sight and cannot be bought.
      const seen = (await send(other, 'GET', '/api/market/listings')).json().listings as { id: string }[];
      expect(seen.map((l) => l.id)).not.toContain(listing);
      expect((await buy(other, listing)).statusCode).toBe(409);
      expect(await coloxs(bad)).toBe(100);

      expect((await send(gerant, 'POST', '/api/staff/market/unblock', { nickname: 'block1b' })).statusCode).toBe(204);
      expect((await send(bad, 'DELETE', `/api/market/listings/${listing}`)).statusCode).toBe(204);
      expect((await send(gerant, 'POST', '/api/staff/market/unblock', { nickname: 'block1b' })).statusCode).toBe(404);
    });

    it('ends by itself when its time is over', async () => {
      const gerant = await signUp('block2g', 0, 'gerant');
      const p = await signUp('block2p');
      await send(gerant, 'POST', '/api/staff/market/block', { nickname: 'block2p', reason: 'Le temps de vérifier', minutes: 30 });
      const item = await create(p);
      expect((await send(p, 'POST', '/api/market/listings', { itemId: item, price: 5 })).statusCode).toBe(403);
      await pool.query("UPDATE market_blocks SET expires_at = now() - interval '1 minute'");
      expect((await send(p, 'POST', '/api/market/listings', { itemId: item, price: 5 })).statusCode).toBe(201);
    });

    it('cannot be given to oneself, to a peer or to a higher role, nor without a reason', async () => {
      const gerant = await signUp('block3g', 0, 'gerant');
      const peer = await signUp('block3p', 0, 'gerant');
      const admin = await signUp('block3a', 0, 'administrateur');
      for (const nickname of ['block3g', 'block3p', 'block3a']) {
        expect((await send(gerant, 'POST', '/api/staff/market/block', { nickname, reason: 'test' })).statusCode, nickname).toBe(403);
      }
      const p = await signUp('block3x');
      expect((await send(gerant, 'POST', '/api/staff/market/block', { nickname: 'block3x', reason: '' })).statusCode).toBe(400);
      expect((await send(gerant, 'POST', '/api/staff/market/block', { nickname: 'nobody-here', reason: 'test' })).statusCode).toBe(404);
      void peer;
      void admin;
      void p;
    });
  });

  describe('reports', () => {
    it('lets a player report an offer, but not their own', async () => {
      const seller = await signUp('rep1s');
      const buyer = await signUp('rep1b');
      const listing = await list(seller, await create(seller), 25);
      const res = await send(buyer, 'POST', '/api/reports', { kind: 'listing', targetId: listing, reason: 'spam' });
      expect(res.statusCode).toBe(201);
      const row = await pool.query("SELECT target_user_id, snapshot FROM reports WHERE kind = 'listing' AND target_key = $1", [listing]);
      expect(row.rows[0].target_user_id).toBe(seller.id);
      expect(row.rows[0].snapshot).toMatch(/25 Coloxs/);
      expect((await send(seller, 'POST', '/api/reports', { kind: 'listing', targetId: listing, reason: 'spam' })).statusCode).toBe(400);
    });

    it('lets a player in a trade report it, and nobody else', async () => {
      const a = await signUp('rep2a');
      const b = await signUp('rep2b');
      const eve = await signUp('rep2e');
      const id = (await send(a, 'POST', '/api/trades', { nickname: 'rep2b' })).json().trade.id as string;
      await send(a, 'PUT', `/api/trades/${id}/offer`, { itemIds: [await create(a)] });
      expect((await send(b, 'POST', '/api/reports', { kind: 'trade', targetId: id, reason: 'harassment' })).statusCode).toBe(201);
      const row = await pool.query("SELECT target_user_id, snapshot FROM reports WHERE kind = 'trade' AND target_key = $1", [id]);
      expect(row.rows[0].target_user_id).toBe(a.id);
      expect(row.rows[0].snapshot).toMatch(/rep2a donne/);
      expect((await send(eve, 'POST', '/api/reports', { kind: 'trade', targetId: id, reason: 'spam' })).statusCode).toBe(404);
    });
  });

  describe('the economy page', () => {
    it('adds up the money in the game, the destroyed commission and the activity', async () => {
      const mod = await signUp('eco1m', 0, 'moderateur');
      const res = await send(mod, 'GET', '/api/staff/economy');
      expect(res.statusCode).toBe(200);
      const eco = res.json();
      const burned = await pool.query('SELECT coalesce(sum(commission), 0)::int AS c FROM market_sales WHERE reversed_at IS NULL');
      expect(eco.coloxs.destroyed).toBe(burned.rows[0].c);
      const total = await pool.query('SELECT sum(coloxs)::int AS t FROM users');
      expect(eco.coloxs.circulating).toBe(total.rows[0].t);
      expect(eco.activity.salesTotal).toBeGreaterThan(0);
      expect(eco.perDay).toHaveLength(14);
      expect(eco.ledgerMismatches).toBe(0);
      expect(eco.flagsOpen).toBeGreaterThanOrEqual(0);
      expect(Array.isArray(eco.concentration)).toBe(true);
    });

    it('shows a series cornered by one account', async () => {
      const mod = await signUp('eco2m', 0, 'moderateur');
      const hoarder = await signUp('eco2h');
      await send(hoarder, 'POST', '/api/creations', { description: 'une lampe', edition: 5 });
      const eco = (await send(mod, 'GET', '/api/staff/economy')).json();
      expect(eco.concentration).toContainEqual({ name: 'Lampe test', size: 5, nickname: 'eco2h', held: 5 });
      expect(eco.topHolders.map((h: { nickname: string }) => h.nickname)).toContain('eco2h');
    });
  });
});
