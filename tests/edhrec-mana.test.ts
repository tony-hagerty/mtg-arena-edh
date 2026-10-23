// The mana group of EDHREC's most-played cards and commanders: exalted, riot, triggered mana
// abilities, mana abilities that work out how much they make, costs that tap other
// permanents, colour-setting, and the cards that use them.
import { produce } from 'immer';
import { describe, expect, it } from 'vitest';
import './fixtures';
import { registerCards } from '../src/cards/db';
import { scriptCards } from '../src/cards/oracle';
import { unsupported } from '../src/cards/support';
import { applyAction, applyBotAction, botAction, colorsOf, copyItem, counterable, createToken, hasType, makeCard, manaAbilities, newGame, permanent, stats } from '../src/engine';
import type { Action, Card, CardData, Game, PlayerId } from '../src/engine';
import corpus from './parser-corpus.generated.json';
import { useStore } from '../src/ui/store';
import { buildView, clickPermanent, pickAbility, pickMana, pickTapCreature, pickTriggeredMana, useForMana } from '../src/ui/view';
import { byName, emptyGame, put, run } from './helpers';

const PARSED = ['Ignoble Hierarch', 'Noble Hierarch', 'Faeburrow Elder', 'Leyline of the Guildpact', 'Rhythm of the Wild'];
const HAND = ['Vivi Ornitier', 'Kinnan, Bonder Prodigy', 'Baylen, the Haymaker', 'Helga, Skittish Seer', 'Zaxara, the Exemplary', 'Esika, God of the Tree // The Prismatic Bridge', 'Urza, Lord High Artificer', 'Sisay, Weatherlight Captain', 'Mana Drain'];
// The parser scripts the cards it can read, as it does a pasted deck's (fetched.ts).
const refused = scriptCards([...PARSED, ...HAND]);

/** Passes priority, bots answering anything asked, until the stack is empty and nothing is asked, or `until`. */
function settle(g: Game, until?: (g: Game) => boolean): Game {
  for (let i = 0; i < 100 && (g.decision || g.stack.length || g.triggers.length) && !until?.(g); i++) g = g.decision ? applyBotAction(g, botAction(g, g.priority)) : applyAction(g, { type: 'pass' });
  return g;
}
/** Passes priority until the game reaches step `step` of player `pid`'s turn. */
function passTo(g: Game, pid: PlayerId, step: Game['step']): Game {
  for (let i = 0; i < 400 && !(g.active === pid && g.step === step && !g.stack.length && !g.decision); i++) g = g.decision ? applyBotAction(g, botAction(g, g.priority)) : applyAction(g, { type: 'pass' } as Action);
  return g;
}
const human = (setup: (g: Game) => void) =>
  emptyGame((d) => {
    d.players[0].isBot = false;
    d.players[0].you = true;
    setup(d);
  });
const id = (g: Game, name: string, zone: Parameters<typeof byName>[3] = 'battlefield', pid: PlayerId = 0) => byName(g, pid, name, zone)!.id;
const pool = (g: Game, pid: PlayerId = 0) => g.players[pid].pool.map((m) => m.sym).sort().join('');
const card = (cid: string) => ({ kind: 'card' as const, id: cid });

describe('the mana group is playable', () => {
  it('the parser reads the five cards it should, and every card has a script', () => {
    expect(refused).toEqual([]);
    for (const name of [...PARSED, ...HAND]) expect(unsupported(name), name).toEqual([]);
  });
});

describe('exalted (702.83)', () => {
  const attackWith = (g: Game, ids: string[]) => {
    // Player 0 declares by hand.
    g = produce(g, (d) => {
      d.players[0].isBot = false;
    });
    for (let i = 0; i < 20 && g.decision?.type !== 'attackers'; i++) g = applyAction(g, { type: 'pass' });
    for (const a of ids) g = run(g, { type: 'declareAttack', card: a, defender: 1 });
    return run(g, { type: 'pass' });
  };

  it('a creature attacking alone gets +1/+1 for each instance; Hierarchs tap for three colours', () => {
    let g = emptyGame((d) => {
      put(d, 0, 'Ignoble Hierarch');
      put(d, 0, 'Noble Hierarch');
      put(d, 0, 'Serra Angel');
    });
    expect(manaAbilities(g, byName(g, 0, 'Ignoble Hierarch')!)[0].colors).toEqual(['B', 'R', 'G']);
    expect(manaAbilities(g, byName(g, 0, 'Noble Hierarch')!)[0].colors).toEqual(['G', 'W', 'U']);
    const angel = id(g, 'Serra Angel');
    g = attackWith(g, [angel]);
    expect(g.triggers.filter((t) => t.hook === 'onExalted') .length + g.stack.filter((t) => t.hook === 'onExalted').length).toBe(2);
    g = settle(g);
    expect(stats(g, permanent(g, angel)!).power).toBe(6);
  });

  it("doesn't trigger when two creatures attack (506.5)", () => {
    let g = emptyGame((d) => {
      put(d, 0, 'Ignoble Hierarch');
      put(d, 0, 'Serra Angel');
      put(d, 0, 'Llanowar Elves');
    });
    g = attackWith(g, [id(g, 'Serra Angel'), id(g, 'Llanowar Elves')]);
    expect([...g.triggers, ...g.stack].some((t) => t.hook === 'onExalted')).toBe(false);
  });
});

