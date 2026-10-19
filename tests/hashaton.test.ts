// The Hashaton deck's hand scripts and the rules they needed: the clauses that could go wrong.
import { produce } from 'immer';
import { describe, expect, it } from 'vitest';
import { applyAction, applyBotAction, botAction, canBlock, colorsOf, counterCount, createToken, has, isCreature, makeCard, manaAbilities, maxHandSize, stats, subtypesOf, hasType } from '../src/engine';
import type { Action, Game, PlayerId, TargetRef } from '../src/engine';
import { byName, emptyGame, put, run } from './helpers';
import './fixtures';

const pass = { type: 'pass' } as const;
const player = (id: PlayerId): TargetRef => ({ kind: 'player', id });
const card = (c: { id: string }): TargetRef => ({ kind: 'card', id: c.id });
const cast = (g: Game, name: string, extra: object = {}, zone: 'hand' | 'graveyard' | 'exile' = 'hand', pid: PlayerId = 0): Action => ({
  type: 'cast',
  card: byName(g, pid, name, zone)!.id,
  ...extra,
});

/** Passes priority (bots answering anything asked) until the stack is empty and nothing is being decided. */
function settle(g: Game, human?: (g: Game) => Action | null): Game {
  for (let i = 0; i < 160 && (g.decision || g.stack.length || g.triggers.length); i++) {
    const mine = human && g.priority === 0 && g.decision ? human(g) : null;
    g = mine ? run(g, mine) : g.decision ? applyBotAction(g, botAction(g, g.priority)) : applyAction(g, pass);
  }
  return g;
}

/** Passes, bots acting as they like, until `stop` holds. */
function until(g: Game, stop: (g: Game) => boolean): Game {
  for (let i = 0; i < 600 && !stop(g); i++) g = g.decision ? applyBotAction(g, botAction(g, g.priority)) : applyAction(g, pass);
  return g;
}

/** Replaces a player's library with these cards, the first on top. */
function top(g: Game, pid: PlayerId, names: string[]) {
  g.players[pid].library = names.map((n) => makeCard(g, n, pid, 'library'));
}
const names = (cards: { name: string }[]) => cards.map((c) => c.name).sort();
const plenty = (name = 'Plains') => Array.from({ length: 12 }, () => name);
const human = (d: Game) => {
  d.players[0].isBot = false;
};
/** The choice waiting now, if any. */
const asked = (g: Game) => (g.decision && 'choice' in g.decision ? (g.decision.choice as { kind: string; text?: string; cards?: string[]; then?: string }) : null);
/** Answers a card choice for player 0 with the cards named, from wherever they are. */
const pick = (...ids: string[]): Action => ({ type: 'chooseCards', cards: ids });

describe("Hashaton, Scarab's Fist", () => {
  it('copies a discarded creature card as a tapped 4/4 black Zombie that keeps its other characteristics', () => {
    let g = emptyGame((d) => {
      put(d, 0, "Hashaton, Scarab's Fist");
      put(d, 0, 'Tortured Existence');
      put(d, 0, 'Riptide Gearhulk', 'hand');
      put(d, 0, 'Ashen Rider', 'graveyard');
      put(d, 0, 'Swamp');
      put(d, 0, 'Island', 'battlefield', 3);
    });
    const te = byName(g, 0, 'Tortured Existence')!;
    g = settle(run(g, { type: 'activate', card: te.id, discard: [byName(g, 0, 'Riptide Gearhulk', 'hand')!.id], targets: [card(byName(g, 0, 'Ashen Rider', 'graveyard')!)] }));
    const token = g.players[0].battlefield.find((c) => c.isToken)!;
    expect(token.name).toBe('Riptide Gearhulk');
    expect(token.tapped).toBe(true);
    const s = stats(g, token);
    expect([s.power, s.toughness]).toEqual([4, 4]);
    expect(colorsOf(g, token)).toEqual(['B']);
    expect(subtypesOf(g, token)).toEqual(['Zombie']);
    // Its card types and abilities are the copied card's: an artifact creature with double strike.
    expect(hasType(g, token, 'Artifact')).toBe(true);
    expect(s.keywords.has('double strike')).toBe(true);
    // Tortured Existence returned Ashen Rider.
    expect(byName(g, 0, 'Ashen Rider', 'hand')).toBeDefined();
  });

  it("doesn't trigger on a noncreature card", () => {
    let g = emptyGame((d) => {
      put(d, 0, "Hashaton, Scarab's Fist");
      put(d, 0, 'Psychic Frog');
      put(d, 0, 'Bitter Triumph', 'hand');
      put(d, 0, 'Island', 'battlefield', 3);
    });
    g = settle(run(g, { type: 'activate', card: byName(g, 0, 'Psychic Frog')!.id, discard: [byName(g, 0, 'Bitter Triumph', 'hand')!.id] }));
    expect(g.players[0].battlefield.some((c) => c.isToken)).toBe(false);
    expect(counterCount(byName(g, 0, 'Psychic Frog')!)).toBe(1);
  });
});

describe('Archon of Cruelty', () => {
  it('target opponent sacrifices, discards and loses 3; you draw and gain 3', () => {
    let g = emptyGame((d) => {
      put(d, 0, 'Archon of Cruelty', 'hand');
      put(d, 0, 'Swamp', 'battlefield', 8);
      put(d, 1, 'Serra Angel');
      put(d, 1, 'Plains', 'hand');
      top(d, 0, plenty());
    });
    g = run(g, cast(g, 'Archon of Cruelty'));
    g = settle(g, (x) => (x.decision?.type === 'targets' ? { type: 'chooseTargets', targets: [player(1)] } : null));
    expect(byName(g, 1, 'Serra Angel')).toBeUndefined();
    expect(g.players[1].hand).toHaveLength(0);
    expect(g.players[1].life).toBe(37);
    expect(g.players[0].life).toBe(43);
    expect(g.players[0].hand).toHaveLength(1);
  });
});

