import { useEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { cardData } from '../cards/db';
import { COMMANDER_DAMAGE, attachmentsOf, creaturesOf, data, isCreature, isHidden, isLand, permanent } from '../engine';
import type { Card, ManaSym, Player } from '../engine';
import { HandBack, HandCard, HiddenHandCard, Permanent } from './Card';
import { Flights } from './Flights';
import { CardImage } from './TextCard';
import { useRem } from './rem';
import { useStore } from './store';
import { cx, deckColor, faceUp, hoverProps, seatOf } from './util';
import { clickCrown, clickPlayer, useView } from './view';

const vars = (v: Record<string, string | number>) => v as CSSProperties;

/** Tile width (rem) that lets `n` tiles share a row, capped at `max`. */
const fit = (n: number, width: number, max: number, gap = 0.8) => Math.min(max, (width - gap * (n - 1)) / Math.max(n, 1));

/** True while mana this permanent was tapped for is still floating unspent in its owner's pool. */
const floating = (player: Player, c: Card) => player.pool.some((m) => m.source === c.id);

/**
 * A player's creatures. Identical tokens pile up like lands; the pile's badge attacks or
 * blocks with all of them. While their owner picks attackers or blockers, each token's
 * choice is part of its pile, so clicking one moves it to a pile of its own. Once combat is
 * underway the fighting ones stand alone. A side-seat board wraps onto two rows once that
 * makes the tiles bigger than squeezing them into one.
 */
function CreatureRow({ player, width, max, className, wrap }: { player: Player; width: number; max: number; className: string; wrap?: boolean }) {
  const v = useView();
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
  const units = [...groups.values()].reduce((n, s) => n + 1 + 0.14 * (s.length - 1), 0);
  const oneRow = fit(units, width, max);
  const wrapped = wrap ? fit(Math.ceil(units / 2), width, Math.min(max, 9.5)) : 0;
  const twoRows = wrapped > oneRow;
  const tw = Math.max(oneRow, wrapped);
  return (
    <div className={cx('row', className, twoRows && 'two-rows')} style={vars({ '--tw': `${tw}rem` })}>
      <AnimatePresence>
        {[...groups.values()].map((stack) =>
          stack.length === 1 ? (
            <Permanent key={stack[0].id} card={stack[0]} />
          ) : (
            <div className="stack" key={`stack-${stack[0].id}`}>
              {stack.map((c, i) => (
                <Permanent key={c.id} card={c} badge={i === stack.length - 1 ? stack : undefined} />
              ))}
            </div>
          ),
        )}
      </AnimatePresence>
    </div>
  );
}

/**
 * Lands on one side, artifacts and enchantments on the other. Lands stack by name, with
 * tapped ones apart, and ones whose mana is still unspent in the pool apart again. The
 * pile's badge taps (or untaps) the whole pile.
 * With `split` the two sides sit either side of the avatar and each gets `width` to itself.
 */
function BackRow({ player, width, max, className, split }: { player: Player; width: number; max: number; className: string; split?: boolean }) {
  const g = useView().g;
  const lands = player.battlefield.filter((x) => isLand(g, x));
  // Auras and Equipment attached to something are drawn under it instead (see `Permanent`).
  const others = player.battlefield.filter((c) => !isLand(g, c) && !isCreature(g, c) && !(c.attachedTo && permanent(g, c.attachedTo)));
  // Phased-out permanents are treated as though they don't exist (702.26b), but stay in view, faded.
  const phased = player.phasedOut ?? [];
  const stacks = new Map<string, Card[]>();
  const order = (c: Card) => Number(floating(player, c)) * 2 + Number(c.tapped);
  for (const c of [...lands].sort((a, b) => a.name.localeCompare(b.name) || order(b) - order(a))) {
    const key = `${c.name}|${c.tapped}|${floating(player, c)}`;
    stacks.set(key, [...(stacks.get(key) ?? []), c]);
  }
  const landUnits = [...stacks.values()].reduce((n, s) => n + 1 + 0.14 * (s.length - 1), 0);
  const tw = split
    ? Math.min(fit(landUnits, width, max, 1.2), fit(others.length, width, max, 1.2))
    : fit(landUnits + others.length + phased.length, width, max, 1.2);
  return (
    <div className={cx('row back', className)} style={vars({ '--tw': `${tw}rem` })}>
      <div className="lands">
        {[...stacks.entries()].map(([key, stack]) => (
          <div className="stack" key={key}>
            {stack.map((c, i) => (
              <Permanent key={c.id} card={c} badge={stack.length > 1 && i === stack.length - 1 ? stack : undefined} />
            ))}
          </div>
        ))}
      </div>
      <div className="others">
        <AnimatePresence>
          {others.map((c) => (
            <Permanent key={c.id} card={c} />
          ))}
          {phased.map((c) => (
            <Permanent key={c.id} card={c} phased />
          ))}
        </AnimatePresence>
      </div>
    </div>
  );
}

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
      className={cx('pile', zone, !top && 'empty', castable && 'glow-play')}
      data-pile={`${player.id}-${zone}`}
      title={`${name}: ${cards.length} cards${top ? ' — click to view' : ''}`}
      onClick={() => top && useStore.setState({ viewer: { pid: player.id, zone } })}
    >
      {top && (faceUp(top, v.me) ? <CardImage d={data(top)} alt="" draggable={false} /> : <div className="card-back" />)}
      <i className={`ms ms-${zone}`} />
      <span className="count">{cards.length}</span>
    </div>
  );
}

