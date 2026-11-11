import { useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, KeyboardEvent, RefObject } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { DECKS, cardData, deckColors } from '../cards/db';
import type { DeckDef } from '../cards/db';
import { checkList, deckAsList, norm, poolName, savedDeckIssues, savedDeckState } from '../cards/decklist';
import type { DeckState, RefusedCard } from '../cards/decklist';
import { clearFetchedCards, fetchCards, fetchedCount, requestFor } from '../cards/fetched';
import { downloadRequests, keptRequests, reportRequests, writesFile } from './card-requests';
import iconUrl from './icon.svg';
import { type SeatPlayer, useStore } from './store';
import { HostTable, JoinTable, MenuFrame, SavedGames, TableEnded, WaitingRoom } from './LobbyScreen';
import { MusicControl, SoundControl } from './SoundControl';
import { CardImage, useArtLoads } from './TextCard';
import { cx, deckColor } from './util';

type MenuScreen = 'decks' | 'paste' | 'host' | 'join' | 'saves';

export function Menu() {
  const [screen, setScreen] = useState<MenuScreen>('decks');
  /** A saved deck reopened in the paste screen to swap the cards the game can't play yet. */
  const [editing, setEditing] = useState<DeckDef | null>(null);
  const table = useStore((s) => s.table);
  const atTable = !!table && table.role !== 'none';
  const back = () => {
    setEditing(null);
    setScreen('decks');
  };
  // Leaving a table comes back to the decks, not to the form that opened it.
  useEffect(() => {
    if (atTable) back();
  }, [atTable]);
  // At a table, the waiting room stays up until the game starts or this person leaves.
  if (atTable) return <WaitingRoom table={table} />;
  if (screen === 'paste') return <PasteDeck key={editing?.id ?? 'new'} close={back} editing={editing} />;
  if (screen === 'host') return <HostTable close={back} />;
  if (screen === 'join') return <JoinTable close={back} />;
  if (screen === 'saves' && table) return <SavedGames table={table} close={back} />;
  return (
    <DeckMenu
      go={setScreen}
      edit={(deck) => {
        setEditing(deck);
        setScreen('paste');
      }}
    />
  );
}

/** A deck on the title screen, and for a pasted one what stops it being played (`savedDeckState`). */
interface Entry {
  deck: DeckDef;
  state?: DeckState;
  pasted: boolean;
}

/** "1 card" or "3 cards". */
const cards = (n: number) => (n === 1 ? '1 card' : `${n} cards`);

/**
 * What the title screen says about a deck. A pasted deck is `broken` if a newer card pool
 * can't play it, or if it was saved with cards the game can't play yet (`waiting`: they can be
 * swapped on the paste screen). One that plays some cards without their rules text says how many.
 */
function describe({ deck, state }: Entry) {
  const issues = state?.issues ?? [];
  const unplayable = state?.unplayable.length ?? 0;
  const textless = state?.textless.length ?? 0;
  const broken = issues.length > 0 || unplayable > 0;
  return {
    broken,
    waiting: unplayable > 0 && !issues.length ? unplayable : 0,
    textless: !broken && textless > 0,
    note: issues.length
      ? `Can't be played: ${issues[0]}`
      : unplayable
        ? `${cards(unplayable)} the game can't play yet`
        : textless
          ? `${cards(textless)} ${textless === 1 ? 'plays' : 'play'} without ${textless === 1 ? 'its' : 'their'} text`
          : null,
    // A deck's colours are its commanders' colour identity (903.4, 702.124c). A broken deck may name cards the game doesn't have.
    colors: broken ? [] : deckColors(deck),
  };
}

/** The light a deck throws on the title screen: its colours mixed, or grey for one that can't be played. */
const lightOf = (entry: Entry) => {
  const { broken, colors } = describe(entry);
  return broken ? '#4a5366' : deckColor(colors);
};

/** A deck card's rim: its colours side by side, as a multicoloured card's frame shows them. */
const rimOf = (colors: readonly string[], broken: boolean) =>
  broken ? '#4a5366' : colors.length > 1 ? `linear-gradient(100deg, ${colors.map((c) => `var(--f-${c})`).join(', ')})` : `var(--f-${colors[0] ?? 'artifact'})`;

/** How long the title screen takes to leave once a game is asked for, in ms (`.title-screen.leaving` in styles.css). */
const LEAVE_MS = 420;

/** The title screen comes back if no game has replaced it this long after leaving (the game server refused or didn't answer), in ms. */
const LEAVE_GIVE_UP_MS = 1500;

