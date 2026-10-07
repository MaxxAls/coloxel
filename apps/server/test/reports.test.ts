import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SEEDS } from '@coloxel/render';
import { migrate, migrateDownAll } from '../src/db/migrate';
import { createPool } from '../src/db/pool';
import { buildServer } from '../src/index';
import { REPORT_HIDE_THRESHOLD } from '../src/moderation/masking';

const url = process.env.DATABASE_URL ?? 'postgres://coloxel:coloxel@localhost:5432/coloxel';
const probe = createPool(url);
const available = await probe.query('SELECT 1').then(
  () => true,
  () => false,
);
await probe.end();

describe.skipIf(!available)('reports (PostgreSQL)', () => {
  let pool: pg.Pool;
  let app: ReturnType<typeof buildServer>;

  beforeAll(async () => {
    await migrateDownAll(url).catch(() => {});
    await migrate('up', url);
    pool = createPool(url);
    app = buildServer({ pool, model: null });
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
  const report = (who: Account, payload: unknown) =>
    app.inject({ method: 'POST', url: '/api/reports', payload: payload as object, cookies: as(who) });
  const open = (a: Account) => pool.query("UPDATE users SET apartment_access = 'building' WHERE id = $1", [a.id]);
  const say = async (a: Account, text: string, blocked = false) =>
    (await pool.query<{ id: string }>('INSERT INTO chat_log (user_id, room, text, blocked) VALUES ($1, $2, $3, $4) RETURNING id', [a.id, 'hall', text, blocked])).rows[0]!.id;
  const rowsOf = async (reporter: Account) =>
    (await pool.query('SELECT kind, target_key, target_user_id, reason, status, snapshot FROM reports WHERE reporter_id = $1 ORDER BY id', [reporter.id])).rows;

  async function createItem(owner: Account, name = 'Lampe') {
    const item = (
      await pool.query<{ id: string }>(
        `INSERT INTO items (serial, name, description, recipe, creator_id, owner_id)
         VALUES ((SELECT COALESCE(max(serial), 0) + 1 FROM items), $1, 'une lampe', $2, $3, $3) RETURNING id`,
        [name, JSON.stringify({ name, parts: SEEDS[0]!.parts }), owner.id],
      )
    ).rows[0]!.id;
    await pool.query('INSERT INTO placements (item_id, user_id, i, j) VALUES ($1, $2, 3, 3)', [item, owner.id]);
    return item;
  }

  it('requires a session', async () => {
    expect((await app.inject({ method: 'POST', url: '/api/reports', payload: {} })).statusCode).toBe(401);
  });

  it('records a report of a player, a message, a creation, an apartment name and an apartment', async () => {
    const ann = await signUp('rp_ann');
    const bob = await signUp('rp_bob');
    await open(bob);
    await pool.query("UPDATE apartments SET name = 'Chez les fous' WHERE owner_id = $1", [bob.id]);
    const messageId = await say(bob, 'bonjour tout le monde');
    const itemId = await createItem(bob, 'Lampe de bob');

    expect((await report(ann, { kind: 'player', targetId: bob.id, reason: 'harassment' })).statusCode).toBe(201);
    expect((await report(ann, { kind: 'message', targetId: Number(messageId), reason: 'insult', details: '  il   m’a insulté ' })).statusCode).toBe(201);
    expect((await report(ann, { kind: 'item', targetId: itemId, reason: 'inappropriate' })).statusCode).toBe(201);
    expect((await report(ann, { kind: 'apartment_name', targetId: bob.id, reason: 'inappropriate' })).statusCode).toBe(201);
    expect((await report(ann, { kind: 'apartment', targetId: bob.id, reason: 'other' })).statusCode).toBe(201);

    const rows = await rowsOf(ann);
    expect(rows.map((r) => [r.kind, r.reason, r.status])).toEqual([
      ['player', 'harassment', 'open'],
      ['message', 'insult', 'open'],
      ['item', 'inappropriate', 'open'],
      ['apartment_name', 'inappropriate', 'open'],
      ['apartment', 'other', 'open'],
    ]);
    // Each one points at the player who answers for it, and keeps what was reported as it was.
    expect(rows.every((r) => r.target_user_id === bob.id)).toBe(true);
    expect(rows[1].snapshot).toBe('rp_bob : bonjour tout le monde');
    expect(rows[2].snapshot).toMatch(/Lampe de bob/);
    expect(rows[3].snapshot).toMatch(/Chez les fous/);
    expect((await pool.query('SELECT details FROM reports WHERE kind = $1 AND reporter_id = $2', ['message', ann.id])).rows[0].details).toBe('il m’a insulté');
  });

  it('counts a player’s report once, however many times they send it', async () => {
    const cat = await signUp('rp_cat');
    const dan = await signUp('rp_dan');
    const first = await report(cat, { kind: 'player', targetId: dan.id, reason: 'spam' });
    const again = await report(cat, { kind: 'player', targetId: dan.id, reason: 'insult' });
    expect(first.statusCode).toBe(201);
    expect(again.statusCode).toBe(200);
    expect(again.json().already).toBe(true);
    expect(await rowsOf(cat)).toHaveLength(1);
  });

  it('refuses what is not a valid report', async () => {
    const eli = await signUp('rp_eli');
    const fay = await signUp('rp_fay');
    const bad: [unknown, number][] = [
      [{ kind: 'player', targetId: fay.id }, 400], // no reason
      [{ kind: 'player', targetId: fay.id, reason: 'because' }, 400],
      [{ kind: 'planet', targetId: fay.id, reason: 'spam' }, 400],
      [{ kind: 'player', targetId: fay.id, reason: 'spam', reporterId: fay.id }, 400], // names another reporter
      [{ kind: 'player', targetId: fay.id, reason: 'spam', details: 'x'.repeat(301) }, 400],
      [{ kind: 'player', targetId: eli.id, reason: 'spam' }, 400], // oneself
      [{ kind: 'player', targetId: 'not-a-uuid', reason: 'spam' }, 404],
      [{ kind: 'player', targetId: '00000000-0000-4000-8000-000000000000', reason: 'spam' }, 404],
      [{ kind: 'message', targetId: 999999, reason: 'spam' }, 404],
      [{ kind: 'message', targetId: 'abc', reason: 'spam' }, 404],
      [{ kind: 'item', targetId: '00000000-0000-4000-8000-000000000000', reason: 'spam' }, 404],
      [{ kind: 'apartment_name', targetId: fay.id, reason: 'spam' }, 400], // no name to report
      [null, 400],
    ];
    for (const [payload, status] of bad) expect((await report(eli, payload)).statusCode, JSON.stringify(payload)).toBe(status);

    // One's own message, and a message the filter blocked (nobody ever saw it), cannot be reported.
    const mine = await say(eli, 'ma phrase');
    const blocked = await say(fay, 'regarde exemple.com', true);
    expect((await report(eli, { kind: 'message', targetId: mine, reason: 'spam' })).statusCode).toBe(400);
    expect((await report(eli, { kind: 'message', targetId: blocked, reason: 'spam' })).statusCode).toBe(404);
    expect(await rowsOf(eli)).toEqual([]);
  });

  it('only lets a player report a creation they can see', async () => {
    const gus = await signUp('rp_gus');
    const hal = await signUp('rp_hal');
    const ida = await signUp('rp_ida');
    const itemId = await createItem(hal);
    // Hal's apartment is closed: Gus has never seen the lamp.
    expect((await report(gus, { kind: 'item', targetId: itemId, reason: 'spam' })).statusCode).toBe(404);
    await open(hal);
    expect((await report(gus, { kind: 'item', targetId: itemId, reason: 'spam' })).statusCode).toBe(201);
    // Nobody reports their own creation.
    expect((await report(hal, { kind: 'item', targetId: itemId, reason: 'spam' })).statusCode).toBe(400);
    void ida;
  });

  describe('a creation reported by several different players', () => {
    const reporters = async (n: number, prefix: string) => Promise.all(Array.from({ length: n }, (_, k) => signUp(`${prefix}${k}`)));
    const sprite = (viewer: Account, itemId: string) => app.inject({ method: 'GET', url: `/api/items/${itemId}.png`, cookies: as(viewer) });
    const visit = async (viewer: Account, owner: Account) =>
      (await app.inject({ method: 'GET', url: `/api/apartments/${owner.id}`, cookies: as(viewer) })).json().items as { id: string }[];
    const inventory = async (owner: Account) =>
      (await app.inject({ method: 'GET', url: '/api/inventory', cookies: as(owner) })).json().items as { id: string; underReview: boolean }[];

    it(`stays visible below ${REPORT_HIDE_THRESHOLD} reporters, and is masked for everybody but its owner at ${REPORT_HIDE_THRESHOLD}`, async () => {
      const owner = await signUp('rm_owner');
      const visitor = await signUp('rm_visitor');
      await open(owner);
      const itemId = await createItem(owner);
      const others = await reporters(REPORT_HIDE_THRESHOLD, 'rm_r');

      // One player reporting again and again is still one player.
      for (let k = 0; k < 3; k++) await report(others[0]!, { kind: 'item', targetId: itemId, reason: 'spam' });
      for (const r of others.slice(1, REPORT_HIDE_THRESHOLD - 1)) await report(r, { kind: 'item', targetId: itemId, reason: 'spam' });
      expect((await sprite(visitor, itemId)).statusCode).toBe(200);
      expect((await visit(visitor, owner)).map((i) => i.id)).toEqual([itemId]);
      expect((await inventory(owner))[0]).toMatchObject({ id: itemId, underReview: false });

      await report(others[REPORT_HIDE_THRESHOLD - 1]!, { kind: 'item', targetId: itemId, reason: 'spam' });
      expect((await sprite(visitor, itemId)).statusCode).toBe(404);
      expect((await sprite(others[0]!, itemId)).statusCode).toBe(404);
      expect(await visit(visitor, owner)).toEqual([]);
      // The owner still has it, sees it, and knows it is under review.
      expect((await sprite(owner, itemId)).statusCode).toBe(200);
      expect((await inventory(owner))[0]).toMatchObject({ id: itemId, underReview: true });
    });

    it('is not masked by a crowd of reports of something else', async () => {
      const owner = await signUp('rm_owner2');
      const visitor = await signUp('rm_visitor2');
      await open(owner);
      const itemId = await createItem(owner);
      for (const r of await reporters(REPORT_HIDE_THRESHOLD, 'rm_p')) await report(r, { kind: 'player', targetId: owner.id, reason: 'spam' });
      expect((await sprite(visitor, itemId)).statusCode).toBe(200);
    });
  });
});