describe('static abilities', () => {
  it('Avacyn gives other permanents you control indestructible, lands included', () => {
    const g = emptyGame((d) => {
      put(d, 0, 'Avacyn, Angel of Hope');
      put(d, 0, 'Plains');
      put(d, 1, 'Serra Angel');
    });
    expect(has(g, byName(g, 0, 'Plains')!, 'indestructible')).toBe(true);
    expect(has(g, byName(g, 1, 'Serra Angel')!, 'indestructible')).toBe(false);
  });

  it('Elesh Norn, Grand Cenobite: +2/+2 to your other creatures, -2/-2 to your opponents\'', () => {
    const g = emptyGame((d) => {
      put(d, 0, 'Elesh Norn, Grand Cenobite');
      put(d, 0, 'Psychic Frog');
      put(d, 1, 'Serra Angel');
    });
    expect(stats(g, byName(g, 0, 'Psychic Frog')!).power).toBe(3);
    expect(stats(g, byName(g, 0, 'Elesh Norn, Grand Cenobite')!).power).toBe(4);
    expect(stats(g, byName(g, 1, 'Serra Angel')!).toughness).toBe(2);
  });
});

describe('evasion', () => {
  it("shadow: blocks and is blocked only by creatures with shadow (702.28b)", () => {
    const g = emptyGame((d) => {
      put(d, 0, 'Looter il-Kor');
      put(d, 1, 'Serra Angel');
    });
    const looter = byName(g, 0, 'Looter il-Kor')!;
    const angel = byName(g, 1, 'Serra Angel')!;
    expect(canBlock(g, angel, looter)).toBe(false);
    expect(canBlock(g, looter, angel)).toBe(false);
  });

  it('swampwalk: unblockable while the defending player controls a Swamp (702.14c)', () => {
    let g = emptyGame((d) => {
      put(d, 0, 'Sheoldred, Whispering One');
      put(d, 1, 'Serra Angel');
    });
    const sheoldred = byName(g, 0, 'Sheoldred, Whispering One')!;
    expect(canBlock(g, byName(g, 1, 'Serra Angel')!, sheoldred)).toBe(true);
    g = emptyGame((d) => {
      put(d, 0, 'Sheoldred, Whispering One');
      put(d, 1, 'Serra Angel');
      put(d, 1, 'Swamp');
    });
    expect(canBlock(g, byName(g, 1, 'Serra Angel')!, byName(g, 0, 'Sheoldred, Whispering One')!)).toBe(false);
  });

  it("Shoreline Looter can't be blocked", () => {
    const g = emptyGame((d) => {
      put(d, 0, 'Shoreline Looter');
      put(d, 1, 'Serra Angel');
    });
    expect(canBlock(g, byName(g, 1, 'Serra Angel')!, byName(g, 0, 'Shoreline Looter')!)).toBe(false);
  });
});

describe('spells', () => {
  it('Bitter Triumph: discard a card or pay 3 life', () => {
    let g = emptyGame((d) => {
      put(d, 0, 'Bitter Triumph', 'hand', 2);
      put(d, 0, 'Plains', 'hand');
      put(d, 0, 'Swamp', 'battlefield', 4);
      put(d, 1, 'Serra Angel', 'battlefield', 2);
    });
    const [a, b] = g.players[1].battlefield;
    g = settle(run(g, cast(g, 'Bitter Triumph', { extra: 0, discard: [byName(g, 0, 'Plains', 'hand')!.id], targets: [card(a)] })));
    expect(g.players[1].battlefield).toHaveLength(1);
    expect(byName(g, 0, 'Plains', 'graveyard')).toBeDefined();
    g = settle(run(g, cast(g, 'Bitter Triumph', { extra: 1, targets: [card(b)] })));
    expect(g.players[1].battlefield).toHaveLength(0);
    expect(g.players[0].life).toBe(37);
  });

  it('Sink into Stupor returns a spell an opponent controls to its owner\'s hand, but not a land', () => {
    let g = emptyGame((d) => {
      put(d, 1, 'Serra Angel', 'hand');
      put(d, 1, 'Plains', 'battlefield', 5);
      put(d, 0, 'Sink into Stupor', 'hand');
      put(d, 0, 'Island', 'battlefield', 3);
      d.active = 1;
      d.priority = 1;
    });
    g = run(g, cast(g, 'Serra Angel', {}, 'hand', 1));
    const angel = g.stack[0];
    expect(g.priority).toBe(0);
    // A land an opponent controls isn't a legal target.
    expect(applyAction(g, cast(g, 'Sink into Stupor', { targets: [card(g.players[1].battlefield[0])] }))).toBe(g);
    g = settle(run(g, cast(g, 'Sink into Stupor', { targets: [{ kind: 'stack', id: angel.id }] })));
    expect(byName(g, 1, 'Serra Angel', 'hand')).toBeDefined();
    expect(byName(g, 1, 'Serra Angel')).toBeUndefined();
  });

  it('Fell Mire: pay 3 life or it enters tapped', () => {
    let g = emptyGame((d) => {
      human(d);
      put(d, 0, 'Fell the Profane', 'hand');
    });
    g = run(g, { type: 'playLand', card: byName(g, 0, 'Fell the Profane', 'hand')!.id, face: 1 });
    expect(asked(g)?.kind).toBe('ask');
    g = run(g, { type: 'answer', yes: false });
    expect(byName(g, 0, 'Fell the Profane')!.tapped).toBe(true);
    expect(g.players[0].life).toBe(40);
  });

  it('Stubborn Denial counters unless its controller pays {1}; with a 4-power creature, it just counters', () => {
    const setup = (ferocious: boolean, oppLands: number) =>
      emptyGame((d) => {
        put(d, 1, 'Bitter Triumph', 'hand');
        put(d, 1, 'Swamp', 'battlefield', oppLands);
        put(d, 0, 'Stubborn Denial', 'hand');
        put(d, 0, 'Island');
        put(d, 0, ferocious ? 'Serra Angel' : 'Psychic Frog');
        // An instant on player 0's turn: a bot pays a tax when it isn't its own turn.
        d.priority = 1;
      });
    for (const [ferocious, oppLands, countered] of [
      [false, 3, false],
      [false, 2, true],
      [true, 3, true],
    ] as const) {
      let g = setup(ferocious, oppLands);
      const target = g.players[0].battlefield.find((c) => isCreature(g, c))!;
      g = run(g, cast(g, 'Bitter Triumph', { extra: 1, targets: [card(target)] }, 'hand', 1));
      g = settle(run(g, cast(g, 'Stubborn Denial', { targets: [{ kind: 'stack', id: g.stack[0].id }] })));
      expect(!!byName(g, 0, target.name)).toBe(countered);
    }
  });

  it('Victimize: sacrifice a creature, then both cards return tapped', () => {
    let g = emptyGame((d) => {
      human(d);
      put(d, 0, 'Victimize', 'hand');
      put(d, 0, 'Swamp', 'battlefield', 3);
      put(d, 0, 'Psychic Frog');
      put(d, 0, 'Ashen Rider', 'graveyard');
      put(d, 0, 'Serra Angel', 'graveyard');
      put(d, 1, 'Plains');
    });
    const [a, b] = g.players[0].graveyard;
    g = run(g, cast(g, 'Victimize', { targets: [card(a), card(b)] }));
    g = settle(g, (x) =>
      x.decision?.type === 'chooseCards'
        ? pick(byName(x, 0, 'Psychic Frog')!.id)
        : x.decision?.type === 'targets'
          ? { type: 'chooseTargets', targets: [card(x.players[1].battlefield[0])] }
          : null,
    );
    expect(byName(g, 0, 'Psychic Frog', 'graveyard')).toBeDefined();
    expect(byName(g, 0, 'Serra Angel')!.tapped).toBe(true);
    expect(byName(g, 0, 'Ashen Rider')!.tapped).toBe(true);
  });

  it('Living Death swaps the creatures in graveyards with those on the battlefield', () => {
    let g = emptyGame((d) => {
      put(d, 0, 'Living Death', 'hand');
      put(d, 0, 'Swamp', 'battlefield', 5);
      put(d, 0, 'Psychic Frog');
      put(d, 0, 'Serra Angel', 'graveyard');
      put(d, 1, 'Looter il-Kor');
      put(d, 1, 'Shoreline Looter', 'graveyard');
    });
    g = settle(run(g, cast(g, 'Living Death')));
    expect(names(g.players[0].battlefield.filter((c) => isCreature(g, c)))).toEqual(['Serra Angel']);
    expect(names(g.players[1].battlefield.filter((c) => isCreature(g, c)))).toEqual(['Shoreline Looter']);
    expect(names(g.players[0].graveyard)).toEqual(['Living Death', 'Psychic Frog']);
    expect(names(g.players[1].graveyard)).toEqual(['Looter il-Kor']);
  });
});

