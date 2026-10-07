// Placeholder avatar pixels, shared by the room and the sign-in scene.
export const AVATAR = [
  '  hhhhh  ', ' hhhhhhh ', ' hsssssh ', ' ssesess ', ' sssssss ', '  sssss  ',
  '   sss   ', '  ttttt  ', ' ttttttt ', 'sttttttts', 'sttttttts', 's ttttt s',
  '  ppppp  ', '  pp pp  ', '  pp pp  ', '  pp pp  ', '  pp pp  ', ' kkk kkk ',
];

export const AVATAR_COLORS: Record<string, number> = {
  h: 0x4a2c1a, s: 0xf1c27d, e: 0x222222, t: 0xe2483d, p: 0x2b4a8b, k: 0x1a1a1a,
};

/** Draws the avatar on a canvas, optionally with a different shirt color. */
export function avatarCanvas(shirt?: number, hair?: number): HTMLCanvasElement {
  const cv = document.createElement('canvas');
  cv.width = AVATAR[0]!.length;
  cv.height = AVATAR.length;
  const ctx = cv.getContext('2d')!;
  AVATAR.forEach((row, y) =>
    [...row].forEach((ch, x) => {
      const color = ch === 't' && shirt !== undefined ? shirt : ch === 'h' && hair !== undefined ? hair : AVATAR_COLORS[ch];
      if (color === undefined) return;
      ctx.fillStyle = `#${color.toString(16).padStart(6, '0')}`;
      ctx.fillRect(x, y, 1, 1);
    }),
  );
  return cv;
}
