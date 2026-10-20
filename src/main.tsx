import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { MotionGlobalConfig } from 'motion/react';
import 'mana-font/css/mana.min.css';
import './ui/styles.css';
import './ui/fullscreen';
import './ui/sound';
import './ui/music';
import { App } from './ui/App';
import { watchPageErrors } from './ui/crash';
import { connectLobby } from './ui/lobby';
import { connectServer } from './ui/remote';
import { useStore } from './ui/store';

// Dev console helpers: `store` exposes the game state, and
// `motionConfig.skipAnimations = true` makes every move instant.
if (import.meta.env.DEV) Object.assign(window, { store: useStore, motionConfig: MotionGlobalConfig });

// The pressed-in arrow while a mouse button is held (`.pressed` in styles.css), on the one
// element under the pointer and nothing else: changing an element's cursor repaints it, so
// switching the cursor for the whole page (a class on <html> used to) repainted and
// re-rastered the whole screen on every press and release, and :active churns during a
// drag. Not on a floor-sized element either: repainting the table is the cost to avoid.
const FLOOR = 'html, body, #root, .stage, .table, .seat, .row, .seat-hud, .seat-zones, .seat-avatar, .opp-hand, .opp-fan, .modal, .preview-backdrop';
window.addEventListener(
  'pointerdown',
  (e) => {
    const target = e.target;
    if (!(target instanceof Element) || target.matches(FLOOR)) return;
    target.classList.add('pressed');
    const release = () => {
      target.classList.remove('pressed');
      window.removeEventListener('pointerup', release, true);
      window.removeEventListener('pointercancel', release, true);
    };
    window.addEventListener('pointerup', release, true);
    window.addEventListener('pointercancel', release, true);
  },
  { capture: true, passive: true },
);

// Errors nothing else caught go to the program's log (crash.ts); drawing errors show the error screen (App).
watchPageErrors();

// Cards fetched from Scryfall for pasted decks, kept from earlier visits.
void useStore.getState().loadCards();

// The game server, when the page came from one (the Windows program, or `npm run dev`),
// then its lobby: a table's game is played through that server.
void useStore
  .getState()
  .connect(connectServer)
  .then(() => useStore.getState().connectLobby(connectLobby));

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
