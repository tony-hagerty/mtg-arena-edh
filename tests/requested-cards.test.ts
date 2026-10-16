// Hand scripts for cards players asked for (docs/card-requests.json): the clauses that could
// go wrong. Their data is in tests/fixtures.generated.json (tests/fixture-cards.json).
import { describe, expect, it } from 'vitest';
import { applyAction, applyBotAction, botAction, canCast, castCost, choiceOptions, flashGranted, maxHandSize, maxX, stats } from '../src/engine';
import type { Action, CardChoice, Game, PlayerId, TargetRef } from '../src/engine';
import { scriptCards } from '../src/cards/oracle';
import './fixtures';
import { byName, emptyGame, put, run } from './helpers';

const player = (id: PlayerId): TargetRef => ({ kind: 'player', id });
const card = (id: string): TargetRef => ({ kind: 'card', id });
const stackTop = (g: Game): TargetRef => ({ kind: 'stack', id: g.stack[g.stack.length - 1].id });

/** Passes priority (bots answering anything asked) until the stack is empty and nothing is being decided. */
function settle(g: Game, human?: (g: Game) => Action | null): Game {
  for (let i = 0; i < 60 && (g.decision || g.stack.length); i++) {
    const mine = human && g.priority === 0 && g.decision ? human(g) : null;
    g = mine ? run(g, mine) : g.decision ? applyBotAction(g, botAction(g, g.priority)) : applyAction(g, { type: 'pass' });
  }
  return g;
}

/** A game where player 0 is a person, so their choices wait for an answer. */
const humanGame = (setup: (g: Game) => void) =>
  emptyGame((d) => {
    d.players[0].isBot = false;
    d.players[0].you = true;
    setup(d);
  });

describe('requested counterspells', () => {
  it('Render Silent: its controller can\'t cast spells this turn, even if it can\'t be countered', () => {
    let g = emptyGame((d) => {
      put(d, 1, 'Render Silent', 'hand');
      put(d, 1, 'Island', 'battlefield', 3);
      put(d, 1, 'Plains', 'battlefield', 1);
      put(d, 0, 'Lightning Bolt', 'hand', 2);
      put(d, 0, 'Mountain', 'battlefield', 2);
    });
    g = run(g, { type: 'cast', card: byName(g, 0, 'Lightning Bolt', 'hand')!.id, targets: [player(1)], hold: true });
    g = run(g, { type: 'pass' });
    expect(g.priority).toBe(1);
    g = run(g, { type: 'cast', card: byName(g, 1, 'Render Silent', 'hand')!.id, targets: [stackTop(g)] });
    g = settle(g);
    expect(g.players[1].life).toBe(40);
    expect(g.effects).toContainEqual({ kind: 'cantCast', player: 0 });
  });

  it('Spell Swindle: X Treasures for the countered spell\'s mana value, X included (202.3e)', () => {
    let g = emptyGame((d) => {
      put(d, 1, 'Spell Swindle', 'hand');
      put(d, 1, 'Island', 'battlefield', 6);
      put(d, 0, 'Blaze', 'hand');
      put(d, 0, 'Mountain', 'battlefield', 4);
    });
    g = run(g, { type: 'cast', card: byName(g, 0, 'Blaze', 'hand')!.id, x: 3, targets: [player(1)], hold: true }, { type: 'pass' });
    g = run(g, { type: 'cast', card: byName(g, 1, 'Spell Swindle', 'hand')!.id, targets: [stackTop(g)] });
    g = settle(g);
    expect(g.players[1].battlefield.filter((c) => c.name === 'Treasure')).toHaveLength(4);
    expect(g.players[1].life).toBe(40);
  });

  it('Reprieve returns the spell to its owner\'s hand and draws a card', () => {
    let g = emptyGame((d) => {
      put(d, 1, 'Reprieve', 'hand');
      put(d, 1, 'Plains', 'battlefield', 2);
      put(d, 0, 'Lightning Bolt', 'hand');
      put(d, 0, 'Mountain');
    });
    const hand = g.players[1].hand.length;
    g = run(g, { type: 'cast', card: byName(g, 0, 'Lightning Bolt', 'hand')!.id, targets: [player(1)], hold: true }, { type: 'pass' });
    g = run(g, { type: 'cast', card: byName(g, 1, 'Reprieve', 'hand')!.id, targets: [stackTop(g)] });
    g = settle(g);
    expect(byName(g, 0, 'Lightning Bolt', 'hand')).toBeDefined();
    expect(g.players[1].life).toBe(40);
    expect(g.players[1].hand.length).toBe(hand); // Reprieve left, a card came in
  });
});

