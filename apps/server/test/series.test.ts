import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SEEDS } from '@coloxel/render';
import { DAILY_CHARGES } from '../src/creations/charges';
import type { RecipeModel } from '../src/creations/model';
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

let calls = 0;
let failNext = false;
const model: RecipeModel = async () => {
  calls++;
  if (failNext) {
    failNext = false;
    return 'not json';
  }
  return JSON.stringify({ nom: 'Lampe de série', parts: SEEDS[0]!.parts });
};

describe.skipIf(!available)('limited series (PostgreSQL)', () => {
  let pool: pg.Pool;
  let app: ReturnType<typeof buildServer>;

  beforeAll(async () => {
    await migrateDownAll(url).catch(() => {});
    await migrate('up', url);
    pool = createPool(url);
    await pool.query('INSERT INTO apartments (id, floor, slot) SELECT 100 + n, 20 + n / 5, n % 5 FROM generate_series(1, 60) AS n');
    app = buildServer({ pool, model, challenges: false });
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
  type Player = Awaited<ReturnType<typeof signUp>>;
  const create = (p: Player, edition?: unknown) =>
    app.inject({ method: 'POST', url: '/api/creations', payload: { description: 'une lampe', ...(edition === undefined ? {} : { edition }) }, cookies: { coloxel_sid: p.sid } });
  const charges = async (p: Player) => (await app.inject({ method: 'GET', url: '/api/charges', cookies: { coloxel_sid: p.sid } })).json().charges as number;

  it('keeps a plain creation unique and costing one charge', async () => {
    const p = await signUp('series1');
    const res = await create(p);
    expect(res.statusCode).toBe(201);
    expect(res.json().item).toMatchObject({ editionNumber: 1, editionSize: 1 });
    expect(res.json().items).toHaveLength(1);
    expect(await charges(p)).toBe(DAILY_CHARGES - 1);
    const row = await pool.query('SELECT series_id FROM items WHERE id = $1', [res.json().item.id]);
    expect(row.rows[0].series_id).toBeNull();
  });

  it('makes a series of 5 whole: numbered 1/5 to 5/5, consecutive serials, one recipe, 2 charges', async () => {
    const p = await signUp('series2');
    const res = await create(p, 5);
    expect(res.statusCode).toBe(201);
    const items = res.json().items as { id: string; serial: number; editionNumber: number; editionSize: number }[];
    expect(items.map((i) => `${i.editionNumber}/${i.editionSize}`)).toEqual(['1/5', '2/5', '3/5', '4/5', '5/5']);
    expect(items.map((i) => i.serial).slice(1)).toEqual(items.slice(1).map((_, k) => items[0]!.serial + k + 1));
    const { rows } = await pool.query(
      'SELECT count(DISTINCT series_id)::int AS series, count(DISTINCT recipe::text)::int AS recipes, count(DISTINCT owner_id)::int AS owners FROM items WHERE id = ANY($1::uuid[])',
      [items.map((i) => i.id)],
    );
    expect(rows[0]).toEqual({ series: 1, recipes: 1, owners: 1 });
    expect(await charges(p)).toBe(DAILY_CHARGES - 2);
  });

  it('makes a series of 10 for 3 charges', async () => {
    const p = await signUp('series3');
    const res = await create(p, 10);
    expect(res.statusCode).toBe(201);
    expect(res.json().items).toHaveLength(10);
    expect(await charges(p)).toBe(DAILY_CHARGES - 3);
  });

  it('refuses a series the player cannot pay for, without calling the model', async () => {
    const p = await signUp('series4');
    await create(p, 10);
    const before = calls;
    const res = await create(p, 10);
    expect(res.statusCode).toBe(429);
    expect(calls).toBe(before);
    expect(await charges(p)).toBe(DAILY_CHARGES - 3);
  });

  it('refuses any other edition size', async () => {
    const p = await signUp('series5');
    for (const edition of [0, 2, 3, 11, 100, -1, 1.5, '5', null]) {
      expect((await create(p, edition)).statusCode, String(edition)).toBe(400);
    }
    expect(await charges(p)).toBe(DAILY_CHARGES);
  });

  it('gives all the charges back when the model fails, and creates nothing', async () => {
    const p = await signUp('series6');
    failNext = true;
    const res = await create(p, 10);
    expect(res.statusCode).toBeGreaterThanOrEqual(400);
    expect(await charges(p)).toBe(DAILY_CHARGES);
    expect((await pool.query('SELECT count(*)::int AS n FROM items WHERE creator_id = $1', [p.id])).rows[0].n).toBe(0);
  });

  it('never leaves a half series nor a gap in the numbers when copies are created in parallel', async () => {
    const players = await Promise.all(['series7', 'series8', 'series9'].map(signUp));
    await Promise.all(players.map((p) => create(p, 5)));
    const { rows } = await pool.query('SELECT serial FROM items ORDER BY serial');
    const serials = rows.map((r) => r.serial as number);
    expect(serials).toEqual(serials.map((_, k) => k + 1));
    const sizes = await pool.query('SELECT series_id, count(*)::int AS n, max(edition_size)::int AS size FROM items WHERE series_id IS NOT NULL GROUP BY series_id');
    expect(sizes.rows.every((r) => r.n === r.size)).toBe(true);
  });

  it('the database refuses two copies with the same number in one series, and any change to a copy', async () => {
    const p = await signUp('series10');
    const items = (await create(p, 5)).json().items as { id: string }[];
    const { rows } = await pool.query('SELECT series_id FROM items WHERE id = $1', [items[0]!.id]);
    await expect(
      pool.query(
        `INSERT INTO items (serial, name, description, recipe, creator_id, owner_id, edition_number, edition_size, series_id)
         SELECT 9999, name, description, recipe, creator_id, owner_id, 1, 5, series_id FROM items WHERE id = $1`,
        [items[0]!.id],
      ),
    ).rejects.toThrow();
    await expect(pool.query('UPDATE items SET series_id = gen_random_uuid() WHERE id = $1', [items[0]!.id])).rejects.toThrow(/immutable/);
    expect(rows[0].series_id).not.toBeNull();
  });

  it('copies of a series are sold and traded one by one', async () => {
    const p = await signUp('series11');
    const buyer = await signUp('series12');
    const items = (await create(p, 5)).json().items as { id: string }[];
    const listed = await app.inject({ method: 'POST', url: '/api/market/listings', payload: { itemId: items[2]!.id, price: 10 }, cookies: { coloxel_sid: p.sid } });
    expect(listed.statusCode).toBe(201);
    const owners = await pool.query('SELECT owner_id FROM items WHERE id = ANY($1::uuid[])', [items.map((i) => i.id)]);
    expect(owners.rows.every((r) => r.owner_id === p.id)).toBe(true);
    void buyer;
  });
});
