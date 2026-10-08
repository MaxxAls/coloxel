/** Things a player can type in the chat bar that are not chat: they start with a slash. */
export type Command =
  | { name: 'dance' }
  | { name: 'follow'; who: string }
  | { name: 'stop' }
  | { name: 'drop' }
  | { name: 'pet'; trick: string }
  | { name: 'help' }
  | { name: 'sit' }
  | { name: 'lie' }
  | { name: 'stand' }
  | { name: 'moonwalk' }
  | { name: 'push'; who: string }
  | { name: 'pull'; who: string }
  | { name: 'unknown'; typed: string };

export const HELP_TEXT =
  'Commandes : /danse (danser), /assis (t’asseoir par terre), /allonge (t’allonger), /debout (te relever), /reculons (marcher à reculons, ou plus), /pousser <pseudo> et /tirer <pseudo> (un joueur tout près), /suivre <pseudo> (suivre un ami de la salle), /stop (arrêter de suivre ou de danser), /poser (reposer ce que tu tiens en main), /compagnon <tour> (assis, viens, saute, tourne), /aide.';

/** A command, or null when the text is plain chat. */
export function parseCommand(text: string): Command | null {
  const trimmed = text.trim();
  if (!trimmed.startsWith('/')) return null;
  const [word = '', ...rest] = trimmed.slice(1).split(/\s+/);
  const name = word.toLowerCase();
  if (name === 'danse' || name === 'danser') return { name: 'dance' };
  if (name === 'suivre' || name === 'suis') return { name: 'follow', who: rest.join(' ').trim() };
  if (name === 'stop' || name === 'arret' || name === 'arrêt') return { name: 'stop' };
  if (name === 'poser' || name === 'lacher' || name === 'lâcher') return { name: 'drop' };
  if (name === 'compagnon' || name === 'pet') return { name: 'pet', trick: (rest[0] ?? '').toLowerCase() };
  if (name === 'aide' || name === 'help' || name === '?') return { name: 'help' };
  if (name === 'assis' || name === 'asseoir' || name === 'sit') return { name: 'sit' };
  if (name === 'allonge' || name === 'allongé' || name === 'couche' || name === 'couché') return { name: 'lie' };
  if (name === 'debout' || name === 'lever' || name === 'leve') return { name: 'stand' };
  if (name === 'reculons' || name === 'moonwalk') return { name: 'moonwalk' };
  if (name === 'pousser' || name === 'pousse') return { name: 'push', who: rest.join(' ').trim() };
  if (name === 'tirer' || name === 'tire') return { name: 'pull', who: rest.join(' ').trim() };
  return { name: 'unknown', typed: word.slice(0, 20) };
}

/** A dance lasts this long unless the player walks off or stops it. */
export const DANCE_MS = 30_000;
