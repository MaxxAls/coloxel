import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { migrate, migrateDownAll } from '../src/db/migrate';
import { createPool, withTransaction } from '../src/db/pool';
import { buildServer } from '../src/index';
import { creditColoxs, debitColoxs, findColoxMismatches } from '../src/wallet/coloxs';

const url = process.env.DATABASE_URL ?? 'postgres://coloxel:coloxel@localhost:5432/coloxel';
const probe = createPool(url);
const available = await probe.query('SELECT 1').then(
  () => true,
  () => false,
);
await probe.end();

describe.skipIf(!available)('Coloxs and their ledger (PostgreSQL)', () => {
  let pool: pg.Pool;
  let app: ReturnType<typeof buildServer>;

  beforeAll(async () => {
    await migrateDownAll(url).catch(() => {});
    await migrate('up', url);
    pool = createPool(url);
    app = buildServer({ pool, challenges: false });
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
  const balance = async (id: string) => (await pool.query<{ coloxs: number }>('SELECT coloxs FROM users WHERE id = $1', [id])).rows[0]!.coloxs;
  const credit = (id: string, amount: number) => withTransaction(pool, (c) => creditColoxs(c, id, amount, 'staff', 'test'));
  const debit = (id: string, amount: number) => withTransaction(pool, (c) => debitColoxs(c, id, amount, 'purchase', 'test'));

  it('starts at zero and shows in the wallet', async () => {
    const { id, sid } = await signUp('colox1');
    expect(await balance(id)).toBe(0);
    const res = await app.inject({ method: 'GET', url: '/api/wallet', cookies: { coloxel_sid: sid } });
    expect(res.json()).toMatchObject({ pixels: 100, coloxs: 0 });
    await credit(id, 40);
    const after = await app.inject({ method: 'GET', url: '/api/wallet', cookies: { coloxel_sid: sid } });
    expect(after.json().coloxs).toBe(40);
  });

  it('credits and debits through the ledger, which explains the balance', async () => {
    const { id } = await signUp('colox2');
    expect(await credit(id, 100)).toBe(100);
    expect(await debit(id, 30)).toBe(70);
    const { rows } = await pool.query('SELECT delta, kind, detail FROM colox_ledger WHERE user_id = $1 ORDER BY id', [id]);
    expect(rows).toEqual([
      { delta: 100, kind: 'staff', detail: 'test' },
      { delta: -30, kind: 'purchase', detail: 'test' },
    ]);
    expect(await balance(id)).toBe(70);
  });

  it('refuses a debit above the balance and leaves everything untouched', async () => {
    const { id } = await signUp('colox3');
    await credit(id, 10);
    expect(await debit(id, 11)).toBeNull();
    expect(await balance(id)).toBe(10);
    const { rows } = await pool.query('SELECT count(*)::int AS n FROM colox_ledger WHERE user_id = $1', [id]);
    expect(rows[0].n).toBe(1);
  });

  it('refuses amounts that are not positive whole numbers', async () => {
    const { id } = await signUp('colox4');
    for (const bad of [0, -5, 1.5, Number.NaN]) {
      await expect(credit(id, bad)).rejects.toThrow();
      await expect(debit(id, bad)).rejects.toThrow();
    }
    expect(await balance(id)).toBe(0);
  });

  it('cannot change a balance directly, only through the ledger', async () => {
    const { id } = await signUp('colox5');
    await expect(pool.query('UPDATE users SET coloxs = 999 WHERE id = $1', [id])).rejects.toThrow(/colox_ledger/);
    await expect(pool.query('UPDATE users SET coloxs = coloxs + 1 WHERE id = $1', [id])).rejects.toThrow(/colox_ledger/);
    expect(await balance(id)).toBe(0);
  });

  it('never lets the database balance go negative, even bypassing the check in code', async () => {
    const { id } = await signUp('colox6');
    await credit(id, 5);
    await expect(pool.query("INSERT INTO colox_ledger (user_id, delta, kind) VALUES ($1, -6, 'purchase')", [id])).rejects.toThrow();
    expect(await balance(id)).toBe(5);
  });

  it('freezes ledger lines and rejects unknown reasons', async () => {
    const { id } = await signUp('colox7');
    await credit(id, 5);
    await expect(pool.query('UPDATE colox_ledger SET delta = 500 WHERE user_id = $1', [id])).rejects.toThrow(/cannot be modified/);
    await expect(pool.query("INSERT INTO colox_ledger (user_id, delta, kind) VALUES ($1, 1, 'gift')", [id])).rejects.toThrow();
  });

  it('rolls the credit back with the transaction it belongs to', async () => {
    const { id } = await signUp('colox8');
    await expect(
      withTransaction(pool, async (c) => {
        await creditColoxs(c, id, 50, 'sale');
        throw new Error('the server crashed halfway');
      }),
    ).rejects.toThrow('halfway');
    expect(await balance(id)).toBe(0);
    const { rows } = await pool.query('SELECT count(*)::int AS n FROM colox_ledger WHERE user_id = $1', [id]);
    expect(rows[0].n).toBe(0);
  });

  it('two spends at the same moment cannot both pass', async () => {
    const { id } = await signUp('colox9');
    await credit(id, 100);
    const results = await Promise.all(Array.from({ length: 10 }, () => debit(id, 30)));
    expect(results.filter((r) => r !== null)).toHaveLength(3);
    expect(await balance(id)).toBe(10);
  });

  it('has no way to give Coloxs from the API', async () => {
    const { id, sid } = await signUp('colox10');
    for (const [method, path] of [
      ['POST', '/api/wallet/coloxs'],
      ['PUT', '/api/wallet'],
      ['POST', '/api/wallet/redeem'],
    ] as const) {
      await app.inject({ method, url: path, payload: { coloxs: 500, amount: 500, code: 'COLOXS' }, cookies: { coloxel_sid: sid } });
    }
    expect(await balance(id)).toBe(0);
  });

  it('keeps the sum of the ledger equal to every balance after a random run', async () => {
    const players = await Promise.all(['colox11', 'colox12', 'colox13'].map(signUp));
    let seed = 7;
    const rand = (n: number) => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed % n;
    };
    await Promise.all(
      Array.from({ length: 60 }, () => {
        const p = players[rand(players.length)]!;
        const amount = 1 + rand(50);
        return rand(2) ? credit(p.id, amount) : debit(p.id, amount);
      }),
    );
    expect(await findColoxMismatches(pool)).toEqual([]);
  });

  it('the consistency check spots a balance that does not match its ledger', async () => {
    const { id } = await signUp('colox14');
    await credit(id, 20);
    // Simulate corruption by switching the guard off for this one statement.
    await pool.query('ALTER TABLE users DISABLE TRIGGER users_coloxs_guard');
    await pool.query('UPDATE users SET coloxs = 21 WHERE id = $1', [id]);
    await pool.query('ALTER TABLE users ENABLE TRIGGER users_coloxs_guard');
    expect(await findColoxMismatches(pool)).toEqual([{ userId: id, balance: 21, ledger: 20 }]);
    await pool.query('ALTER TABLE users DISABLE TRIGGER users_coloxs_guard');
    await pool.query('UPDATE users SET coloxs = 20 WHERE id = $1', [id]);
    await pool.query('ALTER TABLE users ENABLE TRIGGER users_coloxs_guard');
    expect(await findColoxMismatches(pool)).toEqual([]);
  });
});
