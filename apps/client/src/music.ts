import { noteOf, stepMs, track, trackSteps, type Track } from '@coloxel/render';

/**
 * Plays the jukebox tunes (packages/render/src/jukebox.ts) with the browser's synthesiser. Nothing is downloaded:
 * a few oscillators and a burst of noise for the beat. The server says which tune and how long ago it started; here we
 * keep time with the audio clock and look a little ahead, so notes fall exactly on the beat.
 */
const KEY = 'coloxel.sound';
const LOOK_AHEAD = 0.35;
const midiHz = (m: number) => 440 * Math.pow(2, (m - 69) / 12);

export interface Music {
  /** Plays a tune from `elapsedMs` into it (the server's answer). 0 stops. */
  play(trackId: number, elapsedMs: number): void;
  stop(): void;
  muted(): boolean;
  setMuted(muted: boolean): void;
  destroy(): void;
}

export function createMusic(): Music {
  let ctx: AudioContext | null = null;
  let master: GainNode | null = null;
  let noise: AudioBuffer | null = null;
  let timer: number | null = null;
  let current: Track | null = null;
  let pending: { id: number; elapsed: number; at: number } | null = null;
  let t0 = 0; // audio-clock time at which the tune's step 0 started
  let nextStep = 0;
  let muted = false;
  try {
    muted = localStorage.getItem(KEY) === 'off';
  } catch {
    // Storage can be blocked: sound stays on.
  }

  const ensure = (): boolean => {
    if (ctx) return true;
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return false;
    ctx = new Ctor();
    master = ctx.createGain();
    master.gain.value = muted ? 0 : 0.16;
    master.connect(ctx.destination);
    noise = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 0.06), ctx.sampleRate);
    const data = noise.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    return true;
  };

  const tone = (type: OscillatorType, hz: number, at: number, length: number, volume: number) => {
    if (!ctx || !master) return;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.value = hz;
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.exponentialRampToValueAtTime(volume, at + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + Math.max(0.08, length));
    osc.connect(gain).connect(master);
    osc.start(at);
    osc.stop(at + Math.max(0.1, length) + 0.05);
  };

  const kick = (at: number) => {
    if (!ctx || !master) return;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.frequency.setValueAtTime(140, at);
    osc.frequency.exponentialRampToValueAtTime(42, at + 0.12);
    gain.gain.setValueAtTime(0.5, at);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.16);
    osc.connect(gain).connect(master);
    osc.start(at);
    osc.stop(at + 0.2);
  };

  const hat = (at: number) => {
    if (!ctx || !master || !noise) return;
    const src = ctx.createBufferSource();
    const filter = ctx.createBiquadFilter();
    const gain = ctx.createGain();
    src.buffer = noise;
    filter.type = 'highpass';
    filter.frequency.value = 6500;
    gain.gain.value = 0.12;
    src.connect(filter).connect(gain).connect(master);
    src.start(at);
  };

  /** How many steps a note lasts: itself and the holds ("-") that follow it. */
  const lengthAt = (line: string, i: number): number => {
    let n = 1;
    while (line[i + n] === '-') n++;
    return n;
  };

  const scheduleStep = (t: Track, step: number, at: number) => {
    const total = trackSteps(t);
    const k = ((step % total) + total) % total;
    const bar = Math.floor(k / 16), i = k % 16;
    const sec = stepMs(t) / 1000;
    const mel = t.melody[bar]!, bas = t.bass[bar]!;
    const m = noteOf(t, mel[i]!);
    if (m !== null) tone(t.lead, midiHz(m), at, lengthAt(mel, i) * sec * 0.95, 0.5);
    const b = noteOf(t, bas[i]!, -1);
    if (b !== null) tone('triangle', midiHz(b), at, lengthAt(bas, i) * sec * 0.95, 0.55);
    if (t.beat) {
      if (i % 8 === 0) kick(at);
      if (i % 2 === 1) hat(at);
    }
  };

  const pump = () => {
    if (!ctx || !current || ctx.state !== 'running') return;
    const sec = stepMs(current) / 1000;
    while (t0 + nextStep * sec < ctx.currentTime + LOOK_AHEAD) {
      const at = t0 + nextStep * sec;
      if (at >= ctx.currentTime - 0.02) scheduleStep(current, nextStep, Math.max(at, ctx.currentTime));
      nextStep++;
    }
  };

  const begin = (t: Track, elapsedMs: number) => {
    if (!ctx) return;
    current = t;
    const sec = stepMs(t) / 1000;
    t0 = ctx.currentTime - elapsedMs / 1000;
    nextStep = Math.max(0, Math.ceil(elapsedMs / 1000 / sec));
    if (timer === null) timer = window.setInterval(pump, 90);
    pump();
  };

  // Browsers keep sound off until the player has touched the page: the first touch starts what was asked.
  const unlock = () => {
    if (!ctx) return;
    void ctx.resume().then(() => {
      if (pending) {
        const p = pending;
        pending = null;
        const t = track(p.id);
        if (t) begin(t, p.elapsed + (performance.now() - p.at));
      }
    });
  };
  window.addEventListener('pointerdown', unlock);

  return {
    play(trackId, elapsedMs) {
      this.stop();
      const t = track(trackId);
      if (!t || !ensure() || !ctx) return;
      if (ctx.state === 'running') begin(t, elapsedMs);
      else {
        pending = { id: trackId, elapsed: elapsedMs, at: performance.now() };
        unlock();
      }
    },
    stop() {
      current = null;
      pending = null;
      if (timer !== null) {
        window.clearInterval(timer);
        timer = null;
      }
    },
    muted: () => muted,
    setMuted(value) {
      muted = value;
      try {
        localStorage.setItem(KEY, value ? 'off' : 'on');
      } catch {
        // Not remembered, still works for this visit.
      }
      if (master && ctx) master.gain.setTargetAtTime(value ? 0 : 0.16, ctx.currentTime, 0.05);
    },
    destroy() {
      this.stop();
      window.removeEventListener('pointerdown', unlock);
      void ctx?.close();
      ctx = null;
    },
  };
}
