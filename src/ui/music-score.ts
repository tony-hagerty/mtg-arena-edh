// The background music's notes and when it plays, with no audio: music.ts turns these into
// sound. The music is generative: a seeded random walk over a few chords in D Dorian, a slow
// pad under each, now and then a short melody or a few harp and bell notes on top, so it never
// repeats a loop.
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
/** The drone's notes, D2 and A2, under every chord. */
export const DRONE = [38, 45];

/** Each chord centre: its notes (MIDI, voiced for the pad) and where the walk may go next, with weights. */
export const CHORDS = {
  Dm: { notes: [50, 57, 60, 65], next: { F: 3, G: 3, C: 2, Am: 2 } },
  F: { notes: [53, 57, 60, 64], next: { C: 3, G: 2, Dm: 3 } },
  G: { notes: [50, 55, 59, 62], next: { Dm: 4, Am: 2, F: 1 } },
  C: { notes: [52, 55, 60, 64], next: { Dm: 3, F: 2, Am: 2 } },
  Am: { notes: [52, 57, 60, 64], next: { Dm: 3, G: 2, F: 2 } },
} satisfies Record<string, { notes: number[]; next: Record<string, number> }>;
export type Chord = keyof typeof CHORDS;

export type Voice = 'pad' | 'lead' | 'harp' | 'bell';

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
  /** Seconds until the next bar starts. A pad note outlasts it, so the chords cross-fade. */
  length: number;
  /** How open the pad's filter is this bar, 0 (dark) to 1 (bright): the colour drifts slowly. */
  brightness: number;
  notes: Note[];
}

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

/** The melody's range, about A4 to D6: above the pad, below shrill. */
const LEAD = scaleNotes(69, 86);

/**
 * Makes the music, one bar at a time, from `seed`. The melody walks by steps through the
 * scale from where it last stopped, so phrases connect across bars.
 */
export function composer(seed: number): { next(): Bar } {
  const rng = seeded(seed);
  let chord: Chord = 'Dm';
  let lead = LEAD.indexOf(74);
  let brightness = 0.4;
  let first = true;
  return {
    next() {
      if (!first) chord = weighted<Chord>(rng, CHORDS[chord].next);
      first = false;
      // 9 to 13 seconds a chord: slow enough to float, uneven so nothing lines up.
      const length = 9 + rng() * 4;
      brightness = Math.max(0.1, Math.min(0.9, brightness + (rng() - 0.5) * 0.3));
      const notes: Note[] = CHORDS[chord].notes.map((midi, i) => ({ voice: 'pad', midi, at: i * 0.15, dur: length + 4, gain: i === 0 ? 0.9 : 0.7 }));

      // A short melody in a little over half the bars, the rest left to the pad.
      if (rng() < 0.55) {
        let at = 1 + rng() * 2.5;
        const count = 2 + Math.floor(rng() * 4);
        for (let i = 0; i < count && at < length - 1; i++) {
          // Mostly steps, now and then a leap of a third, drifting back towards the middle.
          const step = pick(rng, [-2, -1, -1, 1, 1, 2]) + (lead > LEAD.length * 0.7 ? -1 : lead < LEAD.length * 0.3 ? 1 : 0);
          lead = Math.max(0, Math.min(LEAD.length - 1, lead + step));
          const dur = 1.6 + rng() * 2;
          notes.push({ voice: 'lead', midi: LEAD[lead], at, dur, gain: 0.5 + rng() * 0.3 });
          at += 0.9 + rng() * 1.8;
        }
      }
      // A slow harp roll up the chord, an octave above the pad.
      if (rng() < 0.3) {
        const at = 0.5 + rng() * (length - 3);
        CHORDS[chord].notes.forEach((midi, i) => notes.push({ voice: 'harp', midi: midi + 12, at: at + i * 0.18, dur: 3, gain: 0.55 }));
      }
      // A single far-off bell on a chord note.
      if (rng() < 0.25) {
        notes.push({ voice: 'bell', midi: pick(rng, CHORDS[chord].notes) + 24, at: rng() * (length - 1), dur: 5, gain: 0.35 });
      }
      return { chord, length, brightness, notes };
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