describe('requested removal', () => {
  it('Snuff Out: 4 life instead of its mana cost only with a Swamp (118.9), and not on a black creature', () => {
    const g = emptyGame((d) => {
      put(d, 0, 'Snuff Out', 'hand');
      put(d, 1, 'Serra Angel');
      put(d, 1, 'Typhoid Rats');
    });
    const snuff = () => byName(g, 0, 'Snuff Out', 'hand')!;
    expect(applyAction(g, { type: 'cast', card: snuff().id, alt: 0, targets: [card(byName(g, 1, 'Serra Angel')!.id)] })).toBe(g);
    const withSwamp = emptyGame((d) => {
      put(d, 0, 'Snuff Out', 'hand');
      put(d, 0, 'Swamp');
      put(d, 1, 'Serra Angel');
      put(d, 1, 'Typhoid Rats');
    });
    const s = byName(withSwamp, 0, 'Snuff Out', 'hand')!;
    expect(applyAction(withSwamp, { type: 'cast', card: s.id, alt: 0, targets: [card(byName(withSwamp, 1, 'Typhoid Rats')!.id)] })).toBe(withSwamp);
    let h = run(withSwamp, { type: 'cast', card: s.id, alt: 0, targets: [card(byName(withSwamp, 1, 'Serra Angel')!.id)] });
    expect(h.players[0].life).toBe(36);
    expect(byName(h, 0, 'Swamp')!.tapped).toBe(false);
    h = settle(h);
    expect(byName(h, 1, 'Serra Angel')).toBeUndefined();
  });

  it('Baleful Mastery: an opponent draws a card only if the {1}{B} cost was paid', () => {
    const play = (alt: number | undefined) => {
      let g = humanGame((d) => {
        put(d, 0, 'Baleful Mastery', 'hand');
        put(d, 0, 'Swamp', 'battlefield', 4);
        put(d, 1, 'Serra Angel');
      });
      const hands = g.players.map((p) => p.hand.length);
      g = run(g, { type: 'cast', card: byName(g, 0, 'Baleful Mastery', 'hand')!.id, alt, targets: [card(byName(g, 1, 'Serra Angel')!.id)] });
      g = settle(g, (h) => (h.decision?.type === 'player' ? { type: 'choosePlayer', player: 2 } : null));
      return { angel: !!byName(g, 1, 'Serra Angel'), exiled: !!byName(g, 1, 'Serra Angel', 'exile'), drew: g.players.map((p, i) => p.hand.length - hands[i]) };
    };
    expect(play(0)).toEqual({ angel: false, exiled: true, drew: [-1, 0, 1, 0] });
    expect(play(undefined)).toEqual({ angel: false, exiled: true, drew: [-1, 0, 0, 0] });
  });

  it('The Battle of Bywater destroys power 3 or greater, then makes Food for each creature you control', () => {
    let g = emptyGame((d) => {
      put(d, 0, 'The Battle of Bywater', 'hand');
      put(d, 0, 'Plains', 'battlefield', 4);
      put(d, 0, 'Elite Vanguard', 'battlefield', 2);
      put(d, 0, 'Serra Angel');
      put(d, 1, 'Serra Angel');
    });
    g = settle(run(g, { type: 'cast', card: byName(g, 0, 'The Battle of Bywater', 'hand')!.id }));
    expect(g.players.flatMap((p) => p.battlefield).filter((c) => c.name === 'Serra Angel')).toHaveLength(0);
    expect(g.players[0].battlefield.filter((c) => c.name === 'Food')).toHaveLength(2);
  });

  it('Exsanguinate: you gain the life the opponents actually lost', () => {
    let g = emptyGame((d) => {
      put(d, 0, 'Exsanguinate', 'hand');
      put(d, 0, 'Swamp', 'battlefield', 5);
      d.players[3].lost = true;
    });
    g = settle(run(g, { type: 'cast', card: byName(g, 0, 'Exsanguinate', 'hand')!.id, x: 3 }));
    expect(g.players.map((p) => p.life)).toEqual([46, 37, 37, 40]);
  });

  it('Rakdos Charm: each creature deals 1 damage to its controller', () => {
    let g = emptyGame((d) => {
      put(d, 0, 'Rakdos Charm', 'hand');
      put(d, 0, 'Swamp');
      put(d, 0, 'Mountain');
      put(d, 1, 'Elite Vanguard', 'battlefield', 3);
      put(d, 2, 'Serra Angel');
    });
    g = settle(run(g, { type: 'cast', card: byName(g, 0, 'Rakdos Charm', 'hand')!.id, modes: [2] }));
    expect(g.players.map((p) => p.life)).toEqual([40, 37, 39, 40]);
  });
});

