import { useEffect, useRef, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { DECKS, cardData } from '../cards/db';
import { data, findCard } from '../engine';
import type { Game, Step } from '../engine';
import { useRem } from './rem';
import { useStore } from './store';
import { cx } from './util';
import { cancel, useView } from './view';
import type { Btn } from './view';

// ---------- phase tracker + buttons (bottom right) ----------

const ICONS: Record<string, ReactNode> = {
  main: <path d="M12 3 21 12 12 21 3 12Z" />,
  attack: <path d="M3 21l1-4.5L15.5 5 21 3l-2 5.5L7.5 20 3 21Zm1.5-9.5 8 8-1.5 1.5-8-8 1.5-1.5Z" />,
  block: <path d="M12 2 20 5v6c0 5.5-3.5 9-8 11-4.5-2-8-5.5-8-11V5Z" />,
  damage: <path d="M12 1l2.6 6.3L21 5l-2.3 6.4L23 14l-6.4.9L15 22l-3-5.7L9 22l-1.6-7.1L1 14l4.3-2.6L3 5l6.4 2.3Z" />,
};

const PHASES: { step: Step; icon: keyof typeof ICONS; label: string }[] = [
  { step: 'main1', icon: 'main', label: 'Main phase' },
  { step: 'attackers', icon: 'attack', label: 'Declare attackers' },
  { step: 'blockers', icon: 'block', label: 'Declare blockers' },
  { step: 'damage', icon: 'damage', label: 'Combat damage' },
  { step: 'main2', icon: 'main', label: 'Second main phase' },
];

function PhaseTracker() {
  const g = useView().g;
  const current = PHASES.find((p) => p.step === g.step);
  return (
    <div className="phases">
      <div className="phase-pips">
        {PHASES.map((p) => (
          <svg key={p.step} viewBox="0 0 24 24" className={cx('pip', p.step === g.step && 'on')}>
            {ICONS[p.icon]}
          </svg>
        ))}
      </div>
      <div className="phase-label">
        Turn {g.turn} · {g.players[g.active].name} · {current?.label ?? (g.step === 'discard' ? 'End step' : 'Game over')}
      </div>
    </div>
  );
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
          {prompt}
        </motion.div>
      )}
    </AnimatePresence>
  );
}

// ---------- log + controls (left gutter) ----------

const SPEEDS = [1, 2, 4];

export function LogPanel() {
  const g = useView().g;
  const show = useStore((s) => s.showLog);
  const speed = useStore((s) => s.speed);
  const lines = useRef<HTMLDivElement>(null);
  useEffect(() => {
    lines.current?.scrollTo({ top: lines.current.scrollHeight });
  }, [g.log.length, show]);
  const start = Math.max(0, g.log.length - 80);
  return (
    <aside className="log">
      <div className="log-bar">
        <button onClick={() => useStore.setState({ showLog: !show })}>{show ? 'Hide log' : 'Show log'}</button>
        <button onClick={() => useStore.setState({ speed: SPEEDS[(SPEEDS.indexOf(speed) + 1) % SPEEDS.length] })} title="Bot speed">
          Speed {speed}×
        </button>
        <button onClick={() => useStore.getState().quit()}>Menu</button>
      </div>
      {show && (
        <div className="log-lines" ref={lines}>
          {g.log.slice(start).map((l, i) => {
            const color = l.player === undefined ? '#fff' : `var(--f-${DECKS.find((d) => d.id === g.players[l.player!].deckId)!.color})`;
            return (
              <div key={start + i} className={cx('log-line', l.text.startsWith('Turn ') && 'turn')} style={{ '--deck': color } as CSSProperties}>
                {l.text}
              </div>
            );
          })}
        </div>
      )}
    </aside>
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

/** Briefly shows each spell as it is cast (the prototype has no interactive stack). */
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
      {shown && (
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

/** Lines from attackers to the player they attack, and from blockers to what they block. */
export function ArrowLayer() {
  const g = useView().g;
  const svg = useRef<SVGSVGElement>(null);
  const arrows = (g.combat?.attacks ?? []).flatMap((a) => [
    { key: `a-${a.id}-${a.defender}`, from: `[data-card="${a.id}"]`, to: `[data-avatar="${a.defender}"]`, kind: 'attack' },
    ...a.blockers.map((b) => ({ key: `b-${b}-${a.id}`, from: `[data-card="${b}"]`, to: `[data-card="${a.id}"]`, kind: 'block' })),
  ]);
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
        {['attack', 'block'].map((kind) => (
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
  const { start, quit } = useStore.getState();
  if (g.step !== 'gameOver') {
    // Knocked out while the others play on.
    return me !== null && g.players[me].lost ? (
      <div className="knocked-out">
        You have been defeated — the table plays on.
        <button onClick={quit}>Leave game</button>
      </div>
    ) : null;
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
            {winner.name === 'You' ? 'You win' : `${winner.name} wins`} with {winner.commander} on turn {g.turn}.
          </p>
        )}
        <div className="game-over-buttons">
          <button className="btn btn-go small" onClick={() => start(deck)}>
            <span className="btn-label">Play Again</span>
          </button>
          <button className="btn btn-plain small" onClick={quit}>
            <span className="btn-label">Menu</span>
          </button>
        </div>
      </motion.div>
    </div>
  );
}
