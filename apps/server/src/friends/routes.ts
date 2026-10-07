import type { FastifyInstance } from 'fastify';
import type pg from 'pg';
import { z } from 'zod';
import { apartmentAccessSql } from '../apartments/access';
import type { NotifyApartment } from '../building/routes';
import type { QuestRecorder } from '../quests/engine';
import type { Locate, Location } from '../realtime/where';
import { NO_GUARDS, type RateGuards } from '../rate-limit';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A player has at most this many friends, and this many requests waiting for an answer. */
export const MAX_FRIENDS = 100;
export const MAX_PENDING = 20;

const requestSchema = z.object({ nickname: z.string('Pseudo invalide').trim().min(1, 'Écris le pseudo d’un joueur').max(40, 'Pseudo invalide') }).strict();

export interface FriendView {
  id: string;
  nickname: string;
  online: boolean;
  /** Where the friend is, in words; null when offline. */
  where: string | null;
  /** The room to join in one click: only when the friend is somewhere the player may enter. */
  target: Location | null;
}

const title = (name: string | null, nickname: string) => name ?? `Chez ${nickname}`;

/** The player's friends with where each of them is right now. Only friends see where a player is. */
export async function listFriends(pool: pg.Pool, userId: string, locate?: Locate): Promise<FriendView[]> {
  const { rows } = await pool.query<{ id: string; nickname: string }>(
    `SELECT u.id, u.nickname
       FROM friendships f
       JOIN users u ON u.id = CASE WHEN f.requester_id = $1 THEN f.addressee_id ELSE f.requester_id END
      WHERE f.status = 'accepted' AND (f.requester_id = $1 OR f.addressee_id = $1)
      ORDER BY lower(u.nickname)`,
    [userId],
  );
  const places = locate && rows.length ? await locate(rows.map((r) => r.id)) : new Map<string, Location>();

  // Names and doors of the apartments where friends are, in one query.
  const owners = [...new Set([...places.values()].flatMap((l) => (l.kind === 'apartment' ? [l.ownerId] : [])))];
  const apartments = new Map<string, { name: string | null; nickname: string; open: boolean }>();
  if (owners.length) {
    const found = await pool.query<{ id: string; nickname: string; name: string | null; open: boolean }>(
      `SELECT host.id, host.nickname, a.name, ${apartmentAccessSql('$1')} AS open
         FROM users host LEFT JOIN apartments a ON a.owner_id = host.id
        WHERE host.id = ANY($2::uuid[])`,
      [userId, owners],
    );
    for (const r of found.rows) apartments.set(r.id.toLowerCase(), { name: r.name, nickname: r.nickname, open: r.open });
  }

  return rows.map((r) => {
    const at = places.get(r.id);
    if (!at) return { id: r.id, nickname: r.nickname, online: false, where: null, target: null };
    if (at.kind === 'hall') return { id: r.id, nickname: r.nickname, online: true, where: 'Dans le hall', target: at };
    const flat = apartments.get(at.ownerId.toLowerCase());
    if (!flat?.open) return { id: r.id, nickname: r.nickname, online: true, where: 'Dans un appart privé', target: null };
    return { id: r.id, nickname: r.nickname, online: true, where: title(flat.name, flat.nickname), target: at };
  });
}