/** People who ask their system for less motion get no parallax and no leaving animation (the stylesheet turns the rest off). */
const lessMotion = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * Where the pointer is over the title screen, as --px and --py on it, each from -1 to 1:
 * the backdrop's layers shift by it and the commander's card leans toward it (styles.css).
 * Written at most once a frame.
 */
function useParallax(ref: RefObject<HTMLDivElement | null>) {
  useEffect(() => {
    const el = ref.current;
    if (!el || lessMotion()) return;
    let frame = 0;
    let x = 0;
    let y = 0;
    const move = (e: PointerEvent) => {
      x = e.clientX;
      y = e.clientY;
      // The screen is measured in the frame, not here: a fast mouse sends many moves a frame.
      frame ||= requestAnimationFrame(() => {
        frame = 0;
        const r = el.getBoundingClientRect();
        el.style.setProperty('--px', (((x - r.left) / r.width) * 2 - 1).toFixed(3));
        el.style.setProperty('--py', (((y - r.top) / r.height) * 2 - 1).toFixed(3));
      });
    };
    el.addEventListener('pointermove', move, { passive: true });
    return () => {
      el.removeEventListener('pointermove', move);
      cancelAnimationFrame(frame);
    };
  }, [ref]);
}

/**
 * Leaving the title screen for a game: `leave(then)` plays the leaving animation, then runs
 * `then` (which starts the game, and the game's screen replaces this one).
 */
function useLeave(): [boolean, (then: () => void) => void] {
  const [leaving, setLeaving] = useState(false);
  const timers = useRef<number[]>([]);
  useEffect(() => () => timers.current.forEach(clearTimeout), []);
  const leave = (then: () => void) => {
    if (leaving) return;
    if (lessMotion()) return then();
    setLeaving(true);
    timers.current = [window.setTimeout(then, LEAVE_MS), window.setTimeout(() => setLeaving(false), LEAVE_GIVE_UP_MS)];
  };
  return [leaving, leave];
}

/**
 * The title screen. The deck you picked stands in the middle: its commander's card over the
 * five colours, its name and Play to the left, and the table to the right (who sits in the
 * other seats, and the ways to play with friends). Every deck is a card in the hand along the
 * bottom, starter decks then pasted ones, with a card to paste another. The picked deck's art
 * and colours light the whole screen.
 */
function DeckMenu({ go, edit }: { go: (screen: MenuScreen) => void; edit: (deck: DeckDef) => void }) {
  const start = useStore((s) => s.start);
  const remove = useStore((s) => s.deleteDeck);
  // Hosting and joining need the Windows program (or `npm run dev`): a file opened from disk has no lobby.
  const lobby = useStore((s) => s.lobby);
  const table = useStore((s) => s.table);
  const saved = useStore((s) => s.savedDecks);
  // Saved decks are checked again once fetched cards load (`loadCards`).
  useStore((s) => s.cardsVersion);
  const entries: Entry[] = [...DECKS.map((deck) => ({ deck, pasted: false })), ...saved.map((deck) => ({ deck, state: savedDeckState(deck), pasted: true }))];
  // The deck played last is picked to begin with; a picked deck that has been deleted gives way to the first.
  const [pickedId, setPickedId] = useState(() => useStore.getState().deck?.id ?? DECKS[0].id);
  const picked = entries.find((e) => e.deck.id === pickedId) ?? entries[0];
  const stage = useRef<HTMLDivElement>(null);
  useParallax(stage);
  const [leaving, leave] = useLeave();
  const play = (deck: DeckDef | null) => leave(() => start(deck));
  return (
    <div ref={stage} className={cx('stage menu title-screen', leaving && 'leaving')} style={{ '--aura': lightOf(picked) } as CSSProperties}>
      <MenuBackdrop url={describe(picked).broken ? '' : cardData(picked.deck.commanders[0]).art} />
      <header className="menu-top">
        <div className="menu-brand">
          <img src={iconUrl} alt="" />
          <div>
            <h1>Commander Table</h1>
            <p className="menu-sub">Arena-style Commander for two to four players</p>
          </div>
        </div>
        <div className="menu-sound">
          <SoundControl />
          <MusicControl />
        </div>
      </header>
      <main className="menu-main">
        <Hero
          entry={picked}
          play={() => play(picked.deck)}
          watch={() => play(null)}
          edit={() => edit(picked.deck)}
          remove={() => window.confirm(`Delete "${picked.deck.title}"?`) && remove(picked.deck.id)}
        />
        <Showcase entry={picked} />
        <aside className="menu-side">
          <section className="menu-panel">
            <h2>The table</h2>
            <p className="menu-hint">You sit down with the deck you picked. Choose who plays the other seats.</p>
            <Pod you={picked} />
          </section>
          {lobby && table?.role === 'none' && <TableEnded table={table} />}
          {lobby && (
            <section className="menu-panel">
              <h2>With friends</h2>
              <div className="menu-actions">
                <button className="menu-action" onClick={() => go('host')}>
                  Host a table
                </button>
                <button className="menu-action" onClick={() => go('join')}>
                  Join a table
                </button>
                {!!table?.saves.length && (
                  <button className="menu-action wide" onClick={() => go('saves')}>
                    Saved games <span className="menu-count">{table.saves.length}</span>
                  </button>
                )}
              </div>
            </section>
          )}
        </aside>
      </main>
      <DeckHand entries={entries} picked={picked} pick={(deck) => setPickedId(deck.id)} play={play} paste={() => go('paste')} />
    </div>
  );
}

