import type pg from 'pg';
import { FILTER_MESSAGES, filterText } from '../moderation/text-filter';

export const CHAT_MAX_LENGTH = 120;
/** A player may send this many messages in any window of this many milliseconds. */
export const CHAT_BURST = 5;
export const CHAT_WINDOW_MS = 8000;

/** Why a message did not reach the room, and what the author is told. */
export type RefusalReason = 'empty' | 'too-long' | 'rate' | 'muted' | 'filtered';

export const REFUSAL_MESSAGES: Record<Exclude<RefusalReason, 'filtered'>, string> = {
  empty: 'Écris quelque chose avant d’envoyer.',
  'too-long': `Message trop long (${CHAT_MAX_LENGTH} caractères au maximum).`,
  rate: 'Doucement ! Tu écris trop vite, attends un instant.',
  muted: 'Tu es en sourdine : personne ne voit tes messages pour le moment.',
};

/** Collapse whitespace and drop control characters: what is left is what the others would read. */
export function cleanChatText(raw: string): string {
  return raw
    .replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Sliding-window limiter, one per player and room: bursts are fine, floods are not. */
export class ChatLimiter {
  private sent = new Map<string, number[]>();

  constructor(
    private burst = CHAT_BURST,
    private windowMs = CHAT_WINDOW_MS,
  ) {}

  /** Counts the attempt: false means the player must wait. */
  allow(userId: string, now = Date.now()): boolean {
    const recent = (this.sent.get(userId) ?? []).filter((t) => now - t < this.windowMs);
    if (recent.length >= this.burst) {
      this.sent.set(userId, recent);
      return false;
    }
    recent.push(now);
    this.sent.set(userId, recent);
    return true;
  }

  forget(userId: string) {
    this.sent.delete(userId);
  }
}

export type ChatVerdict =
  | { ok: true; text: string }
  | { ok: false; reason: Exclude<RefusalReason, 'rate' | 'muted'>; text: string; message: string; detail: string };

/** Length and content checks, before anything is shown to anybody. */
export function judgeChatText(raw: unknown): ChatVerdict {
  // A modified client may send megabytes: only the beginning is looked at, it is refused all the same.
  const text = cleanChatText(typeof raw === 'string' ? raw.slice(0, CHAT_MAX_LENGTH * 4) : '');
  if (!text) return { ok: false, reason: 'empty', text, message: REFUSAL_MESSAGES.empty, detail: 'empty' };
  if (text.length > CHAT_MAX_LENGTH) return { ok: false, reason: 'too-long', text, message: REFUSAL_MESSAGES['too-long'], detail: 'too-long' };
  const verdict = filterText(text);
  if (!verdict.ok) return { ok: false, reason: 'filtered', text, message: FILTER_MESSAGES[verdict.reason], detail: verdict.reason };
  return { ok: true, text };
}

/** Journal of every message (the staff panel reads it). Returns the message id, which reports point to. */
export async function logChat(
  pool: pg.Pool,
  entry: { userId: string; room: string; text: string; blocked: boolean; reason?: string },
): Promise<number> {
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO chat_log (user_id, room, text, blocked, reason) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [entry.userId, entry.room, entry.text, entry.blocked, entry.reason ?? null],
  );
  // bigserial comes back as a string; ids stay far below 2^53.
  return Number(rows[0]!.id);
}
