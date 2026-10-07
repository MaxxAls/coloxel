import { containsBannedWord } from '../auth/rules';

export type FilterReason = 'insult' | 'link' | 'email' | 'phone' | 'social';

export type FilterResult = { ok: true } | { ok: false; reason: FilterReason };

// Player-written text that other players read (apartment names, chat) must not
// carry insults, nor a way to reach the player outside the game: links, emails,
// phone numbers, social network handles. The filter errs on the side of
// blocking; it is a first line, moderation (reports, staff panel) is the second.

const TLDS =
  'com|fr|net|org|io|gg|me|co|app|xyz|info|biz|tv|ly|be|ch|de|uk|us|ca|eu|ru|cc|link|site|online|shop|store|dev|page|club|live|fun|top|vip|tk|ml|ga|cf|gq';

const NETWORKS =
  'snap|snapchat|insta|instagram|tiktok|tik tok|discord|whatsapp|telegram|facebook|messenger|twitter|youtube|twitch|skype|kik|onlyfans|reddit|pinterest';

const DIGIT_WORDS =
  'zero|un|une|deux|trois|quatre|cinq|six|sept|huit|neuf|dix|onze|douze|treize|quatorze|quinze|seize|vingt|trente|quarante|cinquante|soixante|septante|huitante|nonante|cent|one|two|three|four|five|seven|eight|nine|ten';

const strip = (text: string) =>
  text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');

// Letters that stand for others when people try to get around a filter.
const unLeet = (text: string) => text.replace(/0/g, 'o').replace(/[1!|]/g, 'i').replace(/3/g, 'e').replace(/[4]/g, 'a').replace(/[5$]/g, 's').replace(/7/g, 't');

function hasEmail(text: string): boolean {
  if (/[a-z0-9._%+-]+\s*@\s*[a-z0-9-]+\s*\.\s*[a-z]{2,}/.test(text)) return true;
  // "jean arobase gmail point com", "jean at gmail dot com".
  return /\b(arobase|arrobase|at)\b\s*[a-z0-9-]+\s*\b(point|dot)\b/.test(text);
}

function hasLink(text: string): boolean {
  if (/(https?:|ftp:|www\s*\.)/.test(text)) return true;
  // name.tld, with optional spaces around the dot: "exemple . com", "exemple(.)com", "exemple dot com".
  const dot = String.raw`(?:\s*\.\s*|\s*\(\s*\.?\s*\)\s*|\s*\[\s*\.?\s*\]\s*|\s+(?:point|dot)\s+)`;
  return new RegExp(String.raw`[a-z0-9-]{2,}${dot}(?:${TLDS})(?![a-z])`).test(text) || /\bdiscord\s*\.?\s*gg\b/.test(text);
}

function hasPhone(text: string): boolean {
  // Digits with common separators: 06 12 34 56 78, +33 6.12.34.56.78, 0612345678.
  if (/(?:\d[\s.\-_/()]*){8,}/.test(text)) return true;
  // Digits written as words: "zero six douze trente quatre ...".
  const words = text.split(/[^a-z]+/).filter(Boolean);
  let run = 0;
  for (const w of words) {
    run = new RegExp(`^(?:${DIGIT_WORDS})$`).test(w) ? run + 1 : 0;
    if (run >= 6) return true;
  }
  return false;
}

function hasSocial(text: string): boolean {
  if (/(^|[\s(])@[a-z0-9_.]{2,}/.test(text)) return true;
  const flat = text.replace(/[^a-z0-9]/g, '');
  const names = NETWORKS.split('|').map((n) => n.replace(/ /g, ''));
  return names.some((n) => flat.includes(n));
}

export function filterText(input: string): FilterResult {
  const text = strip(input);
  const leet = unLeet(text);
  if (containsBannedWord(input) || containsBannedWord(leet)) return { ok: false, reason: 'insult' };
  if (hasEmail(text)) return { ok: false, reason: 'email' };
  if (hasLink(text) || hasLink(leet)) return { ok: false, reason: 'link' };
  if (hasPhone(text)) return { ok: false, reason: 'phone' };
  if (hasSocial(text) || hasSocial(leet)) return { ok: false, reason: 'social' };
  return { ok: true };
}

export const FILTER_MESSAGES: Record<FilterReason, string> = {
  insult: 'Ce texte n’est pas autorisé.',
  link: 'Les liens ne sont pas autorisés.',
  email: 'Les adresses e-mail ne sont pas autorisées.',
  phone: 'Les numéros de téléphone ne sont pas autorisés.',
  social: 'Les pseudos de réseaux sociaux ne sont pas autorisés.',
};
