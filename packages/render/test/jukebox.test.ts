import { describe, expect, it } from 'vitest';
import { TRACKS, noteOf, stepMs, track, trackSteps } from '../src';

describe('jukebox tunes', () => {
  it('have distinct ids and names, and the same number of bars in melody and bass', () => {
    expect(new Set(TRACKS.map((t) => t.id)).size).toBe(TRACKS.length);
    expect(new Set(TRACKS.map((t) => t.name)).size).toBe(TRACKS.length);
    for (const t of TRACKS) {
      expect(t.id, t.name).toBeGreaterThanOrEqual(1);
      expect(t.melody.length, t.name).toBe(t.bass.length);
      expect(trackSteps(t), t.name).toBe(t.melody.length * 16);
    }
  });

  it('write every bar with sixteen steps made of notes, rests and holds only', () => {
    for (const t of TRACKS) {
      for (const bar of [...t.melody, ...t.bass]) {
        expect(bar, `${t.name}: "${bar}"`).toMatch(/^[1-9.\-]{16}$/);
      }
      // A hold needs a note before it in the same line.
      for (const line of [t.melody.join(''), t.bass.join('')]) expect(line.startsWith('-'), t.name).toBe(false);
      expect(t.melody.join('')).toMatch(/[1-9]/);
    }
  });

  it('turn digits into notes of the scale, a second octave above the fifth degree', () => {
    const t = track(1)!;
    expect(noteOf(t, '1')).toBe(t.root);
    expect(noteOf(t, '3')).toBe(t.root + t.scale[2]);
    expect(noteOf(t, '6')).toBe(t.root + 12);
    expect(noteOf(t, '9')).toBe(t.root + t.scale[3] + 12);
    expect(noteOf(t, '1', -1)).toBe(t.root - 12);
    for (const ch of ['.', '-', '0', 'x', '']) expect(noteOf(t, ch), JSON.stringify(ch)).toBeNull();
  });

  it('keep a tempo that gives a steady, musical step', () => {
    for (const t of TRACKS) {
      expect(t.bpm).toBeGreaterThanOrEqual(60);
      expect(t.bpm).toBeLessThanOrEqual(160);
      expect(stepMs(t)).toBeCloseTo(15000 / t.bpm, 5);
    }
    expect(track(0)).toBeUndefined();
    expect(track(99)).toBeUndefined();
  });
});
