import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { MotionGlobalConfig } from 'motion/react';
import 'mana-font/css/mana.min.css';
import './ui/styles.css';
import { App } from './ui/App';
import { useStore } from './ui/store';

// Dev console helpers: `store` exposes the game state, and
// `motionConfig.skipAnimations = true` makes every move instant.
if (import.meta.env.DEV) Object.assign(window, { store: useStore, motionConfig: MotionGlobalConfig });

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
