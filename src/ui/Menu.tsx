import { useEffect, useMemo, useRef, useState } from 'react';
import { DECKS, cardData, deckColors } from '../cards/db';
import type { DeckDef } from '../cards/db';
import { checkList, norm, savedDeckIssues } from '../cards/decklist';
import { clearFetchedCards, fetchCards, fetchedCount, requestFor } from '../cards/fetched';
import { downloadRequests, keptRequests, reportRequests, writesFile } from './card-requests';
import { type SeatPlayer, useStore } from './store';
import { HostTable, JoinTable, WaitingRoom } from './LobbyScreen';
import { CardImage } from './TextCard';
import { cx, deckColor } from './util';

type MenuScreen = 'decks' | 'paste' | 'host' | 'join';

export function Menu() {
  const [screen, setScreen] = useState<MenuScreen>('decks');
  const table = useStore((s) => s.table);
  const atTable = !!table && table.role !== 'none';
  const back = () => setScreen('decks');
  // Leaving a table comes back to the decks, not to the form that opened it.
  useEffect(() => {
    if (atTable) back();
  }, [atTable]);
  // At a table, the waiting room stays up until the game starts or this person leaves.
  if (atTable) return <WaitingRoom table={table} />;
  if (screen === 'paste') return <PasteDeck close={back} />;
  if (screen === 'host') return <HostTable close={back} />;
  if (screen === 'join') return <JoinTable close={back} />;
  return <DeckMenu go={setScreen} />;
}

function DeckMenu({ go }: { go: (screen: MenuScreen) => void }) {
  const start = useStore((s) => s.start);
  // Hosting and joining need the Windows program (or `npm run dev`): a file opened from disk has no lobby.
  const lobby = useStore((s) => s.lobby);
  const saved = useStore((s) => s.savedDecks);
  // Saved decks are checked again once fetched cards load (`loadCards`).
  useStore((s) => s.cardsVersion);
  return (
    <div className="stage menu">
      <h1>Commander Table</h1>
      <p className="menu-sub">An Arena-style Commander prototype for two to four players. Pick a deck; the seats below say who plays the others.</p>
      <div className="deck-list">
        {DECKS.map((deck) => (
          <DeckTile key={deck.id} deck={deck} issues={[]} play={() => start(deck)} />
        ))}
        {saved.map((deck) => (
          <DeckTile key={deck.id} deck={deck} issues={savedDeckIssues(deck)} play={() => start(deck)} pasted />
        ))}
      </div>
      <Opponents />
      <div className="menu-actions">
        {lobby && (
          <>
            <button className="watch" onClick={() => go('host')}>
              Host a table
            </button>
            <button className="watch" onClick={() => go('join')}>
              Join a table
            </button>
          </>
        )}
        <button className="watch" onClick={() => go('paste')}>
          Paste a deck list
        </button>
        <button className="watch" onClick={() => start(null)}>
          or watch the bots play
        </button>
      </div>
    </div>
  );
}

/** A deck on the menu. A pasted deck can be deleted, and is greyed out if a newer card pool can't play it. */
function DeckTile({ deck, issues, play, pasted }: { deck: DeckDef; issues: string[]; play: () => void; pasted?: boolean }) {
  const remove = useStore((s) => s.deleteDeck);
  const broken = issues.length > 0;
  // A deck's colours are its commanders' colour identity (903.4, 702.124c).
  const colors = broken ? [] : deckColors(deck);
  return (
    <div className="deck-slot">
      <button className={cx('deck', broken && 'broken')} onClick={play} disabled={broken} style={{ borderColor: broken ? undefined : deckColor(colors) }}>
        {/* Partners show side by side. */}
        <div className="deck-art">
          {deck.commanders.map((name) => (broken ? <div key={name} className="deck-art-missing" /> : <CardImage key={name} d={cardData(name)} alt={name} draggable={false} />))}
        </div>
        <div className="deck-title">
          {!broken && (colors.length ? colors.map((c) => <i key={c} className={`ms ms-cost ms-${c.toLowerCase()}`} />) : <i className="ms ms-cost ms-c" />)} {deck.title}
        </div>
        <div className="deck-commander">{deck.commanders.join(' & ')}</div>
        <div className="deck-blurb">{broken ? `Can't be played: ${issues[0]}` : deck.blurb}</div>
      </button>
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
      <span>Opponents</span>
      {opponents.map((id, seat) => (
        <span key={seat} className="opponent-seat">
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
        </span>
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
 * scripted from their Oracle text; one it can't read is listed with the clause, and written
 * down for Claude to script later (docs/card-requests.json).
 */
function PasteDeck({ close }: { close: () => void }) {
  const save = useStore((s) => s.saveDeck);
  const version = useStore((s) => s.cardsVersion);
  const cardsChanged = useStore((s) => s.cardsChanged);
  const [text, setText] = useState('');
  const [title, setTitle] = useState('');
  const [picked, setPicked] = useState<string[] | null>(null);
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
  const check = useMemo(() => checkList(text, picked, title, `pasted-${Date.now()}`, why), [text, picked, title, version, fetching]);
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
  const refused = names.flatMap((n) => requestFor(n) ?? []);
  const refusedKey = refused.map((r) => r.name).join('\n');
  useEffect(() => {
    const fresh = refused.filter((r) => !reported.current.has(r.name));
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

  // A third pick replaces the first: at most two commanders, and only partners pair (702.124).
  const toggle = (name: string) => {
    const now = check.commanders;
    setPicked(now.includes(name) ? now.filter((n) => n !== name) : [...now, name].slice(-2));
  };
  return (
    <div className="stage menu paste">
      <h2>Paste a deck list</h2>
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
          <ul className={cx('paste-problems', !check.problems.length && 'ok')}>
            {check.problems.length ? check.problems.map((p, i) => <li key={i}>{p}</li>) : <li>Ready to save: a legal Commander deck.</li>}
          </ul>
          {refused.length > 0 && (
            <p className="paste-note">
              A card the game can't read yet can't be played: replace it with another. {writesFile ? 'It is written down in docs/card-requests.json' : 'Download the report and add it to the project'} so
              Claude can script it later.
            </p>
          )}
          <p className="paste-note">
            Cards the game doesn't have are fetched from Scryfall and kept in this browser, so the deck works offline. Set codes, collector numbers and foil marks
            are ignored.
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
              onClick={() => {
                save(check.deck!);
                close();
              }}
            >
              <span className="btn-label">Save Deck</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
