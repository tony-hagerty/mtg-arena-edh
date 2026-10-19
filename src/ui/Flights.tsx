import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { MotionGlobalConfig, motion, useReducedMotion } from 'motion/react';
import { data } from '../engine';
import type { CardData, Game, PlayerId, StackItem } from '../engine';
import { useStore } from './store';
import { CardImage } from './TextCard';
import { faceUp } from './util';
import { leftStack, zoneMoves } from './zone-moves';
import type { Place, ZoneMove } from './zone-moves';

/*
  Cards moving between zones fly there. One approach throughout: when the game changes, a
  copy of each moving card is drawn over the table, at the card's old place on screen, and
  flies to its new one; the real card waits hidden under it and shows once the copy lands.
  So whatever the view code draws is where the card ends up, clickable and hoverable as soon
  as the flight is over. Old places are read from the screen as the store changes, before
  React redraws; new ones once it has.
*/

/** At most this many cards fly at once: a board wipe sends the rest straight to where they go. */
const MAX_FLIGHTS = 12;

/** A place on screen: its centre, the width a card has there, and how far a card there is turned (deg). */
interface Spot {
  x: number;
  y: number;
  w: number;
  turn: number;
}

interface Flight {
  key: string;
  /** The moving card's id: a change that moves it again starts from where this copy is. */
  card: string;
  /** The card's face, or null for its back. */
  d: CardData | null;
  from: Spot;
  to: Spot;
  delay: number;
  /** A stack item resolving: it glows and swells before it goes. */
  resolve: boolean;
  /** It flies toward something that isn't the card itself (a player, a hand of backs), so it fades as it gets there. */
  fade: boolean;
  /** The real card, hidden until this lands. */
  hidden: HTMLElement | null;
  /**
   * It lands on a battlefield tile, which looks nothing like the card: instead of vanishing
   * on landing, the copy folds into the tile's art while the tile fades in under it.
   */
  morph: boolean;
  /** The fold is under way (`.flight-card.settling`). */
  settling?: boolean;
}

/** A ring that flares once over a card: a token appearing, an ability's source as the ability resolves. */
interface Flare {
  key: string;
  x: number;
  y: number;
  w: number;
  h: number;
  kind: 'token' | 'resolve';
}

const q = (sel: string) => document.querySelector<HTMLElement>(sel);

/** The element a card at `place` is drawn as, and whether it is that card itself (true) or only its zone. */
function elementAt(place: Place, id: string): [HTMLElement, boolean] | null {
  const own = (el: HTMLElement | null, exact: boolean): [HTMLElement, boolean] | null => (el ? [el, exact] : null);
  switch (place.zone) {
    case 'battlefield':
      return own(q(`[data-card="${id}"]`), true);
    case 'command':
      // The human's crown is their commander in the command zone; anyone else's is their portrait.
      return own(q(`[data-card="${id}"]`), true) ?? own(q(`[data-avatar="${place.pid}"]`), false);
    case 'stack':
      return own(q(`[data-stack-card="${id}"]`), true);
    case 'hand':
      return own(q(`[data-hand="${id}"]`), true) ?? own(q(`[data-hand-of="${place.pid}"]`), false);
    case 'graveyard':
    case 'exile':
      return own(q(`[data-pile="${place.pid}-${place.zone}"]`), true);
    case 'library':
      return own(q(`[data-library="${place.pid}"] .card-back`), true);
  }
}

const deg = (s: string) => parseFloat(s) || 0;

/**
 * Where on screen `el` puts a card. `visual` reads where it is drawn right now, mid-animation
 * included (an old place); otherwise its layout box, which is where it settles (a new place
 * whose own entrance is still under way). At the side seats cards are turned (--face).
 */
function spotOf(el: HTMLElement, visual: boolean, rem: number): Spot {
  const r = el.getBoundingClientRect();
  const turn = deg(getComputedStyle(el).getPropertyValue('--face'));
  const sideways = Math.abs(turn) === 90;
  const [w, h] = visual || !el.offsetWidth ? [r.width, r.height] : [el.offsetWidth, el.offsetHeight];
  // A zone's anchor (the hand's) can have no size: a card there is hand-sized.
  const width = (sideways ? Math.min(w, h) : w) || 15 * rem;
  return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: width, turn };
}

/** Old places, read before React redraws. Kept across several store changes in one redraw. */
let pending: { prev: Game; spots: Map<string, Spot>; items: Map<string, Spot> } | null = null;

/** Can the viewer see this card as it moves? Not one going into or out of a hidden zone, unless it is theirs. */
function shown(m: ZoneMove, me: PlayerId | null) {
  const hidden = (p: Place | null) => p !== null && (p.zone === 'library' || (p.zone === 'hand' && p.pid !== me));
  if (m.to.zone === 'library') return false;
  if (hidden(m.from) && hidden(m.to)) return false;
  return faceUp(m.card, me);
}

