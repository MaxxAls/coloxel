import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SEEDS } from '@coloxel/render';
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

const model: RecipeModel = async () => JSON.stringify({ nom: 'Lampe test', parts: SEEDS[0]!.parts });

interface Apartment {
  id: number;
  floor: number;
  slot: number;
  name: string | null;
  owner: { id: string; nickname: string } | null;
  mine: boolean;
  open: boolean;
  visitors: number;
}

describe.skipIf(!available)('building (PostgreSQL)', () => {
  let pool: pg.Pool;
  let app: ReturnType<typeof buildServer>;
  let present = new Map<string, number>();
  let hallCount = 0;

  beforeAll(async () => {
    await migrateDownAll(url).catch(() => {});
    await migrate('up', url);
    pool = createPool(url);
    app = buildServer({ pool, model, occupancy: async () => ({ apartments: present, hall: hallCount }) });
  });
  afterAll(async () => {
    await app?.close();
    await pool?.end();
  });

  const register = (nickname: string) =>
    app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { email: `${nickname}@test.dev`, password: 'motdepasse', nickname, birthDate: '1990-01-01' },
    });
  async function signUp(nickname: string) {
    const res = await register(nickname);
    return { id: res.json().user.id as string, sid: res.cookies.find((c) => c.name === 'coloxel_sid')!.value };
  }
  const as = (sid: string) => ({ coloxel_sid: sid });
  const building = async (sid: string) =>
    (await app.inject({ method: 'GET', url: '/api/building', cookies: as(sid) })).json().apartments as Apartment[];

  it('has 30 apartments on 6 floors of 5, none taken at first', async () => {
    const { rows } = await pool.query('SELECT floor, count(*)::int AS n FROM apartments GROUP BY floor ORDER BY floor');
    expect(rows).toEqual([1, 2, 3, 4, 5, 6].map((floor) => ({ floor, n: 5 })));
    expect((await pool.query('SELECT 1 FROM apartments WHERE owner_id IS NOT NULL')).rowCount).toBe(0);
  });

  it('requires a session', async () => {
    expect((await app.inject({ method: 'GET', url: '/api/building' })).statusCode).toBe(401);
    const id = '00000000-0000-4000-8000-000000000000';
    expect((await app.inject({ method: 'GET', url: `/api/apartments/${id}` })).statusCode).toBe(401);
  });

  it('moves each new player into the lowest free apartment', async () => {
    const alice = await signUp('alice');
    const bob = await signUp('bob');
    const list = await building(alice.sid);
    expect(list).toHaveLength(30);
    const byOwner = (id: string) => list.find((a) => a.owner?.id === id)!;
    expect(byOwner(alice.id)).toMatchObject({ id: 1, floor: 1, slot: 0, mine: true, open: true });
    expect(byOwner(bob.id)).toMatchObject({ id: 2, floor: 1, slot: 1, mine: false, open: false });
    // Top floor first, as the building is drawn.
    expect(list[0]!.floor).toBe(6);
    expect(list.at(-1)).toMatchObject({ floor: 1, slot: 4 });
  });

  it('gives simultaneous sign-ups different apartments', async () => {
    const names = Array.from({ length: 8 }, (_, k) => `racer${k}`);
    const results = await Promise.all(names.map((n) => register(n)));
    expect(results.map((r) => r.statusCode)).toEqual(Array(8).fill(201));
    const { rows } = await pool.query('SELECT count(DISTINCT id)::int AS n FROM apartments WHERE owner_id IS NOT NULL');
    expect(rows[0].n).toBe(10);
  });

  it('shows who is inside and opens apartments according to their access', async () => {
    const carol = await signUp('carol');
    const dave = await signUp('dave');
    await pool.query("UPDATE users SET apartment_access = 'building' WHERE id = $1", [dave.id]);
    present = new Map([[dave.id, 3]]);
    const list = await building(carol.sid);
    const daves = list.find((a) => a.owner?.id === dave.id)!;
    expect(daves).toMatchObject({ open: true, mine: false, visitors: 3 });
    expect(list.find((a) => a.owner?.id === carol.id)!.visitors).toBe(0);
    present = new Map();
  });

  it('lists what is placed in an apartment only to those who may enter', async () => {
    const erin = await signUp('erin');
    const frank = await signUp('frank');
    const created = await app.inject({
      method: 'POST',
      url: '/api/creations',
      payload: { description: 'une lampe' },
      cookies: as(erin.sid),
    });
    const itemId = created.json().item.id as string;
    await app.inject({
      method: 'PUT',
      url: '/api/placements',
      payload: { itemId, i: 2, j: 3 },
      cookies: as(erin.sid),
    });
    const visit = (sid: string, id: string) =>
      app.inject({ method: 'GET', url: `/api/apartments/${id}`, cookies: as(sid) });

    expect((await visit(frank.sid, erin.id)).statusCode).toBe(404);
    expect((await visit(erin.sid, erin.id)).json().items).toHaveLength(1);

    await pool.query("UPDATE users SET apartment_access = 'building' WHERE id = $1", [erin.id]);
    const res = await visit(frank.sid, erin.id);
    expect(res.statusCode).toBe(200);
    expect(res.json().owner).toEqual({ id: erin.id, nickname: 'erin' });
    expect(res.json().items).toEqual([
      expect.objectContaining({ id: itemId, name: 'Lampe test', creator: 'erin', placement: { i: 2, j: 3, rot: 0, w: 1, h: 1, z: 0 } }),
    ]);
    expect((await visit(frank.sid, '00000000-0000-4000-8000-000000000000')).statusCode).toBe(404);
    expect((await visit(frank.sid, 'pas-un-uuid')).statusCode).toBe(404);
  });

  it('refuses sign-ups, creating no account, once the building is full', async () => {
    const taken = (await pool.query('SELECT count(*)::int AS n FROM apartments WHERE owner_id IS NOT NULL')).rows[0].n;
    for (let k = taken; k < 30; k++) expect((await register(`filler${k}`)).statusCode).toBe(201);

    const before = (await pool.query('SELECT count(*)::int AS n FROM users')).rows[0].n;
    const res = await register('toolate');
    expect(res.statusCode).toBe(503);
    expect(res.json().error).toMatch(/complet/);
    expect((await pool.query('SELECT count(*)::int AS n FROM users')).rows[0].n).toBe(before);
    expect((await pool.query("SELECT 1 FROM users WHERE nickname = 'toolate'")).rowCount).toBe(0);
  });
});
