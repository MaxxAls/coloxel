import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SEEDS } from '@coloxel/render';
import { migrate, migrateDownAll } from '../src/db/migrate';
import { createPool } from '../src/db/pool';
import { MAX_PENDING } from '../src/friends/routes';
import { buildServer } from '../src/index';
import type { Location } from '../src/realtime/where';

const url = process.env.DATABASE_URL ?? 'postgres://coloxel:coloxel@localhost:5432/coloxel';
const probe = createPool(url);
const available = await probe.query('SELECT 1').then(
  () => true,
  () => false,
);
await probe.end();

describe.skipIf(!available)('friends (PostgreSQL)', () => {
  let pool: pg.Pool;
  let app: ReturnType<typeof buildServer>;
  let places = new Map<string, Location>();
  const notified: [string, string][] = [];

  beforeAll(async () => {
    await migrateDownAll(url).catch(() => {});
    await migrate('up', url);
    pool = createPool(url);
    // More players than the real building holds: the sign-ups of this file need a flat each.
    await pool.query('INSERT INTO apartments (id, floor, slot) SELECT n, 10 + n, 0 FROM generate_series(31, 90) AS n');
    app = buildServer({
      pool,
      model: null,
      locate: async (ids) => new Map([...places].filter(([id]) => ids.includes(id))),
      notifyApartment: (ownerId, kind) => void notified.push([ownerId, kind]),
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
  const ask = (from: Account, nickname: string) =>
    app.inject({ method: 'POST', url: '/api/friends/requests', payload: { nickname }, cookies: as(from) });
  const accept = (who: Account, requesterId: string) =>
    app.inject({ method: 'POST', url: `/api/friends/requests/${requesterId}/accept`, cookies: as(who) });
  const remove = (who: Account, otherId: string) => app.inject({ method: 'DELETE', url: `/api/friends/${otherId}`, cookies: as(who) });
  const lists = async (who: Account) => (await app.inject({ method: 'GET', url: '/api/friends', cookies: as(who) })).json();
  const befriend = async (a: Account, b: Account) => {
    await ask(a, b.nickname);
    expect((await accept(b, a.id)).statusCode).toBe(200);
  };
  const setAccess = (a: Account, access: string) => pool.query('UPDATE users SET apartment_access = $1 WHERE id = $2', [access, a.id]);
  const visit = (viewer: Account, owner: Account) => app.inject({ method: 'GET', url: `/api/apartments/${owner.id}`, cookies: as(viewer) });

  it('requires a session', async () => {
    expect((await app.inject({ method: 'GET', url: '/api/friends' })).statusCode).toBe(401);
    expect((await app.inject({ method: 'POST', url: '/api/friends/requests', payload: { nickname: 'x' } })).statusCode).toBe(401);
    expect((await app.inject({ method: 'DELETE', url: '/api/friends/00000000-0000-4000-8000-000000000000' })).statusCode).toBe(401);
  });

  it('asks, accepts, and lists both sides', async () => {
    const ana = await signUp('fr_ana');
    const ben = await signUp('fr_ben');

    const res = await ask(ana, 'FR_BEN');
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ status: 'pending', to: { nickname: 'fr_ben' } });
    expect(await lists(ana)).toMatchObject({ friends: [], incoming: [], outgoing: [{ id: ben.id }] });
    expect(await lists(ben)).toMatchObject({ friends: [], incoming: [{ id: ana.id, nickname: 'fr_ana' }], outgoing: [] });

    // Only the person asked can say yes.
    expect((await accept(ana, ben.id)).statusCode).toBe(404);
    expect((await accept(ben, ana.id)).statusCode).toBe(200);
    expect((await lists(ana)).friends).toMatchObject([{ id: ben.id, nickname: 'fr_ben', online: false, where: null }]);
    expect((await lists(ben)).friends).toMatchObject([{ id: ana.id }]);
    expect((await lists(ben)).incoming).toEqual([]);
    // Accepting twice finds nothing to accept.
    expect((await accept(ben, ana.id)).statusCode).toBe(404);
  });

  it('refuses requests to oneself, to nobody, twice, or to a friend', async () => {
    const cleo = await signUp('fr_cleo');
    const dan = await signUp('fr_dan');
    expect((await ask(cleo, 'fr_cleo')).statusCode).toBe(400);
    expect((await ask(cleo, 'personne_ici')).statusCode).toBe(404);
    expect((await app.inject({ method: 'POST', url: '/api/friends/requests', payload: { nickname: '' }, cookies: as(cleo) })).statusCode).toBe(400);
    expect((await app.inject({ method: 'POST', url: '/api/friends/requests', payload: { nickname: 'fr_dan', extra: 1 }, cookies: as(cleo) })).statusCode).toBe(400);
    expect((await ask(cleo, 'fr_dan')).statusCode).toBe(201);
    expect((await ask(cleo, 'fr_dan')).statusCode).toBe(409);
    await accept(dan, cleo.id);
    expect((await ask(cleo, 'fr_dan')).statusCode).toBe(409);
    expect((await ask(dan, 'fr_cleo')).statusCode).toBe(409);
  });

  it('turns two requests, one each way, into a friendship', async () => {
    const eva = await signUp('fr_eva');
    const fox = await signUp('fr_fox');
    expect((await ask(eva, 'fr_fox')).statusCode).toBe(201);
    const back = await ask(fox, 'fr_eva');
    expect(back.statusCode).toBe(200);
    expect(back.json().status).toBe('accepted');
    expect((await lists(eva)).friends).toHaveLength(1);
    const rows = await pool.query('SELECT * FROM friendships WHERE requester_id IN ($1, $2)', [eva.id, fox.id]);
    expect(rows.rowCount).toBe(1);
  });

  it('lets either friend end a friendship, and a player refuse or withdraw a request', async () => {
    const gil = await signUp('fr_gil');
    const hana = await signUp('fr_hana');
    const ivo = await signUp('fr_ivo');
    await befriend(gil, hana);
    expect((await remove(hana, gil.id)).statusCode).toBe(204);
    expect((await lists(gil)).friends).toEqual([]);
    expect((await remove(hana, gil.id)).statusCode).toBe(404);

    await ask(gil, 'fr_ivo');
    expect((await remove(ivo, gil.id)).statusCode).toBe(204); // refused
    expect((await lists(ivo)).incoming).toEqual([]);
    await ask(gil, 'fr_ivo');
    expect((await remove(gil, ivo.id)).statusCode).toBe(204); // withdrawn
    expect((await lists(ivo)).incoming).toEqual([]);
    expect((await remove(gil, 'not-a-uuid')).statusCode).toBe(404);
  });

  it('limits the requests waiting for an answer', async () => {
    const spam = await signUp('fr_spam');
    const targets = await Promise.all(Array.from({ length: MAX_PENDING + 1 }, (_, k) => signUp(`fr_t${k}`)));
    for (const t of targets.slice(0, MAX_PENDING)) expect((await ask(spam, t.nickname)).statusCode).toBe(201);
    const over = await ask(spam, targets[MAX_PENDING]!.nickname);
    expect(over.statusCode).toBe(400);
    expect(over.json().error).toMatch(/trop de demandes/);
  });

  it('shows friends where they are, and only lets the player follow them where they may enter', async () => {
    const jo = await signUp('fr_jo');
    const kim = await signUp('fr_kim');
    const lou = await signUp('fr_lou');
    const mel = await signUp('fr_mel');
    await befriend(jo, kim);
    await befriend(jo, lou);
    await befriend(jo, mel);
    await pool.query('UPDATE apartments SET name = $1 WHERE owner_id = $2', ['Le grenier', kim.id]);
    await setAccess(kim, 'building');
    // Kim is at home (open), Lou is in the hall, Mel is somewhere private.
    places = new Map<string, Location>([
      [kim.id, { kind: 'apartment', ownerId: kim.id }],
      [lou.id, { kind: 'hall' }],
      [mel.id, { kind: 'apartment', ownerId: mel.id }],
    ]);
    const friends = (await lists(jo)).friends as { nickname: string; online: boolean; where: string; target: unknown }[];
    expect(friends.map((f) => [f.nickname, f.online, f.where, f.target])).toEqual([
      ['fr_kim', true, 'Le grenier', { kind: 'apartment', ownerId: kim.id }],
      ['fr_lou', true, 'Dans le hall', { kind: 'hall' }],
      ['fr_mel', true, 'Dans un appart privé', null],
    ]);

    // The navigator's friends tab: only those one click away.
    const nav = (await app.inject({ method: 'GET', url: '/api/navigator', cookies: as(jo) })).json();
    expect(nav.friends.map((f: { nickname: string }) => f.nickname)).toEqual(['fr_kim', 'fr_lou']);
    expect(nav.friends[0]).toMatchObject({ id: kim.id, where: 'Le grenier', target: { kind: 'apartment', ownerId: kim.id } });

    // Strangers never learn where anybody is.
    const stranger = await signUp('fr_stranger');
    const strangerView = await lists(stranger);
    expect(strangerView).toEqual({ friends: [], incoming: [], outgoing: [] });
    expect((await app.inject({ method: 'GET', url: '/api/navigator', cookies: as(stranger) })).json().friends).toEqual([]);
    places = new Map();
  });

  describe('an apartment opened to friends', () => {
    it('is open to friends, and closed to everybody else', async () => {
      const nao = await signUp('fr_nao');
      const oli = await signUp('fr_oli');
      const pam = await signUp('fr_pam');
      await befriend(nao, oli);
      await setAccess(nao, 'friends');
      expect((await visit(oli, nao)).statusCode).toBe(200);
      expect((await visit(pam, nao)).statusCode).toBe(404);
      // The building view tells each player whether they may walk in.
      const apartments = (await app.inject({ method: 'GET', url: '/api/building', cookies: as(oli) })).json().apartments as { owner: { id: string } | null; open: boolean }[];
      expect(apartments.find((a) => a.owner?.id === nao.id)?.open).toBe(true);
      const strangerView = (await app.inject({ method: 'GET', url: '/api/building', cookies: as(pam) })).json().apartments as typeof apartments;
      expect(strangerView.find((a) => a.owner?.id === nao.id)?.open).toBe(false);
      // Not listed among the apartments open to the whole building.
      const nav = (await app.inject({ method: 'GET', url: '/api/navigator', cookies: as(pam) })).json();
      expect(nav.open.some((o: { ownerId: string }) => o.ownerId === nao.id)).toBe(false);
    });

    it('also lets friends see the sprites of what is placed inside', async () => {
      const quin = await signUp('fr_quin');
      const rae = await signUp('fr_rae');
      const sol = await signUp('fr_sol');
      const item = (
        await pool.query<{ id: string }>(
          `INSERT INTO items (serial, name, description, recipe, creator_id, owner_id)
           VALUES ((SELECT COALESCE(max(serial), 0) + 1 FROM items), 'Lampe', 'une lampe', $1, $2, $2) RETURNING id`,
          [JSON.stringify({ name: 'Lampe', parts: SEEDS[0]!.parts }), quin.id],
        )
      ).rows[0]!.id;
      await pool.query('INSERT INTO placements (item_id, user_id, i, j) VALUES ($1, $2, 3, 3)', [item, quin.id]);
      await befriend(quin, rae);
      await setAccess(quin, 'friends');
      const sprite = (viewer: Account) => app.inject({ method: 'GET', url: `/api/items/${item}.png`, cookies: as(viewer) });
      expect((await sprite(rae)).statusCode).toBe(200);
      expect((await sprite(sol)).statusCode).toBe(404);
    });

    it('stops being open to a friend the moment the friendship ends, and the apartment’s room is told', async () => {
      const tia = await signUp('fr_tia');
      const uli = await signUp('fr_uli');
      await befriend(tia, uli);
      await setAccess(tia, 'friends');
      expect((await visit(uli, tia)).statusCode).toBe(200);
      notified.length = 0;
      expect((await remove(uli, tia.id)).statusCode).toBe(204);
      expect((await visit(uli, tia)).statusCode).toBe(404);
      expect(notified).toEqual(expect.arrayContaining([[tia.id, 'access'], [uli.id, 'access']]));
    });
  });
});
