import { Suspense, lazy, useCallback, useEffect, useMemo, useState } from 'react';
import { realSchedule, scheduleBot } from '../engine';
import type { Player, Schedule } from '../engine';
import { PlayerHand, SeatHud } from './Board';
import { BoardSplash, SPLASH_MAX_MS, laterStep } from './BoardSplash';
import type { BoardStep } from './BoardSplash';
import { CAN_DRAW_3D } from './camera';
import { Flights } from './Flights';
import { ActionBar, ArrowLayer, ExitConfirm, GameOver, HotkeysDialog, LogPanel, Preview, Prompt, SpellFlash, StackPanel, ZoneViewer } from './Hud';
import { GameVotes, PausedOverlay } from './LobbyScreen';
import { Decisions, DelvePicker, EscapePicker, GraveCostPicker, GraveyardTargets } from './Picker';
import { useStore } from './store';
import { fromSeat } from './util';
import { ViewContext, buildView } from './view';

/** The table (src/ui/three/Table3D.tsx), loaded only once a game is drawn, so the menu never waits for the 3D libraries. */
const Table3D = lazy(() => import('./three/Table3D'));

/**
 * The 3D table, with the splash over the board until it has drawn (BoardSplash.tsx). Its code
 * loads and its renderer starts only once a game is on, which takes a few seconds the first time.
 */
function Board3D({ players }: { players: Player[] }) {
  const [step, setStep] = useState<BoardStep>('loading');
  const progress = useCallback((next: BoardStep) => setStep((s) => laterStep(s, next)), []);
  useEffect(() => {
    const t = setTimeout(() => progress('drawn'), SPLASH_MAX_MS);
    return () => clearTimeout(t);
  }, [progress]);
  return (
    <>
      <Suspense fallback={null}>
        <Table3D players={players} onProgress={progress} />
      </Suspense>
      <BoardSplash step={step} />
    </>
  );
}

/** In the table's place, for a browser that can't draw it (`CAN_DRAW_3D`). */
function NoTable() {
  return (
    <div className="modal">
      <div className="game-over">
        <h1>This browser can't draw the table</h1>
        <p>The table needs WebGL 2, which every current browser has. Try another browser, or turn hardware acceleration on in this one.</p>
      </div>
    </div>
  );
}

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
  return (
    <ViewContext.Provider value={view}>
      <div className="stage board">
        {/* The table, leaning away from you (camera.ts): the seats' cards, piles and held hands, drawn in 3D. The portraits, your hand and the HUD stay flat, in screen space. */}
        {CAN_DRAW_3D ? (
          <Board3D players={players} />
        ) : (
          <NoTable />
        )}
        {players.map((p) => (
          <SeatHud key={p.id} player={p} you={p === bottom} />
        ))}
        <PlayerHand player={bottom} />
        {/* Cards moving between zones over the screen; arrivals on the table fly in the scene (Table3D.tsx). */}
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
        <HotkeysDialog />
        <Handoff />
        <GameVotes />
      </div>
      <Preview />
    </ViewContext.Provider>
  );
}
