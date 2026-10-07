import type { FastifyInstance } from 'fastify';
import type pg from 'pg';
import { z } from 'zod';
import { requireStaff } from '../site/settings';
import { ROLES, STAFF_ROLES, assignableRoles, isRole, levelOf, outranks } from './roles';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const roleSchema = z.object({ role: z.string('Rôle invalide') }).strict();

const eventSchema = z
  .object({
    title: z.string('Titre invalide').transform((s) => s.replace(/\s+/g, ' ').trim()).pipe(z.string().min(1, 'Le titre est obligatoire').max(80, 'Titre trop long (80 caractères max)')),
    description: z.string('Description invalide').transform((s) => s.trim()).pipe(z.string().min(1, 'La description est obligatoire').max(1000, 'Description trop longue (1000 caractères max)')),
    startsAt: z.string('Date invalide').refine((s) => !Number.isNaN(Date.parse(s)), 'Date invalide'),
    place: z.string('Lieu invalide').transform((s) => s.replace(/\s+/g, ' ').trim()).pipe(z.string().min(1, 'Le lieu est obligatoire').max(60, 'Lieu trop long (60 caractères max)')),
  })
  .strict();
const statusSchema = z.object({ status: z.enum(['done', 'cancelled'], 'Statut invalide') }).strict();

/** At most this many events waiting to take place. */
export const MAX_PLANNED_EVENTS = 30;

export interface EventRow {
  id: number;
  title: string;
  description: string;
  startsAt: Date;
  place: string;
  host: string;
  hostId: string;
  status: 'planned' | 'done' | 'cancelled';
}

interface RawEvent {
  id: string;
  title: string;
  description: string;
  starts_at: Date;
  place: string;
  host: string;
  host_id: string;
  status: EventRow['status'];
}

const toEvent = (r: RawEvent): EventRow => ({
  id: Number(r.id),
  title: r.title,
  description: r.description,
  startsAt: r.starts_at,
  place: r.place,
  host: r.host,
  hostId: r.host_id,
  status: r.status,
});

/** The events still to come (or just under way), soonest first: shown to everybody. */
export async function upcomingEvents(pool: pg.Pool, limit = 10): Promise<EventRow[]> {
  const { rows } = await pool.query<RawEvent>(
    `SELECT e.id, e.title, e.description, e.starts_at, e.place, u.nickname AS host, e.host_id, e.status
       FROM events e JOIN users u ON u.id = e.host_id
      WHERE e.status = 'planned' AND e.starts_at > now() - interval '3 hours'
      ORDER BY e.starts_at LIMIT $1`,
    [limit],
  );
  return rows.map(toEvent);
}

/** The hosts, ranked by the events they held: the animateurs' own hall of fame. */
export async function hostRanking(pool: pg.Pool, limit = 10): Promise<{ nickname: string; events: number }[]> {
  const { rows } = await pool.query<{ nickname: string; n: string }>(
    `SELECT u.nickname, count(*) AS n FROM events e JOIN users u ON u.id = e.host_id
      WHERE e.status = 'done' GROUP BY u.id, u.nickname ORDER BY count(*) DESC, lower(u.nickname) LIMIT $1`,
    [limit],
  );
  return rows.map((r) => ({ nickname: r.nickname, events: Number(r.n) }));
}

