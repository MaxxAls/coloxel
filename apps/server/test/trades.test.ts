import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SEEDS } from '@coloxel/render';
import type { RecipeModel } from '../src/creations/model';
import { migrate, migrateDownAll } from '../src/db/migrate';
import { createPool } from '../src/db/pool';
import { buildServer } from '../src/index';
import type { Location } from '../src/realtime/where';

const url = process.env.DATABASE_URL ?? 'postgres://coloxel:coloxel@localhost:5432/coloxel';
const probe = createPool(url);
const available = await probe.query('SELECT 1').then(
  () => true,
  () => false,
);
await probe.end();

const model: RecipeModel = async () => JSON.stringify({ nom: 'Lampe test', parts: SEEDS[0]!.parts });

describe.skipIf(!available)('trades between players (PostgreSQL)', () => {
  let pool: pg.Pool;
  let app: ReturnType<typeof buildServer>;
  // Where each connected player is: the tests move players around by editing this map.
  const places = new Map<string, Location>();

  beforeAll(async () => {
    await migrateDownAll(url).catch(() => {});
    await migrate('up', url);
    pool = createPool(url);
    await pool.query('INSERT INTO apartments (id, floor, slot) SELECT 100 + n, 20 + n / 5, n % 5 FROM generate_series(1, 60) AS n');
    app = buildServer({ pool, model, challenges: false, locate: async (ids) => new Map([...places].filter(([id]) => ids.includes(id))) });
  });
  afterAll(async () => {
    await app?.close();
    await pool?.end();
  });

  async function signUp(nickname: string) {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { email: `${nickname}@test.dev`, password: 'motdepasse', nickname, birthDate: '1990-01-01' },
    });
    const id = res.json().user.id as string;
    await pool.query('DELETE FROM furniture WHERE owner_id = $1', [id]);
    places.set(id, { kind: 'hall' });
    return { id, sid: res.cookies.find((c) => c.name === 'coloxel_sid')!.value };
  }
  type Player = Awaited<ReturnType<typeof signUp>>;
  const as = (p: Player) => ({ coloxel_sid: p.sid });
  const create = async (p: Player) =>
    (await app.inject({ method: 'POST', url: '/api/creations', payload: { description: 'une lampe' }, cookies: as(p) })).json().item.id as string;
  const send = (p: Player, method: 'GET' | 'POST' | 'PUT' | 'DELETE', path: string, payload?: object) =>
    app.inject({ method, url: path, payload, cookies: as(p) });
  const start = (p: Player, nickname: string) => send(p, 'POST', '/api/trades', { nickname });
  const offer = (p: Player, tradeId: string, itemIds: string[]) => send(p, 'PUT', `/api/trades/${tradeId}/offer`, { itemIds });
  const accept = (p: Player, tradeId: string, version: number) => send(p, 'POST', `/api/trades/${tradeId}/accept`, { version });
  const confirm = (p: Player, tradeId: string, version: number) => send(p, 'POST', `/api/trades/${tradeId}/confirm`, { version });
  const current = async (p: Player) => (await send(p, 'GET', '/api/trades/current')).json().trade;
  const ownerOf = async (itemId: string) => (await pool.query<{ owner_id: string }>('SELECT owner_id FROM items WHERE id = $1', [itemId])).rows[0]!.owner_id;

  /** Two players with one creation each, in a trade where both put their creation on the table. */
  async function table(prefix: string) {
    const a = await signUp(`${prefix}a`);
    const b = await signUp(`${prefix}b`);
    const ia = await create(a);
    const ib = await create(b);
    const id = (await start(a, `${prefix}b`)).json().trade.id as string;
    await offer(a, id, [ia]);
    const v = (await offer(b, id, [ib])).json().trade.version as number;
    return { a, b, ia, ib, id, v };
  }

  it('asks for a session everywhere', async () => {
    for (const [method, path] of [
      ['GET', '/api/trades/current'],
      ['POST', '/api/trades'],
      ['PUT', '/api/trades/00000000-0000-4000-8000-000000000000/offer'],
      ['POST', '/api/trades/00000000-0000-4000-8000-000000000000/accept'],
      ['POST', '/api/trades/00000000-0000-4000-8000-000000000000/confirm'],
      ['DELETE', '/api/trades/00000000-0000-4000-8000-000000000000'],
    ] as const) {
      expect((await app.inject({ method, url: path, payload: {} })).statusCode, `${method} ${path}`).toBe(401);
    }
  });

  describe('starting', () => {
    it('needs both players in the same room', async () => {
      const a = await signUp('start1a');
      const b = await signUp('start1b');
      places.set(b.id, { kind: 'apartment', ownerId: a.id });
      expect((await start(a, 'start1b')).statusCode).toBe(409);
      places.set(a.id, { kind: 'apartment', ownerId: a.id });
      expect((await start(a, 'start1b')).statusCode).toBe(201);
    });

    it('refuses a player who is offline, oneself, an unknown name and a second trade', async () => {
      const a = await signUp('start2a');
      const b = await signUp('start2b');
      const c = await signUp('start2c');
      places.delete(b.id);
      expect((await start(a, 'start2b')).statusCode).toBe(409);
      places.set(b.id, { kind: 'hall' });
      expect((await start(a, 'start2a')).statusCode).toBe(400);
      expect((await start(a, 'nobody-here')).statusCode).toBe(404);
      expect((await start(a, 'start2b')).statusCode).toBe(201);
      expect((await start(a, 'start2c')).statusCode).toBe(409);
      expect((await start(c, 'start2b')).statusCode).toBe(409);
      expect((await start(b, 'start2c')).statusCode).toBe(409);
    });

    it('is visible to both players', async () => {
      const a = await signUp('start3a');
      const b = await signUp('start3b');
      await start(a, 'start3b');
      expect((await current(a)).partner).toBe('start3b');
      expect((await current(b)).partner).toBe('start3a');
    });
  });

  describe('the table', () => {
    it('takes only my own, free creations, up to the limit', async () => {
      const { a, b, ia, ib, id } = await table('tab1');
      expect((await offer(a, id, [ib])).statusCode).toBe(404);
      expect((await offer(a, id, ['not-an-id'])).statusCode).toBe(400);
      expect((await offer(a, id, Array.from({ length: 11 }, () => ia))).statusCode).toBe(400);
      const extra = await send(a, 'PUT', `/api/trades/${id}/offer`, { itemIds: [ia], to: b.id });
      expect(extra.statusCode).toBe(400);
    });

    it('refuses an item on sale, and an item already in another trade', async () => {
      const a = await signUp('tab2a');
      const b = await signUp('tab2b');
      const c = await signUp('tab2c');
      const d = await signUp('tab2d');
      const listed = await create(a);
      await send(a, 'POST', '/api/market/listings', { itemId: listed, price: 10 });
      const id = (await start(a, 'tab2b')).json().trade.id as string;
      expect((await offer(a, id, [listed])).statusCode).toBe(409);

      const busy = await create(c);
      const t2 = (await start(c, 'tab2d')).json().trade.id as string;
      expect((await offer(c, t2, [busy])).statusCode).toBe(200);
      // c's item is on c's table: it cannot go on the market, nor be offered anywhere else.
      expect((await send(c, 'POST', '/api/market/listings', { itemId: busy, price: 10 })).statusCode).toBe(409);
      void d;
      void b;
    });

    it('refuses an item hidden by moderation', async () => {
      const a = await signUp('tab3a');
      const staff = await signUp('tab3s');
      await signUp('tab3b');
      const item = await create(a);
      await pool.query("INSERT INTO item_moderation (item_id, state, decided_by) VALUES ($1, 'hidden', $2)", [item, staff.id]);
      const id = (await start(a, 'tab3b')).json().trade.id as string;
      expect((await offer(a, id, [item])).statusCode).toBe(409);
    });

    it('changing an offer clears every acceptance', async () => {
      const { a, b, ia, id, v } = await table('tab4');
      await accept(a, id, v);
      await accept(b, id, v);
      expect((await current(a)).stage).toBe('confirm');
      const changed = await offer(a, id, [ia]);
      expect(changed.json().trade.version).toBe(v + 1);
      const view = await current(b);
      expect(view.stage).toBe('offer');
      expect(view.mine.accepted).toBe(false);
      expect(view.theirs.accepted).toBe(false);
    });
  });

  describe('agreeing', () => {
    it('swaps the items after two acceptances and two confirmations, and writes the history', async () => {
      const { a, b, ia, ib, id, v } = await table('swap1');
      expect((await accept(a, id, v)).statusCode).toBe(200);
      // One acceptance is not enough to confirm.
      expect((await confirm(a, id, v)).statusCode).toBe(409);
      expect((await accept(b, id, v)).statusCode).toBe(200);
      const first = await confirm(a, id, v);
      expect(first.json().done).toBe(false);
      expect(await ownerOf(ia)).toBe(a.id);
      const last = await confirm(b, id, v);
      expect(last.json()).toEqual({ trade: null, done: true });
      expect(await ownerOf(ia)).toBe(b.id);
      expect(await ownerOf(ib)).toBe(a.id);
      expect(await current(a)).toBeNull();

      const history = (await send(b, 'GET', `/api/items/${ia}/history`)).json().history as { kind: string; from: string | null; to: string }[];
      expect(history.map((h) => [h.kind, h.from, h.to])).toEqual([
        ['creation', null, 'swap1a'],
        ['trade', 'swap1a', 'swap1b'],
      ]);
      const live = await pool.query('SELECT 1 FROM trade_offers WHERE live AND trade_id = $1', [id]);
      expect(live.rowCount).toBe(0);
    });

    it('takes the traded items off the walls', async () => {
      const { a, b, ia, id, v } = await table('swap2');
      await send(a, 'PUT', '/api/placements', { itemId: ia, i: 3, j: 3 });
      for (const p of [a, b]) await accept(p, id, v);
      for (const p of [a, b]) await confirm(p, id, v);
      expect((await pool.query('SELECT 1 FROM placements WHERE item_id = $1', [ia])).rowCount).toBe(0);
    });

    it('an acceptance on an old version counts for nothing', async () => {
      const { a, id, v } = await table('swap3');
      expect((await accept(a, id, v - 1)).statusCode).toBe(409);
      expect((await confirm(a, id, v - 1)).statusCode).toBe(409);
      expect((await send(a, 'POST', `/api/trades/${id}/accept`, { version: 'x' })).statusCode).toBe(400);
    });

    it('refuses to confirm an empty table', async () => {
      const a = await signUp('swap4a');
      await signUp('swap4b');
      const id = (await start(a, 'swap4b')).json().trade.id as string;
      expect((await accept(a, id, 1)).statusCode).toBe(409);
    });

    it('a stranger cannot touch somebody else’s trade', async () => {
      const { id, v } = await table('swap5');
      const eve = await signUp('swap5e');
      expect((await offer(eve, id, [])).statusCode).toBe(404);
      expect((await accept(eve, id, v)).statusCode).toBe(404);
      expect((await confirm(eve, id, v)).statusCode).toBe(404);
      expect((await send(eve, 'DELETE', `/api/trades/${id}`)).statusCode).toBe(404);
    });

    it('both confirming at the same moment swaps exactly once', async () => {
      const { a, b, ia, ib, id, v } = await table('swap6');
      for (const p of [a, b]) await accept(p, id, v);
      await Promise.all([confirm(a, id, v), confirm(b, id, v)]);
      expect(await ownerOf(ia)).toBe(b.id);
      expect(await ownerOf(ib)).toBe(a.id);
      const rows = await pool.query("SELECT count(*)::int AS n FROM item_owners WHERE kind = 'trade' AND item_id = ANY($1::uuid[])", [[ia, ib]]);
      expect(rows.rows[0].n).toBe(2);
    });

    it('cancels everything when an item left in the meantime, and nothing moves', async () => {
      const { a, b, ia, ib, id, v } = await table('swap7');
      for (const p of [a, b]) await accept(p, id, v);
      await confirm(a, id, v);
      // Somebody gets ia moved behind the table's back (here directly, as a bug or a race would).
      await pool.query('UPDATE items SET owner_id = $2 WHERE id = $1', [ia, b.id]);
      const res = await confirm(b, id, v);
      expect(res.statusCode).toBe(409);
      expect(await ownerOf(ia)).toBe(b.id);
      expect(await ownerOf(ib)).toBe(b.id);
      expect((await pool.query('SELECT status FROM trades WHERE id = $1', [id])).rows[0].status).toBe('cancelled');
    });

    it('cancelling frees the items, and either side can do it', async () => {
      const { a, b, ia, id } = await table('swap8');
      expect((await send(b, 'DELETE', `/api/trades/${id}`)).statusCode).toBe(204);
      expect(await current(a)).toBeNull();
      expect((await send(a, 'POST', '/api/market/listings', { itemId: ia, price: 5 })).statusCode).toBe(201);
    });

    it('closes a quiet trade after a while and frees its items', async () => {
      const { a, ia, id } = await table('swap9');
      await pool.query("UPDATE trades SET updated_at = now() - interval '20 minutes' WHERE id = $1", [id]);
      expect(await current(a)).toBeNull();
      expect((await send(a, 'POST', '/api/market/listings', { itemId: ia, price: 5 })).statusCode).toBe(201);
    });

    it('a player under a ban or suspension cannot be traded with', async () => {
      const a = await signUp('ban1a');
      const b = await signUp('ban1b');
      const staff = await signUp('ban1s');
      await pool.query("INSERT INTO sanctions (user_id, kind, reason, issued_by) VALUES ($1, 'ban', 'test', $2)", [b.id, staff.id]);
      expect((await start(a, 'ban1b')).statusCode).toBe(409);
    });
  });
});
