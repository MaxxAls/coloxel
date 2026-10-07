import type { FastifyInstance } from 'fastify';
import type pg from 'pg';
import { z } from 'zod';
import { findViewableItemRecipe } from '../apartments/access';
import { NO_GUARDS, type RateGuards } from '../rate-limit';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const REPORT_KINDS = ['player', 'message', 'item', 'apartment_name', 'apartment'] as const;
export const REPORT_REASONS = ['insult', 'harassment', 'inappropriate', 'personal_info', 'spam', 'other'] as const;
export type ReportKind = (typeof REPORT_KINDS)[number];

const reportSchema = z
  .object({
    kind: z.enum(REPORT_KINDS, 'Type de signalement invalide'),
    targetId: z.union([z.string(), z.number()], 'Cible invalide').transform(String),
    reason: z.enum(REPORT_REASONS, 'Choisis un motif'),
    details: z
      .string('Détails invalides')
      .transform((s) => s.replace(/\s+/g, ' ').trim())
      .pipe(z.string().max(300, 'Détails trop longs (300 caractères max)'))
      .optional(),
  })
  .strict();

interface Target {
  key: string;
  userId: string | null;
  snapshot: string;
}

/** Looks up what the player wants to report, as it is right now. Null: it does not exist or is not theirs to report. */
async function findTarget(pool: pg.Pool, reporterId: string, kind: ReportKind, id: string): Promise<Target | { error: string } | null> {
  if (kind === 'message') {
    if (!/^\d{1,15}$/.test(id)) return null;
    const { rows } = await pool.query<{ user_id: string; text: string; nickname: string; room: string }>(
      `SELECT c.user_id, c.text, u.nickname, c.room FROM chat_log c JOIN users u ON u.id = c.user_id
        WHERE c.id = $1 AND NOT c.blocked`,
      [id],
    );
    const m = rows[0];
    if (!m) return null;
    if (m.user_id === reporterId) return { error: 'Tu ne peux pas te signaler toi-même.' };
    return { key: id, userId: m.user_id, snapshot: `${m.nickname} : ${m.text}` };
  }
  if (!UUID.test(id)) return null;
  const key = id.toLowerCase();
  if (kind === 'item') {
    const { rows } = await pool.query<{ name: string; description: string; serial: number; creator_id: string; owner_id: string }>(
      'SELECT name, description, serial, creator_id, owner_id FROM items WHERE id = $1',
      [key],
    );
    const it = rows[0];
    // A player can only report what they can see: their own creation, or one in an apartment they may enter.
    if (!it || !(await findViewableItemRecipe(pool, key, reporterId))) return null;
    if (it.owner_id === reporterId) return { error: 'Tu ne peux pas signaler un objet qui est à toi.' };
    return { key, userId: it.creator_id, snapshot: `Création n° ${String(it.serial).padStart(4, '0')} « ${it.name} » : ${it.description}` };
  }
  // Players, apartments and their names all point at a player.
  const { rows } = await pool.query<{ id: string; nickname: string; name: string | null }>(
    `SELECT u.id, u.nickname, a.name FROM users u LEFT JOIN apartments a ON a.owner_id = u.id WHERE u.id = $1`,
    [key],
  );
  const u = rows[0];
  if (!u) return null;
  if (u.id === reporterId) return { error: 'Tu ne peux pas te signaler toi-même.' };
  if (kind === 'player') return { key, userId: u.id, snapshot: u.nickname };
  if (kind === 'apartment_name') {
    if (!u.name) return { error: 'Cet appart n’a pas de nom.' };
    return { key, userId: u.id, snapshot: `Nom de l’appart de ${u.nickname} : ${u.name}` };
  }
  return { key, userId: u.id, snapshot: `Appart de ${u.nickname}${u.name ? ` (« ${u.name} »)` : ''}` };
}

export function registerReportRoutes(app: FastifyInstance, pool: pg.Pool, guards: RateGuards = NO_GUARDS) {
  app.post('/api/reports', { preHandler: guards.reports }, async (req, reply) => {
    if (!req.user) return reply.code(401).send({ error: 'Non connecté' });
    const parsed = reportSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? 'Signalement invalide' });
    const { kind, targetId, reason, details } = parsed.data;

    const target = await findTarget(pool, req.user.id, kind, targetId);
    if (!target) return reply.code(404).send({ error: 'Ce que tu veux signaler est introuvable.' });
    if ('error' in target) return reply.code(400).send({ error: target.error });

    const { rowCount } = await pool.query(
      `INSERT INTO reports (reporter_id, kind, target_key, target_user_id, reason, details, snapshot)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (reporter_id, kind, target_key) DO NOTHING`,
      [req.user.id, kind, target.key, target.userId, reason, details || null, target.snapshot],
    );
    // Reporting twice is not an error: it simply counts once.
    return reply.code(rowCount ? 201 : 200).send({ ok: true, already: !rowCount });
  });
}
