// Cards drawn as text, for when Scryfall's image or art crop doesn't load (offline, blocked,
// or a token with no image). The text comes from the card data, which is bundled or cached,
// so a card can always be read even when it can't be seen.
import { useEffect, useState } from 'react';
import type { MouseEventHandler, ReactNode } from 'react';
import type { CardData } from '../engine';
import { cx } from './util';

/** Images that failed to load this session, so later copies of the card go straight to text. */
const failed = new Set<string>();
const broken = (url: string) => !url || failed.has(url);

/** The mana-font class for one symbol: {T} is ms-tap, and hybrid and Phyrexian symbols drop the slash ({R/W} is ms-rw, {W/P} is ms-wp). */
export function symbolClass(symbol: string): string {
  const s = symbol.toLowerCase().replaceAll('/', '');
  return `ms-${s === 't' ? 'tap' : s === 'q' ? 'untap' : s}`;
}

export function ManaCost({ cost }: { cost: string }) {
  const symbols = [...cost.matchAll(/\{([^}]+)\}/g)].map((m) => m[1]);
  return (
    <span className="mana-cost">
      {symbols.map((s, i) => (
        <i key={i} className={`ms ms-cost ms-shadow ${symbolClass(s)}`} />
      ))}
    </span>
  );
}

/** One line of rules text, with {2}{G} and {T} drawn as symbols and reminder text in italics. */
function RulesLine({ line }: { line: string }) {
  const parts: ReactNode[] = [];
  // Split around reminder text "(...)" first, then around symbols inside each piece.
  line.split(/(\([^)]*\))/).forEach((piece, i) => {
    const bits = piece.split(/(\{[^}]+\})/).map((bit, j) =>
      /^\{[^}]+\}$/.test(bit) ? <i key={j} className={`ms ms-cost ${symbolClass(bit.slice(1, -1))}`} /> : bit,
    );
    parts.push(piece.startsWith('(') ? <em key={i}>{bits}</em> : <span key={i}>{bits}</span>);
  });
  return <p>{parts}</p>;
}

/** The colour class for a card's frame, the same ones the battlefield tiles use. */
export function frameOf(d: CardData): string {
  if (d.typeLine.includes('Land')) return 'land';
  if (d.colors.length > 1) return 'gold';
  return d.colors[0] ?? 'artifact';
}

/** The number in the bottom corner: power/toughness, loyalty (306.5a) or defense (310.4a). */
function cornerOf(d: CardData): string | null {
  if (d.power !== undefined && d.toughness !== undefined) return `${d.power}/${d.toughness}`;
  return d.loyalty ?? d.defense ?? null;
}

interface FaceProps {
  className?: string;
  title?: string;
  onClick?: MouseEventHandler<HTMLElement>;
}

/** A whole card drawn from its text: name and mana cost, type line, rules text, and P/T, loyalty or defense. */
export function TextCard({ d, className, title, onClick }: { d: CardData } & FaceProps) {
  const corner = cornerOf(d);
  return (
    <div className={cx('text-card', `frame-${frameOf(d)}`, className)} title={title} onClick={onClick} role="img" aria-label={d.name}>
      <div className="text-card-face">
        <div className="text-card-head">
          <span className="text-card-name">{d.name}</span>
          {d.manaCost && <ManaCost cost={d.manaCost} />}
        </div>
        <div className="text-card-type">{d.typeLine}</div>
        <div className={cx('text-card-rules', d.oracleText.length > 420 ? 'longer' : d.oracleText.length > 240 && 'long')}>
          {d.oracleText.split('\n').map((line, i) => (
            <RulesLine key={i} line={line} />
          ))}
        </div>
        {corner && <div className="text-card-corner">{corner}</div>}
      </div>
    </div>
  );
}

/** A card's full image, or the card drawn as text if the image doesn't load. Takes the same props an <img> did. */
export function CardImage({ d, alt, draggable, ...face }: { d: CardData; alt?: string; draggable?: boolean } & FaceProps) {
  const url = d.image;
  const [bad, setBad] = useState(() => broken(url));
  useEffect(() => setBad(broken(url)), [url]);
  if (bad) return <TextCard d={d} {...face} />;
  return (
    <img
      src={url}
      alt={alt ?? d.name}
      draggable={draggable}
      {...face}
      onError={() => {
        failed.add(url);
        setBad(true);
      }}
    />
  );
}

/**
 * Whether an art crop loads. Battlefield tiles show the art as a CSS background, which has
 * no error event, so this loads the same URL in an Image to find out. The browser fetches
 * it once and both share the result.
 */
export function useArtLoads(url: string): boolean {
  const [ok, setOk] = useState(() => !broken(url));
  useEffect(() => {
    if (broken(url)) return setOk(false);
    setOk(true);
    const img = new Image();
    img.onerror = () => {
      failed.add(url);
      setOk(false);
    };
    img.src = url;
    return () => {
      img.onerror = null;
    };
  }, [url]);
  return ok;
}
