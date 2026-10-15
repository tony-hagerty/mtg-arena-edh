import { useRef, useState } from 'react';
import type { CSSProperties, RefObject } from 'react';
import { motion } from 'motion/react';
import { activatedAbilities, attachmentsOf, data, defenseOf, isBattle, isCreature, isPlaneswalker, loyaltyOf, scriptFor, stats } from '../engine';
import type { Card, CardData } from '../engine';
import { useRem } from './rem';
import { cx, hoverProps, seatOf } from './util';
import { clickGroup, clickPermanent, loyaltyCost, playHandCard, useView } from './view';

function frameOf(d: CardData): string {
  if (d.typeLine.includes('Land')) return 'land';
  if (d.colors.length > 1) return 'gold';
  return d.colors[0] ?? 'artifact';
}

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

export function ManaCost({ cost }: { cost: string }) {
  // Hybrid and Phyrexian symbols drop the slash: {R/W} is ms-rw, {W/P} is ms-wp.
  const symbols = [...cost.matchAll(/\{([^}]+)\}/g)].map((m) => m[1].toLowerCase().replaceAll('/', ''));
  return (
    <span className="mana-cost">
      {symbols.map((s, i) => (
        <i key={i} className={`ms ms-cost ms-shadow ms-${s}`} />
      ))}
    </span>
  );
}

const SPRING = { type: 'spring', stiffness: 420, damping: 36 } as const;

/** One step from each table edge toward the middle, as [x, y]. */
const INWARD = { bottom: [0, -1], left: [1, 0], top: [0, 1], right: [-1, 0] } as const;

/** A drawn card's trip from the library to the hand. Cards drawn together leave the pile one after another. */
const flight = (order: number) => ({ type: 'tween', duration: 0.55, ease: [0.25, 0.8, 0.35, 1], delay: order * 0.14 }) as const;

/** Centre and width (px) of the top card of a player's library, or null if it isn't on screen. */
function libraryTop(pid: number) {
  const back = document.querySelector(`[data-library="${pid}"] .card-back`);
  if (!back) return null;
  const r = back.getBoundingClientRect();
  // At the side seats the pile card is turned on its side, so its width is the shorter edge.
  const turn = parseFloat(getComputedStyle(back).rotate) || 0;
  return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: Math.min(r.width, r.height), turn };
}

/**
 * The pose a hand card starts from when it was just drawn: shrunk onto its owner's library
 * pile. `anchor` is the point the card hangs from, `turn` how far the hand is rotated (deg),
 * and `w`/`h` the card's size and `x` its place in the fan, all in px. Cards scale from their
 * bottom edge (originY: 1), so the shift up is measured to the middle of the shrunk card.
 */