describe('requested graveyard cards', () => {
  it('Reanimate: from any graveyard, under your control, losing its mana value', () => {
    let g = emptyGame((d) => {
      put(d, 0, 'Reanimate', 'hand');
      put(d, 0, 'Swamp');
      put(d, 1, 'Serra Angel', 'graveyard');
    });
    g = settle(run(g, { type: 'cast', card: byName(g, 0, 'Reanimate', 'hand')!.id, targets: [card(byName(g, 1, 'Serra Angel', 'graveyard')!.id)] }));
    expect(byName(g, 0, 'Serra Angel')).toBeDefined();
    expect(g.players[0].life).toBe(35);
  });

  it('Academy Ruins puts an artifact card from your graveyard on top of your library', () => {
    let g = emptyGame((d) => {
      put(d, 0, 'Academy Ruins');
      put(d, 0, 'Island', 'battlefield', 2);
      put(d, 0, 'Sol Ring', 'graveyard');
    });
    g = settle(run(g, { type: 'activate', card: byName(g, 0, 'Academy Ruins')!.id, targets: [card(byName(g, 0, 'Sol Ring', 'graveyard')!.id)] }));
    expect(g.players[0].library[0].name).toBe('Sol Ring');
  });

  it('Takenuma: mill three, then return a creature card, cheaper for each legendary creature', () => {
    let g = humanGame((d) => {
      put(d, 0, 'Takenuma, Abandoned Mire', 'hand');
      put(d, 0, 'Swamp', 'battlefield', 3);
      put(d, 0, 'Lyra Dawnbringer');
      put(d, 0, 'Serra Angel', 'graveyard');
    });
    const ab = { type: 'activate' as const, card: byName(g, 0, 'Takenuma, Abandoned Mire', 'hand')!.id };
    g = run(g, ab);
    g = settle(g, (h) => (h.decision?.type === 'chooseCards' ? { type: 'chooseCards', cards: [byName(h, 0, 'Serra Angel', 'graveyard')!.id] } : null));
    expect(byName(g, 0, 'Serra Angel', 'hand')).toBeDefined();
    expect(byName(g, 0, 'Takenuma, Abandoned Mire', 'graveyard')).toBeDefined();
  });
});

