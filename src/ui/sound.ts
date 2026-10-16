// Interface sounds (no music), synthesized in synth.ts. Clicks on buttons and target-glowing
// cards are heard from one listener here; hand cards play their own (Card.tsx), and the
// game's moves are heard by watching the store's game.
import { gameSound } from './game-sounds';
import type { Sound } from './game-sounds';
import { useStore } from './store';
import { synth } from './synth';

export type { Sound } from './game-sounds';

/** The same sound again this soon (ms) is skipped, so fast bots and quick hovers don't stutter. */
const GAP = 70;

let ctx: AudioContext | null = null;
const lastPlayed = new Map<Sound, number>();

/**
 * Plays a sound at the human's volume. Browsers keep a page silent until the first click or
 * key press, so a sound before then is simply not heard.
 */
export function play(name: Sound | null): void {
  if (!name) return;
  const { volume, muted } = useStore.getState().settings;
  if (muted || volume <= 0 || typeof AudioContext === 'undefined') return;
  const now = performance.now();
  if (now - (lastPlayed.get(name) ?? -Infinity) < GAP) return;
  lastPlayed.set(name, now);
  ctx ??= new AudioContext();
  const audio = ctx;
  const start = () => {
    const out = audio.createGain();
    out.gain.value = volume;
    out.connect(audio.destination);
    synth(audio, out, name);
  };
  if (audio.state === 'running') start();
  else void audio.resume().then(start, () => {});
}

/** The sound for a click on `el`, or null. Disabled buttons don't fire clicks at all. */
function clickSound(el: Element): Sound | null {
  // A control that plays its own sound.
  if (el.closest('[data-silent]')) return null;
  if (el.closest('.glow-target')) return 'select';
  // The empty table itself, or an empty stretch of a battlefield row.
  if (el.matches('.board, .board .row')) return 'board';
  const button = el.closest('button');
  if (!button) return null;
  if (button.matches('.btn-go, .btn-attack')) return 'confirm';
  if (button.matches('.btn-cancel')) return 'cancel';
  return 'click';
}

// Capture, so a click that closes or swaps its own button is still heard.
window.addEventListener('click', (e) => e.target instanceof Element && play(clickSound(e.target)), { capture: true });

useStore.subscribe((s, prev) => {
  if (s.game && s.game !== prev.game) play(gameSound(prev.game, s.game, s.human));
});
