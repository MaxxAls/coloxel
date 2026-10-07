import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CATALOGUE, FLOORS, SEEDS, STARTER_KIT, WALLS } from '@coloxel/render';
import type { RecipeModel } from '../src/creations/model';
import { migrate, migrateDownAll } from '../src/db/migrate';
import { createPool } from '../src/db/pool';
import { MAX_FURNITURE_PER_PLAYER } from '../src/furniture/routes';
import { buildServer } from '../src/index';

const url = process.env.DATABASE_URL ?? 'postgres://coloxel:coloxel@localhost:5432/coloxel';
const probe = createPool(url);
const available = await probe.query('SELECT 1').then(
  () => true,
  () => false,
);
await probe.end();

const model: RecipeModel = async () => JSON.stringify({ nom: 'Lampe test', parts: SEEDS[0]!.parts });

interface Furniture {
  id: string;
  key: string;
  name: string;
  placement: { i: number; j: number } | null;
}

describe.skipIf(!available)('base furniture (PostgreSQL)', () => {
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
    return { id: res.json().user.id as string, sid: res.cookies.find((c) => c.name === 'coloxel_sid')!.value };
  }
  const as = (sid: string) => ({ coloxel_sid: sid });
  const inventory = async (sid: string) =>
    (await app.inject({ method: 'GET', url: '/api/inventory', cookies: as(sid) })).json() as {
      items: { id: string; placement: { i: number; j: number } | null }[];
      furniture: Furniture[];
    };
  const take = (sid: string, key: unknown) =>
    app.inject({ method: 'POST', url: '/api/furniture', payload: { key } as object, cookies: as(sid) });
  const place = (sid: string, itemId: string, i: number, j: number) =>
    app.inject({ method: 'PUT', url: '/api/placements', payload: { itemId, i, j }, cookies: as(sid) });
  const create = async (sid: string) =>
    (await app.inject({ method: 'POST', url: '/api/creations', payload: { description: 'une lampe' }, cookies: as(sid) })).json()
      .item as { id: string; serial: number };
  const lastSerial = async () => (await pool.query('SELECT last_value FROM item_serial')).rows[0].last_value as number;
  const itemCount = async () => (await pool.query('SELECT count(*)::int AS n FROM items')).rows[0].n as number;

  it('serves the catalogue to signed-in players only: twenty free pieces, ten floors, ten wallpapers', async () => {
    expect((await app.inject({ method: 'GET', url: '/api/catalogue' })).statusCode).toBe(401);
    const { sid } = await signUp('alice');
    const res = await app.inject({ method: 'GET', url: '/api/catalogue', cookies: as(sid) });
    const body = res.json();
    expect(body.furniture).toHaveLength(CATALOGUE.length);
    expect(body.furniture.every((f: { price: number }) => f.price === 0)).toBe(true);
    expect(body.floors).toHaveLength(FLOORS.length);
    expect(body.walls).toHaveLength(WALLS.length);
  });

  it('draws catalogue sprites with the shared engine, and 404s on unknown keys', async () => {
    const { sid } = await signUp('bob');
    const ok = await app.inject({ method: 'GET', url: '/api/catalogue/lit.png', cookies: as(sid) });
    expect(ok.statusCode).toBe(200);
    expect(ok.headers['content-type']).toBe('image/png');
    expect(ok.rawPayload.subarray(1, 4).toString()).toBe('PNG');
    // Clients add the sprite version to the URL so that old cached images are never reused.
    expect((await app.inject({ method: 'GET', url: '/api/catalogue/lit.png?v=2', cookies: as(sid) })).statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: '/api/catalogue/licorne.png', cookies: as(sid) })).statusCode).toBe(404);
    expect((await app.inject({ method: 'GET', url: '/api/catalogue/lit.png' })).statusCode).toBe(401);
  });

  it('moves a new player into an apartment already furnished by the starter kit', async () => {
    const before = await lastSerial();
    const { id, sid } = await signUp('carol');
    const inv = await inventory(sid);
    expect(inv.items).toEqual([]);
    expect(inv.furniture).toHaveLength(STARTER_KIT.length);
    for (const piece of STARTER_KIT) {
      expect(inv.furniture).toContainEqual(
        expect.objectContaining({ key: piece.key, placement: { i: piece.i, j: piece.j } }),
      );
    }
    // The kit is not a creation: nothing was numbered.
    expect(await lastSerial()).toBe(before);
    expect((await pool.query('SELECT count(*)::int AS n FROM items WHERE owner_id = $1', [id])).rows[0].n).toBe(0);
  });

  it('lets a player take 50 pieces without touching the numbering or the creations', async () => {
    const { sid } = await signUp('dave');
    const serialBefore = await lastSerial();
    const itemsBefore = await itemCount();
    const keys = CATALOGUE.map((e) => e.key);
    const results = await Promise.all(Array.from({ length: 50 }, (_, k) => take(sid, keys[k % keys.length])));
    expect(results.map((r) => r.statusCode)).toEqual(Array(50).fill(201));
    expect((await inventory(sid)).furniture).toHaveLength(STARTER_KIT.length + 50);
    expect(await lastSerial()).toBe(serialBefore);
    expect(await itemCount()).toBe(itemsBefore);
    // The next creation takes the very next number: none was burned.
    expect((await create(sid)).serial).toBe(serialBefore + 1);
  });

  it('refuses unknown pieces and anything but a key', async () => {
    const { sid } = await signUp('erin');
    expect((await take(sid, 'licorne')).statusCode).toBe(404);
    expect((await take(sid, 42)).statusCode).toBe(400);
    expect((await take(sid, '__proto__')).statusCode).toBe(404);
    const withExtras = await app.inject({
      method: 'POST',
      url: '/api/furniture',
      payload: { key: 'lit', serial: 1, creator: 'erin', editionSize: 99 },
      cookies: as(sid),
    });
    expect(withExtras.statusCode).toBe(400);
    expect((await app.inject({ method: 'POST', url: '/api/furniture', payload: { key: 'lit' } })).statusCode).toBe(401);
  });

  it('stops at the ceiling, which is generous but not infinite', async () => {
    const { id, sid } = await signUp('frank');
    const have = (await pool.query('SELECT count(*)::int AS n FROM furniture WHERE owner_id = $1', [id])).rows[0].n as number;
    await pool.query(
      `INSERT INTO furniture (owner_id, catalogue_key) SELECT $1, 'pouf' FROM generate_series(1, $2)`,
      [id, MAX_FURNITURE_PER_PLAYER - have - 1],
    );
    expect((await take(sid, 'lit')).statusCode).toBe(201);
    const full = await take(sid, 'lit');
    expect(full.statusCode).toBe(409);
    expect(full.json().error).toMatch(/meubles/);
  });

  describe('placement', () => {
    it('applies the same rules to furniture and creations: owner only, one object per cell', async () => {
      const gina = await signUp('gina');
      const hugo = await signUp('hugo');
      const ginaInv = await inventory(gina.sid);
      const spare = (await take(gina.sid, 'pouf')).json().furniture as Furniture;
      const lamp = await create(gina.sid);

      // Free cell: fine for both kinds.
      expect((await place(gina.sid, spare.id, 6, 6)).statusCode).toBe(200);
      expect((await place(gina.sid, lamp.id, 6, 5)).statusCode).toBe(200);
      // Occupied by furniture / by a creation, whichever comes second.
      expect((await place(gina.sid, lamp.id, 6, 6)).statusCode).toBe(409);
      const other = (await take(gina.sid, 'cactus')).json().furniture as Furniture;
      expect((await place(gina.sid, other.id, 6, 5)).statusCode).toBe(409);
      // On a cell taken by a starter-kit piece too.
      const kit = STARTER_KIT[0]!;
      expect((await place(gina.sid, other.id, kit.i, kit.j)).statusCode).toBe(409);
      // Out of the grid, and someone else's furniture.
      expect((await place(gina.sid, other.id, 8, 0)).statusCode).toBe(400);
      const hugoPiece = (await inventory(hugo.sid)).furniture[0]!;
      expect((await place(gina.sid, hugoPiece.id, 4, 1)).statusCode).toBe(404);
      expect((await place(gina.sid, '00000000-0000-4000-8000-000000000000', 4, 1)).statusCode).toBe(404);
      void ginaInv;
    });

    it('moves furniture, onto its own cell too, and puts it back in the inventory', async () => {
      const ines = await signUp('ines');
      const piece = (await take(ines.sid, 'pouf')).json().furniture as Furniture;
      expect((await place(ines.sid, piece.id, 2, 6)).statusCode).toBe(200);
      expect((await place(ines.sid, piece.id, 3, 6)).statusCode).toBe(200);
      expect((await place(ines.sid, piece.id, 3, 6)).statusCode).toBe(200);
      expect((await inventory(ines.sid)).furniture.find((f) => f.id === piece.id)!.placement).toEqual({ i: 3, j: 6 });

      const del = await app.inject({ method: 'DELETE', url: `/api/placements/${piece.id}`, cookies: as(ines.sid) });
      expect(del.statusCode).toBe(204);
      expect((await inventory(ines.sid)).furniture.find((f) => f.id === piece.id)!.placement).toBeNull();
      // The cell is free again.
      const other = (await take(ines.sid, 'cactus')).json().furniture as Furniture;
      expect((await place(ines.sid, other.id, 3, 6)).statusCode).toBe(200);
    });

    it('lets only one of two simultaneous placements on the same cell win', async () => {
      const jules = await signUp('jules');
      const a = (await take(jules.sid, 'pouf')).json().furniture as Furniture;
      const b = (await take(jules.sid, 'cactus')).json().furniture as Furniture;
      const codes = (await Promise.all([place(jules.sid, a.id, 7, 7), place(jules.sid, b.id, 7, 7)])).map((r) => r.statusCode);
      expect(codes.sort()).toEqual([200, 409]);
    });

    it('throws a copy away, with its placement, and only your own', async () => {
      const kim = await signUp('kim');
      const leo = await signUp('leo');
      const piece = (await take(kim.sid, 'pouf')).json().furniture as Furniture;
      await place(kim.sid, piece.id, 6, 0);
      const del = (sid: string, id: string) =>
        app.inject({ method: 'DELETE', url: `/api/furniture/${id}`, cookies: as(sid) });
      expect((await del(leo.sid, piece.id)).statusCode).toBe(404);
      expect((await del(kim.sid, 'pas-un-uuid')).statusCode).toBe(404);
      expect((await del(kim.sid, piece.id)).statusCode).toBe(204);
      expect((await inventory(kim.sid)).furniture.some((f) => f.id === piece.id)).toBe(false);
      expect((await pool.query('SELECT 1 FROM placements WHERE furniture_id = $1', [piece.id])).rowCount).toBe(0);
    });
  });

  describe('base furniture is not a creation', () => {
    it('keeps a copy out of every creation route and out of the items table', async () => {
      const mia = await signUp('mia');
      const piece = (await take(mia.sid, 'lit')).json().furniture as Furniture;
      // No creation sprite, no creation row, nothing in the creations of the inventory.
      expect((await app.inject({ method: 'GET', url: `/api/items/${piece.id}.png`, cookies: as(mia.sid) })).statusCode).toBe(404);
      expect((await pool.query('SELECT 1 FROM items WHERE id = $1', [piece.id])).rowCount).toBe(0);
      expect((await inventory(mia.sid)).items.some((i) => i.id === piece.id)).toBe(false);
      // The answer to "take a piece" carries none of a creation's attributes.
      const body = (await take(mia.sid, 'lit')).json().furniture;
      expect(Object.keys(body).sort()).toEqual(['id', 'key', 'name', 'placement']);
    });

    it('can neither be given away nor altered, even straight in the database', async () => {
      const noa = await signUp('noa');
      const omar = await signUp('omar');
      const piece = (await take(noa.sid, 'lit')).json().furniture as Furniture;
      await expect(pool.query('UPDATE furniture SET owner_id = $1 WHERE id = $2', [omar.id, piece.id])).rejects.toThrow(
        /never transferred/,
      );
      await expect(pool.query("UPDATE furniture SET catalogue_key = 'coffre' WHERE id = $1", [piece.id])).rejects.toThrow();
      // There is no API to hand it over either: the other player cannot place it.
      expect((await place(omar.sid, piece.id, 5, 5)).statusCode).toBe(404);
    });

    it('is refused as a placement holding both a creation and a piece, or neither', async () => {
      const pia = await signUp('pia');
      const piece = (await take(pia.sid, 'lit')).json().furniture as Furniture;
      const item = await create(pia.sid);
      await expect(
        pool.query('INSERT INTO placements (item_id, furniture_id, user_id, i, j) VALUES ($1, $2, $3, 1, 7)', [
          item.id,
          piece.id,
          pia.id,
        ]),
      ).rejects.toThrow();
      await expect(pool.query('INSERT INTO placements (user_id, i, j) VALUES ($1, 1, 7)', [pia.id])).rejects.toThrow();
    });
  });

  describe('apartment look', () => {
    it('lets the owner pick a floor and a wallpaper from the catalogue, nothing else', async () => {
      const quentin = await signUp('quentin');
      const put = (payload: object) =>
        app.inject({ method: 'PUT', url: '/api/apartment', payload, cookies: as(quentin.sid) });
      const mine = async () => (await app.inject({ method: 'GET', url: '/api/apartment', cookies: as(quentin.sid) })).json();
      expect(await mine()).toMatchObject({ floorStyle: 'parquet', wallStyle: 'violet' });
      expect((await put({ floor: 'damier', wall: 'menthe' })).json()).toMatchObject({ floorStyle: 'damier', wallStyle: 'menthe' });
      expect((await put({ floor: 'lave' })).statusCode).toBe(400);
      expect((await put({ wall: 42 })).statusCode).toBe(400);
      expect(await mine()).toMatchObject({ floorStyle: 'damier', wallStyle: 'menthe' });
    });

    it('shows visitors the furniture, the floor and the wallpaper', async () => {
      const rose = await signUp('rose');
      const sam = await signUp('sam');
      await app.inject({ method: 'PUT', url: '/api/apartment', payload: { floor: 'noyer', wall: 'nuit', access: 'building' }, cookies: as(rose.sid) });
      const res = await app.inject({ method: 'GET', url: `/api/apartments/${rose.id}`, cookies: as(sam.sid) });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body).toMatchObject({ floor: 'noyer', wall: 'nuit' });
      expect(body.furniture).toHaveLength(STARTER_KIT.length);
      expect(body.furniture[0]).toEqual({
        id: expect.any(String),
        key: expect.any(String),
        name: expect.any(String),
        placement: { i: expect.any(Number), j: expect.any(Number) },
      });
      // The building view takes the wall color.
      const list = (await app.inject({ method: 'GET', url: '/api/building', cookies: as(sam.sid) })).json().apartments;
      expect(list.find((a: { owner: { id: string } | null }) => a.owner?.id === rose.id).wall).toBe('nuit');
    });
  });
});
