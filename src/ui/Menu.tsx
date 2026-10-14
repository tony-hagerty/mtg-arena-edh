import { DECKS, cardData, deckColors } from '../cards/db';
import { useStore } from './store';
import { deckColor } from './util';

export function Menu() {
  const start = useStore((s) => s.start);
  return (
    <div className="stage menu">
      <h1>Commander Table</h1>
      <p className="menu-sub">A four-player, Arena-style Commander prototype. Pick a deck — bots pilot the other three.</p>
      <div className="deck-list">
        {DECKS.map((deck, i) => {
          // A deck's colours are its commanders' colour identity (903.4, 702.124c).
          const colors = deckColors(deck);
          return (
            <button key={deck.id} className="deck" onClick={() => start(i)} style={{ borderColor: deckColor(colors) }}>
              {/* Partners show side by side. */}
              <div className="deck-art">
                {deck.commanders.map((name) => (
                  <img key={name} src={cardData(name).image} alt={name} draggable={false} />
                ))}
              </div>
              <div className="deck-title">
                {colors.length ? colors.map((c) => <i key={c} className={`ms ms-cost ms-${c.toLowerCase()}`} />) : <i className="ms ms-cost ms-c" />}{' '}
                {deck.title}
              </div>
              <div className="deck-commander">{deck.commanders.join(' & ')}</div>
              <div className="deck-blurb">{deck.blurb}</div>
            </button>
          );
        })}
      </div>
      <button className="watch" onClick={() => start(null)}>
        or watch four bots play
      </button>
    </div>
  );
}
