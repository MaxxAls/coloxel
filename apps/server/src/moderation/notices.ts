import type { FastifyInstance } from 'fastify';
import type pg from 'pg';
import { z } from 'zod';
import { liveSql, sanctionText, type SanctionKind } from './sanctions';

const seenSchema = z.object({ ids: z.array(z.number().int().positive()).max(50) }).strict();

/**
 * What the staff has told a player and they must read: warnings not yet read, and the mute
 * that is still on. Shown when they sign in; a player connected at the time is told live.
 */
export function registerNoticeRoutes(app: FastifyInstance, pool: pg.Pool) {
  app.get('/api/notices', async (req, reply) => {
    if (!req.user) return reply.code(401).send({ error: 'Non connecté' });
    const { rows } = await pool.query<{ id: string; kind: SanctionKind; reason: string; expires_at: Date | null }>(
      `SELECT s.id, s.kind, s.reason, s.expires_at FROM sanctions s
        WHERE s.user_id = $1
          AND ((s.kind = 'warning' AND s.seen_at IS NULL AND s.revoked_at IS NULL) OR (s.kind = 'mute' AND ${liveSql('s')}))
        ORDER BY s.created_at`,
      [req.user.id],
    );
    return { notices: rows.map((r) => ({ id: Number(r.id), kind: r.kind, text: sanctionText(r.kind, r.reason, r.expires_at) })) };
  });

  // The player closed the message: a warning is not shown again.
  app.post('/api/notices/seen', async (req, reply) => {
    if (!req.user) return reply.code(401).send({ error: 'Non connecté' });
    const parsed = seenSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Requête invalide' });
    await pool.query(
      `UPDATE sanctions SET seen_at = now() WHERE user_id = $1 AND kind = 'warning' AND seen_at IS NULL AND id = ANY($2::bigint[])`,
      [req.user.id, parsed.data.ids],
    );
    return { ok: true };
  });
}