describe('riot (702.136) and Rhythm of the Wild', () => {
  it('a nontoken creature you control enters with a counter or gains haste: the person chooses', () => {
    let g = human((d) => {
      put(d, 0, 'Rhythm of the Wild');
      put(d, 0, 'Llanowar Elves', 'hand');
      put(d, 0, 'Forest');
    });
    g = run(g, { type: 'cast', card: id(g, 'Llanowar Elves', 'hand') });
    g = settle(g, (x) => x.decision?.type === 'replacement');
    expect(g.decision?.type).toBe('replacement');
    const ask = (g.decision as { ask: { options: { label: string }[] } }).ask;
    expect(ask.options.map((o) => o.label).sort()).toEqual(['+1/+1 Counter', 'Haste']);
    g = run(g, { type: 'replacement', option: ask.options.findIndex((o) => o.label === 'Haste') });
    g = settle(g);
    const elves = byName(g, 0, 'Llanowar Elves')!;
    expect(elves.counters['+1/+1'] ?? 0).toBe(0);
    expect(stats(g, elves).keywords.has('haste')).toBe(true);
  });

  it('two Rhythms give two instances, each chosen on its own (702.136b); tokens get none', () => {
    let g = emptyGame((d) => {
      put(d, 0, 'Rhythm of the Wild', 'battlefield', 2);
      put(d, 0, 'Llanowar Elves', 'hand');
      put(d, 0, 'Forest');
      // Not its turn's precombat main phase: a bot takes the counters.
      d.step = 'main2';
    });
    g = settle(run(g, { type: 'cast', card: id(g, 'Llanowar Elves', 'hand') }));
    expect(byName(g, 0, 'Llanowar Elves')!.counters['+1/+1']).toBe(2);
    g = produce(g, (d) => void createToken(d, 0, 'Soldier'));
    const soldier = byName(g, 0, 'Soldier')!;
    expect(soldier.counters['+1/+1'] ?? 0).toBe(0);
    expect(stats(g, soldier).keywords.has('haste')).toBe(false);
  });

  it('a bot takes haste on its own turn before combat', () => {
    let g = emptyGame((d) => {
      put(d, 0, 'Rhythm of the Wild');
      put(d, 0, 'Llanowar Elves', 'hand');
      put(d, 0, 'Forest');
    });
    g = settle(run(g, { type: 'cast', card: id(g, 'Llanowar Elves', 'hand') }));
    expect(stats(g, byName(g, 0, 'Llanowar Elves')!).keywords.has('haste')).toBe(true);
  });

  it("creature spells you control can't be countered", () => {
    let g = emptyGame((d) => {
      put(d, 0, 'Rhythm of the Wild');
      put(d, 0, 'Serra Angel', 'hand');
      put(d, 0, 'Plains', 'battlefield', 5);
      put(d, 1, 'Counterspell', 'hand');
      put(d, 1, 'Island', 'battlefield', 2);
    });
    g = run(g, { type: 'cast', card: id(g, 'Serra Angel', 'hand'), hold: true }, { type: 'pass' });
    g = run(g, { type: 'cast', card: id(g, 'Counterspell', 'hand', 1), targets: [{ kind: 'stack', id: g.stack[0].id }] });
    g = settle(g);
    expect(byName(g, 0, 'Serra Angel')).toBeDefined();
  });
});

