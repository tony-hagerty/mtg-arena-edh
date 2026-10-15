// The lobby's screens (phases 4 and 5 of multiplayer): hosting a table, joining one with a
// code, the waiting room until the host starts the game, saved games to resume, and during
// a table's game the votes on bots for away players and the pause. What the table looks
// like comes from the lobby (`Store.table`); these screens only send requests and show refusals.
import { useState } from 'react';
import { DECKS } from '../cards/db';
import type { DeckDef } from '../cards/db';
import { savedDeckIssues } from '../cards/decklist';
import type { LobbySeat, LobbyState, SavedGame, SeatVote } from '../net/lobby';
import { loadName, saveName } from './lobby';
import { deckChoice, useStore } from './store';
import { cx } from './util';

/** Names are shown on avatars and in the log, so they stay short. */
const NAME_MAX = 20;

const SEAT_COUNTS = [2, 3, 4];

/** "Ann", "Ann and Bo", "Ann, Bo and Cy". */
const andList = (names: string[]) => (names.length < 2 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`);

/** Every deck this person can bring to a table: the built-in ones and the pasted decks that can be played. */
function useDecks(): DeckDef[] {
  useStore((s) => s.cardsVersion);
  const saved = useStore((s) => s.savedDecks);
  return [...DECKS, ...saved.filter((d) => savedDeckIssues(d).length === 0)];
}

/** Runs a lobby request, keeping the reason it was refused (in plain words) to show, or clearing the last one. */
function useRequest() {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const run = (request: Promise<void>) => {
    setBusy(true);
    request
      .then(() => setError(null))
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setBusy(false));
  };
  return { error, busy, run };
}

function DeckSelect({ decks, value, onChange, label }: { decks: DeckDef[]; value: DeckDef | null; onChange: (d: DeckDef) => void; label: string }) {
  const saved = decks.filter((d) => !DECKS.includes(d));
  return (
    <select value={value?.id ?? ''} onChange={(e) => onChange(decks.find((d) => d.id === e.target.value)!)} aria-label={label}>
      {!value && (
        <option value="" disabled>
          Pick a deck
        </option>
      )}
      <optgroup label="Built-in decks">
        {DECKS.map((d) => (
          <option key={d.id} value={d.id}>
            {d.title} ({d.commanders.join(' & ')})
          </option>
        ))}
      </optgroup>
      {saved.length > 0 && (
        <optgroup label="Pasted decks">
          {saved.map((d) => (
            <option key={d.id} value={d.id}>
              {d.title} ({d.commanders.join(' & ')})
            </option>
          ))}
        </optgroup>
      )}
    </select>
  );
}

function Problem({ text }: { text: string | null }) {
  return text ? (
    <p className="lobby-error" role="alert">
      {text}
    </p>
  ) : null;
}

/** Opens a table on this computer: your name and deck, how many seats, and whether bots fill the empty ones. */
export function HostTable({ close }: { close: () => void }) {
  const lobby = useStore((s) => s.lobby)!;
  const decks = useDecks();
  const [name, setName] = useState(loadName);
  const [deck, setDeck] = useState<DeckDef>(() => useStore.getState().deck ?? DECKS[0]);
  const [seatCount, setSeatCount] = useState(4);
  const [fillBots, setFillBots] = useState(true);
  const { error, busy, run } = useRequest();
  const host = () => {
    saveName(name.trim());
    useStore.setState({ deck });
    run(lobby.host({ name: name.trim(), deck: deckChoice(deck), seatCount, fillBots }));
  };
  return (
    <div className="stage menu lobby">
      <h2>Host a table</h2>
      <div className="lobby-form">
        <NameField name={name} setName={setName} />
        <label className="lobby-field">
          <span>Your deck</span>
          <DeckSelect decks={decks} value={deck} onChange={setDeck} label="Your deck" />
        </label>
        <div className="lobby-field">
          <span>Seats</span>
          <SeatCount value={seatCount} onChange={setSeatCount} />
        </div>
        <label className="lobby-check">
          <input type="checkbox" checked={fillBots} onChange={(e) => setFillBots(e.target.checked)} />
          Fill empty seats with bots
        </label>
        <Problem text={error} />
        <div className="lobby-buttons">
          <button className="btn btn-plain small" onClick={close}>
            <span className="btn-label">Back</span>
          </button>
          <button className="btn btn-go small" disabled={!name.trim() || busy} onClick={host}>
            <span className="btn-label">Host</span>
          </button>
        </div>
      </div>
    </div>
  );
}

/** Joins a friend's table with the code they sent. */
export function JoinTable({ close }: { close: () => void }) {
  const lobby = useStore((s) => s.lobby)!;
  const decks = useDecks();
  const [code, setCode] = useState('');
  const [name, setName] = useState(loadName);
  const [deck, setDeck] = useState<DeckDef>(() => useStore.getState().deck ?? DECKS[0]);
  const { error, busy, run } = useRequest();
  // A pasted code often brings spaces or a line break with it.
  const clean = code.replace(/\s+/g, '');
  const join = () => {
    saveName(name.trim());
    useStore.setState({ deck });
    run(lobby.join({ code: clean, name: name.trim(), deck: deckChoice(deck) }));
  };
  return (
    <div className="stage menu lobby">
      <h2>Join a table</h2>
      <div className="lobby-form">
        <label className="lobby-field">
          <span>Code</span>
          <input className="lobby-code" value={code} onChange={(e) => setCode(e.target.value)} placeholder="Paste the code the host sent you" spellCheck={false} autoFocus />
        </label>
        <NameField name={name} setName={setName} />
        <label className="lobby-field">
          <span>Your deck</span>
          <DeckSelect decks={decks} value={deck} onChange={setDeck} label="Your deck" />
        </label>
        <Problem text={error} />
        <div className="lobby-buttons">
          <button className="btn btn-plain small" onClick={close}>
            <span className="btn-label">Back</span>
          </button>
          <button className="btn btn-go small" disabled={!clean || !name.trim() || busy} onClick={join}>
            <span className="btn-label">Join</span>
          </button>
        </div>
      </div>
    </div>
  );
}

function NameField({ name, setName }: { name: string; setName: (n: string) => void }) {
  return (
    <label className="lobby-field">
      <span>Your name</span>
      <input value={name} maxLength={NAME_MAX} onChange={(e) => setName(e.target.value)} placeholder="What the others call you" />
    </label>
  );
}

function SeatCount({ value, onChange, disabled }: { value: number; onChange: (n: number) => void; disabled?: boolean }) {
  return (
    <div className="lobby-chips" role="radiogroup" aria-label="Seats">
      {SEAT_COUNTS.map((n) => (
        <button key={n} role="radio" aria-checked={n === value} className={cx('chip', n === value && 'on')} disabled={disabled} onClick={() => onChange(n)}>
          {n}
        </button>
      ))}
    </div>
  );
}

/**
 * The table before the game: the code to send friends, whether friends can reach this host,
 * every seat, your deck and Ready, and for the host the table's settings and Start.
 */
export function WaitingRoom({ table }: { table: LobbyState }) {
  const lobby = useStore((s) => s.lobby)!;
  const lastDeck = useStore((s) => s.deck);
  const decks = useDecks();
  const { error, busy, run } = useRequest();
  const me = table.yourSeat === null ? null : table.seats[table.yourSeat];
  // After a reload the window has forgotten which deck it sent; the seat still says.
  const deck = lastDeck ?? decks.find((d) => d.title === me?.deck?.title && d.commanders.join() === me.deck.commanders.join()) ?? null;
  const hosting = table.role === 'hosting';
  const people = table.seats.filter((s) => s.kind === 'person');
  // A resumed game keeps its seats and decks: it waits only for its players to come back
  // (or for a bot the table voted for to stand in).
  const waitingOn = table.resuming ? people.filter((s) => s.away && !s.standIn) : people.filter((s) => !s.ready);
  const pick = (d: DeckDef) => {
    useStore.setState({ deck: d });
    run(lobby.deck({ deck: deckChoice(d) }));
  };
  const problem = error ?? table.error;

  if (table.role === 'connecting') {
    return (
      <div className="stage menu lobby">
        <h2>Joining…</h2>
        <p className="lobby-note">Reaching the host's computer.</p>
        <Problem text={problem} />
        <div className="lobby-buttons">
          <button className="btn btn-plain small" onClick={() => run(lobby.leave())}>
            <span className="btn-label">Cancel</span>
          </button>
        </div>
      </div>
    );
  }
  return (
    <div className="stage menu lobby">
      <h2>{table.resuming ? 'Resuming a game' : hosting ? 'Your table' : 'At the table'}</h2>
      {hosting && <HostCode table={table} />}
      <ol className="lobby-seats">
        {table.seats.map((seat, i) => (
          <SeatRow key={i} seat={seat} n={i + 1} resuming={table.resuming} />
        ))}
      </ol>
      <SeatVotes votes={table.votes} />
      <div className="lobby-form">
        {me && !table.resuming && (
          <label className="lobby-field">
            <span>Your deck</span>
            <DeckSelect decks={decks} value={deck} onChange={pick} label="Your deck" />
          </label>
        )}
        {hosting && !table.resuming && (
          <>
            <div className="lobby-field">
              <span>Seats</span>
              <SeatCount value={table.seatCount} disabled={busy} onChange={(n) => run(lobby.table({ seatCount: n, fillBots: table.fillBots }))} />
            </div>
            <label className="lobby-check">
              <input type="checkbox" checked={table.fillBots} disabled={busy} onChange={(e) => run(lobby.table({ seatCount: table.seatCount, fillBots: e.target.checked }))} />
              Fill empty seats with bots
            </label>
          </>
        )}
        {table.started ? (
          <p className="lobby-note">The game is starting…</p>
        ) : (
          <p className="lobby-note">
            {waitingOn.length
              ? table.resuming
                ? `Waiting for ${andList(waitingOn.map((s) => s.name))} to join with the code.`
                : `Waiting for ${andList(waitingOn.map((s) => (s.you ? 'you' : s.name)))} to be ready.`
              : table.resuming
                ? hosting
                  ? 'Everyone is back.'
                  : 'Everyone is back. Waiting for the host to resume the game.'
                : hosting
                ? 'Everyone is ready.'
                : 'Everyone is ready. Waiting for the host to start.'}
          </p>
        )}
        <Problem text={problem} />
        <div className="lobby-buttons">
          <button className="btn btn-plain small" onClick={() => run(lobby.leave())}>
            <span className="btn-label">{hosting ? 'Close Table' : 'Leave'}</span>
          </button>
          {me && !table.resuming && (
            <button className={cx('btn small', me.ready ? 'btn-plain' : 'btn-go')} disabled={busy || !me.deck || table.started} onClick={() => run(lobby.ready({ ready: !me.ready }))}>
              <span className="btn-label">{me.ready ? 'Not Ready' : 'Ready'}</span>
            </button>
          )}
          {hosting && (
            <button className="btn btn-go small" disabled={busy || waitingOn.length > 0 || table.started} onClick={() => run(lobby.start())}>
              <span className="btn-label">{table.resuming ? 'Resume Game' : 'Start'}</span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/** The code to send friends, with a copy button, and whether friends elsewhere can use it. */
function HostCode({ table }: { table: LobbyState }) {
  const [copied, setCopied] = useState(false);
  const copy = () =>
    navigator.clipboard
      ?.writeText(table.code!)
      .then(() => setCopied(true))
      .catch(() => setCopied(false));
  return (
    <div className="lobby-host">
      {table.code ? (
        <div className="lobby-code-row">
          <span>Send friends this code</span>
          {/* Read-only text, so it can still be selected and copied by hand. */}
          <input className="lobby-code" readOnly value={table.code} onFocus={(e) => e.target.select()} aria-label="Join code" />
          <button className="btn btn-plain small" onClick={copy}>
            <span className="btn-label">{copied ? 'Copied' : 'Copy'}</span>
          </button>
        </div>
      ) : (
        <p className="lobby-note">Getting the code…</p>
      )}
      <p className={cx('lobby-reach', table.reach?.kind === 'open' ? 'ok' : table.reach && table.reach.kind !== 'checking' && 'warn')}>
        {table.reach?.message ?? 'Checking whether friends on other networks can reach this computer…'}
      </p>
    </div>
  );
}

/** What a person's seat is waiting on, if anything: they're away, or not ready. */
function seatStatus(seat: LobbySeat, resuming: boolean): string {
  if (seat.kind !== 'person') return '';
  if (seat.away) return seat.standIn ? 'Away, a bot is playing' : resuming ? `Waiting for ${seat.name} to join with the code` : 'Away';
  return resuming ? 'Here' : seat.ready ? 'Ready' : 'Not ready';
}

function SeatRow({ seat, n, resuming }: { seat: LobbySeat; n: number; resuming: boolean }) {
  const who = seat.kind === 'open' ? 'Open seat' : seat.name || (seat.kind === 'bot' ? 'Bot' : `Player ${n}`);
  return (
    <li className={cx('lobby-seat', seat.kind, seat.you && 'you', seat.away && 'away')}>
      <span className="lobby-seat-n">{n}</span>
      <span className="lobby-seat-who">
        {who}
        {seat.you && <span className="lobby-tag">you</span>}
        {seat.host && <span className="lobby-tag">host</span>}
        {seat.kind === 'bot' && <span className="lobby-tag">bot</span>}
      </span>
      <span className="lobby-seat-deck">
        {seat.deck ? `${seat.deck.title} (${seat.deck.commanders.join(' & ')})` : seat.kind === 'bot' ? 'Deck picked at the start' : seat.kind === 'person' ? 'No deck yet' : ''}
      </span>
      <span className={cx('lobby-seat-ready', !seat.away && (seat.ready || resuming) && 'ok')}>{seatStatus(seat, resuming)}</span>
    </li>
  );
}

/**
 * The table's open votes on letting a bot play an away person's seat until they're back.
 * Anyone still at the table votes, and can change their vote; it passes with `needed` yes votes.
 */
export function SeatVotes({ votes }: { votes: SeatVote[] }) {
  const lobby = useStore((s) => s.lobby);
  const { error, busy, run } = useRequest();
  if (!votes.length) return null;
  return (
    <div className="seat-votes">
      {votes.map((v) => (
        <div key={v.seat} className="seat-vote" role="group" aria-label={`Vote on ${v.name}'s seat`}>
          <p>{v.name} left. Let a bot play their seat until they're back?</p>
          <div className="seat-vote-row">
            <button className={cx('chip', v.yours === true && 'on')} aria-pressed={v.yours === true} disabled={busy} onClick={() => run(lobby!.vote({ seat: v.seat, yes: true }))}>
              Yes
            </button>
            <button className={cx('chip', v.yours === false && 'on')} aria-pressed={v.yours === false} disabled={busy} onClick={() => run(lobby!.vote({ seat: v.seat, yes: false }))}>
              No
            </button>
            <span className="seat-vote-count">
              {v.yes} yes, {v.no} no. {v.needed} yes {v.needed === 1 ? 'vote' : 'votes'} needed.
            </span>
          </div>
        </div>
      ))}
      <Problem text={error} />
    </div>
  );
}