describe('discarding', () => {
  it("Monument to Endurance: each mode only once a turn; a fourth discard does nothing", () => {
    let g = emptyGame((d) => {
      put(d, 0, 'Monument to Endurance');
      put(d, 0, 'Psychic Frog');
      put(d, 0, 'Plains', 'hand', 4);
      top(d, 0, plenty('Island'));
    });
    const frog = byName(g, 0, 'Psychic Frog')!;
    for (let i = 0; i < 4; i++) g = settle(run(g, { type: 'activate', card: frog.id, discard: [g.players[0].hand.find((c) => c.name === 'Plains')!.id] }));
    // The bot picks loss of life first, then draw, then Treasure.
    expect(g.players[1].life).toBe(37);
    expect(g.players[2].life).toBe(37);
    expect(g.players[0].battlefield.filter((c) => c.name === 'Treasure')).toHaveLength(1);
    expect(g.players[0].hand.filter((c) => c.name === 'Island')).toHaveLength(1);
  });

  it('Archfiend of Ifnir puts a -1/-1 counter on each opposing creature when you cycle', () => {
    let g = emptyGame((d) => {
      put(d, 0, 'Archfiend of Ifnir');
      put(d, 0, 'Archfiend of Ifnir', 'hand');
      put(d, 0, 'Swamp', 'battlefield', 2);
      put(d, 1, 'Serra Angel');
      top(d, 0, plenty());
    });
    g = settle(run(g, { type: 'activate', card: byName(g, 0, 'Archfiend of Ifnir', 'hand')!.id }));
    expect(counterCount(byName(g, 1, 'Serra Angel')!, '-1/-1')).toBe(1);
    expect(g.players[0].hand.map((c) => c.name)).toEqual(['Plains']);
  });

  it('Angel of the Ruins plainscycles for a Plains card', () => {
    let g = emptyGame((d) => {
      put(d, 0, 'Angel of the Ruins', 'hand');
      put(d, 0, 'Swamp', 'battlefield', 2);
      top(d, 0, ['Island', 'Island', 'Plains']);
    });
    g = settle(run(g, { type: 'activate', card: byName(g, 0, 'Angel of the Ruins', 'hand')!.id }));
    expect(g.players[0].hand.map((c) => c.name)).toEqual(['Plains']);
    expect(byName(g, 0, 'Angel of the Ruins', 'graveyard')).toBeDefined();
  });

  it('Tortured Existence can only discard a creature card', () => {
    const g = emptyGame((d) => {
      put(d, 0, 'Tortured Existence');
      put(d, 0, 'Swamp');
      put(d, 0, 'Plains', 'hand');
      put(d, 0, 'Serra Angel', 'graveyard');
    });
    const te = byName(g, 0, 'Tortured Existence')!;
    expect(applyAction(g, { type: 'activate', card: te.id, discard: [byName(g, 0, 'Plains', 'hand')!.id], targets: [card(g.players[0].graveyard[0])] })).toBe(g);
  });
});

describe('connive', () => {
  it('Ledger Shredder connives when a player casts their second spell in a turn', () => {
    let g = emptyGame((d) => {
      human(d);
      put(d, 0, 'Ledger Shredder');
      put(d, 0, 'Bitter Triumph', 'hand', 2);
      put(d, 0, 'Swamp', 'battlefield', 4);
      put(d, 1, 'Serra Angel', 'battlefield', 2);
      top(d, 0, ['Serra Angel', 'Plains']);
    });
    const [a, b] = g.players[1].battlefield;
    g = settle(run(g, cast(g, 'Bitter Triumph', { extra: 1, targets: [card(a)] })));
    expect(g.players[0].hand).toHaveLength(1);
    g = settle(run(g, cast(g, 'Bitter Triumph', { extra: 1, targets: [card(b)] })), (x) =>
      x.decision?.type === 'chooseCards' ? pick(byName(x, 0, 'Serra Angel', 'hand')!.id) : null,
    );
    // Drew Serra Angel and discarded it: a nonland card, so a +1/+1 counter.
    expect(counterCount(byName(g, 0, 'Ledger Shredder')!)).toBe(1);
    expect(byName(g, 0, 'Serra Angel', 'graveyard')).toBeDefined();
  });
});

