import { useEffect, useRef, useState } from 'react';
import { motion, useDragControls } from 'motion/react';
import { data } from '../engine';
import type { Card } from '../engine';
import { useRem } from './rem';
import { play } from './sound';
import { hoverHandCard, leaveHandCard, useStore } from './store';
import { CardImage, ManaCost } from './TextCard';
import { HAND_H, HAND_STEP, HAND_VISIBLE, HAND_W, handSlot } from './table-layout';
import { cx } from './util';
import { playHandCard, useView } from './view';

const SPRING = { type: 'spring', stiffness: 420, damping: 36 } as const;

/** A drawn card's trip from the library to the hand. Cards drawn together leave the pile one after another. */
const flight = (order: number) => ({ type: 'tween', duration: 0.55, ease: [0.25, 0.8, 0.35, 1], delay: order * 0.14 }) as const;

/** Centre and width (px) of the top card of a player's library, or null if it isn't on screen. */
function libraryTop(pid: number) {
  const back = document.querySelector(`[data-library="${pid}"] .card-back`);
  if (!back) return null;
  const r = back.getBoundingClientRect();
  // A pile card turned on its side would be wider than tall: its width is the shorter edge.
  const turn = parseFloat(getComputedStyle(back).rotate) || 0;
  return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: Math.min(r.width, r.height), turn };
}

/**
 * The pose a hand card starts from when it was just drawn: shrunk onto its owner's library
 * pile. `x` is the middle of the card's bottom edge and `top` its top edge, in px from the
 * hand's anchor (`.hand`, the screen's bottom-left corner), and `w`/`h` its size in px.
 * Cards scale from their bottom edge (originY: 1), so the shift up is measured to the middle
 * of the shrunk card.
 */
function onLibrary(pid: number, x: number, top: number, w: number, h: number) {
  const pile = libraryTop(pid);
  const anchor = document.querySelector('.hand');
  if (!pile || !anchor) return null;
  const a = anchor.getBoundingClientRect();
  const scale = pile.w / w;
  // A card back looks the same upside down, so never spin more than a quarter turn.
  const rotate = (((pile.turn % 180) + 270) % 180) - 90;
  return { x: pile.x - a.left - x, y: pile.y - a.top - top - h + (scale * h) / 2, scale, rotate };
}

/**
 * Where a hand card goes for its place in the window (`slot`, see `handSlot`): its slot's
 * top-left corner from the hand's anchor at the screen's bottom-left, in rem (`left`,
 * `top`), and the turn of the card in it (`th`, degrees). The card turns about the middle of
 * its bottom edge (`x`, `bottom`), so that point is put where the curve wants it. `shown`:
 * the slot is in the window; the others fade out along the curve's extensions.
 */
function slotPose(slot: number) {
  const c = handSlot(slot);
  const t = (c.th * Math.PI) / 180;
  const x = c.x - (HAND_H / 2) * Math.sin(t);
  const bottom = c.y - (HAND_H / 2) * Math.cos(t);
  return { left: x - HAND_W / 2, top: -(bottom + HAND_H), x, bottom, th: c.th, shown: slot >= 0 && slot < HAND_VISIBLE };
}

/**
 * For a card that just came out of the library (`order` says how many were drawn before it in
 * the same batch): where it starts, whether it is still on its way, and the transition to use.
 * `measure` runs once, when the card first appears.
 */
function useFlight<T>(order: number | undefined, measure: () => T | null) {
  const [start] = useState(() => (order === undefined ? null : measure()));
  const [flying, setFlying] = useState(start !== null);
  return { start, flying, transition: flying ? flight(order!) : SPRING, landed: () => setFlying(false) };
}

/**
 * A permanent on the battlefield, drawn Arena-style: cropped art, name bar, P/T box.
 * The outer tile is the space it takes on screen; the face inside carries the frame and art.
 * The top card of a pile gets `badge`, the whole pile: its "x7" uses them all at once.
 */
/** Counters on a permanent (122): "+2" for +1/+1 counters, "-1" for -1/-1, "3 charge" for others. */
export function Counters({ card }: { card: Card }) {
  // Loyalty and defense have their own badge, where a creature's P/T goes.
  const entries = Object.entries(card.counters).filter(([kind, n]) => n > 0 && kind !== 'loyalty' && kind !== 'defense');
  // A Class's level (716.2) shows with them.
  if (card.level > 1) entries.push([`level`, card.level]);
  if (!entries.length) return null;
  const text = ([kind, n]: [string, number]) => (kind === '+1/+1' ? `+${n}` : kind === '-1/-1' ? `-${n}` : kind === 'level' ? `Lv ${n}` : `${n} ${kind}`);
  return (
    <div className="tile-counters" title={entries.map(([kind, n]) => (kind === 'level' ? `Level ${n}` : `${n} ${kind} counter${n === 1 ? '' : 's'}`)).join(', ')}>
      {entries.map((e) => (
        <span key={e[0]} className={cx(e[0] === '-1/-1' && 'minus')}>
          {text(e)}
        </span>
      ))}
    </div>
  );
}

