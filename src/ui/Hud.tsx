import { useEffect, useRef, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { DECKS, cardData } from '../cards/db';
import { data, findCard, label } from '../engine';
import type { Game, LogEntry, PlayerId, Step, StopKind } from '../engine';
import { ManaCost } from './Card';
import { useRem } from './rem';
import { useStore } from './store';
import { SEATS, cx, deckColor, hoverProps } from './util';
import { STEP_NAMES, cancel, useView } from './view';
import type { Btn } from './view';

// ---------- phase tracker + buttons (bottom right) ----------

const ICONS: Record<string, ReactNode> = {
  begin: <circle cx="12" cy="12" r="7" />,
  end: <path d="M20.5 14.5A9 9 0 1 1 9.5 3.5a7 7 0 0 0 11 11Z" />,
  main: <path d="M12 3 21 12 12 21 3 12Z" />,
  attack: <path d="M3 21l1-4.5L15.5 5 21 3l-2 5.5L7.5 20 3 21Zm1.5-9.5 8 8-1.5 1.5-8-8 1.5-1.5Z" />,
  block: <path d="M12 2 20 5v6c0 5.5-3.5 9-8 11-4.5-2-8-5.5-8-11V5Z" />,
  damage: <path d="M12 1l2.6 6.3L21 5l-2.3 6.4L23 14l-6.4.9L15 22l-3-5.7L9 22l-1.6-7.1L1 14l4.3-2.6L3 5l6.4 2.3Z" />,
};

/** One pip per part of the turn. Short steps share a pip with their neighbour. */
const PHASES: { steps: Step[]; icon: keyof typeof ICONS }[] = [
  { steps: ['untap', 'upkeep', 'draw'], icon: 'begin' },
  { steps: ['main1'], icon: 'main' },
  { steps: ['beginCombat', 'attackers'], icon: 'attack' },
  { steps: ['blockers'], icon: 'block' },
  { steps: ['damage', 'endCombat'], icon: 'damage' },
  { steps: ['main2'], icon: 'main' },
  { steps: ['end', 'cleanup'], icon: 'end' },
];

/** Short names for the steps a pip covers, shown when it is split into one button per step. */
const SHORT: Partial<Record<Step, string>> = {
  untap: 'Untap',
  upkeep: 'Upkeep',
  draw: 'Draw',
  beginCombat: 'Begin combat',
  attackers: 'Attackers',
  damage: 'Damage',
  endCombat: 'End combat',
  end: 'End step',
  cleanup: 'Cleanup',
};

/** No player gets priority in these steps (502.4, 514.3), so a stop there could never fire. */
const NO_PRIORITY: Step[] = ['untap', 'cleanup'];

/** Each click moves a stop on: none, stop if you can act, always stop, none. */
const STOP_CYCLE: (StopKind | undefined)[] = [undefined, 'ifAble', 'always'];
const nextStop = (k: StopKind | undefined) => STOP_CYCLE[(STOP_CYCLE.indexOf(k) + 1) % STOP_CYCLE.length];
const STOP_TEXT: Record<StopKind, string> = { ifAble: 'stop if you can act', always: 'always stop' };

/** The arrow for each seat, pointing at that side of the table. */
const ARROW_PATH: Record<(typeof SEATS)[number], string> = {
  bottom: 'M4 8h16l-8 9Z',
  left: 'M16 4v16l-9-8Z',
  top: 'M4 16h16l-8-9Z',
  right: 'M8 4v16l9-8Z',
};

const stopTitle = (step: Step, kind: StopKind | undefined) =>
  NO_PRIORITY.includes(step)
    ? `${STEP_NAMES[step]}: nobody gets priority here`
    : `${STEP_NAMES[step]}: ${kind ? STOP_TEXT[kind] : 'no stop'}. Click to change.`;

/**
 * The steps of the turn, and the human's stops. Clicking a pip sets or clears a stop
 * there; a pip covering several steps splits into one button per step first. The arrows
 * pick whose turns the stops are for. With none picked, the tracker follows the turn.
 */
function PhaseTracker() {
  const { g, me } = useView();
  const stops = useStore((s) => s.stops);
  const setStop = useStore((s) => s.setStop);
  const [seat, setSeat] = useState<PlayerId | null>(null);
  const [open, setOpen] = useState<number | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const editing = me !== null && seat !== null && !g.players[seat].lost ? seat : null;
  const turn = editing ?? g.active;
  const turnStops = me === null ? {} : (stops[turn] ?? {});
  const live = turn === g.active;

  // A split pip closes again on a click anywhere else.
  useEffect(() => {
    if (open === null) return;
    const onDown = (e: MouseEvent) => root.current?.contains(e.target as Node) || setOpen(null);
    window.addEventListener('mousedown', onDown);
    return () => window.removeEventListener('mousedown', onDown);
  }, [open]);

  const deckVar = (pid: PlayerId) => deckColor(g.players[pid].colors);
  // Your turn is orange and everyone else's blue; a picked arrow shows that player's deck colour.
  const tone = editing !== null ? { '--phase': deckVar(editing), '--phase-glow': deckVar(editing) } : g.active === 0 ? {} : { '--phase': '#8ccbff', '--phase-glow': '#2f8fff' };
  const strongest = (steps: Step[]) =>
    steps.some((s) => turnStops[s] === 'always') ? 'always' : steps.some((s) => turnStops[s] === 'ifAble') ? 'ifAble' : undefined;
  const whose = (pid: PlayerId) => (pid === me ? 'your' : `${g.players[pid].name}'s`);

  return (
    <div className={cx('phases', me !== null && 'editable')} ref={root} style={tone as CSSProperties}>
      {me !== null && (
        <div className="seat-arrows">
          {g.players.map((p) => (
            <button
              key={p.id}
              className={cx('seat-arrow', `arrow-${SEATS[p.id]}`, editing === p.id && 'on', g.active === p.id && 'active')}
              style={{ '--deck': deckVar(p.id) } as CSSProperties}
              disabled={p.lost}
              title={editing === p.id ? 'Back to the current turn' : `Set stops for ${whose(p.id)} turns`}
              onClick={() => setSeat(editing === p.id ? null : p.id)}
            >
              <svg viewBox="0 0 24 24">
                <path d={ARROW_PATH[SEATS[p.id]]} />
              </svg>
            </button>
          ))}
        </div>
      )}
      <div className="phase-main">
        {open !== null && (
          <div className="step-split">
            {PHASES[open].steps.map((step) => (
              <button
                key={step}
                className={cx('step-btn', live && g.step === step && 'on')}
                disabled={NO_PRIORITY.includes(step)}
                title={stopTitle(step, turnStops[step])}
                onClick={() => setStop(turn, step, nextStop(turnStops[step]))}
              >
                {SHORT[step]}
                <StopMark kind={turnStops[step]} />
              </button>
            ))}
          </div>
        )}
        <div className="phase-pips">
          {PHASES.map((p, i) => {
            const single = p.steps.length === 1;
            return (
              <button
                key={p.steps[0]}
                className={cx('pip-btn', open === i && 'open')}
                disabled={me === null}
                title={single ? stopTitle(p.steps[0], turnStops[p.steps[0]]) : `${p.steps.map((s) => STEP_NAMES[s]).join(', ')}: click to set stops`}
                onClick={() => (single ? setStop(turn, p.steps[0], nextStop(turnStops[p.steps[0]])) : setOpen(open === i ? null : i))}
              >
                <svg viewBox="0 0 24 24" className={cx('pip', live && p.steps.includes(g.step) && 'on')}>
                  {ICONS[p.icon]}
                </svg>
                <StopMark kind={strongest(p.steps)} />
              </button>
            );
          })}
        </div>
        <div className="phase-label">
          {editing !== null ? `Stops on ${whose(editing)} turns` : `Turn ${g.turn} · ${g.players[g.active].name} · ${STEP_NAMES[g.step]}`}
        </div>
      </div>
    </div>
  );
}

/** Under a pip or step: a ring for "stop if you can act", a dot for "always stop". */
function StopMark({ kind }: { kind: StopKind | undefined }) {
  return <span className={cx('stop-mark', kind && `stop-${kind}`)} />;
}

function Button({ btn, small }: { btn: Btn; small?: boolean }) {
  return (
    <button className={cx('btn', `btn-${btn.tone}`, small && 'small')} disabled={btn.disabled} onClick={btn.onClick}>
      <span className="btn-label">{btn.label}</span>
      {btn.sub && <span className="btn-sub">{btn.sub}</span>}
    </button>
  );
}

export function ActionBar() {
  const v = useView();
  const latest = useRef(v);
  latest.current = v;
  // Space/Enter = main button, Escape = cancel, like Arena.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // While the exit dialog is open the keys belong to it: Esc stays, Enter presses the focused button.
      if (useStore.getState().confirmExit) {
        if (e.code === 'Escape') useStore.setState({ confirmExit: false });
        return;
      }
      const { primary, secondary } = latest.current;
      if ((e.code === 'Space' || e.code === 'Enter') && primary && !primary.disabled) {
        // Drop focus first, or a button that was just clicked would also fire natively.
        e.preventDefault();
        (document.activeElement as HTMLElement | null)?.blur();
        primary.onClick();
      } else if (e.code === 'Escape') {
        if (useStore.getState().viewer) useStore.setState({ viewer: null });
        else if (secondary) secondary.onClick();
        else cancel();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  return (
    <div className="action-bar">
      <PhaseTracker />
      {v.secondary && <Button btn={v.secondary} small />}
      {v.primary && <Button btn={v.primary} />}
    </div>
  );
}

export function Prompt() {
  const { prompt } = useView();
  return (
    <AnimatePresence>
      {prompt && (
        <motion.div key={prompt} className="prompt" initial={{ opacity: 0, scaleX: 0.8 }} animate={{ opacity: 1, scaleX: 1 }} exit={{ opacity: 0 }}>
          {/* Mana costs like "{1}{B}" are drawn as symbols. */}
          {prompt.split(/((?:\{[^}]+\})+)/).map((part, i) => (part.startsWith('{') ? <ManaCost key={i} cost={part} /> : part))}
        </motion.div>
      )}
    </AnimatePresence>
  );
}

// ---------- log + controls (left gutter) ----------

const SPEEDS = [1, 2, 4];

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** A log line with the cards it names underlined. Hover one to see the card. */
function LogText({ entry }: { entry: LogEntry }) {
  if (!entry.cards?.length) return <>{entry.text}</>;
  // Longest names first, so a name that contains another is matched whole.
  const names = [...entry.cards].sort((a, b) => b.length - a.length).map(escapeRegExp);
  // Splitting on a capture group keeps the matches: they land at the odd indexes.
  const parts = entry.text.split(new RegExp(`(${names.join('|')})`));
  return (
    <>
      {parts.map((part, i) =>
        i % 2 ? (
          <span key={i} className="log-card" {...hoverProps(part)}>
            {part}
          </span>
        ) : (
          part
        ),
      )}
    </>
  );
}

export function LogPanel() {
  const g = useView().g;
  const show = useStore((s) => s.showLog);
  const speed = useStore((s) => s.speed);
  const lines = useRef<HTMLDivElement>(null);
  useEffect(() => {
    lines.current?.scrollTo({ top: lines.current.scrollHeight });
  }, [g.log.length, show]);
  const start = Math.max(0, g.log.length - 80);
  // The panel hangs from the bottom-left corner, so as the lines fold away the buttons ride down with them.
  return (
    <aside className="log">
      <div className="log-bar">
        <button onClick={() => useStore.setState({ showLog: !show })} aria-expanded={show}>
          {show ? 'Hide log' : 'Show log'}
        </button>
        <button onClick={() => useStore.setState({ speed: SPEEDS[(SPEEDS.indexOf(speed) + 1) % SPEEDS.length] })} title="Bot speed">
          Speed {speed}×
        </button>
        <button onClick={() => useStore.setState({ confirmExit: true })}>Exit</button>
      </div>
      <AnimatePresence initial={false}>
        {show && (
          <motion.div
            key="log"
            className="log-body"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.28, ease: [0.25, 1, 0.5, 1] }}
          >
            <div className="log-lines" ref={lines}>
              {g.log.slice(start).map((l, i) => {
                const color = l.player === undefined ? '#fff' : deckColor(g.players[l.player].colors);
                return (
                  <div key={start + i} className={cx('log-line', l.text.startsWith('Turn ') && 'turn')} style={{ '--deck': color } as CSSProperties}>
                    <LogText entry={l} />
                  </div>
                );
              })}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </aside>
  );
}

/** Asks before leaving a game in progress. */
export function ExitConfirm() {
  const open = useStore((s) => s.confirmExit);
  const stay = () => useStore.setState({ confirmExit: false });
  return (
    <AnimatePresence>
      {open && (
        <motion.div className="modal" onClick={stay} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
          <motion.div
            className="confirm"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="exit-title"
            onClick={(e) => e.stopPropagation()}
            initial={{ scale: 0.92 }}
            animate={{ scale: 1 }}
            exit={{ scale: 0.96 }}
          >
            <h2 id="exit-title">Leave this game?</h2>
            <p>The game ends here and you go back to the deck menu.</p>
            <div className="confirm-buttons">
              <button className="btn btn-plain small" onClick={stay} autoFocus>
                <span className="btn-label">Keep playing</span>
              </button>
              <button className="btn btn-attack small" onClick={() => useStore.getState().quit()}>
                <span className="btn-label">Exit</span>
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

// ---------- overlays ----------

/** The card element at a point on screen, as a hover target (or null if there is no card there). */
function cardAt(game: Game | null, at: Element | null) {
  const el = at?.closest<HTMLElement>('[data-card]');
  const card = el && game && findCard(game, el.dataset.card!);
  return el && card ? { name: card.name, el } : null;
}

/** Big readable copy of whatever card the pointer is over, placed beside it. */
export function Preview() {
  const hover = useStore((s) => s.hover);
  const game = useStore((s) => s.game);
  const pointer = useRef({ x: -1, y: -1 });
  const shown = useRef<{ left: number; top: number; width: number } | null>(null);

  // While a preview is up, follow the pointer itself: a card can slide out from under it
  // (a tapped land joining another stack) without the browser sending a mouseleave.
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      pointer.current = { x: e.clientX, y: e.clientY };
      const s = useStore.getState();
      if (s.hover && !s.hover.el.contains(e.target as Node)) useStore.setState({ hover: cardAt(s.game, e.target as Element) });
    };
    window.addEventListener('mousemove', onMove);
    return () => window.removeEventListener('mousemove', onMove);
  }, []);

  // The hovered card can be redrawn as a new element, or leave play, with no mouse event at
  // all. Move the preview to whatever card is under the pointer now.
  useEffect(() => {
    if (!hover || hover.el.isConnected) return;
    useStore.setState({ hover: cardAt(game, document.elementFromPoint(pointer.current.x, pointer.current.y)) });
  }, [game, hover]);

  if (!hover) return null;
  // For the one render where the old element is gone, stay where the preview last was, so it doesn't blink.
  if (hover.el.isConnected) {
    const rem = parseFloat(getComputedStyle(document.documentElement).fontSize);
    const r = hover.el.getBoundingClientRect();
    const width = 27 * rem;
    const height = width * 1.395;
    const gap = 1.5 * rem;
    const left = r.right + gap + width > window.innerWidth - gap ? r.left - gap - width : r.right + gap;
    const top = Math.max(gap, Math.min(r.top + r.height / 2 - height / 2, window.innerHeight - height - gap));
    shown.current = { left, top, width };
  }
  if (!shown.current) return null;
  return (
    <div className="preview" key={hover.name} style={shown.current}>
      <img src={cardData(hover.name).image} alt={cardData(hover.name).name} />
    </div>
  );
}

/**
 * The stack: spells and abilities waiting to resolve, oldest at the back. It only shows
 * while the game is waiting on someone; a spell nobody responds to resolves at once.
 * A spell or ability the human is paying for hovers in front, where it goes once paid.
 */
export function StackPanel() {
  const { g, me, paying } = useView();
  if ((!g.stack.length && !paying) || g.step === 'gameOver') return null;
  return (
    <div className="stack-panel">
      {g.stack.length > 0 && <div className="stack-title">Stack</div>}
      {g.stack.map((item, i) => {
        const who = item.controller === me ? 'Your' : `${g.players[item.controller].name}'s`;
        return (
          <div
            key={item.id}
            data-stack={item.id}
            className={cx('stack-item', i === g.stack.length - 1 && !paying && 'top')}
            {...hoverProps(item.card.name)}
          >
            <img src={data(item.card).image} alt={label(item.card)} draggable={false} />
            <span className="stack-tag">
              {who} {item.kind === 'spell' ? 'spell' : 'ability'}
            </span>
          </div>
        );
      })}
      {paying && (
        <div key={`paying-${paying.card.id}`} className="stack-item top paying" {...hoverProps(paying.card.name)}>
          <img src={data(paying.card).image} alt={label(paying.card)} draggable={false} />
          <span className="stack-tag">Pay to {paying.kind === 'spell' ? 'cast' : 'activate'}</span>
        </div>
      )}
    </div>
  );
}

/** Briefly shows each spell as it is cast. While something is waiting on the stack, the stack panel shows it instead. */
export function SpellFlash() {
  const { g, me } = useView();
  const speed = useStore((s) => s.speed);
  const rem = useRem();
  const spell = g.lastSpell;
  const [shown, setShown] = useState<typeof spell>(null);
  useEffect(() => {
    if (!spell) return;
    setShown(spell);
    const t = setTimeout(() => setShown(null), 1600 / speed);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spell?.seq]);
  return (
    <AnimatePresence>
      {shown && !g.stack.length && (
        <motion.div
          key={shown.seq}
          className="spell-flash"
          initial={{ opacity: 0, x: 8 * rem, scale: 0.8 }}
          animate={{ opacity: 1, x: 0, scale: 1 }}
          exit={{ opacity: 0, scale: 0.9 }}
        >
          <div className="spell-caster">{shown.caster === me ? 'You cast' : `${g.players[shown.caster].name} casts`}</div>
          <img src={cardData(shown.name).image} alt={cardData(shown.name).name} draggable={false} />
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/** Lines from attackers to the player they attack, from blockers to what they block, and from the stack to targets. */
export function ArrowLayer() {
  const g = useView().g;
  const svg = useRef<SVGSVGElement>(null);
  const arrows = (g.combat?.attacks ?? []).flatMap((a) => [
    { key: `a-${a.id}-${a.defender}`, from: `[data-card="${a.id}"]`, to: `[data-avatar="${a.defender}"]`, kind: 'attack' },
    ...a.blockers.map((b) => ({ key: `b-${b}-${a.id}`, from: `[data-card="${b}"]`, to: `[data-card="${a.id}"]`, kind: 'block' })),
  ]);
  for (const item of g.stack) {
    for (const t of item.targets) {
      if (!t) continue;
      const to = t.kind === 'card' ? `[data-card="${t.id}"]` : `[data-avatar="${t.id}"]`;
      arrows.push({ key: `t-${item.id}-${t.kind}-${t.id}`, from: `[data-stack="${item.id}"]`, to, kind: 'target' });
    }
  }
  const signature = arrows.map((a) => a.key).join();

  // Cards animate into place, so follow them every frame while combat is on screen.
  useEffect(() => {
    if (!signature) return;
    let raf = 0;
    const tick = () => {
      const root = svg.current;
      if (root) {
        const box = root.getBoundingClientRect();
        root.querySelectorAll<SVGPathElement>('path[data-from]').forEach((p) => {
          const a = document.querySelector(p.dataset.from!)?.getBoundingClientRect();
          const b = document.querySelector(p.dataset.to!)?.getBoundingClientRect();
          if (!a || !b) return p.setAttribute('d', '');
          const x1 = a.left + a.width / 2 - box.left;
          const y1 = a.top + a.height / 2 - box.top;
          const x2 = b.left + b.width / 2 - box.left;
          const y2 = b.top + b.height / 2 - box.top;
          const len = Math.hypot(x2 - x1, y2 - y1) || 1;
          const trim = Math.min(b.width, b.height) * 0.5;
          const ex = x2 - ((x2 - x1) / len) * trim;
          const ey = y2 - ((y2 - y1) / len) * trim;
          const bend = 0.1;
          p.setAttribute('d', `M${x1} ${y1} Q${(x1 + ex) / 2 + (ey - y1) * bend} ${(y1 + ey) / 2 - (ex - x1) * bend} ${ex} ${ey}`);
        });
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [signature]);

  return (
    <svg ref={svg} className="arrows">
      <defs>
        {['attack', 'block', 'target'].map((kind) => (
          <marker key={kind} id={`head-${kind}`} viewBox="0 0 10 10" refX="7" refY="5" markerWidth="4" markerHeight="4" orient="auto-start-reverse">
            <path d="M0 0 10 5 0 10Z" className={`head-${kind}`} />
          </marker>
        ))}
      </defs>
      {arrows.map((a) => (
        <path key={a.key} data-from={a.from} data-to={a.to} className={`line-${a.kind}`} markerEnd={`url(#head-${a.kind})`} />
      ))}
    </svg>
  );
}

export function ZoneViewer() {
  const viewer = useStore((s) => s.viewer);
  const g = useView().g;
  if (!viewer) return null;
  const p = g.players[viewer.pid];
  const cards = [...p[viewer.zone]].reverse();
  return (
    <div className="modal" onClick={() => useStore.setState({ viewer: null })}>
      <div className="viewer">
        <h2>
          {p.name === 'You' ? 'Your' : `${p.name}'s`} {viewer.zone} ({cards.length})
        </h2>
        <div className="viewer-cards">
          {cards.map((c) => (
            <img key={c.id} src={data(c).image} alt={data(c).name} draggable={false} />
          ))}
        </div>
      </div>
    </div>
  );
}

export function GameOver() {
  const { g, me } = useView();
  const { quit } = useStore.getState();
  if (g.step !== 'gameOver') {
    // Knocked out while the others play on.
    return me !== null && g.players[me].lost ? (
      <div className="knocked-out">
        You have been defeated — the table plays on.
        <button onClick={quit}>Leave game</button>
      </div>
    ) : null;
  }
  return <Results />;
}

/** The end-of-game screen. It can be hidden to look over the final board. Mounted only once the game is over, so each game starts with it showing. */
function Results() {
  const { g, me } = useView();
  const { start, quit } = useStore.getState();
  const [hidden, setHidden] = useState(false);
  if (hidden) {
    return (
      <button className="btn btn-go small results-show" onClick={() => setHidden(false)}>
        <span className="btn-label">Show Results</span>
      </button>
    );
  }
  const winner = g.winner === 'draw' || g.winner === null ? null : g.players[g.winner];
  const title = !winner ? 'Draw' : me === null ? `${winner.name} wins` : winner.id === me ? 'Victory' : 'Defeat';
  const deck = me === null ? null : DECKS.findIndex((d) => d.id === g.players[me].deckId);
  return (
    <div className="modal">
      <motion.div className={cx('game-over', winner?.id === me && 'won')} initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }}>
        <h1>{title}</h1>
        {winner && (
          <p>
            {winner.name === 'You' ? 'You win' : `${winner.name} wins`} with {winner.commanders.join(' and ')} on turn {g.turn}.
          </p>
        )}
        <div className="game-over-buttons">
          <button className="btn btn-go small" onClick={() => start(deck)}>
            <span className="btn-label">Play Again</span>
          </button>
          <button className="btn btn-plain small" onClick={() => setHidden(true)}>
            <span className="btn-label">View Board</span>
          </button>
          <button className="btn btn-plain small" onClick={quit}>
            <span className="btn-label">Menu</span>
          </button>
        </div>
      </motion.div>
    </div>
  );
}