/** A repeatable scatter from 0 to 1: the motes sit in the same places every visit, so a re-render moves nothing. */
const scatter = (i: number, salt: number) => {
  const x = Math.sin(i * 127.1 + salt * 311.7) * 43758.5453;
  return x - Math.floor(x);
};

/** The motes drifting up the backdrop: where each starts, its size, how long it takes, and how far it sways. */
const MOTES = Array.from(
  { length: 30 },
  (_, i) =>
    ({
      '--x': `${(scatter(i, 1) * 100).toFixed(1)}%`,
      '--size': `${(0.25 + scatter(i, 2) * 0.5).toFixed(2)}rem`,
      '--time': `${(12 + scatter(i, 3) * 14).toFixed(1)}s`,
      // Negative: each mote is already on its way when the screen opens.
      '--delay': `${(-scatter(i, 4) * 26).toFixed(1)}s`,
      '--sway': `${((scatter(i, 5) - 0.5) * 14).toFixed(1)}rem`,
      '--glow': (0.3 + scatter(i, 6) * 0.6).toFixed(2),
    }) as CSSProperties,
);

/**
 * Behind the title screen: the picked deck's art, blurred and dimmed (one fades into the
 * next), a light in the deck's colours rising from where the commander stands, and motes
 * drifting up through it.
 */
function MenuBackdrop({ url }: { url: string }) {
  const ok = useArtLoads(url);
  return (
    <div className="menu-backdrop" aria-hidden="true">
      <AnimatePresence>
        {ok && (
          <motion.div
            key={url}
            className="menu-backdrop-art"
            style={{ backgroundImage: `url(${url})` }}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.9 }}
          />
        )}
      </AnimatePresence>
      <div className="menu-backdrop-light" />
      <div className="menu-motes">
        {MOTES.map((style, i) => (
          <i key={i} style={style} />
        ))}
      </div>
      <div className="menu-backdrop-shade" />
    </div>
  );
}

/** A deck's colours as mana symbols, or the colourless symbol for none. */
function Pips({ colors }: { colors: readonly string[] }) {
  return (
    <span className="deck-pips">
      {colors.length ? colors.map((c) => <i key={c} className={`ms ms-cost ms-shadow ms-${c.toLowerCase()}`} />) : <i className="ms ms-cost ms-shadow ms-c" />}
    </span>
  );
}

/**
 * The picked deck in words, and what to do with it: Play, or watch the bots. A pasted deck
 * can be deleted; one that can't be played says why, and **Swap them** opens it in the paste
 * screen with the cards to swap at the top.
 */