/** A card played without its rules text (`Card.textless`): a small plain mark, on its proxy on the table and in the hand. */
export const TextlessBadge = () => (
  <div className="textless-badge" title="Played without its rules text: the game can't read it yet, so it is a plain card here">
    no text
  </div>
);

/** How far up (rem) a hand card must be dragged before letting go plays it. */
const PLAY_PULL = 9;
const HELD_SCALE = 1.1;
const HOVER_SCALE = 1.5;

/**
 * A full card in the human's hand, on the hand's curve: lifts and zooms on hover. A click does
 * nothing, so rearranging can't play a card by accident, except while a spell is being cast:
 * then it picks a card to exile for its cost, or uses a card's mana ability from the hand. Dragging it sideways moves it to
 * another place in the hand (`onMove` gets the place it is over); dragging it up toward the
 * table and letting go plays it. A card just drawn (`drawn` is its place in the batch) flies
 * in face down from the library and turns face up on the way. `slot` is its place in the
 * window of cards that show (`handWindow`); outside it, the card fades out and takes no clicks.
 *
 * What counts as pointing at the card is its resting place on the curve, not the zoomed card:
 * the card is drawn in its slot (`.hand-slot`), which takes no pointer events, and a clear
 * copy of its resting shape beside it (`.hand-hit`), stacked in hand order, takes them. So
 * the zoomed card, drawn over its neighbours, never hides them from the pointer: moving onto
 * the part of the next card that shows at rest hovers that one. Pressing on the resting place
 * starts the slot's drag (`dragControls`); while it is held, the card in the slot takes the
 * pointer itself, and no other card hovers (`holding`).
 */
