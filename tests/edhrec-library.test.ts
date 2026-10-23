// The library group of EDHREC's most-played cards and commanders: the clauses that could go
// wrong, and the rules they needed (discover, reveal until, entering attacking, cards leaving
// a graveyard, a Saga's final chapter resolving, the first draw of a draw step).
import { produce } from 'immer';
import { describe, expect, it } from 'vitest';
import { problemsOf } from '../src/cards/support';
import { scriptCards } from '../src/cards/oracle';
import { addCounters, applyAction, applyBotAction, botAction, canCast, destroy, draw, enterBattlefield, exileAll, has, label, legalTargets, makeCard, pump, scriptOf, stats } from '../src/engine';
import type { Action, Card, Game, PlayerId, TargetRef } from '../src/engine';
import { byName, emptyGame, put, run, runWith } from './helpers';
import './fixtures';

const PARSED = ['Ureni of the Unwritten', 'Atla Palani, Nest Tender', 'Nekusar, the Mindrazer', 'Xyris, the Writhing Storm', 'Damn'];
const HAND = ['Kaalia of the Vast', 'Teval, the Balanced Scale', "Gishath, Sun's Avatar", 'Choco, Seeker of Paradise', 'Tom Bombadil', 'Pantlaza, Sun-Favored', 'Jodah, the Unifier', "Captain N'ghathrod"];
// The fixtures aren't in the card pool, so the parser reads them as it would a fetched card's.
scriptCards(PARSED);

const pass = { type: 'pass' } as const;
const card = (c: { id: string }): TargetRef => ({ kind: 'card', id: c.id });

/** Replaces a player's library with these cards, the first on top. */
function top(g: Game, pid: PlayerId, names: string[]) {
  g.players[pid].library = names.map((n) => makeCard(g, n, pid, 'library'));
}
const names = (cards: Card[]) => cards.map((c) => c.name);

/**
 * Plays on until `stop` holds: player 0's decisions are answered by `mine` when it gives an
 * action (bots answer the rest, and anything `mine` leaves), and priority is passed otherwise.
 */
function until(g: Game, stop: (g: Game) => boolean, mine: (g: Game) => Action | null = () => null): Game {
  for (let i = 0; i < 400 && !stop(g); i++) {
    const own = g.decision && g.priority === 0 ? mine(g) : null;
    g = own ? run(g, own) : g.decision ? applyBotAction(g, botAction(g, g.priority)) : applyAction(g, pass);
  }
  return g;
}
/** Until player 0 has a decision of this type. */
const decides = (type: string) => (g: Game) => g.priority === 0 && g.decision?.type === type;
/** Until the stack, the waiting triggers and any decision are done. */
const quiet = (g: Game) => !g.stack.length && !g.triggers.length && !g.decision;
/** Player 0 attacks player 1 with these creatures, from the first main phase. */
function attack(g: Game, ...creatures: string[]): Game {
  g = run(g, pass);
  for (const n of creatures) g = run(g, { type: 'declareAttack', card: byName(g, 0, n)!.id, defender: 1 });
  return run(g, pass);
}
/** The cards player 0 is offered in the card choice now, and which can be picked. */
function offered(g: Game): { cards: string[]; pickable: string[] } {
  const d = g.decision;
  if (d?.type !== 'chooseCards' || d.choice.kind !== 'pick') throw new Error(`no pick: ${d?.type}`);
  const byId = (id: string) => g.players.flatMap((p) => [...p.library, ...p.hand, ...p.graveyard, ...p.exile]).find((c) => c.id === id)!.name;
  return { cards: d.choice.cards.map(byId), pickable: (d.choice.pickable ?? d.choice.cards).map(byId) };
}
const pick = (g: Game, ...ids: string[]): Game => run(g, { type: 'chooseCards', cards: ids });
/** `pick`, then stops at the next priority instead of passing on. */
const pickHere = (g: Game, ...ids: string[]): Game => runWith({ autoPass: false }, g, { type: 'chooseCards', cards: ids });

describe('the library group is playable', () => {
  it.each([...PARSED, ...HAND])('%s has no problems', (name) => {
    expect(problemsOf(name)).toEqual([]);
  });
  it('the parser reads the cards it can; hand scripts are the rest', () => {
    for (const n of PARSED) expect(Object.keys(scriptOf(n)).length).toBeGreaterThan(0);
  });
});

