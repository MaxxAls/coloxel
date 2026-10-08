/**
 * Things an avatar can hold in its hand: a drink from a dispenser, a flower. The server says which (a number in the
 * player's state); every client draws the same small icon, defined here as rows of characters and a palette.
 */
export interface HandItem {
  /** What the server stores: 1 and up. 0 is empty hands. */
  id: number;
  key: string;
  /** Said to the player: « Tu tiens … ». */
  name: string;
  /** Rows of the icon; a space is transparent, any other character is a colour of the palette. */
  rows: readonly string[];
  palette: Readonly<Record<string, string>>;
}

export const HAND_ITEMS: readonly HandItem[] = [
  {
    id: 1, key: 'cafe', name: 'un café',
    rows: [
      '  w  w   ',
      '   w  w  ',
      ' ccccc   ',
      ' cbbbc h ',
      ' cbbbc h ',
      ' ccccch  ',
      '  ccc    ',
    ],
    palette: { w: '#ffffffaa', c: '#f4efe6', b: '#6a3e22', h: '#d9d0c0' },
  },
  {
    id: 2, key: 'jus', name: 'un jus d’orange',
    rows: [
      '     s   ',
      '    s    ',
      ' ggggggg ',
      '  ooooo  ',
      '  ooooo  ',
      '  ooooo  ',
      '   ooo   ',
    ],
    palette: { s: '#e0503a', g: '#d8f0f4', o: '#ff9a2a' },
  },
  {
    id: 3, key: 'glace', name: 'une glace',
    rows: [
      '  ppp   ',
      ' ppppp  ',
      ' ppsps  ',
      '  ppp   ',
      '  kkk   ',
      '   k    ',
      '   k    ',
    ],
    palette: { p: '#ffb6d0', s: '#fff0f6', k: '#d9a35a' },
  },
  {
    id: 4, key: 'the', name: 'un thé glacé',
    rows: [
      '    s   ',
      '   s    ',
      ' ggggg  ',
      ' tttte  ',
      ' ttlte  ',
      ' tttte  ',
      '  ttt   ',
    ],
    palette: { s: '#4fa86a', g: '#d8f0f4', t: '#c9803a', l: '#ffe08a', e: '#b36a2a' },
  },
  {
    id: 5, key: 'cookie', name: 'un cookie',
    rows: [
      '  ccc   ',
      ' cdcccc ',
      ' ccccdc ',
      ' cdcccc ',
      '  ccdc  ',
    ],
    palette: { c: '#d9a35a', d: '#5a3a22' },
  },
  {
    id: 6, key: 'fleur', name: 'une fleur',
    rows: [
      '  p p   ',
      ' ppypp  ',
      '  pyp   ',
      '   g    ',
      '  gg    ',
      '   g    ',
      '   g    ',
    ],
    palette: { p: '#ff7aa8', y: '#ffe05a', g: '#3f9a46' },
  },
];

export const handItem = (id: number): HandItem | undefined => HAND_ITEMS.find((h) => h.id === id);
