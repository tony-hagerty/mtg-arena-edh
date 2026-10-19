import { useEffect, useRef, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { cardData } from '../cards/db';
import { data, findCard, label, triggerText } from '../engine';
import type { CardData, Game, LogEntry, PlayerId, Step, StopKind } from '../engine';
import { CardImage, ManaCost } from './TextCard';
import { useRem } from './rem';
import { play } from './sound';
import { MusicControl, SoundControl } from './SoundControl';
import { useStore } from './store';
import type { Hover } from './store';
import { type Seat, cx, deckColor, faceUp, hoverProps, seatOf } from './util';
import { STEP_NAMES, activateFromHand, cancel, clickStackItem, pickAbility, pickMana, pickTapCreature, pickManaDiscard, pickManaSacrifice, pickFace, pickMode, playHandCard, setAbilityX, setChoices, shiftDivision, exileForMana, plotCard, useView } from './view';
import type { AbilityOption, Btn } from './view';
import { leftStack, newGame } from './zone-moves';

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
const ARROW_PATH: Record<Seat, string> = {
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
  // Your stops are kept by seat counted from yours, so they follow you to any seat (see `absoluteStops`).
  const rel = me === null ? 0 : (turn - me + g.players.length) % g.players.length;
  const turnStops = me === null ? {} : (stops[rel] ?? {});
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
  const tone = editing !== null ? { '--phase': deckVar(editing), '--phase-glow': deckVar(editing) } : g.active === me ? {} : { '--phase': '#8ccbff', '--phase-glow': '#2f8fff' };
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
              className={cx('seat-arrow', `arrow-${seatOf(g, me, p.id)}`, editing === p.id && 'on', g.active === p.id && 'active')}
              style={{ '--deck': deckVar(p.id) } as CSSProperties}
              disabled={p.lost}
              title={editing === p.id ? 'Back to the current turn' : `Set stops for ${whose(p.id)} turns`}
              onClick={() => setSeat(editing === p.id ? null : p.id)}
            >
              <svg viewBox="0 0 24 24">
                <path d={ARROW_PATH[seatOf(g, me, p.id)]} />
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
                onClick={() => setStop(rel, step, nextStop(turnStops[step]))}
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
                onClick={() => (single ? setStop(rel, p.steps[0], nextStop(turnStops[p.steps[0]])) : setOpen(open === i ? null : i))}
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

/**
 * While paying: keep priority after this spell or ability goes on the stack, so you can
 * respond to it yourself (117.3c). Otherwise auto-pass lets the others respond and it resolves.
 */
function HoldToggle() {
  const hold = useStore((s) => s.hold);
  return (
    <button
      className={cx('hold-toggle', hold && 'on')}
      title="Keep priority after this goes on the stack, to respond to it yourself. Ctrl+Space pays and holds."
      onClick={() => useStore.setState({ hold: !hold })}
    >
      <span className="hold-box">{hold ? '✓' : ''}</span> Hold priority
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
      // A paused table's game takes no moves, from the keys either.
      if (useStore.getState().tableGame && useStore.getState().table?.paused) return;
      // While the exit dialog is open the keys belong to it: Esc stays, Enter presses the focused button.
      if (useStore.getState().confirmExit) {
        if (e.code === 'Escape') useStore.setState({ confirmExit: false });
        return;
      }
      const { primary, secondary, paying } = latest.current;
      if ((e.code === 'Space' || e.code === 'Enter') && primary && !primary.disabled) {
        // Ctrl (or Cmd) with Pay keeps priority afterwards, like Arena.
        if (paying && (e.ctrlKey || e.metaKey)) useStore.setState({ hold: true });
        // Drop focus first, or a button that was just clicked would also fire natively.
        e.preventDefault();
        (document.activeElement as HTMLElement | null)?.blur();
        play(primary.tone === 'go' || primary.tone === 'attack' ? 'confirm' : 'click');
        primary.onClick();
      } else if (e.code === 'Escape') {
        if (useStore.getState().viewer) useStore.setState({ viewer: null });
        else if (secondary) {
          play('cancel');
          secondary.onClick();
        }
        else cancel();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  return (
    <div className="action-bar">
      <PhaseTracker />
      {v.paying && <HoldToggle />}
      {v.secondary && <Button btn={v.secondary} small />}
      {v.primary && <Button btn={v.primary} />}
    </div>
  );
}

/**
 * Choices announced before a spell's targets (601.2b): the value of X (107.3a), how many
 * times to pay kicker (702.33), and the mana cost or an alternative cost (118.9).
 */
export function CastOptions() {
  const { announce: a, loyalty, abilityX, divide } = useView();
  if (loyalty) return <LoyaltyOptions options={loyalty.options} />;
  if (abilityX) return <AbilityX x={abilityX.x} max={abilityX.max} />;
  if (divide) return <DivideOptions rows={divide.rows} />;
  if (!a) return null;
  const { choices } = a;
  const x = choices.x ?? 0;
  const kicked = choices.kicked ?? 0;
  const modal = a.modal;
  return (
    <div className="cast-options">
      {a.handMana && (
        <div className="cast-row">
          <span className="cast-label">Or</span>
          <button className="chip" onClick={exileForMana}>
            Exile it for mana
          </button>
        </div>
      )}
      {a.plot && (
        <div className="cast-row">
          <span className="cast-label">Or</span>
          <button className="chip" onClick={plotCard}>
            Plot <ManaCost cost={a.plot} />
          </button>
        </div>
      )}
      {a.handAbility && (
        <div className="cast-row">
          <span className="cast-label">Or</span>
          <button className="chip" onClick={activateFromHand}>
            {a.handAbility}
          </button>
        </div>
      )}
      {a.faces && (
        <div className="cast-row">
          <span className="cast-label">Face</span>
          {a.faces.map((f) => (
            <button key={f.face} className={cx('chip', (choices.face ?? 0) === f.face && 'on')} disabled={!f.ok} onClick={() => pickFace(f.face)}>
              {f.name}
              {f.land && ' (land)'}
            </button>
          ))}
        </div>
      )}
      {modal && (
        <div className="cast-modes">
          <span className="cast-label">
            {modal.min === modal.max ? `Choose ${modal.min}` : `Choose ${modal.min} to ${modal.max}`}
            {modal.repeat && ' (repeats allowed)'}
          </span>
          {modal.modes.map((m, i) => (
            <div key={i} className="cast-row">
              <button className={cx('chip', 'mode', m.picked > 0 && 'on')} disabled={!m.ok} onClick={() => pickMode(i)}>
                {m.text}
              </button>
              {modal.repeat && m.picked > 0 && (
                <>
                  <b className="cast-x">×{m.picked}</b>
                  <button className="chip" onClick={() => pickMode(i, -1)} aria-label="One fewer">
                    −
                  </button>
                </>
              )}
            </div>
          ))}
        </div>
      )}
      {a.costs.length > 1 && (
        <div className="cast-row">
          <span className="cast-label">Cost</span>
          {a.costs.map((c) => (
            <button
              key={c.escape ? `escape${c.escape}` : (c.alt ?? 'mana')}
              className={cx('chip', choices.alt === c.alt && (choices.escape?.length ?? 0) === (c.escape ?? 0) && 'on')}
              disabled={!c.payable}
              onClick={() => setChoices({ alt: c.alt, escape: c.escape ? Array.from({ length: c.escape }, () => '') : undefined })}
            >
              {c.label.startsWith('{') ? <ManaCost cost={c.label} /> : c.label}
            </button>
          ))}
        </div>
      )}
      {a.gifts && (
        <div className="cast-row">
          <span className="cast-label">Gift</span>
          <button className={cx('chip', choices.gift === undefined && 'on')} onClick={() => setChoices({ gift: undefined })}>
            None
          </button>
          {a.gifts.map((o) => (
            <button key={o.id} className={cx('chip', choices.gift === o.id && 'on')} onClick={() => setChoices({ gift: o.id })}>
              {o.name}
            </button>
          ))}
        </div>
      )}
      {a.protectors && a.protectors.length > 1 && (
        <div className="cast-row">
          <span className="cast-label">Protector</span>
          {a.protectors.map((o) => (
            <button key={o.id} className={cx('chip', choices.protector === o.id && 'on')} onClick={() => setChoices({ protector: o.id })}>
              {o.name}
            </button>
          ))}
        </div>
      )}
      {a.maxX !== null && (
        <div className="cast-row">
          <span className="cast-label">{a.xLife ? 'X life' : 'X'}</span>
          <button className="chip" disabled={x <= 0} onClick={() => setChoices({ x: x - 1 })} aria-label="Less">
            −
          </button>
          <b className="cast-x">{x}</b>
          <button className="chip" disabled={x >= a.maxX} onClick={() => setChoices({ x: x + 1 })} aria-label="More">
            +
          </button>
          <button className="chip" disabled={x === a.maxX} onClick={() => setChoices({ x: a.maxX! })}>
            Max
          </button>
        </div>
      )}
      {a.kicker && (
        <div className="cast-row">
          <span className="cast-label">
            Kicker <ManaCost cost={a.kicker.text} />
          </span>
          {a.kicker.most > 1 || kicked > 1 ? (
            <>
              <button className="chip" disabled={kicked <= 0} onClick={() => setChoices({ kicked: kicked - 1 })} aria-label="Fewer">
                −
              </button>
              <b className="cast-x">×{kicked}</b>
              <button className="chip" disabled={kicked >= a.kicker.most} onClick={() => setChoices({ kicked: kicked + 1 })} aria-label="More">
                +
              </button>
            </>
          ) : (
            <button className={cx('chip', kicked > 0 && 'on')} disabled={!kicked && !a.kicker.most} onClick={() => setChoices({ kicked: kicked ? 0 : 1 })}>
              {kicked ? 'Kicked' : 'Kick'}
            </button>
          )}
        </div>
      )}
      {a.extraCosts && (
        <div className="cast-row">
          <span className="cast-label">Additional cost</span>
          {a.extraCosts.map((o, i) => (
            <button key={i} className={cx('chip', choices.extra === i && 'on')} disabled={!o.payable} onClick={() => setChoices({ extra: i })}>
              {o.label.split(/((?:\{[^}]+\})+)/).map((part, k) => (part.startsWith('{') ? <ManaCost key={k} cost={part} /> : part))}
            </button>
          ))}
        </div>
      )}
      {a.offspring && (
        <div className="cast-row">
          <span className="cast-label">
            Offspring <ManaCost cost={a.offspring.text} />
          </span>
          <button className={cx('chip', choices.offspring && 'on')} disabled={!choices.offspring && !a.offspring.payable} onClick={() => setChoices({ offspring: !choices.offspring })}>
            {choices.offspring ? 'Paying' : 'Pay'}
          </button>
        </div>
      )}
    </div>
  );
}

/** How a spell's damage is divided among its targets (601.2d): each target's share, at least 1. */
function DivideOptions({ rows }: { rows: { name: string; amount: number }[] }) {
  return (
    <div className="cast-options">
      {rows.map((r, i) => (
        <div className="cast-row" key={i}>
          <span className="cast-label">{r.name}</span>
          <button className="chip" disabled={r.amount <= 1} onClick={() => shiftDivision(i, -1)} aria-label="Less">
            −
          </button>
          <b className="cast-x">{r.amount}</b>
          <button className="chip" disabled={rows.every((o, j) => j === i || o.amount <= 1)} onClick={() => shiftDivision(i, 1)} aria-label="More">
            +
          </button>
        </div>
      ))}
    </div>
  );
}

/** The value of X for an ability with {X} or −X in its cost (107.3a): the same picker a spell's X uses. */
function AbilityX({ x, max }: { x: number; max: number }) {
  return (
    <div className="cast-options">
      <div className="cast-row">
        <span className="cast-label">X</span>
        <button className="chip" disabled={x <= 0} onClick={() => setAbilityX(x - 1)} aria-label="Less">
          −
        </button>
        <b className="cast-x">{x}</b>
        <button className="chip" disabled={x >= max} onClick={() => setAbilityX(x + 1)} aria-label="More">
          +
        </button>
        <button className="chip" disabled={x === max} onClick={() => setAbilityX(max)}>
          Max
        </button>
      </div>
    </div>
  );
}

/** Text with mana symbols like {U/B} and {T} drawn as symbols. */
function Symbols({ text }: { text: string }) {
  return <>{text.split(/((?:\{[^}]+\})+)/).map((part, i) => (part.startsWith('{') ? <ManaCost key={i} cost={part} /> : part))}</>;
}

/**
 * Using a permanent for mana by hand, when there is a choice: one row for each of its mana
 * abilities, with a button for each choice of mana it makes (Sunken Ruins: {C}, or {U}{U},
 * {U}{B} or {B}{B}), and the creature to tap or card to discard where its cost needs one.
 */
export function ManaPicker() {
  const pick = useStore((s) => s.manaPick);
  const g = useView().g;
  const card = pick && findCard(g, pick.cardId);
  if (!pick || !card) return null;
  const picker = (title: string, ids: string[], on: string | undefined, choose: (id: string) => void) => (
    <div className="cast-row">
      <span className="cast-label">{title}</span>
      {ids.map((id) => {
        const c = findCard(g, id);
        return (
          c && (
            <button key={id} className={`chip${on === id ? ' on' : ''}`} onClick={() => choose(id)}>
              {label(c)}
            </button>
          )
        );
      })}
    </div>
  );
  return (
    <div className="cast-options">
      <div className="cast-row">
        <span className="cast-label">
          {label(card)}
          {pick.group?.length ? ` ×${pick.group.length + 1}` : ''}: choose the mana
        </span>
      </div>
      {pick.options.map((o) => (
        <div key={o.ability} className="cast-row">
          <span className="cast-label">
            <Symbols text={o.text} />:
          </span>
          {o.mana.map((m) => (
            <button key={m.join('')} className="chip" onClick={() => pickMana(o.ability, m)} aria-label={m.join('')}>
              <ManaCost cost={m.map((x) => `{${x}}`).join('')} />
            </button>
          ))}
        </div>
      ))}
      {pick.options.flatMap((o) => o.creatures ?? []).length > 1 &&
        picker('Tap', [...new Set(pick.options.flatMap((o) => o.creatures ?? []))], pick.creature, pickTapCreature)}
      {pick.options.some((o) => o.discards) && picker('Discard', [...new Set(pick.options.flatMap((o) => o.discards ?? []))], pick.discard, pickManaDiscard)}
      {pick.options.some((o) => o.sacrifices) && picker('Sacrifice', [...new Set(pick.options.flatMap((o) => o.sacrifices ?? []))], pick.sacrifice, pickManaSacrifice)}
      <div className="cast-row">
        <button className="chip" onClick={() => pickMana(null)}>
          Cancel
        </button>
      </div>
    </div>
  );
}

/**
 * A planeswalker's loyalty abilities (606), a Class's level bars (716.2), or a permanent's
 * several activated abilities (602): click one to activate it.
 */
function LoyaltyOptions({ options }: { options: AbilityOption[] }) {
  return (
    <div className="cast-options">
      <div className="cast-modes">
        {options.map((o) => (
          <div key={`${o.ref.ability ?? 'a'}-${o.ref.activated ?? 0}`} className="cast-row">
            <button className="chip mode" disabled={!o.ok} onClick={() => pickAbility(o.ref)}>
              {o.cost && <b className="loyalty-cost">{o.cost.startsWith('{') ? <ManaCost cost={o.cost} /> : o.cost}</b>} {o.text}
            </button>
          </div>
        ))}
      </div>
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
function LogText({ entry }: { entry: Pick<LogEntry, 'text' | 'cards'> }) {
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

/**
 * The log lines a stack item resolving wrote (608.2): every line added by a change that took
 * something off the stack. They flash once as they appear, so a resolve is seen in the log too.
 */
function useResolvedLines(g: Game) {
  const seen = useRef({ g, lines: new Set<number>() });
  const was = seen.current.g;
  if (was !== g) {
    if (newGame(was, g)) seen.current.lines = new Set();
    else if (leftStack(was, g).length) for (let i = was.log.length; i < g.log.length; i++) seen.current.lines.add(i);
    seen.current.g = g;
  }
  return seen.current.lines;
}

/** The log bar's icons: 24-unit boxes, drawn in the button's text colour. */
const BAR_ICONS = {
  chevron: <path d="M6 9.5 12 15.5 18 9.5" fill="none" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />,
  gear: (
    <path
      fillRule="evenodd"
      d="M10.3 2h3.4l.5 2.7a8 8 0 0 1 1.9 1.1l2.6-.9 1.7 2.9-2.1 1.8a8 8 0 0 1 0 2.2l2.1 1.8-1.7 2.9-2.6-.9a8 8 0 0 1-1.9 1.1l-.5 2.7h-3.4l-.5-2.7a8 8 0 0 1-1.9-1.1l-2.6.9-1.7-2.9 2.1-1.8a8 8 0 0 1 0-2.2L3.6 7.8l1.7-2.9 2.6.9a8 8 0 0 1 1.9-1.1ZM12 8.6a3.4 3.4 0 1 0 0 6.8 3.4 3.4 0 0 0 0-6.8Z"
    />
  ),
  pause: <path d="M7 5h3.5v14H7Zm6.5 0H17v14h-3.5Z" />,
  exit: (
    <path
      d="M14 4H6.5A1.5 1.5 0 0 0 5 5.5v13A1.5 1.5 0 0 0 6.5 20H14M10 12h10m-3.5-3.5L20 12l-3.5 3.5"
      fill="none"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  ),
};

function BarIcon({ name }: { name: keyof typeof BAR_ICONS }) {
  return (
    <svg className="bar-icon" viewBox="0 0 24 24" aria-hidden="true">
      {BAR_ICONS[name]}
    </svg>
  );
}

/** A row of buttons that picks one value, for the settings popover. */
function Segmented<T>({ options, value, onChange, label }: { options: { value: T; label: string }[]; value: T; onChange: (v: T) => void; label: string }) {
  return (
    <div className="segmented" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button key={o.label} role="radio" aria-checked={o.value === value} className={cx(o.value === value && 'on')} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

const DAMAGE_TIP = 'When an attacker of yours is blocked by two or more creatures, or has trample, choose how its damage is divided';

/**
 * The gear on the log bar and its popover: the settings that change how the game runs for
 * this person (bot speed, sound, and how combat damage is divided). Esc or a click
 * elsewhere closes it, before Esc reaches the game.
 */
function GameSettings() {
  const [open, setOpen] = useState(false);
  const speed = useStore((s) => s.speed);
  const human = useStore((s) => s.human);
  const manualDamage = useStore((s) => s.settings.manualDamage);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const key = (e: KeyboardEvent) => {
      if (e.code !== 'Escape') return;
      e.stopPropagation();
      setOpen(false);
    };
    const down = (e: PointerEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false);
    };
    // Capturing on the window runs before the game's own Esc (cancel).
    window.addEventListener('keydown', key, true);
    document.addEventListener('pointerdown', down);
    return () => {
      window.removeEventListener('keydown', key, true);
      document.removeEventListener('pointerdown', down);
    };
  }, [open]);
  return (
    <div className="log-settings" ref={box}>
      <button className={cx('bar-button', open && 'on')} onClick={() => setOpen(!open)} aria-label="Settings" aria-expanded={open} aria-haspopup="dialog" data-tip="Settings">
        <BarIcon name="gear" />
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            className="log-popover"
            role="dialog"
            aria-label="Settings"
            initial={{ opacity: 0, y: '0.6rem' }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: '0.6rem' }}
            transition={{ duration: 0.16 }}
          >
            <div className="setting" title="Bot speed">
              <span className="setting-name">Bot speed</span>
              <Segmented options={SPEEDS.map((n) => ({ value: n, label: `${n}×` }))} value={speed} onChange={(n) => useStore.getState().setSpeed(n)} label="Bot speed" />
            </div>
            <div className="setting">
              <span className="setting-name">Sound</span>
              <SoundControl />
            </div>
            <div className="setting">
              <span className="setting-name">Music</span>
              <MusicControl />
            </div>
            {human !== null && (
              <div className="setting" title={DAMAGE_TIP}>
                <span className="setting-name">Combat damage</span>
                <Segmented
                  options={[
                    { value: false, label: 'Auto' },
                    { value: true, label: 'By hand' },
                  ]}
                  value={manualDamage}
                  onChange={(v) => useStore.getState().setSetting({ manualDamage: v })}
                  label="Divide combat damage"
                />
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export function LogPanel() {
  const g = useView().g;
  const show = useStore((s) => s.showLog);
  const human = useStore((s) => s.human);
  const tableGame = useStore((s) => s.tableGame);
  const lines = useRef<HTMLDivElement>(null);
  const resolved = useResolvedLines(g);
  useEffect(() => {
    lines.current?.scrollTo({ top: lines.current.scrollHeight });
  }, [g.log.length, show]);
  const start = Math.max(0, g.log.length - 80);
  // The panel hangs from the bottom-left corner. The bar is the log's top edge: as the lines fold away it rides down with them.
  return (
    <aside className={cx('log', show && 'open')}>
      <div className="log-bar">
        <button className="log-toggle" onClick={() => useStore.setState({ showLog: !show })} aria-expanded={show} aria-controls="log-body" data-tip={show ? 'Hide log' : 'Show log'}>
          <BarIcon name="chevron" />
          <span>Log</span>
        </button>
        <div className="log-tools" role="toolbar" aria-label="Game controls">
          {tableGame && (
            <button
              className="bar-button"
              onClick={() => useStore.getState().lobby?.pause({ paused: true }).catch((err) => console.warn('Lobby:', err))}
              aria-label="Pause"
              data-tip="Pause the game for everyone at the table"
            >
              <BarIcon name="pause" />
            </button>
          )}
          <GameSettings />
          <button className="bar-button exit" onClick={() => useStore.setState({ confirmExit: true })} aria-label="Exit" data-tip="Exit to the menu">
            <BarIcon name="exit" />
          </button>
        </div>
      </div>
      <AnimatePresence initial={false}>
        {show && (
          <motion.div
            key="log"
            id="log-body"
            className="log-body"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.28, ease: [0.25, 1, 0.5, 1] }}
          >
            <div className="log-lines" ref={lines}>
              {g.log.slice(start).map((l, i) => {
                // A line that names a hidden card reads in full only for the players it shows it to.
                const line = human !== null && l.private?.players.includes(human) ? l.private : l;
                const color = l.player === undefined ? '#fff' : deckColor(g.players[l.player].colors);
                return (
                  <div key={start + i} className={cx('log-line', l.text.startsWith('Turn ') && 'turn', resolved.has(start + i) && 'resolved')} style={{ '--deck': color } as CSSProperties}>
                    <LogText entry={line} />
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
  const tableGame = useStore((s) => s.tableGame);
  const hosting = useStore((s) => s.table?.role === 'hosting');
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
            <p>
              {!tableGame
                ? 'The game ends here and you go back to the deck menu.'
                : hosting
                  ? 'You host this table, so leaving ends the game for everyone. Every player keeps a saved copy that any of them can resume.'
                  : 'You leave the table and go back to the deck menu.'}
            </p>
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

/** The card a hover target shows, or null for a name that is neither a card nor a token key. */
function hoverData(hover: Hover): CardData | null {
  return hover.d ?? knownCard(hover.name);
}

/** The card or token with this name or key, or null if there is none: a missing card shows nothing rather than stopping the screen. */
function knownCard(name: string): CardData | null {
  try {
    return cardData(name);
  } catch {
    return null;
  }
}

/** The card element at a point on screen, as a hover target (or null if there is no card there). */
function cardAt(game: Game | null, at: Element | null) {
  const el = at?.closest<HTMLElement>('[data-card]');
  const card = el && game && findCard(game, el.dataset.card!);
  // The viewer's cards are shown big already (see `ZoneViewer`).
  return el && card ? { name: card.name, d: data(card), el, ...(el.closest('.viewer') && { pinOnly: true }) } : null;
}

/**
 * Big readable copy of whatever card the pointer is over, placed beside it. Right-click a card
 * (one in the hand too) to keep a bigger copy up, over a darkened table, until a left click
 * anywhere off it.
 */
export function Preview() {
  const hover = useStore((s) => s.hover);
  const game = useStore((s) => s.game);
  /** The card kept up by a right-click. */
  const [pinned, setPinned] = useState<CardData | null>(null);
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

  // Right-click pins the card under the pointer, instead of opening the browser's menu.
  useEffect(() => {
    const onMenu = (e: MouseEvent) => {
      const hover = useStore.getState().hover;
      const d = hover && hoverData(hover);
      if (d) setPinned(d);
      if (hover || (e.target as Element).closest('.preview-backdrop, .preview')) e.preventDefault();
    };
    window.addEventListener('contextmenu', onMenu);
    return () => window.removeEventListener('contextmenu', onMenu);
  }, []);

  // The hovered card can be redrawn as a new element, or leave play, with no mouse event at
  // all. Move the preview to whatever card is under the pointer now.
  useEffect(() => {
    if (!hover || hover.el.isConnected) return;
    useStore.setState({ hover: cardAt(game, document.elementFromPoint(pointer.current.x, pointer.current.y)) });
  }, [game, hover]);

  // A hand card zooms itself, and the viewer's cards are big already: they only get the pinned preview.
  const d = pinned ?? (hover && !hover.pinOnly ? hoverData(hover) : null);
  const rem = parseFloat(getComputedStyle(document.documentElement).fontSize);
  const gap = 1.5 * rem;
  if (pinned) {
    // Half the screen's height, raised a little, centred on the fifth of six columns across
    // the screen (75% of the way along); a narrow window shrinks it to stay on screen.
    const height = Math.min(window.innerHeight * 0.5, (window.innerWidth / 2 - 2 * gap) * 1.395);
    const width = height / 1.395;
    shown.current = { left: window.innerWidth * 0.75 - width / 2, top: window.innerHeight * 0.42 - height / 2, width };
  } else if (hover?.el.isConnected) {
    // For the one render where the old element is gone, stay where the preview last was, so it doesn't blink.
    const r = hover.el.getBoundingClientRect();
    const width = 27 * rem;
    const height = width * 1.395;
    const left = r.right + gap + width > window.innerWidth - gap ? r.left - gap - width : r.right + gap;
    const top = Math.max(gap, Math.min(r.top + r.height / 2 - height / 2, window.innerHeight - height - gap));
    shown.current = { left, top, width };
  }
  return (
    <>
      {/* Always there, so the table fades back in when the preview closes too. */}
      <div className={cx('preview-backdrop', pinned && 'on')} onClick={() => setPinned(null)} />
      {d && shown.current && (
        <div className={cx('preview', pinned && 'pinned')} key={`${d.name}-${!!pinned}`} style={shown.current}>
          <CardImage d={d} alt={d.name} />
        </div>
      )}
    </>
  );
}

/**
 * The stack: spells and abilities waiting to resolve, oldest at the back. It only shows
 * while the game is waiting on someone; a spell nobody responds to resolves at once.
 * A spell or ability the human is paying for hovers in front, where it goes once paid.
 */
export function StackPanel() {
  const { g, me, paying, targetStack } = useView();
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
            data-stack-card={item.kind === 'spell' ? item.card.id : undefined}
            className={cx('stack-item', i === g.stack.length - 1 && !paying && 'top', targetStack.has(item.id) && 'targetable')}
            onClick={() => clickStackItem(item.id)}
            title={triggerText(item)}
            {...hoverProps(data(item.card))}
          >
            <CardImage d={data(item.card)} alt={label(item.card)} draggable={false} />
            <span className="stack-tag">
              {who} {item.copy ? 'copy' : item.kind === 'spell' ? 'spell' : 'ability'}
              {item.x !== undefined && ` (X = ${item.x})`}
            </span>
          </div>
        );
      })}
      {paying && (
        <div key={`paying-${paying.card.id}`} data-paying={paying.card.id} className="stack-item top paying" {...hoverProps(data(paying.card))}>
          <CardImage d={data(paying.card)} alt={label(paying.card)} draggable={false} />
          <span className="stack-tag">Pay to {paying.kind === 'spell' ? 'cast' : 'activate'}</span>
        </div>
      )}
    </div>
  );
}

/** Briefly shows each spell as it is cast. While something is waiting on the stack, the stack panel shows it instead. */
/** The line above a flashed card: who cast it, or whose ability it is. `name` is null for you. */
function flashCaption(f: NonNullable<Game['lastSpell']>, name: string | null) {
  if (f.ability === 'triggered') return name ? `${name}'s` : 'Your';
  if (f.ability === 'activated') return name ? `${name} activates` : 'You activate';
  return name ? `${name} casts` : 'You cast';
}

export function SpellFlash() {
  const { g, me } = useView();
  const speed = useStore((s) => s.speed);
  const rem = useRem();
  const spell = g.lastSpell;
  const [shown, setShown] = useState<typeof spell>(null);
  const d = shown && knownCard(shown.name);
  useEffect(() => {
    if (!spell) return;
    setShown(spell);
    const t = setTimeout(() => setShown(null), 1600 / speed);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spell?.seq]);
  return (
    <AnimatePresence>
      {shown && d && !g.stack.length && (
        <motion.div
          key={shown.seq}
          className="spell-flash"
          initial={{ opacity: 0, x: 8 * rem, scale: 0.8 }}
          animate={{ opacity: 1, x: 0, scale: 1 }}
          exit={{ opacity: 0, scale: 0.9 }}
        >
          <div className="spell-caster">{flashCaption(shown, shown.caster === me ? null : g.players[shown.caster].name)}</div>
          <CardImage d={d} alt={d.name} draggable={false} />
          {shown.ability && <div className="spell-ability">{shown.ability === 'triggered' ? 'Trigger' : 'Ability'}</div>}
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
    {
      key: `a-${a.id}-${a.defender}-${a.target}`,
      from: `[data-card="${a.id}"]`,
      to: a.target ? `[data-card="${a.target}"]` : `[data-avatar="${a.defender}"]`,
      kind: 'attack',
    },
    ...a.blockers.map((b) => ({ key: `b-${b}-${a.id}`, from: `[data-card="${b}"]`, to: `[data-card="${a.id}"]`, kind: 'block' })),
  ]);
  for (const item of g.stack) {
    for (const t of item.targets) {
      if (!t) continue;
      const to = t.kind === 'card' ? `[data-card="${t.id}"]` : t.kind === 'stack' ? `[data-stack="${t.id}"]` : `[data-avatar="${t.id}"]`;
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
  const { glow, me } = useView();
  return (
    <div className="modal" onClick={() => useStore.setState({ viewer: null })}>
      <div className="viewer">
        <h2>
          {p.id === me ? 'Your' : `${p.name}'s`} {viewer.zone} ({cards.length})
        </h2>
        <div className="viewer-cards">
          {cards.map((c) => {
            // A card exiled face down shows its back, unless the human may look at it (406.3).
            if (!faceUp(c, me)) return <div key={c.id} className="card-back viewer-back" title="Exiled face down" />;
            // A flashback card or an exiled adventurer card can be cast from here (702.34a, 715.3d).
            const castable = glow.get(c.id) === 'play';
            return (
              <CardImage
                key={c.id}
                d={data(c)}
                alt={data(c).name}
                data-card={c.id}
                // Already big: no hover preview, but right-click pins one like a card on the table.
                {...hoverProps(data(c), { pinOnly: true })}
                className={cx(castable && 'glow-play')}
                title={castable ? `Cast ${data(c).name}` : undefined}
                draggable={false}
                onClick={(e) => {
                  if (!castable) return;
                  e.stopPropagation();
                  useStore.setState({ viewer: null });
                  playHandCard(c);
                }}
              />
            );
          })}
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
  const { start, quit, deck, tableGame, lobby, table } = useStore.getState();
  // At a table, only the host starts the next game, through the lobby; it arrives as a new view.
  const again = !tableGame ? () => start(deck) : table?.role === 'hosting' && lobby ? () => void lobby.start().catch((err) => console.warn('Lobby:', err)) : null;
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
  return (
    <div className="modal">
      <motion.div className={cx('game-over', winner?.id === me && 'won')} initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }}>
        <h1>{title}</h1>
        {winner && (
          <p>
            {winner.id === me ? 'You win' : `${winner.name} wins`} with {winner.commanders.join(' and ')} on turn {g.turn}.
          </p>
        )}
        <div className="game-over-buttons">
          {again && (
            <button className="btn btn-go small" onClick={again}>
              <span className="btn-label">Play Again</span>
            </button>
          )}
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