describe('Kaalia of the Vast', () => {
  const setup = () =>
    emptyGame((d) => {
      put(d, 0, 'Kaalia of the Vast');
      put(d, 0, 'Shivan Dragon', 'hand');
      put(d, 0, 'Serra Angel', 'hand');
      put(d, 0, 'Elite Vanguard', 'hand');
    });

  it('attacking an opponent: an Angel, Demon or Dragon from the hand enters tapped and attacking that opponent (508.4)', () => {
    let g = until(attack(setup(), 'Kaalia of the Vast'), decides('chooseCards'));
    // Only Angel, Demon or Dragon creature cards are offered.
    expect(offered(g).cards.sort()).toEqual(['Serra Angel', 'Shivan Dragon']);
    g = pickHere(g, byName(g, 0, 'Shivan Dragon', 'hand')!.id);
    const dragon = byName(g, 0, 'Shivan Dragon')!;
    expect(dragon.tapped).toBe(true);
    expect(g.combat!.attacks.find((a) => a.id === dragon.id)).toMatchObject({ defender: 1, target: null });
    // Unblocked, both deal their damage to that opponent: 2 + 5.
    g = until(g, (x) => x.step === 'main2');
    expect(g.players[1].life).toBe(33);
  });

  it('is a "may": choosing none leaves the hand alone', () => {
    let g = until(attack(setup(), 'Kaalia of the Vast'), decides('chooseCards'));
    g = pick(g);
    expect(names(g.players[0].hand).sort()).toEqual(['Elite Vanguard', 'Serra Angel', 'Shivan Dragon']);
  });

  it("doesn't trigger attacking a planeswalker", () => {
    let g = emptyGame((d) => {
      put(d, 0, 'Kaalia of the Vast');
      put(d, 0, 'Shivan Dragon', 'hand');
      put(d, 1, 'Jace Beleren').counters.loyalty = 5;
    });
    g = run(g, pass, { type: 'declareAttack', card: byName(g, 0, 'Kaalia of the Vast')!.id, defender: 1, target: byName(g, 1, 'Jace Beleren')!.id }, pass);
    expect(g.stack.length + g.triggers.length).toBe(0);
    expect(g.decision?.type).not.toBe('chooseCards');
  });

  it("isn't attacking if that opponent has left the game (508.4a)", () => {
    let g = until(attack(setup(), 'Kaalia of the Vast'), decides('chooseCards'));
    g = produce(g, (d) => void (d.players[1].lost = true));
    g = pickHere(g, byName(g, 0, 'Shivan Dragon', 'hand')!.id);
    expect(byName(g, 0, 'Shivan Dragon')).toBeDefined();
    expect(g.combat!.attacks.some((a) => a.id === byName(g, 0, 'Shivan Dragon')!.id)).toBe(false);
  });
});

describe('Teval, the Balanced Scale', () => {
  const zombies = (g: Game, pid: PlayerId = 0) => g.players[pid].battlefield.filter((c) => label(c) === 'Zombie Druid');

  it('mills three, then may return a land card from the graveyard tapped; the land leaving makes a Zombie Druid', () => {
    let g = emptyGame((d) => {
      put(d, 0, 'Teval, the Balanced Scale');
      top(d, 0, ['Forest', 'Shivan Dragon', 'Plains', 'Island', 'Island']);
    });
    g = until(attack(g, 'Teval, the Balanced Scale'), decides('chooseCards'));
    expect(names(g.players[0].graveyard).sort()).toEqual(['Forest', 'Plains', 'Shivan Dragon']);
    // Not a target: the lands in the graveyard as it resolves, the ones just milled among them.
    expect(offered(g).cards.sort()).toEqual(['Forest', 'Plains']);
    g = pick(g, byName(g, 0, 'Forest', 'graveyard')!.id);
    g = until(g, quiet);
    expect(byName(g, 0, 'Forest')!.tapped).toBe(true);
    expect(zombies(g)).toHaveLength(1);
    expect(stats(g, zombies(g)[0])).toMatchObject({ power: 2, toughness: 2 });
  });

  it('makes one token for each event, however many cards leave (603.2c), and only for its own graveyard', () => {
    let g = emptyGame((d) => {
      put(d, 0, 'Teval, the Balanced Scale');
      put(d, 0, 'Plains', 'graveyard', 3);
      put(d, 1, 'Plains', 'graveyard', 2);
    });
    g = produce(g, (d) => void exileAll(d, d.players[0].graveyard.slice(0, 2)));
    g = until(g, quiet);
    expect(zombies(g)).toHaveLength(1);
    g = produce(g, (d) => void exileAll(d, [...d.players[1].graveyard]));
    g = until(g, quiet);
    expect(zombies(g)).toHaveLength(1);
  });

  it('a card cast from the graveyard leaves it too (601.2a)', () => {
    let g = emptyGame((d) => {
      put(d, 0, 'Teval, the Balanced Scale');
      put(d, 0, 'Think Twice', 'graveyard');
      put(d, 0, 'Island', 'battlefield', 3);
    });
    g = run(g, { type: 'cast', card: byName(g, 0, 'Think Twice', 'graveyard')!.id });
    g = until(g, quiet);
    expect(zombies(g)).toHaveLength(1);
  });
});

