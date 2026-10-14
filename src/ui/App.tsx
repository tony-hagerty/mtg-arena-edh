import { MotionConfig } from 'motion/react';
import { GameScreen } from './GameScreen';
import { Menu } from './Menu';
import { useStore } from './store';

export function App() {
  const playing = useStore((s) => s.game !== null);
  // reducedMotion="user": people who ask their OS for less motion get instant moves.
  return <MotionConfig reducedMotion="user">{playing ? <GameScreen /> : <Menu />}</MotionConfig>;
}