function Piles({ player }: { player: Player }) {
  return (
    <>
      <div className="pile library" data-library={player.id} title={`Library: ${player.library.length} cards`}>
        <div className="card-back" />
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
 * An opponent's hand: face-down cards fanned out from their edge of the table. The hand
 * only shows a count, so a bigger hand next to a smaller library means the new cards were drawn.
 */
function OpponentHand({ player, span }: { player: Player; span: number }) {
  const fanEl = useRef<HTMLDivElement>(null);
  const shown = Math.min(player.hand.length, 12);
  const before = usePrevious({ hand: Math.min(player.hand.length, 12), library: player.library.length });
  const drew = shown > before.hand && player.library.length < before.library;
  return (
    <div className="opp-hand" data-hand-of={player.id} title={`${player.hand.length} cards in hand`}>
      <div className="opp-fan" ref={fanEl}>
        {Array.from({ length: shown }, (_, i) => (
          <HandBack
            key={i}
            pid={player.id}
            fanEl={fanEl}
            index={i}
            total={shown}
            span={span}
            drawn={drew && i >= before.hand ? i - before.hand : undefined}
          />
        ))}
      </div>
      <span className="count">{player.hand.length}</span>
    </div>
  );
}

/** An opponent's side of the table, laid out from their own edge inward: hand, lands, creatures. */
export function OpponentPanel({ player }: { player: Player }) {
  const { g, me } = useView();
  const seat = seatOf(g, me, player.id);
  // The top seat has the long edge; the side seats are shorter, so they fan tighter and wrap.
  const side = seat !== 'top';
  return (
    <section
      className={cx('opp', `seat-${seat}`, g.active === player.id && 'active', player.lost && 'lost')}
      style={vars({ '--deck': deckColor(player.colors) })}
    >
      <header className="opp-head">
        <Avatar player={player} />
        <OpponentHand player={player} span={side ? 20 : 30} />
        <div className="opp-zones">
          <Piles player={player} />
        </div>
      </header>
      <BackRow player={player} width={side ? 60 : 104} max={11} className="opp-back" />
      <CreatureRow player={player} width={side ? 61 : 111} max={side ? 14 : 14.5} className="opp-front" wrap={side} />
      {player.lost && <div className="defeated">Defeated</div>}
    </section>
  );
}

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

export function PlayerField({ player }: { player: Player }) {
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
  const moveCard = (from: number, to: number) => {
    const ids = hand.map((c) => c.id);
    ids.splice(to, 0, ...ids.splice(from, 1));
    useStore.setState({ handOrder: ids });
  };
  return (
    <>
      <CreatureRow player={player} width={113} max={17} className="me-front" />
      <BackRow player={player} width={50} max={14} className="me-back" split />
      <div className="me-avatar">
        <Avatar player={player} />
        <ManaPool player={player} />
      </div>
      <div className="me-zones">
        <Piles player={player} />
      </div>
      <div className="hand" data-hand-of={player.id}>
        {hand.map((c, i) => {
          const d = drawn.includes(c.id) ? drawn.indexOf(c.id) : undefined;
          // Watching the bots, nobody sits at the bottom, so that seat's hand is hidden too (`viewFor`).
          if (isHidden(c)) return <HiddenHandCard key={c.id} card={c} index={i} total={hand.length} drawn={d} />;
          return <HandCard key={c.id} card={c} index={i} total={hand.length} drawn={d} onMove={(to) => moveCard(i, to)} />;
        })}
      </div>
      {/* Cards moving between zones, drawn over the whole table. */}
      <Flights />
    </>
  );
}
