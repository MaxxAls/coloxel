import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ageOn, containsBannedWord, parseBirthDate } from '../src/auth/rules';
import { migrate, migrateDownAll } from '../src/db/migrate';
import { createPool } from '../src/db/pool';
import { buildServer } from '../src/index';

describe('auth rules', () => {
  it('parses strict calendar dates only', () => {
    expect(parseBirthDate('1990-02-28')).toEqual({ y: 1990, m: 2, d: 28 });
    expect(parseBirthDate('1990-02-30')).toBeNull();
    expect(parseBirthDate('90-02-10')).toBeNull();
    expect(parseBirthDate('not a date')).toBeNull();
  });

  it('computes age around the birthday', () => {
    const now = new Date(Date.UTC(2026, 9, 7));
    expect(ageOn({ y: 2008, m: 10, d: 7 }, now)).toBe(18);
    expect(ageOn({ y: 2008, m: 10, d: 8 }, now)).toBe(17);
  });

  it('filters banned words through spacing, accents and case', () => {
    expect(containsBannedWord('N a Z i')).toBe(true);
    expect(containsBannedWord('Pixel_Fan')).toBe(false);
  });
});

// A pool that must never be reached: these requests are rejected before any query.
const untouchedPool = { query: async () => { throw new Error('unexpected query'); } } as unknown as pg.Pool;

describe('register validation (no database)', () => {
  const app = buildServer({ pool: untouchedPool });
  const body = { email: 'a@b.fr', password: 'motdepasse', nickname: 'Pixel', birthDate: '1990-01-01' };
  const register = (patch: object) =>
    app.inject({ method: 'POST', url: '/api/auth/register', payload: { ...body, ...patch } });

  it('refuses minors with a clear message', async () => {
    const year = new Date().getUTCFullYear() - 15;
    const res = await register({ birthDate: `${year}-01-01` });
    expect(res.statusCode).toBe(403);
    expect(res.json().error).toContain('18 ans');
  });

  it('refuses a future or impossible birth date', async () => {
    expect((await register({ birthDate: '2999-01-01' })).statusCode).toBe(400);
    expect((await register({ birthDate: '1990-13-40' })).statusCode).toBe(400);
  });

  it('refuses weak passwords, bad emails and odd nicknames', async () => {
    expect((await register({ password: 'court' })).statusCode).toBe(400);
    expect((await register({ email: 'nope' })).statusCode).toBe(400);
    expect((await register({ nickname: 'jean.dupont@mail' })).statusCode).toBe(400);
    expect((await register({ nickname: 'n a z i'.replace(/ /g, '') })).statusCode).toBe(400);
  });

  it('answers 401 to /me without a cookie', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/auth/me' });
    expect(res.statusCode).toBe(401);
  });
});

const url = process.env.DATABASE_URL ?? 'postgres://coloxel:coloxel@localhost:5432/coloxel';
const probe = createPool(url);
const available = await probe.query('SELECT 1').then(
  () => true,
  () => false,
);
await probe.end();

describe.skipIf(!available)('auth flow (PostgreSQL)', () => {
  let pool: pg.Pool;
  let app: ReturnType<typeof buildServer>;
  const creds = { email: 'Flow@Test.dev', password: 'motdepasse', nickname: 'FlowUser', birthDate: '1990-01-01' };

  beforeAll(async () => {
    await migrateDownAll(url).catch(() => {});
    await migrate('up', url);
    pool = createPool(url);
    app = buildServer({ pool });
  });
  afterAll(async () => {
    await app?.close();
    await pool?.end();
  });

  const cookieOf = (res: { cookies: { name: string; value: string }[] }) =>
    res.cookies.find((c) => c.name === 'coloxel_sid')!;

  it('registers, sets an httpOnly cookie, and identifies the user', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/auth/register', payload: creds });
    expect(res.statusCode).toBe(201);
    const cookie = res.cookies.find((c) => c.name === 'coloxel_sid')!;
    expect(cookie.httpOnly).toBe(true);
    const me = await app.inject({ method: 'GET', url: '/api/auth/me', cookies: { coloxel_sid: cookie.value } });
    expect(me.json().user.nickname).toBe('FlowUser');
    const row = await pool.query('SELECT password_hash FROM users');
    expect(row.rows[0].password_hash).toMatch(/^\$argon2/);
  });

  it('rejects duplicate email (any case) and duplicate nickname', async () => {
    const dupEmail = await app.inject({
      method: 'POST', url: '/api/auth/register', payload: { ...creds, email: 'flow@test.dev', nickname: 'Other' },
    });
    expect(dupEmail.statusCode).toBe(409);
    const dupNick = await app.inject({
      method: 'POST', url: '/api/auth/register', payload: { ...creds, email: 'x@test.dev', nickname: 'flowuser' },
    });
    expect(dupNick.statusCode).toBe(409);
  });

  it('logs in, rejects bad credentials, and logs out for real', async () => {
    const bad = await app.inject({
      method: 'POST', url: '/api/auth/login', payload: { email: creds.email, password: 'mauvaismdp' },
    });
    expect(bad.statusCode).toBe(401);
    const unknown = await app.inject({
      method: 'POST', url: '/api/auth/login', payload: { email: 'ghost@test.dev', password: 'motdepasse' },
    });
    expect(unknown.json()).toEqual(bad.json());

    const ok = await app.inject({
      method: 'POST', url: '/api/auth/login', payload: { email: 'flow@test.dev', password: creds.password },
    });
    expect(ok.statusCode).toBe(200);
    const sid = cookieOf(ok).value;
    await app.inject({ method: 'POST', url: '/api/auth/logout', cookies: { coloxel_sid: sid } });
    const me = await app.inject({ method: 'GET', url: '/api/auth/me', cookies: { coloxel_sid: sid } });
    expect(me.statusCode).toBe(401);
  });
});
