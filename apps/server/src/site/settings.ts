import type { FastifyReply, FastifyRequest } from 'fastify';
import type pg from 'pg';
import { ROLES, can, loadStaff, type Permission, type StaffMember } from '../staff/roles';

const CACHE_MS = 3000;
let cached: { at: number; on: boolean } | null = null;

/** Is the game in maintenance? Read from the database, remembered for a few seconds: it is asked on every request. */
export async function isMaintenance(pool: pg.Pool): Promise<boolean> {
  const now = Date.now();
  if (cached && now - cached.at < CACHE_MS) return cached.on;
  const { rows } = await pool.query<{ value: unknown }>("SELECT value FROM site_settings WHERE key = 'maintenance'");
  cached = { at: now, on: rows[0]?.value === true };
  return cached.on;
}

export async function setMaintenance(pool: pg.Pool, on: boolean, staffId: string): Promise<void> {
  await pool.query(
    `INSERT INTO site_settings (key, value, updated_by) VALUES ('maintenance', $1::jsonb, $2)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = now()`,
    [JSON.stringify(on), staffId],
  );
  cached = { at: Date.now(), on };
}

/** Forget what was remembered (tests switch the setting behind the server's back). */
export function forgetMaintenance() {
  cached = null;
}

/** Does this player belong to the staff, whatever their role? */
export async function isStaff(pool: pg.Pool, userId: string): Promise<boolean> {
  return (await loadStaff(pool, userId)) !== null;
}

/** May this player keep playing while the game is in maintenance? Only the roles that run the game. */
export async function bypassesMaintenance(pool: pg.Pool, userId: string): Promise<boolean> {
  const staff = await loadStaff(pool, userId);
  return !!staff && can(staff.role, 'maintenance.bypass');
}

/**
 * The signed-in staff member who holds `permission`, or null after answering: 401 when nobody is signed in, 404 for a
 * player who is not staff (an unknown page gets the same answer), 403 for a staff member whose role does not allow it.
 * The role is read from the database at every request: a change of role counts at once.
 */
export async function requireStaff(
  pool: pg.Pool,
  req: FastifyRequest,
  reply: FastifyReply,
  permission: Permission = 'admin.access',
): Promise<StaffMember | null> {
  if (!req.user) {
    void reply.code(401).send({ error: 'Non connecté' });
    return null;
  }
  const staff = await loadStaff(pool, req.user.id);
  if (!staff) {
    void reply.code(404).send({ error: 'Introuvable' });
    return null;
  }
  if (!can(staff.role, permission)) {
    void reply.code(403).send({ error: `Ton rôle (${ROLES[staff.role].title}) ne te permet pas cela.` });
    return null;
  }
  return staff;
}

/** What players get while the game is in maintenance. */
export const MAINTENANCE_MESSAGE = 'Coloxel est en maintenance, reviens dans quelques instants !';

/**
 * During maintenance only staff accounts can use the API (so that they can switch it off again).
 * Signing in, the status and the website itself stay reachable.
 */
export function registerMaintenance(app: import('fastify').FastifyInstance, pool: pg.Pool) {
  app.addHook('onRequest', async (req, reply) => {
    const path = req.url.split('?')[0]!;
    if (!path.startsWith('/api/') || path === '/api/status' || path.startsWith('/api/auth/') || path.startsWith('/api/staff/')) return;
    if (!(await isMaintenance(pool))) return;
    if (req.user && (await bypassesMaintenance(pool, req.user.id))) return;
    return reply.code(503).send({ error: MAINTENANCE_MESSAGE, maintenance: true });
  });
}