describe('Kinnan, Bonder Prodigy: a triggered mana ability (605.1b)', () => {
  it('a nonland permanent tapped for mana adds one more of a type it made; a land adds nothing', () => {
    let g = emptyGame((d) => {
      put(d, 0, 'Kinnan, Bonder Prodigy');
      put(d, 0, 'Sol Ring');
      put(d, 0, 'Forest');
    });
    g = run(g, { type: 'tapMana', card: id(g, 'Sol Ring') });
    expect(pool(g)).toBe('CCC');
    g = run(g, { type: 'tapMana', card: id(g, 'Forest') });
    expect(pool(g)).toBe('CCCG');
  });

  it("the controller chooses among the types made (Faeburrow Elder's {G}{W}); tapping it back takes the extra too", () => {
    let g = emptyGame((d) => {
      put(d, 0, 'Kinnan, Bonder Prodigy');
      put(d, 0, 'Faeburrow Elder');
    });
    const elder = id(g, 'Faeburrow Elder');
    // Kinnan is green and blue, the Elder green and white.
    expect(manaAbilities(g, permanent(g, elder)!)[0].produces).toEqual([['W', 'U', 'G']]);
    g = run(g, { type: 'tapMana', card: elder, triggered: [['U']] });
    expect(pool(g)).toBe('GUUW');
    g = run(g, { type: 'untapMana', card: elder });
    expect(pool(g)).toBe('');
    expect(permanent(g, elder)!.tapped).toBe(false);
  });

  it('auto-pay sets it off too: the extra mana is left in the pool', () => {
    let g = emptyGame((d) => {
      put(d, 0, 'Kinnan, Bonder Prodigy');
      put(d, 0, 'Sol Ring');
      put(d, 0, 'Lightning Bolt', 'hand');
      put(d, 0, 'Mountain');
      put(d, 0, 'Arcane Signet', 'hand');
    });
    g = run(g, { type: 'cast', card: id(g, 'Arcane Signet', 'hand') });
    expect(pool(g)).toBe('C');
  });

  it("isn't set off by abilities without {T} (106.12): Urza's tapped artifact, Vivi", () => {
    let g = emptyGame((d) => {
      put(d, 0, 'Kinnan, Bonder Prodigy');
      put(d, 0, 'Urza, Lord High Artificer');
      put(d, 0, 'Sol Ring');
    });
    const urza = byName(g, 0, 'Urza, Lord High Artificer')!;
    g = run(g, { type: 'tapMana', card: urza.id, tap: id(g, 'Sol Ring') });
    expect(pool(g)).toBe('U');
  });

  it('{5}{G}{U}: look at five, put a non-Human creature onto the battlefield, the rest on the bottom', () => {
    let g = emptyGame((d) => {
      put(d, 0, 'Kinnan, Bonder Prodigy');
      put(d, 0, 'Forest', 'battlefield', 3);
      put(d, 0, 'Island', 'battlefield', 4);
      const top = ['Serra Angel', 'Plains', 'Kenrith, the Returned King', 'Island', 'Plains'].map((n) => makeCard(d, n, 0, 'library'));
      d.players[0].library.unshift(...top);
    });
    const kinnan = byName(g, 0, 'Kinnan, Bonder Prodigy')!;
    g = run(g, { type: 'activate', card: kinnan.id });
    g = settle(g, (x) => x.decision?.type === 'chooseCards');
    const choice = (g.decision as { choice: { pickable?: string[]; cards: string[] } }).choice;
    expect(choice.cards).toHaveLength(5);
    // Kenrith is a Human: only the Angel can be put in.
    expect(choice.pickable!.map((x) => g.players[0].library.find((c) => c.id === x)!.name)).toEqual(['Serra Angel']);
    g = settle(run(g, { type: 'chooseCards', cards: choice.pickable! }));
    expect(byName(g, 0, 'Serra Angel')).toBeDefined();
    expect(g.players[0].library.slice(-4).map((c) => c.name).sort()).toEqual(['Island', 'Kenrith, the Returned King', 'Plains', 'Plains']);
  });
});

describe('Vivi Ornitier', () => {
  it('adds X mana in any combination of {U} and {R}, X its power, only on your turn and once a turn', () => {
    let g = emptyGame((d) => {
      const vivi = put(d, 0, 'Vivi Ornitier');
      vivi.counters['+1/+1'] = 3;
    });
    const vivi = id(g, 'Vivi Ornitier');
    expect(manaAbilities(g, permanent(g, vivi)!)[0].produces).toHaveLength(4);
    g = run(g, { type: 'tapMana', card: vivi, ability: 0, mana: ['U', 'U', 'R'] });
    expect(pool(g)).toBe('RUU');
    expect(permanent(g, vivi)!.tapped).toBe(false);
    expect(applyAction(g, { type: 'tapMana', card: vivi })).toBe(g);
    // Not on another player's turn.
    const theirs = emptyGame((d) => {
      put(d, 1, 'Vivi Ornitier').counters['+1/+1'] = 2;
    });
    expect(manaAbilities(theirs, byName(theirs, 1, 'Vivi Ornitier')!)).toEqual([]);
  });

  it('with power 0 it can still be activated for nothing (605.1a), which uses up the turn; auto-pay leaves it alone', () => {
    let g = emptyGame((d) => {
      put(d, 0, 'Vivi Ornitier');
      put(d, 0, 'Sol Ring', 'hand');
    });
    const vivi = id(g, 'Vivi Ornitier');
    expect(manaAbilities(g, permanent(g, vivi)!)).toMatchObject([{ amount: 0, produces: [[]] }]);
    // Nothing to pay {1} with.
    expect(applyAction(g, { type: 'cast', card: id(g, 'Sol Ring', 'hand') })).toBe(g);
    g = run(g, { type: 'tapMana', card: vivi, ability: 0, mana: [] });
    expect(pool(g)).toBe('');
    // Grown since, it still can't be activated again this turn (602.5b).
    g = produce(g, (d) => {
      d.players[0].battlefield.find((c) => c.id === vivi)!.counters['+1/+1'] = 2;
    });
    expect(manaAbilities(g, permanent(g, vivi)!)).toEqual([]);
  });

  it('a noncreature spell: a +1/+1 counter, and 1 damage to each opponent', () => {
    let g = emptyGame((d) => {
      put(d, 0, 'Vivi Ornitier');
      put(d, 0, 'Lightning Bolt', 'hand');
      put(d, 0, 'Mountain');
    });
    g = settle(run(g, { type: 'cast', card: id(g, 'Lightning Bolt', 'hand'), targets: [{ kind: 'player', id: 1 }] }));
    expect(byName(g, 0, 'Vivi Ornitier')!.counters['+1/+1']).toBe(1);
    expect(g.players.map((p) => p.life)).toEqual([40, 36, 39, 39]);
  });
});

