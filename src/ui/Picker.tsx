// Windows for the decisions where the human picks or orders cards: searching their library,
// keeping or mulliganing a hand, putting cards on the bottom, and ordering their triggers.
// `CardPicker` is the reusable part; `Decisions` chooses which one the game is asking for.
import { useState } from 'react';
import { canMulligan, choiceOptions, data, label, nextMulliganBottom } from '../engine';
import type { Action, Card, CardChoice, Game, PlayerId } from '../engine';
import { useStore } from './store';
import { cx, hoverProps } from './util';
import { useView } from './view';

const act = (a: Action) => useStore.getState().act(a);
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

export interface PickerButton {
  label: string;
  sub?: string;
  tone: 'go' | 'plain';
  disabled?: boolean;
  onClick: () => void;
}

interface PickerProps {
  title: string;
  hint?: string;
  cards: Card[];
  /** Cards that can be clicked. The rest are shown dimmed. */
  selectable?: (c: Card) => boolean;
  /** Most cards that can be picked at once. With 1, clicking another card switches to it. */
  max?: number;
  /** Show the picking order on each picked card (for cards put on the bottom in order). */
  numbered?: boolean;
  /** Show copies of a card as one tile with a count, so twenty basic lands take one spot. */
  stackCopies?: boolean;
  /** The buttons along the bottom, given the cards picked so far (by id, in the order picked). */
  buttons: (picked: string[]) => PickerButton[];
}

/**
 * A window of cards to pick from. It can be folded away to look at the table, but not
 * closed: the game is waiting on the choice.
 */
