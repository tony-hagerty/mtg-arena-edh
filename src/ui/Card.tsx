import { useRef, useState } from 'react';
import type { CSSProperties, RefObject } from 'react';
import { motion } from 'motion/react';
import { activatedAbilities, attachmentsOf, data, defenseOf, isBattle, isCreature, isPlaneswalker, abilitiesOf, loyaltyOf, stats } from '../engine';
import type { Card, Game } from '../engine';
import { useRem } from './rem';
import { play } from './sound';
import { useStore } from './store';
import { CardImage, frameOf, ManaCost, useArtLoads } from './TextCard';
import { BACK_H, BACK_W, FAN_RADIUS, HAND_H, HAND_STEP, HAND_VISIBLE, HAND_W, handSlot } from './table-layout';
import { cx, hoverProps, seatOf } from './util';
import { clickGroup, clickPermanent, loyaltyCost, playHandCard, useView } from './view';

const KEYWORD_ICONS = [
  'flying',
  'reach',
  'first strike',
  'double strike',
  'deathtouch',
  'lifelink',
  'trample',
  'vigilance',
  'haste',
  'menace',
  'defender',
  'hexproof',
  'indestructible',
];

const SPRING = { type: 'spring', stiffness: 420, damping: 36 } as const;

/** One step from a seat's edge of the table toward the middle: up for the bottom seats, down for the top ones. */
const INWARD = { bottom: -1, top: 1 } as const;

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

/**
 * Auras and Equipment attached to a permanent, fanned out behind it with their name bar and
 * some art showing (`.tile-attached`). Click one to use it (an Equipment's equip ability),
 * hover to read it. `host` is the permanent they are attached to.
 */
function Attachments({ cards, host }: { cards: Card[]; host: Card }) {
  const { glow } = useView();
  // The last one is furthest out, so it is drawn first: each nearer one covers all of it but its top.
  return (
    <>
      {cards
        .map((c, i) => (
          <div
            key={c.id}
            data-card={c.id}
            className={cx('tile-attached', `frame-${frameOf(data(c))}`, glow.get(c.id) && `glow-${glow.get(c.id)}`)}
            style={{ '--i': i, '--n': cards.length } as CSSProperties}
            onClick={(e) => {
              e.stopPropagation();
              clickPermanent(c);
            }}
            {...hoverProps(data(c))}
            // Onto the permanent itself: it gets no mouseenter of its own, the pointer never left it.
            onMouseLeave={(e) => {
              const tile = e.currentTarget.parentElement!;
              const onHost = e.relatedTarget instanceof Node && tile.contains(e.relatedTarget) && !(e.relatedTarget as Element).closest?.('.tile-attached');
              useStore.setState({ hover: onHost ? { name: host.name, d: data(host), el: tile } : null });
            }}
          >
            <AttachedArt url={data(c).art} />
            <div className="tile-name">{data(c).name}</div>
          </div>
        ))
        .reverse()}
    </>
  );
}

/** An attachment's art, or just its frame colour if the art doesn't load: its name shows on it either way. */
function AttachedArt({ url }: { url: string }) {
  const ok = useArtLoads(url);
  return ok ? <div className="tile-art" style={{ backgroundImage: `url(${url})` }} /> : null;
}

/** The hover text for a permanent's activated abilities: its `activated` one, and each loyalty ability (606). */
const abilityText = (g: Game, card: Card) => {
  const script = abilitiesOf(g, card);
  return [...activatedAbilities(g, card).map((ab) => ab.text), ...(script.loyalty ?? []).map((ab) => `${loyaltyCost(ab.cost)}: ${ab.text}`)].filter(Boolean).join('\n');
};

