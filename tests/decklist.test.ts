// Pasting a deck list: the parser, matching names to the card pool, the paste screen's
// checks, and which deck each seat plays.
import { describe, expect, it } from 'vitest';
import { DECKS } from '../src/cards/db';
import type { DeckDef } from '../src/cards/db';
import { checkList, listDeck, parseDeckList, poolName, savedDeckIssues } from '../src/cards/decklist';
import { seatDecks } from '../src/ui/store';

/** A deck written out as a plain list: a Commander section, then "1 Name" lines. */
function asList(deck: DeckDef): string {
  const basics = Object.entries(deck.basics).map(([name, n]) => `${n} ${name}`);
  return ['Commander', ...deck.commanders.map((c) => `1 ${c}`), '', 'Deck', ...basics, ...deck.cards.map((c) => `1 ${c}`)].join('\n');
}

const sorted = (a: string[]) => [...a].sort();

describe('reading a pasted deck list', () => {
  it('builds the same deck as decklists.json from each built-in deck written as a list', () => {
    for (const deck of DECKS) {
      const check = checkList(asList(deck), null, '', 'pasted-1');
      expect(check.problems, deck.id).toEqual([]);
      expect(check.deck!.commanders).toEqual(deck.commanders);
      expect(check.deck!.basics).toEqual(deck.basics);
      expect(sorted(check.deck!.cards)).toEqual(sorted(deck.cards));
    }
  });

  it('reads Arena and Moxfield exports: counts, set codes, collector numbers and marks are ignored', () => {
    const list = parseDeckList(
      [
        'About',
        'Name Rats and Bats',
        '',
        'Commander',
        '1 Judith, the Scourge Diva (RNA) 185 *F*',
        '',
        'Deck',
        '1x Sol Ring (C21) 263',
        '17 Swamp',
        "1 Night's Whisper [Draw]",
        '// a comment',
        '# another',
        'Typhoid Rats',
        '',
        'Sideboard',
        '1 Doom Blade',
      ].join('\r\n'),
    );
    expect(list.title).toBe('Rats and Bats');
    expect(list.commanders.map((e) => e.name)).toEqual(['Judith, the Scourge Diva']);
    expect(list.cards.map((e) => [e.name, e.count])).toEqual([
      ['Sol Ring', 1],
      ['Swamp', 17],
      ["Night's Whisper", 1],
      ['Typhoid Rats', 1],
    ]);
  });

  it('finds the commander from a *CMDR* mark, or a one-card sideboard (MTGO-style exports)', () => {
    expect(parseDeckList('1 Sol Ring\n1 Judith, the Scourge Diva *CMDR*').commanders.map((e) => e.name)).toEqual(['Judith, the Scourge Diva']);
    const mtgo = parseDeckList('1 Sol Ring\n\nSIDEBOARD:\n1 Judith, the Scourge Diva');
    expect(mtgo.commanders.map((e) => e.name)).toEqual(['Judith, the Scourge Diva']);
    expect(mtgo.cards.map((e) => e.name)).toEqual(['Sol Ring']);
  });

  it('matches names ignoring case and apostrophe style, and a card with faces by either name', () => {
    expect(poolName('SOL RING')).toBe('Sol Ring');
    expect(poolName('night’s whisper')).toBe("Night's Whisper");
    // Listed by its first face, as decklists.json lists it (712).
    expect(poolName('Birgi, God of Storytelling')).toBe('Birgi, God of Storytelling');
    expect(poolName('birgi, god of storytelling//harnfel, horn of bounty')).toBe('Birgi, God of Storytelling');
    expect(poolName('Black Lotus')).toBeNull();
  });

  it('puts basics in their own list and keeps every copy of other cards, so a second copy is reported (903.5b)', () => {
    const parts = listDeck(parseDeckList('10 Swamp\n2 Sol Ring\n5 swamp'));
    expect(parts.basics).toEqual({ Swamp: 15 });
    expect(parts.cards).toEqual(['Sol Ring', 'Sol Ring']);
  });
});

