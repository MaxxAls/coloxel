import { describe, expect, it } from 'vitest';
import { CLOTH_COLORS, DEFAULT_LOOK, LOOK_ITEMS, SLOTS, lookFor, paidPieces, parseLook } from '../src';

describe('wardrobe', () => {
  it('numbers every piece by its position, with free basics in each slot', () => {
    for (const slot of SLOTS) {
      LOOK_ITEMS[slot].forEach((piece, k) => {
        expect(piece.id, `${slot} ${piece.name}`).toBe(k);
        expect(piece.price).toBeGreaterThanOrEqual(0);
      });
      expect(LOOK_ITEMS[slot].some((p) => p.price === 0), slot).toBe(true);
    }
  });

  it('accepts the default look and every pseudo-random one, which wear only free pieces', () => {
    expect(parseLook(DEFAULT_LOOK)).toEqual(DEFAULT_LOOK);
    expect(paidPieces(DEFAULT_LOOK)).toEqual([]);
    for (let k = 0; k < 200; k++) {
      const look = lookFor(`player-${k}`);
      expect(parseLook(look), `player-${k}`).toEqual(look);
      expect(paidPieces(look)).toEqual([]);
    }
    expect(lookFor('abc')).toEqual(lookFor('abc'));
    expect(new Set(Array.from({ length: 40 }, (_, k) => JSON.stringify(lookFor(`p${k}`)))).size).toBeGreaterThan(30);
  });

  it('refuses anything that is not exactly a look made of in-range integers', () => {
    const bad: unknown[] = [
      null,
      'look',
      [],
      {},
      { ...DEFAULT_LOOK, extra2: 1 },
      { ...DEFAULT_LOOK, skin: -1 },
      { ...DEFAULT_LOOK, skin: 99 },
      { ...DEFAULT_LOOK, hair: 1.5 },
      { ...DEFAULT_LOOK, top: '1' },
      { ...DEFAULT_LOOK, topColor: CLOTH_COLORS.length },
      { ...DEFAULT_LOOK, hat: Number.NaN },
    ];
    for (const input of bad) expect(parseLook(input), JSON.stringify(input)).toBeNull();
    const { skin: _skin, ...missing } = DEFAULT_LOOK;
    expect(parseLook(missing)).toBeNull();
  });

  it('lists the pieces that must be owned', () => {
    const look = { ...DEFAULT_LOOK, hat: 3, top: 5, hair: 2 };
    expect(paidPieces(look).map((p) => `${p.slot}:${p.id}`)).toEqual(['top:5', 'hat:3']);
  });
});
