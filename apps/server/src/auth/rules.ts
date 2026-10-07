import { z } from 'zod';
import { hasExtraBannedWord } from '../moderation/words';

export const MIN_AGE = 18;

// Placeholder list for phase 1 alpha; step 4 reuses it for creation texts.
const BANNED_WORDS = ['nazi', 'hitler', 'pute', 'salope', 'connard', 'enculé', 'nigger', 'fdp'];

function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]/g, '');
}

export function containsBannedWord(text: string): boolean {
  const flat = normalize(text);
  return BANNED_WORDS.some((w) => flat.includes(normalize(w))) || hasExtraBannedWord(flat);
}

/** Parse a strict YYYY-MM-DD calendar date, or null. */
export function parseBirthDate(value: string): { y: number; m: number; d: number } | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const [y, m, d] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) return null;
  return { y, m, d };
}

export function ageOn(birth: { y: number; m: number; d: number }, now: Date): number {
  let age = now.getUTCFullYear() - birth.y;
  const beforeBirthday =
    now.getUTCMonth() + 1 < birth.m || (now.getUTCMonth() + 1 === birth.m && now.getUTCDate() < birth.d);
  if (beforeBirthday) age -= 1;
  return age;
}

export const registerSchema = z.object({
  email: z.string().trim().max(254).email('Adresse email invalide'),
  password: z.string().min(8, 'Le mot de passe doit faire au moins 8 caractères').max(128),
  nickname: z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9_-]{3,20}$/, 'Le pseudo fait 3 à 20 caractères : lettres, chiffres, _ et -'),
  birthDate: z.string(),
});

export const loginSchema = z.object({
  email: z.string().trim().max(254),
  password: z.string().max(128),
});