describe('requested card draw', () => {
  it('Frantic Search: draw two, discard two, untap up to three lands', () => {
    let g = humanGame((d) => {
      put(d, 0, 'Frantic Search', 'hand');
      put(d, 0, 'Island', 'battlefield', 3);
    });
    g = run(g, { type: 'cast', card: byName(g, 0, 'Frantic Search', 'hand')!.id });
    const lands = g.players[0].battlefield.filter((c) => c.name === 'Island');
    expect(lands.every((c) => c.tapped)).toBe(true);
    g = settle(g, (h) => {
      if (h.decision?.type !== 'chooseCards' || h.decision.choice.kind !== 'pick') return null;
      const choice = h.decision.choice;
      return { type: 'chooseCards', cards: choice.cards.slice(0, choice.then === 'untap' ? 3 : 2) };
    });
    expect(g.players[0].battlefield.filter((c) => c.name === 'Island').every((c) => !c.tapped)).toBe(true);
    expect(g.players[0].graveyard).toHaveLength(3); // the spell and two discards
  });

  it('Windfall: everyone draws as many as the biggest hand discarded', () => {
    let g = emptyGame((d) => {
      put(d, 0, 'Windfall', 'hand');
      put(d, 0, 'Island', 'battlefield', 3);
      put(d, 1, 'Plains', 'hand', 5);
      put(d, 2, 'Plains', 'hand', 2);
    });
    g = settle(run(g, { type: 'cast', card: byName(g, 0, 'Windfall', 'hand')!.id }));
    expect(g.players.map((p) => p.hand.length)).toEqual([5, 5, 5, 5]);
    expect(g.players[1].graveyard).toHaveLength(5);
  });

  it('Faerie Mastermind draws on an opponent\'s second card each turn only', () => {
    let g = emptyGame((d) => {
      put(d, 0, 'Faerie Mastermind');
      put(d, 1, 'Harmonize', 'hand');
      put(d, 1, 'Forest', 'battlefield', 4);
      d.active = 1;
      d.priority = 1;
    });
    const hand = g.players[0].hand.length;
    g = settle(run(g, { type: 'cast', card: byName(g, 1, 'Harmonize', 'hand')!.id }));
    expect(g.players[0].hand.length).toBe(hand + 1);
  });

  it('Consecrated Sphinx may draw two for each card an opponent draws', () => {
    let g = humanGame((d) => {
      put(d, 0, 'Consecrated Sphinx');
      put(d, 1, "Night's Whisper", 'hand');
      put(d, 1, 'Swamp', 'battlefield', 2);
      d.active = 1;
      d.priority = 1;
    });
    const hand = g.players[0].hand.length;
    let asked = 0;
    g = run(g, { type: 'cast', card: byName(g, 1, "Night's Whisper", 'hand')!.id });
    g = settle(g, (h) => (h.decision?.type === 'ask' ? (asked++, { type: 'answer', yes: asked === 1 }) : null));
    expect(asked).toBe(2);
    expect(g.players[0].hand.length).toBe(hand + 2);
  });

  it('Niv-Mizzet, Ghost Counsel: pay the life gained to draw that many', () => {
    let g = humanGame((d) => {
      put(d, 0, 'Niv-Mizzet, Ghost Counsel');
      put(d, 0, 'Revitalize', 'hand');
      put(d, 0, 'Plains', 'battlefield', 2);
    });
    const hand = g.players[0].hand.length;
    g = run(g, { type: 'cast', card: byName(g, 0, 'Revitalize', 'hand')!.id });
    g = settle(g, (h) => (h.decision?.type === 'ask' ? { type: 'answer', yes: true } : null));
    // Revitalize: gain 3, draw 1. Niv-Mizzet: pay 3, draw 3.
    expect(g.players[0].life).toBe(40);
    expect(g.players[0].hand.length).toBe(hand - 1 + 1 + 3);
  });
});