/** The team itself: who has which role, who changes it, and the events of the hosts. */
export function registerTeamRoutes(app: FastifyInstance, pool: pg.Pool) {
  // What each role is and may do (read by every staff member, who sees what they could become).
  app.get('/api/staff/roles', async (req, reply) => {
    const staff = await requireStaff(pool, req, reply);
    if (!staff) return;
    return {
      roles: STAFF_ROLES.map((r) => ({
        id: r.id,
        title: r.title,
        summary: r.summary,
        level: r.level,
        permissions: r.permissions,
        maxMuteMinutes: r.maxMuteMinutes ?? null,
        maxSuspensionMinutes: r.maxSuspensionMinutes ?? null,
      })),
      mine: staff.role,
      assignable: assignableRoles(staff.role).map((r) => r.id),
    };
  });

  app.get('/api/staff/team', async (req, reply) => {
    if (!(await requireStaff(pool, req, reply, 'roles.view'))) return;
    const [members, history] = await Promise.all([
      pool.query<{ id: string; nickname: string; role: string; since: Date | null; events: string }>(
        `SELECT u.id, u.nickname, u.role,
                (SELECT max(l.created_at) FROM role_log l WHERE l.user_id = u.id AND l.to_role = u.role) AS since,
                (SELECT count(*) FROM events e WHERE e.host_id = u.id AND e.status = 'done') AS events
           FROM users u WHERE u.role <> 'user'
          ORDER BY CASE u.role WHEN 'administrateur' THEN 5 WHEN 'gerant' THEN 4 WHEN 'super_moderateur' THEN 3 WHEN 'moderateur' THEN 2 ELSE 1 END DESC, lower(u.nickname)`,
      ),
      pool.query<{ nickname: string; from_role: string; to_role: string; by: string | null; created_at: Date }>(
        `SELECT u.nickname, l.from_role, l.to_role, b.nickname AS by, l.created_at
           FROM role_log l JOIN users u ON u.id = l.user_id LEFT JOIN users b ON b.id = l.changed_by
          ORDER BY l.id DESC LIMIT 30`,
      ),
    ]);
    const title = (r: string) => (isRole(r) ? ROLES[r].title : r);
    return {
      members: members.rows.map((m) => ({ id: m.id, nickname: m.nickname, role: m.role, title: title(m.role), since: m.since, eventsHeld: Number(m.events) })),
      history: history.rows.map((h) => ({ nickname: h.nickname, from: title(h.from_role), to: title(h.to_role), by: h.by, at: h.created_at })),
    };
  });

  // Give a role, or take it away (role "user"). Only strictly below one's own role, only on somebody one outranks: a manager
  // names moderators, an administrator names managers, and nobody names an equal. Journaled; it counts at once.
  app.put<{ Params: { id: string } }>('/api/staff/players/:id/role', async (req, reply) => {
    const staff = await requireStaff(pool, req, reply, 'roles.manage');
    if (!staff) return;
    if (!UUID.test(req.params.id)) return reply.code(404).send({ error: 'Joueur introuvable' });
    const parsed = roleSchema.safeParse(req.body);
    if (!parsed.success || !isRole(parsed.data.role)) return reply.code(400).send({ error: 'Rôle invalide' });
    const to = parsed.data.role;
    if (req.params.id.toLowerCase() === staff.id) return reply.code(400).send({ error: 'Tu ne peux pas changer ton propre rôle.' });
    if (!assignableRoles(staff.role).some((r) => r.id === to)) {
      return reply.code(403).send({ error: `Ton rôle (${ROLES[staff.role].title}) ne peut pas donner le rôle « ${ROLES[to].title} ».` });
    }
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const target = await client.query<{ role: string }>('SELECT role FROM users WHERE id = $1 FOR UPDATE', [req.params.id.toLowerCase()]);
      const from = target.rows[0]?.role;
      if (!from) {
        await client.query('ROLLBACK');
        return reply.code(404).send({ error: 'Joueur introuvable' });
      }
      if (!outranks(staff.role, from)) {
        await client.query('ROLLBACK');
        return reply.code(403).send({ error: 'Tu ne peux pas changer le rôle de quelqu’un de ton niveau ou au-dessus.' });
      }
      if (from !== to) {
        await client.query('UPDATE users SET role = $2 WHERE id = $1', [req.params.id.toLowerCase(), to]);
        await client.query('INSERT INTO role_log (user_id, from_role, to_role, changed_by) VALUES ($1, $2, $3, $4)', [req.params.id.toLowerCase(), from, to, staff.id]);
      }
      await client.query('COMMIT');
      return { role: to, title: ROLES[to].title, level: levelOf(to) };
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  });

  // What the staff typed as commands in the rooms, newest first: the managers' view of who did what.
  app.get<{ Querystring: { staff?: string; before?: string } }>('/api/staff/log', async (req, reply) => {
    if (!(await requireStaff(pool, req, reply, 'staff.log'))) return;
    const { staff, before } = req.query;
    if (before !== undefined && !/^\d{1,15}$/.test(before)) return reply.code(400).send({ error: 'Page invalide' });
    const { rows } = await pool.query<{ id: string; nickname: string; command: string; args: string; room: string | null; created_at: Date }>(
      `SELECT l.id, u.nickname, l.command, l.args, l.room, l.created_at
         FROM staff_log l JOIN users u ON u.id = l.staff_id
        WHERE ($1::text IS NULL OR lower(u.nickname) = lower($1)) AND ($2::bigint IS NULL OR l.id < $2)
        ORDER BY l.id DESC LIMIT 100`,
      [staff || null, before ?? null],
    );
    return {
      entries: rows.map((r) => ({ id: Number(r.id), staff: r.nickname, command: r.command, args: r.args, room: r.room, at: r.created_at })),
      next: rows.length === 100 ? Number(rows[rows.length - 1]!.id) : null,
    };
  });

  // ----- Events ------------------------------------------------------------------
  // Everybody may read what is coming up: the website and the game show it.
  app.get('/api/events', async () => ({ events: await upcomingEvents(pool) }));

  app.get('/api/staff/events', async (req, reply) => {
    if (!(await requireStaff(pool, req, reply, 'events.manage'))) return;
    const { rows } = await pool.query<RawEvent>(
      `SELECT e.id, e.title, e.description, e.starts_at, e.place, u.nickname AS host, e.host_id, e.status
         FROM events e JOIN users u ON u.id = e.host_id
        ORDER BY (e.status = 'planned') DESC, CASE WHEN e.status = 'planned' THEN e.starts_at END, e.starts_at DESC LIMIT 60`,
    );
    return { events: rows.map(toEvent), ranking: await hostRanking(pool) };
  });

  app.post('/api/staff/events', async (req, reply) => {
    const staff = await requireStaff(pool, req, reply, 'events.manage');
    if (!staff) return;
    const parsed = eventSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? 'Événement invalide' });
    const { title, description, startsAt, place } = parsed.data;
    if (Date.parse(startsAt) < Date.now() - 60 * 60_000) return reply.code(400).send({ error: 'Cet événement serait déjà passé.' });
    const planned = await pool.query<{ n: string }>("SELECT count(*) AS n FROM events WHERE status = 'planned'");
    if (Number(planned.rows[0]!.n) >= MAX_PLANNED_EVENTS) return reply.code(400).send({ error: `Il y a déjà ${MAX_PLANNED_EVENTS} événements prévus.` });
    const { rows } = await pool.query<{ id: string }>(
      'INSERT INTO events (title, description, starts_at, place, host_id) VALUES ($1, $2, $3, $4, $5) RETURNING id',
      [title, description, new Date(startsAt), place, staff.id],
    );
    return reply.code(201).send({ id: Number(rows[0]!.id) });
  });

  // An event is held or cancelled by its host, or by the managers above.
  app.put<{ Params: { id: string } }>('/api/staff/events/:id', async (req, reply) => {
    const staff = await requireStaff(pool, req, reply, 'events.manage');
    if (!staff) return;
    if (!/^\d{1,15}$/.test(req.params.id)) return reply.code(404).send({ error: 'Événement introuvable' });
    const parsed = statusSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? 'Statut invalide' });
    const found = await pool.query<{ host_id: string; status: string }>('SELECT host_id, status FROM events WHERE id = $1', [req.params.id]);
    const event = found.rows[0];
    if (!event) return reply.code(404).send({ error: 'Événement introuvable' });
    if (event.status !== 'planned') return reply.code(409).send({ error: 'Cet événement est déjà clos.' });
    if (event.host_id !== staff.id && levelOf(staff.role) < ROLES.gerant.level) {
      return reply.code(403).send({ error: 'Seul l’animateur de cet événement, ou un gérant, peut le clore.' });
    }
    await pool.query("UPDATE events SET status = $2 WHERE id = $1 AND status = 'planned'", [req.params.id, parsed.data.status]);
    return { ok: true };
  });
}
