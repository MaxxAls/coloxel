import type pg from 'pg';
import { withTransaction } from '../db/pool';
import type { UserEvent } from '../moderation/sanctions';
import { grantPixels } from '../wallet/routes';
import { ONCE_PER_REF, QUESTS, type QuestEvent } from './definitions';

export interface QuestReward {
  series: string;
  title: string;
  /** The tier reached, from 1. */
  tier: number;
  reward: number;
}

/**
 * Something happened that may move challenges forward. Returns the tiers that were just reached;
 * their Pixels are paid in the same transaction. `ref` identifies the thing for events that count
 * once per thing (an object placed, an apartment visited): the same ref never counts twice.
 */
export async function recordQuest(pool: pg.Pool, userId: string, event: QuestEvent, ref?: string): Promise<QuestReward[]> {
  const series = QUESTS.filter((q) => q.event === event);
  if (!series.length) return [];
  if (ONCE_PER_REF.has(event) && !ref) return [];
  return withTransaction(pool, async (client) => {
    if (ref) {
      const fresh = await client.query('INSERT INTO quest_marks (user_id, event, ref) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING', [userId, event, ref]);
      if (!fresh.rowCount) return [];
    }
    const rewards: QuestReward[] = [];
    for (const q of series) {
      const { rows } = await client.query<{ count: number; tier: number }>(
        `INSERT INTO quest_progress (user_id, series, count) VALUES ($1, $2, 1)
         ON CONFLICT (user_id, series) DO UPDATE SET count = quest_progress.count + 1, updated_at = now()
         RETURNING count, tier`,
        [userId, q.key],
      );
      const { count, tier } = rows[0]!;
      let reached = tier;
      while (reached < q.tiers.length && count >= q.tiers[reached]!.goal) {
        const t = q.tiers[reached]!;
        reached++;
        rewards.push({ series: q.key, title: q.title, tier: reached, reward: t.reward });
        await grantPixels(client, userId, t.reward, `Défi : ${q.title} ${reached}`);
      }
      if (reached !== tier) await client.query('UPDATE quest_progress SET tier = $3 WHERE user_id = $1 AND series = $2', [userId, q.key, reached]);
    }
    return rewards;
  });
}

/** What to tell the player, or null when nothing was reached. */
export function rewardEvent(userId: string, rewards: QuestReward[]): UserEvent | null {
  if (!rewards.length) return null;
  const total = rewards.reduce((n, r) => n + r.reward, 0);
  const names = rewards.map((r) => `${r.title} ${r.tier}`).join(', ');
  return { userId, kind: 'quest', text: `Défi réussi : ${names} ! +${total} Pixels` };
}

/** Records an event without making the caller wait, or fail: a challenge never breaks what the player was doing. */
export type QuestRecorder = (userId: string, event: QuestEvent, ref?: string) => void;

export function makeQuestRecorder(pool: pg.Pool, tell: (event: UserEvent) => void): QuestRecorder {
  return (userId, event, ref) => {
    void recordQuest(pool, userId, event, ref).then(
      (rewards) => {
        const told = rewardEvent(userId, rewards);
        if (told) tell(told);
      },
      () => {},
    );
  };
}
