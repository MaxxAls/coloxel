import type { FastifyInstance } from 'fastify';
import type pg from 'pg';
import { z } from 'zod';
import { FLOORS, WALLS, catalogueEntry } from '@coloxel/render';
import { layoutProblem, type RoomLayout } from '@coloxel/world';
import { apartmentAccessSql, canEnterApartment } from '../apartments/access';
import { layoutOfPreset, loadLayout, saveLayout } from '../apartments/layout';
import { listFriends } from '../friends/routes';
import { itemMaskedSql } from '../moderation/masking';
import { FILTER_MESSAGES, filterText } from '../moderation/text-filter';
import type { Locate } from '../realtime/where';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Who is where right now. Supplied by the realtime server. */
export interface Presence {
  /** Players inside each apartment, by owner id. */
  apartments: Map<string, number>;
  /** Players in the hall. */
  hall: number;
}
export type Occupancy = () => Promise<Presence>;

/**
 * Tell the apartment's room that something changed: who may enter ('access': visitors
 * who no longer may are sent out) or what the apartment looks like ('decor': visitors
 * reload it). Supplied by the realtime server; absent where there is none (some tests).
 */
export type NotifyApartment = (ownerId: string, kind: 'access' | 'decor' | 'rules') => void;
const nobody = (): Presence => ({ apartments: new Map(), hall: 0 });

/** Move a new player into the first free apartment. Run inside the sign-up transaction. */
export async function assignApartment(client: pg.PoolClient, userId: string): Promise<number | null> {
  // SKIP LOCKED: two simultaneous sign-ups never wait on, nor pick, the same apartment.
  const { rows } = await client.query<{ id: number }>(
    `UPDATE apartments SET owner_id = $1
      WHERE id = (SELECT id FROM apartments WHERE owner_id IS NULL ORDER BY id LIMIT 1 FOR UPDATE SKIP LOCKED)
      RETURNING id`,
    [userId],
  );
  return rows[0]?.id ?? null;
}

interface ApartmentRow {
  id: number;
  floor: number;
  slot: number;
  name: string | null;
  wall_style: string;
  floor_style: string;
  owner_id: string | null;
  nickname: string | null;
  open: boolean;
  bell: boolean | null;
}

interface PlacedRow {
  id: string;
  serial: number;
  name: string;
  description: string;
  edition_number: number;
  edition_size: number;
  creator: string;
  created_at: Date;
  i: number;
  j: number;
  rot: number;
}