describe('Ureni of the Unwritten (parsed)', () => {
  it('enters: look at the top eight, may put a Dragon creature card onto the battlefield, the rest on the bottom', () => {
    const lib = ['Elite Vanguard', 'Shivan Dragon', 'Thundermaw Hellkite', 'Plains', 'Plains', 'Plains', 'Plains', 'Plains', 'Island', 'Swamp'];
    let g = emptyGame((d) => {
      put(d, 0, 'Ureni of the Unwritten', 'hand');
      top(d, 0, lib);
    });
    g = produce(g, (d) => enterBattlefield(d, d.players[0].hand[0]));
    g = until(g, decides('chooseCards'));
    expect(offered(g).cards).toEqual(lib.slice(0, 8));
    expect(offered(g).pickable.sort()).toEqual(['Shivan Dragon', 'Thundermaw Hellkite']);
    g = until(pick(g, byName(g, 0, 'Shivan Dragon', 'library')!.id), quiet);
    expect(byName(g, 0, 'Shivan Dragon')).toBeDefined();
    // The seven others went under the two cards that weren't looked at.
    expect(names(g.players[0].library.slice(0, 2))).toEqual(['Island', 'Swamp']);
    expect(names(g.players[0].library.slice(2)).sort()).toEqual(['Elite Vanguard', 'Plains', 'Plains', 'Plains', 'Plains', 'Plains', 'Thundermaw Hellkite']);
  });
});

describe("Gishath, Sun's Avatar", () => {
  it('reveals that many cards, puts any number of Dinosaur creature cards onto the battlefield and the rest on the bottom', () => {
    const lib = ['Colossal Dreadmaw', 'Plains', 'Gigantosaurus', 'Shivan Dragon', 'Plains', 'Charging Monstrosaur', 'Plains', 'Island'];
    let g = emptyGame((d) => {
      put(d, 0, "Gishath, Sun's Avatar");
      top(d, 0, lib);
    });
    g = until(attack(g, "Gishath, Sun's Avatar"), decides('chooseCards'));
    expect(g.players[1].life).toBe(33);
    // Seven damage, seven cards.
    expect(offered(g).cards).toEqual(lib.slice(0, 7));
    expect(offered(g).pickable).toEqual(['Colossal Dreadmaw', 'Gigantosaurus', 'Charging Monstrosaur']);
    g = until(pick(g, byName(g, 0, 'Colossal Dreadmaw', 'library')!.id, byName(g, 0, 'Gigantosaurus', 'library')!.id), quiet);
    expect(byName(g, 0, 'Colossal Dreadmaw')).toBeDefined();
    expect(byName(g, 0, 'Gigantosaurus')).toBeDefined();
    expect(names(g.players[0].library)[0]).toBe('Island');
    expect(names(g.players[0].library.slice(1)).sort()).toEqual(['Charging Monstrosaur', 'Plains', 'Plains', 'Plains', 'Shivan Dragon']);
  });
});

