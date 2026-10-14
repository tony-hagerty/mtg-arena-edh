import { DECKS, cardData } from '../cards/db';
import { useStore } from './store';

export function Menu() {
  const start = useStore((s) => s.start);
  return (
    <div className="stage menu">
      <h1>Commander Table</h1>
      <p className="menu-sub">A four-player, Arena-style Commander prototype. Pick a deck — bots pilot the other three.</p>
      <div className="deck-list">
        {DECKS.map((deck, i) => (
          <button key={deck.id} className="deck" onClick={() => start(i)} style={{ borderColor: `var(--f-${deck.color})` }}>
            <img src={cardData(deck.commander).image} alt={deck.commander} draggable={false} />
            <div className="deck-title">
              <i className={`ms ms-cost ms-${deck.color.toLowerCase()}`} /> {deck.title}
            </div>
            <div className="deck-commander">{deck.commander}</div>
            <div className="deck-blurb">{deck.blurb}</div>
          </button>
        ))}
      </div>
      <button className="watch" onClick={() => start(null)}>
        or watch four bots play
      </button>
    </div>
  );
}