export function registerFriendRoutes(
  app: FastifyInstance,
  pool: pg.Pool,
  locate: Locate | undefined,
  notify: NotifyApartment | undefined,
  guards: RateGuards = NO_GUARDS,
  quest?: QuestRecorder,
) {
  const befriended = (a: string, b: string) => {
    quest?.(a, 'friend', b);
    quest?.(b, 'friend', a);
  };
  app.get('/api/friends', async (req, reply) => {
    if (!req.user) return reply.code(401).send({ error: 'Non connecté' });
    const me = req.user.id;
    const [friends, incoming, outgoing] = await Promise.all([
      listFriends(pool, me, locate),
      pool.query<{ id: string; nickname: string }>(
        `SELECT u.id, u.nickname FROM friendships f JOIN users u ON u.id = f.requester_id
          WHERE f.addressee_id = $1 AND f.status = 'pending' ORDER BY f.created_at`,
        [me],
      ),
      pool.query<{ id: string; nickname: string }>(
        `SELECT u.id, u.nickname FROM friendships f JOIN users u ON u.id = f.addressee_id
          WHERE f.requester_id = $1 AND f.status = 'pending' ORDER BY f.created_at`,
        [me],
      ),
    ]);
    return { friends, incoming: incoming.rows, outgoing: outgoing.rows };
  });

  const countFriends = async (userId: string) =>
    Number(
      (
        await pool.query<{ n: string }>(
          `SELECT count(*) AS n FROM friendships WHERE status = 'accepted' AND (requester_id = $1 OR addressee_id = $1)`,
          [userId],
        )
      ).rows[0]!.n,
    );

  // Ask someone to be friends by their nickname. If they already asked us, this is the answer: we become friends.
  app.post('/api/friends/requests', { preHandler: guards.social }, async (req, reply) => {
    if (!req.user) return reply.code(401).send({ error: 'Non connecté' });
    const parsed = requestSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? 'Pseudo invalide' });
    const me = req.user.id;

    const target = (
      await pool.query<{ id: string; nickname: string }>('SELECT id, nickname FROM users WHERE lower(nickname) = lower($1)', [parsed.data.nickname])
    ).rows[0];
    if (!target) return reply.code(404).send({ error: 'Aucun joueur ne porte ce pseudo.' });
    if (target.id === me) return reply.code(400).send({ error: 'Tu ne peux pas t’ajouter toi-même.' });

    const existing = (
      await pool.query<{ requester_id: string; status: string }>(
        `SELECT requester_id, status FROM friendships
          WHERE (requester_id = $1 AND addressee_id = $2) OR (requester_id = $2 AND addressee_id = $1)`,
        [me, target.id],
      )
    ).rows[0];
    if (existing?.status === 'accepted') return reply.code(409).send({ error: `Tu es déjà ami avec ${target.nickname}.` });
    if (existing && existing.requester_id === me) return reply.code(409).send({ error: `Tu as déjà demandé ${target.nickname} en ami.` });

    if ((await countFriends(me)) >= MAX_FRIENDS) return reply.code(400).send({ error: `Tu as déjà ${MAX_FRIENDS} amis, c’est le maximum.` });
    if (existing) {
      // They asked first: accepting is the same as asking back.
      if ((await countFriends(target.id)) >= MAX_FRIENDS) return reply.code(400).send({ error: `${target.nickname} a atteint le maximum d’amis.` });
      await pool.query(
        `UPDATE friendships SET status = 'accepted', accepted_at = now() WHERE requester_id = $1 AND addressee_id = $2`,
        [target.id, me],
      );
      befriended(me, target.id);
      return { status: 'accepted', friend: { id: target.id, nickname: target.nickname } };
    }

    const pending = Number(
      (await pool.query<{ n: string }>(`SELECT count(*) AS n FROM friendships WHERE requester_id = $1 AND status = 'pending'`, [me])).rows[0]!.n,
    );
    if (pending >= MAX_PENDING) return reply.code(400).send({ error: 'Tu as trop de demandes en attente. Attends des réponses avant d’en faire d’autres.' });
    try {
      await pool.query('INSERT INTO friendships (requester_id, addressee_id) VALUES ($1, $2)', [me, target.id]);
    } catch (err) {
      // Two requests at once, one each way: the unique pair index lets only one through.
      if ((err as { code?: string }).code === '23505') return reply.code(409).send({ error: 'Une demande existe déjà entre vous.' });
      throw err;
    }
    return reply.code(201).send({ status: 'pending', to: { id: target.id, nickname: target.nickname } });
  });

  app.post<{ Params: { userId: string } }>('/api/friends/requests/:userId/accept', { preHandler: guards.social }, async (req, reply) => {
    if (!req.user) return reply.code(401).send({ error: 'Non connecté' });
    const { userId } = req.params;
    if (!UUID.test(userId)) return reply.code(404).send({ error: 'Demande introuvable' });
    if ((await countFriends(req.user.id)) >= MAX_FRIENDS) return reply.code(400).send({ error: `Tu as déjà ${MAX_FRIENDS} amis, c’est le maximum.` });
    if ((await countFriends(userId)) >= MAX_FRIENDS) return reply.code(400).send({ error: 'Ce joueur a atteint le maximum d’amis.' });
    const { rowCount } = await pool.query(
      `UPDATE friendships SET status = 'accepted', accepted_at = now()
        WHERE requester_id = $1 AND addressee_id = $2 AND status = 'pending'`,
      [userId, req.user.id],
    );
    if (!rowCount) return reply.code(404).send({ error: 'Demande introuvable' });
    befriended(userId, req.user.id);
    return { status: 'accepted' };
  });

  // Remove a friend, refuse a request, or take one back: whatever links the two of us goes.
  app.delete<{ Params: { userId: string } }>('/api/friends/:userId', { preHandler: guards.social }, async (req, reply) => {
    if (!req.user) return reply.code(401).send({ error: 'Non connecté' });
    const { userId } = req.params;
    if (!UUID.test(userId)) return reply.code(404).send({ error: 'Ami introuvable' });
    const { rows } = await pool.query<{ status: string }>(
      `DELETE FROM friendships
        WHERE (requester_id = $1 AND addressee_id = $2) OR (requester_id = $2 AND addressee_id = $1)
        RETURNING status`,
      [req.user.id, userId],
    );
    if (!rows.length) return reply.code(404).send({ error: 'Ami introuvable' });
    if (rows[0]!.status === 'accepted') {
      // Apartments opened to friends only: whoever was visiting as a friend is shown out.
      notify?.(req.user.id, 'access');
      notify?.(userId, 'access');
    }
    return reply.code(204).send();
  });
}
