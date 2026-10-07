import type pg from 'pg';
import { Client, type Room } from '@colyseus/sdk';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { SEEDS, lookFor, parseLook } from '@coloxel/render';
import type { RecipeModel } from '../src/creations/model';
import { migrate, migrateDownAll } from '../src/db/migrate';
import { createPool } from '../src/db/pool';
import { buildServer } from '../src/index';
import { startRealtime, type Realtime } from '../src/realtime';
import { SPAWN, STEP_MS } from '../src/realtime/rooms';
import { forgetMaintenance } from '../src/site/settings';

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
    // This file signs up far more players than the real building holds.
    await pool.query(
      'INSERT INTO apartments (id, floor, slot) SELECT n, 10 + n, 0 FROM generate_series(31, 120) AS n',
    );
    app = buildServer({
      pool,
      model,
      notifyApartment: (ownerId, kind) => realtime.notifyApartment(ownerId, kind),
      locate: (ids) => realtime.locate(ids),
      notifyUser: (event) => realtime.notifyUser(event),
    });
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
    // Dave arrived second: next to the door, not on top of Carol.
    const daveStart = { ...playerOf(b, dave.id)! };
    expect(daveStart).not.toEqual(SPAWN);
    expect(Math.abs(daveStart.i - SPAWN.i) + Math.abs(daveStart.j - SPAWN.j)).toBe(1);

    a.send('move', { i: SPAWN.i, j: 3 });
    // Dave sees Carol walk: first a cell next to the spawn, then the target.
    await until(() => playerOf(b, carol.id)!.j > 0);
    expect(playerOf(b, carol.id)!.j).toBeLessThan(3);
    await until(() => playerOf(b, carol.id)!.j === 3, 3 * STEP_MS * 4 + 2000);
    expect(playerOf(b, carol.id)).toMatchObject({ i: SPAWN.i, j: 3 });
    expect(playerOf(b, dave.id)).toMatchObject(daveStart);
  });

  it('ignores moves that are forged, malformed or out of the grid', async () => {
    const erin = await signUp('erin');
    const frank = await signUp('frank');
    const a = await joinHall(erin);
    const b = await joinHall(frank);
    await until(() => playerOf(b, erin.id) && playerOf(b, frank.id));
    const frankStart = { ...playerOf(b, frank.id)! };

    // Naming another player in the message moves nobody: the strict schema rejects it.
    a.send('move', { i: 2, j: 2, id: frank.id });
    a.send('move', { id: frank.id, i: 2, j: 2 });
    for (const bad of [{ i: -1, j: 0 }, { i: 8, j: 0 }, { i: 1.5, j: 1 }, { i: 'x', j: 1 }, null, 'move', [1, 2]]) a.send('move', bad);
    await new Promise((r) => setTimeout(r, STEP_MS * 4));
    expect(playerOf(b, erin.id)).toMatchObject(SPAWN);
    expect(playerOf(b, frank.id)).toMatchObject(frankStart);
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

    describe('sitting and lying down', () => {
      // A new account's apartment holds the starter kit: the bed on (1, 1), the chair on (5, 4).
      const CHAIR = { i: 5, j: 4 };
      const BED = { i: 1, j: 1 };
      const poseOf = (room: AnyRoom, id: string) => (room.state?.players?.get(id) as { pose: number } | undefined)?.pose;
      const at = (room: AnyRoom, id: string, c: { i: number; j: number }) => {
        const p = playerOf(room, id);
        return !!p && p.i === c.i && p.j === c.j;
      };
      const walk = 12000;

      it('sits a player down on a free chair, and stands them up when they walk away', async () => {
        const ivy = await signUp('ivy');
        const room = await joinApartment(ivy, ivy.id);
        await until(() => playerOf(room, ivy.id));
        expect(poseOf(room, ivy.id)).toBe(0);

        room.send('move', CHAIR);
        await until(() => at(room, ivy.id, CHAIR) && poseOf(room, ivy.id) === 1, walk);
        room.send('move', { i: 7, j: 2 });
        await until(() => poseOf(room, ivy.id) === 0, 3000);
        await until(() => at(room, ivy.id, { i: 7, j: 2 }), walk);
      });

      it('lies a player down on the bed', async () => {
        const jay = await signUp('jay');
        const room = await joinApartment(jay, jay.id);
        await until(() => playerOf(room, jay.id));
        room.send('move', BED);
        await until(() => at(room, jay.id, BED) && poseOf(room, jay.id) === 2, walk);
      });

      it('lets only one player at a time sit on a chair', async () => {
        const kai = await signUp('kai');
        const lea = await signUp('lea');
        await setAccess(kai.id, 'building');
        const host = await joinApartment(kai, kai.id);
        const guest = await joinApartment(lea, kai.id);
        await until(() => host.state?.players?.size === 2);

        host.send('move', CHAIR);
        await until(() => at(host, kai.id, CHAIR) && poseOf(host, kai.id) === 1, walk);
        // The visitor tries the same chair: refused, they stay on their feet where they are.
        const start = { ...playerOf(guest, lea.id)! };
        guest.send('move', CHAIR);
        await new Promise((r) => setTimeout(r, 1500));
        expect(poseOf(guest, lea.id)).toBe(0);
        expect(playerOf(guest, lea.id)).toMatchObject(start);
        expect(poseOf(guest, kai.id)).toBe(1);
      });

      it('lets a visitor sit on a free chair of the apartment they visit', async () => {
        const max = await signUp('max');
        const noe = await signUp('noe');
        await setAccess(max.id, 'building');
        const host = await joinApartment(max, max.id);
        const guest = await joinApartment(noe, max.id);
        await until(() => host.state?.players?.size === 2);
        guest.send('move', CHAIR);
        await until(() => at(guest, noe.id, CHAIR) && poseOf(guest, noe.id) === 1, walk);
      });

      it('does not let a player sit on, or walk onto, a creation', async () => {
        const oli = await signUp('oli');
        const created = await app.inject({
          method: 'POST',
          url: '/api/creations',
          payload: { description: 'une lampe' },
          cookies: { coloxel_sid: oli.sid },
        });
        await app.inject({
          method: 'PUT',
          url: '/api/placements',
          payload: { itemId: created.json().item.id, i: 3, j: 3 },
          cookies: { coloxel_sid: oli.sid },
        });
        const room = await joinApartment(oli, oli.id);
        await until(() => playerOf(room, oli.id));
        const start = { ...playerOf(room, oli.id)! };
        room.send('move', { i: 3, j: 3 });
        await new Promise((r) => setTimeout(r, 1200));
        expect(playerOf(room, oli.id)).toMatchObject(start);
        expect(poseOf(room, oli.id)).toBe(0);
      });

      it('gets a player back on their feet when the chair they sit on is taken away', async () => {
        const pam = await signUp('pam');
        const room = await joinApartment(pam, pam.id);
        await until(() => playerOf(room, pam.id));
        room.send('move', CHAIR);
        await until(() => at(room, pam.id, CHAIR) && poseOf(room, pam.id) === 1, walk);

        const inventory = (
          await app.inject({ method: 'GET', url: '/api/inventory', cookies: { coloxel_sid: pam.sid } })
        ).json().furniture as { id: string; key: string }[];
        const chair = inventory.find((f) => f.key === 'chaise')!;
        const res = await app.inject({
          method: 'DELETE',
          url: `/api/placements/${chair.id}`,
          cookies: { coloxel_sid: pam.sid },
        });
        expect(res.statusCode).toBe(204);
        await until(() => poseOf(room, pam.id) === 0, 4000);
      });
    });

    describe('when the owner changes the door or the decor', () => {
      const api = (owner: Account, payload: object) =>
        app.inject({ method: 'PUT', url: '/api/apartment', payload, cookies: { coloxel_sid: owner.sid } });
      const watch = (room: AnyRoom) => {
        const seen = { code: 0, decor: 0 };
        room.onLeave((code: number) => (seen.code = code));
        room.onMessage('decor', () => seen.decor++);
        return seen;
      };

      it('shows visitors out the moment the owner closes the apartment, and keeps the owner inside', async () => {
        const ana = await signUp('ana');
        const ben = await signUp('ben');
        const cyd = await signUp('cyd');
        await setAccess(ana.id, 'building');
        const host = await joinApartment(ana, ana.id);
        const b = await joinApartment(ben, ana.id);
        const c = await joinApartment(cyd, ana.id);
        const seenB = watch(b);
        const seenC = watch(c);
        const seenHost = watch(host);
        await until(() => host.state?.players?.size === 3);

        expect((await api(ana, { access: 'closed' })).statusCode).toBe(200);
        await until(() => seenB.code === 4003 && seenC.code === 4003, 4000);
        await until(() => host.state?.players?.size === 1);
        expect(seenHost.code).toBe(0);
        expect(playerOf(host, ana.id)).toBeDefined();
        // And the door is really shut: nobody comes back in.
        await expect(joinApartment(ben, ana.id)).rejects.toThrow(/fermé/);
      });

      it('shows visitors out when the apartment is opened to friends only and they are not friends', async () => {
        const dan = await signUp('dan');
        const eve = await signUp('eve');
        await setAccess(dan.id, 'building');
        const host = await joinApartment(dan, dan.id);
        const guest = await joinApartment(eve, dan.id);
        const seen = watch(guest);
        await until(() => host.state?.players?.size === 2);
        await api(dan, { access: 'friends' });
        await until(() => seen.code === 4003, 4000);
      });

      it('keeps visitors in for a change that does not shut the door', async () => {
        const fay = await signUp('fay');
        const gus = await signUp('gus');
        await setAccess(fay.id, 'building');
        const host = await joinApartment(fay, fay.id);
        const guest = await joinApartment(gus, fay.id);
        const seen = watch(guest);
        await until(() => host.state?.players?.size === 2);
        await api(fay, { access: 'building', name: 'Chez Fay' });
        await new Promise((r) => setTimeout(r, 500));
        expect(seen.code).toBe(0);
        expect(playerOf(guest, gus.id)).toBeDefined();
      });

      it('tells visitors to reload when something is placed, taken back, or the look changes', async () => {
        const hal = await signUp('hal');
        const ida = await signUp('ida');
        await setAccess(hal.id, 'building');
        const host = await joinApartment(hal, hal.id);
        const guest = await joinApartment(ida, hal.id);
        const seen = watch(guest);
        await until(() => host.state?.players?.size === 2);

        const created = await app.inject({
          method: 'POST',
          url: '/api/creations',
          payload: { description: 'une lampe' },
          cookies: { coloxel_sid: hal.sid },
        });
        const itemId = created.json().item.id as string;
        const place = await app.inject({
          method: 'PUT',
          url: '/api/placements',
          payload: { itemId, i: 3, j: 6 },
          cookies: { coloxel_sid: hal.sid },
        });
        expect(place.statusCode).toBe(200);
        await until(() => seen.decor >= 1, 4000);
        await app.inject({ method: 'DELETE', url: `/api/placements/${itemId}`, cookies: { coloxel_sid: hal.sid } });
        await until(() => seen.decor >= 2, 4000);
        await api(hal, { floor: 'damier' });
        await until(() => seen.decor >= 3, 4000);
        expect(seen.code).toBe(0);
      });
    });

    it('counts the players inside each apartment for the building view', async () => {
      const sam = await signUp('sam');
      const tess = await signUp('tess');
      await setAccess(sam.id, 'building');
      const host = await joinApartment(sam, sam.id);
      const guest = await joinApartment(tess, sam.id);
      await until(() => playerOf(host, tess.id) && playerOf(guest, sam.id));
      expect((await realtime.occupancy()).apartments.get(sam.id)).toBe(2);
      await guest.leave();
      await until(async () => true);
      await new Promise((r) => setTimeout(r, 300));
      expect((await realtime.occupancy()).apartments.get(sam.id)).toBe(1);
      expect((await realtime.occupancy()).apartments.get(tess.id)).toBeUndefined();
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

    it('never makes a player appear on an object, nor on another player', async () => {
      const uma = await signUp('uma');
      const vic = await signUp('vic');
      const created = await app.inject({
        method: 'POST',
        url: '/api/creations',
        payload: { description: 'une lampe' },
        cookies: { coloxel_sid: uma.sid },
      });
      // An object right on the door cell.
      await app.inject({
        method: 'PUT',
        url: '/api/placements',
        payload: { itemId: created.json().item.id, i: SPAWN.i, j: SPAWN.j },
        cookies: { coloxel_sid: uma.sid },
      });
      await setAccess(uma.id, 'building');
      const host = await joinApartment(uma, uma.id);
      const guest = await joinApartment(vic, uma.id);
      await until(() => playerOf(guest, uma.id) && playerOf(guest, vic.id));
      const a = playerOf(guest, uma.id)!;
      const b = playerOf(guest, vic.id)!;
      expect(a).not.toMatchObject(SPAWN);
      expect(b).not.toMatchObject(SPAWN);
      expect({ i: a.i, j: a.j }).not.toEqual({ i: b.i, j: b.j });
      await until(() => host.state?.players?.size === 2);
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

  it('shows everybody the look and the companion of each player, from the server records, and updates them on request', async () => {
    const alice = await signUp('looky');
    const bob = await signUp('seer');
    const roomA = await joinHall(alice);
    const roomB = await joinHall(bob);
    const seen = () => roomB.state?.players?.get(alice.id) as { look: string; pet: string } | undefined;
    await until(() => seen());
    expect(parseLook(JSON.parse(seen()!.look))).toEqual(lookFor(alice.id));
    expect(seen()!.pet).toBe('');

    // Buy, wear and adopt through the API; the room learns of it when asked, and reads it from the database.
    await pool.query('UPDATE users SET pixels = 1000 WHERE id = $1', [alice.id]);
    const call = (method: 'POST' | 'PUT', path: string, payload: object) =>
      app.inject({ method, url: path, payload, cookies: { coloxel_sid: alice.sid } });
    expect((await call('POST', '/api/shop/buy', { kind: 'clothing', slot: 'hat', piece: 6 })).statusCode).toBe(201);
    expect((await call('PUT', '/api/me/look', { ...lookFor(alice.id), hat: 6, hatColor: 3 })).statusCode).toBe(200);
    expect((await call('POST', '/api/shop/buy', { kind: 'pet', species: 'chat', color: 1, name: 'Minou' })).statusCode).toBe(201);
    // A look forged in the message itself is ignored.
    roomA.send('refresh', { look: { ...lookFor(alice.id), hat: 3 }, pet: 'chien:0:Faux' });
    await until(() => seen()!.pet === 'chat:1:Minou');
    expect(JSON.parse(seen()!.look)).toMatchObject({ hat: 6, hatColor: 3 });

    // A new player arriving sees the saved look at once.
    const carol = await signUp('latecomer');
    const roomC = await joinHall(carol);
    await until(() => roomC.state?.players?.get(alice.id));
    expect(JSON.parse((roomC.state.players.get(alice.id) as { look: string }).look).hat).toBe(6);
  });
  describe('friends', () => {
    const friendsOf = async (a: Account) =>
      (await app.inject({ method: 'GET', url: '/api/friends', cookies: { coloxel_sid: a.sid } })).json().friends as {
        id: string;
        online: boolean;
        where: string | null;
        target: unknown;
      }[];
    const befriend = async (a: Account, b: Account & { nickname: string }) => {
      await app.inject({ method: 'POST', url: '/api/friends/requests', payload: { nickname: b.nickname }, cookies: { coloxel_sid: a.sid } });
      await app.inject({ method: 'POST', url: `/api/friends/requests/${a.id}/accept`, cookies: { coloxel_sid: b.sid } });
    };
    interface Named extends Account {
      nickname: string;
    }
    const signUpNamed = async (nickname: string): Promise<Named> => ({ ...(await signUp(nickname)), nickname });
    const untilAsync = async (cond: () => Promise<unknown>, ms = 4000) => {
      const start = Date.now();
      while (!(await cond())) {
        if (Date.now() - start > ms) throw new Error('timed out waiting for condition');
        await new Promise((r) => setTimeout(r, 50));
      }
    };

    it('tells friends where a player is as they move around, and forgets them when they leave', async () => {
      const ada = await signUpNamed('fl_ada');
      const bo = await signUpNamed('fl_bo');
      await befriend(ada, bo);
      expect((await friendsOf(bo))[0]).toMatchObject({ online: false, where: null, target: null });

      const inHall = await joinHall(ada);
      await untilAsync(async () => (await friendsOf(bo))[0]?.where === 'Dans le hall');
      expect((await friendsOf(bo))[0]).toMatchObject({ online: true, target: { kind: 'hall' } });

      // Ada goes home (closed): her friend still sees she is online, but cannot follow into a closed flat.
      await inHall.leave();
      const home = await joinApartment(ada, ada.id);
      await until(() => playerOf(home, ada.id));
      await untilAsync(async () => (await friendsOf(bo))[0]?.where === 'Dans un appart privé');
      expect((await friendsOf(bo))[0]).toMatchObject({ online: true, target: null });

      // Opened to friends, the same friend can follow her in one click.
      await setAccess(ada.id, 'friends');
      await untilAsync(async () => (await friendsOf(bo))[0]?.target !== null);
      expect((await friendsOf(bo))[0]).toMatchObject({ where: 'Chez fl_ada', target: { kind: 'apartment', ownerId: ada.id } });
      const follower = await joinApartment(bo, ada.id);
      await until(() => playerOf(follower, bo.id) && playerOf(home, bo.id));

      await home.leave();
      await untilAsync(async () => (await friendsOf(bo))[0]?.online === false);
    });

    it('lets a friend into an apartment opened to friends, and shows them out when the friendship ends', async () => {
      const cy = await signUpNamed('fl_cy');
      const di = await signUpNamed('fl_di');
      const eli = await signUpNamed('fl_eli');
      await befriend(cy, di);
      await setAccess(cy.id, 'friends');
      const host = await joinApartment(cy, cy.id);
      const friend = await joinApartment(di, cy.id);
      await expect(joinApartment(eli, cy.id)).rejects.toThrow(/fermé/);
      let code = 0;
      friend.onLeave((c: number) => (code = c));
      await until(() => host.state?.players?.size === 2);

      const res = await app.inject({ method: 'DELETE', url: `/api/friends/${cy.id}`, cookies: { coloxel_sid: di.sid } });
      expect(res.statusCode).toBe(204);
      await until(() => code === 4003, 4000);
      await until(() => host.state?.players?.size === 1);
      await expect(joinApartment(di, cy.id)).rejects.toThrow(/fermé/);
    });
  });

  describe('sanctions on connected players', () => {
    const staffMember = async (nickname: string) => {
      const a = await signUp(nickname);
      await pool.query("UPDATE users SET role = 'administrateur' WHERE id = $1", [a.id]);
      return a;
    };
    const sanction = (staff: Account, target: Account, payload: object) =>
      app.inject({ method: 'POST', url: `/api/staff/players/${target.id}/sanctions`, payload, cookies: { coloxel_sid: staff.sid } });
    const listen = (room: AnyRoom) => {
      const heard = { chat: [] as string[], refused: [] as { reason: string }[], notices: [] as { kind: string; text: string }[], code: 0 };
      room.onMessage('chat', (m: { text: string }) => heard.chat.push(m.text));
      room.onMessage('chat-refused', (m: { reason: string }) => heard.refused.push(m));
      room.onMessage('notice', (m: { kind: string; text: string }) => heard.notices.push(m));
      room.onLeave((code: number) => (heard.code = code));
      return heard;
    };

    it('mutes a player who is connected, within the second: they are told, the others hear nothing, and it is journaled', async () => {
      const staff = await staffMember('sx_staff1');
      const loud = await signUp('sx_loud');
      const listener = await signUp('sx_listener');
      const a = await joinHall(loud);
      const b = await joinHall(listener);
      const heardA = listen(a);
      const heardB = listen(b);
      await until(() => a.state?.players?.size === 3 || a.state?.players?.size === 2);

      a.send('chat', { text: 'avant la sourdine' });
      await until(() => heardB.chat.length === 1);

      const res = await sanction(staff, loud, { kind: 'mute', minutes: 10, reason: 'Trop de bruit' });
      expect(res.statusCode).toBe(201);
      await until(() => heardA.notices.length === 1, 3000);
      expect(heardA.notices[0]).toMatchObject({ kind: 'mute' });
      expect(heardA.notices[0]!.text).toMatch(/sourdine.*Trop de bruit/);

      a.send('chat', { text: 'après la sourdine' });
      await until(() => heardA.refused.length === 1);
      expect(heardA.refused[0]!.reason).toBe('muted');
      await new Promise((r) => setTimeout(r, 300));
      expect(heardB.chat).toEqual(['avant la sourdine']);
      expect(heardA.chat).toEqual(['avant la sourdine']);
      const log = (await pool.query('SELECT text, blocked, reason FROM chat_log WHERE user_id = $1 ORDER BY id', [loud.id])).rows;
      expect(log).toEqual([
        { text: 'avant la sourdine', blocked: false, reason: null },
        { text: 'après la sourdine', blocked: true, reason: 'muted' },
      ]);

      // Lifted, the player speaks again.
      const id = (await pool.query('SELECT id FROM sanctions WHERE user_id = $1', [loud.id])).rows[0].id;
      await app.inject({ method: 'POST', url: `/api/staff/sanctions/${id}/revoke`, cookies: { coloxel_sid: staff.sid } });
      a.send('chat', { text: 'je peux parler' });
      await until(() => heardB.chat.length === 2);
    });

    it('shows a suspended player out of the room they are in, at once, and keeps them out', async () => {
      const staff = await staffMember('sx_staff2');
      const target = await signUp('sx_target');
      const bystander = await signUp('sx_bystander');
      const room = await joinHall(target);
      const other = await joinHall(bystander);
      const heard = listen(room);
      await until(() => other.state?.players?.size === 2);

      expect((await sanction(staff, target, { kind: 'suspension', minutes: 60, reason: 'Harcèlement' })).statusCode).toBe(201);
      await until(() => heard.code === 4004, 3000);
      await until(() => !playerOf(other, target.id), 3000);
      expect(playerOf(other, bystander.id)).toBeDefined();
      // The session no longer works, for the API and for the rooms.
      await expect(joinHall(target)).rejects.toThrow(/Non connecté/);
      expect((await app.inject({ method: 'GET', url: '/api/auth/me', cookies: { coloxel_sid: target.sid } })).statusCode).toBe(401);
    });

    it('shows a banned player who is inside an apartment out too', async () => {
      const staff = await staffMember('sx_staff3');
      const host = await signUp('sx_host');
      const guest = await signUp('sx_guest');
      await setAccess(host.id, 'building');
      const inFlat = await joinApartment(host, host.id);
      const visitor = await joinApartment(guest, host.id);
      const heard = listen(visitor);
      await until(() => inFlat.state?.players?.size === 2);
      await sanction(staff, guest, { kind: 'ban', reason: 'Comportement inacceptable' });
      await until(() => heard.code === 4004, 3000);
      await until(() => inFlat.state?.players?.size === 1, 3000);
    });

    it('delivers a warning to a connected player without any other effect', async () => {
      const staff = await staffMember('sx_staff4');
      const target = await signUp('sx_warned');
      const room = await joinHall(target);
      const heard = listen(room);
      await until(() => room.state?.players?.size === 1);
      await sanction(staff, target, { kind: 'warning', reason: 'Reste poli avec les autres.' });
      await until(() => heard.notices.length === 1, 3000);
      expect(heard.notices[0]).toMatchObject({ kind: 'warning' });
      expect(heard.notices[0]!.text).toMatch(/Reste poli/);
      room.send('chat', { text: 'merci, compris' });
      await until(() => heard.chat.length === 1);
      expect(heard.code).toBe(0);
    });
  });

  describe('doorbell and showing out', () => {
    it('shows out, with its own code, a visitor the owner expels, and keeps them out', async () => {
      const owner = await signUp('db_owner');
      const pest = await signUp('db_pest');
      await setAccess(owner.id, 'building');
      const host = await joinApartment(owner, owner.id);
      const visitor = await joinApartment(pest, owner.id);
      let code = 0;
      visitor.onLeave((c: number) => (code = c));
      await until(() => host.state?.players?.size === 2);
      const res = await app.inject({ method: 'POST', url: `/api/apartment/visitors/${pest.id}/expel`, cookies: { coloxel_sid: owner.sid } });
      expect(res.statusCode).toBe(200);
      await until(() => code === 4005, 4000);
      await until(() => host.state?.players?.size === 1);
      await expect(joinApartment(pest, owner.id)).rejects.toThrow(/fermé/);
    });

    it('tells the owner who rings, and the visitor what the owner answered, on their open connections', async () => {
      const owner = await signUp('db2_owner');
      const caller = await signUp('db2_caller');
      await app.inject({ method: 'PUT', url: '/api/apartment', payload: { access: 'bell' }, cookies: { coloxel_sid: owner.sid } });
      const home = await joinApartment(owner, owner.id);
      const hall = await joinHall(caller);
      const rings: { visitorId: string; nickname: string }[] = [];
      const answers: { accepted: boolean }[] = [];
      home.onMessage('ring', (m: { visitorId: string; nickname: string }) => rings.push(m));
      hall.onMessage('bell-answer', (m: { accepted: boolean }) => answers.push(m));
      await until(() => hall.state?.players?.size === 1);

      const rung = await app.inject({ method: 'POST', url: `/api/apartments/${owner.id}/ring`, cookies: { coloxel_sid: caller.sid } });
      expect(rung.statusCode).toBe(202);
      await until(() => rings.length === 1, 3000);
      expect(rings[0]).toEqual({ visitorId: caller.id, nickname: 'db2_caller' });
      await app.inject({ method: 'POST', url: '/api/apartment/bell/answer', payload: { visitorId: caller.id, accept: true }, cookies: { coloxel_sid: owner.sid } });
      await until(() => answers.length === 1, 3000);
      expect(answers[0]!.accepted).toBe(true);
      // The door is open: the visitor goes in.
      const inside = await joinApartment(caller, owner.id);
      await until(() => home.state?.players?.size === 2 && !!playerOf(inside, caller.id));
    });
  });

  describe('commands, dancing and following', () => {
    const emoteOf = (room: AnyRoom, id: string) => (room.state?.players?.get(id) as { emote: number } | undefined)?.emote;
    const listenSystem = (room: AnyRoom) => {
      const heard = { system: [] as string[], chat: [] as string[] };
      room.onMessage('system', (m: { text: string }) => heard.system.push(m.text));
      room.onMessage('chat', (m: { text: string }) => heard.chat.push(m.text));
      return heard;
    };
    const named = async (nickname: string) => ({ ...(await signUp(nickname)), nickname });
    const befriend = async (a: Account, b: Account & { nickname: string }) => {
      await app.inject({ method: 'POST', url: '/api/friends/requests', payload: { nickname: b.nickname }, cookies: { coloxel_sid: a.sid } });
      await app.inject({ method: 'POST', url: `/api/friends/requests/${a.id}/accept`, cookies: { coloxel_sid: b.sid } });
    };

    it('answers a command to its author only: it is not chat, not shown, not journaled', async () => {
      const ann = await named('cm_ann');
      const bob = await named('cm_bob');
      const a = await joinHall(ann);
      const b = await joinHall(bob);
      const heardA = listenSystem(a);
      const heardB = listenSystem(b);
      await until(() => a.state?.players?.size === 2);
      a.send('chat', { text: '/aide' });
      a.send('chat', { text: '/nimportequoi' });
      await until(() => heardA.system.length === 2);
      expect(heardA.system[0]).toMatch(/\/danse/);
      expect(heardA.system[1]).toMatch(/inconnue/);
      await new Promise((r) => setTimeout(r, 200));
      expect(heardB.system).toEqual([]);
      expect(heardB.chat).toEqual([]);
      expect((await pool.query('SELECT count(*) FROM chat_log WHERE user_id = $1', [ann.id])).rows[0].count).toBe('0');
    });

    it('lets a player dance, shows everybody, and stops when they walk away or ask', async () => {
      const cat = await named('cm_cat');
      const dan = await named('cm_dan');
      const a = await joinHall(cat);
      const b = await joinHall(dan);
      await until(() => a.state?.players?.size === 2 && b.state?.players?.size === 2);
      a.send('chat', { text: '/danse' });
      await until(() => emoteOf(b, cat.id) === 1);
      a.send('move', { i: SPAWN.i, j: 3 });
      await until(() => emoteOf(b, cat.id) === 0, 3000);
      a.send('chat', { text: '/danser' });
      await until(() => emoteOf(b, cat.id) === 1);
      a.send('chat', { text: '/danse' });
      await until(() => emoteOf(b, cat.id) === 0);
    });

    it('lets a player follow a friend of the room, a step behind, and refuses strangers', async () => {
      const eve = await named('cm_eve');
      const fay = await named('cm_fay');
      const gus = await named('cm_gus');
      await befriend(eve, fay);
      const a = await joinHall(eve);
      const b = await joinHall(fay);
      const c = await joinHall(gus);
      const heardA = listenSystem(a);
      const heardC = listenSystem(c);
      await until(() => a.state?.players?.size === 3);

      c.send('chat', { text: '/suivre cm_eve' });
      await until(() => heardC.system.length === 1);
      expect(heardC.system[0]).toMatch(/amis/);
      a.send('chat', { text: '/suivre personne' });
      a.send('chat', { text: '/suivre' });
      a.send('chat', { text: '/suivre cm_fay' });
      await until(() => heardA.system.length === 3);
      expect(heardA.system[2]).toMatch(/Tu suis cm_fay/);

      // Fay walks to the far side of the hall: Eve ends up beside her, not on her.
      b.send('move', { i: 1, j: 6 });
      await until(() => playerOf(b, fay.id)?.i === 1 && playerOf(b, fay.id)?.j === 6, 12000);
      await until(() => {
        const me = playerOf(a, eve.id)!;
        const her = playerOf(a, fay.id)!;
        return Math.max(Math.abs(me.i - her.i), Math.abs(me.j - her.j)) === 1;
      }, 12000);
      const me = playerOf(a, eve.id)!;
      expect({ i: me.i, j: me.j }).not.toEqual({ i: 1, j: 6 });

      // Walking by oneself ends it.
      a.send('move', { i: 7, j: 0 });
      await until(() => playerOf(a, eve.id)?.i === 7 && playerOf(a, eve.id)?.j === 0, 12000);
      b.send('move', { i: 0, j: 7 });
      await until(() => playerOf(a, fay.id)?.i === 0 && playerOf(a, fay.id)?.j === 7, 12000);
      await new Promise((r) => setTimeout(r, STEP_MS * 3));
      expect(playerOf(a, eve.id)).toMatchObject({ i: 7, j: 0 });
    }, 40000);

    it('stops following when asked, or when the other leaves the room', async () => {
      const hal = await named('cm_hal');
      const ida = await named('cm_ida');
      await befriend(hal, ida);
      const a = await joinHall(hal);
      const b = await joinHall(ida);
      const heardA = listenSystem(a);
      await until(() => a.state?.players?.size === 2);
      a.send('chat', { text: '/suivre cm_ida' });
      a.send('chat', { text: '/stop' });
      await until(() => heardA.system.length === 2);
      expect(heardA.system[1]).toBe('C’est fait.');
      a.send('chat', { text: '/stop' });
      await until(() => heardA.system.length === 3);
      expect(heardA.system[2]).toMatch(/Rien/);
      void b;
    });
  });

  it('keeps players out of the rooms during maintenance, and lets the staff in', async () => {
    const player = await signUp('mt_player');
    const staff = await signUp('mt_staff');
    await pool.query("UPDATE users SET role = 'administrateur' WHERE id = $1", [staff.id]);
    await app.inject({ method: 'PUT', url: '/api/staff/maintenance', payload: { on: true }, cookies: { coloxel_sid: staff.sid } });
    try {
      await expect(joinHall(player)).rejects.toThrow(/maintenance/);
      await expect(joinHall(staff)).resolves.toBeDefined();
    } finally {
      await app.inject({ method: 'PUT', url: '/api/staff/maintenance', payload: { on: false }, cookies: { coloxel_sid: staff.sid } });
      forgetMaintenance();
    }
    await expect(joinHall(player)).resolves.toBeDefined();
  });

  describe('chat', () => {
    interface Heard {
      chat: { id: number; from: string; nickname: string; text: string }[];
      refused: { reason: string; message: string }[];
    }
    const listen = (room: AnyRoom): Heard => {
      const heard: Heard = { chat: [], refused: [] };
      room.onMessage('chat', (m: Heard['chat'][number]) => heard.chat.push(m));
      room.onMessage('chat-refused', (m: Heard['refused'][number]) => heard.refused.push(m));
      return heard;
    };
    const settle = () => new Promise((r) => setTimeout(r, 300));
    const logOf = async (userId: string) =>
      (await pool.query('SELECT room, text, blocked, reason FROM chat_log WHERE user_id = $1 ORDER BY id', [userId])).rows;

    it('shows a message to everybody in the room, signed with the session’s identity, and journals it', async () => {
      const ada = await signUp('chat_ada');
      const bo = await signUp('chat_bo');
      const a = await joinHall(ada);
      const b = await joinHall(bo);
      const heardA = listen(a);
      const heardB = listen(b);
      await until(() => a.state?.players?.size === 2 && b.state?.players?.size === 2);

      a.send('chat', { text: '  Salut   tout le monde !  ' });
      await until(() => heardA.chat.length === 1 && heardB.chat.length === 1);
      expect(heardB.chat[0]).toMatchObject({ from: ada.id, nickname: 'chat_ada', text: 'Salut tout le monde !' });
      expect(await logOf(ada.id)).toEqual([{ room: 'hall', text: 'Salut tout le monde !', blocked: false, reason: null }]);
      // The id shown to the others is the journal's id: it is what a report points to.
      const { rows } = await pool.query('SELECT id FROM chat_log WHERE user_id = $1', [ada.id]);
      expect(Number(rows[0].id)).toBe(heardB.chat[0]!.id);
    });

    it('refuses a message that names another author, or is not text', async () => {
      const cy = await signUp('chat_cy');
      const di = await signUp('chat_di');
      const a = await joinHall(cy);
      const b = await joinHall(di);
      const heardB = listen(b);
      await until(() => a.state?.players?.size === 2);
      a.send('chat', { text: 'je suis di', from: di.id });
      a.send('chat', { text: 'je suis di', id: di.id, nickname: 'chat_di' });
      for (const bad of [null, 'salut', 42, [1], { text: 12 }, {}]) a.send('chat', bad);
      await settle();
      expect(heardB.chat).toEqual([]);
      expect(await logOf(di.id)).toEqual([]);
    });

    it('keeps a message inside the room it was said in', async () => {
      const eli = await signUp('chat_eli');
      const fab = await signUp('chat_fab');
      const gus = await signUp('chat_gus');
      await setAccess(eli.id, 'building');
      const inFlat = await joinApartment(eli, eli.id);
      const visitor = await joinApartment(fab, eli.id);
      const inHall = await joinHall(gus);
      const heardVisitor = listen(visitor);
      const heardHall = listen(inHall);
      await until(() => inFlat.state?.players?.size === 2);

      inFlat.send('chat', { text: 'bienvenue chez moi' });
      await until(() => heardVisitor.chat.length === 1);
      await settle();
      expect(heardHall.chat).toEqual([]);
      expect((await logOf(eli.id))[0]).toMatchObject({ room: `apartment:${eli.id}` });
    });

    it('blocks insults, links, emails, phone numbers and social handles: only the author hears of it, and it is journaled', async () => {
      const hal = await signUp('chat_hal');
      const ivo = await signUp('chat_ivo');
      const a = await joinHall(hal);
      const b = await joinHall(ivo);
      const heardA = listen(a);
      const heardB = listen(b);
      await until(() => a.state?.players?.size === 2);

      const cases: [string, string][] = [
        ['regarde exemple.com', 'link'],
        ['https://monsite.fr', 'link'],
        ['écris-moi à jean@gmail.com', 'email'],
        ['appelle le 06 12 34 56 78', 'phone'],
        ['ajoute moi sur insta', 'social'],
        ['espèce de connard', 'insult'],
      ];
      // The limiter lets five through per window: refill it between groups of cases.
      for (const [k, [text]] of cases.entries()) {
        a.send('chat', { text });
        await until(() => heardA.refused.length === k + 1);
        if (k % 4 === 3) await new Promise((r) => setTimeout(r, 8100));
      }
      expect(heardB.chat).toEqual([]);
      expect(heardA.chat).toEqual([]);
      expect(heardA.refused.map((r) => r.reason)).toEqual(cases.map(() => 'filtered'));
      const log = await logOf(hal.id);
      expect(log.map((l) => [l.text, l.blocked, l.reason])).toEqual(cases.map(([text, reason]) => [text, true, reason]));
    }, 30000);

    it('refuses empty and over-long messages without journaling them', async () => {
      const jo = await signUp('chat_jo');
      const a = await joinHall(jo);
      const heard = listen(a);
      await until(() => a.state?.players?.size === 1);
      a.send('chat', { text: '   ' });
      a.send('chat', { text: 'x'.repeat(121) });
      await until(() => heard.refused.length === 2);
      expect(heard.refused.map((r) => r.reason)).toEqual(['empty', 'too-long']);
      a.send('chat', { text: 'y'.repeat(120) });
      await until(() => heard.chat.length === 1);
      expect(await logOf(jo.id)).toHaveLength(1);
    });

    it('limits a client that sends messages in a burst, without taking the room down', async () => {
      const kit = await signUp('chat_kit');
      const lou = await signUp('chat_lou');
      const spammer = await joinHall(kit);
      const calm = await joinHall(lou);
      const heardCalm = listen(calm);
      const heardSpammer = listen(spammer);
      await until(() => calm.state?.players?.size === 2);

      // Twelve in a row: under the connection's own flood limit, over the chat's.
      for (let k = 0; k < 12; k++) spammer.send('chat', { text: `message ${k}` });
      await until(() => heardSpammer.chat.length + heardSpammer.refused.length === 12);
      expect(heardSpammer.chat).toHaveLength(5);
      expect(heardSpammer.refused.every((r) => r.reason === 'rate')).toBe(true);
      expect(heardCalm.chat.map((m) => m.text)).toEqual([0, 1, 2, 3, 4].map((k) => `message ${k}`));

      // The room is alive, and the quiet player is not limited by the other's flood.
      calm.send('chat', { text: 'toujours là' });
      await until(() => heardCalm.chat.length === 6);
      calm.send('move', { i: SPAWN.i, j: 2 });
      await until(() => playerOf(calm, lou.id)!.j === 2, 3000);
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