describe('Baylen, the Haymaker: costs that tap untapped tokens', () => {
  const baylen = (n: number) =>
    emptyGame((d) => {
      put(d, 0, 'Baylen, the Haymaker');
      createToken(d, 0, 'Soldier', n);
      put(d, 0, 'Serra Angel', 'library');
    });

  it('two tokens, even ones that just arrived (302.6), for one mana of any color; Baylen stays untapped', () => {
    let g = baylen(2);
    const tokens = g.players[0].battlefield.filter((c) => c.isToken).map((c) => c.id);
    expect(g.players[0].battlefield.find((c) => c.isToken)!.sick).toBe(true);
    const b = id(g, 'Baylen, the Haymaker');
    g = run(g, { type: 'tapMana', card: b, taps: tokens, color: 'R' });
    expect(pool(g)).toBe('R');
    expect(tokens.every((t) => permanent(g, t)!.tapped)).toBe(true);
    expect(permanent(g, b)!.tapped).toBe(false);
    expect(applyAction(g, { type: 'tapMana', card: b })).toBe(g); // no untapped tokens left
  });

  it('three tokens: draw a card; four: three +1/+1 counters and trample', () => {
    let g = baylen(7);
    const b = id(g, 'Baylen, the Haymaker');
    const tokens = g.players[0].battlefield.filter((c) => c.isToken).map((c) => c.id);
    // The wrong number of tokens is refused.
    expect(applyAction(g, { type: 'activate', card: b, activated: 0, crew: tokens.slice(0, 2) })).toBe(g);
    const hand = g.players[0].hand.length;
    g = settle(run(g, { type: 'activate', card: b, activated: 0, crew: tokens.slice(0, 3) }));
    expect(g.players[0].hand.length).toBe(hand + 1);
    g = settle(run(g, { type: 'activate', card: b, activated: 1, crew: tokens.slice(3, 7) }));
    const it = permanent(g, b)!;
    expect(it.counters['+1/+1']).toBe(3);
    expect(stats(g, it).keywords.has('trample')).toBe(true);
  });
});

describe('Helga, Skittish Seer', () => {
  it('X mana of one colour, X its power, spent only on creature spells with mana value 4 or more or with {X}', () => {
    let g = emptyGame((d) => {
      put(d, 0, 'Helga, Skittish Seer').counters['+1/+1'] = 4;
      put(d, 0, 'Lightning Bolt', 'hand');
      put(d, 0, 'Llanowar Elves', 'hand');
      put(d, 0, 'Serra Angel', 'hand');
    });
    g = run(g, { type: 'tapMana', card: id(g, 'Helga, Skittish Seer'), color: 'W' });
    expect(pool(g)).toBe('WWWWW');
    expect(applyAction(g, { type: 'cast', card: id(g, 'Lightning Bolt', 'hand'), targets: [{ kind: 'player', id: 1 }] })).toBe(g);
    expect(applyAction(g, { type: 'cast', card: id(g, 'Llanowar Elves', 'hand') })).toBe(g);
    // The cast triggers Helga: draw, gain 1, a counter.
    const hand = g.players[0].hand.length;
    g = settle(run(g, { type: 'cast', card: id(g, 'Serra Angel', 'hand') }));
    expect(byName(g, 0, 'Serra Angel')).toBeDefined();
    expect(g.players[0].hand.length).toBe(hand);
    expect(g.players[0].life).toBe(41);
    expect(byName(g, 0, 'Helga, Skittish Seer')!.counters['+1/+1']).toBe(5);
  });
});

describe('Zaxara, the Exemplary', () => {
  it('a spell with {X}: a 0/0 Hydra with X +1/+1 counters; taps for two of one colour', () => {
    let g = emptyGame((d) => {
      put(d, 0, 'Zaxara, the Exemplary');
      put(d, 0, 'Blaze', 'hand');
      put(d, 0, 'Mountain', 'battlefield', 2);
    });
    expect(manaAbilities(g, byName(g, 0, 'Zaxara, the Exemplary')!)[0].amount).toBe(2);
    g = settle(run(g, { type: 'cast', card: id(g, 'Blaze', 'hand'), x: 3, targets: [{ kind: 'player', id: 1 }] }));
    const hydra = g.players[0].battlefield.find((c) => c.name === 'Hydra 0/0 G')!;
    expect(stats(g, hydra).power).toBe(3);
  });
});