function Hero({ entry, play, watch, edit, remove }: { entry: Entry; play: () => void; watch: () => void; edit: () => void; remove: () => void }) {
  const { deck, pasted } = entry;
  const info = describe(entry);
  const size = deck.commanders.length + deck.cards.length + Object.values(deck.basics).reduce((n, c) => n + c, 0);
  return (
    <section className="hero" aria-label="The deck you picked">
      {/* Keyed on the deck: the words come in afresh for each one. */}
      <div key={deck.id} className="hero-copy">
        <h2 className={cx('hero-title', deck.title.length > 20 && 'long')}>{deck.title}</h2>
        <p className="hero-commander">
          {!info.broken && <Pips colors={info.colors} />}
          <span>{deck.commanders.join(' & ')}</span>
        </p>
        <p className={cx('hero-blurb', info.broken && 'warn')}>{info.broken ? info.note : deck.blurb}</p>
        <p className="hero-meta">
          {pasted ? 'Your deck' : 'Starter deck'} · {cards(size)}
          {info.textless && <span className="hero-textless"> · {info.note}</span>}
        </p>
      </div>
      <div className="hero-actions">
        <button className="play-btn" onClick={play} disabled={info.broken}>
          <span>Play</span>
        </button>
        <button className="menu-action" onClick={watch}>
          Watch the bots play
        </button>
      </div>
      {pasted && (
        <div className="hero-manage">
          {info.broken && (
            <button className="hero-link fix" onClick={edit} title="Open this deck in the paste screen, with the cards to swap at the top">
              {info.waiting ? (info.waiting === 1 ? 'Swap it' : 'Swap them') : 'Open the list'}
            </button>
          )}
          <button className="hero-link" onClick={remove} aria-label={`Delete ${deck.title}`}>
            Delete this deck
          </button>
        </div>
      )}
    </section>
  );
}

/** The five colours in the colour pie's order, as they ring the commander. */
const PIE = ['W', 'U', 'B', 'R', 'G'];

/**
 * The picked deck's commander, standing over the colour pie: the real card (two for
 * partners), leaning toward the pointer under a moving sheen, and on the floor under it the
 * five mana symbols in a slowly turning ring, the deck's own colours lit. A deck that can't
 * be played shows a card's back and a dark ring. Each new deck's card turns over as it arrives.
 */
function Showcase({ entry }: { entry: Entry }) {
  const { deck } = entry;
  const { broken, colors } = describe(entry);
  const commanders = broken ? [] : deck.commanders.slice(0, 2);
  return (
    <div className="showcase" aria-hidden="true">
      <div className="mana-ring">
        <div className="mana-ring-floor">
          {PIE.map((c, i) => (
            <i key={c} className={cx(`ms ms-${c.toLowerCase()}`, 'mana-rune', (colors as readonly string[]).includes(c) && 'lit')} style={{ '--turn': `${i * 72}deg`, '--rune': `var(--f-${c})` } as CSSProperties} />
          ))}
        </div>
      </div>
      <div className="showcase-float">
        <div className="showcase-tilt">
          <div key={deck.id} className={cx('showcase-cards', commanders.length > 1 && 'pair')}>
            {commanders.length ? (
              commanders.map((name) => (
                <div key={name} className="showcase-card">
                  <CardImage d={cardData(name)} alt="" draggable={false} className="showcase-face" />
                  <span className="showcase-foil" />
                  <span className="card-back" />
                </div>
              ))
            ) : (
              <div className="showcase-card facedown">
                <span className="card-back" />
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

const SEAT_LABELS: Record<SeatPlayer, string> = { bot: 'Bot', person: 'Person here', empty: 'Empty seat' };

/** The same, short enough for a seat's three-way switch. */
const SEAT_SHORT: Record<SeatPlayer, string> = { bot: 'Bot', person: 'Person', empty: 'Empty' };

/**
 * The table from above, a seat in each corner as in the game: yours at the bottom left with
 * the deck you picked, the others clockwise. Each other seat, saved with the settings, says
 * who plays it (a bot, another person passing this screen, or nobody, for a smaller table)
 * and its deck, or Automatic (the next built-in deck no one else has).
 */
function Pod({ you }: { you: Entry }) {
  const opponents = useStore((s) => s.settings.opponents);
  const players = useStore((s) => s.settings.players);
  const setSetting = useStore((s) => s.setSetting);
  useStore((s) => s.cardsVersion);
  const saved = useStore((s) => s.savedDecks).filter((d) => savedDeckIssues(d).length === 0);
  const pick = (seat: number, id: string) => setSetting({ opponents: opponents.map((o, i) => (i === seat ? id || null : o)) });
  const who = (seat: number, p: SeatPlayer) => setSetting({ players: players.map((o, i) => (i === seat ? p : o)) });
  // A game needs at least two players, so the last filled seat can't be emptied.
  const lastFilled = players.filter((p) => p !== 'empty').length === 1;
  return (
    <div className="pod">
      <div className="pod-felt" aria-hidden="true" />
      <div className="pod-seat you">
        <span className="pod-n">1</span>
        <span className="pod-you">You</span>
        <span className="pod-deck">{you.deck.title}</span>
      </div>
      {opponents.map((id, seat) => (
        <div key={seat} className={cx('pod-seat', players[seat] === 'empty' && 'empty')}>
          <span className="pod-n">{seat + 2}</span>
          <div className="pod-who" role="radiogroup" aria-label={`Who plays opponent ${seat + 1}`}>
            {(Object.keys(SEAT_LABELS) as SeatPlayer[]).map((p) => (
              <button
                key={p}
                role="radio"
                aria-checked={players[seat] === p}
                className={cx(players[seat] === p && 'on')}
                disabled={p === 'empty' && lastFilled && players[seat] !== 'empty'}
                title={SEAT_LABELS[p]}
                onClick={() => who(seat, p)}
              >
                {SEAT_SHORT[p]}
              </button>
            ))}
          </div>
          <select value={id ?? ''} disabled={players[seat] === 'empty'} onChange={(e) => pick(seat, e.target.value)} aria-label={`Opponent ${seat + 1}'s deck`}>
            <option value="">Automatic deck</option>
            <optgroup label="Built-in decks">
              {DECKS.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.title}
                </option>
              ))}
            </optgroup>
            {saved.length > 0 && (
              <optgroup label="Pasted decks">
                {saved.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.title}
                  </option>
                ))}
              </optgroup>
            )}
          </select>
        </div>
      ))}
    </div>
  );
}

