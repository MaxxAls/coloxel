import type { FastifyInstance } from 'fastify';
import type pg from 'pg';
import { catalogueEntry, isSwitchable } from '@coloxel/render';
import type { NotifyApartment } from '../building/routes';
import { withTransaction } from '../db/pool';
import { NO_GUARDS, type RateGuards } from '../rate-limit';
import { MAX_CONDITIONS, MAX_EFFECTS, MAX_RULES, MIN_EVERY_SECONDS, piecesOf, ruleSchema, rulesBodySchema, type PieceNeed, type Rule } from './schema';

/** The rules of an apartment, in order. Whatever in the table does not pass the schema (it should not happen) is left out. */
export async function loadRules(pool: pg.Pool, ownerId: string): Promise<Rule[]> {
  const { rows } = await pool.query<{ rule: unknown }>('SELECT rule FROM apartment_rules WHERE owner_id = $1 ORDER BY position', [ownerId]);
  return rows.flatMap((r) => {
    const parsed = ruleSchema.safeParse(r.rule);
    return parsed.success ? [parsed.data] : [];
  });
}

/** The owner's mechanisms: read and replaced as a whole. Only the player of the session, only their own apartment. */
export function registerRuleRoutes(app: FastifyInstance, pool: pg.Pool, notify?: NotifyApartment, guards: RateGuards = NO_GUARDS) {
  app.get('/api/apartment/rules', async (req, reply) => {
    if (!req.user) return reply.code(401).send({ error: 'Non connecté' });
    return { rules: await loadRules(pool, req.user.id), limits: { rules: MAX_RULES, conditions: MAX_CONDITIONS, effects: MAX_EFFECTS, everySeconds: MIN_EVERY_SECONDS } };
  });

  app.put('/api/apartment/rules', { preHandler: guards.furniture }, async (req, reply) => {
    const user = req.user;
    if (!user) return reply.code(401).send({ error: 'Non connecté' });
    const parsed = rulesBodySchema.safeParse(req.body);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      return reply.code(400).send({ error: issue?.message && issue.message !== 'Invalid input' ? issue.message : 'Règles invalides' });
    }
    const { rules } = parsed.data;

    // Every piece a rule points at is one of this player's own, and switchable when the rule lights or puts it out.
    const wanted = new Map<string, Set<PieceNeed>>();
    for (const rule of rules) for (const p of piecesOf(rule)) wanted.set(p.id, (wanted.get(p.id) ?? new Set()).add(p.needs));
    if (wanted.size) {
      const owned = await pool.query<{ id: string; catalogue_key: string }>('SELECT id, catalogue_key FROM furniture WHERE owner_id = $1 AND id = ANY($2::uuid[])', [
        user.id,
        [...wanted.keys()],
      ]);
      const byId = new Map(owned.rows.map((r) => [r.id, r.catalogue_key]));
      for (const [id, needs] of wanted) {
        const key = byId.get(id);
        if (!key) return reply.code(400).send({ error: 'Un des meubles choisis n’est pas à toi.' });
        const entry = catalogueEntry(key);
        if (needs.has('light') && !isSwitchable(entry)) return reply.code(400).send({ error: 'Ce meuble ne s’allume pas : choisis une lampe, la cheminée, la télé…' });
        if (needs.has('counter') && !entry?.counter) return reply.code(400).send({ error: 'Choisis un compteur de points.' });
        if (needs.has('floor') && entry?.wall) return reply.code(400).send({ error: 'Un meuble accroché au mur ne se tourne ni ne se déplace.' });
      }
    }

    await withTransaction(pool, async (client) => {
      await client.query('DELETE FROM apartment_rules WHERE owner_id = $1', [user.id]);
      for (const [position, rule] of rules.entries()) {
        await client.query('INSERT INTO apartment_rules (owner_id, position, rule) VALUES ($1, $2, $3)', [user.id, position, JSON.stringify(rule)]);
      }
    });
    // The room, wherever it runs, picks the new rules up.
    notify?.(user.id, 'rules');
    return { rules: await loadRules(pool, user.id) };
  });
}
