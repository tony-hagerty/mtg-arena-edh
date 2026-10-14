import { useEffect, useMemo } from 'react';
import { botAction } from '../engine';
import { OpponentPanel, PlayerField } from './Board';
import { ActionBar, ArrowLayer, ExitConfirm, GameOver, LogPanel, Preview, Prompt, SpellFlash, StackPanel, ZoneViewer } from './Hud';
import { Decisions } from './Picker';
import { useStore } from './store';
import { ViewContext, buildView } from './view';

export function GameScreen() {
  const game = useStore((s) => s.game)!;
  const human = useStore((s) => s.human);
  const targeting = useStore((s) => s.targeting);
  const attackTarget = useStore((s) => s.attackTarget);
  const pickedBlockers = useStore((s) => s.pickedBlockers);
  const speed = useStore((s) => s.speed);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const view = useMemo(buildView, [game, human, targeting, attackTarget, pickedBlockers]);

  // Bot driver: whenever a bot has the decision, let it act after a short, readable pause.
  useEffect(() => {
    if (game.step === 'gameOver' || !game.players[game.priority].isBot) return;
    const action = botAction(game, game.priority);
    const quick = action.type === 'pass' || action.type === 'keep' || action.type === 'orderTriggers';
    const pause = quick ? 450 : action.type.includes('declare') ? 320 : 1000;
    const t = setTimeout(() => useStore.getState().botAct(action), pause / speed);
    return () => clearTimeout(t);
  }, [game, speed]);

  // Seat 0 is always at the bottom; the others sit clockwise in turn order: left, top, right.
  const [bottom, ...others] = game.players;
  return (
    <ViewContext.Provider value={view}>
      <div className="stage board">
        {others.map((p) => (
          <OpponentPanel key={p.id} player={p} />
        ))}
        <PlayerField player={bottom} />
        <Prompt />
        <LogPanel />
        <ActionBar />
        <StackPanel />
        <ArrowLayer />
        <SpellFlash />
        <ZoneViewer />
        <Decisions />
        <GameOver />
        <ExitConfirm />
      </div>
      <Preview />
    </ViewContext.Provider>
  );
}