/**
 * Every deck as a card in a row along the bottom, the hand: starter decks, then pasted ones, then a
 * card to paste another. A click picks a deck and a double click plays it; the arrow keys
 * move along the hand. The cards overlap, as a full hand does, once they no longer fit side
 * by side.
 */
function DeckHand({ entries, picked, pick, play, paste }: { entries: Entry[]; picked: Entry; pick: (deck: DeckDef) => void; play: (deck: DeckDef) => void; paste: () => void }) {
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    const all = [...e.currentTarget.querySelectorAll<HTMLButtonElement>('.deck-card')];
    const next = all[all.indexOf(document.activeElement as HTMLButtonElement) + (e.key === 'ArrowRight' ? 1 : -1)];
    if (!next) return;
    e.preventDefault();
    next.focus();
  };
  return (
    <div className="deck-hand" role="group" aria-label="Pick a deck to play" onKeyDown={onKeyDown}>
      {entries.map((entry, i) => (
        <DeckCard
          key={entry.deck.id}
          entry={entry}
          n={i}
          on={entry === picked}
          caption={i === 0 ? 'Starter decks' : i === DECKS.length ? 'Your decks' : null}
          pick={() => pick(entry.deck)}
          play={() => play(entry.deck)}
        />
      ))}
      <div className="deck-slot" style={{ '--n': entries.length } as CSSProperties}>
        <button className="deck-card deck-paste" onClick={paste}>
          <span className="deck-card-body">
            <span className="deck-card-face">
              <span className="deck-paste-plus" aria-hidden="true" />
              <span className="deck-card-title">Paste a deck list</span>
              <span className="deck-paste-hint">Arena, Moxfield, Archidekt, MTGO, TappedOut or a plain list</span>
            </span>
            <span className="card-back" aria-hidden="true" />
          </span>
        </button>
        {entries.length === DECKS.length && <span className="deck-caption">Your decks</span>}
      </div>
    </div>
  );
}

/**
 * A deck in the hand: its commanders' art (partners split it) in a rim of the deck's
 * colours, over its name. The picked one stands up out of the hand. A deck that can't be
 * played is grey, and one waiting on cards or playing some without their text is marked.
 */
function DeckCard({ entry, n, on, caption, pick, play }: { entry: Entry; n: number; on: boolean; caption: string | null; pick: () => void; play: () => void }) {
  const { deck } = entry;
  const info = describe(entry);
  return (
    <div className={cx('deck-slot', on && 'on')} style={{ '--n': n, '--rim': rimOf(info.colors, info.broken) } as CSSProperties}>
      <button
        className={cx('deck-card', info.broken && 'broken')}
        aria-pressed={on}
        onClick={pick}
        onDoubleClick={() => !info.broken && play()}
        title={info.note ? `${deck.title}: ${info.note}` : `${deck.title} (${deck.commanders.join(' & ')})`}
      >
        <span className="deck-card-body">
          <span className="deck-card-face">
            <span className="deck-card-art">{!info.broken && deck.commanders.slice(0, 2).map((name) => <DeckArt key={name} url={cardData(name).art} />)}</span>
            <span className="deck-card-plate">
              <span className="deck-card-title">{deck.title}</span>
              {!info.broken && <Pips colors={info.colors} />}
            </span>
            {info.note && <span className={cx('deck-card-mark', info.broken && 'warn')}>{info.broken ? (info.waiting ? 'Needs cards' : "Can't play") : 'No text'}</span>}
          </span>
          <span className="card-back" aria-hidden="true" />
        </span>
      </button>
      {caption && <span className="deck-caption">{caption}</span>}
    </div>
  );
}

