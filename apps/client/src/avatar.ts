// Chibi avatar: big round head, rosy cheeks, sparkly eyes. Drawn from a
// character grid, outlined with the style guide's 1 px #1b1530, in a few
// variations picked from the player's id so neighbours look different.

export const OUTLINE = 0x1b1530;

export interface Look {
  skin: number;
  hair: number;
  /** 0 short, 1 long, 2 spiky. */
  hairStyle: 0 | 1 | 2;
  shirt: number;
  pants: number;
}

export type Facing = 'front' | 'back';
/** 0 standing, 1 and 2 the two steps of a walk. */
export type Frame = 0 | 1 | 2;

const SKINS = [0xf6d3b3, 0xe8b88a, 0xc98f5e, 0x9a6a43, 0x6b4427];
const HAIRS = [0x2a1a14, 0x5a3420, 0xb5651d, 0xe0b04a, 0xd04a6a, 0x4a6fd0, 0x7d4fc9, 0x3aa17e];
const SHIRTS = [0xe2483d, 0x35b57c, 0xf2c230, 0x4a8fe2, 0xb36bd6, 0xff8fb1, 0xf08a3c, 0x4fc3c3];
const PANTS = [0x2b4a8b, 0x3b3366, 0x5a4a3a, 0x2f5d50, 0x6b6b7a];

export const DEFAULT_LOOK: Look = { skin: SKINS[0]!, hair: HAIRS[1]!, hairStyle: 0, shirt: SHIRTS[0]!, pants: PANTS[0]! };

/** Stable pseudo-random look from any string (a player id). */
export function lookFor(seed: string): Look {
  let h = 2166136261;
  for (let k = 0; k < seed.length; k++) h = Math.imul(h ^ seed.charCodeAt(k), 16777619);
  const pick = <T>(list: readonly T[]) => {
    h = Math.imul(h ^ (h >>> 15), 2246822507) >>> 0;
    h = Math.imul(h ^ (h >>> 13), 3266489909) >>> 0;
    return list[((h ^ (h >>> 16)) >>> 0) % list.length]!;
  };
  return {
    skin: pick(SKINS),
    hair: pick(HAIRS),
    hairStyle: pick([0, 1, 2] as const),
    shirt: pick(SHIRTS),
    pants: pick(PANTS),
  };
}

// Legend: h hair, H hair light, s skin, c cheek, m mouth, e eye, w eye shine,
// t shirt, T shirt shade, b belt, p pants, k shoes.
const HEAD_FRONT = [
  '...hhhh...',
  '..hHHhhh..',
  '.hhhhhhhh.',
  '.hhhhhhhh.',
  'hhsssssshh',
  'hsewssewsh',
  'hseesseesh',
  'hcssmmssch',
  '..ssssss..',
];
const HEAD_BACK = [
  '...hhhh...',
  '..hHHhhh..',
  '.hhhhhhhh.',
  '.hhhhhhhh.',
  'hhhhhhhhhh',
  'hhhhhhhhhh',
  'hhhhhhhhhh',
  '.hhhhhhhh.',
  '..hhssss..',
];
const BODY = [
  '..tttttt..',
  '.tttttttt.',
  'tttttttttt',
  'tttttttttt',
  'sttTTTTtts',
  '.bbbbbbbb.',
  '..pppppp..',
];
const LEGS: Record<Frame, string[]> = {
  0: ['..pp..pp..', '..pp..pp..', '.kkk..kkk.'],
  1: ['..pp..pp..', '..kk..pp..', '......kkk.'],
  2: ['..pp..pp..', '..pp..kk..', '.kkk......'],
};

function shade(color: number, factor: number): number {
  const ch = (shift: number) => {
    const c = (color >> shift) & 255;
    const v = factor < 0 ? c * (1 + factor) : c + (255 - c) * factor;
    return Math.max(0, Math.min(255, Math.round(v)));
  };
  return (ch(16) << 16) | (ch(8) << 8) | ch(0);
}

function buildGrid(look: Look, facing: Facing, frame: Frame): string[] {
  const head = (facing === 'front' ? HEAD_FRONT : HEAD_BACK).map((row) => row.split(''));
  if (look.hairStyle === 1) {
    // Long hair falls past the cheeks.
    for (let y = 4; y <= 8; y++) {
      head[y]![0] = 'h';
      head[y]![9] = 'h';
    }
    if (facing === 'back') head[8]!.fill('h', 1, 9);
  } else if (look.hairStyle === 2) {
    head[0] = '..h.hh.h..'.split('');
  }
  return [...head.map((r) => r.join('')), ...BODY, ...LEGS[frame]];
}

function colorOf(ch: string, look: Look): number | undefined {
  switch (ch) {
    case 'h': return look.hair;
    case 'H': return shade(look.hair, 0.28);
    case 's': return look.skin;
    case 'c': return 0xf08a8a;
    case 'm': return 0xb5483f;
    case 'e': return OUTLINE;
    case 'w': return 0xffffff;
    case 't': return look.shirt;
    case 'T': return shade(look.shirt, -0.2);
    case 'b': return shade(look.pants, -0.35);
    case 'p': return look.pants;
    case 'k': return 0x2a2140;
    default: return undefined;
  }
}

export const AVATAR_W = 12;
export const AVATAR_H = 21;

/** RGBA pixels of one frame, outline included: AVATAR_W x AVATAR_H. No DOM needed. */
export function avatarPixels(look: Look, facing: Facing = 'front', frame: Frame = 0): Uint8ClampedArray {
  const grid = buildGrid(look, facing, frame);
  const data = new Uint8ClampedArray(AVATAR_W * AVATAR_H * 4);
  const put = (x: number, y: number, color: number) => {
    const o = (y * AVATAR_W + x) * 4;
    data[o] = (color >> 16) & 255;
    data[o + 1] = (color >> 8) & 255;
    data[o + 2] = color & 255;
    data[o + 3] = 255;
  };
  const filled = (x: number, y: number) => {
    const ch = grid[y]?.[x];
    return ch !== undefined && colorOf(ch, look) !== undefined;
  };
  // Outline: every empty pixel touching a filled one (4-neighbourhood), then the body on top.
  for (let y = -1; y <= grid.length; y++) {
    for (let x = -1; x <= 10; x++) {
      if (filled(x, y)) continue;
      if (filled(x - 1, y) || filled(x + 1, y) || filled(x, y - 1) || filled(x, y + 1)) put(x + 1, y + 1, OUTLINE);
    }
  }
  grid.forEach((row, y) =>
    [...row].forEach((ch, x) => {
      const color = colorOf(ch, look);
      if (color !== undefined) put(x + 1, y + 1, color);
    }),
  );
  return data;
}

/** One frame of the avatar on a canvas. */
export function avatarFrame(look: Look, facing: Facing = 'front', frame: Frame = 0): HTMLCanvasElement {
  const cv = document.createElement('canvas');
  cv.width = AVATAR_W;
  cv.height = AVATAR_H;
  cv.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(avatarPixels(look, facing, frame)), AVATAR_W, AVATAR_H), 0, 0);
  return cv;
}

/** Standing front view, optionally with another shirt or hair color (used by the sign-in scene). */
export function avatarCanvas(shirt?: number, hair?: number): HTMLCanvasElement {
  return avatarFrame({ ...DEFAULT_LOOK, shirt: shirt ?? DEFAULT_LOOK.shirt, hair: hair ?? DEFAULT_LOOK.hair });
}