describe('enters abilities', () => {
  it('Riptide Gearhulk puts a permanent of each opponent third from the top of its owner\'s library', () => {
    let g = emptyGame((d) => {
      put(d, 0, 'Riptide Gearhulk', 'hand');
      put(d, 0, 'Plains', 'battlefield', 2);
      put(d, 0, 'Island', 'battlefield', 3);
      put(d, 1, 'Serra Angel');
      put(d, 2, 'Monument to Endurance');
      top(d, 1, ['Plains', 'Plains', 'Plains']);
      top(d, 2, ['Island']);
    });
    g = run(g, cast(g, 'Riptide Gearhulk'));
    g = settle(g, (x) => (x.decision?.type === 'targets' ? { type: 'chooseTargets', targets: [card(byName(x, 1, 'Serra Angel')!), card(byName(x, 2, 'Monument to Endurance')!), null] } : null));
    expect(g.players[1].library.map((c) => c.name)).toEqual(['Plains', 'Plains', 'Serra Angel', 'Plains']);
    // With fewer than two cards, it goes on the bottom.
    expect(g.players[2].library.map((c) => c.name)).toEqual(['Island', 'Monument to Endurance']);
  });

  it('Ob Nixilis destroys tapped creatures your opponents control and gains 1 life each; an Angel at end step', () => {
    let g = emptyGame((d) => {
      put(d, 0, 'Ob Nixilis, the Ascended', 'hand');
      put(d, 0, 'Plains', 'battlefield', 7);
      put(d, 1, 'Serra Angel').tapped = true;
      put(d, 1, 'Looter il-Kor');
      put(d, 0, 'Psychic Frog').tapped = true;
      top(d, 0, plenty());
      top(d, 1, plenty());
    });
    g = settle(run(g, cast(g, 'Ob Nixilis, the Ascended')));
    expect(byName(g, 1, 'Serra Angel')).toBeUndefined();
    expect(byName(g, 1, 'Looter il-Kor')).toBeDefined();
    expect(byName(g, 0, 'Psychic Frog')).toBeDefined();
    expect(g.players[0].life).toBe(41);
    g = until(g, (x) => x.active === 1);
    expect(g.players[0].battlefield.filter((c) => c.name === 'Angel 4/4 flying')).toHaveLength(1);
  });

  it('Sister Hospitaller returns a creature card and gains life equal to its mana value', () => {
    let g = emptyGame((d) => {
      put(d, 0, 'Sister Hospitaller', 'hand');
      put(d, 0, 'Plains', 'battlefield', 3);
      put(d, 0, 'Swamp', 'battlefield', 3);
      put(d, 0, 'Serra Angel', 'graveyard');
    });
    g = settle(run(g, cast(g, 'Sister Hospitaller')));
    expect(byName(g, 0, 'Serra Angel')).toBeDefined();
    expect(g.players[0].life).toBe(45);
  });
});

describe('lands', () => {
  it('Cephalid Coliseum: threshold makes a player draw three, then discard three', () => {
    let g = emptyGame((d) => {
      put(d, 0, 'Cephalid Coliseum');
      put(d, 0, 'Island');
      for (let i = 0; i < 7; i++) put(d, 0, 'Plains', 'graveyard');
      top(d, 1, plenty('Island'));
      put(d, 1, 'Serra Angel', 'hand');
    });
    g = settle(run(g, { type: 'activate', card: byName(g, 0, 'Cephalid Coliseum')!.id, targets: [player(1)] }));
    expect(g.players[1].hand).toHaveLength(1);
    expect(g.players[1].graveyard).toHaveLength(3);
    expect(byName(g, 0, 'Cephalid Coliseum', 'graveyard')).toBeDefined();
  });

  it("Cephalid Coliseum's threshold ability needs seven cards in your graveyard", () => {
    const g = emptyGame((d) => {
      put(d, 0, 'Cephalid Coliseum');
      put(d, 0, 'Island');
      for (let i = 0; i < 6; i++) put(d, 0, 'Plains', 'graveyard');
    });
    expect(applyAction(g, { type: 'activate', card: byName(g, 0, 'Cephalid Coliseum')!.id, targets: [player(1)] })).toBe(g);
  });
});

