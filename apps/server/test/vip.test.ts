import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SEEDS } from '@coloxel/render';
import { DAILY_CHARGES, VIP_BONUS_CHARGES } from '../src/creations/charges';
import type { RecipeModel } from '../src/creations/model';
import { migrate, migrateDownAll } from '../src/db/migrate';
import { createPool } from '../src/db/pool';
import { buildServer } from '../src/index';
import { splitSale } from '../src/market/config';

const url = process.env.DATABASE_URL ?? 'postgres://coloxel:coloxel@localhost:5432/coloxel';
const probe = createPool(url);
const available = await probe.query('SELECT 1').then(
  () => true,
  () => false,
);
await probe.end();

const model: RecipeModel = async () => JSON.stringify({ nom: 'Lampe', parts: SEEDS[0]!.parts });

describe.skipIf(!available)('VIP Atelier (PostgreSQL)', () => {
  let pool: pg.Pool;
  let app: ReturnType<typeof buildServer>;

  beforeAll(async () => {
    await migrateDownAll(url).catch(() => {});
    await migrate('up', url);
    pool = createPool(url);
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
  const charges = async (p: Player) => (await app.inject({ method: 'GET', url: '/api/charges', cookies: { coloxel_sid: p.sid } })).json().charges as number;
  const wallet = async (p: Player) => (await app.inject({ method: 'GET', url: '/api/wallet', cookies: { coloxel_sid: p.sid } })).json();

  it('gives nothing to a player who is not VIP', async () => {
    const p = await signUp('vip1');
    expect(await charges(p)).toBe(DAILY_CHARGES);
    expect((await wallet(p)).vipUntil).toBeNull();
  });

  it('adds the daily bonus, even the day the player becomes VIP, and only once a day', async () => {
    const p = await signUp('vip2');
    expect(await charges(p)).toBe(DAILY_CHARGES);
    await pool.query("UPDATE users SET vip_until = now() + interval '30 days' WHERE id = $1", [p.id]);
    expect(await charges(p)).toBe(DAILY_CHARGES + VIP_BONUS_CHARGES);
    expect(await charges(p)).toBe(DAILY_CHARGES + VIP_BONUS_CHARGES);
    expect((await wallet(p)).vipUntil).not.toBeNull();
    const { rows } = await pool.query("SELECT count(*)::int AS n FROM creation_charges WHERE user_id = $1 AND reason = 'vip_bonus'", [p.id]);
    expect(rows[0].n).toBe(1);
  });

  it('gives no bonus once the VIP is over', async () => {
    const p = await signUp('vip3');
    await pool.query("UPDATE users SET vip_until = now() - interval '1 minute' WHERE id = $1", [p.id]);
    expect(await charges(p)).toBe(DAILY_CHARGES);
    expect((await wallet(p)).vipUntil).toBeNull();
  });

  it('can be spent: a VIP creates more objects in a day', async () => {
    const p = await signUp('vip4');
    await pool.query("UPDATE users SET vip_until = now() + interval '30 days' WHERE id = $1", [p.id]);
    for (let n = 0; n < DAILY_CHARGES + VIP_BONUS_CHARGES; n++) {
      const res = await app.inject({ method: 'POST', url: '/api/creations', payload: { description: 'une lampe' }, cookies: { coloxel_sid: p.sid } });
      expect(res.statusCode, `creation ${n + 1}`).toBe(201);
    }
    const more = await app.inject({ method: 'POST', url: '/api/creations', payload: { description: 'une lampe' }, cookies: { coloxel_sid: p.sid } });
    expect(more.statusCode).toBe(429);
  });

  it('cannot be set from the API', async () => {
    const p = await signUp('vip5');
    for (const [method, path] of [
      ['POST', '/api/wallet/vip'],
      ['PUT', '/api/wallet'],
      ['POST', '/api/wallet/redeem'],
    ] as const) {
      await app.inject({ method, url: path, payload: { vipUntil: '2999-01-01', vip: true, code: 'VIP' }, cookies: { coloxel_sid: p.sid } });
    }
    expect((await wallet(p)).vipUntil).toBeNull();
  });

  it('gives no advantage on the market: the split of a price does not know who is VIP', () => {
    expect(splitSale.length).toBeLessThanOrEqual(3);
    expect(splitSale(100, false)).toEqual({ commission: 5, royalty: 5, sellerNet: 90 });
  });
});
