// The background music's notes and when it plays, with no audio: music.ts turns these into
// sound. The music is generative but keeps a steady pulse: a seeded random walk over a few
// chords in D Dorian, two measures of 4/4 a chord, with a harp arpeggio in eighth notes, a
// plucked bass, a soft frame drum and shaker, and a melody on the beat. Nothing is held: every
// voice is plucked or struck and dies away. Every few chords a new section picks new patterns
// and how busy it is, so it never repeats a loop.
import type { Game } from '../engine';
import type { Settings } from './store';

/** A seeded random number generator (mulberry32): the same seed gives the same music. */
export function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** D Dorian, as MIDI note numbers mod 12: D E F G A B C. The raised sixth (B) is what makes it Dorian. */
export const SCALE = [2, 4, 5, 7, 9, 11, 0];

/** Each chord centre: its notes (MIDI, voiced for the arpeggio), its bass root, and where the walk may go next, with weights. */
export const CHORDS = {
  Dm: { notes: [50, 57, 60, 65], root: 38, next: { F: 3, G: 3, C: 2, Am: 2 } },
  F: { notes: [53, 57, 60, 64], root: 41, next: { C: 3, G: 2, Dm: 3 } },
  G: { notes: [50, 55, 59, 62], root: 43, next: { Dm: 4, Am: 2, F: 1 } },
  C: { notes: [52, 55, 60, 64], root: 36, next: { Dm: 3, F: 2, Am: 2 } },
  Am: { notes: [52, 57, 60, 64], root: 45, next: { Dm: 3, G: 2, F: 2 } },
} satisfies Record<string, { notes: number[]; root: number; next: Record<string, number> }>;
export type Chord = keyof typeof CHORDS;

export type Voice = 'harp' | 'bass' | 'lead' | 'bell' | 'drum' | 'shaker';
/** Voices with no pitch: their `midi` is ignored. */
export const UNPITCHED: Voice[] = ['drum', 'shaker'];

export interface Note {
  voice: Voice;
  /** MIDI note number (69 is A4, 440 Hz). */
  midi: number;
  /** Seconds after the bar starts. */
  at: number;
  /** Seconds it sounds, release included. */
  dur: number;
  /** Loudness against the other notes, 0 to 1. */
  gain: number;
}

export interface Bar {
  chord: Chord;
  /** Seconds a beat lasts; a bar is `BEATS` of them. */
  beat: number;
  /** Seconds until the next bar starts. */
  length: number;
  /** How busy the section is: 0 a light bass and drum on beats 1 and 3, 1 the section's full patterns, 2 adds the shaker. */
  energy: number;
  /** How open the harp and bass's filter is this bar, 0 (dark) to 1 (bright): the colour drifts slowly. */
  brightness: number;
  notes: Note[];
}

/** Beats in a bar: one chord lasts two measures of 4/4. */
export const BEATS = 8;

/** Arpeggios over the chord's four notes, one index per eighth note of a measure. */
const ARPS = [
  [0, 1, 2, 3, 2, 1, 0, 1],
  [0, 2, 1, 3, 0, 2, 1, 3],
  [0, 1, 2, 3, 3, 2, 1, 0],
  [0, 2, 3, 2, 1, 2, 3, 2],
  [3, 2, 1, 0, 1, 2, 3, 2],
];
/** Bass rhythms, in beats of the bar. Each note is the root, or the fifth on an odd one. */
const BASS = [
  [0, 4],
  [0, 3, 4, 7],
  [0, 1.5, 4, 5.5],
  [0, 2.5, 4, 6.5],
];
/** Frame drum rhythms, [beat, loudness]: a strong first beat, the rest lighter. The first is the quiet level's. */
const DRUMS = [
  [[0, 1], [4, 0.75]],
  [[0, 1], [2.5, 0.4], [4, 0.8], [6.5, 0.4]],
  [[0, 1], [1.5, 0.45], [4, 0.8], [5.5, 0.45], [7, 0.35]],
  [[0, 1], [3, 0.5], [4, 0.75], [7, 0.5], [7.5, 0.35]],
];
/** The last bar of a section ends with a little roll into the next. */
const FILL = [[6, 0.45], [6.5, 0.5], [7, 0.6], [7.5, 0.7]];

/** MIDI note number to Hz. */
export const hz = (midi: number) => 440 * 2 ** ((midi - 69) / 12);

const pick = <T>(rng: () => number, xs: readonly T[]) => xs[Math.floor(rng() * xs.length)];

function weighted<K extends string>(rng: () => number, weights: Partial<Record<K, number>>): K {
  const entries = Object.entries(weights) as [K, number][];
  let r = rng() * entries.reduce((n, [, w]) => n + w, 0);
  for (const [k, w] of entries) if ((r -= w) < 0) return k;
  return entries[entries.length - 1][0];
}

/** The scale's notes from `low` to `high`, as MIDI numbers. */
function scaleNotes(low: number, high: number): number[] {
  const notes: number[] = [];
  for (let m = low; m <= high; m++) if (SCALE.includes(m % 12)) notes.push(m);
  return notes;
}

/** The melody's range, about A4 to D6: above the harp, below shrill. */
const LEAD = scaleNotes(69, 86);