describe('Vohar and the Jin-Gitaxias', () => {
  it('Vohar: discarding an instant or sorcery drains each opponent for 1', () => {
    let g = emptyGame((d) => {
      human(d);
      put(d, 0, 'Vohar, Vodalian Desecrator');
      top(d, 0, ['Bitter Triumph', 'Plains']);
    });
    g = run(g, { type: 'activate', card: byName(g, 0, 'Vohar, Vodalian Desecrator')!.id, activated: 0 });
    g = settle(g, (x) => (x.decision?.type === 'chooseCards' ? pick(byName(x, 0, 'Bitter Triumph', 'hand')!.id) : null));
    expect(g.players.map((p) => p.life)).toEqual([41, 39, 39, 39]);
  });

  it("Vohar: sacrifice to cast an instant or sorcery from your graveyard, exiled after", () => {
    let g = emptyGame((d) => {
      put(d, 0, 'Vohar, Vodalian Desecrator');
      put(d, 0, 'Swamp', 'battlefield', 6);
      put(d, 0, 'Fell the Profane', 'graveyard');
      put(d, 1, 'Serra Angel');
    });
    g = settle(run(g, { type: 'activate', card: byName(g, 0, 'Vohar, Vodalian Desecrator')!.id, activated: 1, targets: [card(g.players[0].graveyard[0])] }));
    expect(byName(g, 0, 'Vohar, Vodalian Desecrator', 'graveyard')).toBeDefined();
    g = settle(run(g, cast(g, 'Fell the Profane', { targets: [card(byName(g, 1, 'Serra Angel')!)] }, 'graveyard')));
    expect(byName(g, 1, 'Serra Angel')).toBeUndefined();
    expect(byName(g, 0, 'Fell the Profane', 'exile')).toBeDefined();
  });

  it('Jin-Gitaxias, Progress Tyrant copies your first such spell each turn and counters an opponent\'s first', () => {
    let g = emptyGame((d) => {
      put(d, 0, 'Jin-Gitaxias, Progress Tyrant');
      put(d, 0, 'Fell the Profane', 'hand');
      put(d, 0, 'Swamp', 'battlefield', 4);
      put(d, 1, 'Serra Angel', 'battlefield', 2);
    });
    g = settle(run(g, cast(g, 'Fell the Profane', { targets: [card(g.players[1].battlefield[0])] })));
    // The copy may take a new target: the bot picks the other Angel.
    expect(g.players[1].battlefield).toHaveLength(0);

    g = emptyGame((d) => {
      put(d, 0, 'Jin-Gitaxias, Progress Tyrant');
      put(d, 0, 'Psychic Frog');
      put(d, 0, 'Serra Angel');
      put(d, 1, 'Bitter Triumph', 'hand', 2);
      put(d, 1, 'Swamp', 'battlefield', 4);
      d.active = 1;
      d.priority = 1;
    });
    g = settle(run(g, cast(g, 'Bitter Triumph', { extra: 1, targets: [card(byName(g, 0, 'Serra Angel')!)] }, 'hand', 1)));
    expect(byName(g, 0, 'Serra Angel')).toBeDefined();
    expect(byName(g, 1, 'Bitter Triumph', 'graveyard')).toBeDefined();
    g = settle(run(g, cast(g, 'Bitter Triumph', { extra: 1, targets: [card(byName(g, 0, 'Serra Angel')!)] }, 'hand', 1)));
    expect(byName(g, 0, 'Serra Angel')).toBeUndefined();
  });

  it("Jin-Gitaxias, Core Augur: each opponent's maximum hand size is reduced by seven", () => {
    const g = emptyGame((d) => {
      put(d, 0, 'Jin-Gitaxias, Core Augur');
    });
    expect(maxHandSize(g, 0)).toBe(7);
    expect(maxHandSize(g, 1)).toBe(0);
  });
});

describe("Serra's Emissary and Reflecting Pool", () => {
  it("Serra's Emissary: you and your creatures have protection from the chosen card type", () => {
    let g = emptyGame((d) => {
      human(d);
      put(d, 0, "Serra's Emissary", 'hand');
      put(d, 0, 'Plains', 'battlefield', 7);
      put(d, 0, 'Psychic Frog');
      put(d, 1, 'Bitter Triumph', 'hand');
      put(d, 1, 'Swamp', 'battlefield', 2);
    });
    g = run(g, cast(g, "Serra's Emissary"));
    g = settle(g, (x) => (x.decision?.type === 'name' ? { type: 'name', name: 'Instant' } : null));
    const frog = byName(g, 0, 'Psychic Frog')!;
    expect(byName(g, 0, "Serra's Emissary")!.chosen).toBe('Instant');
    expect(has(g, frog, 'protection from instants')).toBe(true);
    g = produce(g, (d) => {
      d.priority = 1;
    });
    // An instant can't target a creature you control.
    expect(applyAction(g, cast(g, 'Bitter Triumph', { extra: 1, targets: [card(frog)] }, 'hand', 1))).toBe(g);
  });

  it('Reflecting Pool adds any type of mana a land you control could produce (106.7)', () => {
    const colorsOf = (g: Game, pid: PlayerId) => manaAbilities(g, byName(g, pid, 'Reflecting Pool')!).flatMap((a) => a.colors);
    let g = emptyGame((d) => {
      put(d, 0, 'Reflecting Pool');
    });
    // Alone, or with only another Reflecting Pool, it can't produce any mana.
    expect(colorsOf(g, 0)).toEqual([]);
    g = emptyGame((d) => {
      put(d, 0, 'Reflecting Pool', 'battlefield', 2);
    });
    expect(colorsOf(g, 0)).toEqual([]);
    g = emptyGame((d) => {
      put(d, 0, 'Reflecting Pool', 'battlefield', 2);
      put(d, 0, 'Island');
      put(d, 0, 'Cephalid Coliseum');
      put(d, 0, 'Swamp');
    });
    expect(colorsOf(g, 0)).toEqual(['U', 'B']);
    // An Exotic Orchard you control could produce what an opponent's lands could.
    g = emptyGame((d) => {
      put(d, 0, 'Reflecting Pool');
      put(d, 0, 'Exotic Orchard');
      put(d, 1, 'Exotic Orchard');
      put(d, 1, 'Forest');
    });
    expect(colorsOf(g, 0)).toEqual(['G']);
  });
});

