import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type pg from 'pg';
import { z } from 'zod';
import type { NotifyApartment } from '../building/routes';
import { withTransaction } from '../db/pool';
import { itemMaskedSql } from '../moderation/masking';
import {
  MAX_SANCTION_MINUTES,
  SANCTION_KINDS,
  liveSql,
  sanctionText,
  type NotifyUser,
  type SanctionKind,
} from '../moderation/sanctions';
import { REPORT_KINDS } from '../reports/routes';
import { ROLES, assignableRoles, can, outranks, sanctionRefusal, type Permission, type StaffMember } from './roles';
import { isMaintenance, requireStaff } from '../site/settings';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const sanctionSchema = z
  .object({
    kind: z.enum(SANCTION_KINDS, 'Sanction inconnue'),
    minutes: z.number('Durée invalide').int('Durée invalide').min(1, 'Durée invalide').max(MAX_SANCTION_MINUTES, 'Durée trop longue (un an au maximum)').optional(),
    reason: z
      .string('Motif invalide')
      .transform((s) => s.replace(/\s+/g, ' ').trim())
      .pipe(z.string().min(3, 'Le motif est obligatoire (3 caractères au moins)').max(300, 'Motif trop long (300 caractères max)')),
  })
  .strict()
  .superRefine((s, ctx) => {
    const timed = s.kind === 'mute' || s.kind === 'suspension';
    if (timed && s.minutes === undefined) ctx.addIssue({ code: 'custom', message: 'Une durée est obligatoire pour cette sanction' });
    if (!timed && s.minutes !== undefined) ctx.addIssue({ code: 'custom', message: 'Cette sanction n’a pas de durée' });
  });
type SanctionInput = z.infer<typeof sanctionSchema>;

const resolveSchema = z
  .object({
    kind: z.enum(REPORT_KINDS),
    targetKey: z.string().min(1).max(64),
    decision: z.enum(['dismiss', 'confirm']),
    note: z.string().transform((s) => s.trim()).pipe(z.string().max(300)).optional(),
    sanction: sanctionSchema.optional(),
  })
  .strict();

const moderationSchema = z.object({ state: z.enum(['hidden', 'cleared', 'none']) }).strict();

interface Issued {
  id: number;
  userId: string;
  kind: SanctionKind;
  text: string;
}

