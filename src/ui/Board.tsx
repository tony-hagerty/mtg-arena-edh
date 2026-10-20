import { memo, useEffect, useRef, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { AnimatePresence, LayoutGroup, motion } from 'motion/react';
import { cardData } from '../cards/db';
import { COMMANDER_DAMAGE, attachmentsOf, creaturesOf, data, isCreature, isHidden, isLand, permanent } from '../engine';
import type { Card, Game, ManaSym, Player } from '../engine';
import { HandBack, HandCard, HiddenHandCard, Permanent } from './Card';
import { CardImage } from './TextCard';
import { useRem } from './rem';
import { useStore } from './store';
import { useStageSize } from './camera';
import { HAND_VISIBLE, TILE, fanAngle, handPills, handWindow, rowGap, seatBox, seatScale } from './table-layout';
import type { Pt } from './table-layout';
import { cx, deckColor, faceUp, hoverProps, seatClass, seatOf } from './util';
import type { Seat as SeatPos } from './util';
import { clickCrown, clickPlayer, useView } from './view';
import type { View } from './view';

const vars = (v: Record<string, string | number>) => v as CSSProperties;

/** True while mana this permanent was tapped for is still floating unspent in its owner's pool. */
const floating = (player: Player, c: Card) => player.pool.some((m) => m.source === c.id);

/**
 * A player's creatures in piles. Identical tokens pile up like lands; the pile's badge
 * attacks or blocks with all of them. While their owner picks attackers or blockers, each
 * token's choice is part of its pile, so clicking one moves it to a pile of its own. Once
 * combat is underway the fighting ones stand alone.
 */
function creaturePiles(v: View, player: Player): Card[][] {
  const g = v.g;
  const fighting = new Set((g.combat?.attacks ?? []).flatMap((a) => [a.id, ...a.blockers]));
  const choosing = v.mine && player.id === v.me && (g.decision?.type === 'attackers' || g.decision?.type === 'blockers');
  const groups = new Map<string, Card[]>();
  for (const c of creaturesOf(g, player.id)) {
    const stackable = c.isToken && (choosing || !fighting.has(c.id));
    const attack = g.combat?.attacks.find((a) => a.id === c.id || a.blockers.includes(c.id));
    const choice = choosing ? [attack && (attack.id === c.id ? `attacks ${attack.defender} ${attack.target}` : `blocks ${attack.id}`), v.glow.get(c.id)] : [];
    const attached = attachmentsOf(g, c).length > 0;
    const key = stackable && !attached ? [c.name, c.tapped, floating(player, c), c.sick, JSON.stringify(c.counters), c.damage, c.continuous.length, ...choice].join('|') : c.id;
    groups.set(key, [...(groups.get(key) ?? []), c]);
  }
  return [...groups.values()];
}

/**
 * A player's lands in piles: by name, with tapped ones apart, and ones whose mana is still
 * unspent in the pool apart again. The pile's badge taps (or untaps) the whole pile.
 */
function landPiles(g: Game, player: Player): Card[][] {
  const lands = player.battlefield.filter((x) => isLand(g, x));
  const piles = new Map<string, Card[]>();
  const order = (c: Card) => Number(floating(player, c)) * 2 + Number(c.tapped);
  for (const c of [...lands].sort((a, b) => a.name.localeCompare(b.name) || order(b) - order(a))) {
    // An enchanted land stands alone, so what is attached to it shows (see `Permanent`).
    const key = attachmentsOf(g, c).length ? c.id : `${c.name}|${c.tapped}|${floating(player, c)}`;
    piles.set(key, [...(piles.get(key) ?? []), c]);
  }
  return [...piles.values()];
}

/** A player's artifacts, enchantments and the rest, and their phased-out permanents. */
function otherPermanents(g: Game, player: Player) {
  // Auras and Equipment attached to something are drawn under it instead (see `Permanent`).
  const others = player.battlefield.filter((c) => !isLand(g, c) && !isCreature(g, c) && !(c.attachedTo && permanent(g, c.attachedTo)));
  // Phased-out permanents are treated as though they don't exist (702.26b), but stay in view, faded.
  return { others, phased: player.phasedOut ?? [] };
}

/** A row of a seat: its tiles `tw` rem wide, `gap` rem apart (less than nothing once they overlap). */
function Row({ className, tw, gap, children }: { className: string; tw: number; gap: number; children: ReactNode }) {
  return (
    <div className={cx('row', className)} style={vars({ '--tw': `${tw}rem`, '--gap': `${gap}rem` })}>
      {children}
    </div>
  );
}

/** A pile of permanents overlapping along the row; the top one carries the pile's badge. */
function Pile({ cards }: { cards: Card[] }) {
  return (
    <div className="stack">
      {cards.map((c, i) => (
        <Permanent key={c.id} card={c} badge={cards.length > 1 && i === cards.length - 1 ? cards : undefined} />
      ))}
    </div>
  );
}

/**
 * One player's rows on the table, in their corner (`seatBox`): lands nearest their edge, then
 * the other permanents, then creatures nearest the middle. The cards stay upright whoever
 * controls them, and grow while the rows fit the seat (`seatScale`).
 */
export const Seat = memo(function Seat({ player }: { player: Player }) {
  const v = useView();
  const g = v.g;
  const seat = seatOf(g, v.me, player.id);
  const stage = useStageSize();
  const box = seatBox(seat, stage.w, stage.h);
  const creatures = creaturePiles(v, player);
  const lands = landPiles(g, player);
  const { others, phased } = otherPermanents(g, player);
  const sizes = (piles: Card[][]) => piles.map((p) => p.length);
  const otherSizes = [...others, ...phased].map(() => 1);
  const k = seatScale({
    rows: [
      { ...TILE.other, piles: sizes(lands) },
      { ...TILE.other, piles: otherSizes },
      { ...TILE.creature, piles: sizes(creatures) },
    ],
    rowLen: box.width,
    room: box.height,
  });
  const size = (kind: keyof typeof TILE, piles: number[]) => {
    const tw = TILE[kind].w * k;
    return { tw, gap: rowGap(piles, tw, TILE[kind].gap, box.width) };
  };
  return (
    <section
      className={cx('seat', seatClass(seat), g.active === player.id && 'active', player.lost && 'lost')}
      style={vars({
        left: `${box.left}rem`,
        top: `${box.top}rem`,
        width: `${box.width}rem`,
        height: `${box.height}rem`,
        rotate: `${box.lean}deg`,
        '--deck': deckColor(player.colors),
      })}
    >
      {/* One layout group: a tile that changes marks the seat's other tiles for measuring too, so they still slide when a row reflows although, memoized, they didn't re-render. */}
      <LayoutGroup>
        <Row className="lands" {...size('other', sizes(lands))}>
          {lands.map((pile) => (
            <Pile key={pile[0].id} cards={pile} />
          ))}
        </Row>
        <Row className="others" {...size('other', otherSizes)}>
          <AnimatePresence>
            {others.map((c) => (
              <Permanent key={c.id} card={c} />
            ))}
            {phased.map((c) => (
              <Permanent key={c.id} card={c} phased />
            ))}
          </AnimatePresence>
        </Row>
        <Row className="creatures" {...size('creature', sizes(creatures))}>
          <AnimatePresence>
            {creatures.map((pile) => (pile.length === 1 ? <Permanent key={pile[0].id} card={pile[0]} /> : <Pile key={`stack-${pile[0].id}`} cards={pile} />))}
          </AnimatePresence>
        </Row>
      </LayoutGroup>
      {player.lost && <div className="defeated">Defeated</div>}
    </section>
  );
});

/** Floating "+3" / "-5" numbers whenever a life total changes. Each one fades out on its own after a couple of seconds. */
function useLifeDeltas(life: number) {
  const prev = useRef(life);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const [deltas, setDeltas] = useState<{ id: number; n: number }[]>([]);
  useEffect(() => {
    const n = life - prev.current;
    prev.current = life;
    if (n === 0) return;
    const id = Math.random();
    setDeltas((d) => [...d, { id, n }]);
    // Not cancelled when life changes again: a second hit right after the first used to leave the first number up for good.
    timers.current.push(setTimeout(() => setDeltas((d) => d.filter((x) => x.id !== id)), 2000));
  }, [life]);
  useEffect(() => () => timers.current.forEach(clearTimeout), []);
  return deltas;
}

function Avatar({ player }: { player: Player }) {
  const v = useView();
  const g = v.g;
  const deltas = useLifeDeltas(player.life);
  const rem = useRem();
  const thinking = g.priority === player.id && player.isBot && g.step !== 'gameOver';
  return (
    <div
      className={cx(
        'avatar',
        g.active === player.id && 'active',
        v.targetPlayers.has(player.id) && 'targetable',
        v.attackTarget?.target === null && v.attackTarget.defender === player.id && 'attack-target',
        player.lost && 'lost',
        player.commanders.length > 1 && 'pair',
      )}
      style={vars({ '--deck': deckColor(player.colors) })}
      data-avatar={player.id}
      onClick={() => clickPlayer(player.id)}
    >
      <div className="avatar-rays" />
      {/* The portrait is the player's commander, split in two for partners: hover a half to read the card. */}
      <div className={cx('avatar-art', player.commanders.length > 1 && 'split')}>
        {player.commanders.map((name) => (
          <div key={name} style={{ backgroundImage: `url(${cardData(name).art})` }} {...hoverProps(name)} />
        ))}
      </div>
      {player.commanders.map((name, i) => (
        <CommanderBadges key={name} player={player} name={name} index={i} />
      ))}
      <div className="avatar-life">{player.lost ? '✕' : player.life}</div>
      <div className="avatar-name">
        {player.name}
        {thinking && <span className="dots" />}
      </div>
      <div className="cmd-dmg">
        {/* One badge per commander that has hit this player: partners count separately (702.124d). */}
        {g.players.flatMap((o) =>
          o.commanders
            .map((name, i) => ({ name, n: player.commanderDamage[o.id][i] }))
            .filter(({ n }) => n > 0)
            .map(({ name, n }) => (
              <span
                key={`${o.id}:${name}`}
                title={`Commander damage from ${o.name}'s ${name}: ${n} of ${COMMANDER_DAMAGE}`}
                style={{ backgroundImage: `url(${cardData(name).art})` }}
              >
                <b>{n}</b>
              </span>
            )),
        )}
      </div>
      <AnimatePresence>
        {deltas.map((d) => (
          <motion.div
            key={d.id}
            className={cx('life-delta', d.n > 0 ? 'up' : 'down')}
            initial={{ opacity: 0, y: 0, scale: 0.6 }}
            animate={{ opacity: 1, y: -4 * rem, scale: 1 }}
            exit={{ opacity: 0, transition: { duration: 0.8 } }}
          >
            {d.n > 0 ? `+${d.n}` : d.n}
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}

/**
 * The badges on the portrait's rim for one commander: the human's crown to cast it from
 * the command zone, and its commander tax (903.8). With partners, each commander's badges
 * sit on its own half of the portrait.
 */
function CommanderBadges({ player, name, index }: { player: Player; name: string; index: number }) {
  const v = useView();
  const c = player.command.find((x) => x.name === name);
  // Tax is tracked per commander (702.124d), so it can be read off the card wherever it is.
  const tax = 2 * player.commanderCasts[index];
  return (
    <>
      {player.id === v.me && <CastCrown player={player} c={c} name={name} index={index} />}
      {tax > 0 && (
        <div className={cx('avatar-tax', index > 0 && 'second')} title={`Commander tax: casting ${name} again costs ${tax} more`}>
          +{tax}
        </div>
      )}
    </>
  );
}

/**
 * The human's crown for one commander: click it to cast that commander from the command
 * zone. While the commander is anywhere else the crown is dimmed and does nothing.
 */
function CastCrown({ player, c, name, index }: { player: Player; c: Card | undefined; name: string; index: number }) {
  const v = useView();
  const glow = c && v.glow.get(c.id);
  return (
    <motion.button
      key={c?.id ?? `away:${name}`}
      data-card={c?.id}
      className={cx('avatar-crown', index > 0 && 'second', glow && `glow-${glow}`, !c && 'away')}
      aria-disabled={!c}
      aria-label={c ? `Cast ${c.name}` : `${name} is not in the command zone`}
      title={c ? undefined : `${name} is not in the command zone`}
      onClick={(e) => {
        e.stopPropagation();
        clickCrown(player.id, c);
      }}
      {...(c ? hoverProps(data(c)) : {})}
    >
      <span>♛</span>
    </motion.button>
  );
}

/** A face-up pile. Always drawn, even when empty; shows its top card and opens the full list on click. */
function FaceUpPile({ player, zone }: { player: Player; zone: 'graveyard' | 'exile' }) {
  const v = useView();
  const cards = player[zone];
  // Something in it can be cast: flashback, or an adventurer card (702.34a, 715.3d).
  const castable = cards.some((c) => v.glow.get(c.id) === 'play');
  const top = cards[cards.length - 1];
  const name = zone === 'graveyard' ? 'Graveyard' : 'Exile';
  return (
    <div
      className={cx('pile', zone, !top && 'empty', cards.length > 1 && 'many', castable && 'glow-play')}
      data-pile={`${player.id}-${zone}`}
      title={`${name}: ${cards.length} cards${top ? ' — click to view' : ''}`}
      // The viewer covers the pile, so its preview goes with it.
      onClick={() => top && useStore.setState({ viewer: { pid: player.id, zone }, hover: null })}
    >
      {/* Keyed by the card, so the preview moves on when a new card lands on top. */}
      {top && (faceUp(top, v.me) ? <CardImage key={top.id} d={data(top)} alt="" draggable={false} data-card={top.id} {...hoverProps(data(top))} /> : <div className="card-back" />)}
      <i className={`ms ms-${zone}`} />
      <span className="count">{cards.length}</span>
    </div>
  );
}

function Piles({ player }: { player: Player }) {
  return (
    <>
      {/* The deck's edges thicken with its size (--depth). The back stays when it is empty: draws measure it. */}
      <div
        className={cx('pile', 'library', !player.library.length && 'empty')}
        data-library={player.id}
        title={`Library: ${player.library.length} cards`}
        style={vars({ '--depth': Math.min(1, player.library.length / 60).toFixed(2) })}
      >
        <div className="card-back" />
        <i className="ms ms-library" />
        <span className="count">{player.library.length}</span>
      </div>
      <FaceUpPile player={player} zone="graveyard" />
      <FaceUpPile player={player} zone="exile" />
    </>
  );
}

/** `value` as it was on the previous render (the current one on the first). */
function usePrevious<T>(value: T) {
  const prev = useRef(value);
  useEffect(() => {
    prev.current = value;
  });
  return prev.current;
}

/**
 * An opponent's hand: face-down cards fanned out of their corner, partly off the screen,
 * with a count. The hand only shows a count, so a bigger hand next to a smaller library
 * means the new cards were drawn.
 */
function OpponentHand({ player, seat }: { player: Player; seat: SeatPos }) {
  const fanEl = useRef<HTMLDivElement>(null);
  const shown = Math.min(player.hand.length, 12);
  const before = usePrevious({ hand: Math.min(player.hand.length, 12), library: player.library.length });
  const drew = shown > before.hand && player.library.length < before.library;
  return (
    <div className="opp-hand">
      <div className="opp-fan" ref={fanEl}>
        {/* Where a card going to this hand flies (Flights.tsx): a card back's place in the middle of the fan, never drawn. */}
        <div className="card-back opp-hand-spot" data-hand-of={player.id} style={{ rotate: `${fanAngle(0, 1, seat)}deg` }} />
        {Array.from({ length: shown }, (_, i) => (
          <HandBack key={i} pid={player.id} fanEl={fanEl} angle={fanAngle(i, shown, seat)} drawn={drew && i >= before.hand ? i - before.hand : undefined} />
        ))}
      </div>
      <span className="count" title={`${player.hand.length} cards in hand`}>
        {player.hand.length}
      </span>
    </div>
  );
}

/**
 * The parts of a player's seat that stand on the screen rather than lie on the table: the
 * portrait on their side edge, the library, graveyard and exile on their top or bottom edge,
 * and an opponent's hand fanned out of their corner. `you`: the seat at the bottom, whose
 * hand is `PlayerHand` and whose portrait carries the mana pool.
 */
export const SeatHud = memo(function SeatHud({ player, you }: { player: Player; you: boolean }) {
  const { g, me } = useView();
  const seat = seatOf(g, me, player.id);
  return (
    <div className={cx('seat-hud', seatClass(seat), g.active === player.id && 'active', player.lost && 'lost')} style={vars({ '--deck': deckColor(player.colors) })}>
      <div className="seat-avatar">
        <Avatar player={player} />
        {you && <ManaPool player={player} />}
      </div>
      <div className="seat-zones">
        <Piles player={player} />
      </div>
      {!you && <OpponentHand player={player} seat={seat} />}
    </div>
  );
});

const MANA_ORDER: ManaSym[] = ['W', 'U', 'B', 'R', 'G', 'C'];

/** The mana floating in a player's pool, one symbol per colour. Nothing is drawn while the pool is empty. */
function ManaPool({ player }: { player: Player }) {
  if (!player.pool.length) return null;
  return (
    <div className="mana-pool" title="Mana in your pool">
      {MANA_ORDER.map((sym) => {
        const n = player.pool.filter((m) => m.sym === sym).length;
        return n ? (
          <span key={sym}>
            <i className={`ms ms-${sym.toLowerCase()} ms-cost`} />
            {n > 1 && <b>{n}</b>}
          </span>
        ) : null;
      })}
    </div>
  );
}

/** The hand in the order the player arranged it. Cards they haven't placed yet go on the right. */
function arranged(hand: Card[], order: string[]) {
  const rank = (c: Card) => (order.includes(c.id) ? order.indexOf(c.id) : order.length);
  return [...hand].sort((a, b) => rank(a) - rank(b));
}

/** The scroll pills' shapes never change: worked out once. */
const PILLS = handPills();
/** A polyline in rem (y up from the screen's bottom) as SVG path data for `.hand-pills`, whose y runs down from the bottom edge. */
const pathOf = (pts: Pt[]) => pts.map((p, i) => `${i ? 'L' : 'M'}${p.x.toFixed(2)} ${(-p.y).toFixed(2)}`).join(' ');
/** Hovering a pill moves the hand a card after SCROLL_WAIT ms, then one more every SCROLL_MS, so it never races past the card you wanted. */
const SCROLL_WAIT = 250;
const SCROLL_MS = 450;

/**
 * Over a hand too big for its curve: two pills arcing above the card tops, either side of the
 * middle. Hovering the left one scrolls to earlier cards, the right one to later ones (a click
 * moves one card), and each one's chevrons dim once there is nothing more that way.
 */
function HandPills({ total, start }: { total: number; start: number }) {
  const timers = useRef<{ wait?: ReturnType<typeof setTimeout>; tick?: ReturnType<typeof setInterval> }>({});
  const size = useRef(total);
  size.current = total;
  const stop = () => {
    clearTimeout(timers.current.wait);
    clearInterval(timers.current.tick);
  };
  useEffect(() => stop, []);
  const step = (dir: -1 | 1) => {
    const now = handWindow(useStore.getState().handStart, size.current);
    const next = handWindow(now + dir, size.current);
    if (next === now) stop();
    else useStore.setState({ handStart: next });
  };
  const scroll = (dir: -1 | 1) => {
    stop();
    timers.current.wait = setTimeout(() => {
      step(dir);
      timers.current.tick = setInterval(() => step(dir), SCROLL_MS);
    }, SCROLL_WAIT);
  };
  if (total <= HAND_VISIBLE) return null;
  const pill = (side: 'left' | 'right', dir: -1 | 1, live: boolean, label: string) => {
    const d = pathOf(PILLS[side].path);
    return (
      <g key={side}>
        <path className="pill-rim" d={d} />
        <path className="pill-body" d={d} />
        {PILLS[side].chevron.map((mark, i) => (
          <path key={i} className={cx('pill-chevron', !live && 'spent')} d={pathOf(mark)} />
        ))}
        <path className="pill-hit" d={d} role="button" aria-label={label} onMouseEnter={() => scroll(dir)} onMouseLeave={stop} onClick={() => step(dir)} />
      </g>
    );
  };
  return (
    <svg className="hand-pills" viewBox="0 -40 100 40">
      {pill('left', -1, start > 0, 'Show earlier cards in your hand')}
      {pill('right', 1, start < total - HAND_VISIBLE, 'Show later cards in your hand')}
    </svg>
  );
}

/**
 * Your hand, on its curve out of the bottom-left corner, kept out of the tilted table so
 * dragging a card tracks the pointer. Up to HAND_VISIBLE cards show; a bigger hand scrolls
 * (`handStart` in the store, `HandPills`).
 */
export function PlayerHand({ player }: { player: Player }) {
  const hand = arranged(
    player.hand,
    useStore((s) => s.handOrder),
  );
  // Cards new to the hand since last time, as many as the library shrank by, were just
  // drawn, in draw order. Counted, not matched by id: a player's own view of the game hides
  // their library's cards (`viewFor`), so their ids change once they're in hand.
  const before = usePrevious({ hand: new Set(player.hand.map((c) => c.id)), library: player.library.length });
  const fresh = player.hand.filter((c) => !before.hand.has(c.id)).map((c) => c.id);
  const drawn = fresh.slice(Math.max(0, fresh.length - Math.max(0, before.library - player.library.length)));
  const start = handWindow(useStore((s) => s.handStart), hand.length);
  const moveCard = (from: number, to: number) => {
    const ids = hand.map((c) => c.id);
    ids.splice(to, 0, ...ids.splice(from, 1));
    useStore.setState({ handOrder: ids });
  };
  return (
    <div className="hand" data-hand-of={player.id}>
      <HandPills total={hand.length} start={start} />
      {hand.map((c, i) => {
        const d = drawn.includes(c.id) ? drawn.indexOf(c.id) : undefined;
        // Watching the bots, nobody sits at the bottom, so that seat's hand is hidden too (`viewFor`).
        if (isHidden(c)) return <HiddenHandCard key={c.id} card={c} index={i} slot={i - start} drawn={d} />;
        return <HandCard key={c.id} card={c} index={i} slot={i - start} total={hand.length} drawn={d} onMove={(to) => moveCard(i, to)} />;
      })}
    </div>
  );
}
