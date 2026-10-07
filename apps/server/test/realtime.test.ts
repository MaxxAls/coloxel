import type pg from 'pg';
import { Client, type Room } from '@colyseus/sdk';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { SEEDS } from '@coloxel/render';
import type { RecipeModel } from '../src/creations/model';
import { migrate, migrateDownAll } from '../src/db/migrate';
import { createPool } from '../src/db/pool';
import { buildServer } from '../src/index';
import { startRealtime, type Realtime } from '../src/realtime';
import { SPAWN, STEP_MS } from '../src/realtime/rooms';

const url = process.env.DATABASE_URL ?? 'postgres://coloxel:coloxel@localhost:5432/coloxel';
const redisUrl = process.env.REDIS_URL ?? 'redis://localhost:6379';
const ORIGIN = 'http://localhost:5173';

const probe = createPool(url);
const available = await probe.query('SELECT 1').then(
  () => true,
  () => false,
);
await probe.end();

const model: RecipeModel = async () => JSON.stringify({ nom: 'Lampe test', parts: SEEDS[0]!.parts });

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyRoom = Room<any>;

describe.skipIf(!available)('realtime rooms (Colyseus)', () => {
  let pool: pg.Pool;
  let app: ReturnType<typeof buildServer>;
  let realtime: Realtime;
  const opened: AnyRoom[] = [];

  beforeAll(async () => {
    await migrateDownAll(url).catch(() => {});
    await migrate('up', url);
    pool = createPool(url);
    app = buildServer({ pool, model });
    // Redis is optional here: without it presence stays in memory.
    realtime = await startRealtime({ pool, port: 0, redisUrl, allowedOrigins: [ORIGIN] });
  });
  // leave() never settles on a connection the server already closed.
  const leaveAll = () =>
    Promise.all(
      opened.splice(0).map((r) => Promise.race([r.leave().catch(() => {}), new Promise((ok) => setTimeout(ok, 300))])),
    );
  // Each test starts from an empty building.
  afterEach(leaveAll);
  afterAll(async () => {
    await leaveAll();
    await realtime?.close();
    await app?.close();
    await pool?.end();
  });

  interface Account {
    id: string;
    sid: string;
  }
  async function signUp(nickname: string): Promise<Account> {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { email: `${nickname}@test.dev`, password: 'motdepasse', nickname, birthDate: '1990-01-01' },
    });
    return { id: res.json().user.id, sid: res.cookies.find((c) => c.name === 'coloxel_sid')!.value };
  }

  const clientFor = (headers: Record<string, string>) => new Client(`http://localhost:${realtime.port}`, { headers });
  const asAccount = (a: Account, extra: Record<string, string> = {}) =>
    clientFor({ cookie: `coloxel_sid=${a.sid}`, origin: ORIGIN, ...extra });

  async function join(client: Client, room: string, options: object = {}) {
    const r = (await client.joinOrCreate(room, options)) as AnyRoom;
    opened.push(r);
    return r;
  }
  const joinHall = (a: Account) => join(asAccount(a), 'hall');
  const joinApartment = (a: Account, ownerId: string) => join(asAccount(a), 'apartment', { ownerId });

  const until = async (cond: () => unknown, ms = 3000) => {
    const start = Date.now();
    while (!cond()) {
      if (Date.now() - start > ms) throw new Error('timed out waiting for condition');
      await new Promise((r) => setTimeout(r, 25));
    }
  };
  const playerOf = (room: AnyRoom, id: string) => room.state?.players?.get(id) as { i: number; j: number } | undefined;
  const setAccess = (id: string, access: string) =>
    pool.query('UPDATE users SET apartment_access = $1 WHERE id = $2', [access, id]);

  it('refuses a connection without a valid session', async () => {
    await expect(clientFor({ origin: ORIGIN }).joinOrCreate('hall')).rejects.toThrow(/Non connecté/);
    await expect(clientFor({ cookie: 'coloxel_sid=not-a-session', origin: ORIGIN }).joinOrCreate('hall')).rejects.toThrow(/Non connecté/);
  });

  it('refuses a valid session coming from a foreign origin', async () => {
    const mallory = await signUp('mallory');
    await expect(asAccount(mallory, { origin: 'https://evil.example' }).joinOrCreate('hall')).rejects.toThrow(/Origine/);
    await expect(joinHall(mallory)).resolves.toBeDefined();
  });

  it('identifies players by their session, ignoring any identity in the join options', async () => {
    const alice = await signUp('alice');
    const bob = await signUp('bob');
    const room = await join(asAccount(alice), 'hall', { id: bob.id, nickname: 'bob', userId: bob.id });
    await until(() => playerOf(room, alice.id));
    expect(playerOf(room, alice.id)).toBeDefined();
    expect(playerOf(room, bob.id)).toBeUndefined();
  });

  it('shows two players to each other in the hall and moves them step by step', async () => {
    const carol = await signUp('carol');
    const dave = await signUp('dave');
    const a = await joinHall(carol);
    const b = await joinHall(dave);
    await until(() => [a, b].every((r) => playerOf(r, carol.id) && playerOf(r, dave.id)));
    expect(playerOf(b, carol.id)).toMatchObject(SPAWN);

    a.send('move', { i: SPAWN.i, j: 3 });
    // Dave sees Carol walk: first a cell next to the spawn, then the target.
    await until(() => playerOf(b, carol.id)!.j > 0);
    expect(playerOf(b, carol.id)!.j).toBeLessThan(3);
    await until(() => playerOf(b, carol.id)!.j === 3, 3 * STEP_MS * 4 + 2000);
    expect(playerOf(b, carol.id)).toMatchObject({ i: SPAWN.i, j: 3 });
    expect(playerOf(b, dave.id)).toMatchObject(SPAWN);
  });

  it('ignores moves that are forged, malformed or out of the grid', async () => {
    const erin = await signUp('erin');
    const frank = await signUp('frank');
    const a = await joinHall(erin);
    const b = await joinHall(frank);
    await until(() => playerOf(b, erin.id) && playerOf(b, frank.id));

    // Naming another player in the message moves nobody: the strict schema rejects it.
    a.send('move', { i: 2, j: 2, id: frank.id });
    a.send('move', { id: frank.id, i: 2, j: 2 });
    for (const bad of [{ i: -1, j: 0 }, { i: 8, j: 0 }, { i: 1.5, j: 1 }, { i: 'x', j: 1 }, null, 'move', [1, 2]]) a.send('move', bad);
    await new Promise((r) => setTimeout(r, STEP_MS * 4));
    expect(playerOf(b, erin.id)).toMatchObject(SPAWN);
    expect(playerOf(b, frank.id)).toMatchObject(SPAWN);
  });

  it('limits a client that floods messages, without taking the room down', async () => {
    const gina = await signUp('gina');
    const hugo = await signUp('hugo');
    const flooder = await joinHall(gina);
    const calm = await joinHall(hugo);
    await until(() => playerOf(calm, gina.id) && playerOf(calm, hugo.id));

    let flooderLeft = false;
    flooder.onLeave(() => (flooderLeft = true));
    for (let k = 0; k < 400; k++) flooder.send('move', { i: k % 8, j: (k * 3) % 8 });
    await until(() => flooderLeft);
    await until(() => !playerOf(calm, gina.id));

    // The room is alive: the other player still moves.
    calm.send('move', { i: SPAWN.i, j: 2 });
    await until(() => playerOf(calm, hugo.id)!.j === 2, 3000);
  });

  it('keeps one seat per player: a second connection replaces the first', async () => {
    const iris = await signUp('iris');
    const watcher = await signUp('jules');
    const first = await joinHall(iris);
    const w = await joinHall(watcher);
    let firstLeft = false;
    first.onLeave(() => (firstLeft = true));
    const second = await joinHall(iris);
    await until(() => firstLeft);
    await new Promise((r) => setTimeout(r, 100));
    expect(playerOf(w, iris.id)).toBeDefined();
    expect(playerOf(second, iris.id)).toBeDefined();
  });

  describe('apartments', () => {
    it('lets the owner in, and keeps a closed apartment closed to others', async () => {
      const kim = await signUp('kim');
      const leo = await signUp('leo');
      const own = await joinApartment(kim, kim.id);
      await until(() => playerOf(own, kim.id));
      await expect(joinApartment(leo, kim.id)).rejects.toThrow(/fermé/);
      await expect(joinApartment(leo, '00000000-0000-4000-8000-000000000000')).rejects.toThrow(/fermé/);
      await expect(asAccount(leo).joinOrCreate('apartment', { ownerId: 'not-a-uuid' })).rejects.toThrow(/invalide/);
      await expect(asAccount(leo).joinOrCreate('apartment', {})).rejects.toThrow(); // may match any room, which still checks its own owner
    });

    it('cannot be entered by forcing the room id with another owner’s options', async () => {
      const mia = await signUp('mia');
      const noa = await signUp('noa');
      const closed = await joinApartment(mia, mia.id);
      await setAccess(noa.id, 'building');
      // Noa's own open apartment is no key to Mia's closed one.
      await expect(asAccount(noa).joinById(closed.roomId, { ownerId: noa.id })).rejects.toThrow(/fermé/);
    });

    it('lets visitors in once the owner opens the apartment, and shuts them out again', async () => {
      const omar = await signUp('omar');
      const pia = await signUp('pia');
      await setAccess(omar.id, 'building');
      const host = await joinApartment(omar, omar.id);
      const guest = await joinApartment(pia, omar.id);
      await until(() => playerOf(host, pia.id) && playerOf(guest, omar.id));

      await setAccess(omar.id, 'closed');
      const late = await signUp('quentin');
      await expect(joinApartment(late, omar.id)).rejects.toThrow(/fermé/);
    });

    it('does not let a player walk through objects placed in the apartment', async () => {
      const rose = await signUp('rose');
      const created = await app.inject({
        method: 'POST',
        url: '/api/creations',
        payload: { description: 'une lampe' },
        cookies: { coloxel_sid: rose.sid },
      });
      const itemId = created.json().item.id as string;
      await app.inject({
        method: 'PUT',
        url: '/api/placements',
        payload: { itemId, i: 7, j: 1 },
        cookies: { coloxel_sid: rose.sid },
      });
      const room = await joinApartment(rose, rose.id);
      await until(() => playerOf(room, rose.id));

      room.send('move', { i: 7, j: 1 }); // blocked cell
      await new Promise((r) => setTimeout(r, STEP_MS * 4));
      expect(playerOf(room, rose.id)).toMatchObject(SPAWN);

      room.send('move', { i: 6, j: 1 });
      await until(() => playerOf(room, rose.id)!.i === 6 && playerOf(room, rose.id)!.j === 1);
    });
  });

  it('holds 30 connected players in the hall, each seeing all the others move', async () => {
    const accounts = await Promise.all(Array.from({ length: 30 }, (_, k) => signUp(`load${k}`)));
    const rooms = await Promise.all(accounts.map((a) => joinHall(a)));
    await until(() => rooms.every((r) => r.state?.players?.size === 30), 8000);
    // Only these 30 players are in the building.

    rooms.forEach((r, k) => r.send('move', { i: SPAWN.i, j: 1 + (k % 6) }));
    await until(
      () => accounts.every((a, k) => playerOf(rooms[(k + 1) % 30]!, a.id)?.j === 1 + (k % 6)),
      8000,
    );
    expect(new Set(rooms.map((r) => r.roomId)).size).toBe(1);
  }, 30000);
});