describe('requested lands and permanents', () => {
  it('Land Tax: only while an opponent has more lands, up to three basics to the hand', () => {
    const upkeep = (theirLands: number) => {
      let g = humanGame((d) => {
        put(d, 0, 'Land Tax');
        put(d, 0, 'Plains', 'battlefield', 2);
        put(d, 1, 'Island', 'battlefield', theirLands);
        d.active = 3;
        d.priority = 3;
        d.step = 'end';
      });
      // Pass to player 0's upkeep.
      for (let i = 0; i < 40 && !(g.active === 0 && g.step === 'upkeep' && g.decision); i++) g = g.decision ? applyBotAction(g, botAction(g, g.priority)) : applyAction(g, { type: 'pass' });
      return g;
    };
    expect(upkeep(2).decision).toBeNull();
    let g = upkeep(3);
    expect(g.decision).toMatchObject({ type: 'ask' });
    g = run(g, { type: 'answer', yes: true });
    expect(g.decision).toMatchObject({ type: 'chooseCards', choice: { kind: 'search', count: 3 } });
  });

  it('Emergence Zone, High Fae Trickster and Leyline of Anticipation give flash', () => {
    let g = emptyGame((d) => {
      put(d, 0, 'Emergence Zone');
      put(d, 0, 'Plains');
      put(d, 0, 'Serra Angel', 'hand');
    });
    const angel = byName(g, 0, 'Serra Angel', 'hand')!;
    expect(flashGranted(g, 0, angel)).toBe(false);
    g = settle(run(g, { type: 'activate', card: byName(g, 0, 'Emergence Zone')!.id }));
    expect(flashGranted(g, 0, angel)).toBe(true);
    const t = emptyGame((d) => {
      put(d, 0, 'High Fae Trickster');
      put(d, 1, 'Serra Angel', 'hand');
    });
    expect(flashGranted(t, 0, angel)).toBe(true);
    expect(flashGranted(t, 1, byName(t, 1, 'Serra Angel', 'hand')!)).toBe(false);
  });

  it('Gran-Gran loots when it becomes tapped, and not without Lessons cheaper', () => {
    let g = humanGame((d) => {
      put(d, 0, 'Gran-Gran');
      put(d, 0, 'Plains', 'hand');
      put(d, 0, 'Lightning Bolt', 'hand');
    });
    expect(castCost(g, byName(g, 0, 'Lightning Bolt', 'hand')!).pips).toEqual(['R']);
    const hand = g.players[0].hand.length;
    g = run(g, { type: 'pass' }, { type: 'declareAttack', card: byName(g, 0, 'Gran-Gran')!.id, defender: 1 }, { type: 'pass' });
    let picked = 0;
    g = settle(g, (h) => (h.decision?.type === 'chooseCards' ? (picked++, { type: 'chooseCards', cards: [byName(h, 0, 'Plains', 'hand')!.id] }) : null));
    expect(picked).toBe(1);
    expect(g.players[0].hand.length).toBe(hand);
    expect(byName(g, 0, 'Plains', 'graveyard')).toBeDefined();
  });

  it('Descent into Avernus: two counters, then X Treasures each and X damage to each player', () => {
    let g = emptyGame((d) => {
      const descent = put(d, 0, 'Descent into Avernus');
      descent.counters.descent = 2;
      d.active = 3;
      d.priority = 3;
      d.step = 'end';
    });
    // Until the upkeep trigger has resolved once.
    const done = (h: Game) => g.players[0].battlefield.find((c) => c.name === 'Descent into Avernus')!.counters.descent === 4 && !h.stack.length;
    for (let i = 0; i < 60 && !done(g); i++) g = g.decision ? applyBotAction(g, botAction(g, g.priority)) : applyAction(g, { type: 'pass' });
    expect(g.players.map((p) => p.life)).toEqual([36, 36, 36, 36]);
    expect(g.players.map((p) => p.battlefield.filter((c) => c.name === 'Treasure').length)).toEqual([4, 4, 4, 4]);
  });

  it('Unstoppable Plan untaps your nonland permanents at your end step', () => {
    let g = emptyGame((d) => {
      put(d, 0, 'Unstoppable Plan');
      put(d, 0, 'Sol Ring').tapped = true;
      put(d, 0, 'Plains').tapped = true;
      d.step = 'main2';
    });
    for (let i = 0; i < 20 && g.step !== 'cleanup' && g.active === 0; i++) g = g.decision ? applyBotAction(g, botAction(g, g.priority)) : applyAction(g, { type: 'pass' });
    expect(g.players[0].battlefield.find((c) => c.name === 'Sol Ring')?.tapped).toBe(false);
  });
});