describe('Atla Palani, Nest Tender (parsed)', () => {
  it('makes an Egg; when an Egg dies, reveals until a creature card and puts it onto the battlefield, the rest on the bottom', () => {
    let g = emptyGame((d) => {
      put(d, 0, 'Atla Palani, Nest Tender');
      put(d, 0, 'Plains', 'battlefield', 2);
      top(d, 0, ['Plains', 'Island', 'Serra Angel', 'Swamp']);
    });
    g = until(run(g, { type: 'activate', card: byName(g, 0, 'Atla Palani, Nest Tender')!.id }), quiet);
    const egg = g.players[0].battlefield.find((c) => label(c) === 'Egg')!;
    expect(stats(g, egg)).toMatchObject({ power: 0, toughness: 1 });
    expect(has(g, egg, 'defender')).toBe(true);
    g = until(produce(g, (d) => destroy(d, d.players[0].battlefield.find((c) => label(c) === 'Egg'))), quiet);
    expect(byName(g, 0, 'Serra Angel')).toBeDefined();
    expect(names(g.players[0].library)[0]).toBe('Swamp');
    expect(names(g.players[0].library.slice(1)).sort()).toEqual(['Island', 'Plains']);
  });

  it("doesn't trigger for a creature that isn't an Egg", () => {
    let g = emptyGame((d) => {
      put(d, 0, 'Atla Palani, Nest Tender');
      put(d, 0, 'Elite Vanguard');
      top(d, 0, ['Plains', 'Serra Angel']);
    });
    g = until(produce(g, (d) => destroy(d, byName(d, 0, 'Elite Vanguard'))), quiet);
    expect(byName(g, 0, 'Serra Angel')).toBeUndefined();
    expect(names(g.players[0].library)).toEqual(['Plains', 'Serra Angel']);
  });
});

describe('Choco, Seeker of Paradise', () => {
  const setup = () =>
    emptyGame((d) => {
      put(d, 0, 'Choco, Seeker of Paradise');
      put(d, 0, 'Baleful Strix');
      top(d, 0, ['Forest', 'Shivan Dragon', 'Plains']);
    });

  it('two Birds attack: looks at two, one into the hand, lands onto the battlefield tapped, the rest into the graveyard', () => {
    let g = until(attack(setup(), 'Choco, Seeker of Paradise', 'Baleful Strix'), decides('chooseCards'));
    expect(offered(g).cards).toEqual(['Forest', 'Shivan Dragon']);
    g = pick(g, byName(g, 0, 'Shivan Dragon', 'library')!.id);
    expect(byName(g, 0, 'Shivan Dragon', 'hand')).toBeDefined();
    expect(offered(g).pickable).toEqual(['Forest']);
    g = pickHere(g, byName(g, 0, 'Forest', 'library')!.id);
    expect(byName(g, 0, 'Forest')!.tapped).toBe(true);
    expect(names(g.players[0].library)).toEqual(['Plains']);
    expect(g.players[0].graveyard).toHaveLength(0);
  });

  it('landfall gives Choco +1/+0 until end of turn; the cards not kept go to the graveyard', () => {
    let g = until(attack(setup(), 'Choco, Seeker of Paradise', 'Baleful Strix'), decides('chooseCards'));
    g = pick(g);
    g = pickHere(g, byName(g, 0, 'Forest', 'library')!.id);
    expect(names(g.players[0].graveyard)).toEqual(['Shivan Dragon']);
    g = runWith({ autoPass: false }, g, pass);
    g = until(g, (x) => !x.stack.length && !x.triggers.length && !x.decision);
    expect(stats(g, byName(g, 0, 'Choco, Seeker of Paradise')!).power).toBe(4);
  });
});

