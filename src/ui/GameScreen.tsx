import { Suspense, lazy, useEffect, useMemo, useState } from 'react';
import type { CSSProperties } from 'react';
import { realSchedule, scheduleBot } from '../engine';
import type { Schedule } from '../engine';
import { PlayerHand, Seat, SeatHud } from './Board';
import { DEPTH, TABLE_3D, TILT, useTableSize } from './camera';
import { Flights } from './Flights';
import { ActionBar, ArrowLayer, ExitConfirm, GameOver, LogPanel, Preview, Prompt, SpellFlash, StackPanel, ZoneViewer } from './Hud';
import { GameVotes, PausedOverlay } from './LobbyScreen';
import { Decisions, DelvePicker, EscapePicker, GraveCostPicker, GraveyardTargets } from './Picker';
import { useStore } from './store';
import { fromSeat } from './util';
import { ViewContext, buildView } from './view';

/** The 3D table (`TABLE_3D`), loaded only when it is drawn, so the CSS table (`?table=css`) never downloads the 3D libraries. */
const Table3D = lazy(() => import('./three/Table3D'));

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

  // A bot's thinking or move that threw, thrown again while drawing so the error screen shows
  // it (`ErrorBoundary`): a timer's error never reaches the boundary by itself.
  const [botError, setBotError] = useState<unknown>(null);
  if (botError) throw botError;

  // Bot driver: whenever a bot has the decision, let it act after a short, readable pause.
  // It thinks inside its timer, off the frame that draws the last move (see `scheduleBot`).
  useEffect(() => {
    // With a game server, the server plays the bots.
    if (useStore.getState().server || game.step === 'gameOver' || !game.players[game.priority].isBot) return;
    const guarded: Schedule = (fn, ms) =>
      realSchedule(() => {
        try {
          fn();
        } catch (err) {
          setBotError(err ?? new Error('Unknown error'));
        }
      }, ms);
    return scheduleBot(game, speed, (action) => useStore.getState().botAct(action), guarded, true);
  }, [game, speed]);

  // You sit at the bottom; the others sit clockwise in turn order after you (see `seatOf`).
  const players = fromSeat(game.players, human);
  const bottom = players[0];
  const table = useTableSize();
  return (
    <ViewContext.Provider value={view}>
      <div className="stage board" style={{ '--tilt': `${TILT}deg`, '--depth': `${DEPTH}rem`, '--table-h': `${table.h}rem` } as CSSProperties}>
        {/* The table, leaning away from you (camera.ts): the seats' rows. The portraits, piles, hands and the HUD stay flat, in screen space. */}
        {TABLE_3D ? (
          <Suspense fallback={null}>
            <Table3D players={players} />
          </Suspense>
        ) : (
          <div className="table">
            {players.map((p) => (
              <Seat key={p.id} player={p} />
            ))}
            {/* Cards flying to somewhere on the table land here, over everything on it (Flights). */}
            <div className="flights-table" />
          </div>
        )}
        {players.map((p) => (
          <SeatHud key={p.id} player={p} you={p === bottom} />
        ))}
        <PlayerHand player={bottom} />
        {/* Cards moving between zones; the ones bound for the table fly on it (.flights-table), the rest over the screen. */}
        <Flights />
        <Prompt />
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