/** A commander's art crop, or just the deck's colour if it doesn't load. */
function DeckArt({ url }: { url: string }) {
  const ok = useArtLoads(url);
  return <span className="deck-art" style={ok ? { backgroundImage: `url(${url})` } : undefined} />;
}

const EXAMPLE = `Commander
1 Seraphine, Herald of Dawn

Deck
1 Sol Ring (C21) 263
1 Swords to Plowshares
32 Plains
...`;

/** Names being fetched from Scryfall, and what the last fetches came to. */
interface Fetching {
  pending: string[];
  /** Names Scryfall doesn't know, or knows by another name. */
  notFound: string[];
  /** Names not fetched because Scryfall couldn't be reached, and why in plain words. */
  failed: string[];
  error: string | null;
}

const NO_FETCH: Fetching = { pending: [], notFound: [], failed: [], error: null };

/** Waits this long after the last keystroke before asking Scryfall, so typing doesn't send a request per letter. */
const DEBOUNCE = 800;

/**
 * The paste screen: a text box, the list as read, a commander picker and every problem. Save
 * is enabled once there are none. Cards the game doesn't have are fetched from Scryfall and
 * scripted from their Oracle text; one it can't read is listed with the clause, grouped with
 * others that stumble on the same wording, and written down for Claude to script later
 * (docs/card-requests.json). For each, the player chooses: play it without its rules text,
 * or swap it. Cards left to swap don't stop the deck being saved; it waits on the menu until
 * they are. `editing` is a saved deck reopened from the menu: its list comes back with those
 * cards at the top, and saving replaces it.
 */
