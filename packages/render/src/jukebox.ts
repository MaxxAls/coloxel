/**
 * The jukebox plays tunes written for Coloxel as data: a melody and a bass line over a pentatonic scale, a tempo,
 * a sound for each. The client turns them into sound with the browser's synthesiser (no audio files, nothing
 * borrowed). The server only says which tune plays and since when.
 *
 * A line is a string of steps, sixteen per bar: a digit 1 to 9 is a note of the scale (1 to 5 the first octave,
 * 6 to 9 the second), "." is a rest, "-" holds the note before it.
 */
export interface Track {
  /** What the server stores in the room: 1 and up, 0 is silence. */
  id: number;
  name: string;
  bpm: number;
  /** MIDI note of the scale's root (60 is middle C). */
  root: number;
  /** Semitones above the root of the five notes of the scale (a pentatonic scale). */
  scale: readonly [number, number, number, number, number];
  lead: 'sine' | 'triangle' | 'square' | 'sawtooth';
  /** One string per bar. */
  melody: readonly string[];
  bass: readonly string[];
  /** A soft beat under the tune. */
  beat: boolean;
}

const MAJOR = [0, 2, 4, 7, 9] as const;
const MINOR = [0, 3, 5, 7, 10] as const;

export const TRACKS: readonly Track[] = [
  {
    id: 1, name: 'Matin de brume', bpm: 84, root: 60, scale: MAJOR, lead: 'triangle', beat: false,
    melody: ['3...5...6...5...', '3...2...1.......', '2...3...5...6...', '5...3...2...1...'],
    bass: ['1.......3.......', '1.......3.......', '2.......4.......', '1.......5.......'],
  },
  {
    id: 2, name: 'Course en pixels', bpm: 132, root: 62, scale: MAJOR, lead: 'square', beat: true,
    melody: ['5.65.3.2.3.5.6.8', '9.8.6.5.6.5.3.2', '3.53.2.1.2.3.5.6', '5.3.2.1.2.3.5.-'],
    bass: ['1.1.1.1.1.1.1.1.', '4.4.4.4.4.4.4.4.', '5.5.5.5.3.3.3.3.', '1.1.1.1.5.5.1.1.'],
  },
  {
    id: 3, name: 'Cabane au toit', bpm: 96, root: 57, scale: MINOR, lead: 'triangle', beat: true,
    melody: ['1..3.5..6..5.3..', '2..3.5..3..2.1..', '1..3.5..8..6.5..', '6..5.3..2..1....'],
    bass: ['1...1...3...3...', '2...2...4...4...', '1...1...3...3...', '5...5...1.......'],
  },
  {
    id: 4, name: 'Nuit des lucioles', bpm: 72, root: 64, scale: MAJOR, lead: 'sine', beat: false,
    melody: ['1.3.5.8.5.3.1...', '2.4.5.7.5.4.2...', '3.5.6.8.6.5.3...', '5.3.2.1.-.......'],
    bass: ['1...............', '4...............', '3...............', '1...5...1.......'],
  },
];

export const track = (id: number): Track | undefined => TRACKS.find((t) => t.id === id);

/** Steps in one loop of a track. */
export const trackSteps = (t: Track): number => t.melody.length * 16;
/** Length of one step in milliseconds (sixteenth notes). */
export const stepMs = (t: Track): number => 60000 / t.bpm / 4;
/** MIDI note of a digit of a line, or null for a rest or a hold. */
export function noteOf(t: Track, ch: string, octaveShift = 0): number | null {
  const n = Number(ch);
  if (!Number.isInteger(n) || n < 1 || n > 9) return null;
  const idx = n - 1;
  return t.root + t.scale[idx % 5]! + 12 * Math.floor(idx / 5) + 12 * octaveShift;
}