/** Moves that get a flight. A draw already flies itself from the library to the hand (`HandCard`, `HandBack`). */
const flies = (m: ZoneMove) => !(m.from?.zone === 'library' && m.to.zone === 'hand') && !(m.from === null && m.to.zone === 'hand');

function capture(prev: Game, next: Game, rem: number) {
  if (!pending || pending.prev.players.length !== next.players.length) pending = { prev, spots: new Map(), items: new Map() };
  for (const m of zoneMoves(pending.prev, next)) {
    if (!m.from || pending.spots.has(m.card.id) || !flies(m)) continue;
    // A card still in flight from the last change starts from where its copy is now.
    // A spell that was being paid for starts from where it floated in front of the stack.
    const flying = q(`[data-flight="${m.card.id}"]`) ?? q(`[data-paying="${m.card.id}"]`);
    const at = flying ? ([flying, true] as const) : elementAt(m.from, m.card.id);
    if (at) pending.spots.set(m.card.id, { ...spotOf(at[0], true, rem), ...(!at[1] && { w: 9 * rem }) });
  }
  for (const item of leftStack(pending.prev, next)) {
    const el = q(`[data-stack="${item.id}"]`);
    if (el) pending.items.set(item.id, spotOf(el, true, rem));
  }
}

/** Where an ability goes as it resolves: back into its source, or its controller's portrait if the source is gone. */
function sourceOf(item: StackItem) {
  return q(`.tile[data-card="${item.card.id}"]`) ?? q(`[data-avatar="${item.controller}"]`);
}

/** The flights and flares for the change from `prev` to `next`. */
function plan(prev: Game, next: Game, me: PlayerId | null, spots: Map<string, Spot>, items: Map<string, Spot>, rem: number) {
  const flights: Flight[] = [];
  const flares: Flare[] = [];
  const flare = (key: string, el: HTMLElement, kind: Flare['kind']) => {
    const r = el.getBoundingClientRect();
    const [w, h] = el.offsetWidth ? [el.offsetWidth, el.offsetHeight] : [r.width, r.height];
    flares.push({ key, x: r.left + r.width / 2, y: r.top + r.height / 2, w, h, kind });
  };
  for (const m of zoneMoves(prev, next)) {
    // A token appearing (111.1): nothing to fly from, so it flares where it lands.
    if (!m.from && m.to.zone === 'battlefield' && m.card.isToken) {
      const el = q(`.tile[data-card="${m.card.id}"]`);
      if (el && flares.length < MAX_FLIGHTS) flare(`token-${m.card.id}`, el, 'token');
      continue;
    }
    const from = spots.get(m.card.id);
    const at = elementAt(m.to, m.card.id);
    if (!from || !at || flights.length >= MAX_FLIGHTS) continue;
    const [el, exact] = at;
    const to = spotOf(el, false, rem);
    // A pile already shows the card on top, so only a card that is itself drawn somewhere waits hidden.
    const hides = exact && m.to.zone !== 'graveyard' && m.to.zone !== 'exile' && m.to.zone !== 'library';
    flights.push({
      key: `${m.card.id}-${next.log.length}`,
      card: m.card.id,
      d: shown(m, me) ? data(m.card) : null,
      from,
      to: exact ? to : { ...to, w: Math.min(to.w, 9 * rem) },
      delay: Math.min(flights.length, 6) * 0.05,
      resolve: m.from?.zone === 'stack',
      fade: !exact,
      hidden: hides ? el : null,
      morph: exact && m.to.zone === 'battlefield' && el.classList.contains('tile'),
    });
  }
  for (const item of leftStack(prev, next)) {
    if (item.kind === 'spell') continue;
    // An ability resolving (608.2): its card on the stack goes back into its source, which flares.
    const source = sourceOf(item);
    if (!source) continue;
    const from = items.get(item.id);
    if (from && flights.length < MAX_FLIGHTS) {
      flights.push({ key: `item-${item.id}`, card: item.id, d: data(item.card), from, to: { ...spotOf(source, false, rem), turn: from.turn }, delay: 0, resolve: true, fade: true, hidden: null, morph: false });
    }
    if (source.classList.contains('tile')) flare(`resolve-${item.id}`, source, 'resolve');
  }
  return { flights, flares };
}

const reveal = (f: Flight) => {
  f.hidden?.style.removeProperty('visibility');
  f.hidden?.style.removeProperty('--settle');
  f.hidden?.classList.remove('landing');
};

