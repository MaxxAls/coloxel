import { describe, expect, it } from 'vitest';
import { CATALOGUE, HAND_ITEMS, handItem } from '../src';

describe('hand items', () => {
  it('have distinct ids from 1 and a palette colour for every character of the icon', () => {
    expect(new Set(HAND_ITEMS.map((h) => h.id)).size).toBe(HAND_ITEMS.length);
    expect(new Set(HAND_ITEMS.map((h) => h.key)).size).toBe(HAND_ITEMS.length);
    for (const h of HAND_ITEMS) {
      expect(h.id, h.key).toBeGreaterThanOrEqual(1);
      expect(h.id, h.key).toBeLessThanOrEqual(255);
      let filled = 0;
      for (const row of h.rows) {
        for (const ch of row) {
          if (ch === ' ') continue;
          filled++;
          expect(h.palette[ch], `${h.key} uses "${ch}"`).toBeDefined();
          expect(h.palette[ch], h.key).toMatch(/^#[0-9a-f]{6}([0-9a-f]{2})?$/i);
        }
      }
      expect(filled, h.key).toBeGreaterThan(10);
    }
  });

  it('are what every dispenser of the catalogue serves', () => {
    const vendors = CATALOGUE.filter((e) => e.vendor);
    expect(vendors.length).toBeGreaterThan(0);
    for (const v of vendors) expect(handItem(v.vendor!), v.key).toBeDefined();
    expect(handItem(0)).toBeUndefined();
  });
});