/** Covers a table's paused game, so nothing behind it can be clicked. Anyone at the table can resume. */
export function PausedOverlay() {
  const paused = useStore((s) => (s.tableGame ? (s.table?.paused ?? null) : null));
  return paused ? <Paused by={paused.by} /> : null;
}

export function Paused({ by }: { by: string }) {
  const lobby = useStore((s) => s.lobby);
  const { error, busy, run } = useRequest();
  return (
    <div className="modal paused" role="alertdialog" aria-modal="true" aria-labelledby="paused-title">
      <div className="game-over">
        <h1 id="paused-title">Paused by {by}</h1>
        <p>Nobody can move until someone resumes the game.</p>
        <Problem text={error} />
        <div className="game-over-buttons">
          <button className="btn btn-plain small" onClick={() => useStore.setState({ confirmExit: true })}>
            <span className="btn-label">Leave</span>
          </button>
          <button className="btn btn-go small" disabled={busy} onClick={() => run(lobby!.pause({ paused: false }))} autoFocus>
            <span className="btn-label">Resume</span>
          </button>
        </div>
      </div>
    </div>
  );
}

/** A table's votes during its game, over the board (the pause covers the board instead). */
export function GameVotes() {
  const votes = useStore((s) => (s.tableGame && !s.table?.paused ? (s.table?.votes ?? null) : null));
  return votes?.length ? (
    <div className="game-votes">
      <SeatVotes votes={votes} />
    </div>
  ) : null;
}

