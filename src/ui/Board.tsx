import { useEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { DECKS, cardData } from '../cards/db';
import { COMMANDER_DAMAGE, creaturesOf, data, isCreature, isLand } from '../engine';
import type { Card, ManaSym, Player } from '../engine';
import { HandBack, HandCard, Permanent } from './Card';
import { useRem } from './rem';
import { useStore } from './store';
import { SEATS, cx, hoverProps } from './util';
import { clickPlayer, playHandCard, useView } from './view';

const deckColor = (p: Player) => DECKS.find((d) => d.id === p.deckId)!.color;
const vars = (v: Record<string, string | number>) => v as CSSProperties;

/** Tile width (rem) that lets `n` tiles share a row, capped at `max`. */
const fit = (n: number, width: number, max: number, gap = 0.8) => Math.min(max, (width - gap * (n - 1)) / Math.max(n, 1));

/**
 * A player's creatures. Identical tokens pile up like lands (except while their owner is
 * picking attackers or blockers). A side-seat board wraps onto two rows once that makes
 * the tiles bigger than squeezing them into one.
 */
function CreatureRow({ player, width, max, className, wrap }: { player: Player; width: number; max: number; className: string; wrap?: boolean }) {
  const v = useView();
  const g = v.g;
  const fighting = new Set((g.combat?.attacks ?? []).flatMap((a) => [a.id, ...a.blockers]));
  const choosing = v.mine && player.id === v.me && (g.step === 'attackers' || g.step === 'blockers');
  const groups = new Map<string, Card[]>();
  for (const c of creaturesOf(g, player.id)) {
    const stackable = c.isToken && !choosing && !fighting.has(c.id);
    const key = stackable ? [c.name, c.tapped, c.sick, c.counters, c.damage, c.mods.length].join('|') : c.id;
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
                <Permanent key={c.id} card={c} badge={i === stack.length - 1 ? `x${stack.length}` : undefined} />
              ))}
            </div>
          ),
        )}
      </AnimatePresence>
    </div>
  );
}

/**
 * Lands (stacked by name, tapped ones apart) on one side, artifacts and enchantments on the other.
 * With `split` the two sides sit either side of the avatar and each gets `width` to itself.
 */
function BackRow({ player, width, max, className, split }: { player: Player; width: number; max: number; className: string; split?: boolean }) {
  const lands = player.battlefield.filter(isLand);
  const others = player.battlefield.filter((c) => !isLand(c) && !isCreature(c));
  const stacks = new Map<string, Card[]>();
  for (const c of [...lands].sort((a, b) => a.name.localeCompare(b.name) || Number(b.tapped) - Number(a.tapped))) {
    const key = `${c.name}|${c.tapped}`;
    stacks.set(key, [...(stacks.get(key) ?? []), c]);
  }
  const landUnits = [...stacks.values()].reduce((n, s) => n + 1 + 0.14 * (s.length - 1), 0);
  const tw = split
    ? Math.min(fit(landUnits, width, max, 1.2), fit(others.length, width, max, 1.2))
    : fit(landUnits + others.length, width, max, 1.2);
  return (
    <div className={cx('row back', className)} style={vars({ '--tw': `${tw}rem` })}>
      <div className="lands">
        {[...stacks.entries()].map(([key, stack]) => (
          <div className="stack" key={key}>
            {stack.map((c, i) => (
              <Permanent key={c.id} card={c} badge={stack.length > 1 && i === stack.length - 1 ? `x${stack.length}` : undefined} />
            ))}
          </div>
        ))}
      </div>
      <div className="others">
        <AnimatePresence>
          {others.map((c) => (
            <Permanent key={c.id} card={c} />
          ))}
        </AnimatePresence>
      </div>
    </div>
  );
}