export function registerBuildingRoutes(
  app: FastifyInstance,
  pool: pg.Pool,
  occupancy: Occupancy | undefined,
  notify?: NotifyApartment,
  locate?: Locate,
) {
  // The building seen from the side: every apartment, who lives there, whether
  // the requester may walk in, and how many players are inside right now.
  app.get('/api/building', async (req, reply) => {
    if (!req.user) return reply.code(401).send({ error: 'Non connecté' });
    const [{ rows }, present] = await Promise.all([
      pool.query<ApartmentRow>(
        `SELECT a.id, a.floor, a.slot, a.name, a.wall_style, a.floor_style, a.owner_id, host.nickname,
                COALESCE(${apartmentAccessSql('$1')}, false) AS open, host.apartment_access = 'bell' AS bell
           FROM apartments a
           LEFT JOIN users host ON host.id = a.owner_id
          ORDER BY a.floor DESC, a.slot`,
        [req.user.id],
      ),
      occupancy ? occupancy() : Promise.resolve(nobody()),
    ]);
    return {
      apartments: rows.map((r) => ({
        id: r.id,
        floor: r.floor,
        slot: r.slot,
        name: r.name,
        wall: r.wall_style,
        floorStyle: r.floor_style,
        owner: r.owner_id ? { id: r.owner_id, nickname: r.nickname } : null,
        mine: r.owner_id === req.user!.id,
        open: r.open,
        // Closed to this player for now, but they may ring.
        canRing: !r.open && r.bell === true,
        visitors: r.owner_id ? (present.apartments.get(r.owner_id) ?? 0) : 0,
      })),
    };
  });

  // What is placed in an apartment the requester may enter. Same answer for a
  // closed apartment and an unknown one.
  app.get<{ Params: { ownerId: string } }>('/api/apartments/:ownerId', async (req, reply) => {
    if (!req.user) return reply.code(401).send({ error: 'Non connecté' });
    const { ownerId } = req.params;
    if (!UUID.test(ownerId) || !(await canEnterApartment(pool, ownerId, req.user.id))) {
      return reply.code(404).send({ error: 'Appartement introuvable' });
    }
    const [owner, placed] = await Promise.all([
      pool.query<{ id: string; nickname: string; name: string | null; floor_style: string | null; wall_style: string | null }>(
        `SELECT u.id, u.nickname, a.name, a.floor_style, a.wall_style
           FROM users u LEFT JOIN apartments a ON a.owner_id = u.id WHERE u.id = $1`,
        [ownerId],
      ),
      pool.query<PlacedRow>(
        `SELECT it.id, it.serial, it.name, it.description, it.edition_number, it.edition_size,
                cr.nickname AS creator, it.created_at, p.i, p.j, p.rot
           FROM placements p
           JOIN items it ON it.id = p.item_id
           JOIN users cr ON cr.id = it.creator_id
          WHERE p.user_id = $1 AND (p.user_id = $2 OR NOT ${itemMaskedSql('it')})
          ORDER BY p.i, p.j`,
        [ownerId, req.user.id],
      ),
    ]);
    const layout = await loadLayout(pool, ownerId);
    const base = await pool.query<{ id: string; catalogue_key: string; i: number; j: number; rot: number; lit: boolean }>(
      `SELECT f.id, f.catalogue_key, p.i, p.j, p.rot, p.lit
         FROM placements p JOIN furniture f ON f.id = p.furniture_id
        WHERE p.user_id = $1 ORDER BY p.i, p.j`,
      [ownerId],
    );
    return {
      owner: { id: owner.rows[0]!.id, nickname: owner.rows[0]!.nickname },
      name: owner.rows[0]!.name,
      floor: owner.rows[0]!.floor_style ?? FLOORS[0]!.id,
      wall: owner.rows[0]!.wall_style ?? WALLS[0]!.id,
      layout,
      furniture: base.rows.map((r) => ({
        id: r.id,
        key: r.catalogue_key,
        name: catalogueEntry(r.catalogue_key)?.name ?? r.catalogue_key,
        placement: { i: r.i, j: r.j, rot: r.rot },
        on: r.lit,
      })),
      items: placed.rows.map((r) => ({
        id: r.id,
        serial: r.serial,
        name: r.name,
        description: r.description,
        editionNumber: r.edition_number,
        editionSize: r.edition_size,
        creator: r.creator,
        createdAt: r.created_at,
        placement: { i: r.i, j: r.j, rot: r.rot },
      })),
    };
  });

  // The player's own apartment: where it is, its name and who may come in.
  app.get('/api/apartment', async (req, reply) => {
    if (!req.user) return reply.code(401).send({ error: 'Non connecté' });
    return mineOf(pool, req.user.id);
  });

  const settingsSchema = z
    .object({
      name: z
        .string('Nom invalide')
        .transform((s) => s.replace(/\s+/g, ' ').trim())
        .pipe(z.string().max(30, 'Nom trop long (30 caractères max)'))
        .nullable()
        .optional(),
      access: z.enum(['closed', 'bell', 'friends', 'building'], 'Accès invalide').optional(),
      floor: z.string('Sol invalide').refine((id) => FLOORS.some((f) => f.id === id), 'Sol inconnu').optional(),
      wall: z.string('Papier peint invalide').refine((id) => WALLS.some((w) => w.id === id), 'Papier peint inconnu').optional(),
      // A ready-made shape by its key, or a shape drawn by the player (judged by the server either way).
      layout: z
        .union([
          z.object({ preset: z.string('Forme inconnue') }).strict(),
          z.object({ cells: z.string(), door: z.object({ i: z.number(), j: z.number() }).strict() }).strict(),
        ])
        .optional(),
    })
    .strict();

  // Only the owner, only their own apartment: the id comes from the session.
  app.put('/api/apartment', async (req, reply) => {
    if (!req.user) return reply.code(401).send({ error: 'Non connecté' });
    const parsed = settingsSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? 'Données invalides' });
    const { name, access, floor, wall, layout } = parsed.data;

    let newLayout: RoomLayout | undefined;
    if (layout) {
      const picked = 'preset' in layout ? layoutOfPreset(layout.preset) : layout;
      if (!picked) return reply.code(400).send({ error: 'Forme inconnue' });
      const problem = layoutProblem(picked);
      if (problem) return reply.code(400).send({ error: problem });
      newLayout = { cells: picked.cells, door: { i: picked.door.i, j: picked.door.j } };
    }

    let newName: string | null | undefined = undefined;
    if (name !== undefined) {
      newName = name === null || name === '' ? null : name;
      if (newName !== null) {
        const verdict = filterText(newName);
        if (!verdict.ok) return reply.code(400).send({ error: FILTER_MESSAGES[verdict.reason] });
      }
    }
    if (newName !== undefined) {
      await pool.query('UPDATE apartments SET name = $1 WHERE owner_id = $2', [newName, req.user.id]);
    }
    if (access !== undefined) {
      await pool.query('UPDATE users SET apartment_access = $1 WHERE id = $2', [access, req.user.id]);
    }
    let putAway = 0;
    if (newLayout) {
      const n = await saveLayout(pool, req.user.id, newLayout);
      if (n === null) return reply.code(404).send({ error: 'Pas d’appartement' });
      putAway = n;
    }
    if (floor !== undefined) await pool.query('UPDATE apartments SET floor_style = $1 WHERE owner_id = $2', [floor, req.user.id]);
    if (wall !== undefined) await pool.query('UPDATE apartments SET wall_style = $1 WHERE owner_id = $2', [wall, req.user.id]);
    // Visitors inside follow: out if the door just closed on them, a reload if the look changed.
    if (access !== undefined) notify?.(req.user.id, 'access');
    if (newName !== undefined || floor !== undefined || wall !== undefined || newLayout) notify?.(req.user.id, 'decor');
    return { ...(await mineOf(pool, req.user.id)), putAway };
  });

  // Where to go: the hall, the apartments open to everyone (busiest first) and
  // where the friends are, when they are somewhere the player may follow them.
  app.get('/api/navigator', async (req, reply) => {
    if (!req.user) return reply.code(401).send({ error: 'Non connecté' });
    const [{ rows }, present, friends] = await Promise.all([
      pool.query<{ id: number; name: string | null; owner_id: string; nickname: string }>(
        `SELECT a.id, a.name, a.owner_id, host.nickname
           FROM apartments a JOIN users host ON host.id = a.owner_id
          WHERE host.apartment_access = 'building'`,
      ),
      occupancy ? occupancy() : Promise.resolve(nobody()),
      listFriends(pool, req.user.id, locate),
    ]);
    const open = rows
      .map((r) => ({
        apartmentId: r.id,
        ownerId: r.owner_id,
        nickname: r.nickname,
        name: r.name,
        mine: r.owner_id === req.user!.id,
        visitors: present.apartments.get(r.owner_id) ?? 0,
      }))
      .sort((a, b) => b.visitors - a.visitors || (a.name ?? a.nickname).localeCompare(b.name ?? b.nickname, 'fr'))
      .slice(0, 50);
    return {
      places: [{ kind: 'hall', name: 'Le hall', visitors: present.hall }],
      open,
      friends: friends
        .filter((f) => f.online && f.target)
        .map((f) => ({ id: f.id, nickname: f.nickname, where: f.where!, target: f.target! })),
    };
  });
}

async function mineOf(pool: pg.Pool, userId: string) {
  const { rows } = await pool.query<{
    id: number;
    floor: number;
    slot: number;
    name: string | null;
    access: string;
    floor_style: string;
    wall_style: string;
  }>(
    `SELECT a.id, a.floor, a.slot, a.name, a.floor_style, a.wall_style, u.apartment_access AS access
       FROM users u LEFT JOIN apartments a ON a.owner_id = u.id WHERE u.id = $1`,
    [userId],
  );
  const r = rows[0]!;
  return {
    id: r.id,
    floor: r.floor,
    slot: r.slot,
    name: r.name,
    access: r.access,
    floorStyle: r.floor_style,
    wallStyle: r.wall_style,
    layout: await loadLayout(pool, userId),
  };
}