function PasteDeck({ close, editing }: { close: () => void; editing: DeckDef | null }) {
  const save = useStore((s) => s.saveDeck);
  const version = useStore((s) => s.cardsVersion);
  const cardsChanged = useStore((s) => s.cardsChanged);
  const [text, setText] = useState(() => (editing ? deckAsList(editing, savedDeckState(editing).unplayable) : ''));
  const [title, setTitle] = useState(editing?.title ?? '');
  const [picked, setPicked] = useState<string[] | null>(null);
  /** Cards the player chose to play without their rules text, by card-pool name. */
  const [textless, setTextless] = useState<string[]>(editing?.textless ?? []);
  const [id] = useState(() => editing?.id ?? `pasted-${Date.now()}`);
  const [fetching, setFetching] = useState<Fetching>(NO_FETCH);
  const [kept, setKept] = useState(() => keptRequests().cards.length);
  /** Names asked for on this screen (compared as `norm` does), so each is fetched once unless retried. */
  const tried = useRef(new Set<string>());
  /** Refused cards already written down from this screen: each counts once per screen. */
  const reported = useRef(new Set<string>());
  /** Fetches run one after another, keeping to Scryfall's pace (50-100 ms between requests). */
  const queue = useRef(Promise.resolve());

  const why = (name: string) =>
    fetching.pending.includes(name)
      ? 'is being fetched from Scryfall'
      : fetching.failed.includes(name)
        ? "couldn't be fetched from Scryfall"
        : tried.current.has(norm(name))
          ? "isn't a card Scryfall knows by this name. Check the spelling"
          : "isn't in the card pool";
  // `version` and `fetching` change what the check sees: new cards, and why the rest are missing.
  const check = useMemo(() => checkList(text, picked, title, id, why, textless), [text, picked, title, version, fetching, textless]);
  const count = [...check.list.commanders, ...check.list.cards].reduce((n, e) => n + e.count, 0);

  const run = (names: string[]) => {
    names.forEach((n) => tried.current.add(norm(n)));
    setFetching((f) => ({ ...f, pending: [...f.pending, ...names], failed: f.failed.filter((n) => !names.includes(n)) }));
    queue.current = queue.current.then(async () => {
      const res = await fetchCards(names);
      if (res.cards.length) cardsChanged();
      setFetching((f) => ({
        pending: f.pending.filter((n) => !names.includes(n)),
        notFound: [...f.notFound, ...res.notFound],
        failed: [...f.failed, ...res.failed],
        error: res.error ?? (f.failed.length ? f.error : null),
      }));
      await new Promise((r) => setTimeout(r, 100));
    });
  };

  // Unknown names are fetched once the list stops changing.
  const unknown = check.parts.unknown.filter((n) => !tried.current.has(norm(n)));
  const unknownKey = unknown.join('\n');
  useEffect(() => {
    if (!unknown.length) return;
    const t = setTimeout(() => run(unknown), DEBOUNCE);
    return () => clearTimeout(t);
  }, [unknownKey]);

  // Fetched cards the game can't play are written down, once each per screen.
  const names = [...new Set([...check.parts.commanders, ...check.parts.cards])];
  const requests = names.flatMap((n) => requestFor(n) ?? []);
  const refusedKey = requests.map((r) => r.name).join('\n');
  useEffect(() => {
    const fresh = requests.filter((r) => !reported.current.has(r.name));
    if (!fresh.length) return;
    fresh.forEach((r) => reported.current.add(r.name));
    reportRequests(fresh);
    setKept(keptRequests().cards.length);
  }, [refusedKey]);

  const stored = useMemo(fetchedCount, [version]);
  const clear = async () => {
    if (!window.confirm(`Forget the ${stored} cards fetched from Scryfall? Saved decks that use them fetch them again next time, which needs the internet.`)) return;
    await clearFetchedCards();
    // Cards already added stay until the page reloads.
    window.location.reload();
  };

  const playTextless = (name: string, on: boolean) => setTextless((t) => (on ? [...t.filter((n) => n !== name), name] : t.filter((n) => n !== name)));
  /** Takes every line naming this card out of the list, so another can be pasted in its place. */
  const swap = (name: string) => {
    const lines = new Set([...check.list.commanders, ...check.list.cards].filter((e) => poolName(e.name) === name).map((e) => e.line));
    setText((t) =>
      t
        .split(/\r?\n/)
        .filter((_, i) => !lines.has(i + 1))
        .join('\n'),
    );
    playTextless(name, false);
  };
  const chosen = check.refused.filter((r) => r.textless);

  // A third pick replaces the first: at most two commanders, and only partners pair (702.124).
  const toggle = (name: string) => {
    const now = check.commanders;
    setPicked(now.includes(name) ? now.filter((n) => n !== name) : [...now, name].slice(-2));
  };
  return (
    <MenuFrame className="paste" title="Paste a deck list">
      <div className="paste-body">
        <textarea
          className="paste-text"
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setPicked(null);
          }}
          placeholder={EXAMPLE}
          spellCheck={false}
          autoFocus
          aria-label="Deck list"
        />
        <div className="paste-side">
          <label className="paste-title">
            <span>Name</span>
            <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder={check.deck?.title ?? check.list.title ?? 'Named after the commander'} />
          </label>
          <div className="paste-count">
            {count} cards read
            {fetching.pending.length > 0 && <span className="paste-fetching"> · fetching {fetching.pending.length} from Scryfall…</span>}
          </div>
          {fetching.error && fetching.failed.length > 0 && (
            <div className="paste-error" role="alert">
              <p>
                {fetching.error} {fetching.failed.length === 1 ? '1 card was' : `${fetching.failed.length} cards were`} not fetched. Every other card still works.
              </p>
              <button className="btn btn-plain small" onClick={() => run(fetching.failed)}>
                <span className="btn-label">Retry</span>
              </button>
            </div>
          )}
          {check.candidates.length > 0 && (
            <div className="paste-commanders">
              <span>Commander</span>
              <div>
                {check.candidates.map((name) => (
                  <button key={name} className={cx('chip', check.commanders.includes(name) && 'on')} onClick={() => toggle(name)}>
                    {name}
                  </button>
                ))}
              </div>
            </div>
          )}
          <ul className={cx('paste-problems', !check.problems.length && (check.leftover.length ? 'waiting' : 'ok'))}>
            {check.problems.length ? (
              check.problems.map((p, i) => <li key={i}>{p}</li>)
            ) : check.leftover.length ? (
              <li>
                Can be saved, but {cards(check.leftover.length)} below {check.leftover.length === 1 ? 'needs' : 'need'} a choice first: the deck waits on the menu until then.
              </li>
            ) : (
              <li>Ready to save: a legal Commander deck{chosen.length ? `, with ${cards(chosen.length)} played without ${chosen.length === 1 ? 'its' : 'their'} rules text` : ''}.</li>
            )}
          </ul>
          {check.leftover.length > 0 && <RefusedList cards={check.leftover} playTextless={(n) => playTextless(n, true)} swap={swap} />}
          {chosen.length > 0 && <TextlessList cards={chosen} undo={(n) => playTextless(n, false)} />}
          {requests.length > 0 && (
            <p className="paste-note">
              {writesFile ? 'Cards the game can\'t read are written down in docs/card-requests.json' : 'Download the report and add it to the project'} so Claude can script them
              later.
            </p>
          )}
          <p className="paste-note">
            Cards the game doesn't have are fetched from Scryfall and kept in this browser, so the deck works offline. Set codes, collector numbers, foil marks
            and category headings are ignored.
          </p>
          <div className="paste-buttons">
            {stored > 0 && (
              <button className="btn btn-plain small" onClick={clear} title="Forget the cards fetched from Scryfall">
                <span className="btn-label">Clear {stored} fetched</span>
              </button>
            )}
            {!writesFile && kept > 0 && (
              <button
                className="btn btn-plain small"
                title="Save the cards the game couldn't read as card-requests.json, then empty the list here"
                onClick={() => {
                  downloadRequests();
                  setKept(0);
                }}
              >
                <span className="btn-label">Download report</span>
              </button>
            )}
            <button className="btn btn-plain small" onClick={close}>
              <span className="btn-label">Cancel</span>
            </button>
            <button
              className="btn btn-go small"
              disabled={!check.deck}
              title={check.deck && !check.ready ? 'Saved greyed out on the menu, to finish later' : undefined}
              onClick={() => {
                save(check.deck!);
                close();
              }}
            >
              <span className="btn-label">{check.deck && !check.ready ? 'Save for Later' : 'Save Deck'}</span>
            </button>
          </div>
        </div>
      </div>
    </MenuFrame>
  );
}