/** `phased`: the permanent is phased out (702.26b): drawn faded, and treated as though it doesn't exist, so clicks do nothing. */
export function Permanent({ card, badge, phased }: { card: Card; badge?: Card[]; phased?: boolean }) {
  const v = useView();
  const g = v.g;
  const d = data(card);
  const creature = isCreature(g, card);
  const s = creature ? stats(g, card) : null;
  const attacking = g.combat?.attacks.some((a) => a.id === card.id) ?? false;
  const blocking = g.combat?.attacks.some((a) => a.blockers.includes(card.id)) ?? false;
  const glow = v.glow.get(card.id);
  const rem = useRem();
  const inward = INWARD[seatOf(g, v.me, card.controller).v];
  const lift = (attacking ? 2 : blocking ? 1 : 0) * rem;
  const printed = { power: parseInt(d.power ?? '0', 10) || 0, toughness: parseInt(d.toughness ?? '0', 10) || 0 };
  const ptClass =
    s && card.damage > 0
      ? 'hurt'
      : s && (s.power > printed.power || s.toughness > printed.toughness)
        ? 'buffed'
        : s && (s.power < printed.power || s.toughness < printed.toughness)
          ? 'hurt'
          : '';
  const sick = creature && card.sick && g.active === card.controller && !s!.keywords.has('haste');
  const attached = attachmentsOf(g, card);
  const artOk = useArtLoads(d.art);

  return (
    <motion.div
      layoutId={card.id}
      data-card={card.id}
      className={cx(
        'tile',
        `frame-${frameOf(d)}`,
        card.tapped && 'tapped',
        attacking && 'attacking',
        blocking && 'blocking',
        sick && 'sick',
        card.isCommander && 'commander',
        v.mana.has(card.id) && 'mana-source',
        glow && `glow-${glow}`,
        phased && 'phased-out',
        card.textless && 'textless',
      )}
      title={phased ? 'Phased out until its controller\'s next untap step' : undefined}
      initial={{ opacity: 0, scale: 0.6 }}
      animate={{ opacity: phased ? 0.35 : 1, scale: 1, rotate: card.tapped ? 8 : 0, x: 0, y: inward * lift }}
      exit={{ opacity: 0, scale: 0.4, transition: { duration: 0.3 } }}
      transition={SPRING}
      onClick={() => !phased && clickPermanent(card)}
      {...hoverProps(d, { textless: card.textless })}
    >
      {attached.length > 0 && <Attachments cards={attached} host={card} />}
      <div className="tile-face">
        {artOk ? (
          <div className="tile-art" style={{ backgroundImage: `url(${d.art})` }} />
        ) : (
          // No art: the type line and rules text fill the space instead. Hovering shows the whole card.
          <div className="tile-art tile-text">
            <div>{d.typeLine}</div>
            <p>{d.oracleText}</p>
          </div>
        )}
        <div className="tile-name" title={card.chosen ? `Chosen: ${card.chosen}` : undefined}>
          {card.isCommander && <span className="crown">♛</span>}
          {d.name}
          {card.chosen && ` (${card.chosen})`}
        </div>
        {s && (
          <div className="tile-keywords">
            {KEYWORD_ICONS.filter((k) => s.keywords.has(k)).map((k) => (
              <i key={k} title={k} className={`ms ms-ability-${k.replace(' ', '-')}`} />
            ))}
          </div>
        )}
        {s && (
          <div className={cx('tile-pt', ptClass)}>
            {s.power}/{s.toughness - card.damage}
          </div>
        )}
        {isPlaneswalker(g, card) && !s && (
          <div className="tile-pt tile-loyalty" title="Loyalty">
            {loyaltyOf(card)}
          </div>
        )}
        {isBattle(g, card) && (
          <div className="tile-pt tile-defense" title={`Defense${card.protector !== null ? ` — protected by ${g.players[card.protector].name}` : ''}`}>
            {defenseOf(card)}
          </div>
        )}
        <Counters card={card} />
        {sick && <i className="tile-sick ms ms-ability-summoning-sickness" title="Summoning sick" />}
        {(activatedAbilities(g, card).length > 0 || abilitiesOf(g, card).loyalty) && <div className="tile-ability" title={abilityText(g, card)} />}
        {card.tapped && <div className="tile-tapmark" />}
        {card.textless && <TextlessBadge />}
        {badge && (
          <div
            className="tile-badge"
            title={`Use all ${badge.length}`}
            onClick={(e) => {
              e.stopPropagation();
              clickGroup(badge);
            }}
          >
            x{badge.length}
          </div>
        )}
      </div>
    </motion.div>
  );
}