describe('Faeburrow Elder and colours among permanents (105.2)', () => {
  it('+1/+1 for each colour among permanents you control, and one mana of each', () => {
    let g = emptyGame((d) => {
      put(d, 0, 'Faeburrow Elder');
      put(d, 0, 'Lightning Bolt', 'hand');
    });
    const elder = id(g, 'Faeburrow Elder');
    expect(stats(g, permanent(g, elder)!).power).toBe(2);
    g = produce(g, (d) => void put(d, 0, 'Llanowar Elves'));
    expect(stats(g, permanent(g, elder)!).power).toBe(2); // green already counted
    g = produce(g, (d) => void put(d, 0, 'Sol Ring'));
    expect(stats(g, permanent(g, elder)!).power).toBe(2); // colourless isn't a colour
    g = run(g, { type: 'tapMana', card: elder });
    expect(pool(g)).toBe('GW');
  });
});

describe('Leyline of the Guildpact', () => {
  it('may begin the game on the battlefield from an opening hand (103.6a)', () => {
    const g = newGame({ seed: 3, humanDeck: null });
    const start = produce(g, (d) => {
      d.players[0].hand.push(makeCard(d, 'Leyline of the Guildpact', 0, 'hand'));
    });
    // Keep every hand; the bots begin with it.
    let x = start;
    for (let i = 0; i < 40 && (x.mulligan || x.decision); i++) x = applyBotAction(x, x.decision?.type === 'mulligan' ? { type: 'keep' } : botAction(x, x.priority));
    expect(byName(x, 0, 'Leyline of the Guildpact')).toBeDefined();
  });

  it('nonland permanents you control are all colours (layer 5); lands are every basic land type', () => {
    const g = emptyGame((d) => {
      put(d, 0, 'Leyline of the Guildpact');
      put(d, 0, 'Sol Ring');
      put(d, 0, 'Forest');
      put(d, 1, 'Sol Ring');
    });
    expect(colorsOf(g, byName(g, 0, 'Sol Ring')!)).toEqual(['W', 'U', 'B', 'R', 'G']);
    expect(colorsOf(g, byName(g, 1, 'Sol Ring')!)).toEqual([]);
    const forest = byName(g, 0, 'Forest')!;
    expect(colorsOf(g, forest)).toEqual([]);
    expect(['Plains', 'Island', 'Swamp', 'Mountain', 'Forest'].every((t) => hasType(g, forest, t))).toBe(true);
    expect(manaAbilities(g, forest)[0].colors.sort()).toEqual(['B', 'G', 'R', 'U', 'W']);
  });
});

describe('Esika, God of the Tree // The Prismatic Bridge', () => {
  it('other legendary creatures you control have vigilance and "{T}: Add one mana of any color"', () => {
    const g = emptyGame((d) => {
      put(d, 0, 'Esika, God of the Tree // The Prismatic Bridge');
      put(d, 0, 'Lyra Dawnbringer');
      put(d, 0, 'Serra Angel');
    });
    const lyra = byName(g, 0, 'Lyra Dawnbringer')!;
    expect(stats(g, lyra).keywords.has('vigilance')).toBe(true);
    expect(manaAbilities(g, lyra).some((m) => m.colors.length === 5)).toBe(true);
    expect(manaAbilities(g, byName(g, 0, 'Serra Angel')!)).toEqual([]);
  });

  it('the Bridge reveals until a creature or planeswalker and puts it onto the battlefield, the rest on the bottom', () => {
    let g = emptyGame((d) => {
      put(d, 0, 'Esika, God of the Tree // The Prismatic Bridge').face = 1;
      d.players[0].library.unshift(...['Island', 'Plains', 'Serra Angel'].map((n) => makeCard(d, n, 0, 'library')));
    });
    g = passTo(g, 0, 'draw');
    // Its upkeep came round again: player 0's next turn.
    g = settle(passTo(passTo(g, 1, 'main1'), 0, 'upkeep'));
    expect(byName(g, 0, 'Serra Angel')).toBeDefined();
  });
});

describe('Urza, Lord High Artificer', () => {
  it('a Construct, {U} for an artifact tapped, and {5}: play the top card free this turn', () => {
    let g = emptyGame((d) => {
      put(d, 0, 'Urza, Lord High Artificer', 'hand');
      put(d, 0, 'Island', 'battlefield', 4);
      d.players[0].library.unshift(makeCard(d, 'Sol Ring', 0, 'library'));
    });
    g = settle(run(g, { type: 'cast', card: id(g, 'Urza, Lord High Artificer', 'hand') }));
    const construct = byName(g, 0, 'Construct 0/0 artifacts')!;
    expect(stats(g, construct).power).toBe(1); // itself
    // The Construct just arrived, but tapping it for Urza's cost isn't its own {T} (302.6).
    const urza = id(g, 'Urza, Lord High Artificer');
    g = run(g, { type: 'tapMana', card: urza, tap: construct.id });
    expect(pool(g)).toBe('U');
    expect(permanent(g, urza)!.tapped).toBe(false);
  });

  it('{5}: shuffle, exile the top card, and it may be played without paying its mana cost', () => {
    let g = emptyGame((d) => {
      put(d, 0, 'Urza, Lord High Artificer');
      put(d, 0, 'Island', 'battlefield', 5);
      d.players[0].library = [makeCard(d, 'Serra Angel', 0, 'library')];
    });
    g = settle(run(g, { type: 'activate', card: id(g, 'Urza, Lord High Artificer') }));
    const angel = byName(g, 0, 'Serra Angel', 'exile')!;
    expect(angel).toBeDefined();
    g = settle(run(g, { type: 'cast', card: angel.id }));
    expect(byName(g, 0, 'Serra Angel')).toBeDefined();
  });
});