export function HandCard({
  card,
  index,
  slot: place,
  total,
  drawn,
  onMove,
}: {
  card: Card;
  index: number;
  slot: number;
  total: number;
  drawn?: number;
  onMove: (to: number) => void;
}) {
  const v = useView();
  const [hot, setHot] = useState(false);
  // For the pointer handlers, which can run again before React redraws.
  const hotNow = useRef(false);
  // While dragging: the shift that centres the card on the pointer, and whether letting go plays it.
  const [held, setHeld] = useState<{ x: number; y: number; armed: boolean } | null>(null);
  const slot = useRef<HTMLDivElement>(null);
  const hit = useRef<HTMLDivElement>(null);
  const from = useRef(index);
  const controls = useDragControls();
  const rem = useRem();
  const d = data(card);
  const glow = v.glow.get(card.id);
  const at = slotPose(place);
  const fly = useFlight(drawn, () => onLibrary(card.owner, at.x * rem, at.top * rem, HAND_W * rem, HAND_H * rem));
  const heat = (on: boolean) => {
    hotNow.current = on;
    setHot(on);
  };
  const enter = (el: HTMLElement) => {
    // A hand card zooms itself: it only gets the pinned preview (`pinOnly`).
    if (hotNow.current || !hoverHandCard({ name: d.name, d, el, pinOnly: true, ...(card.textless && { textless: true }) })) return;
    heat(true);
    if (!fly.flying) play('hover');
  };
  // A card that leaves the hand while held (a bot's spell discards it) lets go of the hold.
  useEffect(
    () => () => {
      if (useStore.getState().holding === card.id) useStore.setState({ holding: null });
    },
    [card.id],
  );
  // Zoomed, the card stands upright with its bottom edge just past the screen's and clear of
  // the left edge. Hovering waits until the card lands.
  const zoom = { rotate: 0, x: Math.max(0, 0.5 + (HAND_W * HOVER_SCALE) / 2 - at.x) * rem, y: (at.bottom + 0.5) * rem, scale: HOVER_SCALE };
  const pose = held
    ? { rotate: 0, x: held.x, y: held.y, scale: HELD_SCALE }
    : hot && !fly.flying && at.shown
      ? zoom
      : { rotate: at.th, x: 0, y: 0, scale: 1 };
  const live = !fly.flying && at.shown;
  return (
    <>
      {/* The slot is the card's place on the curve and what drags; the card inside poses on top of it. */}
      <motion.div
        ref={slot}
        layout
        data-hand={card.id}
        className={cx('hand-slot', held && 'held')}
        style={{ left: `${at.left}rem`, top: `${at.top}rem`, zIndex: held ? 101 : hot ? 100 : index }}
        drag={live}
        dragControls={controls}
        dragListener={false}
        dragSnapToOrigin
        dragMomentum={false}
        onDragStart={(_, info) => {
          const r = slot.current!.getBoundingClientRect();
          from.current = index;
          useStore.setState({ holding: card.id });
          // The card scales from its bottom edge, so its middle is half a scaled height above that.
          setHeld({ x: info.point.x - (r.left + r.width / 2), y: info.point.y - (r.bottom - (HELD_SCALE * r.height) / 2), armed: false });
        }}
        onDrag={(_, info) => {
          const armed = info.offset.y < -PLAY_PULL * rem;
          setHeld((h) => (h && h.armed !== armed ? { ...h, armed } : h));
          // One card further along the curve for every step it is dragged sideways.
          const to = Math.max(0, Math.min(total - 1, Math.round(from.current + info.offset.x / (HAND_STEP * rem))));
          if (!armed && to !== index) onMove(to);
        }}
        onDragEnd={(_, info) => {
          useStore.setState({ holding: null });
          setHeld(null);
          if (info.offset.y < -PLAY_PULL * rem) {
            // A card that can't be played now goes back with a buzz.
            play(glow ? 'release' : 'error');
            playHandCard(card);
          }
          // Let go over its own resting place, it stays zoomed. Anywhere else it settles back,
          // and the card the pointer is over hovers once the pointer moves.
          // The card itself is still over everything there, so look under it for a resting place.
          const under = document.elementsFromPoint(info.point.x - window.scrollX, info.point.y - window.scrollY).find((el) => el.classList.contains('hand-hit'));
          if (hit.current && under !== hit.current && leaveHandCard(hit.current)) heat(false);
        }}
      >
        <motion.div
          className={cx('hand-card', glow && `glow-${glow}`, held?.armed && glow && 'armed', card.textless && 'textless')}
          style={{ originY: 1, transformPerspective: 120 * rem }}
          initial={fly.start ? { opacity: 1, rotateY: 180, ...fly.start } : { opacity: 0, y: 8 * rem, rotate: at.th }}
          animate={{ opacity: at.shown ? 1 : 0, rotateY: 0, ...pose }}
          transition={fly.transition}
          onAnimationComplete={fly.landed}
        >
          {fly.flying && <div className="card-back" />}
          <CardImage d={d} draggable={false} />
          {card.textless && <TextlessBadge />}
          {d.manaCost && (
            <div className="hand-cost">
              <ManaCost cost={d.manaCost} />
            </div>
          )}
        </motion.div>
      </motion.div>
      {/* The card's resting place: what the pointer hovers, clicks and grabs. Outside the window it takes nothing. */}
      <div
        ref={hit}
        data-hand-hit={card.id}
        className="hand-hit"
        style={{ left: `${at.left}rem`, top: `${at.top}rem`, rotate: `${at.th}deg`, zIndex: index, pointerEvents: at.shown ? undefined : 'none' }}
        onPointerDown={(e) => live && controls.start(e)}
        onMouseEnter={(e) => enter(e.currentTarget)}
        // On moving too: a card let go of over this one, or one drawn under a still pointer, hovers then.
        onMouseMove={(e) => enter(e.currentTarget)}
        onMouseLeave={(e) => leaveHandCard(e.currentTarget) && heat(false)}
        onClick={() => (glow === 'target' || (v.paying && v.mana.has(card.id))) && playHandCard(card)}
      />
    </>
  );
}

/**
 * A card in the bottom seat's hand that the viewer can't see (`isHidden`), as when watching
 * the bots through the game server: a card back on the same curve as `HandCard`, with
 * nothing to drag or hover.
 */
export function HiddenHandCard({ card, index, slot, drawn }: { card: Card; index: number; slot: number; drawn?: number }) {
  const rem = useRem();
  const at = slotPose(slot);
  const fly = useFlight(drawn, () => onLibrary(card.owner, at.x * rem, at.top * rem, HAND_W * rem, HAND_H * rem));
  return (
    <motion.div layout className="hand-slot" data-hand={card.id} style={{ left: `${at.left}rem`, top: `${at.top}rem`, zIndex: index }}>
      <motion.div
        className="card-back"
        style={{ originY: 1, pointerEvents: 'none' }}
        initial={fly.start ? { opacity: 1, ...fly.start } : { opacity: 0, y: 8 * rem, rotate: at.th }}
        animate={{ opacity: at.shown ? 1 : 0, x: 0, y: 0, rotate: at.th, scale: 1 }}
        transition={fly.transition}
        onAnimationComplete={fly.landed}
      />
    </motion.div>
  );
}
