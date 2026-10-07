import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SEEDS } from '@coloxel/render';
import type { RecipeModel } from '../src/creations/model';
import { migrate, migrateDownAll } from '../src/db/migrate';
import { createPool, withTransaction } from '../src/db/pool';
import { buildServer } from '../src/index';
import { splitSale } from '../src/market/config';
import { creditColoxs, findColoxMismatches } from '../src/wallet/coloxs';

const url = process.env.DATABASE_URL ?? 'postgres://coloxel:coloxel@localhost:5432/coloxel';
const probe = createPool(url);
const available = await probe.query('SELECT 1').then(
  () => true,
  () => false,
);
await probe.end();

const model: RecipeModel = async () => JSON.stringify({ nom: 'Lampe test', parts: SEEDS[0]!.parts });

describe('splitSale', () => {
  const config = { commissionPercent: 5, royaltyPercent: 5, minPrice: 1, maxPrice: 100000, listingDays: 7, maxActiveListings: 20 };
  it('shares a price between the commission, the creator and the seller', () => {
    expect(splitSale(100, false, config)).toEqual({ commission: 5, royalty: 5, sellerNet: 90 });
  });
  it('rounds the fees down and leaves the rest to the seller', () => {
    expect(splitSale(39, false, config)).toEqual({ commission: 1, royalty: 1, sellerNet: 37 });
    expect(splitSale(19, false, config)).toEqual({ commission: 0, royalty: 0, sellerNet: 19 });
    expect(splitSale(1, false, config)).toEqual({ commission: 0, royalty: 0, sellerNet: 1 });
  });
  it('pays no royalty when the creator is one of the two parties', () => {
    expect(splitSale(100, true, config)).toEqual({ commission: 5, royalty: 0, sellerNet: 95 });
  });
  it('always adds up to the price', () => {
    for (let price = 1; price <= 2000; price++) {
      for (const party of [true, false]) {
        const s = splitSale(price, party, config);
        expect(s.commission + s.royalty + s.sellerNet).toBe(price);
        expect(s.sellerNet).toBeGreaterThan(0);
      }
    }
  });
});