/** A card played without its rules text (`Card.textless`): a small plain mark, on its tile and in the hand. */
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
  // While dragging: the shift that centres the card on the pointer, and whether letting go plays it.
  const [held, setHeld] = useState<{ x: number; y: number; armed: boolean } | null>(null);
  const slot = useRef<HTMLDivElement>(null);
  const from = useRef(index);
  const rem = useRem();
  const d = data(card);
  const glow = v.glow.get(card.id);
  const at = slotPose(place);
  const fly = useFlight(drawn, () => onLibrary(card.owner, at.x * rem, at.top * rem, HAND_W * rem, HAND_H * rem));
  // Zoomed, the card stands upright with its bottom edge just past the screen's, so the
  // pointer never falls off the card and makes it flicker, and clear of the left edge.
  // Hovering waits until the card lands.
  const zoom = { rotate: 0, x: Math.max(0, 0.5 + (HAND_W * HOVER_SCALE) / 2 - at.x) * rem, y: (at.bottom + 0.5) * rem, scale: HOVER_SCALE };
  const pose = held
    ? { rotate: 0, x: held.x, y: held.y, scale: HELD_SCALE }
    : hot && !fly.flying && at.shown
      ? zoom
      : { rotate: at.th, x: 0, y: 0, scale: 1 };
  return (
    // The slot is the card's place on the curve and what the pointer drags; the card inside poses on top of it.
    <motion.div
      ref={slot}
      layout
      data-hand={card.id}
      className="hand-slot"
      style={{ left: `${at.left}rem`, top: `${at.top}rem`, zIndex: held ? 101 : hot ? 100 : index }}
      drag={!fly.flying && at.shown}
      dragSnapToOrigin
      dragMomentum={false}
      onDragStart={(_, info) => {
        const r = slot.current!.getBoundingClientRect();
        from.current = index;
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
        if (info.offset.y < -PLAY_PULL * rem) {
          // A card that can't be played now goes back with a buzz.
          play(glow ? 'release' : 'error');
          playHandCard(card);
        }
        setHeld(null);
        setHot(false);
      }}
      onMouseEnter={(e) => {
        setHot(true);
        useStore.setState({ hover: { name: d.name, d, el: e.currentTarget, pinOnly: true, ...(card.textless && { textless: true }) } });
        if (!fly.flying && !held) play('hover');
      }}
      onMouseLeave={() => {
        setHot(false);
        useStore.setState({ hover: null });
      }}
      onClick={() => (glow === 'target' || (v.paying && v.mana.has(card.id))) && playHandCard(card)}
    >
      <motion.div
        className={cx('hand-card', glow && `glow-${glow}`, held?.armed && glow && 'armed', card.textless && 'textless')}
        // Outside the window the card fades out and takes no clicks.
        style={{ originY: 1, transformPerspective: 120 * rem, pointerEvents: at.shown ? undefined : 'none' }}
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

/**
 * Where a card back starts when it was just drawn: shrunk onto its owner's library pile.
 * The card turns about `pivot` (its hand's anchor) and hangs `FAN_RADIUS` above it, so its
 * middle is `FAN_RADIUS + BACK_H / 2` from the pivot along the way it points. The turn is
 * the pile's, give or take half turns (a card back looks the same upside down), whichever
 * is nearest the card's own `angle`, so it never spins more than a quarter turn.
 */
function backOnLibrary(pid: number, pivot: Element | null, angle: number, rem: number) {
  const top = libraryTop(pid);
  if (!top || !pivot) return null;
  const a = pivot.getBoundingClientRect();
  const scale = top.w / (BACK_W * rem);
  let rotate = top.turn;
  while (rotate - angle > 90) rotate -= 180;
  while (rotate - angle < -90) rotate += 180;
  const t = (rotate * Math.PI) / 180;
  // The card's middle, from the pivot, before it is turned: straight up.
  const up = -(FAN_RADIUS + BACK_H / 2) * rem * scale;
  return { x: top.x - a.left + up * Math.sin(t), y: top.y - a.top - up * Math.cos(t), scale, rotate };
}

/**
 * A face-down card in an opponent's hand, turned `angle` degrees about the hand's pivot
 * (`fanEl`, see `fanAngle`). A card just drawn flies in from `pid`'s library.
 */
export function HandBack({ pid, fanEl, angle, drawn }: { pid: number; fanEl: RefObject<HTMLDivElement | null>; angle: number; drawn?: number }) {
  const rem = useRem();
  const fly = useFlight(drawn, () => backOnLibrary(pid, fanEl.current, angle, rem));
  return (
    <motion.div
      className="card-back"
      // Turned about the pivot, below the card's bottom edge.
      style={{ originY: (FAN_RADIUS + BACK_H) / BACK_H }}
      initial={fly.start ? { opacity: 1, ...fly.start } : { opacity: 0, x: 0, y: 0, rotate: angle, scale: 0.9 }}
      animate={{ opacity: 1, x: 0, y: 0, rotate: angle, scale: 1 }}
      transition={fly.transition}
      onAnimationComplete={fly.landed}
    />
  );
}