describe('Tom Bombadil', () => {
  const sagas = (g: Game) => g.players[0].battlefield.filter((c) => c.name === 'History of Benalia');

  it('has hexproof and indestructible with four or more lore counters among Sagas you control', () => {
    const tom = (lore: number[]) => {
      const g = emptyGame((d) => {
        put(d, 0, 'Tom Bombadil');
        for (const n of lore) put(d, 0, 'History of Benalia').counters.lore = n;
        // An opponent's Saga doesn't count.
        put(d, 1, 'History of Benalia').counters.lore = 2;
      });
      const t = byName(g, 0, 'Tom Bombadil')!;
      return [has(g, t, 'hexproof'), has(g, t, 'indestructible')];
    };
    expect(tom([2, 2])).toEqual([true, true]);
    expect(tom([2, 1])).toEqual([false, false]);
  });

  it("when a Saga's final chapter ability resolves, reveals until a Saga card and puts it onto the battlefield", () => {
    let g = emptyGame((d) => {
      put(d, 0, 'Tom Bombadil');
      put(d, 0, 'History of Benalia').counters.lore = 1;
      top(d, 0, ['Plains', 'History of Benalia', 'Island']);
    });
    // Chapter II isn't the final chapter.
    g = until(produce(g, (d) => addCounters(d, byName(d, 0, 'History of Benalia'), 1, 'lore', { by: 'rule' })), quiet);
    expect(names(g.players[0].library)).toEqual(['Plains', 'History of Benalia', 'Island']);
    // Chapter III is: the Saga from the library enters, the Plains goes to the bottom.
    g = until(produce(g, (d) => addCounters(d, byName(d, 0, 'History of Benalia'), 1, 'lore', { by: 'rule' })), quiet);
    expect(sagas(g)).toHaveLength(1);
    expect(sagas(g)[0].counters.lore).toBe(1);
    expect(names(g.players[0].library)).toEqual(['Island', 'Plains']);
  });

  it('triggers only once each turn', () => {
    let g = emptyGame((d) => {
      put(d, 0, 'Tom Bombadil');
      put(d, 0, 'History of Benalia').counters.lore = 2;
      put(d, 0, 'History of Benalia').counters.lore = 2;
      top(d, 0, ['History of Benalia', 'History of Benalia', 'Plains']);
    });
    g = until(
      produce(g, (d) => d.players[0].battlefield.filter((c) => c.name === 'History of Benalia').forEach((c) => addCounters(d, c, 1, 'lore', { by: 'rule' }))),
      quiet,
    );
    // Both old Sagas were sacrificed; only one came from the library.
    expect(sagas(g)).toHaveLength(1);
    expect(names(g.players[0].library)).toEqual(['History of Benalia', 'Plains']);
  });
});

describe('Pantlaza, Sun-Favored', () => {
  const setup = () =>
    emptyGame((d) => {
      put(d, 0, 'Pantlaza, Sun-Favored', 'hand');
      put(d, 0, 'Colossal Dreadmaw', 'hand');
      top(d, 0, ['Plains', 'Colossal Dreadmaw', 'Elite Vanguard', 'Island']);
    });
  const enter = (g: Game, name: string) => produce(g, (d) => enterBattlefield(d, byName(d, 0, name, 'hand')!));

  it("may discover X, X its toughness (701.57a): the card not cast goes into the hand, the rest on the bottom", () => {
    let g = until(enter(setup(), 'Pantlaza, Sun-Favored'), decides('ask'));
    expect(g.decision).toMatchObject({ choice: { yes: 'Discover 4' } });
    g = until(run(g, { type: 'answer', yes: true }), decides('cast'));
    // Discover 4 passes over the land and the mana value 6 card.
    expect(names(g.players[0].exile)).toEqual(['Plains', 'Colossal Dreadmaw', 'Elite Vanguard']);
    g = until(run(g, { type: 'answer', yes: false }), quiet);
    expect(byName(g, 0, 'Elite Vanguard', 'hand')).toBeDefined();
    expect(g.players[0].exile).toHaveLength(0);
    expect(names(g.players[0].library)[0]).toBe('Island');
    expect(names(g.players[0].library.slice(1)).sort()).toEqual(['Colossal Dreadmaw', 'Plains']);
    // Done once this turn: another Dinosaur entering doesn't trigger it (603.2h).
    g = until(enter(g, 'Colossal Dreadmaw'), quiet);
    expect(g.log.filter((l) => l.text.includes('Pantlaza, Sun-Favored triggers'))).toHaveLength(1);
  });

  it('casts the discovered card without paying its mana cost', () => {
    let g = until(enter(setup(), 'Pantlaza, Sun-Favored'), decides('ask'));
    g = until(run(g, { type: 'answer', yes: true }), decides('cast'));
    g = until(run(g, { type: 'cast', card: byName(g, 0, 'Elite Vanguard', 'exile')!.id }), quiet);
    expect(byName(g, 0, 'Elite Vanguard')).toBeDefined();
  });

  it('finding no card, the exiled cards go back on the bottom in a random order', () => {
    let g = until(enter(setup(), 'Pantlaza, Sun-Favored'), decides('ask'));
    g = produce(g, (d) => top(d, 0, ['Plains', 'Colossal Dreadmaw']));
    g = until(run(g, { type: 'answer', yes: true }), quiet);
    expect(g.players[0].exile).toHaveLength(0);
    expect(names(g.players[0].library).sort()).toEqual(['Colossal Dreadmaw', 'Plains']);
  });

  it('declining leaves it for the next Dinosaur this turn', () => {
    let g = until(enter(setup(), 'Pantlaza, Sun-Favored'), decides('ask'));
    g = until(run(g, { type: 'answer', yes: false }), quiet);
    expect(g.players[0].exile).toHaveLength(0);
    g = until(enter(g, 'Colossal Dreadmaw'), decides('ask'));
    // The Dreadmaw's toughness is 6.
    expect(g.decision).toMatchObject({ choice: { yes: 'Discover 6' } });
  });
});

