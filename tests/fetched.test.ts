// Pasting a deck with cards the pool doesn't have: fetching them from Scryfall (a fake
// fetch here, never the real API), scripting them from their Oracle text, refusing what
// the parser can't read, and writing the refusals down for docs/card-requests.json.
import { describe, expect, it } from 'vitest';
import { DECKS, cardData } from '../src/cards/db';
import type { DeckDef } from '../src/cards/db';
import { checkList, poolName, savedDeckIssues } from '../src/cards/decklist';
import { addCards, commanderLegality, fetchCards, isFetched, loadFetchedCards, requestFor } from '../src/cards/fetched';
import { mergeRequests, readRequests, removeRequests } from '../src/cards/requests';
import type { CardRequest } from '../src/cards/requests';
import { BATCH, fetchCollection, toCard } from '../src/cards/scryfall';
import type { ScryfallCard } from '../src/cards/scryfall';
import { hasScript } from '../src/engine';
import type { CardData } from '../src/engine/types';
import { byName, emptyGame, put, run } from './helpers';

/** A Scryfall card object, as /cards/collection sends it. */
function scry(name: string, type_line: string, oracle_text: string, extra: Partial<ScryfallCard> = {}): ScryfallCard {
  const id = name.toLowerCase().replace(/\W/g, '');
  return {
    name,
    layout: 'normal',
    mana_cost: '{2}{W}',
    cmc: 3,
    colors: ['W'],
    color_identity: ['W'],
    type_line,
    oracle_text,
    power: '0',
    toughness: '4',
    keywords: [],
    image_uris: { normal: `https://cards.scryfall.io/normal/${id}.jpg?123`, art_crop: `https://cards.scryfall.io/art_crop/${id}.jpg?123` },
    legalities: { commander: 'legal', vintage: 'legal' },
    ...extra,
  };
}

const WALL = scry('Wall of Omens', 'Creature — Wall', 'Defender\nWhen this creature enters, draw a card.', { mana_cost: '{1}{W}', cmc: 2, keywords: ['Defender'] });
const WARDEN = scry('Essence Warden', 'Creature — Elf Shaman', 'Whenever another creature enters, you gain 1 life.', { mana_cost: '{G}', cmc: 1, colors: ['G'], color_identity: ['G'] });

/** A fake fetch that answers /cards/collection from these cards, and records each request's names. */
function fakeScryfall(cards: ScryfallCard[], calls: string[][] = []): typeof fetch {
  return (async (_url: string, init: RequestInit) => {
    const names: string[] = JSON.parse(init.body as string).identifiers.map((i: { name: string }) => i.name);
    calls.push(names);
    const data = names.flatMap((n) => cards.filter((c) => c.name.toLowerCase() === n.toLowerCase()));
    const not_found = names.filter((n) => !cards.some((c) => c.name.toLowerCase() === n.toLowerCase())).map((name) => ({ name }));
    return new Response(JSON.stringify({ data, not_found }), { status: 200 });
  }) as typeof fetch;
}

describe('Scryfall card data', () => {
  it('maps a card the way npm run fetch-cards does: images without their cache-busting query', () => {
    const c = toCard(WALL);
    expect(c).toMatchObject({ name: 'Wall of Omens', manaCost: '{1}{W}', cmc: 2, colors: ['W'], typeLine: 'Creature — Wall', power: '0', toughness: '4', keywords: ['Defender'] });
    expect(c.image).toBe('https://cards.scryfall.io/normal/wallofomens.jpg');
  });

  it('keeps each face of a double-faced card, under the whole card\'s name (712)', () => {
    const face = (name: string, type_line: string, mana_cost: string) => ({ name, type_line, mana_cost, oracle_text: '', image_uris: { normal: `n/${name}`, art_crop: `a/${name}` } });
    const c = toCard({
      ...scry('Front // Back', 'Creature — Human // Creature — Horror', ''),
      layout: 'transform',
      image_uris: undefined,
      card_faces: [face('Front', 'Creature — Human', '{U}'), face('Back', 'Creature — Horror', '')],
    });
    expect(c.name).toBe('Front // Back');
    expect(c.faces!.map((f) => f.name)).toEqual(['Front', 'Back']);
    // A transformed permanent has its front face's mana value (712.8e).
    expect(c.faces![1].cmc).toBe(3);
  });
});

