import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { MotionGlobalConfig } from 'motion/react';
import 'mana-font/css/mana.min.css';
import './ui/styles.css';
import './ui/fullscreen';
import { App } from './ui/App';
import { useStore } from './ui/store';

// Dev console helpers: `store` exposes the game state, and
// `motionConfig.skipAnimations = true` makes every move instant.
if (import.meta.env.DEV) Object.assign(window, { store: useStore, motionConfig: MotionGlobalConfig });

// Pressed cursor (`.pressing` in styles.css) while any mouse button is down. Checking `buttons`
// on every pointer event also clears it after a release outside the window.
const syncPressed = (e: PointerEvent) => document.documentElement.classList.toggle('pressing', e.buttons !== 0);
for (const type of ['pointerdown', 'pointerup', 'pointermove', 'pointercancel'] as const) {
  window.addEventListener(type, syncPressed, { capture: true, passive: true });
}

// Cards fetched from Scryfall for pasted decks, kept from earlier visits.
void useStore.getState().loadCards();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
