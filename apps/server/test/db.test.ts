import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { migrate, migrateDownAll } from '../src/db/migrate';
import { createPool, nextItemSerial, withTransaction } from '../src/db/pool';

// Integration tests: need PostgreSQL (`docker compose up -d`). Skipped when unreachable.
const url = process.env.DATABASE_URL ?? 'postgres://coloxel:coloxel@localhost:5432/coloxel';
const probe = createPool(url);
const available = await probe.query('SELECT 1').then(
  () => true,
  () => false,
);
await probe.end();

describe.skipIf(!available)('database schema', () => {
  let pool: pg.Pool;

  const newUser = async (n: string) =>
    (
      await pool.query<{ id: string }>(
        `INSERT INTO users (email, password_hash, nickname, birth_date)
         VALUES ($1, 'x', $2, '1990-01-01') RETURNING id`,
        [`${n}@test.dev`, n],
      )
    ).rows[0]!.id;

  const newItem = (client: pg.Pool | pg.PoolClient, serial: number, userId: string) =>
    client.query<{ id: string }>(
      `INSERT INTO items (serial, name, description, recipe, creator_id, owner_id)
       VALUES ($1, 'Lampe', 'une lampe', '{}', $2, $2) RETURNING id`,
      [serial, userId],
    );

  const createItem = (userId: string) =>
    withTransaction(pool, async (c) => (await newItem(c, await nextItemSerial(c), userId)).rows[0]!.id);

  beforeAll(async () => {
    await migrateDownAll(url).catch(() => {});
    await migrate('up', url);
    pool = createPool(url);
  });
  afterAll(async () => {
    await pool?.end();
  });

  it('numbers items without gaps or duplicates under concurrency', async () => {
    const user = await newUser('concurrent');
    const serials = await Promise.all(
      Array.from({ length: 20 }, () =>
        withTransaction(pool, async (c) => {
          const serial = await nextItemSerial(c);
          await newItem(c, serial, user);
          return serial;
        }),
      ),
    );
    expect(new Set(serials).size).toBe(20);
    expect(Math.max(...serials) - Math.min(...serials)).toBe(19);
  });

  it('does not burn a number on rollback', async () => {
    const before = await withTransaction(pool, (c) => nextItemSerial(c));
    await withTransaction(pool, async (c) => {
      await nextItemSerial(c);
      throw new Error('boom');
    }).catch(() => {});
    const after = await withTransaction(pool, (c) => nextItemSerial(c));
    expect(after).toBe(before + 1);
  });

  it('keeps items immutable except for the owner', async () => {
    const a = await newUser('alice');
    const b = await newUser('bob');
    const id = await createItem(a);
    await expect(pool.query(`UPDATE items SET name = 'Autre' WHERE id = $1`, [id])).rejects.toThrow(/immutable/);
    await expect(pool.query(`UPDATE items SET serial = 9999 WHERE id = $1`, [id])).rejects.toThrow(/immutable/);
    await expect(pool.query(`DELETE FROM items WHERE id = $1`, [id])).rejects.toThrow(/cannot be deleted/);
    await pool.query(`UPDATE items SET owner_id = $2 WHERE id = $1`, [id, b]);
  });

  it('allows one item per cell and keeps cells inside the 8 x 8 grid', async () => {
    const u = await newUser('placer');
    const [i1, i2, i3] = [await createItem(u), await createItem(u), await createItem(u)] as [string, string, string];
    const place = (item: string, i: number, j: number) =>
      pool.query('INSERT INTO placements (item_id, user_id, i, j) VALUES ($1, $2, $3, $4)', [item, u, i, j]);
    await place(i1, 3, 4);
    await expect(place(i2, 3, 4)).rejects.toThrow();
    await expect(place(i3, 8, 0)).rejects.toThrow();
  });

  it('rejects duplicate emails regardless of case', async () => {
    await newUser('dupe');
    await expect(
      pool.query(`INSERT INTO users (email, password_hash, nickname, birth_date)
                  VALUES ('DUPE@test.dev', 'x', 'other', '1990-01-01')`),
    ).rejects.toThrow();
  });
});
