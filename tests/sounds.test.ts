import { produce } from 'immer';
import { describe, expect, it, vi } from 'vitest';
import './fixtures';
import type { Game } from '../src/engine';
import { gameSound } from '../src/ui/game-sounds';
import { BEATS, CHORDS, composer, hz, musicLevel, musicPlace, SCALE, seeded, UNPITCHED } from '../src/ui/music-score';
import { loadSettings, useStore } from '../src/ui/store';
import { emptyGame, put } from './helpers';

const change = (g: Game, edit: (d: Game) => void) => produce(g, edit);

describe('game sounds', () => {
  const g = emptyGame();

  it('shuffles for a new game, and is quiet when nothing changed', () => {
    expect(gameSound(null, g, 0)).toBe('shuffle');
    expect(gameSound(g, g, 0)).toBe(null);
  });

  it('hears your turn start, but not someone else’s', () => {
    const theirs = change(g, (d) => void ((d.active = 1), (d.turn = 2)));
    expect(gameSound(g, theirs, 0)).toBe(null);
    expect(gameSound(theirs, change(theirs, (d) => void ((d.active = 0), (d.turn = 3))), 0)).toBe('turn');
  });

  it('hears life lost over a spell resolving', () => {
    // Only the stack's size matters here.
    const cast = change(g, (d) => void d.stack.push({} as Game['stack'][number]));
    expect(gameSound(g, cast, 0)).toBe('cast');
    const resolved = change(cast, (d) => void ((d.stack = []), (d.players[1].life -= 3)));
    expect(gameSound(cast, resolved, 0)).toBe('damage');
    expect(gameSound(cast, change(cast, (d) => void (d.stack = [])), 0)).toBe('resolve');
  });

  it('hears a permanent arrive and your own draws', () => {
    expect(gameSound(g, change(g, (d) => void put(d, 2, 'Forest')), 0)).toBe('enter');
    const drew = change(g, (d) => void d.players[0].hand.push(d.players[0].library.shift()!));
    expect(gameSound(g, drew, 0)).toBe('draw');
    expect(gameSound(g, drew, 1)).toBe(null);
  });

  it('tells winning from losing', () => {
    const over = change(g, (d) => void (d.winner = 1));
    expect(gameSound(g, over, 1)).toBe('win');
    expect(gameSound(g, over, 0)).toBe('lose');
  });
});

