// Every interface sound, made on the spot with the Web Audio API: no sound files. Each recipe
// is a few tones (oscillators) and bursts of filtered noise, shaped by quick volume envelopes.
import type { Sound } from './game-sounds';

interface Tone {
  /** Oscillator shape: sine is soft, triangle a little brighter, square buzzy. */
  type?: OscillatorType;
  /** Pitch in Hz at the start, and at the end if it slides. */
  freq: number;
  to?: number;
  /** Seconds after the sound starts. */
  at?: number;
  dur: number;
  gain: number;
}

interface Noise {
  /** The band of the noise that is heard (Hz), sliding to `to`: a rising band swishes up. */
  freq: number;
  to?: number;
  /** Narrowness of the band; higher is more whistly. */
  q?: number;
  filter?: BiquadFilterType;
  at?: number;
  dur: number;
  gain: number;
}

let noiseBuffer: AudioBuffer | null = null;

/** One second of white noise, made once and reused. */
function whiteNoise(audio: AudioContext): AudioBuffer {
  if (noiseBuffer && noiseBuffer.sampleRate === audio.sampleRate) return noiseBuffer;
  noiseBuffer = audio.createBuffer(1, audio.sampleRate, audio.sampleRate);
  const data = noiseBuffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  return noiseBuffer;
}

/** A volume envelope: a near-instant rise, then an exponential fall to silence over `dur`. */
function envelope(audio: AudioContext, out: AudioNode, start: number, dur: number, gain: number): GainNode {
  const env = audio.createGain();
  env.gain.setValueAtTime(0.0001, start);
  env.gain.exponentialRampToValueAtTime(gain, start + Math.min(0.008, dur / 4));
  env.gain.exponentialRampToValueAtTime(0.0001, start + dur);
  env.connect(out);
  return env;
}

function tone(audio: AudioContext, out: AudioNode, t0: number, { type = 'sine', freq, to, at = 0, dur, gain }: Tone) {
  const start = t0 + at;
  const osc = audio.createOscillator();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, start);
  if (to) osc.frequency.exponentialRampToValueAtTime(to, start + dur);
  osc.connect(envelope(audio, out, start, dur, gain));
  osc.start(start);
  osc.stop(start + dur + 0.02);
}

function noise(audio: AudioContext, out: AudioNode, t0: number, { freq, to, q = 1, filter = 'bandpass', at = 0, dur, gain }: Noise) {
  const start = t0 + at;
  const src = audio.createBufferSource();
  src.buffer = whiteNoise(audio);
  const band = audio.createBiquadFilter();
  band.type = filter;
  band.Q.value = q;
  band.frequency.setValueAtTime(freq, start);
  if (to) band.frequency.exponentialRampToValueAtTime(to, start + dur);
  src.connect(band).connect(envelope(audio, out, start, dur, gain));
  src.start(start, Math.random() * 0.5);
  src.stop(start + dur + 0.02);
}

/** Notes in Hz, for the chimes. */
const C5 = 523.25, E5 = 659.25, G5 = 783.99, A5 = 880, B5 = 987.77, C6 = 1046.5, E6 = 1318.5, G4 = 392, E4 = 329.63, C4 = 261.63;

