// The background music: plays the notes music-score.ts writes with the Web Audio API, no
// sound files. A drone, a pad per chord through one low-pass filter, a soft lead, harp and
// bell plucks, all through a reverb made from decaying noise. A timer once a second schedules
// the next bar ahead on the audio clock, so nothing runs per frame.
import { composer, DRONE, hz, musicLevel, musicPlace } from './music-score';
import type { Bar, Note } from './music-score';
import { useStore } from './store';

/** The music's loudness at full volume, set under the interface sounds so it stays in the background. */
const BASE = 0.8;
/** How far ahead (seconds) bars are scheduled, and how often (ms) the timer looks. */
const AHEAD = 3;
const TICK = 1000;
/** Seconds the reverb rings. */
const REVERB = 4;

interface Graph {
  audio: AudioContext;
  /** The music volume, faded in and out. */
  master: GainNode;
  /** Where every voice goes: on to the master dry and through the reverb. */
  bus: GainNode;
  pad: BiquadFilterNode;
  lead: BiquadFilterNode;
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

function build(): Graph {
  const audio = new AudioContext();
  const master = audio.createGain();
  master.gain.value = 0;
  master.connect(audio.destination);
  const bus = audio.createGain();
  bus.gain.value = 0.7;
  bus.connect(master);
  const reverb = audio.createConvolver();
  reverb.buffer = impulse(audio);
  const wet = audio.createGain();
  wet.gain.value = 0.9;
  bus.connect(reverb).connect(wet).connect(master);

  const pad = audio.createBiquadFilter();
  pad.type = 'lowpass';
  pad.frequency.value = 900;
  pad.Q.value = 0.5;
  pad.connect(bus);
  const lead = audio.createBiquadFilter();
  lead.type = 'lowpass';
  lead.frequency.value = 2200;
  lead.connect(bus);

  // The drone runs all the time, swelling and easing back with a very slow wave.
  const drone = audio.createGain();
  drone.gain.value = 0.05;
  drone.connect(pad);
  for (const midi of DRONE) {
    const osc = audio.createOscillator();
    osc.frequency.value = hz(midi);
    osc.connect(drone);
    osc.start();
  }
  const swell = audio.createOscillator();
  swell.frequency.value = 0.04;
  const depth = audio.createGain();
  depth.gain.value = 0.025;
  swell.connect(depth).connect(drone.gain);
  swell.start();
  return { audio, master, bus, pad, lead };
}

/** One note of `voice` at time `t`, into `out`: a slow swell for the pad, a soft rise for the lead, a pluck for harp and bell. */
function note({ audio, pad, lead, bus }: Graph, t: number, n: Note) {
  const start = t + n.at;
  const end = start + n.dur;
  const env = audio.createGain();
  const g = env.gain;
  g.setValueAtTime(0, start);
  const partials: [OscillatorType, number, number][] = [];
  if (n.voice === 'pad') {
    // Three seconds in, four out, so each chord melts into the next.
    g.linearRampToValueAtTime(0.045 * n.gain, start + 3);
    g.setValueAtTime(0.045 * n.gain, end - 4);
    g.linearRampToValueAtTime(0, end);
    env.connect(pad);
    // Each note a few cents off, for a slow shimmer between them.
    partials.push(['sawtooth', 1 + (Math.random() - 0.5) * 0.006, 1]);
  } else if (n.voice === 'lead') {
    g.linearRampToValueAtTime(0.06 * n.gain, start + 0.35);
    g.exponentialRampToValueAtTime(0.0001, end);
    env.connect(lead);
    partials.push(['triangle', 1, 1]);
  } else {
    // A pluck: there at once, ringing away. A bell adds an inharmonic partial.
    g.linearRampToValueAtTime((n.voice === 'bell' ? 0.06 : 0.07) * n.gain, start + 0.005);
    g.exponentialRampToValueAtTime(0.0001, end);
    env.connect(bus);
    partials.push(n.voice === 'bell' ? ['sine', 1, 1] : ['triangle', 1, 1]);
    if (n.voice === 'bell') partials.push(['sine', 2.76, 0.3]);
  }
  for (const [type, ratio, gain] of partials) {
    const osc = audio.createOscillator();
    osc.type = type;
    osc.frequency.value = hz(n.midi) * ratio;
    if (gain === 1) osc.connect(env);
    else {
      const quiet = audio.createGain();
      quiet.gain.value = gain;
      osc.connect(quiet).connect(env);
    }
    osc.start(start);
    osc.stop(end + 0.05);
  }
}

function playBar(g: Graph, t: number, bar: Bar) {
  // The pad's colour drifts from bar to bar: 500 Hz is dark, about 1600 Hz bright.
  g.pad.frequency.setTargetAtTime(500 + bar.brightness * 1100, t, bar.length / 3);
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
