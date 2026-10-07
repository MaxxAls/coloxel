import type { FastifyInstance } from 'fastify';
import type pg from 'pg';
import { z } from 'zod';
import { forgetMaintenance, isMaintenance, requireStaff, setMaintenance } from './settings';

const announcementSchema = z
  .object({
    title: z.string('Titre invalide').transform((s) => s.replace(/\s+/g, ' ').trim()).pipe(z.string().min(1, 'Le titre est obligatoire').max(80, 'Titre trop long (80 caractères max)')),
    body: z.string('Texte invalide').transform((s) => s.trim()).pipe(z.string().min(1, 'Le texte est obligatoire').max(4000, 'Texte trop long (4000 caractères max)')),
    pinned: z.boolean().optional(),
    published: z.boolean().optional(),
  })
  .strict();

export interface Announcement {
  id: number;
  title: string;
  body: string;
  pinned: boolean;
  published: boolean;
  author: string;
  createdAt: Date;
}

interface Row {
  id: string;
  title: string;
  body: string;
  pinned: boolean;
  published: boolean;
  author: string;
  created_at: Date;
}

const toAnnouncement = (r: Row): Announcement => ({
  id: Number(r.id),
  title: r.title,
  body: r.body,
  pinned: r.pinned,
  published: r.published,
  author: r.author,
  createdAt: r.created_at,
});

/** Published announcements, pinned first then newest first. Used by the game and by the website. */
export async function listAnnouncements(pool: pg.Pool, options: { limit: number; before?: number; includeDrafts?: boolean }): Promise<Announcement[]> {
  const { rows } = await pool.query<Row>(
    `SELECT a.id, a.title, a.body, a.pinned, a.published, u.nickname AS author, a.created_at
       FROM announcements a JOIN users u ON u.id = a.author_id
      WHERE ($1 OR a.published) AND ($2::bigint IS NULL OR a.id < $2)
      ORDER BY a.pinned DESC, a.id DESC LIMIT $3`,
    [options.includeDrafts ?? false, options.before ?? null, options.limit],
  );
  return rows.map(toAnnouncement);
}

export async function findAnnouncement(pool: pg.Pool, id: number): Promise<Announcement | null> {
  const { rows } = await pool.query<Row>(
    `SELECT a.id, a.title, a.body, a.pinned, a.published, u.nickname AS author, a.created_at
       FROM announcements a JOIN users u ON u.id = a.author_id WHERE a.id = $1 AND a.published`,
    [id],
  );
  return rows[0] ? toAnnouncement(rows[0]) : null;
}

/** News of the game: everybody reads them, only the staff writes them. Also the maintenance switch. */
export function registerAnnouncementRoutes(app: FastifyInstance, pool: pg.Pool) {
  // The latest ones, for the game's own "news" window. Needs no session: the website shows the same.
  app.get('/api/announcements', async () => ({ announcements: await listAnnouncements(pool, { limit: 5 }) }));

  // Is the game in maintenance? Also served while it is, so that screens can tell why nothing answers.
  app.get('/api/status', async () => ({ ok: true, maintenance: await isMaintenance(pool) }));

  app.get('/api/staff/announcements', async (req, reply) => {
    if (!(await requireStaff(pool, req, reply))) return;
    return { announcements: await listAnnouncements(pool, { limit: 100, includeDrafts: true }), maintenance: await isMaintenance(pool) };
  });

  app.post('/api/staff/announcements', async (req, reply) => {
    const staff = await requireStaff(pool, req, reply);
    if (!staff) return;
    const parsed = announcementSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? 'Annonce invalide' });
    const { title, body, pinned = false, published = true } = parsed.data;
    const { rows } = await pool.query<{ id: string }>(
      'INSERT INTO announcements (title, body, pinned, published, author_id) VALUES ($1, $2, $3, $4, $5) RETURNING id',
      [title, body, pinned, published, staff.id],
    );
    return reply.code(201).send({ id: Number(rows[0]!.id) });
  });

  app.put<{ Params: { id: string } }>('/api/staff/announcements/:id', async (req, reply) => {
    if (!(await requireStaff(pool, req, reply))) return;
    if (!/^\d{1,15}$/.test(req.params.id)) return reply.code(404).send({ error: 'Annonce introuvable' });
    const parsed = announcementSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? 'Annonce invalide' });
    const { title, body, pinned = false, published = true } = parsed.data;
    const { rowCount } = await pool.query(
      'UPDATE announcements SET title = $2, body = $3, pinned = $4, published = $5, updated_at = now() WHERE id = $1',
      [req.params.id, title, body, pinned, published],
    );
    if (!rowCount) return reply.code(404).send({ error: 'Annonce introuvable' });
    return { ok: true };
  });

  app.delete<{ Params: { id: string } }>('/api/staff/announcements/:id', async (req, reply) => {
    if (!(await requireStaff(pool, req, reply))) return;
    if (!/^\d{1,15}$/.test(req.params.id)) return reply.code(404).send({ error: 'Annonce introuvable' });
    const { rowCount } = await pool.query('DELETE FROM announcements WHERE id = $1', [req.params.id]);
    if (!rowCount) return reply.code(404).send({ error: 'Annonce introuvable' });
    return reply.code(204).send();
  });

  app.put('/api/staff/maintenance', async (req, reply) => {
    const staff = await requireStaff(pool, req, reply);
    if (!staff) return;
    const parsed = z.object({ on: z.boolean() }).strict().safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Requête invalide' });
    await setMaintenance(pool, parsed.data.on, staff.id);
    forgetMaintenance();
    return { maintenance: parsed.data.on };
  });
}
