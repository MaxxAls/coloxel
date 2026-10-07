import type pg from 'pg';

export const SANCTION_KINDS = ['warning', 'mute', 'suspension', 'ban'] as const;
export type SanctionKind = (typeof SANCTION_KINDS)[number];

/** Longest mute or suspension: a year. A longer one is a ban. */
export const MAX_SANCTION_MINUTES = 365 * 24 * 60;

/** SQL condition: the sanction `alias` still applies (not lifted, not expired). */
export const liveSql = (alias = 's') => `(${alias}.revoked_at IS NULL AND (${alias}.expires_at IS NULL OR ${alias}.expires_at > now()))`;

/** SQL condition on a `users` row aliased `alias`: the player may not sign in (suspended or banned). */
export const blockedUserSql = (alias = 'u') =>
  `EXISTS (SELECT 1 FROM sanctions bs WHERE bs.user_id = ${alias}.id AND bs.kind IN ('suspension', 'ban') AND ${liveSql('bs')})`;

export interface LiveSanction {
  id: number;
  kind: SanctionKind;
  reason: string;
  expiresAt: Date | null;
}

/** The sanction of one of these kinds that applies to the player right now, the longest one if there are several. */
export async function liveSanction(pool: pg.Pool, userId: string, kinds: SanctionKind[]): Promise<LiveSanction | null> {
  const { rows } = await pool.query<{ id: string; kind: SanctionKind; reason: string; expires_at: Date | null }>(
    `SELECT s.id, s.kind, s.reason, s.expires_at FROM sanctions s
      WHERE s.user_id = $1 AND s.kind = ANY($2) AND ${liveSql('s')}
      ORDER BY s.expires_at DESC NULLS FIRST LIMIT 1`,
    [userId, kinds],
  );
  const r = rows[0];
  return r ? { id: Number(r.id), kind: r.kind, reason: r.reason, expiresAt: r.expires_at } : null;
}

const when = (d: Date) =>
  d.toLocaleString('fr-FR', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Paris' });

/** What the player is told about a sanction, in French. */
export function sanctionText(kind: SanctionKind, reason: string, expiresAt: Date | null): string {
  switch (kind) {
    case 'warning':
      return `Avertissement de l’équipe de Coloxel : ${reason}`;
    case 'mute':
      return `Tu es en sourdine${expiresAt ? ` jusqu’au ${when(expiresAt)}` : ''} : personne ne voit tes messages. Motif : ${reason}`;
    case 'suspension':
      return `Ton compte est suspendu${expiresAt ? ` jusqu’au ${when(expiresAt)}` : ''}. Motif : ${reason}`;
    case 'ban':
      return `Ton compte a été banni. Motif : ${reason}`;
  }
}

/** What the realtime rooms are told, so that a sanction takes effect on a player who is connected. */
export interface UserEvent {
  userId: string;
  kind: SanctionKind;
  /** Warnings only: so that the player's screen can mark it as read. */
  id?: number;
  text: string;
}
export type NotifyUser = (event: UserEvent) => void;
/** Presence topic carrying UserEvents to every room, wherever it runs. */
export const USER_TOPIC = 'coloxel:user-events';
/** Close code sent to a player whose account was just suspended or banned. */
export const SUSPENDED = 4004;
