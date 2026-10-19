import { MotionConfig } from 'motion/react';
import { ErrorBoundary } from './ErrorScreen';
import { GameScreen } from './GameScreen';
import { Menu } from './Menu';
import { useStore } from './store';

export function App() {
  const playing = useStore((s) => s.game !== null);
  // Keyed on the game number: "Play Again" remounts the table, so nothing carries over from
  // the last game (like the avatars' life totals, which would show a big +/- jump).
  const gameNo = useStore((s) => s.gameNo);
  // reducedMotion="user": people who ask their OS for less motion get instant moves.
  // An error while drawing shows the error screen instead of a blank page; each screen has
  // its own, so leaving the table to the menu starts the menu afresh.
  return (
    <MotionConfig reducedMotion="user">
      {playing ? (
        <ErrorBoundary key={`game-${gameNo}`} where="game">
          <GameScreen />
        </ErrorBoundary>
      ) : (
        <ErrorBoundary key="menu" where="menu">
          <Menu />
        </ErrorBoundary>
      )}
    </MotionConfig>
  );
}
