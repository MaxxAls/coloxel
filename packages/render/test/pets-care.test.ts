import { describe, expect, it } from 'vitest';
import { CARE_THRESHOLD, FED_SPAN_MS, PET_TRICKS, careReadyAfterMs, petLevel, petMood, petNeed, xpForLevel } from '../src';

describe('companion care', () => {
  it('needs fall in a straight line with time and stop at zero', () => {
    expect(petNeed(0, FED_SPAN_MS)).toBe(100);
    expect(petNeed(FED_SPAN_MS / 2, FED_SPAN_MS)).toBe(50);
    expect(petNeed(FED_SPAN_MS * 5, FED_SPAN_MS)).toBe(0);
    // A clock going backwards never gives more than full.
    expect(petNeed(-1000, FED_SPAN_MS)).toBe(100);
  });

  it('care is ready exactly when the need drops under the threshold', () => {
    const wait = careReadyAfterMs(FED_SPAN_MS);
    expect(petNeed(wait, FED_SPAN_MS)).toBeLessThanOrEqual(CARE_THRESHOLD);
    expect(petNeed(wait - 60_000, FED_SPAN_MS)).toBeGreaterThan(CARE_THRESHOLD - 1);
  });

  it('is sad when either need is low, happy only when both are high', () => {
    expect(petMood(100, 100)).toBe('happy');
    expect(petMood(100, 10)).toBe('sad');
    expect(petMood(40, 90)).toBe('ok');
    expect(petMood(60, 60)).toBe('happy');
    expect(petMood(24, 100)).toBe('sad');
  });

  it('levels grow with experience, up to ten, and the thresholds agree with the levels', () => {
    expect(petLevel(0)).toBe(1);
    expect(petLevel(11)).toBe(1);
    expect(petLevel(12)).toBe(2);
    expect(petLevel(10_000_000)).toBe(10);
    for (let level = 1; level <= 10; level++) {
      expect(petLevel(xpForLevel(level)), `level ${level}`).toBe(level);
      if (level > 1) expect(petLevel(xpForLevel(level) - 1), `just under ${level}`).toBe(level - 1);
    }
  });

  it('teaches the easy tricks first', () => {
    expect(PET_TRICKS.filter((t) => t.level === 1).map((t) => t.key)).toEqual(['assis', 'viens']);
    expect(new Set(PET_TRICKS.map((t) => t.key)).size).toBe(PET_TRICKS.length);
  });
});