describe('requested creatures', () => {
  it('Recruiter of the Guard finds only a creature card with toughness 2 or less', () => {
    let g = humanGame((d) => {
      put(d, 0, 'Recruiter of the Guard', 'hand');
      put(d, 0, 'Plains', 'battlefield', 3);
      d.players[0].library = [];
      put(d, 0, 'Serra Angel', 'library');
      put(d, 0, 'Elite Vanguard', 'library');
      put(d, 0, 'Lightning Bolt', 'library');
    });
    g = run(g, { type: 'cast', card: byName(g, 0, 'Recruiter of the Guard', 'hand')!.id });
    for (let i = 0; i < 20 && g.decision?.type !== 'ask'; i++) g = applyAction(g, { type: 'pass' });
    g = run(g, { type: 'answer', yes: true });
    expect(g.decision?.type).toBe('chooseCards');
    expect([...choiceOptions(g, (g.decision as { choice: CardChoice }).choice).valid]).toEqual([byName(g, 0, 'Elite Vanguard', 'library')!.id]);
  });

  it('Whitemane Lion returns a creature you control, itself if you like', () => {
    let g = humanGame((d) => {
      put(d, 0, 'Whitemane Lion', 'hand');
      put(d, 0, 'Plains', 'battlefield', 2);
    });
    g = run(g, { type: 'cast', card: byName(g, 0, 'Whitemane Lion', 'hand')!.id });
    g = settle(g, (h) => (h.decision?.type === 'chooseCards' ? { type: 'chooseCards', cards: [byName(h, 0, 'Whitemane Lion')!.id] } : null));
    expect(byName(g, 0, 'Whitemane Lion', 'hand')).toBeDefined();
  });

  it('Lyse Hext: prowess, cheaper noncreature spells, double strike after two', () => {
    let g = emptyGame((d) => {
      put(d, 0, 'Lyse Hext');
      put(d, 0, 'Lightning Bolt', 'hand', 2);
      put(d, 0, 'Mountain', 'battlefield', 2);
    });
    const lyse = () => byName(g, 0, 'Lyse Hext')!;
    const base = stats(g, lyse());
    g = settle(run(g, { type: 'cast', card: byName(g, 0, 'Lightning Bolt', 'hand')!.id, targets: [player(1)] }));
    expect(stats(g, lyse()).power).toBe(base.power + 1);
    expect(stats(g, lyse()).keywords.has('double strike')).toBe(false);
    g = settle(run(g, { type: 'cast', card: byName(g, 0, 'Lightning Bolt', 'hand')!.id, targets: [player(1)] }));
    expect(stats(g, lyse()).keywords.has('double strike')).toBe(true);
  });

  it('Nezahal: no maximum hand size, and it comes back tapped at the next end step', () => {
    let g = emptyGame((d) => {
      put(d, 0, 'Nezahal, Primal Tide');
      put(d, 0, 'Plains', 'hand', 3);
    });
    expect(maxHandSize(g, 0)).toBe(Infinity);
    const discard = g.players[0].hand.slice(0, 3).map((c) => c.id);
    g = settle(run(g, { type: 'activate', card: byName(g, 0, 'Nezahal, Primal Tide')!.id, discard }));
    expect(byName(g, 0, 'Nezahal, Primal Tide', 'exile')).toBeDefined();
    for (let i = 0; i < 40 && !byName(g, 0, 'Nezahal, Primal Tide'); i++) g = g.decision ? applyBotAction(g, botAction(g, g.priority)) : applyAction(g, { type: 'pass' });
    expect(byName(g, 0, 'Nezahal, Primal Tide')?.tapped).toBe(true);
  });

  it('Flickering Hound exiles and returns another creature you control', () => {
    let g = humanGame((d) => {
      put(d, 0, 'Flickering Hound');
      put(d, 0, 'Elite Vanguard').counters['+1/+1'] = 2;
      put(d, 0, 'Llanowar Elves', 'hand');
      put(d, 0, 'Forest');
    });
    g = run(g, { type: 'cast', card: byName(g, 0, 'Llanowar Elves', 'hand')!.id });
    expect(g.decision?.type).toBe('targets');
    // Not the Hound itself: "other" (115.1).
    expect(applyAction(g, { type: 'chooseTargets', targets: [card(byName(g, 0, 'Flickering Hound')!.id)] })).toBe(g);
    g = run(g, { type: 'chooseTargets', targets: [card(byName(g, 0, 'Elite Vanguard')!.id)] });
    g = settle(g);
    expect(byName(g, 0, 'Elite Vanguard')!.counters['+1/+1']).toBeUndefined();
    expect(byName(g, 0, 'Llanowar Elves')).toBeDefined();
  });
});

