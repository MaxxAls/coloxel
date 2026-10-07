import { describe, expect, it } from 'vitest';
import { filterText, type FilterReason } from '../src/moderation/text-filter';

const blocked = (reason: FilterReason, texts: string[]) =>
  it.each(texts)(`blocks as ${reason}: %s`, (text) => {
    expect(filterText(text)).toEqual({ ok: false, reason });
  });

describe('text filter', () => {
  describe('lets honest text through', () => {
    it.each([
      'Chez Zoé',
      'Le salon de Max',
      'Bienvenue chez moi !',
      'J’ai 3 chats et 2 lampes',
      'Appart n°12, étage 4',
      'On se retrouve à 18h30 ?',
      'Super objet, bravo.',
      'Le 1er étage, porte 2',
      'rendez-vous dans 10 minutes',
      'Pixel & Co',
      'Café.Crème',
      'ça coûte 5 pixels, 10 si tu veux',
      'mon canapé est trop beau',
      'j’ai 12 ans, 3 chats, 25 euros et 1 lapin',
    ])('%s', (text) => {
      expect(filterText(text)).toEqual({ ok: true });
    });
  });

  blocked('link', [
    'va sur https://exemple.com',
    'http://truc.fr/page',
    'www.monsite.net',
    'exemple.com',
    'monsite . fr',
    'monsite(.)io',
    'monsite dot com',
    'MonSite.COM',
    'discord.gg/abcdef',
    'regarde bit.ly/xyz',
    'ex3mple.c0m',
  ]);

  blocked('email', [
    'jean@gmail.com',
    'jean @ gmail . com',
    'jean.dupont+jeu@outlook.fr',
    'jean arobase gmail point com',
    'jean at gmail dot com',
  ]);

  blocked('phone', [
    '0612345678',
    '06 12 34 56 78',
    '06.12.34.56.78',
    '+33 6 12 34 56 78',
    'appelle le 06-12-34-56-78',
    '0 6 1 2 3 4 5 6 7 8',
    'zero six douze trente quatre cinquante six',
    '(06) 12 34 56 78',
  ]);

  blocked('social', [
    '@jeandu75',
    'mon insta c’est jean',
    'Ajoute moi sur Snap',
    'snapchat: jean',
    'tiktok jean_75',
    'retrouve moi sur d i s c o r d',
    'whatsapp moi',
    'I N S T A',
  ]);

  blocked('insult', ['espèce de connard', 'sale p u t e', 'N A Z I', 'conn4rd', 'fdp']);

  it('reports the most specific reason first', () => {
    expect(filterText('connard@gmail.com')).toEqual({ ok: false, reason: 'insult' });
    expect(filterText('jean@gmail.com')).toEqual({ ok: false, reason: 'email' });
  });
});