describe('token makers and replacement effects', () => {
  const make = (g: Game, key: string) => produce(g, (d) => void createToken(d, 0, key));
  const count = (g: Game, name: string) => g.players[0].battlefield.filter((c) => c.name === name).length;

  it('Mondrak doubles your tokens; Ojer Taq triples only creature tokens', () => {
    let g = emptyGame((d) => {
      put(d, 0, 'Mondrak, Glory Dominus');
    });
    g = make(make(g, 'Treasure'), 'Angel 4/4 flying');
    expect([count(g, 'Treasure'), count(g, 'Angel 4/4 flying')]).toEqual([2, 2]);
    g = emptyGame((d) => {
      put(d, 0, 'Ojer Taq, Deepest Foundation');
    });
    g = make(make(g, 'Treasure'), 'Angel 4/4 flying');
    expect([count(g, 'Treasure'), count(g, 'Angel 4/4 flying')]).toEqual([1, 3]);
    g = emptyGame((d) => {
      put(d, 0, 'Ojer Taq, Deepest Foundation');
      put(d, 0, 'Mondrak, Glory Dominus');
      put(d, 1, 'Mondrak, Glory Dominus');
    });
    g = settle(make(g, 'Angel 4/4 flying'));
    expect(count(g, 'Angel 4/4 flying')).toBe(6);
  });

  it("Mondrak: sacrifice two other artifacts and/or creatures for an indestructible counter", () => {
    const g0 = emptyGame((d) => {
      put(d, 0, 'Mondrak, Glory Dominus');
      put(d, 0, 'Plains', 'battlefield', 3);
      put(d, 0, 'Psychic Frog');
      put(d, 0, 'Monument to Endurance');
    });
    const m = byName(g0, 0, 'Mondrak, Glory Dominus')!;
    const frog = byName(g0, 0, 'Psychic Frog')!;
    const monument = byName(g0, 0, 'Monument to Endurance')!;
    // Not Mondrak itself, and not the same one twice.
    expect(applyAction(g0, { type: 'activate', card: m.id, sacrifice: [m.id, frog.id] })).toBe(g0);
    expect(applyAction(g0, { type: 'activate', card: m.id, sacrifice: [frog.id, frog.id] })).toBe(g0);
    const g = settle(run(g0, { type: 'activate', card: m.id, sacrifice: [frog.id, monument.id] }));
    expect(counterCount(byName(g, 0, 'Mondrak, Glory Dominus')!, 'indestructible')).toBe(1);
    expect(has(g, byName(g, 0, 'Mondrak, Glory Dominus')!, 'indestructible')).toBe(true);
    expect(g.players[0].graveyard.map((c) => c.name).sort()).toEqual(['Monument to Endurance', 'Psychic Frog']);
  });

  it('Ojer Taq returns transformed and tapped when it dies; the Temple transforms back after three attackers', () => {
    let g = emptyGame((d) => {
      put(d, 0, 'Ojer Taq, Deepest Foundation');
      put(d, 0, 'Bitter Triumph', 'hand');
      put(d, 0, 'Swamp', 'battlefield', 2);
    });
    g = settle(run(g, cast(g, 'Bitter Triumph', { extra: 1, targets: [card(byName(g, 0, 'Ojer Taq, Deepest Foundation')!)] })));
    const temple = g.players[0].battlefield.find((c) => c.name === 'Ojer Taq, Deepest Foundation')!;
    expect(temple.face).toBe(1);
    expect(temple.tapped).toBe(true);
    expect(isCreature(g, temple)).toBe(false);
    g = produce(g, (d) => {
      const t = d.players[0].battlefield.find((c) => c.id === temple.id)!;
      t.tapped = false;
      put(d, 0, 'Plains', 'battlefield', 3);
      d.players[0].attackedWith = ['a', 'b'];
    });
    expect(applyAction(g, { type: 'activate', card: temple.id })).toBe(g);
    g = produce(g, (d) => {
      d.players[0].attackedWith = ['a', 'b', 'c'];
    });
    g = settle(run(g, { type: 'activate', card: temple.id }));
    expect(byName(g, 0, 'Ojer Taq, Deepest Foundation')!.face).toBe(0);
  });

  it('Notion Thief: an opponent drawing an extra card draws nothing, and you draw instead', () => {
    let g = emptyGame((d) => {
      put(d, 0, 'Notion Thief');
      put(d, 1, 'Cephalid Coliseum');
      put(d, 1, 'Island');
      for (let i = 0; i < 7; i++) put(d, 1, 'Plains', 'graveyard');
      top(d, 0, plenty('Island'));
      top(d, 1, plenty('Island'));
      d.active = 1;
      d.priority = 1;
    });
    g = settle(run(g, { type: 'activate', card: byName(g, 1, 'Cephalid Coliseum')!.id, targets: [player(1)] }));
    expect(g.players[0].hand).toHaveLength(3);
    expect(g.players[1].hand).toHaveLength(0);
  });
});

describe('Giggling Skitterspike', () => {
  it('deals damage equal to its power to each opponent when it attacks', () => {
    let g = emptyGame((d) => {
      put(d, 0, 'Giggling Skitterspike');
    });
    g = run(g, pass, { type: 'declareAttack', card: byName(g, 0, 'Giggling Skitterspike')!.id, defender: 1 }, pass);
    g = until(g, (x) => x.players[2].life < 40);
    expect(g.players.map((p) => p.life).slice(2)).toEqual([39, 39]);
  });

  it('when it blocks', () => {
    let g = emptyGame((d) => {
      put(d, 1, 'Giggling Skitterspike');
      put(d, 0, 'Psychic Frog');
      put(d, 1, 'Plains', 'battlefield', 5);
    });
    g = produce(g, (d) => {
      const s = d.players[1].battlefield[0];
      s.counters['+1/+1'] = 2;
    });
    g = run(g, pass, { type: 'declareAttack', card: byName(g, 0, 'Psychic Frog')!.id, defender: 1 }, pass);
    while (g.step !== 'blockers') g = run(g, pass);
    g = run(g, { type: 'declareBlock', blocker: byName(g, 1, 'Giggling Skitterspike')!.id, attacker: byName(g, 0, 'Psychic Frog')!.id });
    g = until(g, (x) => x.players[0].life < 40);
    expect([g.players[0].life, g.players[2].life, g.players[3].life]).toEqual([37, 37, 37]);
  });

  it('when it becomes the target of a spell; Monstrosity 5 only once', () => {
    let g = emptyGame((d) => {
      put(d, 0, 'Giggling Skitterspike');
      put(d, 0, 'Plains', 'battlefield', 10);
      put(d, 1, 'Bitter Triumph', 'hand');
      put(d, 1, 'Swamp', 'battlefield', 2);
      d.priority = 1;
    });
    const s = byName(g, 0, 'Giggling Skitterspike')!;
    g = settle(run(g, cast(g, 'Bitter Triumph', { extra: 1, targets: [card(s)] }, 'hand', 1)));
    // Indestructible: it survives, and dealt 1 to each opponent.
    expect(byName(g, 0, 'Giggling Skitterspike')).toBeDefined();
    expect(g.players.map((p) => p.life)).toEqual([40, 36, 39, 39]);
    g = settle(run(g, { type: 'activate', card: s.id }));
    g = settle(run(g, { type: 'activate', card: s.id }));
    const after = byName(g, 0, 'Giggling Skitterspike')!;
    expect(after.monstrous).toBe(true);
    expect(counterCount(after)).toBe(5);
    expect(stats(g, after).power).toBe(6);
  });
});