function onLibrary(pid: number, anchor: Element | null, turn: number, x: number, w: number, h: number) {
  const top = libraryTop(pid);
  if (!top || !anchor) return null;
  const a = anchor.getBoundingClientRect();
  const t = (turn * Math.PI) / 180;
  // The pile's offset from the anchor, turned back into the hand's own frame.
  const dx = top.x - a.left;
  const dy = top.y - a.top;
  const scale = top.w / w;
  // A card back looks the same upside down, so never spin more than a quarter turn.
  const rotate = ((((top.turn - turn) % 180) + 270) % 180) - 90;
  return {
    x: dx * Math.cos(t) + dy * Math.sin(t) - x,
    y: -dx * Math.sin(t) + dy * Math.cos(t) - h + (scale * h) / 2,
    scale,
    rotate,
  };
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

/** Where card `index` sits in a fanned hand of `total`: gap between cards, sideways shift and drop in rem, tilt in degrees. */
function fan(index: number, total: number, maxGap: number, span: number) {
  const offset = index - (total - 1) / 2;
  const gap = Math.min(maxGap, span / Math.max(total, 1));
  return { gap, x: offset * gap, tilt: offset * 2, drop: Math.abs(offset) ** 1.6 * 0.3 };
}

/**
 * A permanent on the battlefield, drawn Arena-style: cropped art, name bar, P/T box.
 * The outer tile is the space it takes on screen; the face inside is turned for the side seats.
 * The top card of a pile gets `badge`, the whole pile: its "x7" uses them all at once.
 */
/** Counters on a permanent (122): "+2" for +1/+1 counters, "-1" for -1/-1, "3 charge" for others. */
function Counters({ card }: { card: Card }) {
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
 * Auras and Equipment attached to a permanent, tucked behind it with their tops showing.
 * Click one to use it (an Equipment's equip ability), hover to read it.
 */
function Attachments({ cards }: { cards: Card[] }) {
  const { glow } = useView();
  return (
    <>
      {cards.map((c, i) => (
        <div
          key={c.id}
          data-card={c.id}
          className={cx('tile-attached', `frame-${frameOf(data(c))}`, glow.get(c.id) && `glow-${glow.get(c.id)}`)}
          style={{ '--i': i } as CSSProperties}
          onClick={(e) => {
            e.stopPropagation();
            clickPermanent(c);
          }}
          {...hoverProps(data(c).name)}
        >
          <div className="tile-attached-art" style={{ backgroundImage: `url(${data(c).art})` }} />
          <span>{data(c).name}</span>
        </div>
      ))}
    </>
  );
}

/** The hover text for a permanent's activated abilities: its `activated` one, and each loyalty ability (606). */
const abilityText = (card: Card) => {
  const script = scriptFor(card);
  return [...activatedAbilities(card).map((ab) => ab.text), ...(script.loyalty ?? []).map((ab) => `${loyaltyCost(ab.cost)}: ${ab.text}`)].filter(Boolean).join('\n');
};

export function Permanent({ card, badge }: { card: Card; badge?: Card[] }) {
  const v = useView();
  const g = v.g;
  const d = data(card);
  const creature = isCreature(card);
  const s = creature ? stats(g, card) : null;
  const attacking = g.combat?.attacks.some((a) => a.id === card.id) ?? false;
  const blocking = g.combat?.attacks.some((a) => a.blockers.includes(card.id)) ?? false;
  const glow = v.glow.get(card.id);
  const rem = useRem();
  const [dx, dy] = INWARD[seatOf(g, v.me, card.controller)];
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
        card.isCommander && 'commander',
        v.mana.has(card.id) && 'mana-source',
        glow && `glow-${glow}`,
      )}
      initial={{ opacity: 0, scale: 0.6 }}
      animate={{ opacity: 1, scale: 1, rotate: card.tapped ? 8 : 0, x: dx * lift, y: dy * lift }}
      exit={{ opacity: 0, scale: 0.4, transition: { duration: 0.3 } }}
      transition={SPRING}
      onClick={() => clickPermanent(card)}
      {...hoverProps(d.name)}
    >
      {attached.length > 0 && <Attachments cards={attached} />}
      <div className="tile-face">
        <div className="tile-art" style={{ backgroundImage: `url(${d.art})` }} />
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
        {isPlaneswalker(card) && !s && (
          <div className="tile-pt tile-loyalty" title="Loyalty">
            {loyaltyOf(card)}
          </div>
        )}
        {isBattle(card) && (
          <div className="tile-pt tile-defense" title={`Defense${card.protector !== null ? ` — protected by ${g.players[card.protector].name}` : ''}`}>
            {defenseOf(card)}
          </div>
        )}
        <Counters card={card} />
        {sick && <i className="tile-sick ms ms-ability-summoning-sickness" title="Summoning sick" />}
        {(scriptFor(card).activated || scriptFor(card).loyalty) && <div className="tile-ability" title={abilityText(card)} />}
        {card.tapped && <div className="tile-tapmark" />}
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

/** How far up (rem) a hand card must be dragged before letting go plays it. */
const PLAY_PULL = 9;
const HELD_SCALE = 1.1;
/** Width of a hand card in rem. Keep in step with .hand-slot in styles.css. */
const HAND_W = 15;

/**
 * A full card in the human's hand: fanned out, lifts and zooms on hover. A click does
 * nothing, so rearranging can't play a card by accident, except while a spell is being cast:
 * then it picks a card to exile for its cost, or uses a card's mana ability from the hand. Dragging it sideways moves it to
 * another place in the hand (`onMove` gets the slot it is over); dragging it up toward the
 * table and letting go plays it. A card just drawn (`drawn` is its place in the batch) flies
 * in face down from the library and turns face up on the way.
 */
export function HandCard({
  card,
  index,
  total,
  drawn,
  onMove,
}: {
  card: Card;
  index: number;
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
  const { gap, x, tilt, drop } = fan(index, total, 10.5, 84);
  const fly = useFlight(drawn, () =>
    onLibrary(card.owner, document.querySelector('.hand'), 0, x * rem, HAND_W * rem, HAND_W * 1.4 * rem),
  );
  // The next card covers this one's right side, so the cost sits at the right end of the part
  // that still shows. A card that is on top of the others gets it on its real corner.
  const onTop = hot || held !== null || index === total - 1;
  const costRight = onTop ? 0.5 : HAND_W - gap + 0.3;
  // -8.6rem keeps the zoomed card's bottom edge just past the screen edge, so the
  // pointer never falls off the card and makes it flicker. Hovering waits until the card lands.
  const pose = held
    ? { rotate: 0, x: held.x, y: held.y, scale: HELD_SCALE }
    : hot && !fly.flying
      ? { rotate: 0, x: 0, y: -8.6 * rem, scale: 1.5 }
      : { rotate: tilt, x: 0, y: drop * rem, scale: 1 };
  return (
    // The slot is the card's place in the fan and what the pointer drags; the card inside poses on top of it.
    <motion.div
      ref={slot}
      layoutId={card.id}
      className="hand-slot"
      style={{ left: `${x}rem`, zIndex: held ? 101 : hot ? 100 : index }}
      drag={!fly.flying}
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
        const to = Math.max(0, Math.min(total - 1, Math.round(from.current + info.offset.x / (gap * rem))));
        if (!armed && to !== index) onMove(to);
      }}
      onDragEnd={(_, info) => {
        if (info.offset.y < -PLAY_PULL * rem) playHandCard(card);
        setHeld(null);
        setHot(false);
      }}
      onMouseEnter={() => setHot(true)}
      onMouseLeave={() => setHot(false)}
      onClick={() => (glow === 'target' || (v.paying && v.mana.has(card.id))) && playHandCard(card)}
    >
      <motion.div
        className={cx('hand-card', glow && `glow-${glow}`, held?.armed && glow && 'armed')}
        style={{ originY: 1, transformPerspective: 120 * rem }}
        initial={fly.start ? { opacity: 1, rotateY: 180, ...fly.start } : { opacity: 0, y: 8 * rem }}
        animate={{ opacity: 1, rotateY: 0, ...pose }}
        transition={fly.transition}
        onAnimationComplete={fly.landed}
      >
        {fly.flying && <div className="card-back" />}
        <img src={d.image} alt={d.name} draggable={false} />
        {d.manaCost && (
          <div className="hand-cost" style={{ right: `${costRight}rem` }}>
            <ManaCost cost={d.manaCost} />
          </div>
        )}
      </motion.div>
    </motion.div>
  );
}

/** Width of a face-down card in an opponent's hand in rem. Keep in step with .opp-fan .card-back. */
const BACK_W = 9;

/**
 * A face-down card in an opponent's hand, fanned like the human's but smaller and tighter.
 * `fanEl` is the hand's anchor; a card just drawn flies in from `pid`'s library.
 */
export function HandBack({
  pid,
  fanEl,
  index,
  total,
  span,
  drawn,
}: {
  pid: number;
  fanEl: RefObject<HTMLDivElement | null>;
  index: number;
  total: number;
  span: number;
  drawn?: number;
}) {
  const rem = useRem();
  const { x, tilt, drop } = fan(index, total, 4.6, span);
  const fly = useFlight(drawn, () => {
    const el = fanEl.current;
    const turn = el ? parseFloat(getComputedStyle(el).rotate) || 0 : 0;
    return onLibrary(pid, el, turn, 0, BACK_W * rem, BACK_W * 1.4 * rem);
  });
  return (
    <motion.div
      className="card-back"
      style={{ originY: 1 }}
      initial={fly.start ? { opacity: 1, ...fly.start } : { opacity: 0, y: 6 * rem }}
      animate={{ opacity: 1, x: x * rem, y: drop * 0.6 * rem, rotate: tilt, scale: 1 }}
      transition={fly.transition}
      onAnimationComplete={fly.landed}
    />
  );
}
