// The background music: plays the notes music-score.ts writes with the Web Audio API, no
// sound files. A harp arpeggio and a plucked bass through one low-pass filter, a soft lead
// and bells, all through a reverb made from decaying noise, and a frame drum and shaker
// kept mostly dry so the beat stays crisp. A timer once a second schedules the next bar ahead
// on the audio clock, so nothing runs per frame.
import { composer, hz, musicLevel, musicPlace } from './music-score';
import type { Bar, Note } from './music-score';
import { useStore } from './store';

/** The music's loudness at full volume, set under the interface sounds so it stays in the background. */
const BASE = 0.8;
/** How far ahead (seconds) bars are scheduled, and how often (ms) the timer looks. */
const AHEAD = 3;
const TICK = 1000;
/** Seconds the reverb rings. */
const REVERB = 3;

interface Graph {
  audio: AudioContext;
  /** The music volume, faded in and out. */
  master: GainNode;
  /** Where the tuned voices go: on to the master dry and through the reverb. */
  bus: GainNode;
  /** Where the percussion goes: mostly dry, a little reverb. */
  drums: GainNode;
  /** The harp and bass's low-pass, whose brightness drifts from bar to bar. */
  tone: BiquadFilterNode;
  lead: BiquadFilterNode;
  /** The drum's thud of noise and the shaker's hiss, cut from one buffer of noise. */
  thud: BiquadFilterNode;
  hiss: BiquadFilterNode;
  noise: AudioBuffer;
}

let graph: Graph | null = null;
let score = composer(Date.now());
let nextBar = 0;
let timer: ReturnType<typeof setInterval> | null = null;
let suspending: ReturnType<typeof setTimeout> | null = null;
/** The first click or key press has happened; browsers keep audio silent until then. */
let unlocked = false;
let level = 0;
let last = { place: musicPlace(null), hidden: false };

/** Reverb: two channels of noise falling away over `REVERB` seconds, a little different left and right. */
function impulse(audio: AudioContext): AudioBuffer {
  const length = Math.floor(audio.sampleRate * REVERB);
  const buffer = audio.createBuffer(2, length, audio.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const data = buffer.getChannelData(ch);
    for (let i = 0; i < length; i++) data[i] = (Math.random() * 2 - 1) * Math.exp((-4 * i) / length) * (1 - i / length);
  }
  return buffer;
}

function filter(audio: AudioContext, type: BiquadFilterType, freq: number, out: AudioNode): BiquadFilterNode {
  const f = audio.createBiquadFilter();
  f.type = type;
  f.frequency.value = freq;
  f.connect(out);
  return f;
}

function build(): Graph {
  const audio = new AudioContext();
  const master = audio.createGain();
  master.gain.value = 0;
  master.connect(audio.destination);
  const reverb = audio.createConvolver();
  reverb.buffer = impulse(audio);
  const wet = audio.createGain();
  wet.gain.value = 0.6;
  reverb.connect(wet).connect(master);

  const bus = audio.createGain();
  bus.gain.value = 0.75;
  bus.connect(master);
  bus.connect(reverb);
  const drums = audio.createGain();
  drums.connect(master);
  const room = audio.createGain();
  room.gain.value = 0.2;
  drums.connect(room).connect(reverb);

  const noise = audio.createBuffer(1, audio.sampleRate, audio.sampleRate);
  const data = noise.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  return {
    audio,
    master,
    bus,
    drums,
    tone: filter(audio, 'lowpass', 2000, bus),
    lead: filter(audio, 'lowpass', 2200, bus),
    thud: filter(audio, 'lowpass', 300, drums),
    hiss: filter(audio, 'highpass', 6000, drums),
    noise,
  };
}

function osc(audio: AudioContext, type: OscillatorType, freq: number, out: AudioNode, start: number, end: number): OscillatorNode {
  const o = audio.createOscillator();
  o.type = type;
  o.frequency.value = freq;
  o.connect(out);
  o.start(start);
  o.stop(end + 0.05);
  return o;
}

/** A burst of the noise buffer into `out`, from a random point in it. */
function burst(g: Graph, out: AudioNode, start: number, dur: number) {
  const src = g.audio.createBufferSource();
  src.buffer = g.noise;
  src.connect(out);
  src.start(start, Math.random() * 0.8);
  src.stop(start + dur + 0.02);
}