describe.skipIf(!available)('the market (PostgreSQL)', () => {
  let pool: pg.Pool;
  let app: ReturnType<typeof buildServer>;

  beforeAll(async () => {
    await migrateDownAll(url).catch(() => {});
    await migrate('up', url);
    pool = createPool(url);
    // The first building holds 30 players; these tests sign up more.
    await pool.query('INSERT INTO apartments (id, floor, slot) SELECT 100 + n, 20 + n / 5, n % 5 FROM generate_series(1, 60) AS n');
    app = buildServer({ pool, model, challenges: false });
  });
  afterAll(async () => {
    await app?.close();
    await pool?.end();
  });

  async function signUp(nickname: string, coloxs = 0) {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { email: `${nickname}@test.dev`, password: 'motdepasse', nickname, birthDate: '1990-01-01' },
    });
    const id = res.json().user.id as string;
    // A bare apartment, so placements are the creations' only.
    await pool.query('DELETE FROM furniture WHERE owner_id = $1', [id]);
    if (coloxs) await withTransaction(pool, (c) => creditColoxs(c, id, coloxs, 'staff', 'test'));
    return { id, sid: res.cookies.find((c) => c.name === 'coloxel_sid')!.value };
  }
  type Player = Awaited<ReturnType<typeof signUp>>;
  const as = (p: Player) => ({ coloxel_sid: p.sid });
  const create = async (p: Player) =>
    (await app.inject({ method: 'POST', url: '/api/creations', payload: { description: 'une lampe' }, cookies: as(p) })).json().item.id as string;
  const list = (p: Player, itemId: string, price: unknown) =>
    app.inject({ method: 'POST', url: '/api/market/listings', payload: { itemId, price } as object, cookies: as(p) });
  const buy = (p: Player, listingId: string) => app.inject({ method: 'POST', url: `/api/market/listings/${listingId}/buy`, cookies: as(p) });
  const browse = async (p: Player, query = '') =>
    (await app.inject({ method: 'GET', url: `/api/market/listings${query}`, cookies: as(p) })).json() as {
      total: number;
      listings: { id: string; price: number; seller: string; mine: boolean; item: { id: string; name: string; creator: string } }[];
    };
  const place = (p: Player, itemId: string, i = 1, j = 1) =>
    app.inject({ method: 'PUT', url: '/api/placements', payload: { itemId, i, j }, cookies: as(p) });
  const coloxs = async (p: Player) => (await pool.query<{ coloxs: number }>('SELECT coloxs FROM users WHERE id = $1', [p.id])).rows[0]!.coloxs;
  const ownerOf = async (itemId: string) => (await pool.query<{ owner_id: string }>('SELECT owner_id FROM items WHERE id = $1', [itemId])).rows[0]!.owner_id;
  const sell = async (seller: Player, price: number) => {
    const itemId = await create(seller);
    const res = await list(seller, itemId, price);
    return { itemId, listingId: res.json().id as string };
  };

  it('asks for a session everywhere', async () => {
    for (const [method, path] of [
      ['GET', '/api/market/rules'],
      ['GET', '/api/market/listings'],
      ['POST', '/api/market/listings'],
      ['DELETE', '/api/market/listings/00000000-0000-4000-8000-000000000000'],
      ['POST', '/api/market/listings/00000000-0000-4000-8000-000000000000/buy'],
      ['GET', '/api/items/00000000-0000-4000-8000-000000000000/history'],
    ] as const) {
      expect((await app.inject({ method, url: path, payload: {} })).statusCode, `${method} ${path}`).toBe(401);
    }
  });

  describe('putting on sale', () => {
    it('takes the item off the wall, keeps it in escrow and shows it in the inventory', async () => {
      const alice = await signUp('lister1');
      const item = await create(alice);
      expect((await place(alice, item)).statusCode).toBe(200);
      const res = await list(alice, item, 50);
      expect(res.statusCode).toBe(201);
      expect(await pool.query('SELECT 1 FROM placements WHERE item_id = $1', [item])).toHaveProperty('rowCount', 0);
      const inv = (await app.inject({ method: 'GET', url: '/api/inventory', cookies: as(alice) })).json().items as { id: string; placement: unknown; listing: { id: string; price: number } | null }[];
      expect(inv.find((i) => i.id === item)).toMatchObject({ placement: null, listing: { id: res.json().id, price: 50 } });
    });

    it('refuses to place an item on sale, from the API and straight in the database', async () => {
      const alice = await signUp('lister2');
      const item = await create(alice);
      await list(alice, item, 50);
      const res = await place(alice, item);
      expect(res.statusCode).toBe(409);
      await expect(pool.query('INSERT INTO placements (item_id, user_id, i, j) VALUES ($1, $2, 2, 2)', [item, alice.id])).rejects.toThrow(/on the market/);
    });

    it('refuses a second offer for the same item, and an item that is not yours', async () => {
      const alice = await signUp('lister3');
      const bob = await signUp('lister4');
      const item = await create(alice);
      expect((await list(alice, item, 50)).statusCode).toBe(201);
      expect((await list(alice, item, 60)).statusCode).toBe(409);
      expect((await list(bob, item, 60)).statusCode).toBe(404);
    });

    it('two simultaneous offers for one item: only one is made', async () => {
      const alice = await signUp('lister5');
      const item = await create(alice);
      const results = await Promise.all([list(alice, item, 10), list(alice, item, 11), list(alice, item, 12)]);
      expect(results.filter((r) => r.statusCode === 201)).toHaveLength(1);
      const { rows } = await pool.query("SELECT count(*)::int AS n FROM listings WHERE item_id = $1 AND status = 'active'", [item]);
      expect(rows[0].n).toBe(1);
    });

    it('placing and listing at the same moment never leaves an item both on sale and on the wall', async () => {
      for (let round = 0; round < 8; round++) {
        const alice = await signUp(`racer${round}`);
        const item = await create(alice);
        await Promise.all([place(alice, item), list(alice, item, 10)]);
        const { rows } = await pool.query(
          `SELECT (SELECT count(*) FROM placements WHERE item_id = $1)::int AS placed,
                  (SELECT count(*) FROM listings WHERE item_id = $1 AND status = 'active')::int AS listed`,
          [item],
        );
        expect(rows[0].placed + rows[0].listed, `round ${round}`).toBeLessThanOrEqual(1);
        expect(rows[0].listed).toBe(1);
      }
    });

    it('checks the price: whole Coloxs, within the limits, and nothing else in the body', async () => {
      const alice = await signUp('lister6');
      const item = await create(alice);
      for (const price of [0, -5, 1.5, 100001, '50', null, Number.MAX_SAFE_INTEGER]) {
        expect((await list(alice, item, price)).statusCode, String(price)).toBe(400);
      }
      const extra = await app.inject({ method: 'POST', url: '/api/market/listings', payload: { itemId: item, price: 5, sellerId: 'x', commission: 0 }, cookies: as(alice) });
      expect(extra.statusCode).toBe(400);
      expect((await list(alice, 'not-a-uuid', 5)).statusCode).toBe(400);
    });

    it('limits the number of live offers per player', async () => {
      const alice = await signUp('lister7');
      process.env.MARKET_MAX_LISTINGS = '2';
      try {
        const items = [await create(alice), await create(alice), await create(alice)];
        expect((await list(alice, items[0]!, 5)).statusCode).toBe(201);
        expect((await list(alice, items[1]!, 5)).statusCode).toBe(201);
        expect((await list(alice, items[2]!, 5)).statusCode).toBe(409);
      } finally {
        delete process.env.MARKET_MAX_LISTINGS;
      }
    });

    it('cancelling gives the item back, and it can be placed again', async () => {
      const alice = await signUp('lister8');
      const { itemId, listingId } = await sell(alice, 30);
      const bob = await signUp('lister9');
      expect((await app.inject({ method: 'DELETE', url: `/api/market/listings/${listingId}`, cookies: as(bob) })).statusCode).toBe(404);
      expect((await app.inject({ method: 'DELETE', url: `/api/market/listings/${listingId}`, cookies: as(alice) })).statusCode).toBe(204);
      expect((await place(alice, itemId)).statusCode).toBe(200);
      expect((await app.inject({ method: 'DELETE', url: `/api/market/listings/${listingId}`, cookies: as(alice) })).statusCode).toBe(404);
    });
  });

  describe('buying', () => {
    it('moves the item, the money, the royalty and the history together', async () => {
      const creator = await signUp('creator1');
      const reseller = await signUp('reseller1', 0);
      const buyer = await signUp('buyer1', 500);
      // The creator sells to the reseller first (no royalty on their own creation), who resells.
      const item = await create(creator);
      const first = (await list(creator, item, 40)).json().id as string;
      await withTransaction(pool, (c) => creditColoxs(c, reseller.id, 100, 'staff', 'test'));
      expect((await buy(reseller, first)).statusCode).toBe(200);
      const second = (await list(reseller, item, 100)).json().id as string;

      const res = await buy(buyer, second);
      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({ itemId: item, price: 100, commission: 5, royalty: 5, sellerNet: 90, coloxs: 400 });
      expect(await ownerOf(item)).toBe(buyer.id);
      expect(await coloxs(buyer)).toBe(400);
      // The reseller paid 40 and was paid 90; the creator got 38 on the first sale (40 - 2) and 5 royalty on the second.
      expect(await coloxs(reseller)).toBe(100 - 40 + 90);
      expect(await coloxs(creator)).toBe(38 + 5);

      const history = (await app.inject({ method: 'GET', url: `/api/items/${item}/history`, cookies: as(buyer) })).json().history;
      expect(history.map((h: { kind: string; from: string | null; to: string; price: number | null }) => [h.kind, h.from, h.to, h.price])).toEqual([
        ['creation', null, 'creator1', null],
        ['sale', 'creator1', 'reseller1', 40],
        ['sale', 'reseller1', 'buyer1', 100],
      ]);
      const sales = await pool.query('SELECT price, commission, royalty, seller_net FROM market_sales WHERE item_id = $1 ORDER BY id', [item]);
      expect(sales.rows).toEqual([
        { price: 40, commission: 2, royalty: 0, seller_net: 38 },
        { price: 100, commission: 5, royalty: 5, seller_net: 90 },
      ]);
    });

    it('pays no royalty when the creator buys their own creation back', async () => {
      const creator = await signUp('creator2', 200);
      const other = await signUp('reseller2');
      const item = await create(creator);
      const first = (await list(creator, item, 10)).json().id as string;
      await withTransaction(pool, (c) => creditColoxs(c, other.id, 10, 'staff', 'test'));
      await buy(other, first);
      const back = (await list(other, item, 100)).json().id as string;
      const before = await coloxs(creator);
      expect((await buy(creator, back)).json()).toMatchObject({ commission: 5, royalty: 0, sellerNet: 95 });
      expect(await coloxs(creator)).toBe(before - 100);
    });

    it('refuses when the buyer cannot pay, and changes nothing', async () => {
      const seller = await signUp('seller3');
      const buyer = await signUp('buyer3', 49);
      const { itemId, listingId } = await sell(seller, 50);
      const res = await buy(buyer, listingId);
      expect(res.statusCode).toBe(402);
      expect(await ownerOf(itemId)).toBe(seller.id);
      expect(await coloxs(buyer)).toBe(49);
      expect(await coloxs(seller)).toBe(0);
      expect((await pool.query('SELECT status FROM listings WHERE id = $1', [listingId])).rows[0].status).toBe('active');
    });

    it('does not let a seller buy their own offer', async () => {
      const seller = await signUp('seller4', 100);
      const { listingId } = await sell(seller, 10);
      expect((await buy(seller, listingId)).statusCode).toBe(409);
      expect(await coloxs(seller)).toBe(100);
    });

    it('two buyers at the same moment: one wins, the other is told, no money is lost', async () => {
      const seller = await signUp('seller5');
      const buyers = await Promise.all([signUp('rival1', 100), signUp('rival2', 100), signUp('rival3', 100)]);
      const { itemId, listingId } = await sell(seller, 60);
      const results = await Promise.all(buyers.map((b) => buy(b, listingId)));
      expect(results.filter((r) => r.statusCode === 200)).toHaveLength(1);
      expect(results.filter((r) => r.statusCode === 409)).toHaveLength(2);
      const winner = buyers[results.findIndex((r) => r.statusCode === 200)]!;
      expect(await ownerOf(itemId)).toBe(winner.id);
      const balances = await Promise.all(buyers.map(coloxs));
      expect(balances.sort((x, y) => x - y)).toEqual([40, 100, 100]);
      expect(await coloxs(seller)).toBe(60 - 3);
    });

    it('crossed purchases between two players do not deadlock', async () => {
      const a = await signUp('cross1', 1000);
      const b = await signUp('cross2', 1000);
      const sellA = await sell(a, 20);
      const sellB = await sell(b, 30);
      const [ra, rb] = await Promise.all([buy(a, sellB.listingId), buy(b, sellA.listingId)]);
      expect([ra.statusCode, rb.statusCode]).toEqual([200, 200]);
      expect(await ownerOf(sellA.itemId)).toBe(b.id);
      expect(await ownerOf(sellB.itemId)).toBe(a.id);
    });

    it('is all or nothing when the server fails halfway', async () => {
      const seller = await signUp('seller6');
      const buyer = await signUp('buyer6', 100);
      const { itemId, listingId } = await sell(seller, 40);
      // Make the last write of the purchase fail: the ledger entries before it must not survive.
      await pool.query('ALTER TABLE market_sales ADD CONSTRAINT test_break CHECK (price <> 40) NOT VALID');
      try {
        const res = await buy(buyer, listingId);
        expect(res.statusCode).toBe(500);
      } finally {
        await pool.query('ALTER TABLE market_sales DROP CONSTRAINT test_break');
        }
      expect(await ownerOf(itemId)).toBe(seller.id);
      expect(await coloxs(buyer)).toBe(100);
      expect(await coloxs(seller)).toBe(0);
      expect((await pool.query('SELECT status FROM listings WHERE id = $1', [listingId])).rows[0].status).toBe('active');
      const history = await pool.query("SELECT count(*)::int AS n FROM item_owners WHERE item_id = $1 AND kind = 'sale'", [itemId]);
      expect(history.rows[0].n).toBe(0);
    });

    it('cannot be bought twice, nor after it was withdrawn', async () => {
      const seller = await signUp('seller7');
      const buyer = await signUp('buyer7', 500);
      const { listingId } = await sell(seller, 10);
      expect((await buy(buyer, listingId)).statusCode).toBe(200);
      expect((await buy(buyer, listingId)).statusCode).toBe(409);
      const second = await sell(seller, 10);
      await app.inject({ method: 'DELETE', url: `/api/market/listings/${second.listingId}`, cookies: as(seller) });
      expect((await buy(buyer, second.listingId)).statusCode).toBe(409);
    });

    it('ignores any price or amount sent by the client', async () => {
      const seller = await signUp('seller8');
      const buyer = await signUp('buyer8', 100);
      const { listingId } = await sell(seller, 80);
      const res = await app.inject({ method: 'POST', url: `/api/market/listings/${listingId}/buy`, payload: { price: 1, commission: 0 }, cookies: as(buyer) });
      expect(res.statusCode).toBe(200);
      expect(await coloxs(buyer)).toBe(20);
    });
  });

  describe('royalties', () => {
    it('adds up what a creator earned from resales of their creations, most resold first', async () => {
      const creator = await signUp('roy1');
      const first = await signUp('roy2', 1000);
      const second = await signUp('roy3', 1000);
      const itemA = await create(creator);
      const itemB = await create(creator);
      // The creator sells both for the first time (no royalty), then A is resold twice and B once.
      const sellTo = async (seller: Player, buyer: Player, itemId: string, price: number) => {
        const listing = (await list(seller, itemId, price)).json().id as string;
        expect((await buy(buyer, listing)).statusCode).toBe(200);
      };
      await sellTo(creator, first, itemA, 100);
      await sellTo(creator, first, itemB, 100);
      await sellTo(first, second, itemA, 200);
      await sellTo(second, first, itemA, 400);
      await sellTo(first, second, itemB, 100);
      const res = (await app.inject({ method: 'GET', url: '/api/market/royalties', cookies: as(creator) })).json();
      expect(res).toMatchObject({ resales: 3, earned: 10 + 20 + 5 });
      expect(res.top.map((t: { itemId: string; resales: number; earned: number }) => [t.itemId, t.resales, t.earned])).toEqual([
        [itemA, 2, 30],
        [itemB, 1, 5],
      ]);
      // Somebody who created nothing earns nothing.
      expect((await app.inject({ method: 'GET', url: '/api/market/royalties', cookies: as(first) })).json()).toMatchObject({ resales: 0, earned: 0, top: [] });
    });

    it('keeps paying a creator who has been banned', async () => {
      const creator = await signUp('roy4');
      const seller = await signUp('roy5', 100);
      const buyer = await signUp('roy6', 100);
      const staff = await signUp('roy7');
      const item = await create(creator);
      const l1 = (await list(creator, item, 50)).json().id as string;
      await buy(seller, l1);
      await pool.query("INSERT INTO sanctions (user_id, kind, reason, issued_by) VALUES ($1, 'ban', 'test', $2)", [creator.id, staff.id]);
      const l2 = (await list(seller, item, 100)).json().id as string;
      const before = await coloxs(creator);
      expect((await buy(buyer, l2)).json().royalty).toBe(5);
      expect(await coloxs(creator)).toBe(before + 5);
    });
  });

  describe('time, moderation and visibility', () => {
    it('an expired offer cannot be bought, disappears from the market and frees the item', async () => {
      const seller = await signUp('late1');
      const buyer = await signUp('late2', 100);
      const { itemId, listingId } = await sell(seller, 10);
      await pool.query("UPDATE listings SET expires_at = now() - interval '1 minute' WHERE id = $1", [listingId]);
      expect((await buy(buyer, listingId)).statusCode).toBe(409);
      expect((await browse(buyer)).listings.find((l) => l.id === listingId)).toBeUndefined();
      expect((await list(seller, itemId, 12)).statusCode).toBe(201);
    });

    it('an item hidden by moderation can be neither listed nor bought', async () => {
      const seller = await signUp('hidden1');
      const buyer = await signUp('hidden2', 100);
      const staff = await signUp('hidden3');
      const flagged = await create(seller);
      await pool.query("INSERT INTO item_moderation (item_id, state, decided_by) VALUES ($1, 'hidden', $2)", [flagged, staff.id]);
      expect((await list(seller, flagged, 10)).statusCode).toBe(409);

      const { itemId, listingId } = await sell(seller, 10);
      await pool.query("INSERT INTO item_moderation (item_id, state, decided_by) VALUES ($1, 'hidden', $2)", [itemId, staff.id]);
      expect((await buy(buyer, listingId)).statusCode).toBe(409);
      expect((await browse(buyer)).listings.find((l) => l.id === listingId)).toBeUndefined();
      // Its owner still sees their own offer.
      expect((await browse(seller, '?mine=1')).listings.find((l) => l.id === listingId)).toBeDefined();
    });

    it('a suspended seller’s offers are hidden and cannot be bought', async () => {
      const seller = await signUp('banned1');
      const buyer = await signUp('banned2', 100);
      const staff = await signUp('banned3');
      const { listingId } = await sell(seller, 10);
      await pool.query(
        "INSERT INTO sanctions (user_id, kind, reason, issued_by, expires_at) VALUES ($1, 'suspension', 'test', $2, now() + interval '1 day')",
        [seller.id, staff.id],
      );
      expect((await browse(buyer)).listings.find((l) => l.id === listingId)).toBeUndefined();
      expect((await buy(buyer, listingId)).statusCode).toBe(409);
    });

    it('anyone can see the sprite of an item on sale, and nobody can see it otherwise', async () => {
      const seller = await signUp('sprite1');
      const stranger = await signUp('sprite2');
      const item = await create(seller);
      const png = () => app.inject({ method: 'GET', url: `/api/items/${item}.png`, cookies: as(stranger) });
      expect((await png()).statusCode).toBe(404);
      await list(seller, item, 10);
      expect((await png()).statusCode).toBe(200);
    });

    it('does not show the history of an item the player cannot see', async () => {
      const seller = await signUp('hist1');
      const stranger = await signUp('hist2');
      const item = await create(seller);
      expect((await app.inject({ method: 'GET', url: `/api/items/${item}/history`, cookies: as(stranger) })).statusCode).toBe(404);
    });
  });

  describe('browsing', () => {
    it('searches, filters and sorts the offers', async () => {
      const a = await signUp('shelf1');
      const b = await signUp('shelf2');
      const viewer = await signUp('shelf3');
      const cheap = await sell(a, 5);
      const dear = await sell(b, 500);
      const mid = await sell(a, 50);
      const ids = (r: Awaited<ReturnType<typeof browse>>) => r.listings.map((l) => l.id).filter((id) => [cheap, dear, mid].some((s) => s.listingId === id));
      expect(ids(await browse(viewer, '?sort=price_asc'))).toEqual([cheap.listingId, mid.listingId, dear.listingId]);
      expect(ids(await browse(viewer, '?sort=price_desc'))).toEqual([dear.listingId, mid.listingId, cheap.listingId]);
      expect(ids(await browse(viewer, '?min=10&max=100'))).toEqual([mid.listingId]);
      const byCreator = await browse(viewer, '?creator=SHELF2');
      expect(byCreator.listings.map((l) => l.item.creator)).toEqual(['shelf2']);
      expect((await browse(viewer, '?q=lampe')).total).toBeGreaterThanOrEqual(3);
      expect((await browse(viewer, '?q=%25')).total).toBe(0);
      expect(ids(await browse(a, '?mine=1&sort=price_asc'))).toEqual([cheap.listingId, mid.listingId]);
      expect((await browse(viewer, '?mine=1')).listings).toEqual([]);
    });
  });

  it('keeps every balance equal to its ledger, and every commission accounted for', async () => {
    expect(await findColoxMismatches(pool)).toEqual([]);
    const { rows } = await pool.query<{ price: string; paid: string }>(
      `SELECT sum(price) AS price, sum(commission + royalty + seller_net) AS paid FROM market_sales`,
    );
    expect(rows[0]!.price).toBe(rows[0]!.paid);
    // The money the buyers paid minus the money credited is exactly the destroyed commissions.
    const burned = await pool.query<{ burned: string }>(
      `SELECT (SELECT coalesce(sum(-delta), 0) FROM colox_ledger WHERE kind = 'purchase')
            - (SELECT coalesce(sum(delta), 0) FROM colox_ledger WHERE kind IN ('sale', 'royalty')) AS burned`,
    );
    const commissions = await pool.query<{ c: string }>('SELECT coalesce(sum(commission), 0) AS c FROM market_sales');
    expect(burned.rows[0]!.burned).toBe(commissions.rows[0]!.c);
  });
});
