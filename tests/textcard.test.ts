import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { CardData } from '../src/engine';
import { CardImage, ManaCost, TextCard, isHybrid, symbolClass } from '../src/ui/TextCard';

const elf: CardData = {
  name: 'Elvish Mystic',
  manaCost: '{G}',
  cmc: 1,
  colors: ['G'],
  colorIdentity: ['G'],
  typeLine: 'Creature — Elf Druid',
  oracleText: '{T}: Add {G}. (Tap this creature for mana.)',
  power: '1',
  toughness: '1',
  keywords: [],
  image: 'https://cards.scryfall.io/normal/elf.jpg',
  art: 'https://cards.scryfall.io/art_crop/elf.jpg',
};

describe('text-only card', () => {
  it('shows name, cost, type line, rules text and P/T', () => {
    const html = renderToStaticMarkup(createElement(TextCard, { d: elf }));
    expect(html).toContain('frame-G');
    expect(html).toContain('Elvish Mystic');
    expect(html).toContain('ms-g');
    expect(html).toContain('Creature — Elf Druid');
    expect(html).toContain('ms-tap');
    expect(html).toContain('<em>(Tap this creature for mana.)</em>');
    expect(html).toContain('1/1');
  });

  it('shows loyalty for a planeswalker and nothing in the corner for a sorcery', () => {
    const walker = { ...elf, typeLine: 'Legendary Planeswalker — Nissa', power: undefined, toughness: undefined, loyalty: '3' };
    expect(renderToStaticMarkup(createElement(TextCard, { d: walker }))).toContain('text-card-corner">3<');
    const sorcery = { ...elf, typeLine: 'Sorcery', power: undefined, toughness: undefined };
    expect(renderToStaticMarkup(createElement(TextCard, { d: sorcery }))).not.toContain('text-card-corner');
  });

  it('draws the image when there is one, and text when there is none', () => {
    expect(renderToStaticMarkup(createElement(CardImage, { d: elf }))).toMatch(/<img [^>]*src="https:\/\/cards\.scryfall\.io\/normal\/elf\.jpg"/);
    expect(renderToStaticMarkup(createElement(CardImage, { d: { ...elf, image: '' } }))).toContain('class="text-card');
  });

  it('names mana-font symbols', () => {
    expect(['T', 'Q', '2', 'R/W', 'W/P', 'X'].map(symbolClass)).toEqual(['ms-tap', 'ms-untap', 'ms-2', 'ms-rw', 'ms-wp', 'ms-x']);
  });

  it('marks hybrid symbols, whose two halves the hand\'s corner cost places itself', () => {
    expect(['R/W', '2/G', 'C/U', 'W/U/P', 'W/P', 'W', 'X'].map(isHybrid)).toEqual([true, true, true, true, false, false, false]);
    expect(renderToStaticMarkup(createElement(ManaCost, { cost: '{1}{R/W}' }))).toMatch(/ms-rw ms-hybrid/);
  });
});