describe('additional costs: discard a card, pay X life (118.8)', () => {
  // Read from their Oracle text, as a fetched card would be.
  scriptCards(['Big Score', 'Unexpected Windfall']);

  it('Grab the Prize: discards another card as it is cast, and burns only if that was not a land', () => {
    const cast = (discarded: string) => {
      let g = emptyGame((d) => {
        put(d, 0, 'Grab the Prize', 'hand');
        put(d, 0, discarded, 'hand');
        put(d, 0, 'Mountain', 'battlefield', 2);
      });
      const grab = byName(g, 0, 'Grab the Prize', 'hand')!;
      // The cost can't be skipped, and the spell can't discard itself.
      expect(applyAction(g, { type: 'cast', card: grab.id })).toBe(g);
      expect(applyAction(g, { type: 'cast', card: grab.id, discard: [grab.id] })).toBe(g);
      g = run(g, { type: 'cast', card: grab.id, discard: [byName(g, 0, discarded, 'hand')!.id] });
      // Discarded while it is cast, before it resolves (601.2h).
      expect(byName(g, 0, discarded, 'graveyard')).toBeDefined();
      return settle(g);
    };
    let g = cast('Lightning Bolt');
    expect(g.players.map((p) => p.life)).toEqual([40, 38, 38, 38]);
    expect(g.players[0].hand).toHaveLength(2);
    g = cast('Plains');
    expect(g.players.map((p) => p.life)).toEqual([40, 40, 40, 40]);
  });

  it("can't be cast with no other card to discard", () => {
    const g = emptyGame((d) => {
      put(d, 0, 'Big Score', 'hand');
      put(d, 0, 'Mountain', 'battlefield', 4);
    });
    expect(canCast(g, 0, byName(g, 0, 'Big Score', 'hand')!)).toBe(false);
  });

  it('Big Score (read from its Oracle text): discard, draw two, two Treasures', () => {
    let g = emptyGame((d) => {
      put(d, 0, 'Big Score', 'hand');
      put(d, 0, 'Plains', 'hand');
      put(d, 0, 'Mountain', 'battlefield', 4);
    });
    g = settle(run(g, { type: 'cast', card: byName(g, 0, 'Big Score', 'hand')!.id, discard: [byName(g, 0, 'Plains', 'hand')!.id] }));
    expect(g.players[0].hand).toHaveLength(2);
    expect(g.players[0].battlefield.filter((c) => c.name === 'Treasure')).toHaveLength(2);
  });

  it('Toxic Deluge: X life is paid as it is cast, no more than you have (119.4), and creatures get -X/-X', () => {
    let g = emptyGame((d) => {
      put(d, 0, 'Toxic Deluge', 'hand');
      put(d, 0, 'Swamp', 'battlefield', 3);
      put(d, 0, 'Elite Vanguard');
      put(d, 1, 'Typhoid Rats');
      put(d, 1, 'Lyra Dawnbringer');
      d.players[0].life = 10;
    });
    const deluge = byName(g, 0, 'Toxic Deluge', 'hand')!;
    expect(maxX(g, 0, deluge)).toBe(10);
    expect(canCast(g, 0, deluge, { x: 11 })).toBe(false);
    g = run(g, { type: 'cast', card: deluge.id, x: 4 });
    expect(g.players[0].life).toBe(6); // paid on casting
    g = settle(g);
    expect(byName(g, 0, 'Elite Vanguard')).toBeUndefined();
    expect(byName(g, 1, 'Typhoid Rats')).toBeUndefined();
    expect(stats(g, byName(g, 1, 'Lyra Dawnbringer')!).toughness).toBe(1);
  });

  it('a bot pays X life to clear the board, but never all its life', () => {
    const deluge = (life: number) => {
      const g = emptyGame((d) => {
        put(d, 1, 'Toxic Deluge', 'hand');
        put(d, 1, 'Swamp', 'battlefield', 3);
        put(d, 0, 'Serra Angel', 'battlefield', 3);
        d.players[1].life = life;
        d.active = 1;
        d.priority = 1;
      });
      return botAction(g, 1);
    };
    expect(deluge(10)).toMatchObject({ type: 'cast', x: 4 });
    expect(deluge(4)).toMatchObject({ type: 'pass' });
  });

});