/**
 * Makes the music, one bar (one chord) at a time, from `seed`. The tempo is set once, about
 * 80 to 92 beats a minute. A short quiet opening of two bars, then each section of 4 to 8 bars
 * picks its own patterns and moves its energy up or down a step. The melody walks by steps from where it last stopped, so phrases
 * connect across bars.
 */
export function composer(seed: number): { next(): Bar } {
  const rng = seeded(seed);
  const beat = 60 / (80 + Math.floor(rng() * 13));
  const length = BEATS * beat;
  let chord: Chord = 'Dm';
  let lead = LEAD.indexOf(74);
  let brightness = 0.4;
  let first = true;
  // The section: bars left in it, its energy and its patterns. It opens quietly, briefly.
  let left = 2;
  let energy = 0;
  let arp = ARPS[0];
  let rests = 0.3;
  let bass = BASS[0];
  let drums = DRUMS[0];
  return {
    next() {
      if (!first) chord = weighted<Chord>(rng, CHORDS[chord].next);
      if (left === 0) {
        left = 4 + Math.floor(rng() * 5);
        // Out of the quiet level always up; at the top, more often back down.
        energy = energy === 0 ? 1 : energy === 1 ? pick(rng, [0, 2, 2]) : pick(rng, [1, 1, 2]);
        arp = pick(rng, ARPS);
        // How many of the harp's off-beat eighths drop out: few at the busiest.
        rests = energy === 2 ? rng() * 0.1 : 0.1 + rng() * 0.25;
        bass = energy === 0 ? BASS[0] : pick(rng, BASS);
        drums = energy === 0 ? DRUMS[0] : pick(rng, DRUMS);
      }
      first = false;
      left--;
      const at = (beats: number) => beats * beat;
      const { notes: tones, root } = CHORDS[chord];
      brightness = Math.max(0.1, Math.min(0.9, brightness + (rng() - 0.5) * 0.3));
      const notes: Note[] = [];
      // The harp: the section's arpeggio in eighth notes, an octave up, the downbeats kept.
      for (let i = 0; i < BEATS * 2; i++) {
        if (i % 4 !== 0 && rng() < rests) continue;
        const up = i >= 8 && rng() < 0.2 ? 24 : 12;
        notes.push({ voice: 'harp', midi: tones[arp[i % 8]] + up, at: at(i / 2), dur: at(2.5), gain: i % 4 === 0 ? 0.6 : 0.42 });
      }

      // The bass and drum, softer at the quiet level, rolling into the next section on its last bar.
      const soft = energy === 0 ? 0.7 : 1;
      bass.forEach((b, i) => notes.push({ voice: 'bass', midi: i % 2 === 1 && rng() < 0.4 ? root + 7 : root, at: at(b), dur: at(1.8), gain: (b % 4 === 0 ? 0.9 : 0.7) * soft }));
      for (const [b, gain] of left === 0 ? [...drums.filter(([b]) => b < 6), ...FILL] : drums) {
        notes.push({ voice: 'drum', midi: 38, at: at(b), dur: 0.5, gain: gain * soft });
      }
      if (energy === 2) {
        for (let i = 0; i < BEATS * 2; i++) notes.push({ voice: 'shaker', midi: 0, at: at(i / 2), dur: 0.06, gain: i % 2 ? 0.5 : 0.25 });
      }

      // A melody on the beat, in more bars the busier it is.
      if (rng() < [0.3, 0.55, 0.7][energy]) {
        let b = pick(rng, [0, 1, 2, 2.5]);
        while (b < BEATS - 1) {
          const step = pick(rng, [-2, -1, -1, 1, 1, 2]) + (lead > LEAD.length * 0.7 ? -1 : lead < LEAD.length * 0.3 ? 1 : 0);
          lead = Math.max(0, Math.min(LEAD.length - 1, lead + step));
          const beats = pick(rng, [0.5, 1, 1, 1.5, 2]);
          notes.push({ voice: 'lead', midi: LEAD[lead], at: at(b), dur: at(beats) * 1.3, gain: 0.55 + rng() * 0.25 });
          b += beats;
          // A breath now and then.
          if (rng() < 0.2) b += 1;
        }
      }
      // A single far-off bell on a chord note, on a beat.
      if (rng() < 0.2) notes.push({ voice: 'bell', midi: pick(rng, tones) + 24, at: at(Math.floor(rng() * BEATS)), dur: 4, gain: 0.35 });
      return { chord, beat, length, energy, brightness, notes };
    },
  };
}

/** Where the music is: the deck menu, a game in progress, or a game that has ended. */
export type MusicPlace = 'menu' | 'game' | 'over';

export const musicPlace = (game: Game | null): MusicPlace => (!game ? 'menu' : game.winner !== null ? 'over' : 'game');

/** How loud the music is in each place, against the music volume. It carries on quietly on the menu and fades out when a game ends. */
const LEVELS: Record<MusicPlace, number> = { menu: 0.6, game: 1, over: 0 };

/**
 * How loud the music should be, 0 to 1, or 0 for silent. Silent until the human's first click
 * or key press (`unlocked`: browsers keep a page quiet until then), while the window is hidden,
 * and when the music is turned off.
 */
export function musicLevel(settings: Pick<Settings, 'music' | 'musicMuted'>, place: MusicPlace, unlocked: boolean, hidden: boolean): number {
  if (!unlocked || hidden || settings.musicMuted) return 0;
  return settings.music * LEVELS[place];
}