describe('Hostage Taker', () => {
  const setup = () =>
    emptyGame((d) => {
      put(d, 0, 'Hostage Taker', 'hand');
      put(d, 0, 'Island', 'battlefield', 6);
      put(d, 0, 'Swamp', 'battlefield', 6);
      put(d, 0, 'Bitter Triumph', 'hand');
      put(d, 1, 'Serra Angel');
    });

  it('exiles a creature you may cast with mana of any type', () => {
    let g = setup();
    g = settle(run(g, cast(g, 'Hostage Taker')), (x) => (x.decision?.type === 'targets' ? { type: 'chooseTargets', targets: [card(byName(x, 1, 'Serra Angel')!)] } : null));
    expect(byName(g, 1, 'Serra Angel', 'exile')).toBeDefined();
    g = settle(run(g, cast(g, 'Serra Angel', {}, 'exile', 1)));
    const angel = byName(g, 0, 'Serra Angel')!;
    expect(angel.owner).toBe(1);
    // A new object: it stays when Hostage Taker leaves.
    g = settle(run(g, cast(g, 'Bitter Triumph', { extra: 1, targets: [card(byName(g, 0, 'Hostage Taker')!)] })));
    expect(byName(g, 0, 'Serra Angel')).toBeDefined();
  });

  it('returns the card to its owner when it leaves, if still exiled', () => {
    let g = setup();
    g = settle(run(g, cast(g, 'Hostage Taker')), (x) => (x.decision?.type === 'targets' ? { type: 'chooseTargets', targets: [card(byName(x, 1, 'Serra Angel')!)] } : null));
    g = settle(run(g, cast(g, 'Bitter Triumph', { extra: 1, targets: [card(byName(g, 0, 'Hostage Taker')!)] })));
    expect(byName(g, 1, 'Serra Angel')).toBeDefined();
    expect(byName(g, 1, 'Serra Angel', 'exile')).toBeUndefined();
  });
});

describe('Shadowgrange Archfiend and madness', () => {
  const setup = () =>
    emptyGame((d) => {
      human(d);
      put(d, 0, 'Psychic Frog');
      put(d, 0, 'Shadowgrange Archfiend', 'hand');
      put(d, 0, 'Swamp', 'battlefield', 3);
      put(d, 1, 'Serra Angel');
      put(d, 1, 'Psychic Frog');
      put(d, 2, 'Looter il-Kor');
    });
  const discardIt = (g: Game) => run(g, { type: 'activate', card: byName(g, 0, 'Psychic Frog')!.id, activated: 0, discard: [byName(g, 0, 'Shadowgrange Archfiend', 'hand')!.id] });

  it('discarded, it is exiled and may be cast for {2}{B} and 8 life; each opponent sacrifices its biggest creature', () => {
    let g = discardIt(setup());
    g = settle(g, (x) => (x.decision?.type === 'cast' ? { type: 'cast', card: byName(x, 0, 'Shadowgrange Archfiend', 'exile')!.id, alt: 0, targets: [] } : null));
    expect(byName(g, 0, 'Shadowgrange Archfiend')).toBeDefined();
    expect(byName(g, 1, 'Serra Angel')).toBeUndefined();
    expect(byName(g, 1, 'Psychic Frog')).toBeDefined();
    expect(byName(g, 2, 'Looter il-Kor')).toBeUndefined();
    // 40 - 8 life, + 4 for Serra Angel's power.
    expect(g.players[0].life).toBe(36);
  });

  it("can't be cast for its mana cost that way, and goes to the graveyard if not cast", () => {
    let g = discardIt(setup());
    g = settle(g, (x) => (x.decision?.type === 'cast' ? { type: 'answer', yes: false } : null));
    expect(byName(g, 0, 'Shadowgrange Archfiend', 'graveyard')).toBeDefined();
    g = discardIt(setup());
    g = until(g, (x) => x.decision?.type === 'cast');
    expect(applyAction(g, { type: 'cast', card: byName(g, 0, 'Shadowgrange Archfiend', 'exile')!.id, targets: [] })).toBe(g);
  });
});

describe('Metamorphosis Fanatic and miracle', () => {
  const setup = () =>
    emptyGame((d) => {
      human(d);
      d.active = 3;
      d.priority = 3;
      d.step = 'end';
      put(d, 0, 'Swamp', 'battlefield', 2);
      put(d, 0, 'Serra Angel', 'graveyard');
      top(d, 0, ['Metamorphosis Fanatic', 'Plains', 'Plains']);
      for (const pid of [1, 2, 3] as PlayerId[]) top(d, pid, plenty());
    });

  it('revealed as the first card drawn in a turn, it may be cast for {1}{B}; the creature returns with a lifelink counter', () => {
    let g = until(setup(), (x) => asked(x)?.then === '@miracle');
    expect(g.active).toBe(0);
    g = run(g, { type: 'answer', yes: true });
    g = until(g, (x) => x.decision?.type === 'cast');
    const fanatic = byName(g, 0, 'Metamorphosis Fanatic', 'hand')!;
    // Only for its miracle cost.
    expect(applyAction(g, { type: 'cast', card: fanatic.id, targets: [] })).toBe(g);
    g = run(g, { type: 'cast', card: fanatic.id, alt: 0, targets: [] });
    g = settle(g, (x) => (x.decision?.type === 'targets' ? { type: 'chooseTargets', targets: [card(byName(x, 0, 'Serra Angel', 'graveyard')!)] } : null));
    expect(byName(g, 0, 'Metamorphosis Fanatic')).toBeDefined();
    const angel = byName(g, 0, 'Serra Angel')!;
    expect(counterCount(angel, 'lifelink')).toBe(1);
    expect(has(g, angel, 'lifelink')).toBe(true);
  });

  it('not revealed, or not the first card drawn, it stays in hand', () => {
    let g = until(setup(), (x) => asked(x)?.then === '@miracle');
    g = run(g, { type: 'answer', yes: false });
    expect(g.triggers).toHaveLength(0);
    expect(byName(g, 0, 'Metamorphosis Fanatic', 'hand')).toBeDefined();
    // A second draw in the turn isn't asked about.
    g = emptyGame((d) => {
      d.players[0].drawn = 1;
      top(d, 0, ['Metamorphosis Fanatic']);
      put(d, 0, 'Vohar, Vodalian Desecrator');
    });
    g = run(g, { type: 'activate', card: byName(g, 0, 'Vohar, Vodalian Desecrator')!.id, activated: 0 });
    g = until(g, (x) => !!asked(x) || (!x.stack.length && !x.decision));
    expect(asked(g)?.then).not.toBe('@miracle');
  });
});

