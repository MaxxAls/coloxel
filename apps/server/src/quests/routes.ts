import type { FastifyInstance } from 'fastify';
import type pg from 'pg';
import { QUESTS } from './definitions';

/** The challenges and how far the player is in each: the server owns the counts. */
export function registerQuestRoutes(app: FastifyInstance, pool: pg.Pool) {
  app.get('/api/quests', async (req, reply) => {
    if (!req.user) return reply.code(401).send({ error: 'Non connecté' });
    const { rows } = await pool.query<{ series: string; count: number; tier: number }>(
      'SELECT series, count, tier FROM quest_progress WHERE user_id = $1',
      [req.user.id],
    );
    const progress = new Map(rows.map((r) => [r.series, r]));
    return {
      quests: QUESTS.map((q) => {
        const p = progress.get(q.key);
        const count = p?.count ?? 0;
        const tier = p?.tier ?? 0;
        return {
          key: q.key,
          title: q.title,
          description: q.description,
          count,
          tier,
          tiers: q.tiers.map((t, k) => ({ goal: t.goal, reward: t.reward, done: k < tier })),
          done: tier >= q.tiers.length,
        };
      }),
    };
  });
}
