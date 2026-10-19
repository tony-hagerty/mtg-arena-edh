import { useEffect, useMemo } from 'react';
import { botAction, botPause } from '../engine';
import { OpponentPanel, PlayerField } from './Board';
import { ActionBar, ArrowLayer, ManaPicker, ExitConfirm, GameOver, LogPanel, Preview, Prompt, SpellFlash, StackPanel, ZoneViewer } from './Hud';
import { GameVotes, PausedOverlay } from './LobbyScreen';
import { Decisions, DelvePicker, EscapePicker, GraveCostPicker, GraveyardTargets } from './Picker';
import { useStore } from './store';
import { fromSeat } from './util';
import { ViewContext, buildView } from './view';

/**
 * Covers the table while the screen passes to the next person at it, so nobody sees
 * another player's hand (402.3).
 */
function Handoff() {
  const handoff = useStore((s) => s.handoff);
  const game = useStore((s) => s.game);
  const takeOver = useStore((s) => s.takeOver);
  if (handoff === null || !game) return null;
  return (
    <div className="modal handoff">
      <div className="game-over">
        <h1>Pass to {game.players[handoff].name}</h1>
        <p>{game.players[handoff].name} has a decision to make.</p>
        <div className="game-over-buttons">
          <button className="btn btn-go small" onClick={takeOver}>
            <span className="btn-label">I'm {game.players[handoff].name}</span>
          </button>
        </div>
      </div>
    </div>
  );
}

export function GameScreen() {
  const game = useStore((s) => s.game)!;
  const human = useStore((s) => s.human);
  const targeting = useStore((s) => s.targeting);
  const attackTarget = useStore((s) => s.attackTarget);
  const pickedBlockers = useStore((s) => s.pickedBlockers);
  const speed = useStore((s) => s.speed);
  // The stops and full control change the prompt and where the Next button says it goes.
  const stops = useStore((s) => s.stops);
  const fullControl = useStore((s) => s.fullControl);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const view = useMemo(buildView, [game, human, targeting, attackTarget, pickedBlockers, stops, fullControl]);

  // Bot driver: whenever a bot has the decision, let it act after a short, readable pause.
  useEffect(() => {
    // With a game server, the server plays the bots.
    if (useStore.getState().server || game.step === 'gameOver' || !game.players[game.priority].isBot) return;
    const action = botAction(game, game.priority);
    const t = setTimeout(() => useStore.getState().botAct(action), botPause(action) / speed);
    return () => clearTimeout(t);
  }, [game, speed]);

  // You sit at the bottom; the others sit clockwise in turn order after you (see `seatOf`).
  const [bottom, ...others] = fromSeat(game.players, human);
  return (
    <ViewContext.Provider value={view}>
      <div className="stage board">
        {others.map((p) => (
          <OpponentPanel key={p.id} player={p} />
        ))}
        <PlayerField player={bottom} />
        <Prompt />
        <ManaPicker />
        <LogPanel />
        <ActionBar />
        <StackPanel />
        <ArrowLayer />
        <SpellFlash />
        <ZoneViewer />
        <Decisions />
        <EscapePicker />
        <DelvePicker />
        <GraveCostPicker />
        <GraveyardTargets />
        <GameOver />
        {/* Before the exit dialog, so leaving a paused game still asks first. */}
        <PausedOverlay />
        <ExitConfirm />
        <Handoff />
        <GameVotes />
      </div>
      <Preview />
    </ViewContext.Provider>
  );
}
