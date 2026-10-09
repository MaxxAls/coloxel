import type { FastifyInstance } from 'fastify';
import type pg from 'pg';
import { z } from 'zod';
import { MIN_AGE } from '../auth/rules';
import type { NotifyUser } from '../moderation/sanctions';
import { FILTER_MESSAGES, filterText } from '../moderation/text-filter';
import { NO_GUARDS, type RateGuards } from '../rate-limit';

// Private messages between friends. The safeguards, all on the server:
// - friends only, and both of age (the game takes adults only for now: this keeps it so when minors come);
// - filtered like the chat before they are stored, and kept, so that the staff can read what is reported;
// - the one who receives them may close their messages, and report any message;
// - a few messages a minute at most.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Longest message. */
export const PM_MAX = 300;
/** Messages a player may send in a minute, to everybody together. */
export const PM_PER_MINUTE = 12;
/** Messages shown in a conversation. */
const PM_SHOWN = 60;

const sendSchema = z
  .object({
    text: z.string('Message invalide').transform((s) => s.replace(/[\u0000-\u001f<>]/g, ' ').replace(/\s+/g, ' ').trim()).pipe(
      z.string().min(1, 'Le message est vide').max(PM_MAX, `Le message est trop long (${PM_MAX} caractères max)`),
    ),
  })
  .strict();

/** Are these two players friends (an accepted request either way)? */
async function friends(pool: pg.Pool, a: string, b: string): Promise<boolean> {
  const { rowCount } = await pool.query(
    `SELECT 1 FROM friendships WHERE status = 'accepted'
       AND ((requester_id = $1 AND addressee_id = $2) OR (requester_id = $2 AND addressee_id = $1))`,
    [a, b],
  );
  return !!rowCount;
}

/** Are both players of age? Private messages stay between adults. */
async function bothOfAge(pool: pg.Pool, a: string, b: string): Promise<boolean> {
  const { rows } = await pool.query<{ ok: boolean }>(
    `SELECT bool_and(birth_date <= (now() - make_interval(years => $3))::date) AS ok FROM users WHERE id = ANY($1::uuid[]) HAVING count(*) = $2`,
    [[a, b], 2, MIN_AGE],
  );
  return !!rows[0]?.ok;
}

export function registerMessageRoutes(app: FastifyInstance, pool: pg.Pool, notifyUser?: NotifyUser, guards: RateGuards = NO_GUARDS) {
  // Who wrote to us and we have not read yet, and whether our messages are open.
  app.get('/api/messages', async (req, reply) => {
    if (!req.user) return reply.code(401).send({ error: 'Non connecté' });
    const [unread, me] = await Promise.all([
      pool.query<{ from_id: string; nickname: string; n: string }>(
        `SELECT m.from_id, u.nickname, count(*) AS n FROM private_messages m JOIN users u ON u.id = m.from_id
          WHERE m.to_id = $1 AND m.read_at IS NULL GROUP BY m.from_id, u.nickname ORDER BY max(m.created_at) DESC`,
        [req.user.id],
      ),
      pool.query<{ pm_closed: boolean }>('SELECT pm_closed FROM users WHERE id = $1', [req.user.id]),
    ]);
    return {
      open: !me.rows[0]?.pm_closed,
      unread: unread.rows.map((r) => ({ id: r.from_id, nickname: r.nickname, count: Number(r.n) })),
    };
  });

  // The conversation with a friend, oldest first; what they wrote us is now read.
  app.get<{ Params: { friendId: string } }>('/api/messages/:friendId', async (req, reply) => {
    if (!req.user) return reply.code(401).send({ error: 'Non connecté' });
    const friendId = req.params.friendId.toLowerCase();
    if (!UUID.test(friendId) || !(await friends(pool, req.user.id, friendId))) return reply.code(404).send({ error: 'Cette personne n’est pas dans tes amis.' });
    const { rows } = await pool.query<{ id: string; from_id: string; text: string; created_at: Date }>(
      `SELECT id, from_id, text, created_at FROM (
         SELECT id, from_id, text, created_at FROM private_messages
          WHERE (from_id = $1 AND to_id = $2) OR (from_id = $2 AND to_id = $1)
          ORDER BY created_at DESC, id DESC LIMIT $3) last
        ORDER BY created_at, id`,
      [req.user.id, friendId, PM_SHOWN],
    );
    await pool.query('UPDATE private_messages SET read_at = now() WHERE to_id = $1 AND from_id = $2 AND read_at IS NULL', [req.user.id, friendId]);
    return { messages: rows.map((r) => ({ id: Number(r.id), mine: r.from_id === req.user!.id, text: r.text, at: r.created_at.toISOString() })) };
  });

  app.post<{ Params: { friendId: string } }>('/api/messages/:friendId', { preHandler: guards.social }, async (req, reply) => {
    const me = req.user;
    if (!me) return reply.code(401).send({ error: 'Non connecté' });
    const friendId = req.params.friendId.toLowerCase();
    if (!UUID.test(friendId) || friendId === me.id || !(await friends(pool, me.id, friendId))) {
      return reply.code(404).send({ error: 'Tu ne peux écrire qu’à tes amis.' });
    }
    const parsed = sendSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? 'Message invalide' });
    if (!(await bothOfAge(pool, me.id, friendId))) return reply.code(403).send({ error: 'Les messages privés ne sont pas ouverts à ce compte.' });
    const closed = await pool.query<{ pm_closed: boolean }>('SELECT pm_closed FROM users WHERE id = $1', [friendId]);
    if (closed.rows[0]?.pm_closed) return reply.code(409).send({ error: 'Cette personne a fermé ses messages privés.' });
    const recent = await pool.query<{ n: string }>("SELECT count(*) AS n FROM private_messages WHERE from_id = $1 AND created_at > now() - interval '1 minute'", [me.id]);
    if (Number(recent.rows[0]!.n) >= PM_PER_MINUTE) return reply.code(429).send({ error: 'Doucement ! Attends un peu avant d’écrire encore.' });
    const verdict = filterText(parsed.data.text);
    if (!verdict.ok) return reply.code(422).send({ error: FILTER_MESSAGES[verdict.reason] });
    const { rows } = await pool.query<{ id: string; created_at: Date }>(
      'INSERT INTO private_messages (from_id, to_id, text) VALUES ($1, $2, $3) RETURNING id, created_at',
      [me.id, friendId, parsed.data.text],
    );
    notifyUser?.({ userId: friendId, kind: 'pm', from: me.id, nickname: me.nickname });
    return reply.code(201).send({ message: { id: Number(rows[0]!.id), mine: true, text: parsed.data.text, at: rows[0]!.created_at.toISOString() } });
  });

  // Open or close one's private messages.
  app.put('/api/messages/settings', async (req, reply) => {
    if (!req.user) return reply.code(401).send({ error: 'Non connecté' });
    const parsed = z.object({ open: z.boolean() }).strict().safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Réglage invalide' });
    await pool.query('UPDATE users SET pm_closed = $2 WHERE id = $1', [req.user.id, !parsed.data.open]);
    return { open: parsed.data.open };
  });
}