export function CardPicker({ title, hint, cards, selectable = () => false, max = 0, numbered, stackCopies, buttons }: PickerProps) {
  const [picked, setPicked] = useState<string[]>([]);
  const [folded, setFolded] = useState(false);
  if (folded) {
    return (
      <button className="picker-pill" onClick={() => setFolded(false)}>
        Back to: {title}
      </button>
    );
  }
  // One tile per card, or per name with `stackCopies`.
  const tiles: Card[][] = [];
  for (const c of cards) {
    const same = stackCopies && tiles.find((t) => t[0].name === c.name && selectable(t[0]) === selectable(c));
    if (same) same.push(c);
    else tiles.push([c]);
  }
  // A click picks another copy from the tile. Once no more can be picked, it puts the tile's back.
  const toggle = (tile: Card[]) => {
    if (!selectable(tile[0])) return;
    const ids = tile.map((c) => c.id);
    const free = ids.find((id) => !picked.includes(id));
    const inTile = picked.filter((id) => ids.includes(id));
    if (max === 1) setPicked(inTile.length ? [] : [ids[0]]);
    else if (free && picked.length < max) setPicked([...picked, free]);
    else setPicked(picked.filter((id) => !ids.includes(id)));
  };
  return (
    <div className="modal">
      <div className="viewer picker">
        <div className="picker-head">
          <h2>{title}</h2>
          <button className="picker-fold" onClick={() => setFolded(true)}>
            View table
          </button>
        </div>
        {hint && <p className="picker-hint">{hint}</p>}
        <div className="viewer-cards picker-cards">
          {tiles.map((tile) => {
            const c = tile[0];
            const can = selectable(c);
            const n = picked.indexOf(c.id);
            const count = tile.filter((x) => picked.includes(x.id)).length;
            return (
              <button
                key={c.id}
                className={cx('picker-card', can && 'can', count > 0 && 'picked', !can && max > 0 && 'dim')}
                disabled={!can}
                onClick={() => toggle(tile)}
                {...hoverProps(c.name)}
              >
                <img src={data(c).image} alt={label(c)} draggable={false} />
                {numbered && n >= 0 && <span className="picker-num">{n + 1}</span>}
                {tile.length > 1 && <span className="picker-count">×{tile.length}</span>}
              </button>
            );
          })}
        </div>
        <div className="picker-buttons">
          {buttons(picked).map((b) => (
            <button key={b.label} className={cx('btn', `btn-${b.tone}`, 'small')} disabled={b.disabled} onClick={b.onClick}>
              <span className="btn-label">{b.label}</span>
              {b.sub && <span className="btn-sub">{b.sub}</span>}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function MulliganPicker({ g, me }: { g: Game; me: PlayerId }) {
  const hand = g.players[me].hand;
  const taken = g.mulligan?.taken[me] ?? 0;
  const bottom = nextMulliganBottom(g, me);
  const can = canMulligan(g, me);
  return (
    <CardPicker
      title={taken ? `Keep ${plural(hand.length, 'card')}?` : 'Keep your opening hand?'}
      hint={
        can
          ? `A mulligan shuffles this hand away and draws 7 new cards, then ${bottom ? `you put ${plural(bottom, 'card')} on the bottom` : 'you keep all 7: your first mulligan is free'}.`
          : 'Your hand is too small to mulligan again.'
      }
      cards={hand}
      buttons={() => [
        { label: 'Mulligan', sub: bottom ? `Then ${bottom} to the bottom` : 'Free', tone: 'plain', disabled: !can, onClick: () => act({ type: 'mulligan' }) },
        { label: 'Keep', tone: 'go', onClick: () => act({ type: 'keep' }) },
      ]}
    />
  );
}

function ChoicePicker({ g, choice }: { g: Game; choice: CardChoice }) {
  const { cards, valid, max } = choiceOptions(g, choice);
  const choose = (picked: string[]) => act({ type: 'chooseCards', cards: picked });
  if (choice.kind === 'bottom') {
    return (
      <CardPicker
        title={`Put ${plural(choice.count, 'card')} on the bottom`}
        hint={choice.count > 1 ? 'They go down in the order you pick them: the last one is the very bottom card.' : undefined}
        cards={cards}
        selectable={() => true}
        max={max}
        numbered={choice.count > 1}
        buttons={(picked) => [
          {
            label: 'Put on Bottom',
            sub: `${picked.length} of ${choice.count}`,
            tone: 'go',
            disabled: picked.length !== choice.count,
            onClick: () => choose(picked),
          },
        ]}
      />
    );
  }
  // Cards that can be found first, then the rest of the library.
  const sorted = [...cards].sort((a, b) => Number(valid.has(b.id)) - Number(valid.has(a.id)));
  const where = choice.to === 'hand' ? 'into your hand' : `onto the battlefield${choice.tapped ? ' tapped' : ''}`;
  const what = choice.subtype ? `a basic ${choice.subtype}` : 'a basic land';
  return (
    <CardPicker
      title={`${choice.source}: search your library`}
      hint={`Choose ${what} to put ${where}. ${valid.size ? 'Your library is shuffled afterwards.' : 'There is none in your library.'}`}
      cards={sorted}
      selectable={(c) => valid.has(c.id)}
      max={1}
      stackCopies
      buttons={(picked) => [
        { label: 'Find Nothing', tone: 'plain', disabled: picked.length > 0, onClick: () => choose([]) },
        { label: 'Choose', sub: picked.length ? label(cards.find((c) => c.id === picked[0])!) : undefined, tone: 'go', disabled: !picked.length, onClick: () => choose(picked) },
      ]}
    />
  );
}

const ORDINAL = ['1st', '2nd', '3rd'];

/**
 * Orders the human's triggered abilities (603.3b). Shown in the order they will resolve,
 * left first, which is the reverse of the order they go on the stack.
 */
function TriggerOrder({ g, me }: { g: Game; me: PlayerId }) {
  const [order, setOrder] = useState(() => g.triggers.filter((t) => t.controller === me).reverse());
  const [folded, setFolded] = useState(false);
  if (folded) {
    return (
      <button className="picker-pill" onClick={() => setFolded(false)}>
        Back to: order your triggers
      </button>
    );
  }
  const move = (i: number, by: number) => {
    const next = [...order];
    [next[i], next[i + by]] = [next[i + by], next[i]];
    setOrder(next);
  };
  return (
    <div className="modal">
      <div className="viewer picker">
        <div className="picker-head">
          <h2>Order your triggers</h2>
          <button className="picker-fold" onClick={() => setFolded(true)}>
            View table
          </button>
        </div>
        <p className="picker-hint">These all triggered at once. The one on the left resolves first.</p>
        <div className="viewer-cards picker-cards">
          {order.map((t, i) => (
            <div key={t.id} className="picker-slot">
              <div className="picker-card" {...hoverProps(t.card.name)}>
                <img src={data(t.card).image} alt={label(t.card)} draggable={false} />
                <span className="picker-num">{ORDINAL[i] ?? `${i + 1}th`}</span>
              </div>
              <div className="picker-move">
                <button disabled={i === 0} onClick={() => move(i, -1)} aria-label="Resolve sooner">
                  ◀
                </button>
                <button disabled={i === order.length - 1} onClick={() => move(i, 1)} aria-label="Resolve later">
                  ▶
                </button>
              </div>
            </div>
          ))}
        </div>
        <div className="picker-buttons">
          <button
            className="btn btn-go small"
            onClick={() => act({ type: 'orderTriggers', order: [...order].reverse().map((t) => t.id) })}
          >
            <span className="btn-label">Done</span>
          </button>
        </div>
      </div>
    </div>
  );
}

/** The picker for whatever the game is asking the human, if it is a choice of cards. */
export function Decisions() {
  const { g, me, mine } = useView();
  if (!mine || me === null || !g.decision) return null;
  const d = g.decision;
  // Keyed by the cards on offer, so a new choice starts with nothing picked.
  switch (d.type) {
    case 'mulligan':
      return <MulliganPicker key={g.players[me].hand.map((c) => c.id).join()} g={g} me={me} />;
    case 'chooseCards':
      return <ChoicePicker key={`${d.choice.kind}:${choiceOptions(g, d.choice).cards.map((c) => c.id).join()}`} g={g} choice={d.choice} />;
    case 'orderTriggers':
      return <TriggerOrder key={g.triggers.map((t) => t.id).join()} g={g} me={me} />;
    default:
      return null;
  }
}
