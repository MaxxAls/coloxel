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

const goodAnswer = JSON.stringify({ nom: 'Lampe test', parts: SEEDS[0]!.parts });

describe.skipIf(!available)('creations (PostgreSQL)', () => {
  let pool: pg.Pool;
  let answer = goodAnswer;
  let modelFails = false;
  const model: RecipeModel = async () => {
    if (modelFails) throw new Error('boom');
    return answer;
  };
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
    return res.cookies.find((c) => c.name === 'coloxel_sid')!.value;
  }
  const create = (sid: string, description: unknown) =>
    app.inject({ method: 'POST', url: '/api/creations', payload: { description }, cookies: { coloxel_sid: sid } });
  const charges = async (sid: string) =>
    (await app.inject({ method: 'GET', url: '/api/charges', cookies: { coloxel_sid: sid } })).json().charges;

  it('requires a session', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/creations', payload: { description: 'une lampe' } });
    expect(res.statusCode).toBe(401);
  });

  it('creates a numbered 1/1 item and spends one charge', async () => {
    const sid = await signUp('alice');
    expect(await charges(sid)).toBe(DAILY_CHARGES);
    const res = await create(sid, '  une   lampe rigolote ');
    expect(res.statusCode).toBe(201);
    const { item, charges: left } = res.json();
    expect(left).toBe(DAILY_CHARGES - 1);
    expect(item).toMatchObject({
      serial: 1,
      name: 'Lampe test',
      description: 'une lampe rigolote',
      editionNumber: 1,
      editionSize: 1,
      creator: 'alice',
    });
    expect(await charges(sid)).toBe(DAILY_CHARGES - 1);

    const png = await app.inject({ method: 'GET', url: `/api/items/${item.id}.png`, cookies: { coloxel_sid: sid } });
    expect(png.statusCode).toBe(200);
    expect(png.headers['content-type']).toBe('image/png');
    const stranger = await signUp('mallory');
    const denied = await app.inject({ method: 'GET', url: `/api/items/${item.id}.png`, cookies: { coloxel_sid: stranger } });
    expect(denied.statusCode).toBe(404);
  });

  it('validates the description and filters banned words without spending a charge', async () => {
    const sid = await signUp('bob');
    expect((await create(sid, 'ab')).statusCode).toBe(400);
    expect((await create(sid, 'x'.repeat(201))).statusCode).toBe(400);
    expect((await create(sid, 42)).statusCode).toBe(400);
    expect((await create(sid, 'un grand N a z i')).statusCode).toBe(400);
    expect(await charges(sid)).toBe(DAILY_CHARGES);
  });

  it('refunds the charge on a model refusal, an invalid recipe and a model error', async () => {
    const sid = await signUp('carol');
    answer = JSON.stringify({ refus: 'contenu non adapté' });
    const refused = await create(sid, 'quelque chose');
    expect(refused.statusCode).toBe(422);
    expect(refused.json().error).toContain('rendue');

    answer = 'pas du json du tout';
    expect((await create(sid, 'quelque chose')).statusCode).toBe(422);

    answer = JSON.stringify({ nom: 'Casse', parts: [{ t: 'box' }] });
    expect((await create(sid, 'quelque chose')).statusCode).toBe(422);

    modelFails = true;
    expect((await create(sid, 'quelque chose')).statusCode).toBe(502);
    modelFails = false;
    answer = goodAnswer;

    expect(await charges(sid)).toBe(DAILY_CHARGES);
    const { rows } = await pool.query(
      `SELECT count(*)::int AS n FROM items i JOIN users u ON u.id = i.creator_id WHERE u.nickname = 'carol'`,
    );
    expect(rows[0].n).toBe(0);
  });

  it('never exceeds the daily charges nor reuses a number under concurrent creations', async () => {
    const sid = await signUp('dave');
    const results = await Promise.all(Array.from({ length: 9 }, (_, k) => create(sid, `objet numéro ${k}`)));
    const ok = results.filter((r) => r.statusCode === 201);
    const refused = results.filter((r) => r.statusCode === 429);
    expect(ok).toHaveLength(DAILY_CHARGES);
    expect(refused).toHaveLength(results.length - DAILY_CHARGES);
    const serials = ok.map((r) => r.json().item.serial);
    expect(new Set(serials).size).toBe(DAILY_CHARGES);
    expect(await charges(sid)).toBe(0);
  });

  it('does not let two players collide on item numbers', async () => {
    const [a, b] = await Promise.all([signUp('erin'), signUp('frank')]);
    const results = await Promise.all([create(a, 'objet A'), create(b, 'objet B'), create(a, 'objet C'), create(b, 'objet D')]);
    const serials = results.map((r) => r.json().item.serial);
    expect(new Set(serials).size).toBe(4);
  });

  it('answers 503 when no model is configured', async () => {
    const bare = buildServer({ pool, model: null });
    const sid = await signUp('gina');
    const res = await bare.inject({
      method: 'POST', url: '/api/creations', payload: { description: 'une lampe' }, cookies: { coloxel_sid: sid },
    });
    expect(res.statusCode).toBe(503);
    expect(await charges(sid)).toBe(DAILY_CHARGES);
    await bare.close();
  });
});
