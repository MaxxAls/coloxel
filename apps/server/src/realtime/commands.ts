/** Things a player can type in the chat bar that are not chat: they start with a slash. */
export type Command =
  | { name: 'dance' }
  | { name: 'follow'; who: string }
  | { name: 'stop' }
  | { name: 'help' }
  | { name: 'unknown'; typed: string };

export const HELP_TEXT =
  'Commandes : /danse (danser), /suivre <pseudo> (suivre un ami de la salle), /stop (arrêter de suivre ou de danser), /aide.';

/** A command, or null when the text is plain chat. */
export function parseCommand(text: string): Command | null {
  const trimmed = text.trim();
  if (!trimmed.startsWith('/')) return null;
  const [word = '', ...rest] = trimmed.slice(1).split(/\s+/);
  const name = word.toLowerCase();
  if (name === 'danse' || name === 'danser') return { name: 'dance' };
  if (name === 'suivre' || name === 'suis') return { name: 'follow', who: rest.join(' ').trim() };
  if (name === 'stop' || name === 'arret' || name === 'arrêt') return { name: 'stop' };
  if (name === 'aide' || name === 'help' || name === '?') return { name: 'help' };
  return { name: 'unknown', typed: word.slice(0, 20) };
}

/** A dance lasts this long unless the player walks off or stops it. */
export const DANCE_MS = 30_000;