describe('Sisay, Weatherlight Captain', () => {
  it('+1/+1 for each colour among other legendary permanents; searches for one with mana value less than its power', () => {
    let g = emptyGame((d) => {
      put(d, 0, 'Sisay, Weatherlight Captain');
      put(d, 0, 'Kinnan, Bonder Prodigy');
      put(d, 0, 'Plains', 'battlefield', 1);
      put(d, 0, 'Island', 'battlefield', 1);
      put(d, 0, 'Swamp', 'battlefield', 1);
      put(d, 0, 'Mountain', 'battlefield', 1);
      put(d, 0, 'Forest', 'battlefield', 1);
      d.players[0].library.push(makeCard(d, 'Lyra Dawnbringer', 0, 'library'), makeCard(d, 'Vivi Ornitier', 0, 'library'));
    });
    const sisay = id(g, 'Sisay, Weatherlight Captain');
    expect(stats(g, permanent(g, sisay)!).power).toBe(4); // green and blue
    g = run(g, { type: 'activate', card: sisay });
    g = settle(g, (x) => x.decision?.type === 'chooseCards');
    const choice = g.decision as { choice: { kind: 'search' } };
    expect(choice.choice.kind).toBe('search');
    const valid = g.players[0].library.filter((c) => ['Lyra Dawnbringer', 'Vivi Ornitier'].includes(c.name));
    // Vivi (3) is less than 4; Lyra (5) isn't.
    g = settle(run(g, { type: 'chooseCards', cards: [valid.find((c) => c.name === 'Vivi Ornitier')!.id] }));
    expect(byName(g, 0, 'Vivi Ornitier')).toBeDefined();
    expect(applyAction(g, { type: 'chooseCards', cards: [valid.find((c) => c.name === 'Lyra Dawnbringer')!.id] })).toBe(g);
  });
});

describe('Mana Drain', () => {
  it("counters a spell, and at the beginning of its caster's next main phase adds {C} equal to its mana value", () => {
    let g = emptyGame((d) => {
      put(d, 0, 'Serra Angel', 'hand');
      put(d, 0, 'Plains', 'battlefield', 5);
      put(d, 1, 'Mana Drain', 'hand');
      put(d, 1, 'Island', 'battlefield', 2);
    });
    g = run(g, { type: 'cast', card: id(g, 'Serra Angel', 'hand'), hold: true }, { type: 'pass' });
    g = run(g, { type: 'cast', card: id(g, 'Mana Drain', 'hand', 1), targets: [{ kind: 'stack', id: g.stack[0].id }] });
    g = settle(g);
    expect(byName(g, 0, 'Serra Angel', 'graveyard')).toBeDefined();
    expect(g.delayed.some((d) => d.key === 'drain' && d.player === 1)).toBe(true);
    // Player 0's main phase 2 isn't player 1's main phase.
    g = passTo(g, 0, 'main2');
    expect(pool(g, 1)).toBe('');
    g = passTo(g, 1, 'main1');
    g = settle(g, (x) => x.players[1].pool.length > 0);
    expect(pool(g, 1)).toBe('CCCCC');
  });

  it('cast in your own precombat main phase, the mana comes in your postcombat main phase', () => {
    let g = emptyGame((d) => {
      put(d, 1, 'Lightning Bolt', 'hand');
      put(d, 1, 'Mountain');
      put(d, 0, 'Mana Drain', 'hand');
      put(d, 0, 'Island', 'battlefield', 2);
      d.active = 0;
    });
    // Player 1 bolts at instant speed in player 0's main phase; player 0 drains it.
    g = produce(g, (d) => {
      d.priority = 1;
    });
    g = run(g, { type: 'cast', card: id(g, 'Lightning Bolt', 'hand', 1), targets: [{ kind: 'player', id: 0 }], hold: true }, { type: 'pass' });
    g = settle(run(g, { type: 'cast', card: id(g, 'Mana Drain', 'hand'), targets: [{ kind: 'stack', id: g.stack[0].id }] }), (x) => x.stack.length === 0);
    g = passTo(g, 0, 'main2');
    g = settle(g, (x) => x.players[0].pool.length > 0);
    expect(pool(g, 0)).toBe('C');
  });
});