describe("today's export formats (Moxfield, Archidekt, Arena, MTGO, TappedOut, plain text)", () => {
  const names = (e: { name: string }[]) => e.map((x) => x.name);
  const counts = (e: { name: string; count: number }[]) => e.map((x) => [x.name, x.count]);

  it('reads "x4" after the name, with or without a set code, and "1 x Name"', () => {
    const list = parseDeckList('Sol Ring x1\nSwamp x 30\nTyphoid Rats (M19) 120 x1\n1 x Night\'s Whisper');
    expect(counts(list.cards)).toEqual([
      ['Sol Ring', 1],
      ['Swamp', 30],
      ['Typhoid Rats', 1],
      ["Night's Whisper", 1],
    ]);
  });

  it('reads category headings ("Creatures (12)", "LANDS:", "Instant - 3") as part of the deck', () => {
    const list = parseDeckList('Commander (1)\n1 Judith, the Scourge Diva\n\nCreatures (1)\n1 Typhoid Rats\n\nLANDS:\n17 Swamp\nInstant - 1\n1 Night\'s Whisper\nArtifacts\n1 Sol Ring');
    expect(names(list.commanders)).toEqual(['Judith, the Scourge Diva']);
    expect(names(list.cards)).toEqual(['Typhoid Rats', 'Swamp', "Night's Whisper", 'Sol Ring']);
    expect(list.unreadable).toEqual([]);
  });

  it('reads a "Commander: Name" line, and partners on two lines', () => {
    const one = parseDeckList('Commander: Judith, the Scourge Diva\n1 Sol Ring');
    expect(names(one.commanders)).toEqual(['Judith, the Scourge Diva']);
    expect(names(one.cards)).toEqual(['Sol Ring']);
    const two = parseDeckList("Commander: Kraum, Ludevic's Opus\nCommander: Tymna the Weaver\n1 Sol Ring");
    expect(names(two.commanders)).toEqual(["Kraum, Ludevic's Opus", 'Tymna the Weaver']);
    const section = parseDeckList("Commander\n1 Kraum, Ludevic's Opus (C16) 112\n1 Tymna the Weaver (C16) 48 *F*\n\nDeck\n1 Sol Ring");
    expect(names(section.commanders)).toEqual(["Kraum, Ludevic's Opus", 'Tymna the Weaver']);
  });

  it('reads Archidekt: "[Commander{top}]" is the commander, "{noDeck}" and maybeboard categories are left out', () => {
    const list = parseDeckList(
      [
        '1x Judith, the Scourge Diva (rna) 185 [Commander{top}]',
        '1x Sol Ring (c21) 263 [Ramp,Artifact] ^Have,#37d67a^',
        '1x Doom Blade (m10) 92 [Maybeboard{noDeck}{noPrice},Removal]',
        '1x Typhoid Rats (m19) 120 *F* [Creature]',
        '1x Terror (10e) 182 [Sideboard{noDeck}]',
      ].join('\n'),
    );
    expect(names(list.commanders)).toEqual(['Judith, the Scourge Diva']);
    expect(names(list.cards)).toEqual(['Sol Ring', 'Typhoid Rats']);
  });

  it('reads MTGO and MWS lines: "SB:" is the sideboard, and a one-card sideboard is the commander', () => {
    const list = parseDeckList('1 Sol Ring\n17 Swamp\nSB: 1 Judith, the Scourge Diva');
    expect(names(list.commanders)).toEqual(['Judith, the Scourge Diva']);
    expect(names(list.cards)).toEqual(['Sol Ring', 'Swamp']);
  });

  it('reads TappedOut: "*CMDR*" and "#tags" after the name', () => {
    const list = parseDeckList('1x Judith, the Scourge Diva *CMDR*\n1x Sol Ring #ramp #artifact\n1x Typhoid Rats (M19) *f*');
    expect(names(list.commanders)).toEqual(['Judith, the Scourge Diva']);
    expect(names(list.cards)).toEqual(['Sol Ring', 'Typhoid Rats']);
  });

  it('reads set codes with collector numbers of every shape', () => {
    const list = parseDeckList('1 Sol Ring (PLST) C21-263\n1 Typhoid Rats (M19) 120p\n1 Swamp (SLD) 1234★\n1 Night\'s Whisper (Y24) 7');
    expect(names(list.cards)).toEqual(['Sol Ring', 'Typhoid Rats', 'Swamp', "Night's Whisper"]);
  });

  it("offers the last block of a list with no headings as the commanders, as Moxfield's and MTGO's plain exports put them (903.3)", () => {
    const black = DECKS.find((d) => d.id === 'black')!;
    const body = [...Object.entries(black.basics).map(([n, k]) => `${k} ${n}`), ...black.cards.map((c) => `1 ${c}`)].join('\n');
    const check = checkList(`${body}\n\n1 Judith, the Scourge Diva`, null, '', 'x');
    expect(check.commanders).toEqual(['Judith, the Scourge Diva']);
    expect(check.problems).toEqual([]);
    // A last block that can't lead the deck is just more cards.
    expect(parseDeckList('1 Sol Ring\n\n1 Typhoid Rats').trailing.map((e) => e.name)).toEqual(['Typhoid Rats']);
    expect(checkList('1 Sol Ring\n\n1 Typhoid Rats', null, '', 'x').commanders).toEqual([]);
    // With a heading, the list says where its commanders are.
    expect(parseDeckList('Deck\n1 Sol Ring\n\n1 Judith, the Scourge Diva').trailing).toEqual([]);
  });
});

