import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { migrate, migrateDownAll } from '../src/db/migrate';
import { createPool } from '../src/db/pool';
import { PM_PER_MINUTE } from '../src/messages/routes';
import { buildServer } from '../src/index';
import type { UserEvent } from '../src/moderation/sanctions';

const url = process.env.DATABASE_URL ?? 'postgres://coloxel:coloxel@localhost:5432/coloxel';
const probe = createPool(url);
const available = await probe.query('SELECT 1').then(
  () => true,
  () => false,
);
await probe.end();

describe.skipIf(!available)('private messages (PostgreSQL)', () => {
  let pool: pg.Pool;
  let app: ReturnType<typeof buildServer>;
  const events: UserEvent[] = [];

  beforeAll(async () => {
    await migrateDownAll(url).catch(() => {});
    await migrate('up', url);
    pool = createPool(url);
    await pool.query('INSERT INTO apartments (id, floor, slot) SELECT n, 10 + n, 0 FROM generate_series(31, 90) AS n');
    app = buildServer({ pool, model: null, notifyUser: (event) => void events.push(event) });
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
  const befriend = async (a: Account, b: Account) => {
    await app.inject({ method: 'POST', url: '/api/friends/requests', payload: { nickname: b.nickname }, cookies: as(a) });
    expect((await app.inject({ method: 'POST', url: `/api/friends/requests/${a.id}/accept`, cookies: as(b) })).statusCode).toBe(200);
  };
  const send = (from: Account, to: Account, text: string) =>
    app.inject({ method: 'POST', url: `/api/messages/${to.id}`, payload: { text }, cookies: as(from) });
  const read = async (who: Account, other: Account) => app.inject({ method: 'GET', url: `/api/messages/${other.id}`, cookies: as(who) });
  const inbox = async (who: Account) => (await app.inject({ method: 'GET', url: '/api/messages', cookies: as(who) })).json();

  it('requires a session', async () => {
    expect((await app.inject({ method: 'GET', url: '/api/messages' })).statusCode).toBe(401);
    expect((await app.inject({ method: 'POST', url: '/api/messages/00000000-0000-4000-8000-000000000000', payload: { text: 'x' } })).statusCode).toBe(401);
  });

  it('only between friends, and the friend is told', async () => {
    const ana = await signUp('pm_ana');
    const ben = await signUp('pm_ben');
    expect((await send(ana, ben, 'salut')).statusCode).toBe(404);
    await befriend(ana, ben);

    const res = await send(ana, ben, '  salut   Ben ! ');
    expect(res.statusCode).toBe(201);
    expect(res.json().message).toMatchObject({ mine: true, text: 'salut Ben !' });
    expect(events.at(-1)).toEqual({ userId: ben.id, kind: 'pm', from: ana.id, nickname: 'pm_ana' });

    // Unread until Ben opens the conversation.
    expect(await inbox(ben)).toEqual({ open: true, unread: [{ id: ana.id, nickname: 'pm_ana', count: 1 }] });
    const conv = await read(ben, ana);
    expect(conv.json().messages).toMatchObject([{ mine: false, text: 'salut Ben !' }]);
    expect((await inbox(ben)).unread).toEqual([]);
    expect((await read(ana, ben)).json().messages).toMatchObject([{ mine: true }]);

    // No longer friends: no more messages, and the conversation is out of reach.
    await app.inject({ method: 'DELETE', url: `/api/friends/${ben.id}`, cookies: as(ana) });
    expect((await send(ben, ana, 'encore là ?')).statusCode).toBe(404);
    expect((await read(ben, ana)).statusCode).toBe(404);
  });

  it('filters, refuses empty or long messages, and respects closed messages', async () => {
    const cal = await signUp('pm_cal');
    const dan = await signUp('pm_dan');
    await befriend(cal, dan);
    expect((await send(cal, dan, 'connard')).statusCode).toBe(422);
    expect((await send(cal, dan, 'écris-moi sur jean@gmail.com')).statusCode).toBe(422);
    expect((await send(cal, dan, '   ')).statusCode).toBe(400);
    expect((await send(cal, dan, 'a'.repeat(301))).statusCode).toBe(400);
    expect(Number((await pool.query('SELECT count(*) FROM private_messages WHERE from_id = $1', [cal.id])).rows[0].count)).toBe(0);

    expect((await app.inject({ method: 'PUT', url: '/api/messages/settings', payload: { open: false }, cookies: as(dan) })).json()).toEqual({ open: false });
    expect((await inbox(dan)).open).toBe(false);
    expect((await send(cal, dan, 'coucou')).statusCode).toBe(409);
    await app.inject({ method: 'PUT', url: '/api/messages/settings', payload: { open: true }, cookies: as(dan) });
    expect((await send(cal, dan, 'coucou')).statusCode).toBe(201);
  });

  it('stays between adults', async () => {
    const eve = await signUp('pm_eve');
    const fox = await signUp('pm_fox');
    await befriend(eve, fox);
    await pool.query("UPDATE users SET birth_date = (now() - interval '12 years')::date WHERE id = $1", [fox.id]);
    expect((await send(eve, fox, 'salut')).statusCode).toBe(403);
    expect((await send(fox, eve, 'salut')).statusCode).toBe(403);
  });

  it('limits how fast one writes', async () => {
    const gus = await signUp('pm_gus');
    const hal = await signUp('pm_hal');
    await befriend(gus, hal);
    await pool.query(
      `INSERT INTO private_messages (from_id, to_id, text) SELECT $1, $2, 'message ' || n FROM generate_series(1, $3) AS n`,
      [gus.id, hal.id, PM_PER_MINUTE],
    );
    expect((await send(gus, hal, 'un de trop')).statusCode).toBe(429);
  });

  it('the one who received a message may report it, with what came before', async () => {
    const ivy = await signUp('pm_ivy');
    const jon = await signUp('pm_jon');
    await befriend(ivy, jon);
    await send(jon, ivy, 'bonjour');
    const id = (await send(ivy, jon, 'tu es pénible')).json().message.id as number;
    const report = (who: Account, targetId: unknown) =>
      app.inject({ method: 'POST', url: '/api/reports', payload: { kind: 'private', targetId, reason: 'harassment' }, cookies: as(who) });

    // Not the sender, nor a message that does not exist.
    expect((await report(ivy, id)).statusCode).toBe(404);
    expect((await report(jon, 999999999)).statusCode).toBe(404);
    expect((await report(jon, 'abc')).statusCode).toBe(404);
    expect((await report(jon, id)).statusCode).toBe(201);
    const { rows } = await pool.query('SELECT target_user_id, snapshot, context FROM reports WHERE reporter_id = $1', [jon.id]);
    expect(rows).toEqual([
      { target_user_id: ivy.id, snapshot: 'pm_ivy (message privé) : tu es pénible', context: 'pm_jon : bonjour\npm_ivy : tu es pénible' },
    ]);
  });
});
