import { useMemo, useState } from 'react';
import { DECKS, cardData, deckColors } from '../cards/db';
import type { DeckDef } from '../cards/db';
import { checkList, savedDeckIssues } from '../cards/decklist';
import { useStore } from './store';
import { cx, deckColor } from './util';

export function Menu() {
  const [pasting, setPasting] = useState(false);
  return pasting ? <PasteDeck close={() => setPasting(false)} /> : <DeckMenu paste={() => setPasting(true)} />;
}

function DeckMenu({ paste }: { paste: () => void }) {
  const start = useStore((s) => s.start);
  const saved = useStore((s) => s.savedDecks);
  return (
    <div className="stage menu">
      <h1>Commander Table</h1>
      <p className="menu-sub">A four-player, Arena-style Commander prototype. Pick a deck — bots pilot the other three.</p>
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
        <button className="watch" onClick={paste}>
          Paste a deck list
        </button>
        <button className="watch" onClick={() => start(null)}>
          or watch four bots play
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
          {deck.commanders.map((name) => (broken ? <div key={name} className="deck-art-missing" /> : <img key={name} src={cardData(name).image} alt={name} draggable={false} />))}
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

/** One picker per bot seat: a deck, or Automatic (the next built-in deck no one else has). Saved with the settings. */
function Opponents() {
  const opponents = useStore((s) => s.settings.opponents);
  const setSetting = useStore((s) => s.setSetting);
  const saved = useStore((s) => s.savedDecks).filter((d) => savedDeckIssues(d).length === 0);
  const pick = (seat: number, id: string) => setSetting({ opponents: opponents.map((o, i) => (i === seat ? id || null : o)) });
  return (
    <div className="opponents">
      <span>Opponents</span>
      {opponents.map((id, seat) => (
        <select key={seat} value={id ?? ''} onChange={(e) => pick(seat, e.target.value)} aria-label={`Opponent ${seat + 1}'s deck`}>
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

/** The paste screen: a text box, the list as read, a commander picker and every problem. Save is enabled once there are none. */
function PasteDeck({ close }: { close: () => void }) {
  const save = useStore((s) => s.saveDeck);
  const [text, setText] = useState('');
  const [title, setTitle] = useState('');
  const [picked, setPicked] = useState<string[] | null>(null);
  const check = useMemo(() => checkList(text, picked, title, `pasted-${Date.now()}`), [text, picked, title]);
  const count = [...check.list.commanders, ...check.list.cards].reduce((n, e) => n + e.count, 0);
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
          <div className="paste-count">{count} cards read</div>
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
          <p className="paste-note">Only cards in the game's card pool can be played. Set codes, collector numbers and foil marks are ignored.</p>
          <div className="paste-buttons">
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