describe('the paste screen checks', () => {
  const black = DECKS.find((d) => d.id === 'black')!;

  it('lists every card the pool lacks, and every broken deck rule', () => {
    const text = `${asList(black)}\n1 Black Lotus\n1 Sol Ring`;
    const check = checkList(text, null, '', 'x');
    expect(check.deck).toBeNull();
    expect(check.problems).toContain("Black Lotus isn't in the card pool.");
    expect(check.problems).toContain('The deck has more than one Sol Ring.');
    expect(check.problems).toContain('The deck has 101 cards, not 100.');
  });

  it("asks for a commander when the list doesn't name one, and offers its legendary creatures (903.3)", () => {
    const noSection = asList(black).replace('Commander\n', '').replace('\n\nDeck', '');
    const check = checkList(noSection, null, '', 'x');
    expect(check.commanders).toEqual([]);
    expect(check.problems).toEqual(['Pick the commander below.']);
    expect(check.candidates).toEqual(expect.arrayContaining(['Judith, the Scourge Diva', 'Kokusho, the Evening Star']));
    // The picked commander comes out of the 99.
    const picked = checkList(noSection, ['Judith, the Scourge Diva'], '', 'x');
    expect(picked.problems).toEqual([]);
    expect(picked.deck!.cards).not.toContain('Judith, the Scourge Diva');
  });

  it('takes the only legendary creature as the commander when there is one', () => {
    const deck: DeckDef = { ...black, cards: black.cards.filter((c) => !['Kokusho, the Evening Star', 'Torbran, Thane of Red Fell', 'Sheoldred, the Apocalypse'].includes(c)) };
    const check = checkList(asList(deck).replace('Commander\n', '').replace('\n\nDeck', ''), null, '', 'x');
    expect(check.candidates).toEqual(['Judith, the Scourge Diva']);
    expect(check.commanders).toEqual(['Judith, the Scourge Diva']);
  });

  it('names the deck from the screen, else the list, else the commanders', () => {
    expect(checkList(asList(black), null, ' Mine ', 'x').deck!.title).toBe('Mine');
    expect(checkList(`About\nName Theirs\n${asList(black)}`, null, '', 'x').deck!.title).toBe('Theirs');
    expect(checkList(asList(black), null, '', 'x').deck!.title).toBe('Judith, the Scourge Diva');
    expect(checkList(asList(black), null, '', 'x').deck!.pilot).toBe('Judith');
  });

  it("can't play a saved deck whose cards the pool no longer has", () => {
    const deck = { ...black, id: 'pasted-1', cards: [...black.cards.slice(1), 'Black Lotus'] };
    expect(savedDeckIssues(deck)).toEqual(['Black Lotus: not in the card pool']);
    expect(savedDeckIssues(black)).toEqual([]);
  });
});

describe('picking a deck for each seat', () => {
  const pasted: DeckDef = { ...DECKS[1], id: 'pasted-1', title: 'Pasted' };

  it('fills automatic seats with built-in decks no other seat has', () => {
    expect(seatDecks(DECKS[2], [null, null, null], []).map((d) => d.id)).toEqual([DECKS[2].id, DECKS[0].id, DECKS[1].id, DECKS[3].id]);
  });

  it('seats the chosen decks, pasted ones included, and treats a deleted one as automatic', () => {
    const seats = seatDecks(DECKS[0], [pasted.id, null, 'pasted-gone'], [pasted]);
    expect(seats.map((d) => d.id)).toEqual([DECKS[0].id, 'pasted-1', DECKS[1].id, DECKS[2].id]);
  });

  it('seats four bots when watching', () => {
    expect(seatDecks(null, [DECKS[0].id, null, null], []).map((d) => d.id)).toEqual([DECKS[1].id, DECKS[0].id, DECKS[2].id, DECKS[3].id]);
  });
});