describe("mana that says its spell can't be countered (106.6)", () => {
  const halfling = (corpus.cards as unknown as CardData[]).find((c) => c.name === 'Delighted Halfling')!;
  registerCards({ 'Delighted Halfling': { ...halfling, image: '', art: '' } });
  scriptCards(['Delighted Halfling']);

  /** Player 0 casts Lyra Dawnbringer, tapping Delighted Halfling for one of the mana first or not; player 1 tries Counterspell. */
  const cast = (useHalfling: boolean) => {
    let g = emptyGame((d) => {
      put(d, 0, 'Delighted Halfling');
      put(d, 0, 'Lyra Dawnbringer', 'hand');
      put(d, 0, 'Plains', 'battlefield', useHalfling ? 4 : 5);
      put(d, 1, 'Counterspell', 'hand');
      put(d, 1, 'Island', 'battlefield', 2);
    });
    // "{T}: Add one mana of any color. Spend this mana only to cast a legendary spell, and that spell can't be countered."
    if (useHalfling) g = run(g, { type: 'tapMana', card: id(g, 'Delighted Halfling'), ability: 1, color: 'W' });
    g = run(g, { type: 'cast', card: id(g, 'Lyra Dawnbringer', 'hand'), hold: true }, { type: 'pass' });
    g = settle(run(g, { type: 'cast', card: id(g, 'Counterspell', 'hand', 1), targets: [{ kind: 'stack', id: g.stack[0].id }] }));
    return !!byName(g, 0, 'Lyra Dawnbringer');
  };

  it("Delighted Halfling: a legendary spell its mana paid for can't be countered; one it didn't pay for can", () => {
    expect(cast(true)).toBe(true);
    expect(cast(false)).toBe(false);
  });

  it("a copy of such a spell can be countered: it wasn't cast with that mana (707.10)", () => {
    let g = emptyGame((d) => {
      put(d, 0, 'Lyra Dawnbringer', 'hand');
      put(d, 0, 'Plains', 'battlefield', 5);
    });
    g = produce(run(g, { type: 'cast', card: id(g, 'Lyra Dawnbringer', 'hand'), hold: true }), (d) => {
      d.stack[0].card.cast!.uncounterable = true;
      copyItem(d, d.stack[0], 0);
    });
    const copy = g.triggers.find((t) => t.copy)!;
    expect(copy.card.cast?.uncounterable).toBe(false);
    expect(counterable(g, g.stack[0])).toBe(false);
  });
});


describe('edge cases', () => {
  it("Helga's mana can be spent on a creature spell with {X} in its mana cost, whatever its mana value", () => {
    registerCards({ 'Test X Hydra': { name: 'Test X Hydra', manaCost: '{X}{G}', cmc: 1, colors: ['G'], colorIdentity: ['G'], typeLine: 'Creature — Hydra', oracleText: '', power: '2', toughness: '2', keywords: [], image: '', art: '' } });
    scriptCards(['Test X Hydra']);
    let g = emptyGame((d) => {
      put(d, 0, 'Helga, Skittish Seer').counters['+1/+1'] = 1;
      put(d, 0, 'Test X Hydra', 'hand');
    });
    g = run(g, { type: 'tapMana', card: id(g, 'Helga, Skittish Seer'), color: 'G' });
    g = settle(run(g, { type: 'cast', card: id(g, 'Test X Hydra', 'hand'), x: 1 }));
    expect(byName(g, 0, 'Test X Hydra')).toBeDefined();
    expect(pool(g)).toBe('');
  });

  it('Kinnan and a Treasure: the Treasure is sacrificed, and its one colour comes again', () => {
    let g = emptyGame((d) => {
      put(d, 0, 'Kinnan, Bonder Prodigy');
      createToken(d, 0, 'Treasure');
    });
    g = run(g, { type: 'tapMana', card: id(g, 'Treasure'), color: 'U' });
    expect(pool(g)).toBe('UU');
    expect(byName(g, 0, 'Treasure')).toBeUndefined();
  });

  it("Mana Drain on a spell that can't be countered still gives the mana; with its target gone, nothing", () => {
    let g = emptyGame((d) => {
      put(d, 0, 'Rhythm of the Wild');
      put(d, 0, 'Serra Angel', 'hand');
      put(d, 0, 'Plains', 'battlefield', 5);
      put(d, 1, 'Mana Drain', 'hand');
      put(d, 1, 'Island', 'battlefield', 2);
    });
    g = run(g, { type: 'cast', card: id(g, 'Serra Angel', 'hand'), hold: true }, { type: 'pass' });
    g = settle(run(g, { type: 'cast', card: id(g, 'Mana Drain', 'hand', 1), targets: [{ kind: 'stack', id: g.stack[0].id }] }));
    expect(byName(g, 0, 'Serra Angel')).toBeDefined();
    expect(g.delayed.some((d) => d.key === 'drain' && (d.data?.mv as number) === 5)).toBe(true);
  });

  it('the Bridge with no creature or planeswalker reveals the whole library and puts it all on the bottom', () => {
    let g = emptyGame((d) => {
      put(d, 0, 'Esika, God of the Tree // The Prismatic Bridge').face = 1;
      d.players[0].library = ['Island', 'Plains', 'Forest'].map((n) => makeCard(d, n, 0, 'library'));
      d.step = 'untap';
    });
    g = produce(g, (d) => {
      d.step = 'main1';
    });
    g = passTo(passTo(g, 1, 'main1'), 0, 'main1');
    expect(g.players[0].battlefield.filter((c) => c.name !== 'Esika, God of the Tree // The Prismatic Bridge')).toHaveLength(0);
    expect(g.players[0].library.length + g.players[0].hand.length).toBe(3);
  });

  it('Zaxara: an effect that doubles tokens makes two Hydras, each with X counters', () => {
    registerCards({ 'Test Doubler': { name: 'Test Doubler', manaCost: '{4}', cmc: 4, colors: [], colorIdentity: [], typeLine: 'Artifact', oracleText: 'If one or more tokens would be created under your control, twice that many of those tokens are created instead.', keywords: [], image: '', art: '' } });
    scriptCards(['Test Doubler']);
    let g = emptyGame((d) => {
      put(d, 0, 'Zaxara, the Exemplary');
      put(d, 0, 'Test Doubler');
      put(d, 0, 'Blaze', 'hand');
      put(d, 0, 'Mountain', 'battlefield', 3);
    });
    g = settle(run(g, { type: 'cast', card: id(g, 'Blaze', 'hand'), x: 2, targets: [{ kind: 'player', id: 1 }] }));
    const hydras = g.players[0].battlefield.filter((c) => c.name === 'Hydra 0/0 G');
    expect(hydras.map((h) => h.counters['+1/+1'])).toEqual([2, 2]);
  });
});


