import { useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { DECKS, cardData, deckColors } from '../cards/db';
import type { DeckDef } from '../cards/db';
import { checkList, deckAsList, norm, poolName, savedDeckIssues, savedDeckState } from '../cards/decklist';
import type { DeckState, RefusedCard } from '../cards/decklist';
import { clearFetchedCards, fetchCards, fetchedCount, requestFor } from '../cards/fetched';
import { downloadRequests, keptRequests, reportRequests, writesFile } from './card-requests';
import { type SeatPlayer, useStore } from './store';
import { HostTable, JoinTable, MenuFrame, SavedGames, TableEnded, WaitingRoom } from './LobbyScreen';
import { MusicControl, SoundControl } from './SoundControl';
import { useArtLoads } from './TextCard';
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

/**
 * The title screen. The decks fill the middle, starter decks then pasted ones with a tile to
 * paste another; the table beside them: who sits in the other seats, and the ways to play
 * with friends or watch. The hovered deck's art fills the background.
 */
function DeckMenu({ go, edit }: { go: (screen: MenuScreen) => void; edit: (deck: DeckDef) => void }) {
  const start = useStore((s) => s.start);
  // Hosting and joining need the Windows program (or `npm run dev`): a file opened from disk has no lobby.
  const lobby = useStore((s) => s.lobby);
  const table = useStore((s) => s.table);
  const saved = useStore((s) => s.savedDecks);
  // Saved decks are checked again once fetched cards load (`loadCards`).
  useStore((s) => s.cardsVersion);
  const [focus, setFocus] = useState<DeckDef>(DECKS[0]);
  return (
    <div className="stage menu title-screen">
      <MenuBackdrop deck={focus} />
      <header className="menu-top">
        <div className="menu-heading">
          <h1>Commander Table</h1>
          <p className="menu-sub">Arena-style Commander for two to four players</p>
        </div>
        <div className="menu-sound">
          <SoundControl />
          <MusicControl />
        </div>
      </header>
      <main className="menu-main">
        <div className="deck-shelf" role="group" aria-label="Pick a deck to play">
          <DeckSection title="Starter decks" decks={DECKS.map((deck) => ({ deck }))} play={start} hover={setFocus} />
          <DeckSection title="Your decks" decks={saved.map((deck) => ({ deck, state: savedDeckState(deck) }))} play={start} hover={setFocus} edit={edit} pasted>
            <button className="deck deck-paste" onClick={() => go('paste')}>
              <span className="deck-paste-plus" aria-hidden="true">
                +
              </span>
              <span className="deck-title">Paste a deck list</span>
              <span className="deck-blurb">An Arena, Moxfield, Archidekt, MTGO or TappedOut export, or a plain list</span>
            </button>
          </DeckSection>
        </div>
        <aside className="menu-side">
          <section className="menu-panel">
            <h2>The table</h2>
            <p className="menu-hint">Pick a deck to sit down. These seats say who plays the others.</p>
            <Opponents />
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
          <button className="menu-watch" onClick={() => start(null)}>
            Watch the bots play
          </button>
        </aside>
      </main>
    </div>
  );
}

/** The focused deck's art, blurred and dimmed behind the menu, tinted with its colours. */
function MenuBackdrop({ deck }: { deck: DeckDef }) {
  const url = cardData(deck.commanders[0]).art;
  const ok = useArtLoads(url);
  const color = deckColor(deckColors(deck));
  return (
    <div className="menu-backdrop" aria-hidden="true" style={{ '--deck': color } as CSSProperties}>
      <div key={url} className="menu-backdrop-art" style={ok ? { backgroundImage: `url(${url})` } : undefined} />
    </div>
  );
}

/** A labelled grid of decks, and anything after them (the paste tile). It wraps onto new rows; the shelf around it scrolls once they don't fit. */
function DeckSection({
  title,
  decks,
  play,
  hover,
  edit,
  pasted,
  children,
}: {
  title: string;
  /** Each deck, and for a pasted one what stops it being played (`savedDeckState`). */
  decks: { deck: DeckDef; state?: DeckState }[];
  play: (deck: DeckDef) => void;
  hover: (deck: DeckDef) => void;
  edit?: (deck: DeckDef) => void;
  pasted?: boolean;
  children?: ReactNode;
}) {
  return (
    <section className="deck-section">
      <h2>{title}</h2>
      <div className="deck-list">
        {decks.map(({ deck, state }) => (
          <DeckTile key={deck.id} deck={deck} state={state} play={() => play(deck)} hover={() => !state?.issues.length && !state?.unplayable.length && hover(deck)} edit={edit && (() => edit(deck))} pasted={pasted} />
        ))}
        {children}
      </div>
    </section>
  );
}

/** "1 card" or "3 cards". */
const cards = (n: number) => (n === 1 ? '1 card' : `${n} cards`);

/**
 * A deck on the menu. A pasted deck can be deleted. It is greyed out if a newer card pool
 * can't play it, or if it was saved with cards the game can't play yet: then **Swap them**
 * opens it in the paste screen with those cards at the top. One that plays some cards
 * without their rules text says how many.
 */
function DeckTile({ deck, state, play, hover, edit, pasted }: { deck: DeckDef; state?: DeckState; play: () => void; hover: () => void; edit?: () => void; pasted?: boolean }) {
  const remove = useStore((s) => s.deleteDeck);
  const issues = state?.issues ?? [];
  const waiting = state?.unplayable.length ?? 0;
  const textless = state?.textless.length ?? 0;
  const broken = issues.length > 0 || waiting > 0;
  // A deck's colours are its commanders' colour identity (903.4, 702.124c).
  const colors = broken ? [] : deckColors(deck);
  const color = broken ? '#4a5366' : deckColor(colors);
  const blurb = issues.length
    ? `Can't be played: ${issues[0]}`
    : waiting
      ? `${cards(waiting)} the game can't play yet`
      : textless
        ? `${cards(textless)} ${textless === 1 ? 'plays' : 'play'} without ${textless === 1 ? 'its' : 'their'} text`
        : deck.blurb;
  return (
    <div className={cx('deck-slot', waiting > 0 && !issues.length && 'deck-waiting')}>
      <button className={cx('deck', broken && 'broken')} onClick={play} onPointerEnter={hover} onFocus={hover} disabled={broken} style={{ '--deck': color } as CSSProperties} title={deck.commanders.join(' & ')}>
        {/* Each commander's art crop; partners split the banner. */}
        <div className="deck-banner">
          {deck.commanders.map((name) => (
            <DeckArt key={name} url={broken ? '' : cardData(name).art} />
          ))}
          <div className="deck-pips">
            {!broken && (colors.length ? colors.map((c) => <i key={c} className={`ms ms-cost ms-shadow ms-${c.toLowerCase()}`} />) : <i className="ms ms-cost ms-shadow ms-c" />)}
          </div>
        </div>
        <div className="deck-info">
          <div className="deck-title">{deck.title}</div>
          <div className="deck-commander">{deck.commanders.join(' & ')}</div>
          <div className={cx('deck-blurb', !broken && textless > 0 && 'deck-textless')}>{blurb}</div>
        </div>
      </button>
      {pasted && broken && edit && (
        <button className="deck-fix" onClick={edit} title="Open this deck in the paste screen, with the cards to swap at the top">
          {waiting && !issues.length ? (waiting === 1 ? 'Swap it' : 'Swap them') : 'Open the list'}
        </button>
      )}
      {pasted && (
        <button
          className="deck-delete"
          title="Delete this deck"
          aria-label={`Delete ${deck.title}`}
          onClick={() => window.confirm(`Delete "${deck.title}"?`) && remove(deck.id)}
        >
          ×
        </button>
      )}
    </div>
  );
}

/** A commander's art crop, or just the deck's colour if it doesn't load. */
function DeckArt({ url }: { url: string }) {
  const ok = useArtLoads(url);
  return <div className="deck-art" style={ok ? { backgroundImage: `url(${url})` } : undefined} />;
}

const SEAT_LABELS: Record<SeatPlayer, string> = { bot: 'Bot', person: 'Person here', empty: 'Empty seat' };

/**
 * One pair of pickers per opponent seat, saved with the settings: who plays it (a bot,
 * another person passing this screen, or nobody, for a smaller table) and its deck, or
 * Automatic (the next built-in deck no one else has).
 */
function Opponents() {
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
    <div className="opponents">
      {opponents.map((id, seat) => (
        <div key={seat} className={cx('opponent-seat', players[seat] === 'empty' && 'empty')}>
          <span className="opponent-n">{seat + 2}</span>
          <select value={players[seat]} onChange={(e) => who(seat, e.target.value as SeatPlayer)} aria-label={`Who plays opponent ${seat + 1}`}>
            {(Object.keys(SEAT_LABELS) as SeatPlayer[]).map((p) => (
              <option key={p} value={p} disabled={p === 'empty' && lastFilled && players[seat] !== 'empty'}>
                {SEAT_LABELS[p]}
              </option>
            ))}
          </select>
          <select value={id ?? ''} disabled={players[seat] === 'empty'} onChange={(e) => pick(seat, e.target.value)} aria-label={`Opponent ${seat + 1}'s deck`}>
            <option value="">Automatic</option>
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