const when = (ms: number) => new Date(ms).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });

/**
 * Why the last table ended (the host left, say), on the deck menu. When this computer
 * kept a copy of that game, it says where: any player can resume it as the new host.
 */
export function TableEnded({ table }: { table: LobbyState }) {
  if (!table.error) return null;
  return (
    <p className="lobby-error menu-error" role="alert">
      {table.error}
      {table.saves.length > 0 && ' Your copy of the game is under Saved games: any player can resume it and host it, and the others join with the new code.'}
    </p>
  );
}

/** Table games saved on this computer, newest first. Resume hosts one again at a new table (with a new code for the others); Forget deletes it. */
export function SavedGames({ table, close }: { table: LobbyState; close: () => void }) {
  const lobby = useStore((s) => s.lobby);
  const { error, busy, run } = useRequest();
  return (
    <div className="stage menu lobby">
      <h2>Saved games</h2>
      <div className="saved-games">
        {table.saves.length ? (
          <ul>
            {table.saves.map((g) => (
              <SavedRow
                key={g.id}
                game={g}
                busy={busy}
                resume={() => run(lobby!.resume({ save: g.id }))}
                forget={() => window.confirm('Forget this saved game? It can’t be resumed afterwards.') && run(lobby!.forget({ save: g.id }))}
              />
            ))}
          </ul>
        ) : (
          <p className="lobby-note">No saved games.</p>
        )}
        <Problem text={error} />
        <div className="lobby-buttons">
          <button className="btn btn-plain small" onClick={close}>
            <span className="btn-label">Back</span>
          </button>
        </div>
      </div>
    </div>
  );
}

function SavedRow({ game, busy, resume, forget }: { game: SavedGame; busy: boolean; resume: () => void; forget: () => void }) {
  const players = game.players.map((p, i) => (i === game.yourSeat ? `${p.name} (you)` : p.bot ? `${p.name} (bot)` : p.name));
  return (
    <li className="saved-game">
      <span className="saved-game-players">{players.join(', ')}</span>
      <span className="saved-game-when">
        Turn {game.turn} · {when(game.savedAt)}
      </span>
      <button className="btn btn-plain small" disabled={busy} onClick={forget}>
        <span className="btn-label">Forget</span>
      </button>
      <button className="btn btn-go small" disabled={busy} onClick={resume}>
        <span className="btn-label">Resume</span>
      </button>
    </li>
  );
}
