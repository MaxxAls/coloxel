import type pg from 'pg';
import { z } from 'zod';
import { MAX_SANCTION_MINUTES, SANCTION_KINDS, sanctionText, type NotifyUser, type SanctionKind } from '../moderation/sanctions';
import { outranks, sanctionRefusal, type StaffMember } from './roles';

// The one place where a sanction is written, whether it comes from the administration or from a command typed in a room:
// the same hierarchy, the same limits of each role, the same journal.

export const sanctionSchema = z
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
export type SanctionInput = z.infer<typeof sanctionSchema>;

export interface Issued {
  id: number;
  userId: string;
  kind: SanctionKind;
  text: string;
}

/** Writes the sanction, inside the caller's transaction. Returns what to announce once it is committed. */
export async function issueSanction(
  client: pg.PoolClient,
  staff: StaffMember,
  userId: string,
  input: SanctionInput,
  reportId?: number,
): Promise<Issued | { error: string }> {
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

/** Once committed: a connected player is told, or shown out, within the second. */
export const announceSanction = (notifyUser: NotifyUser | undefined, issued: Issued) =>
  notifyUser?.({ userId: issued.userId, kind: issued.kind, id: issued.kind === 'warning' ? issued.id : undefined, text: issued.text });
