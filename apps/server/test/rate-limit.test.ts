import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SEEDS } from '@coloxel/render';
import type { RecipeModel } from '../src/creations/model';
import { migrate, migrateDownAll } from '../src/db/migrate';
import { createPool } from '../src/db/pool';
import { buildServer } from '../src/index';
import type { RateLimits } from '../src/rate-limit';

const url = process.env.DATABASE_URL ?? 'postgres://coloxel:coloxel@localhost:5432/coloxel';
const probe = createPool(url);
const available = await probe.query('SELECT 1').then(
  () => true,
  () => false,
);
await probe.end();

const model: RecipeModel = async () => JSON.stringify({ nom: 'Lampe test', parts: SEEDS[0]!.parts });
const hour = 3_600_000;
const limits: RateLimits = {
  loginPerIp: { max: 6, window: hour },
  loginPerAccount: { max: 3, window: hour },
  registerPerIp: { max: 2, window: hour },
  creationsPerUser: { max: 2, window: hour },
  creationsPerIp: { max: 100, window: hour },
  furniturePerUser: { max: 100, window: hour },
};

describe.skipIf(!available)('rate limits (PostgreSQL)', () => {
  let pool: pg.Pool;
  let app: ReturnType<typeof buildServer>;

  beforeAll(async () => {
    await migrateDownAll(url).catch(() => {});
    await migrate('up', url);
    pool = createPool(url);
    app = buildServer({ pool, model, rateLimits: limits });
  });
  afterAll(async () => {
    await app?.close();
    await pool?.end();
  });

  const register = (nickname: string, ip: string) =>
    app.inject({
      method: 'POST',
      url: '/api/auth/register',
      remoteAddress: ip,
      payload: { email: `${nickname}@test.dev`, password: 'motdepasse', nickname, birthDate: '1990-01-01' },
    });
  const login = (email: string, password: string, ip: string) =>
    app.inject({ method: 'POST', url: '/api/auth/login', remoteAddress: ip, payload: { email, password } });

  it('limits registrations per IP, without affecting other IPs', async () => {
    expect((await register('anna', '10.0.0.1')).statusCode).toBe(201);
    expect((await register('ben', '10.0.0.1')).statusCode).toBe(201);
    const blocked = await register('cleo', '10.0.0.1');
    expect(blocked.statusCode).toBe(429);
    expect(blocked.json().error).toMatch(/inscriptions/);
    expect((await register('cleo', '10.0.0.2')).statusCode).toBe(201);
  });

  it('limits password guessing on one account, even from many IPs', async () => {
    for (let k = 0; k < 3; k++) {
      expect((await login('anna@test.dev', 'mauvais', `10.1.0.${k}`)).statusCode).toBe(401);
    }
    // The account is now locked out for everyone, the right password included.
    const locked = await login('anna@test.dev', 'motdepasse', '10.1.0.99');
    expect(locked.statusCode).toBe(429);
    expect(locked.json().error).toMatch(/Trop de tentatives/);
    // Another account is unaffected.
    expect((await login('ben@test.dev', 'motdepasse', '10.1.0.99')).statusCode).toBe(200);
  });

  it('limits login attempts per IP across accounts', async () => {
    const codes: number[] = [];
    for (let k = 0; k < 8; k++) codes.push((await login(`ghost${k}@test.dev`, 'x', '10.2.0.1')).statusCode);
    expect(codes.slice(0, 6)).toEqual(Array(6).fill(401));
    expect(codes.slice(6)).toEqual([429, 429]);
  });

  it('limits creation requests per player', async () => {
    const res = await login('cleo@test.dev', 'motdepasse', '10.3.0.1');
    const sid = res.cookies.find((c) => c.name === 'coloxel_sid')!.value;
    const create = () =>
      app.inject({
        method: 'POST',
        url: '/api/creations',
        payload: { description: 'une lampe' },
        cookies: { coloxel_sid: sid },
      });
    expect((await create()).statusCode).toBe(201);
    expect((await create()).statusCode).toBe(201);
    const blocked = await create();
    expect(blocked.statusCode).toBe(429);
    expect(blocked.json().error).toMatch(/Doucement/);
  });
});
