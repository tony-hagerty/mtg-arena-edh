// Windows for the decisions where the human picks or orders cards: searching their library,
// keeping or mulliganing a hand, putting cards on the bottom, picking from a few cards,
// ordering their triggers, sending their commander to the command zone, and dividing
// combat damage. Also the
// yes/no questions and naming a card that come up while a spell or ability resolves.
// `CardPicker` is the reusable part; `Decisions` chooses which one the game is asking for.
import { useState } from 'react';
import { CREATURE_TYPES, cardNames, isCardName } from '../cards/db';
import {
  autoAssignments,
  canCast,
  canMulligan,
  canSayYes,
  choiceOptions,
  commanderTax,
  damageRooms,
  data,
  findCard,
  label,
  legalAssignment,
  nextMulliganBottom,
  permanent,
  resolvingItem,
  triggerText,
} from '../engine';
import type { Action, AskChoice, Card, CardChoice, CastChoice, DamageAssignment, DamageRoom, Game, NameChoice, PlayerChoice, PlayerId } from '../engine';
import { CardImage, ManaCost } from './TextCard';
import { useStore } from './store';
import { cx, hoverProps } from './util';
import { chooseDelve, chooseEscape, chooseGraveyardTarget, playHandCard, useView } from './view';

const act = (a: Action) => useStore.getState().act(a);