describe('Jodah, the Unifier', () => {
  it('legendary creatures you control get +X/+X, X the number of legendary creatures you control', () => {
    const g = emptyGame((d) => {
      put(d, 0, 'Jodah, the Unifier');
      put(d, 0, 'Lyra Dawnbringer');
      put(d, 0, 'Elite Vanguard');
      put(d, 1, 'Sheoldred, the Apocalypse');
    });
    expect(stats(g, byName(g, 0, 'Jodah, the Unifier')!)).toMatchObject({ power: 7, toughness: 7 });
    expect(stats(g, byName(g, 0, 'Lyra Dawnbringer')!)).toMatchObject({ power: 7, toughness: 7 });
    expect(stats(g, byName(g, 0, 'Elite Vanguard')!)).toMatchObject({ power: 2, toughness: 1 });
    expect(stats(g, byName(g, 1, 'Sheoldred, the Apocalypse')!)).toMatchObject({ power: 4, toughness: 5 });
  });

  const setup = () =>
    emptyGame((d) => {
      put(d, 0, 'Jodah, the Unifier');
      put(d, 0, 'Swamp', 'battlefield', 6);
      put(d, 0, 'Kokusho, the Evening Star', 'hand');
      top(d, 0, ['Plains', 'Shivan Dragon', 'Sheoldred, the Apocalypse', 'Island']);
    });

  it('a legendary spell cast from the hand: exile until a legendary nonland card with lesser mana value, cast it free', () => {
    let g = until(run(setup(), { type: 'cast', card: byName(setup(), 0, 'Kokusho, the Evening Star', 'hand')!.id }), decides('cast'));
    expect(names(g.players[0].exile)).toEqual(['Plains', 'Shivan Dragon', 'Sheoldred, the Apocalypse']);
    g = until(run(g, { type: 'cast', card: byName(g, 0, 'Sheoldred, the Apocalypse', 'exile')!.id }), quiet);
    expect(byName(g, 0, 'Sheoldred, the Apocalypse')).toBeDefined();
    expect(byName(g, 0, 'Kokusho, the Evening Star')).toBeDefined();
    expect(names(g.players[0].library)[0]).toBe('Island');
    expect(names(g.players[0].library.slice(1)).sort()).toEqual(['Plains', 'Shivan Dragon']);
  });

  it("a card not cast stays in exile and can't be cast later; only the rest go on the bottom (Jodah's rulings)", () => {
    let g = until(run(setup(), { type: 'cast', card: byName(setup(), 0, 'Kokusho, the Evening Star', 'hand')!.id }), decides('cast'));
    g = until(run(g, { type: 'answer', yes: false }), quiet);
    expect(names(g.players[0].exile)).toEqual(['Sheoldred, the Apocalypse']);
    expect(names(g.players[0].library)[0]).toBe('Island');
    expect(names(g.players[0].library.slice(1)).sort()).toEqual(['Plains', 'Shivan Dragon']);
    expect(canCast(g, 0, byName(g, 0, 'Sheoldred, the Apocalypse', 'exile')!)).toBe(false);
  });

  it('with no legendary nonland card of lesser mana value, the whole library is exiled and becomes the library again', () => {
    let g = emptyGame((d) => {
      put(d, 0, 'Jodah, the Unifier');
      put(d, 0, 'Swamp', 'battlefield', 6);
      put(d, 0, 'Kokusho, the Evening Star', 'hand');
      // The only legendary card has the same mana value (6), not lesser.
      top(d, 0, ['Plains', 'Shivan Dragon', 'Kokusho, the Evening Star', 'Island']);
    });
    g = until(run(g, { type: 'cast', card: byName(g, 0, 'Kokusho, the Evening Star', 'hand')!.id }), quiet);
    expect(g.players[0].exile).toHaveLength(0);
    expect(names(g.players[0].library).sort()).toEqual(['Island', 'Kokusho, the Evening Star', 'Plains', 'Shivan Dragon']);
  });

  it("doesn't trigger for a legendary spell cast from the command zone", () => {
    let g = emptyGame((d) => {
      put(d, 0, 'Jodah, the Unifier');
      put(d, 0, 'Plains', 'battlefield', 5);
    });
    g = runWith({ autoPass: false }, g, { type: 'cast', card: g.players[0].command[0].id });
    expect(g.stack).toHaveLength(1);
    expect(g.triggers).toHaveLength(0);
  });
});