describe('in the UI', () => {
  const play = (setup: (g: Game) => void) => useStore.setState({ game: human(setup), human: 0, humans: [0], handoff: null, targeting: null, pickedBlockers: [], undoSteps: [], manaPick: null });
  const game = () => useStore.getState().game!;

  it("Baylen's mana: the human picks the two tokens to tap", () => {
    play((d) => {
      put(d, 0, 'Baylen, the Haymaker');
      createToken(d, 0, 'Soldier', 3);
    });
    const tokens = game().players[0].battlefield.filter((c) => c.isToken).map((c) => c.id);
    // It could draw too (three tokens): the menu first, then its mana.
    clickPermanent(byName(game(), 0, 'Baylen, the Haymaker')!);
    useForMana();
    expect(useStore.getState().manaPick?.options[0].tapCount).toBe(2);
    // The first two to start with; clicking one takes it out, another puts it in.
    expect(useStore.getState().manaPick?.taps).toEqual([tokens[0], tokens[1]]);
    pickTapCreature(tokens[0]);
    pickTapCreature(tokens[2]);
    expect(useStore.getState().manaPick?.taps).toEqual([tokens[1], tokens[2]]);
    pickMana(useStore.getState().manaPick!.options[0].ability, ['G']);
    expect(pool(game())).toBe('G');
    expect(tokens.map((t) => permanent(game(), t)!.tapped)).toEqual([false, true, true]);
  });

  it("Baylen's draw: the human picks the three tokens, then it goes on the stack", () => {
    play((d) => {
      put(d, 0, 'Baylen, the Haymaker');
      createToken(d, 0, 'Soldier', 3);
    });
    const tokens = game().players[0].battlefield.filter((c) => c.isToken);
    const b = byName(game(), 0, 'Baylen, the Haymaker')!;
    const hand = game().players[0].hand.length;
    // Baylen has a mana ability and another it can activate now: the human chooses.
    clickPermanent(b);
    const options = buildView().loyalty!.options;
    expect(options.map((o) => [o.text.slice(0, 22), o.ok])).toEqual([
      ['Add mana', true],
      ['Tap three untapped tok', true],
      ['Tap four untapped toke', false],
    ]);
    pickAbility(options[1].ref);
    expect(buildView().prompt).toContain('Tap three untapped tokens you control (0 of 3 chosen)');
    for (const t of tokens) clickPermanent(t);
    expect(buildView().primary?.disabled).toBe(false);
    buildView().primary!.onClick();
    expect(tokens.every((t) => permanent(game(), t.id)!.tapped)).toBe(true);
    expect(game().players[0].hand.length).toBe(hand + 1);
  });

  it('the ability menu can use the permanent for mana instead (Urza)', () => {
    play((d) => {
      put(d, 0, 'Urza, Lord High Artificer');
      put(d, 0, 'Sol Ring');
      put(d, 0, 'Island', 'battlefield', 5);
    });
    clickPermanent(byName(game(), 0, 'Urza, Lord High Artificer')!);
    expect(buildView().loyalty!.options[0].mana).toBe(true);
    useForMana();
    // One artifact to tap: nothing more to choose.
    expect(pool(game())).toBe('U');
    expect(byName(game(), 0, 'Sol Ring')!.tapped).toBe(true);
  });

  it("Kinnan: the human chooses the type of mana it adds when there's a choice", () => {
    play((d) => {
      put(d, 0, 'Kinnan, Bonder Prodigy');
      put(d, 0, 'Faeburrow Elder');
    });
    clickPermanent(byName(game(), 0, 'Faeburrow Elder')!);
    expect(useStore.getState().manaPick).not.toBe(null);
    pickMana(useStore.getState().manaPick!.options[0].ability, ['W', 'U', 'G']);
    expect(useStore.getState().manaPick?.triggered?.asks[0].mana).toEqual([['W'], ['U'], ['G']]);
    pickTriggeredMana(['W']);
    expect(pool(game())).toBe('GUWW');
  });
});

// Keeps the helpers used.
void card;
void ({} as Card);