/** Text with mana costs like "{1}{U}" drawn as symbols. */
const withMana = (text: string) =>
  text.split(/((?:\{[^}]+\})+)/).map((part, i) => (part.startsWith('{') ? <ManaCost key={i} cost={part} /> : part));
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
        {hint && <p className="picker-hint">{withMana(hint)}</p>}
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
                // Not `disabled`: a disabled button gets no mouse events, so hovering it would show no preview.
                aria-disabled={!can}
                onClick={() => toggle(tile)}
                {...hoverProps(c.name)}
              >
                <CardImage d={data(c)} alt={label(c)} draggable={false} />
                {numbered && n >= 0 && <span className="picker-num">{n + 1}</span>}
                {tile.length > 1 && <span className="picker-count">×{tile.length}</span>}
              </button>
            );
          })}
        </div>
        <div className="picker-buttons">
          {buttons(picked).map((b) => (
            <button key={b.label} className={cx('btn', `btn-${b.tone}`, 'small')} disabled={b.disabled} onClick={b.onClick}>
              <span className="btn-label">{withMana(b.label)}</span>
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
  if (choice.kind === 'legend') {
    return (
      <CardPicker
        title="Legend rule"
        hint="You control two or more legendary permanents with the same name. Keep one; the rest go to the graveyard."
        cards={cards}
        selectable={() => true}
        max={1}
        buttons={(picked) => [{ label: 'Keep', tone: 'go', disabled: picked.length !== 1, onClick: () => choose(picked) }]}
      />
    );
  }
  if (choice.kind === 'pick') {
    const { min } = choiceOptions(g, choice);
    return (
      <CardPicker
        title={`${choice.source}: ${choice.text}`}
        hint={min === max ? `Choose ${plural(max, 'card')}.` : max === 1 ? 'Choose one, or none.' : `Choose up to ${plural(max, 'card')}.`}
        cards={cards}
        selectable={() => true}
        max={max}
        buttons={(picked) => [
          { label: choice.button, sub: max > 1 ? `${picked.length} of ${max}` : undefined, tone: 'go', disabled: picked.length < min, onClick: () => choose(picked) },
        ]}
      />
    );
  }
  // Cards that can be found first, then the rest of the library.
  const sorted = [...cards].sort((a, b) => Number(valid.has(b.id)) - Number(valid.has(a.id)));
  const { min } = choiceOptions(g, choice);
  const where =
    choice.to === 'hand'
      ? 'into your hand'
      : choice.to === 'top'
        ? 'on top of your library'
        : choice.to === 'none'
          ? `for ${choice.source}`
          : `onto the battlefield${choice.tapped ? ' tapped' : ''}`;
  const what = choice.find?.label ?? (max > 1 ? `${max} cards` : 'a card');
  // A search for just "a card" has to find one (701.23d).
  const must = min > 0;
  return (
    <CardPicker
      title={`${choice.source}: search your library`}
      hint={`Choose ${what} ${where}. ${valid.size ? 'Your library is shuffled afterwards.' : 'There is none in your library.'}`}
      cards={sorted}
      selectable={(c) => valid.has(c.id)}
      max={max}
      stackCopies
      buttons={(picked) => [
        ...(must ? [] : [{ label: 'Find Nothing', tone: 'plain' as const, disabled: picked.length > 0, onClick: () => choose([]) }]),
        {
          label: 'Choose',
          sub: max > 1 ? `${picked.length} of ${max}` : picked.length ? label(cards.find((c) => c.id === picked[0])!) : undefined,
          tone: 'go',
          disabled: picked.length < Math.max(min, 1),
          onClick: () => choose(picked),
        },
      ]}
    />
  );
}

/** A yes/no question while a spell or ability resolves: "you may ...", or "... unless you pay {1}" (118.12a). */
function AskPanel({ g, choice }: { g: Game; choice: AskChoice }) {
  // The card asking: the one resolving, or one entering or in an opening hand.
  const source = choice.script ? findCard(g, choice.script) : resolvingItem(g)?.card;
  const answer = (yes: boolean) => act({ type: 'answer', yes });
  const can = canSayYes(g, choice);
  return (
    <CardPicker
      title={choice.source}
      hint={choice.text}
      cards={source ? [source] : []}
      buttons={() => [
        { label: choice.no, tone: 'plain', onClick: () => answer(false) },
        { label: choice.yes, sub: !can ? "You can't pay" : undefined, tone: 'go', disabled: !can, onClick: () => answer(true) },
      ]}
    />
  );
}

/** Naming a card (201.3): type and pick from every card name the game knows. */
function NamePanel({ g, choice }: { g: Game; choice: NameChoice }) {
  const [name, setName] = useState('');
  const [folded, setFolded] = useState(false);
  const source = choice.script ? findCard(g, choice.script) : resolvingItem(g)?.card;
  // A creature type (205.3m, Cavern of Souls), or a card name (201.3).
  const type = choice.of === 'creature type';
  const ok = type ? CREATURE_TYPES.includes(name) : isCardName(name);
  const list = type ? CREATURE_TYPES : cardNames();
  if (folded) {
    return (
      <button className="picker-pill" onClick={() => setFolded(false)}>
        Back to: {choice.source}
      </button>
    );
  }
  return (
    <div className="modal">
      <div className="viewer picker">
        <div className="picker-head">
          <h2>
            {choice.source}: {type ? 'choose a creature type' : 'name a card'}
          </h2>
          <button className="picker-fold" onClick={() => setFolded(true)}>
            View table
          </button>
        </div>
        <p className="picker-hint">{choice.text}</p>
        <div className="name-row">
          {source && <CardImage className="name-source" d={data(source)} alt={label(source)} draggable={false} />}
          <input
            className="name-input"
            list="card-names"
            value={name}
            autoFocus
            placeholder={type ? 'Creature type' : 'Card name'}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              e.stopPropagation(); // typing a space shouldn't press the main button
              if (e.key === 'Enter' && ok) act({ type: 'name', name });
            }}
          />
          <datalist id="card-names">
            {list.map((n) => (
              <option key={n} value={n} />
            ))}
          </datalist>
        </div>
        <div className="picker-buttons">
          <button className="btn btn-go small" disabled={!ok} onClick={() => act({ type: 'name', name })}>
            <span className="btn-label">{type ? 'Choose It' : 'Name It'}</span>
            {name && !ok && <span className="btn-sub">{type ? 'Not a creature type' : 'No card has that name'}</span>}
          </button>
        </div>
      </div>
    </div>
  );
}

