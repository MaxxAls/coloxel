import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DEFAULT_LAYOUT, LAYOUT_PRESETS, N } from '@coloxel/world';
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

const model: RecipeModel = async () => '{}';

describe.skipIf(!available)('apartment layouts (PostgreSQL)', () => {
  let pool: pg.Pool;
  let app: ReturnType<typeof buildServer>;

  beforeAll(async () => {
    await migrateDownAll(url).catch(() => {});
    await migrate('up', url);
    pool = createPool(url);
    app = buildServer({ pool, model });
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
  const put = (sid: string, layout: unknown) =>
    app.inject({ method: 'PUT', url: '/api/apartment', payload: { layout } as object, cookies: as(sid) });
  const mine = async (sid: string) => (await app.inject({ method: 'GET', url: '/api/apartment', cookies: as(sid) })).json();
  const inventory = async (sid: string) =>
    (await app.inject({ method: 'GET', url: '/api/inventory', cookies: as(sid) })).json() as {
      furniture: { id: string; key: string; placement: { i: number; j: number } | null }[];
    };

  it('starts as a flat square and serves its shape to the owner and to visitors', async () => {
    const { id, sid } = await signUp('alice');
    const body = await mine(sid);
    expect(body.layout).toEqual(DEFAULT_LAYOUT);
    const seen = await app.inject({ method: 'GET', url: `/api/apartments/${id}`, cookies: as(sid) });
    expect(seen.json().layout).toEqual(body.layout);
  });

  it('switches to a ready-made shape, and puts away what stood where the floor is gone', async () => {
    const { sid } = await signUp('bruno');
    const before = (await inventory(sid)).furniture.filter((f) => f.placement);
    expect(before.length).toBeGreaterThan(0);
    const ring = LAYOUT_PRESETS.find((p) => p.key === 'ring')!;
    const res = await put(sid, { preset: 'ring' });
    expect(res.statusCode).toBe(200);
    expect(res.json().layout).toEqual(ring.layout);
    const after = (await inventory(sid)).furniture.filter((f) => f.placement);
    // Nothing is left on a cell without floor.
    for (const f of after) expect(ring.layout.cells[f.placement!.i * N + f.placement!.j]).not.toBe('x');
    expect(after.length + res.json().putAway).toBe(before.length);
  });

  it('refuses unknown presets and invalid drawn shapes, changing nothing', async () => {
    const { sid } = await signUp('carla');
    const original = (await mine(sid)).layout;
    expect((await put(sid, { preset: 'chateau' })).statusCode).toBe(400);
    expect((await put(sid, { cells: 'x'.repeat(N * N), door: { i: 0, j: 0 } })).statusCode).toBe(400);
    expect((await put(sid, { cells: '0'.repeat(N * N - 1), door: { i: N - 1, j: 0 } })).statusCode).toBe(400);
    // The old 8 x 8 grid is not accepted any more.
    expect((await put(sid, { cells: '0'.repeat(64), door: { i: 7, j: 0 } })).statusCode).toBe(400);
    // Islands, a door in the middle, a cliff of two levels.
    expect((await put(sid, { cells: '0000x0000000x000'.repeat(N), door: { i: 0, j: 0 } })).statusCode).toBe(400);
    expect((await put(sid, { cells: '0'.repeat(N * N), door: { i: 3, j: 3 } })).statusCode).toBe(400);
    expect((await put(sid, { cells: '0000000022222222'.repeat(N), door: { i: 0, j: 0 } })).statusCode).toBe(400);
    expect((await put(sid, { cells: '0'.repeat(N * N), door: { i: N - 1, j: 0 }, extra: 1 })).statusCode).toBe(400);
    expect((await mine(sid)).layout).toEqual(original);
  });

  it('accepts a shape the player drew, with a raised platform', async () => {
    const { sid } = await signUp('dario');
    // A floor with an empty border, and a platform of one level in the middle.
    let cells = '';
    for (let i = 0; i < N; i++) {
      for (let j = 0; j < N; j++) {
        const border = i === 0 || j === 0 || i === N - 1 || j === N - 1;
        cells += border ? 'x' : i >= 6 && i < 10 && j >= 6 && j < 10 ? '1' : '0';
      }
    }
    const res = await put(sid, { cells, door: { i: N - 2, j: 1 } });
    expect(res.statusCode).toBe(200);
    expect(res.json().layout).toEqual({ cells, door: { i: N - 2, j: 1 } });
  });

  it('places only on a floor', async () => {
    const { sid } = await signUp('eloi');
    expect((await put(sid, { preset: 'studio' })).statusCode).toBe(200);
    // A piece that stands on the floor (the kit also hangs some on the walls).
    const piece = (await inventory(sid)).furniture.find((f) => f.key === 'pouf')!;
    const place = (i: number, j: number) =>
      app.inject({ method: 'PUT', url: '/api/placements', payload: { itemId: piece.id, i, j }, cookies: as(sid) });
    // Studio: 8 x 8 cells in the back corner, the rest of the grid is empty space.
    expect((await place(8, 0)).statusCode).toBe(400);
    expect((await place(N - 1, N - 1)).statusCode).toBe(400);
    expect((await place(3, 3)).statusCode).toBe(200);
  });

  it('only changes the shape of the caller’s own apartment', async () => {
    const a = await signUp('fanny');
    const b = await signUp('gilles');
    expect((await put(a.sid, { preset: 'cross' })).statusCode).toBe(200);
    expect((await mine(b.sid)).layout).toEqual(DEFAULT_LAYOUT);
    expect((await app.inject({ method: 'PUT', url: '/api/apartment', payload: { layout: { preset: 'cross' } }, cookies: {} })).statusCode).toBe(401);
  });
});
