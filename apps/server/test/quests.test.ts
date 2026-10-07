import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SEEDS } from '@coloxel/render';
import type { RecipeModel } from '../src/creations/model';
import { migrate, migrateDownAll } from '../src/db/migrate';
import { createPool } from '../src/db/pool';
import { buildServer } from '../src/index';
import type { UserEvent } from '../src/moderation/sanctions';
import { QUESTS } from '../src/quests/definitions';
import { recordQuest } from '../src/quests/engine';

const url = process.env.DATABASE_URL ?? 'postgres://coloxel:coloxel@localhost:5432/coloxel';
const probe = createPool(url);
const available = await probe.query('SELECT 1').then(
  () => true,
  () => false,
);
await probe.end();

const model: RecipeModel = async () => JSON.stringify({ nom: 'Lampe test', parts: SEEDS[0]!.parts });

describe.skipIf(!available)('challenges (PostgreSQL)', () => {
  let pool: pg.Pool;
  let app: ReturnType<typeof buildServer>;
  const told: UserEvent[] = [];

  beforeAll(async () => {
    await migrateDownAll(url).catch(() => {});
    await migrate('up', url);
    pool = createPool(url);
    await pool.query('INSERT INTO apartments (id, floor, slot) SELECT n, 10 + n, 0 FROM generate_series(31, 60) AS n');
    app = buildServer({ pool, model, notifyUser: (e) => void told.push(e) });
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
    return { id: res.json().user.id as string, nickname, sid: res.cookies.find((c) => c.name === 'coloxel_sid')!.value };
  }
  type Account = Awaited<ReturnType<typeof signUp>>;
  const as = (a: Account) => ({ coloxel_sid: a.sid });
  const quests = async (a: Account) =>
    (await app.inject({ method: 'GET', url: '/api/quests', cookies: as(a) })).json().quests as {
      key: string;
      count: number;
      tier: number;
      done: boolean;
      tiers: { goal: number; reward: number; done: boolean }[];
    }[];
  const pixels = async (a: Account) => (await pool.query('SELECT pixels FROM users WHERE id = $1', [a.id])).rows[0].pixels as number;
  const until = async (cond: () => unknown, ms = 3000) => {
    const start = Date.now();
    while (!(await cond())) {
      if (Date.now() - start > ms) throw new Error('timed out waiting for condition');
      await new Promise((r) => setTimeout(r, 25));
    }
  };

  it('requires a session, and lists every challenge at zero for a new player', async () => {
    expect((await app.inject({ method: 'GET', url: '/api/quests' })).statusCode).toBe(401);
    const a = await signUp('q_new');
    const list = await quests(a);
    expect(list.map((q) => q.key)).toEqual(QUESTS.map((q) => q.key));
    expect(list.every((q) => q.count === 0 && q.tier === 0 && !q.done)).toBe(true);
  });

  it('pays a tier once, in the ledger, and tells the player', async () => {
    const a = await signUp('q_inventor');
    const before = await pixels(a);
    told.length = 0;
    const res = await app.inject({ method: 'POST', url: '/api/creations', payload: { description: 'une lampe' }, cookies: as(a) });
    expect(res.statusCode).toBe(201);
    await until(() => told.some((e) => e.userId === a.id && e.kind === 'quest'));
    const reward = QUESTS.find((q) => q.key === 'inventeur')!.tiers[0]!.reward;
    expect(await pixels(a)).toBe(before + reward);
    expect(told.find((e) => e.userId === a.id)).toMatchObject({ kind: 'quest', text: expect.stringContaining(`+${reward} Pixels`) });
    expect((await quests(a)).find((q) => q.key === 'inventeur')).toMatchObject({ count: 1, tier: 1, done: false });
    const ledger = (await pool.query("SELECT delta, reason FROM pixel_ledger WHERE user_id = $1 AND reason LIKE 'Défi%'", [a.id])).rows;
    expect(ledger).toEqual([{ delta: reward, reason: 'Défi : Inventeur 1' }]);
  });

  it('counts an object once however often it is placed, and a visit once per apartment', async () => {
    const a = await signUp('q_once');
    for (let k = 0; k < 5; k++) await recordQuest(pool, a.id, 'place', 'object-1');
    for (let k = 0; k < 5; k++) await recordQuest(pool, a.id, 'visit', 'apartment-1');
    await recordQuest(pool, a.id, 'visit', 'apartment-2');
    const list = await quests(a);
    expect(list.find((q) => q.key === 'decorateur')!.count).toBe(1);
    expect(list.find((q) => q.key === 'voisin')!.count).toBe(2);
    // An event that must be tied to a thing counts for nothing without one.
    expect(await recordQuest(pool, a.id, 'place')).toEqual([]);
    expect((await quests(a)).find((q) => q.key === 'decorateur')!.count).toBe(1);
  });

  it('never pays more than the sum of the tiers, and never twice, even under concurrency', async () => {
    const a = await signUp('q_chatty');
    const before = await pixels(a);
    const series = QUESTS.find((q) => q.key === 'bavard')!;
    const last = series.tiers[series.tiers.length - 1]!.goal;
    await Promise.all(Array.from({ length: last + 40 }, () => recordQuest(pool, a.id, 'chat')));
    const paid = series.tiers.reduce((n, t) => n + t.reward, 0);
    expect(await pixels(a)).toBe(before + paid);
    expect((await quests(a)).find((q) => q.key === 'bavard')).toMatchObject({ count: last + 40, tier: series.tiers.length, done: true });
    expect((await pool.query("SELECT count(*) FROM pixel_ledger WHERE user_id = $1 AND reason LIKE 'Défi : Bavard%'", [a.id])).rows[0].count).toBe(String(series.tiers.length));
  });

  it('moves with placements and friendships done through the API', async () => {
    const a = await signUp('q_deco');
    const b = await signUp('q_pal');
    const inv = (await app.inject({ method: 'GET', url: '/api/inventory', cookies: as(a) })).json().furniture as { id: string; placement: unknown }[];
    const free = inv.find((f) => f.placement === null) ?? (await app.inject({ method: 'POST', url: '/api/furniture', payload: { key: 'ficus' }, cookies: as(a) })).json().furniture;
    const place = await app.inject({ method: 'PUT', url: '/api/placements', payload: { itemId: free.id, i: 6, j: 6 }, cookies: as(a) });
    expect(place.statusCode).toBe(200);
    await until(async () => (await quests(a)).find((q) => q.key === 'decorateur')!.count === 1);

    await app.inject({ method: 'POST', url: '/api/friends/requests', payload: { nickname: 'q_pal' }, cookies: as(a) });
    await app.inject({ method: 'POST', url: `/api/friends/requests/${a.id}/accept`, cookies: as(b) });
    await until(async () => (await quests(a)).find((q) => q.key === 'sociable')!.count === 1);
    await until(async () => (await quests(b)).find((q) => q.key === 'sociable')!.count === 1);
  });
});
