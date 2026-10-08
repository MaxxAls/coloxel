import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SEEDS } from '@coloxel/render';
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

// A description with "grand" asks for a piece two tiles long; "immense" for three by two.
const model: RecipeModel = async (prompt) => {
  const wanted = prompt.split('Description du joueur :')[1] ?? '';
  const size = wanted.includes('immense') ? [3, 2] : wanted.includes('grand') ? [2, 1] : undefined;
  return JSON.stringify({ nom: 'Lampe test', parts: SEEDS[0]!.parts, ...(size ? { size } : {}) });
};

describe.skipIf(!available)('inventory and placements (PostgreSQL)', () => {
  let pool: pg.Pool;
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
    if (res.statusCode !== 201 && res.statusCode !== 200) throw new Error(`register failed: ${res.statusCode} ${res.body}`);
    // These tests place creations on cells of their own choosing: start from a bare apartment.
    await pool.query('DELETE FROM furniture WHERE owner_id = $1', [res.json().user.id]);
    return res.cookies.find((c) => c.name === 'coloxel_sid')!.value;
  }
  const as = (sid: string) => ({ coloxel_sid: sid });
  const createItem = async (sid: string, description = 'une lampe') => {
    const res = await app.inject({ method: 'POST', url: '/api/creations', payload: { description }, cookies: as(sid) });
    if (res.statusCode !== 201) throw new Error(`creation failed: ${res.statusCode} ${res.body}`);
    return res.json().item.id as string;
  };
  const place = (sid: string, body: unknown) =>
    app.inject({ method: 'PUT', url: '/api/placements', payload: body as object, cookies: as(sid) });
  const inventory = async (sid: string) =>
    (await app.inject({ method: 'GET', url: '/api/inventory', cookies: as(sid) })).json().items as {
      id: string;
      placement: { i: number; j: number; rot: number; w: number; h: number } | null;
    }[];

  it('requires a session', async () => {
    expect((await app.inject({ method: 'GET', url: '/api/inventory' })).statusCode).toBe(401);
    expect((await app.inject({ method: 'PUT', url: '/api/placements', payload: {} })).statusCode).toBe(401);
    const del = await app.inject({ method: 'DELETE', url: '/api/placements/00000000-0000-4000-8000-000000000000' });
    expect(del.statusCode).toBe(401);
  });

  it('lists only the owner’s items with their placement', async () => {
    const alice = await signUp('alice');
    const bob = await signUp('bob');
    const a = await createItem(alice);
    await createItem(bob);
    expect(await inventory(alice)).toEqual([expect.objectContaining({ id: a, placement: null })]);
    expect((await place(alice, { itemId: a, i: 3, j: 4 })).statusCode).toBe(200);
    const [item] = await inventory(alice);
    expect(item!.placement).toEqual({ i: 3, j: 4, rot: 0, w: 1, h: 1 });
    expect(item).toMatchObject({ serial: 1, editionNumber: 1, editionSize: 1, creator: 'alice' });
  });

  it('moves an already placed item, including onto its own cell', async () => {
    const sid = await signUp('carol');
    const id = await createItem(sid);
    expect((await place(sid, { itemId: id, i: 0, j: 0 })).statusCode).toBe(200);
    expect((await place(sid, { itemId: id, i: 0, j: 0 })).statusCode).toBe(200);
    expect((await place(sid, { itemId: id, i: 7, j: 7 })).statusCode).toBe(200);
    expect((await inventory(sid))[0]!.placement).toEqual({ i: 7, j: 7, rot: 0, w: 1, h: 1 });
  });

  it('refuses an occupied cell', async () => {
    const sid = await signUp('dave');
    const first = await createItem(sid, 'objet un');
    const second = await createItem(sid, 'objet deux');
    expect((await place(sid, { itemId: first, i: 2, j: 2 })).statusCode).toBe(200);
    expect((await place(sid, { itemId: second, i: 2, j: 2 })).statusCode).toBe(409);
    expect((await inventory(sid)).find((x) => x.id === second)!.placement).toBeNull();
  });

  it('lets only one of two simultaneous placements on the same cell win', async () => {
    const sid = await signUp('erin');
    const first = await createItem(sid, 'objet un');
    const second = await createItem(sid, 'objet deux');
    const codes = (
      await Promise.all([place(sid, { itemId: first, i: 5, j: 5 }), place(sid, { itemId: second, i: 5, j: 5 })])
    )
      .map((r) => r.statusCode)
      .sort();
    expect(codes).toEqual([200, 409]);
  });

  it('refuses another player’s item', async () => {
    const owner = await signUp('frank');
    const thief = await signUp('ivana');
    const id = await createItem(owner);
    expect((await place(thief, { itemId: id, i: 1, j: 1 })).statusCode).toBe(404);
    expect((await inventory(thief)).length).toBe(0);
    await place(owner, { itemId: id, i: 1, j: 1 });
    const del = await app.inject({ method: 'DELETE', url: `/api/placements/${id}`, cookies: as(thief) });
    expect(del.statusCode).toBe(404);
    expect((await inventory(owner))[0]!.placement).toEqual({ i: 1, j: 1, rot: 0, w: 1, h: 1 });
  });

  it('refuses malformed placements', async () => {
    const sid = await signUp('jules');
    const id = await createItem(sid);
    for (const body of [
      { itemId: id, i: 16, j: 0 },
      { itemId: id, i: 0, j: -1 },
      { itemId: id, i: 1.5, j: 0 },
      { itemId: id, i: '1', j: 0 },
      { itemId: 'pas-un-uuid', i: 0, j: 0 },
      { i: 0, j: 0 },
      null,
    ]) {
      expect((await place(sid, body)).statusCode).toBe(400);
    }
    expect((await place(sid, { itemId: '00000000-0000-4000-8000-000000000000', i: 0, j: 0 })).statusCode).toBe(404);
    expect((await inventory(sid))[0]!.placement).toBeNull();
  });

  it('covers every tile of a multi-tile piece, and turns its footprint with it', async () => {
    const sid = await signUp('multia');
    const big = await createItem(sid, 'un grand canapé');
    const small = await createItem(sid, 'une petite lampe');
    expect((await place(sid, { itemId: big, i: 2, j: 2 })).json().placement).toMatchObject({ i: 2, j: 2, w: 2, h: 1 });
    // The second tile is taken too, from either side.
    expect((await place(sid, { itemId: small, i: 3, j: 2 })).statusCode).toBe(409);
    expect((await place(sid, { itemId: small, i: 4, j: 2 })).statusCode).toBe(200);
    // Now 3,2 is free of anything but the big piece; the big piece cannot slide onto the small one.
    expect((await place(sid, { itemId: big, i: 3, j: 2 })).statusCode).toBe(409);
    // Turned a quarter turn it covers (2,2) and (2,3) instead.
    const turned = await place(sid, { itemId: big, i: 2, j: 2, rot: 1 });
    expect(turned.statusCode).toBe(200);
    expect(turned.json().placement).toMatchObject({ w: 1, h: 2 });
    expect((await place(sid, { itemId: small, i: 3, j: 2 })).statusCode).toBe(200);
    expect((await place(sid, { itemId: small, i: 2, j: 3 })).statusCode).toBe(409);
  });

  it('keeps a multi-tile piece inside the floor', async () => {
    const sid = await signUp('multib');
    const big = await createItem(sid, 'un immense lit');
    // A new apartment is 10 x 10 cells: the floor ends at i = 9 and j = 9.
    expect((await place(sid, { itemId: big, i: 8, j: 0 })).statusCode).toBe(400); // 3 wide from i = 8 leaves the floor
    expect((await place(sid, { itemId: big, i: 5, j: 9 })).statusCode).toBe(400); // 2 deep from j = 9 leaves the floor
    expect((await place(sid, { itemId: big, i: 5, j: 8 })).statusCode).toBe(200);
    // Turning it in place must not push it off the floor.
    expect((await place(sid, { itemId: big, i: 5, j: 8, rot: 1 })).statusCode).toBe(400);
  });

  it('removes a placement and frees the cell', async () => {
    const sid = await signUp('iris');
    const first = await createItem(sid, 'objet un');
    const second = await createItem(sid, 'objet deux');
    await place(sid, { itemId: first, i: 4, j: 4 });
    const del = await app.inject({ method: 'DELETE', url: `/api/placements/${first}`, cookies: as(sid) });
    expect(del.statusCode).toBe(204);
    expect((await app.inject({ method: 'DELETE', url: `/api/placements/${first}`, cookies: as(sid) })).statusCode).toBe(404);
    expect((await place(sid, { itemId: second, i: 4, j: 4 })).statusCode).toBe(200);
    expect(
      (await app.inject({ method: 'DELETE', url: '/api/placements/pas-un-uuid', cookies: as(sid) })).statusCode,
    ).toBe(404);
  });

  describe('item sprites for visitors', () => {
    const sprite = (sid: string, id: string) =>
      app.inject({ method: 'GET', url: `/api/items/${id}.png`, cookies: as(sid) });
    const setAccess = (nickname: string, access: string) =>
      pool.query('UPDATE users SET apartment_access = $1 WHERE nickname = $2', [access, nickname]);

    it('serves a placed item to visitors only when the apartment is open to them', async () => {
      const host = await signUp('hostess');
      const visitor = await signUp('visitor');
      const id = await createItem(host);
      await place(host, { itemId: id, i: 1, j: 1 });

      expect((await sprite(host, id)).statusCode).toBe(200);
      // Closed by default.
      expect((await sprite(visitor, id)).statusCode).toBe(404);
      // 'friends' fails closed until the friends list exists.
      await setAccess('hostess', 'friends');
      expect((await sprite(visitor, id)).statusCode).toBe(404);
      await setAccess('hostess', 'building');
      const res = await sprite(visitor, id);
      expect(res.statusCode).toBe(200);
      expect(res.headers['content-type']).toBe('image/png');
      // Access is checked on every request, even once the PNG is cached.
      await setAccess('hostess', 'closed');
      expect((await sprite(visitor, id)).statusCode).toBe(404);
      expect((await sprite(host, id)).statusCode).toBe(200);
    });

    it('never serves an item that is not placed, even from an open apartment', async () => {
      const host = await signUp('hostess2');
      const visitor = await signUp('visitor2');
      await setAccess('hostess2', 'building');
      const id = await createItem(host);
      expect((await sprite(visitor, id)).statusCode).toBe(404);
      await place(host, { itemId: id, i: 0, j: 0 });
      expect((await sprite(visitor, id)).statusCode).toBe(200);
      await app.inject({ method: 'DELETE', url: `/api/placements/${id}`, cookies: as(host) });
      expect((await sprite(visitor, id)).statusCode).toBe(404);
    });
  });

  describe('only the owner arranges an apartment', () => {
    it('refuses a visitor who tries to place, move or put away anything in someone else’s apartment', async () => {
      const owner = await signUp('landlady');
      const visitor = await signUp('guest');
      await pool.query("UPDATE users SET apartment_access = 'building' WHERE nickname = 'landlady'");
      const ownerItem = await createItem(owner);
      await place(owner, { itemId: ownerItem, i: 2, j: 2 });
      const visitorItem = await createItem(visitor);
      const ownerId = (await pool.query("SELECT id FROM users WHERE nickname = 'landlady'")).rows[0].id as string;
      const decor = async () =>
        (await app.inject({ method: 'GET', url: `/api/apartments/${ownerId}`, cookies: as(visitor) })).json().items as {
          id: string;
          placement: { i: number; j: number; rot: number };
        }[];
      const before = await decor();
      expect(before).toEqual([expect.objectContaining({ id: ownerItem, placement: { i: 2, j: 2, rot: 0, w: 1, h: 1 } })]);

      // Moving the owner's object, putting it away, adding to the owner's apartment: all refused.
      expect((await place(visitor, { itemId: ownerItem, i: 5, j: 5 })).statusCode).toBe(404);
      const away = await app.inject({ method: 'DELETE', url: `/api/placements/${ownerItem}`, cookies: as(visitor) });
      expect(away.statusCode).toBe(404);
      // The only apartment a placement can land in is the placer's own: the owner's is untouched.
      expect((await place(visitor, { itemId: visitorItem, i: 4, j: 4 })).statusCode).toBe(200);
      expect(await decor()).toEqual(before);
      // No request carries an apartment id: forging one changes nothing.
      const forged = await app.inject({
        method: 'PUT',
        url: '/api/placements',
        payload: { itemId: visitorItem, i: 6, j: 6, ownerId, userId: ownerId },
        cookies: as(visitor),
      });
      expect([200, 400]).toContain(forged.statusCode);
      expect(await decor()).toEqual(before);
    });
  });
  describe('rotation', () => {
    it('keeps the way a piece faces, serves a turned sprite, and refuses bad turns', async () => {
      const sid = await signUp('turner');
      const id = await createItem(sid);
      const placed = await place(sid, { itemId: id, i: 3, j: 3 });
      expect(placed.json().placement.rot).toBe(0);

      const turned = await place(sid, { itemId: id, i: 3, j: 3, rot: 1 });
      expect(turned.statusCode).toBe(200);
      expect(turned.json().placement.rot).toBe(1);

      // A move without a turn keeps the orientation.
      const moved = await place(sid, { itemId: id, i: 4, j: 4 });
      expect(moved.json().placement).toMatchObject({ i: 4, j: 4, rot: 1 });
      const listed = (await app.inject({ method: 'GET', url: '/api/inventory', cookies: as(sid) })).json().items as {
        id: string;
        placement: { rot: number } | null;
      }[];
      expect(listed.find((it) => it.id === id)?.placement?.rot).toBe(1);

      for (const rot of [4, -1, 1.5, 'x']) {
        expect((await place(sid, { itemId: id, i: 4, j: 4, rot })).statusCode).toBe(400);
      }

      const sprite = (r: number) =>
        app.inject({ method: 'GET', url: `/api/items/${id}.png?r=${r}`, cookies: as(sid) });
      const [a, b, c] = await Promise.all([sprite(0), sprite(1), sprite(4)]);
      expect(a.statusCode).toBe(200);
      expect(a.rawPayload.equals(b.rawPayload)).toBe(false);
      expect(a.rawPayload.equals(c.rawPayload)).toBe(true);
    });
  });
});