/** A game at the start of player 1's upkeep, with these permanents for player 0. */
const opponentsUpkeep = (...mine: string[]) =>
  emptyGame((d) => {
    for (const n of mine) put(d, 0, n);
    d.active = 1;
    d.priority = 1;
    d.step = 'upkeep';
  });
const theirMain = (g: Game) => g.active === 1 && g.step === 'main1' && quiet(g);

describe('Nekusar, the Mindrazer (parsed)', () => {
  it("each player draws an additional card in their draw step (504.2), and an opponent's draws each deal 1 damage", () => {
    const g = until(opponentsUpkeep('Nekusar, the Mindrazer'), theirMain);
    expect(g.players[1].hand).toHaveLength(2);
    expect(g.players[1].life).toBe(38);
  });

  it("doesn't damage its controller for their own draws", () => {
    let g = emptyGame((d) => {
      put(d, 0, 'Nekusar, the Mindrazer');
      d.step = 'upkeep';
    });
    g = until(g, (x) => x.step === 'main1' && quiet(x));
    expect(g.players[0].hand).toHaveLength(2);
    expect(g.players[0].life).toBe(40);
  });
});

describe('Xyris, the Writhing Storm (parsed)', () => {
  const snakes = (g: Game) => g.players[0].battlefield.filter((c) => label(c) === 'Snake');

  it("the first card an opponent draws in their draw step makes no Snake; every other card they draw does", () => {
    let g = until(opponentsUpkeep('Xyris, the Writhing Storm'), theirMain);
    expect(snakes(g)).toHaveLength(0);
    // With Nekusar, the draw step's second card makes one.
    g = until(opponentsUpkeep('Xyris, the Writhing Storm', 'Nekusar, the Mindrazer'), theirMain);
    expect(snakes(g)).toHaveLength(1);
    expect(stats(g, snakes(g)[0])).toMatchObject({ power: 1, toughness: 1 });
    // Outside a draw step, every card.
    g = until(produce(g, (d) => draw(d, 1, 2)), quiet);
    expect(snakes(g)).toHaveLength(3);
    // Its controller's own draws make none.
    g = until(produce(g, (d) => draw(d, 0, 1)), quiet);
    expect(snakes(g)).toHaveLength(3);
  });

  it('combat damage to a player: you and that player each draw that many cards (121.2c)', () => {
    let g = emptyGame((d) => {
      put(d, 0, 'Xyris, the Writhing Storm');
    });
    g = until(attack(g, 'Xyris, the Writhing Storm'), (x) => x.step === 'main2' && quiet(x));
    expect(g.players[1].life).toBe(37);
    expect(g.players[0].hand).toHaveLength(3);
    expect(g.players[1].hand).toHaveLength(3);
    // Those were draws outside their draw step: a Snake for each of player 1's.
    expect(snakes(g)).toHaveLength(3);
  });
});