/** Choosing a colour while a spell or ability resolves (105.1), like Deathrite Shaman's "one mana of any color". */
function ColorPanel({ g, choice }: { g: Game; choice: NameChoice }) {
  const [folded, setFolded] = useState(false);
  const source = resolvingItem(g)?.card;
  if (folded) {
    return (
      <button className="picker-pill" onClick={() => setFolded(false)}>
        Back to: {choice.source}
      </button>
    );
  }
  return (
    <div className="modal">
      <div className="viewer picker">
        <div className="picker-head">
          <h2>{choice.source}: choose a colour</h2>
          <button className="picker-fold" onClick={() => setFolded(true)}>
            View table
          </button>
        </div>
        <p className="picker-hint">{choice.text}</p>
        <div className="name-row">
          {source && <CardImage className="name-source" d={data(source)} alt={label(source)} draggable={false} />}
          {(['W', 'U', 'B', 'R', 'G'] as const).map((c) => (
            <button key={c} className="chip" onClick={() => act({ type: 'name', name: c })} aria-label={c}>
              <ManaCost cost={`{${c}}`} />
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

/** Choosing a player while a spell or ability resolves, like "an opponent" (Wishclaw Talisman). */
function PlayerPanel({ g, choice }: { g: Game; choice: PlayerChoice }) {
  const source = resolvingItem(g)?.card;
  return (
    <CardPicker
      title={choice.source}
      hint={choice.text}
      cards={source ? [source] : []}
      buttons={() => choice.options.map((pid) => ({ label: g.players[pid].name, tone: 'go' as const, onClick: () => act({ type: 'choosePlayer', player: pid }) }))}
    />
  );
}

/**
 * The human may cast a card while a spell resolves (608.2g), like the card Beseech the
 * Mirror found. Casting it goes through the usual steps: targets, costs, paying.
 */
function CastNowPanel({ g, choice }: { g: Game; choice: CastChoice }) {
  const card = findCard(g, choice.card);
  const can = !!card && canCast(g, choice.player, card);
  return (
    <CardPicker
      title={choice.source}
      hint={choice.text}
      cards={card ? [card] : []}
      buttons={() => [
        { label: "Don't Cast", tone: 'plain', onClick: () => act({ type: 'answer', yes: false }) },
        { label: 'Cast', sub: can ? undefined : "It can't be cast", tone: 'go', disabled: !can, onClick: () => card && playHandCard(card) },
      ]}
    />
  );
}

/** Escape (702.138a): picks three other cards in the graveyard to exile as part of the cost. */
export function EscapePicker() {
  const { escape } = useView();
  if (!escape) return null;
  return (
    <CardPicker
      key={escape.card.id}
      title={`${label(escape.card)}: escape`}
      hint="Choose three other cards in your graveyard to exile to pay for it."
      cards={escape.options}
      selectable={() => true}
      max={3}
      buttons={(picked) => [{ label: 'Exile Them', sub: `${picked.length} of 3`, tone: 'go', disabled: picked.length !== 3, onClick: () => chooseEscape(picked) }]}
    />
  );
}

/** Delve (702.66a): picks cards in the graveyard to exile, each paying for {1} of the spell's generic mana. */
export function DelvePicker() {
  const { delve } = useView();
  if (!delve) return null;
  return (
    <CardPicker
      key={delve.card.id}
      title={`${label(delve.card)}: delve`}
      hint={`You may exile up to ${delve.max} cards from your graveyard. Each pays for {1}.`}
      cards={delve.options}
      selectable={() => true}
      max={delve.max}
      buttons={(picked) => [{ label: picked.length ? `Exile ${picked.length}` : 'Exile None', tone: 'go', onClick: () => chooseDelve(picked) }]}
    />
  );
}

/** A target in a graveyard (Sevinne's Reclamation): graveyards aren't on the table, so they are picked from here. */
export function GraveyardTargets() {
  const { graveTargets: t } = useView();
  if (!t) return null;
  return (
    <CardPicker
      key={`${t.card.id}:${t.spec.label}`}
      title={`${label(t.card)}: choose a target`}
      hint={`Choose ${t.spec.label}.`}
      cards={t.options}
      selectable={() => true}
      max={1}
      buttons={(picked) => [{ label: 'Target', tone: 'go', disabled: picked.length !== 1, onClick: () => chooseGraveyardTarget(picked[0]) }]}
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
                <CardImage d={data(t.card)} alt={label(t.card)} draggable={false} />
                <span className="picker-num">{ORDINAL[i] ?? `${i + 1}th`}</span>
              </div>
              {/* A card with several abilities for one event says which one this is. */}
              {triggerText(t) && <p className="picker-ability">{triggerText(t)}</p>}
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

/** One line of the damage window: a recipient, the damage on it, and buttons to change it. */
function DamageRow({ name, note, n, less, more, onChange }: { name: string; note?: string; n: number; less: boolean; more: boolean; onChange: (by: number) => void }) {
  return (
    <div className="cast-row damage-row">
      <span className="damage-name">
        {name}
        {note && <small>{note}</small>}
      </span>
      <button className="chip" disabled={!less} onClick={() => onChange(-1)} aria-label={`Less to ${name}`}>
        −
      </button>
      <b className="cast-x">{n}</b>
      <button className="chip" disabled={!more} onClick={() => onChange(1)} aria-label={`More to ${name}`}>
        +
      </button>
    </div>
  );
}

/**
 * The active player divides combat damage (510.1): for each attacker with a choice, so much
 * to each creature blocking it (510.1c) and, with trample, to what it attacked once every
 * blocker has lethal damage (702.19b). It starts on the automatic split, and the whole
 * assignment is checked before it can be dealt (510.1e).
 */
function DamagePanel({ g, attackers }: { g: Game; attackers: string[] }) {
  const rooms = damageRooms(g).filter((r) => attackers.includes(r.attacker));
  const [split, setSplit] = useState<DamageAssignment[]>(() => autoAssignments(g));
  const [folded, setFolded] = useState(false);
  if (folded) {
    return (
      <button className="picker-pill" onClick={() => setFolded(false)}>
        Back to: divide combat damage
      </button>
    );
  }
  const change = (attacker: string, to: string | null, by: number) =>
    setSplit(
      split.map((x) =>
        x.attacker !== attacker ? x : to === null ? { ...x, through: x.through + by } : { ...x, blockers: { ...x.blockers, [to]: (x.blockers[to] ?? 0) + by } },
      ),
    );
  const attackedName = (room: DamageRoom) => {
    const a = g.combat?.attacks.find((x) => x.id === room.attacker);
    const target = a?.target ? permanent(g, a.target) : undefined;
    return target ? label(target) : a ? g.players[a.defender].name : '';
  };
  const ok = rooms.every((r) => {
    const asg = split.find((x) => x.attacker === r.attacker);
    return !!asg && legalAssignment(r, asg);
  });
  return (
    <div className="modal">
      <div className="viewer picker">
        <div className="picker-head">
          <h2>Divide combat damage</h2>
          <button className="picker-fold" onClick={() => setFolded(true)}>
            View table
          </button>
        </div>
        <p className="picker-hint">Each attacker deals damage equal to its power. With trample, the rest can go past its blockers once each has lethal damage.</p>
        <div className="damage-split">
          {rooms.map((room) => {
            const atk = permanent(g, room.attacker)!;
            const asg = split.find((x) => x.attacker === room.attacker)!;
            const used = Object.values(asg.blockers).reduce((a, b) => a + b, 0) + asg.through;
            const spare = used < room.power;
            const allLethal = room.blockers.every((b) => (asg.blockers[b.id] ?? 0) >= b.lethal);
            return (
              <div key={room.attacker} className="damage-attacker">
                <div className="picker-card" {...hoverProps(atk.name)}>
                  <CardImage d={data(atk)} alt={label(atk)} draggable={false} />
                </div>
                <div className="damage-rows">
                  <div className="cast-label">
                    {label(atk)}: {used} of {room.power} assigned
                  </div>
                  {room.blockers.map((b) => {
                    const n = asg.blockers[b.id] ?? 0;
                    const blocker = permanent(g, b.id)!;
                    return (
                      <DamageRow
                        key={b.id}
                        name={label(blocker)}
                        note={n >= b.lethal ? 'lethal' : `${b.lethal} is lethal`}
                        n={n}
                        less={n > 0}
                        more={spare}
                        onChange={(by) => change(room.attacker, b.id, by)}
                      />
                    );
                  })}
                  {room.trample && room.canThrough && (
                    <DamageRow
                      name={attackedName(room)}
                      note={allLethal ? 'trample' : 'trample: lethal to every blocker first'}
                      n={asg.through}
                      less={asg.through > 0}
                      more={spare && allLethal}
                      onChange={(by) => change(room.attacker, null, by)}
                    />
                  )}
                </div>
              </div>
            );
          })}
        </div>
        <div className="picker-buttons">
          <button className="btn btn-plain small" onClick={() => setSplit(autoAssignments(g))}>
            <span className="btn-label">Automatic</span>
          </button>
          <button className="btn btn-go small" disabled={!ok} onClick={() => act({ type: 'assignDamage', assignments: split })}>
            <span className="btn-label">Deal Damage</span>
          </button>
        </div>
      </div>
    </div>
  );
}

/** Per zone: what happened to the commander, what leaving it there means, and the button to leave it. */
const COMMANDER_ZONE: Record<string, { went: string; left: string; leave: string }> = {
  graveyard: { went: 'went to your graveyard', left: "Left in your graveyard, it can't be cast.", leave: 'Leave in Graveyard' },
  exile: { went: 'went to exile', left: "Left in exile, it can't be cast.", leave: 'Leave in Exile' },
  hand: { went: 'is going to your hand', left: 'From your hand you can cast it like any other card, with no tax.', leave: 'Keep in Hand' },
  library: { went: 'is going to your library', left: 'Left in your library, you could draw it again.', leave: 'Leave in Library' },
};

/**
 * Your commander was put into your graveyard or exile (903.9a), or is going to your hand or
 * library (903.9b): send it to the command zone, or leave it.
 */
function CommanderZone({ g, card }: { g: Game; card: Card }) {
  const text = COMMANDER_ZONE[card.zone];
  const instead = card.zone === 'hand' || card.zone === 'library' ? ' instead' : '';
  const tax = commanderTax(g, card); // commander tax (903.8)
  const choose = (toCommand: boolean) => act({ type: 'commanderZone', toCommand });
  return (
    <CardPicker
      title={`${label(card)} ${text.went}`}
      hint={`Put it in the command zone${instead} to cast it again later${tax ? ` for ${tax} more` : ''}. ${text.left}`}
      cards={[card]}
      buttons={() => [
        { label: text.leave, tone: 'plain', onClick: () => choose(false) },
        { label: 'Command Zone', tone: 'go', onClick: () => choose(true) },
      ]}
    />
  );
}

/** The picker for whatever the game is asking the human, if it is a choice of cards. */
export function Decisions() {
  const { g, me, mine } = useView();
  const targeting = useStore((s) => s.targeting);
  if (!mine || me === null || !g.decision) return null;
  const d = g.decision;
  // Keyed by the cards on offer, so a new choice starts with nothing picked.
  switch (d.type) {
    case 'mulligan':
      return <MulliganPicker key={g.players[me].hand.map((c) => c.id).join()} g={g} me={me} />;
    case 'chooseCards':
      return <ChoicePicker key={`${d.choice.kind}:${choiceOptions(g, d.choice).cards.map((c) => c.id).join()}`} g={g} choice={d.choice} />;
    case 'ask':
      return <AskPanel key={`${g.log.length}:${d.choice.text}`} g={g} choice={d.choice} />;
    case 'name':
      return d.choice.of === 'color' ? <ColorPanel g={g} choice={d.choice} /> : <NamePanel key={g.log.length} g={g} choice={d.choice} />;
    case 'player':
      return <PlayerPanel key={g.log.length} g={g} choice={d.choice} />;
    case 'cast':
      // Hidden while the human goes through casting it.
      return targeting ? null : <CastNowPanel key={g.log.length} g={g} choice={d.choice} />;
    case 'orderTriggers':
      return <TriggerOrder key={g.triggers.map((t) => t.id).join()} g={g} me={me} />;
    case 'assignDamage':
      return <DamagePanel key={`${g.turn}:${d.firstStrike}`} g={g} attackers={d.attackers} />;
    case 'commanderZone': {
      const p = g.players[me];
      const card = [...p.graveyard, ...p.exile, ...p.hand, ...p.library].find((c) => c.id === d.card);
      return card ? <CommanderZone key={card.id} g={g} card={card} /> : null;
    }
    default:
      return null;
  }
}
