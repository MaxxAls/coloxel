import type pg from 'pg';

// Words the staff added to the chat filter while the game is running (the ones in the code are in auth/rules.ts).
// They are kept in memory for the filter, which is asked on every message, and read again from the database now and then
// so that every process learns of them.

let extra: string[] = [];

/** The word as the filter sees it: lower case, no accent, letters and digits only. */
export const flatWord = (text: string) =>
  text
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/[^a-z0-9]/g, '');

/** Does this already flattened text contain one of the words the staff added? */
export const hasExtraBannedWord = (flat: string): boolean => extra.some((w) => flat.includes(w));

export async function loadExtraWords(pool: pg.Pool): Promise<void> {
  const { rows } = await pool.query<{ word: string }>('SELECT word FROM banned_words');
  extra = rows.map((r) => r.word);
}

/** Local effect of an added or removed word, at once: the database is the record. */
export function setExtraWord(word: string, present: boolean) {
  extra = present ? [...new Set([...extra, word])] : extra.filter((w) => w !== word);
}

export const extraWords = () => [...extra];

/** Keep the list fresh in a long-running process. */
export function watchExtraWords(pool: pg.Pool, everyMs = 60_000): () => void {
  void loadExtraWords(pool).catch(() => {});
  const timer = setInterval(() => void loadExtraWords(pool).catch(() => {}), everyMs);
  timer.unref();
  return () => clearInterval(timer);
}
