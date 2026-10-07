import type { FastifyInstance } from 'fastify';
import type pg from 'pg';
import { z } from 'zod';
import { findViewableItemRecipe } from '../apartments/access';
import { NO_GUARDS, type RateGuards } from '../rate-limit';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const REPORT_KINDS = ['player', 'message', 'item', 'apartment_name', 'apartment', 'listing', 'trade'] as const;
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
  /** What was said around it, oldest first. */
  context?: string;
}

/** The last messages that were shown in a room up to a point: what a moderator needs to understand a report. */
async function recentChat(pool: pg.Pool, room: string, upTo: string | null): Promise<string | undefined> {
  const { rows } = await pool.query<{ nickname: string; text: string }>(
    `SELECT u.nickname, c.text FROM chat_log c JOIN users u ON u.id = c.user_id
      WHERE c.room = $1 AND NOT c.blocked AND ($2::bigint IS NULL OR c.id <= $2)
      ORDER BY c.id DESC LIMIT 8`,
    [room, upTo],
  );
  return rows.length ? rows.reverse().map((r) => `${r.nickname} : ${r.text}`).join(String.fromCharCode(10)) : undefined;
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
    return { key: id, userId: m.user_id, snapshot: `${m.nickname} : ${m.text}`, context: await recentChat(pool, m.room, id) };
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
  if (kind === 'listing') {
    const { rows } = await pool.query<{ seller_id: string; price: number; name: string; serial: number; seller: string }>(
      `SELECT l.seller_id, l.price, it.name, it.serial, se.nickname AS seller
         FROM listings l JOIN items it ON it.id = l.item_id JOIN users se ON se.id = l.seller_id
        WHERE l.id = $1 AND l.status = 'active'`,
      [key],
    );
    const l = rows[0];
    if (!l) return null;
    if (l.seller_id === reporterId) return { error: 'Tu ne peux pas signaler ta propre offre.' };
    return { key, userId: l.seller_id, snapshot: `Offre de ${l.seller} : création n° ${String(l.serial).padStart(4, '0')} « ${l.name} » à ${l.price} Coloxs` };
  }
  if (kind === 'trade') {
    const { rows } = await pool.query<{ a_id: string; b_id: string; a_name: string; b_name: string }>(
      `SELECT t.a_id, t.b_id, a.nickname AS a_name, b.nickname AS b_name
         FROM trades t JOIN users a ON a.id = t.a_id JOIN users b ON b.id = t.b_id
        WHERE t.id = $1 AND (t.a_id = $2 OR t.b_id = $2)`,
      [key, reporterId],
    );
    const t = rows[0];
    if (!t) return null;
    const items = await pool.query<{ giver: string; serial: number; name: string }>(
      `SELECT g.nickname AS giver, it.serial, it.name FROM trade_offers o JOIN items it ON it.id = o.item_id JOIN users g ON g.id = o.giver_id
        WHERE o.trade_id = $1 ORDER BY o.giver_id, it.serial`,
      [key],
    );
    const list = items.rows.map((r) => `${r.giver} donne n° ${String(r.serial).padStart(4, '0')} « ${r.name} »`).join(' ; ');
    return { key, userId: t.a_id === reporterId ? t.b_id : t.a_id, snapshot: `Échange ${t.a_name} / ${t.b_name} : ${list || 'rien sur la table'}` };
  }
  // Players, apartments and their names all point at a player.
  const { rows } = await pool.query<{ id: string; nickname: string; name: string | null }>(
    `SELECT u.id, u.nickname, a.name FROM users u LEFT JOIN apartments a ON a.owner_id = u.id WHERE u.id = $1`,
    [key],
  );
  const u = rows[0];
  if (!u) return null;
  if (u.id === reporterId) return { error: 'Tu ne peux pas te signaler toi-même.' };
  if (kind === 'player') {
    // Where the player last spoke, if they did lately.
    const last = await pool.query<{ room: string }>(
      `SELECT room FROM chat_log WHERE user_id = $1 AND NOT blocked AND created_at > now() - interval '1 hour' ORDER BY id DESC LIMIT 1`,
      [u.id],
    );
    return { key, userId: u.id, snapshot: u.nickname, context: last.rows[0] ? await recentChat(pool, last.rows[0].room, null) : undefined };
  }
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
      `INSERT INTO reports (reporter_id, kind, target_key, target_user_id, reason, details, snapshot, context)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (reporter_id, kind, target_key) DO NOTHING`,
      [req.user.id, kind, target.key, target.userId, reason, details || null, target.snapshot, target.context ?? null],
    );
    // Reporting twice is not an error: it simply counts once.
    return reply.code(rowCount ? 201 : 200).send({ ok: true, already: !rowCount });
  });
}
