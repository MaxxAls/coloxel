import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CATALOGUE, DEFAULT_LOOK, LOOK_ITEMS } from '@coloxel/render';
import { migrate, migrateDownAll } from '../src/db/migrate';
import { createPool } from '../src/db/pool';
import { buildServer } from '../src/index';

const url = process.env.DATABASE_URL ?? 'postgres://coloxel:coloxel@localhost:5432/coloxel';
const probe = createPool(url);
const available = await probe.query('SELECT 1').then(
  () => true,
  () => false,
);
await probe.end();

const priced = CATALOGUE.filter((e) => e.price > 0);

describe.skipIf(!available)('wallet, wardrobe, shop and companions (PostgreSQL)', () => {
  let pool: pg.Pool;
  let app: ReturnType<typeof buildServer>;

  beforeAll(async () => {
    await migrateDownAll(url).catch(() => {});
    await migrate('up', url);
    pool = createPool(url);
    // Exact balances are checked here: challenges (which also pay Pixels) have their own tests.
    app = buildServer({ pool, challenges: false });
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
    return { id: res.json().user.id as string, sid: res.cookies.find((c) => c.name === 'coloxel_sid')!.value };
  }
  const as = (sid: string) => ({ coloxel_sid: sid });
  const get = (sid: string, path: string) => app.inject({ method: 'GET', url: path, cookies: as(sid) });
  const send = (sid: string, method: 'POST' | 'PUT' | 'PATCH' | 'DELETE', path: string, payload?: object) =>
    app.inject({ method, url: path, payload, cookies: as(sid) });
  const wallet = async (sid: string) => (await get(sid, '/api/wallet')).json() as { pixels: number; dailyAvailable: boolean };
  const topUp = (id: string, pixels: number) => pool.query('UPDATE users SET pixels = $2 WHERE id = $1', [id, pixels]);

  it('asks for a session everywhere', async () => {
    for (const [method, path] of [
      ['GET', '/api/wallet'],
      ['POST', '/api/wallet/daily'],
      ['POST', '/api/wallet/redeem'],
      ['GET', '/api/me/look'],
      ['PUT', '/api/me/look'],
      ['POST', '/api/shop/buy'],
      ['GET', '/api/pets'],
      ['PUT', '/api/pets/active'],
    ] as const) {
      expect((await app.inject({ method, url: path, payload: {} })).statusCode, `${method} ${path}`).toBe(401);
    }
  });

  describe('Pixels', () => {
    it('starts with a welcome grant that the ledger explains', async () => {
      const { id, sid } = await signUp('wallet1');
      expect(await wallet(sid)).toMatchObject({ pixels: 100, dailyAvailable: true });
      const { rows } = await pool.query('SELECT delta, reason FROM pixel_ledger WHERE user_id = $1', [id]);
      expect(rows).toEqual([{ delta: 100, reason: 'Bienvenue' }]);
    });

    it('gives the daily reward once a day, even when asked in parallel', async () => {
      const { sid } = await signUp('daily1');
      const answers = await Promise.all(Array.from({ length: 5 }, () => send(sid, 'POST', '/api/wallet/daily')));
      expect(answers.filter((r) => r.statusCode === 200)).toHaveLength(1);
      expect(answers.filter((r) => r.statusCode === 409)).toHaveLength(4);
      expect(await wallet(sid)).toEqual(expect.objectContaining({ pixels: 150, dailyAvailable: false }));
    });

    it('redeems a code once per player, whatever its case, and refuses unknown or expired ones', async () => {
      const { sid } = await signUp('redeem1');
      expect((await send(sid, 'POST', '/api/wallet/redeem', { code: 'nimportequoi' })).statusCode).toBe(404);
      expect((await send(sid, 'POST', '/api/wallet/redeem', { code: 'x' })).statusCode).toBe(400);
      const ok = await send(sid, 'POST', '/api/wallet/redeem', { code: ' bienvenue ' });
      expect(ok.statusCode).toBe(200);
      expect(ok.json()).toEqual({ pixels: 200, gained: 100 });
      expect((await send(sid, 'POST', '/api/wallet/redeem', { code: 'BIENVENUE' })).statusCode).toBe(409);
      await pool.query("INSERT INTO redeem_codes (code, pixels, expires_at) VALUES ('VIEUX', 500, now() - interval '1 day')");
      expect((await send(sid, 'POST', '/api/wallet/redeem', { code: 'VIEUX' })).statusCode).toBe(404);
      expect((await wallet(sid)).pixels).toBe(200);
      // Another player may use the same code once too.
      const other = await signUp('redeem2');
      expect((await send(other.sid, 'POST', '/api/wallet/redeem', { code: 'BIENVENUE' })).statusCode).toBe(200);
    });

    it('never lets the balance go below zero, and keeps the ledger equal to the balance', async () => {
      const { id, sid } = await signUp('ledger1');
      await topUp(id, 100);
      // Six different orders worth well over 100 Pixels, all at once.
      const orders = [
        { slot: 'hair', piece: 5 },
        { slot: 'hair', piece: 6 },
        { slot: 'hair', piece: 10 },
        { slot: 'hat', piece: 6 },
        { slot: 'hat', piece: 8 },
        { slot: 'top', piece: 7 },
      ];
      const answers = await Promise.all(orders.map((o) => send(sid, 'POST', '/api/shop/buy', { kind: 'clothing', ...o })));
      const bought = answers.filter((r) => r.statusCode === 201).length;
      expect(answers.every((r) => r.statusCode === 201 || r.statusCode === 402)).toBe(true);
      expect(bought).toBeGreaterThan(0);
      expect(bought).toBeLessThan(orders.length);
      const { pixels } = await wallet(sid);
      expect(pixels).toBeGreaterThanOrEqual(0);
      const owned = (await pool.query('SELECT count(*)::int AS n FROM wardrobe WHERE user_id = $1', [id])).rows[0].n;
      expect(owned).toBe(bought);
      const ledger = (await pool.query('SELECT sum(delta)::int AS total FROM pixel_ledger WHERE user_id = $1', [id])).rows[0].total;
      expect(ledger).toBe(pixels);
    });
  });

  describe('wardrobe and look', () => {
    it('starts with a look made of free pieces, and saves a new one made of owned pieces', async () => {
      const { sid } = await signUp('look1');
      const start = (await get(sid, '/api/me/look')).json();
      expect(start.owned.hat).toEqual([]);
      const free = { ...start.look, hair: 9, top: 1, topColor: 3, glasses: 1 };
      const saved = await send(sid, 'PUT', '/api/me/look', free);
      expect(saved.statusCode).toBe(200);
      expect((await get(sid, '/api/me/look')).json().look).toEqual(free);
    });

    it('refuses a look that wears something not owned, and anything malformed', async () => {
      const { sid } = await signUp('look2');
      const crown = await send(sid, 'PUT', '/api/me/look', { ...DEFAULT_LOOK, hat: 3 });
      expect(crown.statusCode).toBe(403);
      expect(crown.json().error).toContain(LOOK_ITEMS.hat[3]!.name);
      for (const body of [{}, { ...DEFAULT_LOOK, skin: 99 }, { ...DEFAULT_LOOK, name: 'x' }, { ...DEFAULT_LOOK, hair: '1' }]) {
        expect((await send(sid, 'PUT', '/api/me/look', body)).statusCode).toBe(400);
      }
      expect((await get(sid, '/api/me/look')).json().look).not.toMatchObject({ hat: 3 });
    });

    it('lets a player wear a piece once bought, and not twice-buy it; free pieces cannot be bought', async () => {
      const { sid } = await signUp('shop1');
      const price = LOOK_ITEMS.hat[6]!.price;
      expect((await send(sid, 'POST', '/api/shop/buy', { kind: 'clothing', slot: 'hat', piece: 6 })).statusCode).toBe(201);
      expect((await wallet(sid)).pixels).toBe(100 - price);
      expect((await send(sid, 'POST', '/api/shop/buy', { kind: 'clothing', slot: 'hat', piece: 6 })).statusCode).toBe(409);
      expect((await wallet(sid)).pixels).toBe(100 - price);
      expect((await send(sid, 'POST', '/api/shop/buy', { kind: 'clothing', slot: 'top', piece: 0 })).statusCode).toBe(400);
      expect((await send(sid, 'PUT', '/api/me/look', { ...DEFAULT_LOOK, hat: 6, hatColor: 9 })).statusCode).toBe(200);
      expect((await get(sid, '/api/me/look')).json().owned.hat).toEqual([6]);
    });

    it('does not let one player wear what another bought', async () => {
      const a = await signUp('shopa');
      const b = await signUp('shopb');
      await send(a.sid, 'POST', '/api/shop/buy', { kind: 'clothing', slot: 'extra', piece: 5 });
      expect((await send(b.sid, 'PUT', '/api/me/look', { ...DEFAULT_LOOK, extra: 5 })).statusCode).toBe(403);
    });
  });

  describe('buying furniture', () => {
    it('charges the catalogue price, never a price sent by the client', async () => {
      const { id, sid } = await signUp('furn1');
      const piece = priced.find((e) => e.price <= 60)!;
      const res = await send(sid, 'POST', '/api/shop/buy', { kind: 'furniture', key: piece.key, price: 0 });
      expect(res.statusCode).toBe(400);
      const ok = await send(sid, 'POST', '/api/shop/buy', { kind: 'furniture', key: piece.key });
      expect(ok.statusCode).toBe(201);
      expect(ok.json().pixels).toBe(100 - piece.price);
      const { rows } = await pool.query('SELECT catalogue_key FROM furniture WHERE owner_id = $1 AND catalogue_key = $2', [id, piece.key]);
      expect(rows).toHaveLength(1);
    });

    it('creates nothing when the player cannot pay, and refuses priced pieces on the free route', async () => {
      const { id, sid } = await signUp('furn2');
      const expensive = priced.reduce((a, b) => (a.price > b.price ? a : b));
      const before = (await pool.query('SELECT count(*)::int AS n FROM furniture WHERE owner_id = $1', [id])).rows[0].n;
      const res = await send(sid, 'POST', '/api/shop/buy', { kind: 'furniture', key: expensive.key });
      expect(res.statusCode).toBe(402);
      expect((await pool.query('SELECT count(*)::int AS n FROM furniture WHERE owner_id = $1', [id])).rows[0].n).toBe(before);
      expect((await wallet(sid)).pixels).toBe(100);
      expect((await send(sid, 'POST', '/api/furniture', { key: expensive.key })).statusCode).toBe(402);
      expect((await send(sid, 'POST', '/api/shop/buy', { kind: 'furniture', key: 'licorne' })).statusCode).toBe(404);
    });

    it('keeps the base furniture free', async () => {
      const { sid } = await signUp('furn3');
      const free = CATALOGUE.find((e) => e.price === 0)!;
      const res = await send(sid, 'POST', '/api/shop/buy', { kind: 'furniture', key: free.key });
      expect(res.statusCode).toBe(201);
      expect(res.json().pixels).toBeNull();
      expect((await wallet(sid)).pixels).toBe(100);
    });
  });

  describe('companions', () => {
    const adopt = (sid: string, body: object = {}) =>
      send(sid, 'POST', '/api/shop/buy', { kind: 'pet', species: 'chat', color: 1, name: 'Minou', ...body });

    it('adopts a companion, which comes along at once, and charges its price', async () => {
      const { id, sid } = await signUp('pet1');
      await topUp(id, 1000);
      const res = await adopt(sid);
      expect(res.statusCode).toBe(201);
      expect(res.json().pixels).toBe(850);
      const list = (await get(sid, '/api/pets')).json().pets;
      expect(list).toEqual([expect.objectContaining({ species: 'chat', color: 1, name: 'Minou', active: true })]);
    });

    it('refuses unknown species, bad colours, filtered names and a fourth companion', async () => {
      const { id, sid } = await signUp('pet2');
      await topUp(id, 5000);
      expect((await adopt(sid, { species: 'licorne' })).statusCode).toBe(404);
      expect((await adopt(sid, { color: 9 })).statusCode).toBe(404);
      expect((await adopt(sid, { name: 'écris-moi sur insta' })).statusCode).toBe(400);
      expect((await adopt(sid, { name: '   ' })).statusCode).toBe(400);
      expect((await get(sid, '/api/pets')).json().pets).toHaveLength(0);
      for (const name of ['A', 'B', 'C']) expect((await adopt(sid, { name })).statusCode).toBe(201);
      expect((await adopt(sid, { name: 'D' })).statusCode).toBe(409);
      expect((await wallet(sid)).pixels).toBe(5000 - 3 * 150);
    });

    it('does not adopt past the limit when asked in parallel', async () => {
      const { id, sid } = await signUp('pet3');
      await topUp(id, 5000);
      await Promise.all(Array.from({ length: 6 }, (_, k) => adopt(sid, { name: `P${k}` })));
      expect((await get(sid, '/api/pets')).json().pets).toHaveLength(3);
      expect((await wallet(sid)).pixels).toBe(5000 - 3 * 150);
    });

    it('chooses who comes along, renames with the same filter as chat, and lets one go', async () => {
      const { id, sid } = await signUp('pet4');
      await topUp(id, 1000);
      const first = (await adopt(sid, { name: 'Un' })).json().pet.id as string;
      const second = (await adopt(sid, { name: 'Deux', species: 'lapin', color: 0 })).json().pet.id as string;
      expect((await send(sid, 'PUT', '/api/pets/active', { id: second })).json().pets.find((p: { id: string }) => p.id === second).active).toBe(true);
      expect((await send(sid, 'PUT', '/api/pets/active', { id: null })).json().pets.some((p: { active: boolean }) => p.active)).toBe(false);
      expect((await send(sid, 'PATCH', `/api/pets/${first}`, { name: 'Nouveau' })).statusCode).toBe(200);
      expect((await send(sid, 'PATCH', `/api/pets/${first}`, { name: 'www.exemple.com' })).statusCode).toBe(400);
      expect((await send(sid, 'DELETE', `/api/pets/${first}`)).statusCode).toBe(200);
      expect((await get(sid, '/api/pets')).json().pets).toHaveLength(1);
    });

    it('keeps companions private to their owner', async () => {
      const a = await signUp('pet5a');
      const b = await signUp('pet5b');
      await topUp(a.id, 1000);
      const pet = (await adopt(a.sid)).json().pet.id as string;
      expect((await send(b.sid, 'PUT', '/api/pets/active', { id: pet })).statusCode).toBe(404);
      expect((await send(b.sid, 'PATCH', `/api/pets/${pet}`, { name: 'Pris' })).statusCode).toBe(404);
      expect((await send(b.sid, 'DELETE', `/api/pets/${pet}`)).statusCode).toBe(404);
      expect((await send(b.sid, 'PUT', '/api/pets/active', { id: 'pas-un-uuid' })).statusCode).toBe(404);
      expect((await get(a.sid, '/api/pets')).json().pets).toHaveLength(1);
    });
  });
});