describe('background music', () => {
  const on = { music: 0.4, musicMuted: false };

  it('is silent until the first click or key press, and while the window is hidden', () => {
    expect(musicLevel(on, 'game', false, false)).toBe(0);
    expect(musicLevel(on, 'game', true, false)).toBeCloseTo(0.4);
    expect(musicLevel(on, 'game', true, true)).toBe(0);
  });

  it('carries on quietly on the menu and fades out when the game ends', () => {
    const g = emptyGame();
    expect(musicPlace(null)).toBe('menu');
    expect(musicPlace(g)).toBe('game');
    expect(musicPlace(change(g, (d) => void (d.winner = 0)))).toBe('over');
    const menu = musicLevel(on, 'menu', true, false);
    expect(menu).toBeGreaterThan(0);
    expect(menu).toBeLessThan(musicLevel(on, 'game', true, false));
    expect(musicLevel(on, 'over', true, false)).toBe(0);
  });

  it('follows its own volume and mute, not the sounds’', () => {
    expect(musicLevel({ music: 0, musicMuted: false }, 'game', true, false)).toBe(0);
    expect(musicLevel({ music: 1, musicMuted: true }, 'game', true, false)).toBe(0);
    expect(musicLevel({ music: 1, musicMuted: false }, 'game', true, false)).toBe(1);
  });

  it('is a setting of its own, saved with the rest and quiet by default', () => {
    const { settings, setSetting } = useStore.getState();
    expect(settings.music).toBeGreaterThan(0);
    expect(settings.music).toBeLessThanOrEqual(0.5);
    expect(settings.musicMuted).toBe(false);
    const saved = new Map<string, string>();
    vi.stubGlobal('localStorage', { getItem: (k: string) => saved.get(k) ?? null, setItem: (k: string, v: string) => saved.set(k, v) });
    try {
      setSetting({ music: 0.75, musicMuted: true });
      expect(useStore.getState().settings.volume).toBe(settings.volume);
      expect(loadSettings()).toMatchObject({ music: 0.75, musicMuted: true, volume: settings.volume });
      saved.set('arena-edh.settings', JSON.stringify({ music: 7, musicMuted: 'yes' }));
      expect(loadSettings()).toMatchObject({ music: 1, musicMuted: false });
    } finally {
      vi.unstubAllGlobals();
      setSetting(settings);
    }
  });

  it('writes the same music for the same seed, and different music for another', () => {
    const bars = (seed: number) => Array.from({ length: 40 }, composer(seed).next);
    expect(bars(7)).toEqual(bars(7));
    expect(bars(7)).not.toEqual(bars(8));
  });

  it('keeps to D Dorian, walks only between neighbouring chords, and changes as it goes', () => {
    const bars = Array.from({ length: 200 }, composer(42).next);
    expect(bars[0].chord).toBe('Dm');
    for (const [i, bar] of bars.entries()) {
      if (i > 0) expect(Object.keys(CHORDS[bars[i - 1].chord].next)).toContain(bar.chord);
      expect(bar.brightness).toBeGreaterThan(0);
      expect(bar.brightness).toBeLessThan(1);
      for (const n of bar.notes) {
        if (!UNPITCHED.includes(n.voice)) expect(SCALE).toContain(n.midi % 12);
        expect(n.at).toBeGreaterThanOrEqual(0);
        expect(n.at).toBeLessThan(bar.length);
        if (n.voice === 'pad') expect(CHORDS[bar.chord].notes).toContain(n.midi);
        // The pad outlasts the bar, so chords cross-fade instead of stopping.
        if (n.voice === 'pad') expect(n.dur).toBeGreaterThan(bar.length);
        if (n.voice === 'lead') expect(n.midi).toBeGreaterThanOrEqual(69);
        if (n.voice === 'lead') expect(n.midi).toBeLessThanOrEqual(86);
      }
    }
    // Every chord and every voice turns up, and some bars leave the melody out.
    expect(new Set(bars.map((b) => b.chord)).size).toBe(Object.keys(CHORDS).length);
    const voices = new Set(bars.flatMap((b) => b.notes.map((n) => n.voice)));
    expect([...voices].sort()).toEqual(['bass', 'bell', 'drum', 'harp', 'lead', 'pad', 'shaker']);
    expect(bars.some((b) => b.notes.every((n) => n.voice !== 'lead'))).toBe(true);
    // No loop: the chord sequence doesn't repeat with any short period.
    const chords = bars.map((b) => b.chord).join(' ');
    for (let period = 1; period <= 16; period++) expect(bars.every((b, i) => i < period || b.chord === bars[i - period].chord), `${period}: ${chords}`).toBe(false);
  });

  it('keeps a steady pulse: one tempo, every note on the eighth-note grid', () => {
    const bars = Array.from({ length: 100 }, composer(5).next);
    const { beat } = bars[0];
    // 80 to 92 beats a minute.
    expect(60 / beat).toBeGreaterThanOrEqual(80);
    expect(60 / beat).toBeLessThanOrEqual(92);
    for (const bar of bars) {
      expect(bar.beat).toBe(beat);
      expect(bar.length).toBeCloseTo(BEATS * beat);
      for (const n of bar.notes) expect((n.at / beat) * 2).toBeCloseTo(Math.round((n.at / beat) * 2));
    }
  });

  it('opens quietly but briefly, then builds and eases off section by section', () => {
    const bars = Array.from({ length: 200 }, composer(9).next);
    expect(bars.slice(0, 2).map((b) => b.energy)).toEqual([0, 0]);
    expect(bars[2].energy).toBe(1);
    expect(new Set(bars.map((b) => b.energy))).toEqual(new Set([0, 1, 2]));
    for (const [i, bar] of bars.entries()) {
      if (i > 0) expect(Math.abs(bar.energy - bars[i - 1].energy)).toBeLessThanOrEqual(1);
      // A beat in every bar, even the quiet ones; the shaker only at the busiest.
      expect(bar.notes.some((n) => n.voice === 'drum' && n.at === 0)).toBe(true);
      expect(bar.notes.some((n) => n.voice === 'bass' && n.at === 0)).toBe(true);
      expect(bar.notes.some((n) => n.voice === 'shaker')).toBe(bar.energy === 2);
    }
  });

  it('plays the harp now and then, not all the time', () => {
    const bars = Array.from({ length: 200 }, composer(3).next);
    const harped = bars.filter((b) => b.notes.some((n) => n.voice === 'harp')).length;
    expect(harped).toBeGreaterThan(0);
    expect(harped).toBeLessThan(bars.length / 2);
    for (const bar of bars) expect(bar.notes.filter((n) => n.voice === 'harp').length).toBeLessThanOrEqual(4);
  });

  it('turns MIDI notes into pitches', () => {
    expect(hz(69)).toBe(440);
    expect(hz(57)).toBeCloseTo(220);
    expect(seeded(1)()).toBe(seeded(1)());
  });
});
