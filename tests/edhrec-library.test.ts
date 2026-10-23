// The library group of EDHREC's most-played cards and commanders: the clauses that could go
// wrong, and the rules they needed (discover, reveal until, entering attacking, cards leaving
// a graveyard, a Saga's final chapter resolving, the first draw of a draw step).
import { produce } from 'immer';
import { describe, expect, it } from 'vitest';
import { problemsOf } from '../src/cards/support';
import { scriptCards } from '../src/cards/oracle';
import { addCounters, applyAction, applyBotAction, botAction, destroy, draw, enterBattlefield, exileAll, has, label, legalTargets, makeCard, scriptOf, stats } from '../src/engine';
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