describe('fetching from Scryfall', () => {
  it(`asks for at most ${BATCH} names a request, pausing between requests`, async () => {
    const calls: string[][] = [];
    const names = Array.from({ length: 160 }, (_, i) => `Card ${i}`);
    const res = await fetchCollection(names, { fetch: fakeScryfall([], calls), pause: 1 });
    expect(calls.map((c) => c.length)).toEqual([75, 75, 10]);
    expect(res.notFound).toHaveLength(160);
    expect(res.error).toBeNull();
  });

  it('says in plain words why Scryfall could not be reached, and which names are left', async () => {
    const offline = (async () => {
      throw new TypeError('Failed to fetch');
    }) as unknown as typeof fetch;
    const res = await fetchCollection(['Wall of Omens'], { fetch: offline });
    expect(res.error).toMatch(/Couldn't reach Scryfall/);
    expect(res.failed).toEqual(['Wall of Omens']);
    const limited = (async () => new Response('', { status: 429 })) as unknown as typeof fetch;
    expect((await fetchCollection(['Wall of Omens'], { fetch: limited })).error).toMatch(/limiting requests/);
  });

  it('keeps the cards from requests that worked when a later one fails', async () => {
    let n = 0;
    const flaky = (async (url: string, init: RequestInit) => (n++ === 0 ? fakeScryfall([WALL])(url, init) : new Response('', { status: 500 }))) as typeof fetch;
    const names = ['Wall of Omens', ...Array.from({ length: 80 }, (_, i) => `Card ${i}`)];
    const res = await fetchCollection(names, { fetch: flaky, pause: 1 });
    expect(res.cards.map((c) => c.name)).toEqual(['Wall of Omens']);
    expect(res.failed).toEqual(names.slice(BATCH));
    expect(res.error).toMatch(/HTTP 500/);
  });
});

describe('a pasted deck with fetched cards', () => {
  it('fetches an unknown card, scripts it from its Oracle text and finds it by name', async () => {
    const list = 'Commander\n1 Lyra Dawnbringer\n\nDeck\n1 Wall of Omens\n1 Sol Ring';
    expect(checkList(list, null, '', 'x').problems).toContain("Wall of Omens isn't in the card pool.");
    const res = await fetchCards(['wall of omens'], { fetch: fakeScryfall([WALL]) });
    expect(res.cards).toHaveLength(1);
    expect(isFetched('Wall of Omens')).toBe(true);
    expect(poolName('WALL OF OMENS')).toBe('Wall of Omens');
    expect(hasScript('Wall of Omens')).toBe(true);
    expect(checkList(list, null, '', 'x').problems.filter((p) => p.includes('Wall of Omens'))).toEqual([]);
    // Playable, so nothing to write down.
    expect(requestFor('Wall of Omens')).toBeNull();
  });

  it('plays a fetched card in a game: Wall of Omens draws a card as it enters', async () => {
    await fetchCards(['Wall of Omens'], { fetch: fakeScryfall([WALL]) });
    let g = emptyGame((d) => {
      put(d, 0, 'Wall of Omens', 'hand');
      put(d, 0, 'Plains', 'battlefield', 2);
    });
    const library = g.players[0].library.length;
    g = run(g, { type: 'cast', card: byName(g, 0, 'Wall of Omens', 'hand')!.id, targets: [] });
    for (let i = 0; i < 12 && g.stack.length; i++) g = run(g, { type: 'pass' });
    expect(byName(g, 0, 'Wall of Omens')).toBeTruthy();
    expect(g.players[0].library.length).toBe(library - 1);
  });

  it('refuses a card the parser can\'t read, naming the clause, and writes it down', async () => {
    await fetchCards(['Essence Warden'], { fetch: fakeScryfall([WARDEN]) });
    expect(hasScript('Essence Warden')).toBe(false);
    const check = checkList('Commander\n1 Lyra Dawnbringer\n\nDeck\n1 Essence Warden', null, '', 'x');
    expect(check.problems).toContain('Essence Warden: the game can\'t read "Whenever another creature enters, you gain 1 life." yet.');
    expect(check.deck).toBeNull();
    const req = requestFor('Essence Warden', new Date('2026-10-15T12:00:00Z'));
    expect(req).toEqual({
      name: 'Essence Warden',
      oracleText: 'Whenever another creature enters, you gain 1 life.',
      clause: 'Whenever another creature enters, you gain 1 life.',
      reason: 'no template matches',
      count: 1,
      last: '2026-10-15T12:00:00.000Z',
    });
  });

  it("says why a name isn't in the pool, as the paste screen tells it", () => {
    const check = checkList('1 Wal of Omens', null, '', 'x', () => "isn't a card Scryfall knows by this name. Check the spelling");
    expect(check.problems).toContain("Wal of Omens isn't a card Scryfall knows by this name. Check the spelling.");
  });

  it("never replaces a pool card's data or hand script with a fetched one", () => {
    const bolt = cardData('Lightning Bolt');
    addCards([toCard(scry('Lightning Bolt', 'Instant', 'Lightning Bolt deals 9 damage to any target.'))]);
    expect(cardData('Lightning Bolt')).toBe(bolt);
    expect(isFetched('Lightning Bolt')).toBe(false);
  });
});

describe('Commander legality of fetched cards', () => {
  // Real cards with their real Commander legality on Scryfall.
  const CRYPT = scry('Mana Crypt', 'Artifact', '{T}: Add {C}{C}.', { mana_cost: '{0}', cmc: 0, colors: [], color_identity: [], legalities: { commander: 'banned', vintage: 'restricted' } });
  const LOTUS = scry('Mox Lotus', 'Artifact', '{T}: Add {∞}.', { mana_cost: '{15}', cmc: 15, colors: [], color_identity: [], legalities: { commander: 'not_legal' } });
  const PRIMEVAL = scry('Primeval Titan', 'Creature — Giant', 'Trample', { mana_cost: '{4}{G}{G}', cmc: 6, colors: ['G'], color_identity: ['G'], keywords: ['Trample'], legalities: { commander: 'banned' } });
  const black = DECKS.find((d) => d.id === 'black')!;
  /** The black deck with its first card swapped for `name`. */
  const withCard = (name: string): DeckDef => ({ ...black, id: 'pasted-1', cards: [...black.cards.slice(1), name] });
  const asList = (deck: DeckDef) => ['Commander', ...deck.commanders, 'Deck', ...Object.entries(deck.basics).map(([n, k]) => `${k} ${n}`), ...deck.cards].join('\n');

  it("keeps each card's Commander legality from Scryfall's answer", async () => {
    const res = await fetchCollection(['Mana Crypt', 'Wall of Omens', 'Mox Lotus'], { fetch: fakeScryfall([CRYPT, WALL, LOTUS]) });
    expect(res.legality).toEqual({ 'Mana Crypt': 'banned', 'Wall of Omens': 'legal', 'Mox Lotus': 'not_legal' });
    // Never let in unchecked: a card sent without legalities counts as not legal.
    const bare = await fetchCollection(['Wall of Omens'], { fetch: fakeScryfall([{ ...WALL, legalities: undefined }]) });
    expect(bare.legality).toEqual({ 'Wall of Omens': 'not_legal' });
  });

  it('refuses a banned card on the paste screen and in a saved deck, even one the engine could play', async () => {
    await fetchCards(['Mana Crypt'], { fetch: fakeScryfall([CRYPT]) });
    expect(commanderLegality('Mana Crypt')).toBe('banned');
    expect(hasScript('Mana Crypt')).toBe(true);
    const check = checkList(asList(withCard('Mana Crypt')), null, '', 'x');
    expect(check.problems).toEqual(['Mana Crypt: banned in Commander.']);
    expect(check.deck).toBeNull();
    expect(savedDeckIssues(withCard('Mana Crypt'))).toEqual(['Mana Crypt: banned in Commander']);
    // Not worth writing down for scripting.
    expect(requestFor('Mana Crypt')).toBeNull();
  });

  it('refuses a banned commander', async () => {
    await fetchCards(['Primeval Titan'], { fetch: fakeScryfall([PRIMEVAL]) });
    expect(checkList('Commander\n1 Primeval Titan\nDeck\n99 Forest', null, '', 'x').problems).toContain('Primeval Titan: banned in Commander.');
  });

  it('refuses a card that is not legal in Commander at all, such as an Un-set card', async () => {
    await fetchCards(['Mox Lotus'], { fetch: fakeScryfall([LOTUS]) });
    expect(savedDeckIssues(withCard('Mox Lotus'))).toEqual(['Mox Lotus: not legal in Commander']);
  });

  it('takes pool cards as legal: npm run fetch-cards keeps banned cards out of the pool', () => {
    expect(commanderLegality('Sol Ring')).toBe('legal');
    expect(savedDeckIssues(black)).toEqual([]);
  });

  it('fetches again a cached card kept without its legality, and refuses it until then', async () => {
    const cached = toCard(scry('Ornithopter', 'Artifact Creature — Thopter', 'Flying', { mana_cost: '{0}', cmc: 0, colors: [], color_identity: [], keywords: ['Flying'] }));
    const offline = (async () => {
      throw new TypeError('Failed to fetch');
    }) as unknown as typeof fetch;
    expect(await loadFetchedCards({ load: async () => [cached], fetch: offline })).toBe(1);
    expect(commanderLegality('Ornithopter')).toBeNull();
    expect(savedDeckIssues(withCard('Ornithopter'))).toEqual([`Ornithopter: its Commander legality isn't known yet; it is checked once Scryfall can be reached`]);
    const calls: string[][] = [];
    await loadFetchedCards({ load: async () => [cached], fetch: fakeScryfall([scry('Ornithopter', 'Artifact Creature — Thopter', 'Flying', { keywords: ['Flying'] })], calls) });
    expect(calls).toEqual([['Ornithopter']]);
    expect(commanderLegality('Ornithopter')).toBe('legal');
    // A card cached with its legality isn't fetched again.
    calls.length = 0;
    await loadFetchedCards({ load: async () => [{ ...cached, legality: 'banned' } as CardData], fetch: fakeScryfall([], calls) });
    expect(calls).toEqual([]);
    expect(commanderLegality('Ornithopter')).toBe('banned');
  });
});

describe('card requests (docs/card-requests.json)', () => {
  const entry = (name: string, count: number, last: string, clause = 'x'): CardRequest => ({ name, oracleText: 'text', clause, reason: 'no template matches', count, last });

  it('merges a repeat instead of adding it twice: counts add up, the newer clause wins', () => {
    const file = { cards: [entry('A', 2, '2026-01-01', 'old')] };
    const out = mergeRequests(file, [entry('A', 1, '2026-02-01', 'new'), entry('B', 5, '2026-01-15')]);
    expect(out.cards).toEqual([entry('B', 5, '2026-01-15'), entry('A', 3, '2026-02-01', 'new')]);
  });

  it("keeps counts as they are for the parse report, which isn't a new request", () => {
    const out = mergeRequests({ cards: [entry('A', 4, '2026-01-01')] }, [entry('A', 1, '2026-03-01'), entry('B', 1, '2026-03-01')], { count: false });
    expect(out.cards.map((c) => [c.name, c.count])).toEqual([
      ['A', 4],
      ['B', 1],
    ]);
  });

  it('reads a file loosely, dropping broken entries, and takes handled cards out', () => {
    expect(readRequests('not json')).toEqual({ cards: [] });
    const file = readRequests(JSON.stringify({ cards: [entry('A', 1, 'd'), { name: 'B' }] }));
    expect(file.cards.map((c) => c.name)).toEqual(['A']);
    expect(removeRequests(file, ['A'])).toEqual({ cards: [] });
  });
});
