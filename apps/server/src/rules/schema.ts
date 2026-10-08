import { N } from '@coloxel/world';
import { z } from 'zod';
import { filterText } from '../moderation/text-filter';

// Mechanisms: "when <trigger> [if <conditions>] then <effects>". Everything a rule can do is listed here,
// and nothing else: a rule is data, never code. In particular, no rule can give Pixels, objects or anything
// else that has a value, and the text a rule shows is filtered like the chat.

export const MAX_RULES = 20;
export const MAX_CONDITIONS = 3;
export const MAX_EFFECTS = 4;
export const MIN_EVERY_SECONDS = 5;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const cell = z.object({ i: z.number().int().min(0).max(N - 1), j: z.number().int().min(0).max(N - 1) }).strict();
const piece = z.string().regex(UUID, 'Meuble invalide').transform((s) => s.toLowerCase());

const trigger = z.discriminatedUnion('type', [
  z.object({ type: z.literal('enter') }).strict(),
  z.object({ type: z.literal('step'), cell }).strict(),
  z.object({ type: z.literal('use'), cell }).strict(),
  z
    .object({
      type: z.literal('say'),
      word: z
        .string('Mot invalide')
        .transform((s) => s.replace(/\s+/g, ' ').trim().toLowerCase())
        .pipe(z.string().min(2, 'Le mot doit faire 2 caractères au moins').max(20, 'Le mot est trop long (20 caractères max)')),
    })
    .strict(),
  z.object({ type: z.literal('leave'), cell }).strict(),
  z.object({ type: z.literal('score'), piece, n: z.number('Score invalide').int().min(0).max(99) }).strict(),
  z
    .object({
      type: z.literal('every'),
      seconds: z.number('Durée invalide').int('Durée invalide').min(MIN_EVERY_SECONDS, `Au moins ${MIN_EVERY_SECONDS} secondes`).max(3600, 'Une heure au plus'),
    })
    .strict(),
]);

const condition = z.discriminatedUnion('type', [
  z.object({ type: z.literal('players'), op: z.enum(['>=', '<='], 'Comparaison invalide'), n: z.number().int().min(0).max(50) }).strict(),
  z.object({ type: z.literal('lit'), piece, on: z.boolean() }).strict(),
  z.object({ type: z.literal('on-cell'), cell }).strict(),
  z.object({ type: z.literal('someone-on'), cell }).strict(),
  z
    .object({
      type: z.literal('hours'),
      from: z.number('Heure invalide').int().min(0).max(23),
      to: z.number('Heure invalide').int().min(0).max(23),
    })
    .strict(),
]);

const effect = z.discriminatedUnion('type', [
  z.object({ type: z.literal('light'), piece, mode: z.enum(['on', 'off', 'toggle'], 'Action invalide') }).strict(),
  z.object({ type: z.literal('teleport'), cell }).strict(),
  z
    .object({
      type: z.literal('message'),
      text: z
        .string('Message invalide')
        .transform((s) => s.replace(/\s+/g, ' ').trim())
        .pipe(z.string().min(1, 'Le message est vide').max(80, 'Message trop long (80 caractères max)'))
        .refine((s) => filterText(s).ok, 'Ce message n’est pas autorisé (insulte, lien, numéro…)'),
    })
    .strict(),
  z.object({ type: z.literal('dance') }).strict(),
  z.object({ type: z.literal('score'), piece, mode: z.enum(['add', 'reset'], 'Action invalide'), points: z.number().int().min(1).max(10) }).strict(),
  z.object({ type: z.literal('rotate'), piece }).strict(),
  z.object({ type: z.literal('move'), piece, cell }).strict(),
]);

export const ruleSchema = z
  .object({
    enabled: z.boolean(),
    trigger,
    conditions: z.array(condition).max(MAX_CONDITIONS, `${MAX_CONDITIONS} conditions au plus`),
    effects: z.array(effect).min(1, 'Une règle fait au moins une chose').max(MAX_EFFECTS, `${MAX_EFFECTS} effets au plus`),
  })
  .strict();

export const rulesBodySchema = z.object({ rules: z.array(ruleSchema).max(MAX_RULES, `${MAX_RULES} règles au plus`) }).strict();

export type Rule = z.infer<typeof ruleSchema>;
export type Trigger = Rule['trigger'];
export type Condition = Rule['conditions'][number];
export type Effect = Rule['effects'][number];

/** What a rule needs of a piece it points at: a light, a score counter, or any piece standing on the floor. */
export type PieceNeed = 'light' | 'counter' | 'floor';

/** Every furniture a rule points at, for the checks done when saving. */
export function piecesOf(rule: Rule): { id: string; needs: PieceNeed }[] {
  const out: { id: string; needs: PieceNeed }[] = [];
  if (rule.trigger.type === 'score') out.push({ id: rule.trigger.piece, needs: 'counter' });
  for (const c of rule.conditions) if (c.type === 'lit') out.push({ id: c.piece, needs: 'light' });
  for (const e of rule.effects) {
    if (e.type === 'light') out.push({ id: e.piece, needs: 'light' });
    else if (e.type === 'score') out.push({ id: e.piece, needs: 'counter' });
    else if (e.type === 'rotate' || e.type === 'move') out.push({ id: e.piece, needs: 'floor' });
  }
  return out;
}