describe('Delay and suspend', () => {
  it('exiles the countered spell with three time counters; its owner casts it free, with haste, as the last is removed', () => {
    let g = emptyGame((d) => {
      put(d, 1, 'Serra Angel', 'hand');
      put(d, 1, 'Plains', 'battlefield', 5);
      put(d, 0, 'Delay', 'hand');
      put(d, 0, 'Island', 'battlefield', 2);
      for (const pid of [0, 1, 2, 3] as PlayerId[]) top(d, pid, Array.from({ length: 20 }, () => 'Plains'));
      d.active = 1;
      d.priority = 1;
    });
    g = run(g, cast(g, 'Serra Angel', {}, 'hand', 1));
    g = settle(run(g, cast(g, 'Delay', { targets: [{ kind: 'stack', id: g.stack[0].id }] })));
    const angel = byName(g, 1, 'Serra Angel', 'exile')!;
    expect(counterCount(angel, 'time')).toBe(3);
    expect(angel.suspend).toBe(true);
    // One counter off at each of its owner's upkeeps.
    const upkeeps: number[] = [];
    for (let i = 0; i < 3000 && !byName(g, 1, 'Serra Angel'); i++) {
      const before = byName(g, 1, 'Serra Angel', 'exile');
      g = g.decision ? applyBotAction(g, botAction(g, g.priority)) : applyAction(g, pass);
      const after = byName(g, 1, 'Serra Angel', 'exile');
      if (before && after && counterCount(before, 'time') !== counterCount(after, 'time')) upkeeps.push(g.active);
    }
    expect(upkeeps).toEqual([1, 1, 1]);
    const cast_ = byName(g, 1, 'Serra Angel')!;
    expect(g.active).toBe(1);
    expect(has(g, cast_, 'haste')).toBe(true);
  });
});

describe('Sphinx of the Second Sun', () => {
  it('adds a beginning phase after your postcombat main phase: untap, upkeep and draw again, then the ending phase', () => {
    let g = emptyGame((d) => {
      put(d, 0, 'Sphinx of the Second Sun');
      put(d, 0, 'Plains').tapped = true;
      top(d, 0, plenty());
    });
    const hand = g.players[0].hand.length;
    const steps: string[] = [];
    for (let i = 0; i < 200 && g.active === 0; i++) {
      g = g.decision ? applyBotAction(g, botAction(g, g.priority)) : applyAction(g, pass, { autoPass: false });
      if (g.active === 0 && steps[steps.length - 1] !== g.step) steps.push(g.step);
    }
    expect(steps.slice(steps.indexOf('main2'))).toEqual(['main2', 'upkeep', 'draw', 'end']);
    expect(g.players[0].hand.length).toBe(hand + 1);
    expect(byName(g, 0, 'Plains')!.tapped).toBe(false);
  });
});

describe('Rona', () => {
  it('untaps when you cast a legendary spell, loots, and transforms as a sorcery', () => {
    let g = emptyGame((d) => {
      human(d);
      put(d, 0, 'Rona, Herald of Invasion');
      put(d, 0, 'Vohar, Vodalian Desecrator', 'hand');
      put(d, 0, 'Island', 'battlefield', 2);
      put(d, 0, 'Swamp', 'battlefield', 6);
      top(d, 0, plenty());
    });
    const rona = byName(g, 0, 'Rona, Herald of Invasion')!;
    g = settle(run(g, { type: 'activate', card: rona.id, activated: 0 }), (x) => (x.decision?.type === 'chooseCards' ? pick(byName(x, 0, 'Plains', 'hand')!.id) : null));
    expect(byName(g, 0, 'Rona, Herald of Invasion')!.tapped).toBe(true);
    g = settle(run(g, cast(g, 'Vohar, Vodalian Desecrator')));
    expect(byName(g, 0, 'Rona, Herald of Invasion')!.tapped).toBe(false);
    g = settle(run(g, { type: 'activate', card: rona.id, activated: 1 }));
    const back = byName(g, 0, 'Rona, Herald of Invasion')!;
    expect(back.face).toBe(1);
    expect(stats(g, back).power).toBe(5);
  });

  it("Tolarian Obliterator: a source that damages it makes its controller exile a card at random, which you may play", () => {
    const setup = (inHand: string) =>
      emptyGame((d) => {
        human(d);
        put(d, 0, 'Rona, Herald of Invasion').face = 1;
        put(d, 1, 'Psychic Frog');
        put(d, 1, inHand, 'hand');
        top(d, 1, plenty());
        d.active = 1;
        d.priority = 1;
      });
    for (const [inHand, where] of [
      ['Plains', 'battlefield'],
      ['Monument to Endurance', 'battlefield'],
    ] as const) {
      let g = setup(inHand);
      while (g.step !== 'attackers') g = run(g, pass);
      g = run(g, { type: 'declareAttack', card: byName(g, 1, 'Psychic Frog')!.id, defender: 0 }, pass);
      while (g.step !== 'blockers' || g.priority !== 0) g = run(g, pass);
      g = run(g, { type: 'declareBlock', blocker: byName(g, 0, 'Rona, Herald of Invasion')!.id, attacker: byName(g, 1, 'Psychic Frog')!.id });
      g = until(g, (x) => x.decision?.type === 'ask' || x.decision?.type === 'cast');
      if (g.decision?.type === 'ask') g = run(g, { type: 'answer', yes: true });
      else g = run(g, { type: 'cast', card: byName(g, 1, inHand, 'exile')!.id, targets: [] });
      g = settle(g);
      const it = g.players[0][where].find((c) => c.name === inHand)!;
      expect(it.owner).toBe(1);
      expect(it.controller).toBe(0);
    }
  });
});