/** Floating "+3" / "-5" numbers whenever a life total changes. */
function useLifeDeltas(life: number) {
  const prev = useRef(life);
  const [deltas, setDeltas] = useState<{ id: number; n: number }[]>([]);
  useEffect(() => {
    const n = life - prev.current;
    prev.current = life;
    if (n === 0) return;
    const id = Math.random();
    setDeltas((d) => [...d, { id, n }]);
    const t = setTimeout(() => setDeltas((d) => d.filter((x) => x.id !== id)), 1500);
    return () => clearTimeout(t);
  }, [life]);
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
        v.attackTarget === player.id && 'attack-target',
        player.lost && 'lost',
      )}
      style={vars({ '--deck': `var(--f-${deckColor(player)})` })}
      data-avatar={player.id}
      onClick={() => clickPlayer(player.id)}
    >
      <div className="avatar-rays" />
      <div className="avatar-art" style={{ backgroundImage: `url(${cardData(player.commander).art})` }} />
      <div className="avatar-life">{player.lost ? '✕' : player.life}</div>
      <div className="avatar-name">
        {player.name}
        {thinking && <span className="dots" />}
      </div>
      <div className="cmd-dmg">
        {g.players
          .filter((o) => player.commanderDamage[o.id] > 0)
          .map((o) => (
            <span
              key={o.id}
              title={`Commander damage from ${o.name}: ${player.commanderDamage[o.id]} of ${COMMANDER_DAMAGE}`}
              style={{ backgroundImage: `url(${cardData(o.commander).art})` }}
            >
              <b>{player.commanderDamage[o.id]}</b>
            </span>
          ))}
      </div>
      <AnimatePresence>
        {deltas.map((d) => (
          <motion.div
            key={d.id}
            className={cx('life-delta', d.n > 0 ? 'up' : 'down')}
            initial={{ opacity: 0, y: 0, scale: 0.6 }}
            animate={{ opacity: 1, y: -4 * rem, scale: 1 }}
            exit={{ opacity: 0 }}
          >
            {d.n > 0 ? `+${d.n}` : d.n}
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}

function CommandSlot({ player }: { player: Player }) {
  const v = useView();
  const c = player.command[0];
  const tax = player.commanderCasts * 2;
  return (
    <div className="command-slot" title="Command zone">
      {c ? (
        <motion.div
          layoutId={c.id}
          data-card={c.id}
          className={cx('cmd-card', v.glow.get(c.id) && 'glow-play')}
          onClick={() => player.id === v.me && playHandCard(c)}
          {...hoverProps(c.name)}
        >
          <div className="cmd-face" style={{ backgroundImage: `url(${data(c).art})` }}>
            <span className="crown">♛</span>
            {tax > 0 && <span className="tax">+{tax}</span>}
          </div>
        </motion.div>
      ) : (
        <div className="cmd-empty">♛</div>
      )}
    </div>
  );
}

/** A face-up pile. Always drawn, even when empty; shows its top card and opens the full list on click. */
function FaceUpPile({ player, zone }: { player: Player; zone: 'graveyard' | 'exile' }) {
  const cards = player[zone];
  const top = cards[cards.length - 1];
  const name = zone === 'graveyard' ? 'Graveyard' : 'Exile';
  return (
    <div
      className={cx('pile', zone, !top && 'empty')}
      title={`${name}: ${cards.length} cards${top ? ' — click to view' : ''}`}
      onClick={() => top && useStore.setState({ viewer: { pid: player.id, zone } })}
    >
      {top && <img src={data(top).image} alt="" draggable={false} />}
      <i className={`ms ms-${zone}`} />
      <span className="count">{cards.length}</span>
    </div>
  );
}

function Piles({ player }: { player: Player }) {
  return (
    <>
      <div className="pile library" title={`Library: ${player.library.length} cards`}>
        <div className="card-back" />
        <span className="count">{player.library.length}</span>
      </div>
      <FaceUpPile player={player} zone="graveyard" />
      <FaceUpPile player={player} zone="exile" />
    </>
  );
}

/** An opponent's hand: face-down cards fanned out from their edge of the table. */
function OpponentHand({ player, span }: { player: Player; span: number }) {
  const shown = Math.min(player.hand.length, 12);
  return (
    <div className="opp-hand" title={`${player.hand.length} cards in hand`}>
      <div className="opp-fan">
        {Array.from({ length: shown }, (_, i) => (
          <HandBack key={i} index={i} total={shown} span={span} />
        ))}
      </div>
      <span className="count">{player.hand.length}</span>
    </div>
  );
}

/** An opponent's side of the table, laid out from their own edge inward: hand, lands, creatures. */
export function OpponentPanel({ player }: { player: Player }) {
  const g = useView().g;
  const seat = SEATS[player.id];
  // The top seat has the long edge; the side seats are shorter, so they fan tighter and wrap.
  const side = seat !== 'top';
  return (
    <section
      className={cx('opp', `seat-${seat}`, g.active === player.id && 'active', player.lost && 'lost')}
      style={vars({ '--deck': `var(--f-${deckColor(player)})` })}
    >
      <header className="opp-head">
        <Avatar player={player} />
        <OpponentHand player={player} span={side ? 20 : 30} />
        <div className="opp-zones">
          <CommandSlot player={player} />
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
        <CommandSlot player={player} />
        <Piles player={player} />
      </div>
      <div className="hand">
        {hand.map((c, i) => (
          <HandCard key={c.id} card={c} index={i} total={hand.length} onMove={(to) => moveCard(i, to)} />
        ))}
      </div>
    </>
  );
}