/** Each sound's parts. Gains are set against each other here; the player's volume scales them all. */
const RECIPES: Record<Sound, { tones?: Tone[]; noise?: Noise[] }> = {
  // A short "tsh": a puff of high noise, like a closed hi-hat.
  click: { noise: [{ freq: 6000, filter: 'highpass', dur: 0.06, gain: 0.3 }] },
  // Two notes up: yes.
  confirm: { tones: [{ type: 'triangle', freq: E5, dur: 0.09, gain: 0.25 }, { type: 'triangle', freq: B5, at: 0.07, dur: 0.16, gain: 0.25 }] },
  // A short fall: back out.
  cancel: { tones: [{ type: 'triangle', freq: 620, to: 360, dur: 0.12, gain: 0.22 }] },
  // A bright ping with a soft overtone.
  select: { tones: [{ freq: E6, dur: 0.12, gain: 0.18 }, { freq: E6 * 1.5, dur: 0.08, gain: 0.06 }] },
  // Barely there, since it plays on every hover across the hand's fan. Low, so it doesn't get shrill.
  hover: { tones: [{ freq: 900, dur: 0.035, gain: 0.07 }] },
  // A low double buzz, softened so it isn't harsh.
  error: { tones: [{ type: 'square', freq: 140, dur: 0.07, gain: 0.14 }, { type: 'square', freq: 140, at: 0.1, dur: 0.09, gain: 0.14 }] },
  // A deep swish up, for a click on the empty table. A lower band carries less of the noise, hence the gain.
  board: { noise: [{ freq: 350, to: 1300, q: 1.5, dur: 0.13, gain: 1 }] },
  // Swish down onto the table.
  release: { noise: [{ freq: 3000, to: 800, q: 1.5, dur: 0.13, gain: 0.45 }] },
  // A soft two-tone question.
  decision: { tones: [{ freq: G5, dur: 0.12, gain: 0.16 }, { freq: B5, at: 0.11, dur: 0.22, gain: 0.16 }] },
  // A bell: a note with a few inharmonic partials, ringing out.
  turn: {
    tones: [
      { freq: A5, dur: 0.9, gain: 0.2 },
      { freq: A5 * 2.76, dur: 0.45, gain: 0.05 },
      { freq: A5 * 5.4, dur: 0.2, gain: 0.025 },
    ],
  },
  // A heavy, low hit with a crunch of noise.
  damage: { tones: [{ freq: 150, to: 45, dur: 0.25, gain: 0.45 }], noise: [{ freq: 600, filter: 'lowpass', dur: 0.12, gain: 0.25 }] },
  // A quick rising sparkle.
  'life-gain': {
    tones: [
      { freq: C6, dur: 0.12, gain: 0.12 },
      { freq: E6, at: 0.06, dur: 0.12, gain: 0.12 },
      { freq: G5 * 2, at: 0.12, dur: 0.25, gain: 0.12 },
    ],
  },
  // Arpeggio up, the last note held.
  win: {
    tones: [
      { type: 'triangle', freq: C5, dur: 0.14, gain: 0.22 },
      { type: 'triangle', freq: E5, at: 0.12, dur: 0.14, gain: 0.22 },
      { type: 'triangle', freq: G5, at: 0.24, dur: 0.14, gain: 0.22 },
      { type: 'triangle', freq: C6, at: 0.36, dur: 0.7, gain: 0.25 },
    ],
  },
  // Slow and down.
  lose: {
    tones: [
      { type: 'triangle', freq: G4, dur: 0.3, gain: 0.22 },
      { type: 'triangle', freq: E4, at: 0.25, dur: 0.3, gain: 0.22 },
      { type: 'triangle', freq: C4, at: 0.5, dur: 0.8, gain: 0.24 },
    ],
  },
  // A light flick of a card off the library.
  draw: { noise: [{ freq: 1800, to: 3500, q: 2, dur: 0.07, gain: 0.5 }] },
  // Magic: a whoosh under a rising shimmer.
  cast: {
    noise: [{ freq: 500, to: 2500, q: 0.8, dur: 0.25, gain: 0.16 }],
    tones: [
      { freq: 440, to: 1320, dur: 0.25, gain: 0.1 },
      { freq: 660, to: 1980, at: 0.03, dur: 0.22, gain: 0.05 },
    ],
  },
  // A card landing: a deep thump, a low pitch dropping fast, with a muffled knock of noise for the impact.
  // Kept a little under `damage`, which it resembles, since it plays far more often.
  enter: { tones: [{ freq: 230, to: 95, dur: 0.17, gain: 0.35 }], noise: [{ freq: 700, filter: 'lowpass', dur: 0.05, gain: 0.17 }] },
  // The spell lands: a short, soft chime.
  resolve: { tones: [{ freq: C6, dur: 0.3, gain: 0.12 }, { freq: G5 * 2, at: 0.04, dur: 0.3, gain: 0.08 }] },
  // A riffle: a run of tiny noise flicks.
  shuffle: { noise: Array.from({ length: 10 }, (_, i) => ({ freq: 2500 + (i % 3) * 400, q: 1.5, at: i * 0.035, dur: 0.03, gain: 0.4 })) },
  // A click on the 3D board (effects.tsx), each soft, since it is only the board answering.
  // The well: a low plop that falls, a wash of water after it and two little bubbles.
  splash: {
    tones: [
      { freq: 420, to: 160, dur: 0.12, gain: 0.16 },
      { freq: 900, to: 1400, at: 0.1, dur: 0.05, gain: 0.04 },
      { freq: 1100, to: 1700, at: 0.17, dur: 0.04, gain: 0.03 },
    ],
    noise: [{ freq: 900, to: 400, q: 0.7, at: 0.02, dur: 0.35, gain: 0.35 }],
  },
  // Leather: a soft, low pat.
  leather: { tones: [{ freq: 140, to: 90, dur: 0.08, gain: 0.18 }], noise: [{ freq: 500, filter: 'lowpass', dur: 0.08, gain: 0.3 }] },
  // Wood: a hollow knock on the planks.
  wood: { tones: [{ freq: 260, to: 210, dur: 0.09, gain: 0.2 }, { freq: 640, dur: 0.04, gain: 0.05 }], noise: [{ freq: 1100, q: 2, dur: 0.03, gain: 0.3 }] },
  // Cloth: a soft, muffled brush.
  cloth: { noise: [{ freq: 1200, to: 700, q: 0.8, dur: 0.16, gain: 0.25 }] },
  // Stone (the slate and the flagstones): a light tap with a hint of ring.
  stone: { tones: [{ freq: 1250, to: 1150, dur: 0.09, gain: 0.06 }], noise: [{ freq: 3000, q: 1.2, dur: 0.03, gain: 0.25 }] },
};

/** Plays sound `name` now into `out`. */
export function synth(audio: AudioContext, out: AudioNode, name: Sound): void {
  const t0 = audio.currentTime + 0.005;
  const { tones = [], noise: bursts = [] } = RECIPES[name];
  for (const t of tones) tone(audio, out, t0, t);
  for (const n of bursts) noise(audio, out, t0, n);
}
