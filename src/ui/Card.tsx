import { useRef, useState } from 'react';
import { motion } from 'motion/react';
import { data, isCreature, scriptOf, stats } from '../engine';
import type { Card, CardData } from '../engine';
import { useRem } from './rem';
import { SEATS, cx, hoverProps } from './util';
import { clickPermanent, playHandCard, useView } from './view';

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
  const symbols = [...cost.matchAll(/\{([^}]+)\}/g)].map((m) => m[1].toLowerCase());
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

/** Where card `index` sits in a fanned hand of `total`: gap between cards, sideways shift and drop in rem, tilt in degrees. */
function fan(index: number, total: number, maxGap: number, span: number) {
  const offset = index - (total - 1) / 2;
  const gap = Math.min(maxGap, span / Math.max(total, 1));
  return { gap, x: offset * gap, tilt: offset * 2, drop: Math.abs(offset) ** 1.6 * 0.3 };
}

/**
 * A permanent on the battlefield, drawn Arena-style: cropped art, name bar, P/T box.
 * The outer tile is the space it takes on screen; the face inside is turned for the side seats.
 */
export function Permanent({ card, badge }: { card: Card; badge?: string }) {
  const v = useView();
  const g = v.g;
  const d = data(card);
  const creature = isCreature(card);
  const s = creature ? stats(g, card) : null;
  const attacking = g.combat?.attacks.some((a) => a.id === card.id) ?? false;
  const blocking = g.combat?.attacks.some((a) => a.blockers.includes(card.id)) ?? false;
  const glow = v.glow.get(card.id);
  const rem = useRem();
  const [dx, dy] = INWARD[SEATS[card.owner]];
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
  const sick = creature && card.sick && g.active === card.owner && !s!.keywords.has('haste');

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
      {...hoverProps(card.name)}
    >
      <div className="tile-face">
        <div className="tile-art" style={{ backgroundImage: `url(${d.art})` }} />
        <div className="tile-name">
          {card.isCommander && <span className="crown">♛</span>}
          {d.name}
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
        {card.counters > 0 && <div className="tile-counters">+{card.counters}</div>}
        {sick && <i className="tile-sick ms ms-ability-summoning-sickness" title="Summoning sick" />}
        {scriptOf(card.name).activated && <div className="tile-ability" title={scriptOf(card.name).activated!.text} />}
        {card.tapped && <div className="tile-tapmark" />}
        {badge && <div className="tile-badge">{badge}</div>}
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
 * A full card in the human's hand: fanned out, lifts and zooms on hover. Nothing happens on
 * a click, so rearranging can't play a card by accident. Dragging it sideways moves it to
 * another place in the hand (`onMove` gets the slot it is over); dragging it up toward the
 * table and letting go plays it.
 */
export function HandCard({ card, index, total, onMove }: { card: Card; index: number; total: number; onMove: (to: number) => void }) {
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
  // The next card covers this one's right side, so the cost sits at the right end of the part
  // that still shows. A card that is on top of the others gets it on its real corner.
  const onTop = hot || held !== null || index === total - 1;
  const costRight = onTop ? 0.5 : HAND_W - gap + 0.3;
  // -8.6rem keeps the zoomed card's bottom edge just past the screen edge, so the
  // pointer never falls off the card and makes it flicker.
  const pose = held
    ? { rotate: 0, x: held.x, y: held.y, scale: HELD_SCALE }
    : hot
      ? { rotate: 0, x: 0, y: -8.6 * rem, scale: 1.5 }
      : { rotate: tilt, x: 0, y: drop * rem, scale: 1 };
  return (
    // The slot is the card's place in the fan and what the pointer drags; the card inside poses on top of it.
    <motion.div
      ref={slot}
      layoutId={card.id}
      className="hand-slot"
      style={{ left: `${x}rem`, zIndex: held ? 101 : hot ? 100 : index }}
      drag
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
    >
      <motion.div
        className={cx('hand-card', glow && `glow-${glow}`, held?.armed && glow && 'armed')}
        style={{ originY: 1 }}
        initial={{ opacity: 0, y: 8 * rem }}
        animate={{ opacity: 1, ...pose }}
        transition={SPRING}
      >
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

/** A face-down card in an opponent's hand, fanned like the human's but smaller and tighter. */
export function HandBack({ index, total, span }: { index: number; total: number; span: number }) {
  const rem = useRem();
  const { x, tilt, drop } = fan(index, total, 4.6, span);
  return (
    <motion.div
      className="card-back"
      style={{ originY: 1 }}
      initial={{ opacity: 0, y: 6 * rem }}
      animate={{ opacity: 1, x: x * rem, y: drop * 0.6 * rem, rotate: tilt }}
      transition={SPRING}
    />
  );
}
