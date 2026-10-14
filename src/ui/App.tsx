import { MotionConfig } from 'motion/react';
import { GameScreen } from './GameScreen';
import { Menu } from './Menu';
import { useStore } from './store';

export function App() {
  const playing = useStore((s) => s.game !== null);
  // Keyed on the game number: "Play Again" remounts the table, so nothing carries over from
  // the last game (like the avatars' life totals, which would show a big +/- jump).
  const gameNo = useStore((s) => s.gameNo);
  // reducedMotion="user": people who ask their OS for less motion get instant moves.
  return <MotionConfig reducedMotion="user">{playing ? <GameScreen key={gameNo} /> : <Menu />}</MotionConfig>;
}