describe("Captain N'ghathrod", () => {
  it('Horrors you control have menace', () => {
    const g = emptyGame((d) => {
      put(d, 0, "Captain N'ghathrod");
      put(d, 0, 'Ravenous Chupacabra');
      put(d, 0, 'Elite Vanguard');
      put(d, 1, 'Ravenous Chupacabra');
    });
    expect(has(g, byName(g, 0, "Captain N'ghathrod")!, 'menace')).toBe(true);
    expect(has(g, byName(g, 0, 'Ravenous Chupacabra')!, 'menace')).toBe(true);
    expect(has(g, byName(g, 0, 'Elite Vanguard')!, 'menace')).toBe(false);
    expect(has(g, byName(g, 1, 'Ravenous Chupacabra')!, 'menace')).toBe(false);
  });

  it("a Horror's combat damage mills that many; at your end step, an artifact or creature card milled this turn comes over", () => {
    let g = emptyGame((d) => {
      put(d, 0, "Captain N'ghathrod");
      put(d, 0, 'Ravenous Chupacabra');
      top(d, 1, ['Serra Angel', 'Sol Ring', 'Plains', 'Island', 'Island']);
      // Already there before this turn, and put there from a hand: not from their library this turn.
      put(d, 1, 'Shivan Dragon', 'graveyard');
      put(d, 1, 'Elite Vanguard', 'graveyard').arrived = { from: 'hand', turn: d.turn };
    });
    g = until(attack(g, 'Ravenous Chupacabra'), (x) => x.step === 'main2' && quiet(x));
    // The Chupacabra's 2 combat damage mills two: the Serra Angel and the Sol Ring.
    expect(names(g.players[1].graveyard).sort()).toEqual(['Elite Vanguard', 'Serra Angel', 'Shivan Dragon', 'Sol Ring']);
    g = until(g, decides('targets'));
    const d = g.decision as Extract<Game['decision'], { type: 'targets' }>;
    const spec = scriptOf("Captain N'ghathrod").onEndStep as { targets: Parameters<typeof legalTargets>[2][] };
    const legal = legalTargets(g, 0, spec.targets[0], d.item.card).map((t) => names([g.players[1].graveyard.find((c) => c.id === t.id)!])[0]);
    expect(legal.sort()).toEqual(['Serra Angel', 'Sol Ring']);
    g = until(run(g, { type: 'chooseTargets', targets: [card(byName(g, 1, 'Serra Angel', 'graveyard')!)] }), quiet);
    expect(byName(g, 0, 'Serra Angel')).toBeDefined();
    expect(byName(g, 0, 'Serra Angel')!.owner).toBe(1);
  });
});

describe('Damn (parsed)', () => {
  it('destroys target creature, or every creature for its overload cost (702.96b)', () => {
    let g = emptyGame((d) => {
      put(d, 0, 'Damn', 'hand');
      put(d, 0, 'Swamp', 'battlefield', 2);
      put(d, 0, 'Elite Vanguard');
      put(d, 1, 'Serra Angel');
    });
    g = until(run(g, { type: 'cast', card: byName(g, 0, 'Damn', 'hand')!.id, targets: [card(byName(g, 1, 'Serra Angel')!)] }), quiet);
    expect(byName(g, 1, 'Serra Angel')).toBeUndefined();
    expect(byName(g, 0, 'Elite Vanguard')).toBeDefined();
    g = emptyGame((d) => {
      put(d, 0, 'Damn', 'hand');
      put(d, 0, 'Plains', 'battlefield', 4);
      put(d, 0, 'Elite Vanguard');
      put(d, 1, 'Serra Angel');
    });
    g = until(run(g, { type: 'cast', card: byName(g, 0, 'Damn', 'hand')!.id, alt: 0 }), quiet);
    expect(byName(g, 1, 'Serra Angel')).toBeUndefined();
    expect(byName(g, 0, 'Elite Vanguard')).toBeUndefined();
  });
});

describe('abilities about a permanent that has left use it as it last was (608.2h)', () => {
  it("Pantlaza: X is the toughness of a Dinosaur that died before the ability resolved, as it last was", () => {
    let g = emptyGame((d) => {
      put(d, 0, 'Pantlaza, Sun-Favored');
      put(d, 0, 'Colossal Dreadmaw', 'hand');
    });
    // It enters, and gets +2/+2 and dies while the ability waits.
    g = produce(g, (d) => {
      enterBattlefield(d, byName(d, 0, 'Colossal Dreadmaw', 'hand')!);
      pump(d, byName(d, 0, 'Colossal Dreadmaw'), 2, 2);
      destroy(d, byName(d, 0, 'Colossal Dreadmaw'));
    });
    g = until(g, decides('ask'));
    expect(g.decision).toMatchObject({ choice: { yes: 'Discover 8' } });
  });
});
