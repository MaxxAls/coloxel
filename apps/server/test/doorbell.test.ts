import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { migrate, migrateDownAll } from '../src/db/migrate';
import { createPool } from '../src/db/pool';
import { buildServer } from '../src/index';
import type { UserEvent } from '../src/moderation/sanctions';

const url = process.env.DATABASE_URL ?? 'postgres://coloxel:coloxel@localhost:5432/coloxel';
const probe = createPool(url);
const available = await probe.query('SELECT 1').then(
  () => true,
  () => false,
);
await probe.end();

describe.skipIf(!available)('doorbell and showing visitors out (PostgreSQL)', () => {
  let pool: pg.Pool;
  let app: ReturnType<typeof buildServer>;
  const told: UserEvent[] = [];
  const decor: [string, string][] = [];
  const online = new Set<string>();

  beforeAll(async () => {
    await migrateDownAll(url).catch(() => {});
    await migrate('up', url);
    pool = createPool(url);
    await pool.query('INSERT INTO apartments (id, floor, slot) SELECT n, 10 + n, 0 FROM generate_series(31, 70) AS n');
    app = buildServer({
      pool,
      model: null,
      notifyUser: (e) => void told.push(e),
      notifyApartment: (ownerId, kind) => void decor.push([ownerId, kind]),
      locate: async (ids) => new Map(ids.filter((id) => online.has(id)).map((id) => [id, { kind: 'hall' as const }])),
    });
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
  const setAccess = (a: Account, access: string) => pool.query('UPDATE users SET apartment_access = $1 WHERE id = $2', [access, a.id]);
  const ring = (who: Account, owner: Account) => app.inject({ method: 'POST', url: `/api/apartments/${owner.id}/ring`, cookies: as(who) });
  const answer = (owner: Account, visitor: Account, accept: unknown) =>
    app.inject({ method: 'POST', url: '/api/apartment/bell/answer', payload: { visitorId: visitor.id, accept } as object, cookies: as(owner) });
  const visit = (viewer: Account, owner: Account) => app.inject({ method: 'GET', url: `/api/apartments/${owner.id}`, cookies: as(viewer) });
  const expel = (owner: Account, target: Account) => app.inject({ method: 'POST', url: `/api/apartment/visitors/${target.id}/expel`, cookies: as(owner) });
  const befriend = async (a: Account, b: Account) => {
    await app.inject({ method: 'POST', url: '/api/friends/requests', payload: { nickname: b.nickname }, cookies: as(a) });
    await app.inject({ method: 'POST', url: `/api/friends/requests/${a.id}/accept`, cookies: as(b) });
  };

  it('requires a session', async () => {
    const a = await signUp('bl_anon_owner');
    expect((await app.inject({ method: 'POST', url: `/api/apartments/${a.id}/ring` })).statusCode).toBe(401);
    expect((await app.inject({ method: 'POST', url: '/api/apartment/bell/answer', payload: {} })).statusCode).toBe(401);
    expect((await app.inject({ method: 'POST', url: `/api/apartment/visitors/${a.id}/expel` })).statusCode).toBe(401);
  });

  it('lets a visitor ring, the owner answer, and the answer open the door for a while', async () => {
    const owner = await signUp('bl_owner');
    const visitor = await signUp('bl_visitor');
    await setAccess(owner, 'bell');
    online.add(owner.id);
    expect((await visit(visitor, owner)).statusCode).toBe(404);
    // The building view says the door is closed to them, but that they may ring.
    const list = (await app.inject({ method: 'GET', url: '/api/building', cookies: as(visitor) })).json().apartments as { owner: { id: string } | null; open: boolean; canRing: boolean }[];
    expect(list.find((a) => a.owner?.id === owner.id)).toMatchObject({ open: false, canRing: true });

    told.length = 0;
    const rung = await ring(visitor, owner);
    expect(rung.statusCode).toBe(202);
    expect(told).toEqual([{ userId: owner.id, kind: 'ring', visitorId: visitor.id, nickname: 'bl_visitor' }]);
    // Ringing again at once is refused.
    expect((await ring(visitor, owner)).statusCode).toBe(429);

    expect((await answer(owner, visitor, true)).statusCode).toBe(200);
    expect(told.at(-1)).toMatchObject({ userId: visitor.id, kind: 'bell-answer', ownerId: owner.id, accepted: true });
    expect((await visit(visitor, owner)).statusCode).toBe(200);
    // Somebody else on the doorstep is still outside.
    const other = await signUp('bl_other');
    expect((await visit(other, owner)).statusCode).toBe(404);
    // Welcome ends with the grant.
    await pool.query("UPDATE bell_grants SET expires_at = now() - interval '1 minute'");
    expect((await visit(visitor, owner)).statusCode).toBe(404);
  });

  it('keeps the door shut when the owner says no, and tells the visitor', async () => {
    const owner = await signUp('bl_no_owner');
    const visitor = await signUp('bl_no_visitor');
    await setAccess(owner, 'bell');
    online.add(owner.id);
    await ring(visitor, owner);
    expect((await answer(owner, visitor, false)).statusCode).toBe(200);
    expect(told.at(-1)).toMatchObject({ userId: visitor.id, kind: 'bell-answer', accepted: false });
    expect((await visit(visitor, owner)).statusCode).toBe(404);
  });

  it('only opens the owner’s own door: answering for somebody else’s apartment does nothing', async () => {
    const owner = await signUp('bl_victim');
    const intruder = await signUp('bl_intruder');
    const friend = await signUp('bl_accomplice');
    await setAccess(owner, 'bell');
    // The intruder "accepts" the accomplice: that is a grant on the intruder's own door.
    expect((await answer(intruder, friend, true)).statusCode).toBe(200);
    expect((await visit(friend, owner)).statusCode).toBe(404);
    expect((await app.inject({ method: 'POST', url: '/api/apartment/bell/answer', payload: { visitorId: friend.id, accept: true, ownerId: owner.id }, cookies: as(intruder) })).statusCode).toBe(400);
    for (const bad of [{ visitorId: 'x', accept: true }, { visitorId: friend.id, accept: 'yes' }, { accept: true }]) {
      expect((await app.inject({ method: 'POST', url: '/api/apartment/bell/answer', payload: bad, cookies: as(owner) })).statusCode).toBe(400);
    }
  });

  it('refuses to ring where there is no bell, at oneself, or at somebody who is not there', async () => {
    const closed = await signUp('bl_closed');
    const open = await signUp('bl_open');
    const away = await signUp('bl_away');
    const visitor = await signUp('bl_ringer');
    await setAccess(open, 'building');
    await setAccess(away, 'bell');
    // An apartment that is closed gives no hint that it exists: same answer as an unknown one.
    expect((await ring(visitor, closed)).statusCode).toBe(404);
    expect((await ring(visitor, open)).statusCode).toBe(404);
    expect((await ring(away, away)).statusCode).toBe(404);
    expect((await app.inject({ method: 'POST', url: '/api/apartments/not-a-uuid/ring', cookies: as(visitor) })).statusCode).toBe(404);
    const noOne = await ring(visitor, away);
    expect(noOne.statusCode).toBe(409);
    expect(noOne.json().error).toMatch(/pas là/);
  });

  it('lets an owner give a friend the rights to move and turn placed pieces, and nothing else', async () => {
    const owner = await signUp('rt_owner');
    const friend = await signUp('rt_friend');
    const stranger = await signUp('rt_stranger');
    await pool.query("UPDATE users SET apartment_access = 'building' WHERE id = $1", [owner.id]);
    const furniture = async (who: Account) => (await app.inject({ method: 'GET', url: '/api/inventory', cookies: as(who) })).json().furniture as { id: string; key: string; placement: { i: number; j: number } | null }[];
    const chair = (await furniture(owner)).find((f) => f.key === 'chaise')!;
    const arrange = (who: Account, body: object) => app.inject({ method: 'PUT', url: `/api/apartments/${owner.id}/placements`, payload: body, cookies: as(who) });
    const grant = (who: Account, to: Account) => app.inject({ method: 'PUT', url: `/api/apartment/rights/${to.id}`, cookies: as(who) });
    // No rights, no moving; rights go to friends only.
    expect((await arrange(friend, { itemId: chair.id, i: 6, j: 7 })).statusCode).toBe(403);
    expect((await grant(owner, stranger)).statusCode).toBe(409);
    await befriend(owner, friend);
    expect((await grant(owner, friend)).statusCode).toBe(204);
    expect((await visit(friend, owner)).json().canArrange).toBe(true);
    expect((await visit(stranger, owner)).json().canArrange).toBe(false);
    // The friend moves the owner's chair; the chair stays the owner's.
    expect((await arrange(friend, { itemId: chair.id, i: 6, j: 7 })).statusCode).toBe(200);
    expect((await furniture(owner)).find((f) => f.id === chair.id)!.placement).toMatchObject({ i: 6, j: 7 });
    // Nothing new is placed by a friend: only what is already placed moves.
    const spare = (await app.inject({ method: 'POST', url: '/api/furniture', payload: { key: 'pouf' }, cookies: as(owner) })).json().furniture.id as string;
    expect((await arrange(friend, { itemId: spare, i: 6, j: 8 })).statusCode).toBe(404);
    // Taken back, the rights are gone.
    expect((await app.inject({ method: 'DELETE', url: `/api/apartment/rights/${friend.id}`, cookies: as(owner) })).statusCode).toBe(204);
    expect((await arrange(friend, { itemId: chair.id, i: 6, j: 6 })).statusCode).toBe(403);
  });

  it('lets friends walk in on a bell apartment, without ringing', async () => {
    const owner = await signUp('bl_fr_owner');
    const friend = await signUp('bl_fr_friend');
    await setAccess(owner, 'bell');
    await befriend(owner, friend);
    expect((await visit(friend, owner)).statusCode).toBe(200);
    expect((await ring(friend, owner)).json()).toEqual({ status: 'open' });
  });

  it('closes the door on a grant when the owner changes the setting', async () => {
    const owner = await signUp('bl_set_owner');
    const visitor = await signUp('bl_set_visitor');
    await setAccess(owner, 'bell');
    await answer(owner, visitor, true);
    expect((await visit(visitor, owner)).statusCode).toBe(200);
    await app.inject({ method: 'PUT', url: '/api/apartment', payload: { access: 'closed' }, cookies: as(owner) });
    expect((await visit(visitor, owner)).statusCode).toBe(404);
  });

  describe('showing somebody out', () => {
    it('keeps the expelled player out for a while, even of an apartment open to everybody, and tells the room', async () => {
      const owner = await signUp('bl_ex_owner');
      const pest = await signUp('bl_ex_pest');
      const guest = await signUp('bl_ex_guest');
      await setAccess(owner, 'building');
      expect((await visit(pest, owner)).statusCode).toBe(200);
      decor.length = 0;
      expect((await expel(owner, pest)).statusCode).toBe(200);
      expect(decor).toContainEqual([owner.id, 'access']);
      expect((await visit(pest, owner)).statusCode).toBe(404);
      expect((await visit(guest, owner)).statusCode).toBe(200);
      // On the doorbell, the pest is not even allowed to ring.
      await setAccess(owner, 'bell');
      expect((await ring(pest, owner)).statusCode).toBe(403);
      // The owner can change their mind: letting them in again lifts the ban.
      expect((await answer(owner, pest, true)).statusCode).toBe(200);
      expect((await visit(pest, owner)).statusCode).toBe(200);
    });

    it('takes away what let the player in, and cannot be done by a visitor, to oneself, or to nobody', async () => {
      const owner = await signUp('bl_ex2_owner');
      const visitor = await signUp('bl_ex2_visitor');
      await setAccess(owner, 'bell');
      await answer(owner, visitor, true);
      expect((await expel(owner, visitor)).statusCode).toBe(200);
      expect((await visit(visitor, owner)).statusCode).toBe(404);

      expect((await expel(owner, owner)).statusCode).toBe(404);
      expect((await app.inject({ method: 'POST', url: '/api/apartment/visitors/00000000-0000-4000-8000-000000000000/expel', cookies: as(owner) })).statusCode).toBe(404);
      // A visitor "expelling" the owner only bans the owner from the visitor's own apartment.
      await setAccess(visitor, 'building');
      await expel(visitor, owner);
      await setAccess(owner, 'building');
      expect((await visit(visitor, owner)).statusCode).toBe(404); // still shown out by the owner
      expect((await visit(owner, visitor)).statusCode).toBe(404);
    });
  });
});