/** One note at time `t`: a soft rise for the lead, a pluck for the rest, a hit for the drums. */
function note(g: Graph, t: number, n: Note) {
  const { audio } = g;
  const start = t + n.at;
  const end = start + n.dur;
  const env = audio.createGain();
  const v = env.gain;
  v.setValueAtTime(0, start);
  const freq = hz(n.midi);
  /** A pluck: there at once, ringing away. */
  const pluck = (peak: number) => {
    v.linearRampToValueAtTime(peak * n.gain, start + 0.005);
    v.exponentialRampToValueAtTime(0.0001, end);
  };
  switch (n.voice) {
    case 'lead':
      v.linearRampToValueAtTime(0.06 * n.gain, start + 0.08);
      v.exponentialRampToValueAtTime(0.0001, end);
      env.connect(g.lead);
      osc(audio, 'triangle', freq, env, start, end);
      break;
    case 'harp':
      pluck(0.09);
      env.connect(g.tone);
      osc(audio, 'triangle', freq, env, start, end);
      break;
    case 'bass':
      pluck(0.16);
      env.connect(g.tone);
      osc(audio, 'triangle', freq, env, start, end);
      break;
    case 'bell': {
      pluck(0.06);
      env.connect(g.bus);
      osc(audio, 'sine', freq, env, start, end);
      // A bell's inharmonic partial, quieter.
      const quiet = audio.createGain();
      quiet.gain.value = 0.3;
      quiet.connect(env);
      osc(audio, 'sine', freq * 2.76, quiet, start, end);
      break;
    }
    case 'drum': {
      // A frame drum: a low pitch falling fast, with a soft thud of noise for the skin. A 15 ms
      // rise instead of a pluck's 5 takes the edge off the hit.
      v.linearRampToValueAtTime(0.12 * n.gain, start + 0.015);
      v.exponentialRampToValueAtTime(0.0001, end);
      env.connect(g.drums);
      osc(audio, 'sine', 110, env, start, end).frequency.exponentialRampToValueAtTime(48, start + 0.25);
      const skin = audio.createGain();
      skin.gain.setValueAtTime(0.12 * n.gain, start);
      skin.gain.exponentialRampToValueAtTime(0.0001, start + 0.08);
      skin.connect(g.thud);
      burst(g, skin, start, 0.08);
      break;
    }
    case 'shaker':
      v.linearRampToValueAtTime(0.05 * n.gain, start + 0.01);
      v.exponentialRampToValueAtTime(0.0001, end);
      env.connect(g.hiss);
      burst(g, env, start, n.dur);
      break;
  }
}

function playBar(g: Graph, t: number, bar: Bar) {
  // The colour drifts from bar to bar: 1200 Hz is dark, about 3200 Hz bright.
  g.tone.frequency.setTargetAtTime(1200 + bar.brightness * 2000, t, bar.length / 3);
  for (const n of bar.notes) note(g, t, n);
}

/** Schedules every bar that starts within `AHEAD` seconds. */
function tick() {
  if (!graph) return;
  const now = graph.audio.currentTime;
  if (nextBar < now) nextBar = now + 0.1;
  while (nextBar < now + AHEAD) {
    const bar = score.next();
    playBar(graph, nextBar, bar);
    nextBar += bar.length;
  }
}

/** Fades the music to where it should be now: see `musicLevel` for the rules. */
function update() {
  const { settings, game } = useStore.getState();
  const place = musicPlace(game);
  const hidden = typeof document !== 'undefined' && document.hidden;
  const target = musicLevel(settings, place, unlocked, hidden);
  const was = { level, ...last };
  last = { place, hidden };
  if (target === level) return;
  level = target;
  if (typeof AudioContext === 'undefined') return;
  if (target > 0 && !graph) graph = build();
  if (!graph) return;
  const { audio, master } = graph;
  // How fast to fade (the time constant, seconds; about five of them to finish): quick for a
  // hidden window or the volume slider, slow to come in and to fade out at the end of a game.
  const fade = hidden !== was.hidden ? 0.15 : was.level === 0 ? 2 : target === 0 ? 1.2 : place !== was.place ? 1 : 0.08;
  const now = audio.currentTime;
  master.gain.cancelScheduledValues(now);
  master.gain.setValueAtTime(master.gain.value, now);
  master.gain.setTargetAtTime(target * BASE, now, fade);
  if (suspending) clearTimeout(suspending);
  suspending = null;
  if (target > 0) {
    if (audio.state !== 'running') void audio.resume().catch(() => {});
    if (was.level === 0 && place !== was.place) score = composer(Date.now());
    timer ??= setInterval(tick, TICK);
    tick();
  } else {
    // Once faded, stop the clock: no notes are made and none use the processor until it comes back.
    suspending = setTimeout(() => {
      if (level > 0) return;
      if (timer) clearInterval(timer);
      timer = null;
      void audio.suspend().catch(() => {});
    }, fade * 5000);
  }
}

if (typeof window !== 'undefined') {
  // Any of these counts as the human's first gesture. A touch's pointerdown doesn't for some
  // browsers, so later ones also wake a context the browser left suspended.
  const gesture = () => {
    unlocked = true;
    if (graph && level > 0 && graph.audio.state === 'suspended') void graph.audio.resume().catch(() => {});
    else update();
  };
  for (const type of ['pointerdown', 'pointerup', 'keydown']) window.addEventListener(type, gesture, true);
  document.addEventListener('visibilitychange', update);
  useStore.subscribe(update);
}