/** Refused cards in groups that share a heading, in the order each group first appears. */
function groups(list: RefusedCard[]): RefusedCard[][] {
  const by = new Map<string, RefusedCard[]>();
  for (const r of list) by.set(r.group, [...(by.get(r.group) ?? []), r]);
  return [...by.values()];
}

/**
 * The cards the game can't read yet, grouped by the wording it stumbled on, each with its
 * Oracle line and the choice: play it without its rules text, or swap it for another card.
 * A commander, or a card the engine can't frame as a vanilla card, can only be swapped.
 */
function RefusedList({ cards: list, playTextless, swap }: { cards: RefusedCard[]; playTextless: (name: string) => void; swap: (name: string) => void }) {
  return (
    <section className="paste-refused" aria-label="Cards the game can't read yet">
      <h3>The game can't read {list.length === 1 ? 'this card' : `these ${list.length} cards`} yet</h3>
      <p className="paste-note">Play each without its rules text tonight, or swap it for another card.</p>
      {groups(list).map((group) => (
        <div key={group[0].group} className="refused-group">
          <div className="refused-clause">{group[0].heading}</div>
          {group.map((r) => (
            <div key={r.name} className="refused-card">
              <div className="refused-name">{r.name}</div>
              {!r.lineInHeading && <div className="refused-line">{r.line}</div>}
              <div className="refused-choice">
                {r.noTextless === null ? (
                  <button className="chip" onClick={() => playTextless(r.name)} title="It plays with its name, cost, types, power and toughness and the keywords the game knows. The rest of its text does nothing.">
                    Play without its rules text
                  </button>
                ) : (
                  <span className="refused-why">Can't play without its text: {r.noTextless}.</span>
                )}
                <button className="chip" onClick={() => swap(r.name)} title="Take it out of the list, to paste another card in">
                  Swap it out
                </button>
              </div>
            </div>
          ))}
        </div>
      ))}
    </section>
  );
}

/** The cards the player chose to play without their rules text, with the text the game can't read, and Undo. */
function TextlessList({ cards: list, undo }: { cards: RefusedCard[]; undo: (name: string) => void }) {
  return (
    <section className="paste-textless" aria-label="Played without their rules text">
      <h3>Played without {list.length === 1 ? 'its' : 'their'} rules text</h3>
      <p className="paste-note">Each plays as a plain card: its name, cost, types, power and toughness, and the keywords the game knows. The text the game can't read does nothing.</p>
      {list.map((r) => (
        <div key={r.name} className="refused-card">
          <div className="refused-name">
            {r.name} <span className="textless-badge">no text</span>
          </div>
          <div className="refused-line">Can't read: {r.line}</div>
          <div className="refused-choice">
            <button className="chip" onClick={() => undo(r.name)}>
              Undo
            </button>
          </div>
        </div>
      ))}
    </section>
  );
}