/**
 * Draws the flights. Mounted once with the table. A new change while cards are still flying
 * lands them at once, so fast bots never pile up a queue of moves; the Speed button shortens
 * every flight too. Nothing flies for people who ask for less motion (`reducedMotion="user"`)
 * or with `motionConfig.skipAnimations` set.
 */
export function Flights() {
  const game = useStore((s) => s.game);
  const speed = useStore((s) => s.speed);
  const reduced = useReducedMotion();
  const [shownFlights, setFlights] = useState<Flight[]>([]);
  const [flares, setFlares] = useState<Flare[]>([]);
  /** The flights on screen, for landing them all at once. */
  const live = useRef<Flight[]>([]);
  live.current = shownFlights;

  useEffect(
    () =>
      useStore.subscribe((s, old) => {
        if (s.game && old.game && s.game !== old.game) capture(old.game, s.game, parseFloat(getComputedStyle(document.documentElement).fontSize));
      }),
    [],
  );

  useLayoutEffect(() => {
    const was = pending;
    pending = null;
    // Whatever was still flying lands now.
    live.current.forEach(reveal);
    live.current = [];
    setFlights([]);
    setFlares([]);
    if (!game || !was || reduced || MotionGlobalConfig.skipAnimations) return;
    const rem = parseFloat(getComputedStyle(document.documentElement).fontSize);
    const next = plan(was.prev, game, useStore.getState().human, was.spots, was.items, rem);
    for (const f of next.flights) f.hidden?.style.setProperty('visibility', 'hidden');
    live.current = next.flights;
    setFlights(next.flights);
    setFlares(next.flares);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [game]);

  // Leaving the table lands everything, so no card stays hidden.
  useEffect(() => () => live.current.forEach(reveal), []);

  const time = 0.5 / Math.sqrt(speed);
  const settleTime = 0.45 / Math.sqrt(speed);
  const land = (f: Flight) => {
    reveal(f);
    setFlights((all) => all.filter((x) => x.key !== f.key));
  };
  // Landed on a tile: the tile shows and fades in (.tile.landing) while the copy folds into it.
  const settle = (f: Flight) => {
    if (!f.hidden) return land(f);
    f.hidden.style.setProperty('--settle', `${settleTime}s`);
    f.hidden.classList.add('landing');
    f.hidden.style.removeProperty('visibility');
    setFlights((all) => all.map((x) => (x.key === f.key ? { ...x, settling: true } : x)));
  };
  return createPortal(
    <div className="flights">
      {shownFlights.map((f) => {
        const scale = f.from.w / f.to.w;
        const dx = f.from.x - f.to.x;
        const dy = f.from.y - f.to.y;
        // A resolving item swells where it is first, then goes.
        const hold = f.resolve ? 0.3 : 0;
        return (
          <motion.div
            key={f.key}
            data-flight={f.card}
            className={f.resolve ? 'flight resolving' : 'flight'}
            style={{ left: f.to.x, top: f.to.y, width: f.to.w, height: f.to.w * 1.4 }}
            initial={{ x: dx, y: dy, scale, rotate: f.from.turn, opacity: 1 }}
            animate={{
              x: [dx, dx, 0],
              y: [dy, dy, 0],
              scale: f.resolve ? [scale, scale * 1.12, 1] : [scale, scale, 1],
              rotate: [f.from.turn, f.from.turn, f.to.turn],
              opacity: f.fade ? [1, 1, 0] : 1,
            }}
            transition={{ duration: time * (1 + hold), delay: f.delay / Math.sqrt(speed), times: [0, hold / (1 + hold), 1], ease: [0.3, 0.7, 0.3, 1] }}
            onAnimationComplete={() => (f.morph ? settle(f) : land(f))}
          >
            <div className={f.settling ? 'flight-card settling' : 'flight-card'} style={{ '--settle': `${settleTime}s` } as CSSProperties} onAnimationEnd={() => f.settling && land(f)}>
              {/* The back is under the face too, so a card whose image is still loading isn't an empty frame. */}
              <div className="card-back" />
              {f.d && <CardImage d={f.d} alt="" draggable={false} />}
            </div>
          </motion.div>
        );
      })}
      {flares.map((f) => (
        <motion.div
          key={f.key}
          className={`flare ${f.kind}`}
          style={{ left: f.x, top: f.y, width: f.w, height: f.h }}
          initial={{ opacity: 0.9, scale: 0.9 }}
          animate={{ opacity: 0, scale: 1.25 }}
          transition={{ duration: 0.7 / Math.sqrt(speed), ease: 'easeOut', delay: f.kind === 'resolve' ? time * 1.3 : 0.15 }}
          onAnimationComplete={() => setFlares((all) => all.filter((x) => x !== f))}
        />
      ))}
    </div>,
    document.body,
  );
}
