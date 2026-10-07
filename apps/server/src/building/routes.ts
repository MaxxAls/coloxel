import type { FastifyInstance } from 'fastify';
import type pg from 'pg';
import { apartmentAccessSql, canEnterApartment } from '../apartments/access';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Players currently inside each apartment, by owner id. Supplied by the realtime server. */
export type Occupancy = () => Promise<Map<string, number>>;

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
  owner_id: string | null;
  nickname: string | null;
  open: boolean;
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
}

export function registerBuildingRoutes(app: FastifyInstance, pool: pg.Pool, occupancy: Occupancy | undefined) {
  // The building seen from the side: every apartment, who lives there, whether
  // the requester may walk in, and how many players are inside right now.
  app.get('/api/building', async (req, reply) => {
    if (!req.user) return reply.code(401).send({ error: 'Non connecté' });
    const [{ rows }, present] = await Promise.all([
      pool.query<ApartmentRow>(
        `SELECT a.id, a.floor, a.slot, a.owner_id, host.nickname,
                COALESCE(${apartmentAccessSql('$1')}, false) AS open
           FROM apartments a
           LEFT JOIN users host ON host.id = a.owner_id
          ORDER BY a.floor DESC, a.slot`,
        [req.user.id],
      ),
      occupancy ? occupancy() : Promise.resolve(new Map<string, number>()),
    ]);
    return {
      apartments: rows.map((r) => ({
        id: r.id,
        floor: r.floor,
        slot: r.slot,
        owner: r.owner_id ? { id: r.owner_id, nickname: r.nickname } : null,
        mine: r.owner_id === req.user!.id,
        open: r.open,
        visitors: r.owner_id ? (present.get(r.owner_id) ?? 0) : 0,
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
      pool.query<{ id: string; nickname: string }>('SELECT id, nickname FROM users WHERE id = $1', [ownerId]),
      pool.query<PlacedRow>(
        `SELECT it.id, it.serial, it.name, it.description, it.edition_number, it.edition_size,
                cr.nickname AS creator, it.created_at, p.i, p.j
           FROM placements p
           JOIN items it ON it.id = p.item_id
           JOIN users cr ON cr.id = it.creator_id
          WHERE p.user_id = $1
          ORDER BY p.i, p.j`,
        [ownerId],
      ),
    ]);
    return {
      owner: owner.rows[0],
      items: placed.rows.map((r) => ({
        id: r.id,
        serial: r.serial,
        name: r.name,
        description: r.description,
        editionNumber: r.edition_number,
        editionSize: r.edition_size,
        creator: r.creator,
        createdAt: r.created_at,
        placement: { i: r.i, j: r.j },
      })),
    };
  });
}
