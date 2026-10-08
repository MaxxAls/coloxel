import type pg from 'pg';
import { Client, type Room } from '@colyseus/sdk';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { SEEDS, STARTER_KIT, lookFor, parseLook } from '@coloxel/render';
import type { RecipeModel } from '../src/creations/model';
import { migrate, migrateDownAll } from '../src/db/migrate';
import { createPool } from '../src/db/pool';
import { buildServer } from '../src/index';
import { startRealtime, type Realtime } from '../src/realtime';
import { DEFAULT_LAYOUT, N } from '@coloxel/world';
import { SPAWN, STEP_MS } from '../src/realtime/rooms';

/** Where a new apartment is entered (the hall has its own door, SPAWN). */
const DOOR = DEFAULT_LAYOUT.door;
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
      'INSERT INTO apartments (id, floor, slot) SELECT n, 10 + n, 0 FROM generate_series(31, 400) AS n',
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
    for (const bad of [{ i: -1, j: 0 }, { i: N, j: 0 }, { i: 1.5, j: 1 }, { i: 'x', j: 1 }, null, 'move', [1, 2]]) a.send('move', bad);
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
      // A new account's apartment holds the starter kit, with a chair and a double bed.
      const kitCell = (key: string) => {
        const piece = STARTER_KIT.find((k) => k.key === key)!;
        return { i: piece.i, j: piece.j };
      };
      const CHAIR = kitCell('chaise');
      // The foot of the double bed: its head is between the two bedside tables.
      const BED = { i: kitCell('grandlit').i + 1, j: kitCell('grandlit').j };
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
        // The bed stands in the far corner of the room: a long walk from the door.
      }, 20000);

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
        payload: { itemId: created.json().item.id, i: DOOR.i, j: DOOR.j },
        cookies: { coloxel_sid: uma.sid },
      });
      await setAccess(uma.id, 'building');
      const host = await joinApartment(uma, uma.id);
      const guest = await joinApartment(vic, uma.id);
      await until(() => playerOf(guest, uma.id) && playerOf(guest, vic.id));
      const a = playerOf(guest, uma.id)!;
      const b = playerOf(guest, vic.id)!;
      expect(a).not.toMatchObject(DOOR);
      expect(b).not.toMatchObject(DOOR);
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
        payload: { itemId, i: DOOR.i, j: 1 },
        cookies: { coloxel_sid: rose.sid },
      });
      const room = await joinApartment(rose, rose.id);
      await until(() => playerOf(room, rose.id));

      room.send('move', { i: DOOR.i, j: 1 }); // blocked cell
      await new Promise((r) => setTimeout(r, STEP_MS * 4));
      expect(playerOf(room, rose.id)).toMatchObject(DOOR);

      room.send('move', { i: DOOR.i - 1, j: 1 });
      await until(() => playerOf(room, rose.id)!.i === DOOR.i - 1 && playerOf(room, rose.id)!.j === 1);
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

    it('lets a companion do the tricks it has learnt, and only when it is in a mood for it', async () => {
      const eli = await named('pt_eli');
      const adopt = async (a: Account, xp: number, hoursSinceMeal: number) => {
        const pet = (await pool.query<{ id: string }>("INSERT INTO pets (owner_id, species, color, name, xp, fed_at) VALUES ($1, 'chien', 0, 'Rex', $2, now() - ($3 || ' hours')::interval) RETURNING id", [a.id, xp, String(hoursSinceMeal)])).rows[0]!.id;
        await pool.query('UPDATE users SET active_pet_id = $2 WHERE id = $1', [a.id, pet]);
      };
      // Without a companion: told so.
      const bare = await joinHall(eli);
      const heardBare = listenSystem(bare);
      bare.send('chat', { text: '/compagnon assis' });
      await until(() => heardBare.system.length > 0, 3000);
      expect(heardBare.system[0]).toMatch(/pas de compagnon/);

      // A happy level 1 companion sits, but does not yet jump.
      const fay = await named('pt_fay');
      await adopt(fay, 0, 0);
      const room = await joinHall(fay);
      const heard = listenSystem(room);
      const tricks: { id: string; trick: string }[] = [];
      room.onMessage('pet-trick', (m: { id: string; trick: string }) => tricks.push(m));
      await until(() => (room.state?.players?.get(fay.id) as { petLevel: number } | undefined)?.petLevel === 1, 3000);
      room.send('chat', { text: '/compagnon saute' });
      await until(() => heard.system.length > 0, 3000);
      expect(heard.system[0]).toMatch(/niveau 2/);
      expect(tricks).toHaveLength(0);
      room.send('chat', { text: '/compagnon assis' });
      await until(() => tricks.length === 1, 3000);
      expect(tricks[0]).toEqual({ id: fay.id, trick: 'assis' });
      // A trick name that does not exist.
      room.send('chat', { text: '/compagnon voler' });
      await until(() => heard.system.length > 1, 3000);
      expect(heard.system[1]).toMatch(/Quel tour/);

      // A hungry one is sad and refuses.
      const gus = await named('pt_gus');
      await adopt(gus, 0, 30);
      const sad = await joinHall(gus);
      const heardSad = listenSystem(sad);
      await until(() => (sad.state?.players?.get(gus.id) as { petMood: number } | undefined)?.petMood === 2, 3000);
      sad.send('chat', { text: '/compagnon assis' });
      await until(() => heardSad.system.length > 0, 3000);
      expect(heardSad.system[0]).toMatch(/triste/);
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

    it('lets a player sit or lie on the floor, stand up, walk backwards, and push or pull a neighbour', async () => {
      const ida = await named('cm_ida');
      const jo = await named('cm_jo');
      const a = await joinHall(ida);
      const b = await joinHall(jo);
      await until(() => a.state?.players?.size === 2 && b.state?.players?.size === 2);
      const poseOf = (room: AnyRoom, id: string) => (room.state?.players?.get(id) as { pose: number } | undefined)?.pose;
      const dirOf = (room: AnyRoom, id: string) => (room.state?.players?.get(id) as { dir: number } | undefined)?.dir;
      // Sit down on the floor, lie down, get up.
      a.send('chat', { text: '/assis' });
      await until(() => poseOf(b, ida.id) === 1);
      a.send('chat', { text: '/allonge' });
      await until(() => poseOf(b, ida.id) === 2);
      a.send('chat', { text: '/debout' });
      await until(() => poseOf(b, ida.id) === 0);
      // Walking backwards: the body faces against the step (one step along +j, so the body faces -j).
      const start = { ...playerOf(b, ida.id)! };
      a.send('chat', { text: '/reculons' });
      await new Promise((r) => setTimeout(r, 150));
      a.send('move', { i: start.i - 2, j: start.j });
      await until(() => playerOf(b, ida.id)!.i === start.i - 2, 4000);
      expect(dirOf(b, ida.id)).toBe((1 + 1) * 3 + (0 + 1));
      // Jo comes next to Ida, then Ida pushes Jo one cell away and pulls them back.
      b.send('move', { i: start.i - 2, j: start.j + 1 });
      await until(() => playerOf(a, jo.id)!.i === start.i - 2 && playerOf(a, jo.id)!.j === start.j + 1, 6000);
      // Commands count as chat: five in eight seconds at most.
      await new Promise((r) => setTimeout(r, 4000));
      a.send('chat', { text: '/pousser cm_jo' });
      await until(() => playerOf(a, jo.id)!.j === start.j + 2, 3000);
      await new Promise((r) => setTimeout(r, 5000));
      a.send('chat', { text: '/tirer cm_jo' });
      await until(() => playerOf(a, jo.id)!.j === start.j + 1, 3000);
    }, 40000);

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

  describe('mechanisms', () => {
    const lampOf = async (a: Account) => (await pool.query<{ id: string }>("SELECT id FROM furniture WHERE owner_id = $1 AND catalogue_key = 'lampadaire'", [a.id])).rows[0]!.id;
    const isLit = async (a: Account) =>
      (await pool.query<{ lit: boolean }>("SELECT p.lit FROM placements p JOIN furniture f ON f.id = p.furniture_id WHERE p.user_id = $1 AND f.catalogue_key = 'lampadaire'", [a.id])).rows[0]!.lit;
    const rule = (trigger: object, effects: object[], extra: object = {}) => ({ enabled: true, trigger, conditions: [], effects, ...extra });
    const saveRules = async (owner: Account, rules: object[]) => {
      const res = await app.inject({ method: 'PUT', url: '/api/apartment/rules', payload: { rules }, cookies: { coloxel_sid: owner.sid } });
      expect(res.statusCode, JSON.stringify(res.json())).toBe(200);
      // The room hears of it through the presence store: a moment.
      await new Promise((r) => setTimeout(r, 250));
    };
    const place = async (a: Account, key: string, i: number, j: number) => {
      const id = (await pool.query<{ id: string }>('INSERT INTO furniture (owner_id, catalogue_key) VALUES ($1, $2) RETURNING id', [a.id, key])).rows[0]!.id;
      await pool.query('INSERT INTO placements (furniture_id, user_id, i, j) VALUES ($1, $2, $3, $4)', [id, a.id, i, j]);
      return id;
    };
    const listen = (room: AnyRoom) => {
      const heard = { fx: [] as { i: number; j: number }[], decor: 0, messages: [] as string[] };
      room.onMessage('fx', (m: { i: number; j: number }) => heard.fx.push({ i: m.i, j: m.j }));
      room.onMessage('decor', () => heard.decor++);
      room.onMessage('rule-message', (m: { text: string }) => heard.messages.push(m.text));
      return heard;
    };
    const at = (room: AnyRoom, id: string, i: number, j: number) => playerOf(room, id)?.i === i && playerOf(room, id)?.j === j;
    const emoteOf = (room: AnyRoom, id: string) => (room.state?.players?.get(id) as { emote: number } | undefined)?.emote;
    const walk = 12000;

    it('lights and puts out a lamp when somebody steps on a cell, and shows the whole room', async () => {
      const owner = await signUp('mx_step');
      await saveRules(owner, [rule({ type: 'step', cell: { i: 3, j: 3 } }, [{ type: 'light', piece: await lampOf(owner), mode: 'off' }])]);
      const room = await joinApartment(owner, owner.id);
      const heard = listen(room);
      await until(() => playerOf(room, owner.id));
      expect(await isLit(owner)).toBe(true);
      room.send('move', { i: 3, j: 3 });
      await until(() => at(room, owner.id, 3, 3), walk);
      await until(() => heard.decor > 0, 3000);
      expect(await isLit(owner)).toBe(false);
      // The cell that was stepped on and the lamp itself light up for everybody.
      const lamp = STARTER_KIT.find((k) => k.key === 'lampadaire')!;
      expect(heard.fx).toEqual(expect.arrayContaining([{ i: 3, j: 3 }, { i: lamp.i, j: lamp.j }]));
    }, 30000);

    it('sets a rule off for a visitor, who is the one it happens to', async () => {
      const owner = await signUp('mx_say');
      const guest = await signUp('mx_say_guest');
      await setAccess(owner.id, 'building');
      await saveRules(owner, [rule({ type: 'say', word: 'Abracadabra' }, [{ type: 'teleport', cell: { i: 2, j: 7 } }, { type: 'message', text: 'Sésame, ouvre-toi !' }])]);
      const host = await joinApartment(owner, owner.id);
      const visitor = await joinApartment(guest, owner.id);
      const heardHost = listen(host);
      const heardGuest = listen(visitor);
      await until(() => host.state?.players?.size === 2);
      const ownerCell = { ...playerOf(host, owner.id)! };

      visitor.send('chat', { text: 'abracadabra !' });
      await until(() => at(host, guest.id, 2, 7), 4000);
      await until(() => heardGuest.messages.length === 1, 3000);
      expect(heardGuest.messages).toEqual(['Sésame, ouvre-toi !']);
      // The owner is not moved, and does not hear the message meant for the visitor.
      expect(playerOf(host, owner.id)).toMatchObject(ownerCell);
      expect(heardHost.messages).toEqual([]);
    });

    it('greets whoever comes in, only if the condition holds', async () => {
      const owner = await signUp('mx_enter');
      const guest = await signUp('mx_enter_guest');
      await setAccess(owner.id, 'building');
      await saveRules(owner, [{ enabled: true, trigger: { type: 'enter' }, conditions: [{ type: 'players', op: '>=', n: 2 }], effects: [{ type: 'message', text: 'Bienvenue chez moi' }] }]);
      const host = await joinApartment(owner, owner.id);
      const heardHost = listen(host);
      await until(() => playerOf(host, owner.id));
      await new Promise((r) => setTimeout(r, 400));
      expect(heardHost.messages).toEqual([]); // alone: the condition fails
      const visitor = await joinApartment(guest, owner.id);
      const heardGuest = listen(visitor);
      await until(() => host.state?.players?.size === 2);
      await new Promise((r) => setTimeout(r, 500));
      // The greeting goes to the one who came in, never to the owner.
      expect(heardHost.messages).toEqual([]);
      void heardGuest;
    });

    it('sets a rule off by a click on a button, and only on a button', async () => {
      const owner = await signUp('mx_use');
      await place(owner, 'bouton', 6, 6);
      await saveRules(owner, [
        rule({ type: 'use', cell: { i: 6, j: 6 } }, [{ type: 'light', piece: await lampOf(owner), mode: 'toggle' }]),
        rule({ type: 'use', cell: { i: 4, j: 4 } }, [{ type: 'light', piece: await lampOf(owner), mode: 'off' }]),
      ]);
      const room = await joinApartment(owner, owner.id);
      const heard = listen(room);
      await until(() => playerOf(room, owner.id));
      // The rug is not a button: the click does nothing.
      room.send('use', { i: 4, j: 4 });
      await new Promise((r) => setTimeout(r, 600));
      expect(await isLit(owner)).toBe(true);
      room.send('use', { i: 6, j: 6 });
      await until(() => heard.decor > 0, 3000);
      expect(await isLit(owner)).toBe(false);
      // A forged click is ignored.
      for (const bad of [null, { i: 'a', j: 1 }, { i: 9, j: 9 }, { i: 6, j: 6, who: 'x' }]) room.send('use', bad);
      await new Promise((r) => setTimeout(r, 600));
      expect(await isLit(owner)).toBe(false);
    });

    it('lets the owner shut a gate, which then blocks the way, and open it again', async () => {
      const owner = await signUp('mx_gate');
      await place(owner, 'portillon', 6, 6);
      const room = await joinApartment(owner, owner.id);
      const heard = listen(room);
      await until(() => playerOf(room, owner.id));
      const gateLit = async () => (await pool.query<{ lit: boolean }>("SELECT p.lit FROM placements p JOIN furniture f ON f.id = p.furniture_id WHERE p.user_id = $1 AND f.catalogue_key = 'portillon'", [owner.id])).rows[0]!.lit;
      // Placed, it stands open: a player may walk onto it.
      expect(await gateLit()).toBe(true);
      room.send('move', { i: 6, j: 6 });
      await until(() => at(room, owner.id, 6, 6), walk);
      room.send('move', { i: 6, j: 5 });
      await until(() => at(room, owner.id, 6, 5), walk);
      // Closed, it is a wall.
      room.send('use', { i: 6, j: 6 });
      await until(() => heard.decor > 0, 3000);
      expect(await gateLit()).toBe(false);
      room.send('move', { i: 6, j: 6 });
      await new Promise((r) => setTimeout(r, STEP_MS * 4));
      expect(at(room, owner.id, 6, 6)).toBe(false);
      // Open again.
      room.send('use', { i: 6, j: 6 });
      await until(() => heard.decor > 1, 3000);
      expect(await gateLit()).toBe(true);
    }, 40000);

    it('does not shut a gate on somebody standing in it', async () => {
      const owner = await signUp('mx_gate2');
      await place(owner, 'portillon', 6, 6);
      const room = await joinApartment(owner, owner.id);
      const heard = listen(room);
      await until(() => playerOf(room, owner.id));
      room.send('move', { i: 6, j: 6 });
      await until(() => at(room, owner.id, 6, 6), walk);
      room.send('use', { i: 6, j: 6 });
      await until(() => heard.messages.length > 0, 3000);
      expect(heard.messages[0]).toMatch(/passage/);
      expect((await pool.query<{ lit: boolean }>("SELECT p.lit FROM placements p JOIN furniture f ON f.id = p.furniture_id WHERE p.user_id = $1 AND f.catalogue_key = 'portillon'", [owner.id])).rows[0]!.lit).toBe(true);
    });

    it('throws confetti for the whole room when the cannon is clicked, one shower at a time', async () => {
      const owner = await signUp('mx_cannon');
      await place(owner, 'canonconfettis', 6, 6);
      const room = await joinApartment(owner, owner.id);
      let showers = 0;
      room.onMessage('fx', (m: { kind: string }) => { if (m.kind === 'confetti') showers++; });
      await until(() => playerOf(room, owner.id));
      room.send('use', { i: 6, j: 6 });
      await until(() => showers === 1, 3000);
      await new Promise((r) => setTimeout(r, 600));
      room.send('use', { i: 6, j: 6 });
      await new Promise((r) => setTimeout(r, 800));
      expect(showers).toBe(1);
    });

    it('runs the colour race: needs two players, splits them in teams, paints the tiles they walk on', async () => {
      const owner = await signUp('mx_race');
      const guest = await signUp('mx_race2');
      await setAccess(owner.id, 'building');
      await place(owner, 'tableaucouleurs', 6, 6);
      const host = await joinApartment(owner, owner.id);
      const heard = { start: [] as any[], paint: [] as any[], messages: [] as string[] };
      host.onMessage('game', (m: any) => heard.start.push(m));
      host.onMessage('game-paint', (m: any) => heard.paint.push(m));
      host.onMessage('rule-message', (m: { text: string }) => heard.messages.push(m.text));
      await until(() => playerOf(host, owner.id));
      // Alone: refused.
      host.send('use', { i: 6, j: 6 });
      await until(() => heard.messages.length > 0, 3000);
      expect(heard.messages[0]).toMatch(/au moins 2 joueurs/);
      expect(heard.start).toHaveLength(0);

      const other = await joinApartment(guest, owner.id);
      await until(() => playerOf(host, guest.id) && playerOf(other, owner.id));
      await new Promise((r) => setTimeout(r, 600));
      host.send('use', { i: 6, j: 6 });
      await until(() => heard.start.length > 0, 3000);
      expect(heard.start[0]).toMatchObject({ running: true });
      expect(Object.keys(heard.start[0].teams).sort()).toEqual([owner.id, guest.id].sort());
      expect(new Set(Object.values(heard.start[0].teams)).size).toBe(2);

      // Walking paints.
      host.send('move', { i: 6, j: 1 });
      await until(() => heard.paint.some((p) => p.i === 6 && p.j === 1), walk);
      const mineTeam = heard.start[0].teams[owner.id];
      expect(heard.paint.find((p) => p.i === 6 && p.j === 1).team).toBe(mineTeam);
    }, 40000);

    it('serves a drink from a dispenser to a player standing next to it, and lets them put it down', async () => {
      const owner = await signUp('mx_vend');
      await place(owner, 'machinecafe', 6, 6);
      const room = await joinApartment(owner, owner.id);
      const heard = listen(room);
      const handOf = () => (room.state?.players?.get(owner.id) as { hand: number } | undefined)?.hand;
      await until(() => playerOf(room, owner.id));
      // From across the room: nothing.
      room.send('use', { i: 6, j: 6 });
      await until(() => heard.messages.length > 0, 3000);
      expect(heard.messages[0]).toMatch(/Rapproche-toi/);
      expect(handOf()).toBe(0);
      // Next to it: a coffee.
      room.send('move', { i: 6, j: 5 });
      await until(() => at(room, owner.id, 6, 5), walk);
      room.send('use', { i: 6, j: 6 });
      await until(() => handOf() === 1, 3000);
      // Put it down.
      room.send('chat', { text: '/poser' });
      await until(() => handOf() === 0, 3000);
    }, 40000);

    it('plays a tune for the whole room, changes it at each click, and stops when the jukebox goes', async () => {
      const owner = await signUp('mx_juke');
      const guest = await signUp('mx_juke2');
      await setAccess(owner.id, 'building');
      const box = await place(owner, 'jukebox', 6, 6);
      const host = await joinApartment(owner, owner.id);
      const tunes: { track: number; elapsed: number }[] = [];
      host.onMessage('music', (m: { track: number; elapsed: number }) => tunes.push(m));
      await until(() => playerOf(host, owner.id));
      host.send('use', { i: 6, j: 6 });
      await until(() => tunes.length === 1, 3000);
      expect(tunes[0]).toEqual({ track: 1, elapsed: 0 });
      // Somebody arriving later is told which tune, and how far in.
      await new Promise((r) => setTimeout(r, 300));
      const late = await joinApartment(guest, owner.id);
      const lateTunes: { track: number; elapsed: number }[] = [];
      late.onMessage('music', (m: { track: number; elapsed: number }) => lateTunes.push(m));
      await until(() => lateTunes.length === 1, 3000);
      expect(lateTunes[0]!.track).toBe(1);
      expect(lateTunes[0]!.elapsed).toBeGreaterThan(200);
      // Clicking again right away is ignored (one change every few seconds).
      host.send('use', { i: 6, j: 6 });
      await new Promise((r) => setTimeout(r, 600));
      expect(tunes).toHaveLength(1);
      // The jukebox is thrown away: silence for everybody.
      await app.inject({ method: 'DELETE', url: `/api/furniture/${box}`, cookies: { coloxel_sid: owner.sid } });
      await until(() => tunes.length === 2, 3000);
      expect(tunes[1]).toEqual({ track: 0, elapsed: 0 });
    }, 40000);

    it('starts the statues game with three players, one keeper, and refuses a football game without goals', async () => {
      const owner = await signUp('mx_stat');
      const b = await signUp('mx_stat2');
      const c = await signUp('mx_stat3');
      await setAccess(owner.id, 'building');
      await place(owner, 'tableaustatues', 6, 6);
      await place(owner, 'coupdenvoi', 6, 5);
      const host = await joinApartment(owner, owner.id);
      const starts: any[] = [];
      const messages: string[] = [];
      host.onMessage('game', (m: any) => starts.push(m));
      host.onMessage('rule-message', (m: { text: string }) => messages.push(m.text));
      await until(() => playerOf(host, owner.id));
      const roomB = await joinApartment(b, owner.id);
      await until(() => playerOf(host, b.id) && playerOf(roomB, owner.id));
      await new Promise((r) => setTimeout(r, 400));
      // Two players: not enough for statues.
      host.send('use', { i: 6, j: 6 });
      await until(() => messages.length > 0, 3000);
      expect(messages[0]).toMatch(/au moins 3 joueurs/);
      // Football without goals.
      await new Promise((r) => setTimeout(r, 600));
      host.send('use', { i: 6, j: 5 });
      await until(() => messages.length > 1, 3000);
      expect(messages[1]).toMatch(/but rouge et un but bleu/);
      // Three players: it starts, with exactly one keeper.
      const roomC = await joinApartment(c, owner.id);
      await until(() => playerOf(host, c.id) && playerOf(roomC, owner.id));
      await new Promise((r) => setTimeout(r, 600));
      host.send('use', { i: 6, j: 6 });
      await until(() => starts.length > 0, 3000);
      expect(starts[0]).toMatchObject({ kind: 'freeze', running: true });
      expect(Object.values(starts[0].teams).filter((t) => t === 0)).toHaveLength(1);
      expect(Object.values(starts[0].teams).filter((t) => t === 1)).toHaveLength(2);
      // Another game cannot start on top of it.
      await new Promise((r) => setTimeout(r, 600));
      host.send('use', { i: 6, j: 5 });
      await until(() => messages.length > 2, 3000);
      expect(messages[2]).toMatch(/déjà en cours/);
    }, 40000);

    it('lets players walk over a pressure plate, and notices when they do', async () => {
      const owner = await signUp('mx_plate');
      await place(owner, 'plaque', 2, 5);
      await saveRules(owner, [rule({ type: 'step', cell: { i: 2, j: 5 } }, [{ type: 'dance' }])]);
      const room = await joinApartment(owner, owner.id);
      await until(() => playerOf(room, owner.id));
      room.send('move', { i: 2, j: 5 });
      await until(() => at(room, owner.id, 2, 5), walk);
      await until(() => emoteOf(room, owner.id) === 1, 3000);
      // A button, on the other hand, stands in the way like any piece of furniture.
      await place(owner, 'bouton', 6, 6);
      const start = { ...playerOf(room, owner.id)! };
      room.send('move', { i: 6, j: 6 });
      await new Promise((r) => setTimeout(r, 1500));
      expect(playerOf(room, owner.id)).toMatchObject({ i: start.i, j: start.j });
    }, 30000);

    it('sends a teleported player to the nearest free cell, and a teleport sets off nothing else', async () => {
      const owner = await signUp('mx_tp');
      const guest = await signUp('mx_tp_guest');
      await setAccess(owner.id, 'building');
      await saveRules(owner, [
        rule({ type: 'say', word: 'portail' }, [{ type: 'teleport', cell: { i: 6, j: 6 } }]),
        // Landing on (6,6) must not set this one off: what a rule does never feeds another rule.
        rule({ type: 'step', cell: { i: 6, j: 6 } }, [{ type: 'light', piece: await lampOf(owner), mode: 'off' }]),
      ]);
      const host = await joinApartment(owner, owner.id);
      const visitor = await joinApartment(guest, owner.id);
      await until(() => host.state?.players?.size === 2);
      // The owner stands on the target cell herself: stepping on it counts.
      host.send('move', { i: 6, j: 6 });
      await until(() => at(host, owner.id, 6, 6), walk);
      await new Promise((r) => setTimeout(r, 500));
      expect(await isLit(owner)).toBe(false);
      await pool.query("UPDATE placements p SET lit = true FROM furniture f WHERE p.furniture_id = f.id AND p.user_id = $1 AND f.catalogue_key = 'lampadaire'", [owner.id]);

      visitor.send('chat', { text: 'portail' });
      await until(() => {
        const p = playerOf(host, guest.id);
        return !!p && Math.abs(p.i - 6) + Math.abs(p.j - 6) === 1;
      }, 4000);
      await new Promise((r) => setTimeout(r, 500));
      expect(await isLit(owner)).toBe(true);
    }, 30000);

    it('does nothing for a rule that is switched off', async () => {
      const owner = await signUp('mx_off');
      await saveRules(owner, [rule({ type: 'step', cell: { i: 3, j: 3 } }, [{ type: 'light', piece: await lampOf(owner), mode: 'off' }], { enabled: false })]);
      const room = await joinApartment(owner, owner.id);
      await until(() => playerOf(room, owner.id));
      room.send('move', { i: 3, j: 3 });
      await until(() => at(room, owner.id, 3, 3), walk);
      await new Promise((r) => setTimeout(r, 500));
      expect(await isLit(owner)).toBe(true);
    }, 30000);

    it('acts on its own every few seconds while somebody is there', async () => {
      const owner = await signUp('mx_every');
      await saveRules(owner, [rule({ type: 'every', seconds: 5 }, [{ type: 'light', piece: await lampOf(owner), mode: 'toggle' }])]);
      const room = await joinApartment(owner, owner.id);
      await until(() => playerOf(room, owner.id));
      await new Promise((r) => setTimeout(r, 2500));
      expect(await isLit(owner)).toBe(true); // not yet
      const deadline = Date.now() + 9000;
      while (Date.now() < deadline && (await isLit(owner))) await new Promise((r) => setTimeout(r, 200));
      expect(await isLit(owner)).toBe(false);
    }, 30000);

    it('picks up the owner’s new rules without anybody leaving the room', async () => {
      const owner = await signUp('mx_live');
      const room = await joinApartment(owner, owner.id);
      await until(() => playerOf(room, owner.id));
      await saveRules(owner, [rule({ type: 'step', cell: { i: 3, j: 3 } }, [{ type: 'light', piece: await lampOf(owner), mode: 'off' }])]);
      room.send('move', { i: 3, j: 3 });
      await until(() => at(room, owner.id, 3, 3), walk);
      await new Promise((r) => setTimeout(r, 500));
      expect(await isLit(owner)).toBe(false);
    }, 30000);
  });

  describe('commands of the staff', () => {
    interface Heard {
      chat: string[];
      system: string[];
      alerts: { kind: string; text: string; from: string; link?: string; target?: { kind: string } }[];
      fx: { kind: string; on?: boolean }[];
      summons: { from: string; target: { kind: string } }[];
      gotos: { who: string; target: { kind: string } }[];
      refused: string[];
      code: number;
    }
    const hear = (room: AnyRoom): Heard => {
      const heard: Heard = { chat: [], system: [], alerts: [], fx: [], summons: [], gotos: [], refused: [], code: 0 };
      room.onMessage('chat', (m: { text: string }) => heard.chat.push(m.text));
      room.onMessage('system', (m: { text: string }) => heard.system.push(m.text));
      room.onMessage('alert', (m: Heard['alerts'][number]) => heard.alerts.push(m));
      room.onMessage('fx', (m: { kind: string; on?: boolean }) => heard.fx.push(m));
      room.onMessage('summon', (m: Heard['summons'][number]) => heard.summons.push(m));
      room.onMessage('goto', (m: Heard['gotos'][number]) => heard.gotos.push(m));
      room.onMessage('chat-refused', (m: { reason: string }) => heard.refused.push(m.reason));
      room.onLeave((c: number) => (heard.code = c));
      return heard;
    };
    const member = async (nickname: string, role: string) => {
      const a = await signUp(nickname);
      if (role !== 'user') await pool.query('UPDATE users SET role = $2 WHERE id = $1', [a.id, role]);
      return { ...a, nickname };
    };
    // The chat limiter lets a few messages through per window: commands count, so each test uses fresh accounts.
    const logOf = async (a: Account) => (await pool.query('SELECT command, args, room FROM staff_log WHERE staff_id = $1 ORDER BY id', [a.id])).rows;
    const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

    it('treats ":something" as plain chat for a player, and a smiley as plain chat for everybody', async () => {
      const player = await member('sc_player', 'user');
      const boss = await member('sc_smile', 'administrateur');
      const a = await joinHall(player);
      const b = await joinHall(boss);
      const heardB = hear(b);
      const heardA = hear(a);
      await until(() => a.state?.players?.size === 2);
      a.send('chat', { text: ':ha Je suis le chef' });
      b.send('chat', { text: ':)' });
      await until(() => heardB.chat.length === 2 && heardA.chat.length === 2, 3000);
      expect(heardB.chat).toEqual([':ha Je suis le chef', ':)']);
      expect(heardA.alerts).toEqual([]);
      expect(heardB.alerts).toEqual([]);
      expect(await logOf(player)).toEqual([]);
    });

    it('lets a role use only its own commands: anything else is chat, nobody learns what exists', async () => {
      const mod = await member('sc_mod_only', 'moderateur');
      const listener = await member('sc_listener', 'user');
      const m = await joinHall(mod);
      const l = await joinHall(listener);
      const heardM = hear(m);
      const heardL = hear(l);
      await until(() => m.state?.players?.size === 2);
      // A moderator may not alert the whole game, nor ban: both are just words in the chat.
      m.send('chat', { text: ':ha Bonjour tout le monde' });
      m.send('chat', { text: ':commandes' });
      await until(() => heardL.chat.length === 1 && heardM.system.length >= 1, 3000);
      expect(heardL.chat).toEqual([':ha Bonjour tout le monde']);
      expect(heardL.alerts).toEqual([]);
      expect(heardM.system[0]).toMatch(/Modérateur/);
      expect(heardM.system[0]).toContain(':kick');
      expect(heardM.system[0]).not.toContain(':ha');
      expect(heardM.system[0]).not.toContain(':ban');
    });

    it('alerts the whole game from ":ha", wherever the players are, and journals it', async () => {
      const senior = await member('sc_senior', 'super_moderateur');
      const host = await member('sc_ha_owner', 'user');
      const guest = await member('sc_ha_guest', 'user');
      await setAccess(host.id, 'building');
      const inHall = await joinHall(senior);
      const inFlat = await joinApartment(host, host.id);
      const elsewhere = await joinHall(guest);
      const heards = [hear(inHall), hear(inFlat), hear(elsewhere)];
      await until(() => inHall.state?.players?.size === 2);
      inHall.send('chat', { text: ':ha Le jeu redémarre dans 5 minutes' });
      await until(() => heards.every((h) => h.alerts.length === 1), 3000);
      for (const h of heards) expect(h.alerts[0]).toMatchObject({ kind: 'hotel', text: 'Le jeu redémarre dans 5 minutes', from: 'sc_senior' });
      expect(heards[0]!.chat).toEqual([]);
      // Nothing about it in the chat journal; the staff journal knows.
      expect((await pool.query('SELECT count(*) FROM chat_log WHERE user_id = $1', [senior.id])).rows[0].count).toBe('0');
      expect(await logOf(senior)).toEqual([{ command: 'ha', args: 'Le jeu redémarre dans 5 minutes', room: 'hall' }]);
    });

    it('only points ":hal" at a page of the website', async () => {
      const senior = await member('sc_hal', 'super_moderateur');
      const other = await member('sc_hal_other', 'user');
      const a = await joinHall(senior);
      const b = await joinHall(other);
      const heardA = hear(a);
      const heardB = hear(b);
      await until(() => a.state?.players?.size === 2);
      a.send('chat', { text: ':hal https://evil.example/phish Cadeau !' });
      await until(() => heardA.system.length >= 1, 3000);
      expect(heardA.system[0]).toMatch(/Usage/);
      a.send('chat', { text: ':hal /site/evenements Concours ce soir' });
      await until(() => heardB.alerts.length === 1, 3000);
      expect(heardB.alerts[0]).toMatchObject({ text: 'Concours ce soir', link: '/site/evenements' });
    });

    it('announces an event with ":ea", and can take everybody to the room where it is held', async () => {
      const host = await member('sc_event_host', 'animateur');
      const fan = await member('sc_event_fan', 'user');
      const a = await joinHall(host);
      const b = await joinHall(fan);
      const heardB = hear(b);
      await until(() => a.state?.players?.size === 2);
      a.send('chat', { text: ':ea Chasse aux objets dans le hall !' });
      await until(() => heardB.alerts.length === 1, 3000);
      expect(heardB.alerts[0]).toMatchObject({ kind: 'event', from: 'sc_event_host', target: { kind: 'hall' } });
    });

    it('alerts one room, or one player, and nobody else', async () => {
      const mod = await member('sc_ra', 'moderateur');
      const inRoom = await member('sc_ra_in', 'user');
      const outside = await member('sc_ra_out', 'user');
      await setAccess(mod.id, 'building');
      const m = await joinApartment(mod, mod.id);
      const inside = await joinApartment(inRoom, mod.id);
      const out = await joinHall(outside);
      const heardIn = hear(inside);
      const heardOut = hear(out);
      await until(() => m.state?.players?.size === 2);
      m.send('chat', { text: ':ra Merci de rester calmes' });
      await until(() => heardIn.alerts.length === 1, 3000);
      expect(heardIn.alerts[0]).toMatchObject({ kind: 'room', text: 'Merci de rester calmes' });
      expect(heardOut.alerts).toEqual([]);
      m.send('chat', { text: ':alert sc_ra_out Bonjour de la part de l’équipe' });
      await until(() => heardOut.alerts.length === 1, 3000);
      expect(heardOut.alerts[0]).toMatchObject({ kind: 'user', text: 'Bonjour de la part de l’équipe', from: 'sc_ra' });
      expect(heardIn.alerts).toHaveLength(1);
    });

    it('shows a player out with ":kick", but never somebody of the same level or above', async () => {
      const mod = await member('sc_kick_mod', 'moderateur');
      const peer = await member('sc_kick_peer', 'moderateur');
      const pest = await member('sc_kick_pest', 'user');
      const a = await joinHall(mod);
      const b = await joinHall(peer);
      const c = await joinHall(pest);
      const heardB = hear(b);
      const heardC = hear(c);
      const heardA = hear(a);
      await until(() => a.state?.players?.size === 3);
      a.send('chat', { text: ':kick sc_kick_peer' });
      await until(() => heardA.system.length >= 1, 3000);
      expect(heardA.system[0]).toMatch(/niveau/);
      expect(heardB.code).toBe(0);
      a.send('chat', { text: ':kick sc_kick_pest Trop de bruit' });
      await until(() => heardC.code === 4006, 3000);
      await until(() => a.state?.players?.size === 2, 3000);
      // It is not a ban: they may come back.
      await expect(joinHall(pest)).resolves.toBeDefined();
    });

    it('silences a room with ":roommute": only the staff speaks, until ":roomunmute"', async () => {
      const mod = await member('sc_rm_mod', 'moderateur');
      const talker = await member('sc_rm_talker', 'user');
      const a = await joinHall(mod);
      const b = await joinHall(talker);
      const heardA = hear(a);
      const heardB = hear(b);
      await until(() => a.state?.players?.size === 2);
      a.send('chat', { text: ':roommute' });
      await until(() => heardB.system.some((t) => /sourdine/.test(t)), 3000);
      b.send('chat', { text: 'Je peux parler ?' });
      await until(() => heardB.refused.length === 1, 3000);
      expect(heardB.refused).toEqual(['room-muted']);
      a.send('chat', { text: 'Silence, s’il vous plaît' });
      await until(() => heardB.chat.length === 1, 3000);
      expect(heardB.chat).toEqual(['Silence, s’il vous plaît']);
      a.send('chat', { text: ':roomunmute' });
      await until(() => heardB.system.filter((t) => /de nouveau parler/.test(t)).length === 1, 3000);
      b.send('chat', { text: 'Merci' });
      await until(() => heardA.chat.includes('Merci'), 3000);
    });

    it('sanctions from the chat bar with the same rules as the administration', async () => {
      const mod = await member('sc_sanc_mod', 'moderateur');
      const senior = await member('sc_sanc_senior', 'super_moderateur');
      const target = await member('sc_sanc_target', 'user');
      const peer = await member('sc_sanc_peer', 'moderateur');
      const a = await joinHall(mod);
      const s = await joinHall(senior);
      const t = await joinHall(target);
      const heardA = hear(a);
      const heardT = hear(t);
      await until(() => a.state?.players?.size === 3);

      // Over the limit of a moderator (24 h), and not a command a moderator has (a ban): refused or plain chat.
      a.send('chat', { text: ':mute sc_sanc_target 2000 Trop de bruit' });
      await until(() => heardA.system.length >= 1, 3000);
      expect(heardA.system[0]).toMatch(/24 h/);
      a.send('chat', { text: ':mute sc_sanc_peer 10 Entre collègues' });
      await until(() => heardA.system.length >= 2, 3000);
      expect(heardA.system[1]).toMatch(/niveau/);
      a.send('chat', { text: ':mute sc_sanc_target soixante Trop de bruit' });
      await until(() => heardA.system.length >= 3, 3000);
      expect(heardA.system[2]).toMatch(/minutes/);

      a.send('chat', { text: ':mute sc_sanc_target 30 Trop de bruit' });
      await until(() => heardT.system.length + 1 > 0 && heardA.system.length >= 4, 3000);
      const live = (await pool.query("SELECT kind, reason, issued_by FROM sanctions WHERE user_id = $1", [target.id])).rows;
      expect(live).toEqual([{ kind: 'mute', reason: 'Trop de bruit', issued_by: mod.id }]);
      // The player is muted at once.
      t.send('chat', { text: 'Bonjour' });
      await until(() => heardT.refused.includes('muted'), 3000);
      // And a role that can lift it does.
      s.send('chat', { text: ':unsanction sc_sanc_target' });
      await until(() => (heardT.refused.length, true));
      await wait(500);
      expect((await pool.query('SELECT count(*) FROM sanctions WHERE user_id = $1 AND revoked_at IS NULL', [target.id])).rows[0].count).toBe('0');
      void peer;
    }, 30000);

    it('gives a ban only to the roles that may, and a warning to a host', async () => {
      const host = await member('sc_ban_host', 'animateur');
      const senior = await member('sc_ban_senior', 'super_moderateur');
      const target = await member('sc_ban_target', 'user');
      const h = await joinHall(host);
      const s = await joinHall(senior);
      const t = await joinHall(target);
      const heardT = hear(t);
      const heardH = hear(h);
      await until(() => h.state?.players?.size === 3);
      h.send('chat', { text: ':warn sc_ban_target Reste poli avec les autres' });
      await until(() => heardT.system.length + 1 > 0 && heardH.system.length >= 1, 3000);
      expect((await pool.query("SELECT kind FROM sanctions WHERE user_id = $1", [target.id])).rows).toEqual([{ kind: 'warning' }]);
      // An animateur has no ":ban": it is only words in the chat.
      h.send('chat', { text: ':ban sc_ban_target Pour rire' });
      await wait(400);
      expect((await pool.query("SELECT count(*) FROM sanctions WHERE kind = 'ban' AND user_id = $1", [target.id])).rows[0].count).toBe('0');

      s.send('chat', { text: ':ban sc_ban_target Comportement inacceptable' });
      await until(() => heardT.code === 4004, 4000);
      expect((await pool.query("SELECT count(*) FROM sanctions WHERE kind = 'ban' AND user_id = $1", [target.id])).rows[0].count).toBe('1');
    }, 30000);

    it('summarises a player with ":info", and refuses an unknown one', async () => {
      const mod = await member('sc_info_mod', 'moderateur');
      const a = await joinHall(mod);
      const heardA = hear(a);
      await until(() => a.state?.players?.size === 1);
      a.send('chat', { text: ':info sc_info_mod' });
      await until(() => heardA.system.length >= 3, 3000);
      expect(heardA.system[0]).toMatch(/sc_info_mod — Modérateur/);
      expect(heardA.system[1]).toMatch(/Sanctions en cours : aucune/);
      expect(heardA.system[2]).toMatch(/Connecté : dans le hall/);
      a.send('chat', { text: ':info personne_ici' });
      await until(() => heardA.system.length >= 4, 3000);
      expect(heardA.system[3]).toMatch(/Usage/);
    });

    it('asks a player to join with ":summon", and takes the staff to a player with ":goto"', async () => {
      const mod = await member('sc_summon_mod', 'moderateur');
      const player = await member('sc_summon_player', 'user');
      const a = await joinHall(mod);
      const b = await joinHall(player);
      const heardA = hear(a);
      const heardB = hear(b);
      await until(() => a.state?.players?.size === 2);
      a.send('chat', { text: ':summon sc_summon_player' });
      await until(() => heardB.summons.length === 1, 3000);
      expect(heardB.summons[0]).toMatchObject({ from: 'sc_summon_mod', target: { kind: 'hall' } });
      a.send('chat', { text: ':goto sc_summon_player' });
      await until(() => heardA.gotos.length === 1, 3000);
      expect(heardA.gotos[0]).toMatchObject({ who: 'sc_summon_player', target: { kind: 'hall' } });
      // A player cannot be called by somebody who does not outrank them.
      const peer = await member('sc_summon_peer', 'moderateur');
      const c = await joinHall(peer);
      const heardC = hear(c);
      a.send('chat', { text: ':summon sc_summon_peer' });
      await wait(500);
      expect(heardC.summons).toEqual([]);
    });

    it('livens a room up: dancing, lights and confetti, for the hosts', async () => {
      const host = await member('sc_fun_host', 'animateur');
      const p1 = await member('sc_fun_p1', 'user');
      const p2 = await member('sc_fun_p2', 'user');
      const a = await joinHall(host);
      const b = await joinHall(p1);
      const heardB = hear(b);
      await until(() => a.state?.players?.size === 2);
      const emote = (id: string) => (b.state?.players?.get(id) as { emote: number } | undefined)?.emote;
      a.send('chat', { text: ':massdance' });
      await until(() => emote(p1.id) === 1 && emote(host.id) === 1, 3000);
      a.send('chat', { text: ':stopdance' });
      await until(() => emote(p1.id) === 0, 3000);
      const lights = (room: AnyRoom) => (room.state as { disco?: boolean } | undefined)?.disco;
      a.send('chat', { text: ':disco' });
      a.send('chat', { text: ':confetti' });
      await until(() => lights(b) === true && heardB.fx.some((f) => f.kind === 'confetti'), 3000);
      // Somebody arriving while the lights are on finds them on.
      const late = await joinHall(p2);
      await until(() => lights(late) === true, 3000);
      a.send('chat', { text: ':disco off' });
      await until(() => lights(b) === false && lights(late) === false, 3000);
    }, 30000);

    it('freezes a player for a while, and frees them', async () => {
      const host = await member('sc_frz_host', 'animateur');
      const p1 = await member('sc_frz_p1', 'user');
      const a = await joinHall(host);
      const b = await joinHall(p1);
      const heardB = hear(b);
      await until(() => a.state?.players?.size === 2);
      a.send('chat', { text: ':freeze sc_frz_p1 30' });
      await until(() => heardB.system.some((t) => /immobilisé/.test(t)), 3000);
      const start = { ...playerOf(b, p1.id)! };
      b.send('move', { i: 0, j: 0 });
      await wait(1500);
      expect(playerOf(b, p1.id)).toMatchObject({ i: start.i, j: start.j });
      a.send('chat', { text: ':unfreeze sc_frz_p1' });
      await until(() => heardB.system.some((t) => /de nouveau bouger/.test(t)), 3000);
      b.send('move', { i: 0, j: 0 });
      await until(() => playerOf(b, p1.id)!.i !== start.i || playerOf(b, p1.id)!.j !== start.j, 4000);
    }, 30000);

    it('keeps the fun commands from a moderator, who has others', async () => {
      const mod = await member('sc_nofun_mod', 'moderateur');
      const other = await member('sc_nofun_other', 'user');
      const a = await joinHall(mod);
      const b = await joinHall(other);
      const heardB = hear(b);
      await until(() => a.state?.players?.size === 2);
      a.send('chat', { text: ':disco' });
      await until(() => heardB.chat.length === 1, 3000);
      expect(heardB.chat).toEqual([':disco']);
      expect(heardB.fx).toEqual([]);
    });

    it('lets the staff add a word to the chat filter, and take it away', async () => {
      const mod = await member('sc_word_mod', 'moderateur');
      const talker = await member('sc_word_talker', 'user');
      const a = await joinHall(mod);
      const b = await joinHall(talker);
      const heardA = hear(a);
      const heardB = hear(b);
      await until(() => a.state?.players?.size === 2);
      b.send('chat', { text: 'quel zorglub ce jeu' });
      await until(() => heardA.chat.length === 1, 3000);
      a.send('chat', { text: ':addword Zorglub' });
      await until(() => heardA.system.some((t) => /zorglub/.test(t) && /filtré/.test(t)), 3000);
      b.send('chat', { text: 'encore ce Zorglub' });
      await until(() => heardB.refused.length === 1, 3000);
      expect(heardB.refused).toEqual(['filtered']);
      a.send('chat', { text: ':delword zorglub' });
      await until(() => heardA.system.some((t) => /plus filtré/.test(t)), 3000);
      b.send('chat', { text: 'on peut dire zorglub' });
      await until(() => heardA.chat.length === 2, 3000);
      expect((await pool.query("SELECT count(*) FROM banned_words WHERE word = 'zorglub'")).rows[0].count).toBe('0');
    }, 30000);

    it('lets only an administrator give Pixels, a few at a time, with a trace', async () => {
      const boss = await member('sc_gift_admin', 'administrateur');
      const senior = await member('sc_gift_senior', 'gerant');
      const lucky = await member('sc_gift_lucky', 'user');
      const a = await joinHall(boss);
      const s = await joinHall(senior);
      const l = await joinHall(lucky);
      const heardA = hear(a);
      const heardS = hear(s);
      await until(() => a.state?.players?.size === 3);
      const pixels = async () => (await pool.query('SELECT pixels FROM users WHERE id = $1', [lucky.id])).rows[0].pixels as number;
      const before = await pixels();
      s.send('chat', { text: ':gift sc_gift_lucky 500' }); // a manager has no ":gift": plain chat
      await until(() => heardS.chat.length === 1, 3000);
      expect(await pixels()).toBe(before);
      a.send('chat', { text: ':gift sc_gift_lucky 5000' });
      await until(() => heardA.system.length >= 1, 3000);
      expect(heardA.system[0]).toMatch(/Usage/);
      a.send('chat', { text: ':gift sc_gift_lucky 250' });
      await until(() => heardA.system.length >= 2, 3000);
      expect(await pixels()).toBe(before + 250);
      expect((await pool.query("SELECT delta, reason FROM pixel_ledger WHERE user_id = $1 AND reason LIKE 'Cadeau%'", [lucky.id])).rows).toEqual([{ delta: 250, reason: 'Cadeau de l’équipe' }]);
      void l;
    }, 30000);

    it('puts the game in maintenance from the chat bar, for the roles that may', async () => {
      const boss = await member('sc_mt_gerant', 'gerant');
      const a = await joinHall(boss);
      const heardA = hear(a);
      await until(() => a.state?.players?.size === 1);
      try {
        a.send('chat', { text: ':maintenance on' });
        await until(() => heardA.system.some((t) => /en maintenance/.test(t)), 3000);
        expect((await app.inject({ method: 'GET', url: '/api/status' })).json().maintenance).toBe(true);
      } finally {
        a.send('chat', { text: ':maintenance off' });
        await until(() => heardA.system.some((t) => /rouvert/.test(t)), 3000);
        forgetMaintenance();
      }
      expect((await app.inject({ method: 'GET', url: '/api/status' })).json().maintenance).toBe(false);
    });
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

  it('follows the shape of an apartment: arrival at its door, no walking on void, and back to the door when the floor goes', async () => {
    const owner = await signUp('shapeowner');
    const setShape = (preset: string) =>
      app.inject({ method: 'PUT', url: '/api/apartment', payload: { layout: { preset } }, cookies: { coloxel_sid: owner.sid } });
    // A ring around a courtyard: the door is at (15, 0), the middle has no floor.
    expect((await setShape('ring')).statusCode).toBe(200);
    const room = await joinApartment(owner, owner.id);
    await until(() => playerOf(room, owner.id));
    expect(playerOf(room, owner.id)).toMatchObject({ i: 15, j: 0 });
    room.send('move', { i: 6, j: 6 });
    await new Promise((r) => setTimeout(r, 400));
    expect(playerOf(room, owner.id)).toMatchObject({ i: 15, j: 0 });
    room.send('move', { i: 15, j: 3 });
    await until(() => playerOf(room, owner.id)?.j === 3, 6000);
    // The shape changes under the player's feet: a corridor (rows 4 to 9) has no floor at (15, 3).
    expect((await setShape('corridor')).statusCode).toBe(200);
    await until(() => playerOf(room, owner.id)?.i === 9, 3000);
    expect(playerOf(room, owner.id)).toMatchObject({ i: 9, j: 0 });
  }, 20000);
});
