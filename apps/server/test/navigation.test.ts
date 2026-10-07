import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
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

interface Apartment {
  name: string | null;
  owner: { id: string } | null;
  open: boolean;
}

describe.skipIf(!available)('apartment settings and navigator (PostgreSQL)', () => {
  let pool: pg.Pool;
  let app: ReturnType<typeof buildServer>;
  let present = new Map<string, number>();
  let hallCount = 0;

  beforeAll(async () => {
    await migrateDownAll(url).catch(() => {});
    await migrate('up', url);
    pool = createPool(url);
    app = buildServer({ pool, model: null, occupancy: async () => ({ apartments: present, hall: hallCount }) });
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
  const put = (sid: string, payload: unknown) =>
    app.inject({ method: 'PUT', url: '/api/apartment', payload: payload as object, cookies: as(sid) });
  const mine = async (sid: string) => (await app.inject({ method: 'GET', url: '/api/apartment', cookies: as(sid) })).json();
  const building = async (sid: string) =>
    (await app.inject({ method: 'GET', url: '/api/building', cookies: as(sid) })).json().apartments as Apartment[];

  it('requires a session', async () => {
    expect((await app.inject({ method: 'PUT', url: '/api/apartment', payload: {} })).statusCode).toBe(401);
    expect((await app.inject({ method: 'GET', url: '/api/apartment' })).statusCode).toBe(401);
    expect((await app.inject({ method: 'GET', url: '/api/navigator' })).statusCode).toBe(401);
  });

  it('names an apartment and opens or closes it', async () => {
    const gina = await signUp('gina');
    const hugo = await signUp('hugo');

    expect(await mine(gina.sid)).toMatchObject({ name: null, access: 'closed', floor: 1 });
    const res = await put(gina.sid, { name: '  Chez   Gina  ', access: 'building' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ name: 'Chez Gina', access: 'building' });
    expect((await building(hugo.sid)).find((a) => a.owner?.id === gina.id)).toMatchObject({
      name: 'Chez Gina',
      open: true,
    });

    // Each field on its own, and an empty name clears it.
    expect((await put(gina.sid, { access: 'closed' })).json()).toMatchObject({ name: 'Chez Gina', access: 'closed' });
    expect((await put(gina.sid, { name: '' })).json()).toMatchObject({ name: null, access: 'closed' });
    expect((await building(hugo.sid)).find((a) => a.owner?.id === gina.id)).toMatchObject({ open: false });
  });

  it('only ever changes the caller’s own apartment', async () => {
    const ines = await signUp('ines');
    const joe = await signUp('joe');
    // Aiming at someone else is not even a valid request.
    expect((await put(joe.sid, { name: 'Salon', ownerId: ines.id })).statusCode).toBe(400);
    expect((await put(joe.sid, { name: 'Salon', id: 1 })).statusCode).toBe(400);
    expect((await put(joe.sid, { name: 'Salon' })).statusCode).toBe(200);
    expect((await mine(ines.sid)).name).toBeNull();
    expect((await mine(joe.sid)).name).toBe('Salon');
  });

  it('refuses invalid settings and names blocked by the text filter', async () => {
    const kim = await signUp('kim');
    expect((await put(kim.sid, { access: 'everybody' })).statusCode).toBe(400);
    expect((await put(kim.sid, { name: 'x'.repeat(31) })).statusCode).toBe(400);
    expect((await put(kim.sid, { name: 42 })).statusCode).toBe(400);
    const cases: [string, RegExp][] = [
      ['visite exemple.com', /liens/],
      ['jean@gmail.com', /e-mail/],
      ['06 12 34 56 78', /téléphone/],
      ['mon insta', /réseaux/],
      ['espèce de connard', /pas autorisé/],
    ];
    for (const [name, message] of cases) {
      const res = await put(kim.sid, { name });
      expect(res.statusCode, name).toBe(400);
      expect(res.json().error, name).toMatch(message);
    }
    expect((await mine(kim.sid)).name).toBeNull();
  });

  it('lists the hall and the open apartments, busiest first, never closed ones', async () => {
    const [mia, noa, omar, pia] = await Promise.all(['mia', 'noa', 'omar', 'pia'].map(signUp)) as [
      Awaited<ReturnType<typeof signUp>>,
      Awaited<ReturnType<typeof signUp>>,
      Awaited<ReturnType<typeof signUp>>,
      Awaited<ReturnType<typeof signUp>>,
    ];
    await pool.query("UPDATE users SET apartment_access = 'building' WHERE id = ANY($1)", [[mia.id, noa.id, omar.id]]);
    await put(omar.sid, { name: 'La grande fête' });
    present = new Map([
      [omar.id, 5],
      [noa.id, 2],
      [pia.id, 9],
    ]);
    hallCount = 4;

    const res = await app.inject({ method: 'GET', url: '/api/navigator', cookies: as(mia.sid) });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.places).toEqual([{ kind: 'hall', name: 'Le hall', visitors: 4 }]);
    // pia is the busiest but closed: not listed. Earlier tests' players are closed too.
    const names = body.open.map((o: { nickname: string }) => o.nickname);
    expect(names).toEqual(['omar', 'noa', 'mia']);
    expect(body.open[0]).toMatchObject({ name: 'La grande fête', visitors: 5, mine: false });
    expect(body.open[2]).toMatchObject({ mine: true, visitors: 0 });
    expect(body.friends).toEqual([]);
    present = new Map();
    hallCount = 0;
  });
});