/** The staff panel: reports to review, the chat journal, player sheets, sanctions. Every route checks the role in the database. */
export function registerStaffRoutes(app: FastifyInstance, pool: pg.Pool, notifyUser?: NotifyUser, notifyApartment?: NotifyApartment) {
  /** The signed-in staff member holding this permission (every staff role holds `admin.access`), or null after answering. */
  const staffOnly = (req: FastifyRequest, reply: FastifyReply, permission: Permission = 'admin.access') => requireStaff(pool, req, reply, permission);

  /** Writes the sanction, inside the caller's transaction. Returns what to announce once it is committed. */
  async function issue(client: pg.PoolClient, staff: StaffMember, userId: string, input: SanctionInput, reportId?: number): Promise<Issued | { error: string }> {
    const target = await client.query<{ role: string }>('SELECT role FROM users WHERE id = $1', [userId]);
    if (!target.rows[0]) return { error: 'Joueur introuvable' };
    if (userId === staff.id) return { error: 'Tu ne peux pas te sanctionner toi-même.' };
    // Only from above: nobody sanctions somebody of their own level or higher.
    if (!outranks(staff.role, target.rows[0].role)) return { error: 'Tu ne peux pas sanctionner quelqu’un de ton niveau ou au-dessus.' };
    const refusal = sanctionRefusal(staff.role, input.kind, input.minutes);
    if (refusal) return { error: refusal };
    const expiresAt = input.minutes === undefined ? null : new Date(Date.now() + input.minutes * 60_000);
    const { rows } = await client.query<{ id: string }>(
      `INSERT INTO sanctions (user_id, kind, reason, issued_by, report_id, expires_at) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [userId, input.kind, input.reason, staff.id, reportId ?? null, expiresAt],
    );
    return { id: Number(rows[0]!.id), userId, kind: input.kind, text: sanctionText(input.kind, input.reason, expiresAt) };
  }
  // Once committed: a connected player is told or shown out within the second.
  const announce = (issued: Issued) =>
    notifyUser?.({ userId: issued.userId, kind: issued.kind, id: issued.kind === 'warning' ? issued.id : undefined, text: issued.text });

  // Who the signed-in staff member is and what they may do: the administration shows only what their role allows.
  app.get('/api/staff/me', async (req, reply) => {
    const staff = await staffOnly(req, reply);
    if (!staff) return;
    const def = ROLES[staff.role];
    return {
      staff: true,
      role: def.id,
      title: def.title,
      level: def.level,
      permissions: def.permissions,
      maxMuteMinutes: def.maxMuteMinutes ?? null,
      maxSuspensionMinutes: def.maxSuspensionMinutes ?? null,
      assignable: assignableRoles(staff.role).map((r) => r.id),
    };
  });

  // ----- Dashboard -----------------------------------------------------------
  // The numbers an administrator looks at first: how the game is doing, and what waits for the staff.
  app.get('/api/staff/dashboard', async (req, reply) => {
    if (!(await staffOnly(req, reply, 'dashboard.view'))) return;
    const n = (r: pg.QueryResult<{ n: string }>) => Number(r.rows[0]!.n);
    const [players, today, creations, reportsOpen, sanctions, messages, blocked, perDay, news, maintenance] = await Promise.all([
      pool.query<{ n: string }>('SELECT count(*) AS n FROM users'),
      pool.query<{ n: string }>("SELECT count(*) AS n FROM users WHERE created_at >= date_trunc('day', now())"),
      pool.query<{ n: string }>('SELECT count(*) AS n FROM items'),
      pool.query<{ n: string }>("SELECT count(DISTINCT (kind, target_key)) AS n FROM reports WHERE status = 'open'"),
      pool.query<{ n: string }>(`SELECT count(*) AS n FROM sanctions s WHERE s.kind <> 'warning' AND ${liveSql('s')}`),
      pool.query<{ n: string }>("SELECT count(*) AS n FROM chat_log WHERE created_at > now() - interval '24 hours'"),
      pool.query<{ n: string }>("SELECT count(*) AS n FROM chat_log WHERE blocked AND created_at > now() - interval '24 hours'"),
      pool.query<{ day: string; n: string }>(
        `SELECT to_char(d::date, 'YYYY-MM-DD') AS day, count(u.id) AS n
           FROM generate_series(current_date - 6, current_date, interval '1 day') d
           LEFT JOIN users u ON u.created_at >= d AND u.created_at < d + interval '1 day'
          GROUP BY d ORDER BY d`,
      ),
      pool.query<{ n: string }>('SELECT count(*) AS n FROM announcements WHERE published'),
      isMaintenance(pool),
    ]);
    return {
      players: n(players),
      newToday: n(today),
      creations: n(creations),
      reportsOpen: n(reportsOpen),
      sanctionsLive: n(sanctions),
      messages24h: n(messages),
      blocked24h: n(blocked),
      signups: perDay.rows.map((r) => ({ day: r.day, count: Number(r.n) })),
      announcements: n(news),
      maintenance,
    };
  });

  // ----- Reports -------------------------------------------------------------
  interface ReportRow {
    id: string;
    kind: string;
    target_key: string;
    target_user_id: string | null;
    target_nickname: string | null;
    reporter: string;
    reason: string;
    details: string | null;
    snapshot: string;
    context: string | null;
    created_at: Date;
  }

  app.get<{ Querystring: { status?: string } }>('/api/staff/reports', async (req, reply) => {
    if (!(await staffOnly(req, reply, 'reports.view'))) return;

    if (req.query.status === 'handled') {
      const { rows } = await pool.query(
        `SELECT r.id, r.kind, r.reason, r.snapshot, r.status, r.note, r.handled_at, h.nickname AS handler,
                rp.nickname AS reporter, tu.nickname AS target
           FROM reports r
           JOIN users rp ON rp.id = r.reporter_id
           LEFT JOIN users tu ON tu.id = r.target_user_id
           LEFT JOIN users h ON h.id = r.handled_by
          WHERE r.status <> 'open' ORDER BY r.handled_at DESC, r.id DESC LIMIT 100`,
      );
      return { handled: rows.map((r) => ({ id: Number(r.id), kind: r.kind, reason: r.reason, snapshot: r.snapshot, status: r.status, note: r.note, handledAt: r.handled_at, handler: r.handler, reporter: r.reporter, target: r.target })) };
    }

    const { rows } = await pool.query<ReportRow>(
      `SELECT r.id, r.kind, r.target_key, r.target_user_id, tu.nickname AS target_nickname, rp.nickname AS reporter,
              r.reason, r.details, r.snapshot, r.context, r.created_at
         FROM reports r
         JOIN users rp ON rp.id = r.reporter_id
         LEFT JOIN users tu ON tu.id = r.target_user_id
        WHERE r.status = 'open' ORDER BY r.created_at LIMIT 1000`,
    );
    // One line per thing reported, however many players reported it.
    interface Group {
      kind: string;
      targetKey: string;
      targetUser: { id: string; nickname: string } | null;
      snapshot: string;
      count: number;
      firstAt: Date;
      lastAt: Date;
      reasons: Record<string, number>;
      reports: { id: number; reporter: string; reason: string; details: string | null; context: string | null; at: Date }[];
      itemState: 'hidden' | 'cleared' | null;
      masked: boolean;
    }
    const groups = new Map<string, Group>();
    for (const r of rows) {
      const key = `${r.kind}:${r.target_key}`;
      let g = groups.get(key);
      if (!g) {
        g = {
          kind: r.kind,
          targetKey: r.target_key,
          targetUser: r.target_user_id ? { id: r.target_user_id, nickname: r.target_nickname ?? '?' } : null,
          snapshot: r.snapshot,
          count: 0,
          firstAt: r.created_at,
          lastAt: r.created_at,
          reasons: {},
          reports: [],
          itemState: null,
          masked: false,
        };
        groups.set(key, g);
      }
      g.count++;
      g.lastAt = r.created_at;
      g.reasons[r.reason] = (g.reasons[r.reason] ?? 0) + 1;
      g.reports.push({ id: Number(r.id), reporter: r.reporter, reason: r.reason, details: r.details, context: r.context, at: r.created_at });
    }
    const itemIds = [...groups.values()].filter((g) => g.kind === 'item').map((g) => g.targetKey);
    if (itemIds.length) {
      const items = await pool.query<{ id: string; masked: boolean; state: 'hidden' | 'cleared' | null }>(
        `SELECT it.id, ${itemMaskedSql('it')} AS masked, im.state
           FROM items it LEFT JOIN item_moderation im ON im.item_id = it.id WHERE it.id = ANY($1::uuid[])`,
        [itemIds],
      );
      for (const it of items.rows) {
        const g = groups.get(`item:${it.id}`);
        if (g) {
          g.masked = it.masked;
          g.itemState = it.state;
        }
      }
    }
    return { groups: [...groups.values()].sort((a, b) => b.count - a.count || a.firstAt.getTime() - b.firstAt.getTime()) };
  });

  // Decide about everything reported about one thing at once. A confirmed report on a creation hides it for good,
  // a dismissed one clears it for good; a sanction can be given in the same move.
  app.post('/api/staff/reports/resolve', async (req, reply) => {
    const staff = await staffOnly(req, reply, 'reports.resolve');
    if (!staff) return;
    const parsed = resolveSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? 'Requête invalide' });
    const { kind, targetKey, decision, note, sanction } = parsed.data;

    type Outcome = { error: string; status: 400 | 404 } | { resolved: number; issued: Issued | null; ownerId: string | null };
    const outcome = await withTransaction<Outcome>(pool, async (client) => {
      const open = await client.query<{ id: string; target_user_id: string | null }>(
        `SELECT id, target_user_id FROM reports WHERE kind = $1 AND target_key = $2 AND status = 'open' ORDER BY id FOR UPDATE`,
        [kind, targetKey],
      );
      if (!open.rowCount) return { error: 'Plus de signalement en attente pour ceci.', status: 404 };
      await client.query(
        `UPDATE reports SET status = $1, handled_by = $2, handled_at = now(), note = $3
          WHERE kind = $4 AND target_key = $5 AND status = 'open'`,
        [decision === 'confirm' ? 'confirmed' : 'dismissed', staff.id, note || null, kind, targetKey],
      );
      let ownerId: string | null = null;
      if (kind === 'item' && UUID.test(targetKey)) {
        const item = await client.query<{ owner_id: string }>('SELECT owner_id FROM items WHERE id = $1', [targetKey]);
        if (item.rows[0]) {
          ownerId = item.rows[0].owner_id;
          await client.query(
            `INSERT INTO item_moderation (item_id, state, decided_by) VALUES ($1, $2, $3)
             ON CONFLICT (item_id) DO UPDATE SET state = EXCLUDED.state, decided_by = EXCLUDED.decided_by, decided_at = now()`,
            [targetKey, decision === 'confirm' ? 'hidden' : 'cleared', staff.id],
          );
        }
      }
      let issued: Issued | null = null;
      if (sanction) {
        const who = open.rows[0]!.target_user_id;
        if (!who) return { error: 'Ce signalement ne vise aucun joueur.', status: 400 };
        const result = await issue(client, staff, who, sanction, Number(open.rows[0]!.id));
        if ('error' in result) return { error: result.error, status: 400 };
        issued = result;
      }
      return { resolved: open.rowCount ?? 0, issued, ownerId };
    });
    if ('error' in outcome) return reply.code(outcome.status).send({ error: outcome.error });
    if (outcome.issued) announce(outcome.issued);
    // Visitors of the apartment where the creation stands see it appear or vanish.
    if (outcome.ownerId) notifyApartment?.(outcome.ownerId, 'decor');
    return { resolved: outcome.resolved };
  });

  // Hide, clear or reset a creation without going through a report.
  app.post<{ Params: { id: string } }>('/api/staff/items/:id/moderation', async (req, reply) => {
    const staff = await staffOnly(req, reply, 'items.moderate');
    if (!staff) return;
    if (!UUID.test(req.params.id)) return reply.code(404).send({ error: 'Objet introuvable' });
    const parsed = moderationSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Requête invalide' });
    const item = await pool.query<{ owner_id: string }>('SELECT owner_id FROM items WHERE id = $1', [req.params.id]);
    if (!item.rows[0]) return reply.code(404).send({ error: 'Objet introuvable' });
    if (parsed.data.state === 'none') await pool.query('DELETE FROM item_moderation WHERE item_id = $1', [req.params.id]);
    else {
      await pool.query(
        `INSERT INTO item_moderation (item_id, state, decided_by) VALUES ($1, $2, $3)
         ON CONFLICT (item_id) DO UPDATE SET state = EXCLUDED.state, decided_by = EXCLUDED.decided_by, decided_at = now()`,
        [req.params.id, parsed.data.state, staff.id],
      );
    }
    notifyApartment?.(item.rows[0].owner_id, 'decor');
    return { ok: true };
  });

  // ----- Chat journal --------------------------------------------------------
  app.get<{ Querystring: { userId?: string; nickname?: string; room?: string; owner?: string; q?: string; blocked?: string; before?: string; limit?: string } }>(
    '/api/staff/chat',
    async (req, reply) => {
      if (!(await staffOnly(req, reply, 'chat.view'))) return;
      const { userId, nickname, room, owner, q, blocked, before } = req.query;
      if (userId !== undefined && !UUID.test(userId)) return reply.code(400).send({ error: 'Joueur invalide' });
      if (before !== undefined && !/^\d{1,15}$/.test(before)) return reply.code(400).send({ error: 'Page invalide' });
      const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 100));
      const like = q ? `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%` : null;
      const { rows } = await pool.query(
        `SELECT c.id, c.user_id, u.nickname, c.room, c.text, c.blocked, c.reason, c.created_at
           FROM chat_log c
           JOIN users u ON u.id = c.user_id
           LEFT JOIN users ou ON lower(ou.nickname) = lower($3::text)
          WHERE ($1::uuid IS NULL OR c.user_id = $1)
            AND ($2::text IS NULL OR lower(u.nickname) = lower($2))
            AND ($3::text IS NULL OR c.room = 'apartment:' || ou.id::text)
            AND ($4::text IS NULL OR c.room = $4)
            AND ($5::text IS NULL OR c.text ILIKE $5)
            AND ($6::boolean IS NULL OR c.blocked = $6)
            AND ($7::bigint IS NULL OR c.id < $7)
          ORDER BY c.id DESC LIMIT $8`,
        [userId ?? null, nickname || null, owner || null, room || null, like, blocked === 'true' ? true : blocked === 'false' ? false : null, before ?? null, limit],
      );
      return {
        messages: rows.map((r) => ({
          id: Number(r.id),
          userId: r.user_id,
          nickname: r.nickname,
          room: r.room,
          text: r.text,
          blocked: r.blocked,
          reason: r.reason,
          at: r.created_at,
        })),
        next: rows.length === limit ? Number(rows[rows.length - 1].id) : null,
      };
    },
  );

  // ----- Players -------------------------------------------------------------
  app.get<{ Querystring: { q?: string } }>('/api/staff/players', async (req, reply) => {
    if (!(await staffOnly(req, reply, 'players.view'))) return;
    const q = (req.query.q ?? '').trim();
    const like = `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    const { rows } = await pool.query<{ id: string; nickname: string; role: string; created_at: Date; sanctions: SanctionKind[] | null }>(
      `SELECT u.id, u.nickname, u.role, u.created_at,
              (SELECT array_agg(DISTINCT s.kind) FROM sanctions s WHERE s.user_id = u.id AND s.kind <> 'warning' AND ${liveSql('s')}) AS sanctions
         FROM users u WHERE u.nickname ILIKE $1 ORDER BY lower(u.nickname) LIMIT 30`,
      [like],
    );
    return { players: rows.map((r) => ({ id: r.id, nickname: r.nickname, role: r.role, createdAt: r.created_at, sanctions: r.sanctions ?? [] })) };
  });

  // The sheet of a player: who they are in the game (no email, no birth date: the staff has no use for them),
  // what they created, what was done to them, what was said about them and by them.
  app.get<{ Params: { id: string } }>('/api/staff/players/:id', async (req, reply) => {
    if (!(await staffOnly(req, reply, 'players.view'))) return;
    const { id } = req.params;
    if (!UUID.test(id)) return reply.code(404).send({ error: 'Joueur introuvable' });
    const player = await pool.query<{ id: string; nickname: string; role: string; created_at: Date; access: string; apartment_id: number | null; apartment_name: string | null }>(
      `SELECT u.id, u.nickname, u.role, u.created_at, u.apartment_access AS access, a.id AS apartment_id, a.name AS apartment_name
         FROM users u LEFT JOIN apartments a ON a.owner_id = u.id WHERE u.id = $1`,
      [id],
    );
    const p = player.rows[0];
    if (!p) return reply.code(404).send({ error: 'Joueur introuvable' });

    const [creations, sanctions, reportsAgainst, reportsMade, chat] = await Promise.all([
      pool.query(
        `SELECT it.id, it.serial, it.name, it.created_at, ${itemMaskedSql('it')} AS masked, im.state
           FROM items it LEFT JOIN item_moderation im ON im.item_id = it.id
          WHERE it.creator_id = $1 ORDER BY it.serial DESC LIMIT 100`,
        [id],
      ),
      pool.query(
        `SELECT s.id, s.kind, s.reason, s.created_at, s.expires_at, s.revoked_at, s.seen_at, ${liveSql('s')} AS live,
                iss.nickname AS issuer, rev.nickname AS revoker
           FROM sanctions s JOIN users iss ON iss.id = s.issued_by LEFT JOIN users rev ON rev.id = s.revoked_by
          WHERE s.user_id = $1 ORDER BY s.created_at DESC, s.id DESC`,
        [id],
      ),
      pool.query<{ open: string; total: string }>(
        `SELECT count(*) FILTER (WHERE status = 'open') AS open, count(*) AS total FROM reports WHERE target_user_id = $1`,
        [id],
      ),
      pool.query<{ n: string }>('SELECT count(*) AS n FROM reports WHERE reporter_id = $1', [id]),
      pool.query(
        `SELECT id, room, text, blocked, reason, created_at FROM chat_log WHERE user_id = $1 ORDER BY id DESC LIMIT 50`,
        [id],
      ),
    ]);
    return {
      player: {
        id: p.id,
        nickname: p.nickname,
        role: p.role,
        createdAt: p.created_at,
        apartment: p.apartment_id === null ? null : { id: p.apartment_id, name: p.apartment_name, access: p.access },
      },
      creations: creations.rows.map((r) => ({ id: r.id, serial: r.serial, name: r.name, createdAt: r.created_at, masked: r.masked, state: r.state })),
      sanctions: sanctions.rows.map((r) => ({
        id: Number(r.id),
        kind: r.kind,
        reason: r.reason,
        issuer: r.issuer,
        createdAt: r.created_at,
        expiresAt: r.expires_at,
        revokedAt: r.revoked_at,
        revoker: r.revoker,
        live: r.kind !== 'warning' && r.live,
      })),
      reports: { againstOpen: Number(reportsAgainst.rows[0]!.open), againstTotal: Number(reportsAgainst.rows[0]!.total), made: Number(reportsMade.rows[0]!.n) },
      chat: chat.rows.map((r) => ({ id: Number(r.id), room: r.room, text: r.text, blocked: r.blocked, reason: r.reason, at: r.created_at })),
    };
  });

  // ----- Sanctions -----------------------------------------------------------
  app.post<{ Params: { id: string } }>('/api/staff/players/:id/sanctions', async (req, reply) => {
    const staff = await staffOnly(req, reply);
    if (!staff) return;
    if (!UUID.test(req.params.id)) return reply.code(404).send({ error: 'Joueur introuvable' });
    const parsed = sanctionSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? 'Sanction invalide' });
    const result = await withTransaction(pool, (client) => issue(client, staff, req.params.id.toLowerCase(), parsed.data));
    if ('error' in result) return reply.code(result.error === 'Joueur introuvable' ? 404 : result.error.startsWith('Ton rôle') ? 403 : 400).send({ error: result.error });
    announce(result);
    return reply.code(201).send({ id: result.id });
  });

  // Lifting a sanction keeps it in the history, stamped with who lifted it. Only on somebody one outranks,
  // and a ban only by a role that may give one.
  app.post<{ Params: { id: string } }>('/api/staff/sanctions/:id/revoke', async (req, reply) => {
    const staff = await staffOnly(req, reply, 'sanction.revoke');
    if (!staff) return;
    if (!/^\d{1,15}$/.test(req.params.id)) return reply.code(404).send({ error: 'Sanction introuvable' });
    const found = await pool.query<{ kind: SanctionKind; role: string }>(
      'SELECT s.kind, u.role FROM sanctions s JOIN users u ON u.id = s.user_id WHERE s.id = $1 AND s.revoked_at IS NULL',
      [req.params.id],
    );
    if (!found.rows[0]) return reply.code(404).send({ error: 'Sanction introuvable ou déjà levée' });
    if (!outranks(staff.role, found.rows[0].role)) return reply.code(403).send({ error: 'Tu ne peux pas agir sur quelqu’un de ton niveau ou au-dessus.' });
    if (found.rows[0].kind === 'ban' && !can(staff.role, 'sanction.ban')) {
      return reply.code(403).send({ error: 'Seuls les rôles qui peuvent bannir peuvent lever un bannissement.' });
    }
    await pool.query('UPDATE sanctions SET revoked_at = now(), revoked_by = $1 WHERE id = $2 AND revoked_at IS NULL', [staff.id, req.params.id]);
    return { ok: true };
  });
}
