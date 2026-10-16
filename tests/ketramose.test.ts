// The Ketramose deck's hand scripts and the rules they needed: the clauses that could go wrong.
import { describe, expect, it } from 'vitest';
import { applyAction, applyBotAction, botAction, castCost, costText, has, makeCard, stats } from '../src/engine';
import type { Action, Game, PlayerId, TargetRef } from '../src/engine';
import { produce } from 'immer';
import { byName, emptyGame, put, run } from './helpers';

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
  for (let i = 0; i < 80 && (g.decision || g.stack.length || g.triggers.length); i++) {
    const mine = human && g.priority === 0 && g.decision ? human(g) : null;
    g = mine ? run(g, mine) : g.decision ? applyBotAction(g, botAction(g, g.priority)) : applyAction(g, pass);
  }
  return g;
}

/** Passes until a decision for player 0 comes up, or the stack empties. */
function untilAsked(g: Game): Game {
  for (let i = 0; i < 40 && !(g.decision && g.priority === 0) && (g.stack.length || g.triggers.length || g.decision); i++) {
    g = g.decision ? applyBotAction(g, botAction(g, g.priority)) : applyAction(g, pass);
  }
  return g;
}

/** Passes, bots acting as they like, until `stop` holds. */
function until(g: Game, stop: (g: Game) => boolean): Game {
  for (let i = 0; i < 400 && !stop(g); i++) g = g.decision ? applyBotAction(g, botAction(g, g.priority)) : applyAction(g, pass);
  return g;
}

/** Replaces a player's library with these cards, the first on top. */
function top(g: Game, pid: PlayerId, names: string[]) {
  g.players[pid].library = names.map((n) => makeCard(g, n, pid, 'library'));
}
const names = (cards: { name: string }[]) => cards.map((c) => c.name).sort();
/** Puts a game at the declare-attackers decision, player 0 a person attacking. */
function attacking(d: Game) {
  d.players[0].isBot = false;
  d.players[0].you = true;
  d.step = 'attackers';
  d.combat = { attacks: [], toBlock: [], struckFirst: null, moreDamage: false } as unknown as Game['combat'];
  d.decision = { type: 'attackers' };
}
const plenty = Array.from({ length: 10 }, () => 'Plains');

describe('Ketramose, the New Dawn', () => {
  it("can't attack unless there are seven or more cards in exile", () => {
    let g = emptyGame((d) => {
      put(d, 0, 'Ketramose, the New Dawn');
      put(d, 1, 'Plains', 'exile', 6);
      attacking(d);
    });
    const k = byName(g, 0, 'Ketramose, the New Dawn')!;
    expect(applyAction(g, { type: 'declareAttack', card: k.id, defender: 1 })).toBe(g);
    g = emptyGame((d) => {
      put(d, 0, 'Ketramose, the New Dawn');
      put(d, 1, 'Plains', 'exile', 7);
      attacking(d);
    });
    run(g, { type: 'declareAttack', card: byName(g, 0, 'Ketramose, the New Dawn')!.id, defender: 1 });
  });

  it('draws once and loses 1 life when a whole graveyard is exiled during your turn', () => {
    let g = emptyGame((d) => {
      put(d, 0, 'Ketramose, the New Dawn');
      put(d, 0, 'Boggart Trawler', 'hand');
      put(d, 0, 'Swamp', 'battlefield', 3);
      put(d, 1, 'Plains', 'graveyard', 4);
      top(d, 0, plenty);
    });
    g = settle(run(g, cast(g, 'Boggart Trawler', { targets: [player(1)] })));
    expect(g.players[1].exile).toHaveLength(4);
    expect(g.players[0].hand).toHaveLength(1);
    expect(g.players[0].life).toBe(39);
  });

  it("doesn't trigger during an opponent's turn", () => {
    let g = emptyGame((d) => {
      put(d, 0, 'Ketramose, the New Dawn');
      put(d, 0, 'Ghost Vacuum');
      put(d, 1, 'Plains', 'graveyard');
      top(d, 0, plenty);
      d.active = 1;
      d.priority = 0;
    });
    g = settle(run(g, { type: 'activate', card: byName(g, 0, 'Ghost Vacuum')!.id, targets: [card(g.players[1].graveyard[0])] }));
    expect(g.players[1].exile).toHaveLength(1);
    expect(g.players[0].hand).toHaveLength(0);
    expect(g.players[0].life).toBe(40);
  });
});

describe('exiling and returning', () => {
  it('Skyclave Apparition: when it leaves, the owner of the card it exiled gets an X/X Illusion', () => {
    let g = emptyGame((d) => {
      put(d, 0, 'Skyclave Apparition', 'hand');
      put(d, 0, 'Plains', 'battlefield', 3);
      put(d, 0, 'Lightning Bolt', 'hand');
      put(d, 0, 'Mountain');
      put(d, 1, 'Walking Corpse');
    });
    g = settle(run(g, cast(g, 'Skyclave Apparition')));
    // The bot chose the Wall as the trigger's target.
    expect(byName(g, 1, 'Walking Corpse', 'exile')).toBeTruthy();
    g = settle(run(g, cast(g, 'Lightning Bolt', { targets: [card(byName(g, 0, 'Skyclave Apparition')!)] })));
    const illusion = byName(g, 1, 'Illusion 2/2')!;
    expect(illusion.isToken).toBe(true);
    expect(stats(g, illusion)).toMatchObject({ power: 2, toughness: 2 });
    // The exiled card stays in exile.
    expect(byName(g, 1, 'Walking Corpse', 'exile')).toBeTruthy();
  });
});

describe('exile spells', () => {
  it('Winds of Abandon overloaded: exiles each creature you don’t control, and each controller finds that many basics, tapped', () => {
    let g = emptyGame((d) => {
      put(d, 0, 'Winds of Abandon', 'hand');
      put(d, 0, 'Plains', 'battlefield', 6);
      put(d, 0, 'Walking Corpse');
      put(d, 1, 'Walking Corpse', 'battlefield', 2);
      put(d, 2, 'Serra Angel');
      top(d, 1, ['Swamp', 'Swamp', 'Swamp', 'Lightning Bolt']);
      top(d, 2, ['Lightning Bolt', 'Plains']);
    });
    g = settle(run(g, cast(g, 'Winds of Abandon', { alt: 0 })));
    expect(names(g.players[1].exile)).toEqual(['Walking Corpse', 'Walking Corpse']);
    expect(names(g.players[2].exile)).toEqual(['Serra Angel']);
    expect(byName(g, 0, 'Walking Corpse')).toBeTruthy();
    const lands = (pid: PlayerId) => g.players[pid].battlefield.filter((c) => c.name === 'Swamp' || c.name === 'Plains');
    expect(lands(1)).toHaveLength(2);
    expect(lands(2)).toHaveLength(1);
    expect([...lands(1), ...lands(2)].every((c) => c.tapped)).toBe(true);
    expect(g.players[1].library).toHaveLength(2);
  });

  it('Eerie Interlude: the cards come back at the next end step under their owner’s control; a token doesn’t', () => {
    let g = emptyGame((d) => {
      put(d, 0, 'Eerie Interlude', 'hand');
      put(d, 0, 'Plains', 'battlefield', 3);
      put(d, 0, 'Walking Corpse');
      put(d, 0, 'Serra Angel').isToken = true;
      top(d, 0, plenty);
    });
    const ids = g.players[0].battlefield.filter((c) => c.name !== 'Plains').map(card);
    g = settle(run(g, cast(g, 'Eerie Interlude', { targets: ids })));
    expect(byName(g, 0, 'Walking Corpse', 'exile')).toBeTruthy();
    expect(byName(g, 0, 'Serra Angel')).toBeUndefined();
    g = until(g, (x) => x.active === 1);
    expect(byName(g, 0, 'Walking Corpse')).toBeTruthy();
    expect(byName(g, 0, 'Serra Angel')).toBeUndefined();
    expect(byName(g, 0, 'Serra Angel', 'exile')).toBeUndefined();
  });

  it('Cling to Dust escapes from the graveyard by exiling five other cards, and draws for a noncreature card', () => {
    let g = emptyGame((d) => {
      put(d, 0, 'Cling to Dust', 'graveyard');
      put(d, 0, 'Plains', 'graveyard', 5);
      put(d, 0, 'Swamp', 'battlefield', 4);
      put(d, 1, 'Lightning Bolt', 'graveyard');
      top(d, 0, plenty);
    });
    const others = g.players[0].graveyard.filter((c) => c.name === 'Plains').map((c) => c.id);
    const target = card(g.players[1].graveyard[0]);
    expect(applyAction(g, cast(g, 'Cling to Dust', { targets: [target], escape: others.slice(0, 4) }, 'graveyard'))).toBe(g);
    g = settle(run(g, cast(g, 'Cling to Dust', { targets: [target], escape: others }, 'graveyard')));
    expect(byName(g, 1, 'Lightning Bolt', 'exile')).toBeTruthy();
    expect(g.players[0].hand).toHaveLength(1);
    // Nothing in the rules exiles an escaped instant, so it goes back to the graveyard (702.138a).
    expect(g.players[0].graveyard.map((c) => c.name)).toEqual(['Cling to Dust']);
  });

  it("Avatar's Wrath: keeps its target, airbends every other creature, stops opponents casting from exile, and exiles itself", () => {
    let g = emptyGame((d) => {
      put(d, 0, "Avatar's Wrath", 'hand');
      put(d, 0, 'Plains', 'battlefield', 4);
      put(d, 0, 'Serra Angel');
      put(d, 0, 'Walking Corpse');
      put(d, 1, 'Walking Corpse');
    });
    g = settle(run(g, cast(g, "Avatar's Wrath", { targets: [card(byName(g, 0, 'Serra Angel')!)] })));
    expect(byName(g, 0, 'Serra Angel')).toBeTruthy();
    expect(byName(g, 0, 'Walking Corpse', 'exile')!.airbent).toBe(true);
    const theirs = byName(g, 1, 'Walking Corpse', 'exile')!;
    expect(theirs.airbent).toBe(true);
    expect(byName(g, 0, "Avatar's Wrath", 'exile')).toBeTruthy();
    // On the opponent's own turn, with mana for the airbend cost, the card still can't be cast.
    g = until(g, (x) => x.active === 1 && x.step === 'main1' && x.priority === 1 && !x.stack.length && !x.decision);
    g = produce(g, (d) => {
      for (let i = 0; i < 3; i++) put(d, 1, 'Swamp');
    });
    expect(applyAction(g, { type: 'cast', card: theirs.id })).toBe(g);
    // Without the effect, they could.
    const free = produce(g, (d) => {
      d.effects = d.effects.filter((e) => e.kind !== 'cantCast');
    });
    expect(applyAction(free, { type: 'cast', card: theirs.id })).not.toBe(free);
  });

  it("Teferi's Protection: life can't change, permanents phase out, and it exiles itself", () => {
    let g = emptyGame((d) => {
      put(d, 0, "Teferi's Protection", 'hand');
      put(d, 0, 'Plains', 'battlefield', 3);
      put(d, 0, 'Serra Angel');
      put(d, 1, 'Lightning Bolt', 'hand');
      put(d, 1, 'Mountain');
    });
    g = settle(run(g, cast(g, "Teferi's Protection")));
    expect(g.players[0].battlefield).toHaveLength(0);
    expect(g.players[0].phasedOut?.length).toBe(4);
    expect(byName(g, 0, "Teferi's Protection", 'exile')).toBeTruthy();
    // Protection from everything: a player with it can't be targeted (702.16b).
    g = produce(g, (d) => {
      d.priority = 1;
    });
    expect(applyAction(g, cast(g, 'Lightning Bolt', { targets: [player(0)] }, 'hand', 1))).toBe(g);
    const free = produce(g, (d) => {
      d.effects = d.effects.filter((e) => e.kind !== 'protection');
    });
    expect(applyAction(free, cast(free, 'Lightning Bolt', { targets: [player(0)] }, 'hand', 1))).not.toBe(free);
  });
});

describe('spree and modes', () => {
  it('Insatiable Avarice costs {B} plus each chosen mode’s cost (702.172a)', () => {
    const g = emptyGame((d) => put(d, 0, 'Insatiable Avarice', 'hand'));
    const c = byName(g, 0, 'Insatiable Avarice', 'hand')!;
    expect(costText(castCost(g, c, { modes: [0] }))).toBe('{2}{B}');
    expect(costText(castCost(g, c, { modes: [1] }))).toBe('{B}{B}{B}');
    expect(costText(castCost(g, c, { modes: [0, 1] }))).toBe('{2}{B}{B}{B}');
  });

  it('Lively Dirge with both modes: the card it finds can be one of the creatures it returns', () => {
    let g = emptyGame((d) => {
      put(d, 0, 'Lively Dirge', 'hand');
      put(d, 0, 'Swamp', 'battlefield', 5);
      put(d, 0, 'Walking Corpse', 'graveyard');
      put(d, 0, 'Serra Angel', 'graveyard');
      top(d, 0, ['Walking Corpse']);
    });
    g = settle(run(g, cast(g, 'Lively Dirge', { modes: [0, 1] })));
    expect(g.players[0].battlefield.filter((c) => c.name === 'Walking Corpse')).toHaveLength(2);
    expect(byName(g, 0, 'Serra Angel', 'graveyard')).toBeTruthy();
  });
});

describe('creatures', () => {
  it('Eirdu: creature spells you cast have convoke, and you choose which creatures pay', () => {
    let g = emptyGame((d) => {
      put(d, 0, 'Eirdu, Carrier of Dawn // Isilu, Carrier of Twilight');
      put(d, 0, 'Serra Angel', 'hand');
      put(d, 0, 'Plains', 'battlefield', 2);
      put(d, 0, 'Walking Corpse', 'battlefield', 2);
      put(d, 0, 'Lightning Bolt', 'hand');
    });
    const corpses = g.players[0].battlefield.filter((c) => c.name === 'Walking Corpse').map((c) => c.id);
    const eirdu = byName(g, 0, 'Eirdu, Carrier of Dawn // Isilu, Carrier of Twilight')!.id;
    // Three creatures and two Plains pay {3}{W}{W}: the white Eirdu could pay {W}, the black Corpses only generic.
    g = settle(run(g, cast(g, 'Serra Angel', { convoke: [...corpses, eirdu] })));
    expect(byName(g, 0, 'Serra Angel')).toBeTruthy();
    expect(g.players[0].battlefield.filter((c) => c.tapped)).toHaveLength(5);
  });

  it("Eirdu's convoke is only for creature spells", () => {
    const g = emptyGame((d) => {
      put(d, 0, 'Eirdu, Carrier of Dawn // Isilu, Carrier of Twilight');
      put(d, 0, "Teferi's Protection", 'hand');
      put(d, 0, 'Walking Corpse', 'battlefield', 3);
    });
    const corpses = g.players[0].battlefield.filter((c) => c.name === 'Walking Corpse').map((c) => c.id);
    expect(applyAction(g, cast(g, "Teferi's Protection", { convoke: corpses }))).toBe(g);
  });

  it('Springleaf Drum taps a creature that just arrived (302.6)', () => {
    let g = emptyGame((d) => {
      put(d, 0, 'Springleaf Drum');
      put(d, 0, 'Walking Corpse').sick = true;
    });
    g = run(g, { type: 'tapMana', card: byName(g, 0, 'Springleaf Drum')!.id, color: 'G', tap: byName(g, 0, 'Walking Corpse')!.id });
    expect(byName(g, 0, 'Walking Corpse')!.tapped).toBe(true);
    expect(g.players[0].pool.map((m) => m.sym)).toEqual(['G']);
  });

  it('Emperor of Bones: adapting puts the card it exiled onto the battlefield with a finality counter and haste, sacrificed at the end step', () => {
    let g = emptyGame((d) => {
      put(d, 0, 'Emperor of Bones');
      put(d, 0, 'Swamp', 'battlefield', 2);
      put(d, 1, 'Serra Angel', 'graveyard');
      d.step = 'main1';
    });
    // Beginning of combat: the bot exiles the Angel.
    g = until(g, (x) => x.step !== 'main1' && !x.stack.length && !x.triggers.length && !x.decision);
    expect(byName(g, 1, 'Serra Angel', 'exile')).toBeTruthy();
    g = settle(run(g, { type: 'activate', card: byName(g, 0, 'Emperor of Bones')!.id }));
    const angel = byName(g, 0, 'Serra Angel')!;
    expect(angel.counters.finality).toBe(1);
    expect(has(g, angel, 'haste')).toBe(true);
    g = until(g, (x) => x.active === 1);
    // Sacrificed with a finality counter: exiled instead (122.1h).
    expect(byName(g, 1, 'Serra Angel', 'exile')).toBeTruthy();
    expect(byName(g, 1, 'Serra Angel', 'graveyard')).toBeUndefined();
  });

  it("Solitude evoked: exiles a white card from hand instead of mana, and the creature's controller gains life equal to its power", () => {
    let g = emptyGame((d) => {
      put(d, 0, 'Solitude', 'hand');
      put(d, 0, 'Plains', 'hand');
      put(d, 0, "Teferi's Protection", 'hand');
      put(d, 1, 'Serra Angel');
    });
    const plains = byName(g, 0, 'Plains', 'hand')!.id;
    const white = byName(g, 0, "Teferi's Protection", 'hand')!.id;
    expect(applyAction(g, cast(g, 'Solitude', { alt: 0, exile: [plains] }))).toBe(g);
    g = settle(run(g, cast(g, 'Solitude', { alt: 0, exile: [white] })));
    expect(byName(g, 1, 'Serra Angel', 'exile')).toBeTruthy();
    expect(g.players[1].life).toBe(44);
    expect(byName(g, 0, 'Solitude', 'graveyard')).toBeTruthy();
    expect(byName(g, 0, "Teferi's Protection", 'exile')).toBeTruthy();
  });

  it("Haliya draws at your end step only if you've gained 3 or more life this turn, checked as it resolves", () => {
    const play = (gained: number) => {
      let g = emptyGame((d) => {
        put(d, 0, 'Haliya, Guided by Light');
        top(d, 0, plenty);
        d.players[0].lifeGained = gained;
      });
      g = until(g, (x) => x.active === 1);
      return g.players[0].hand.length;
    };
    expect(play(3)).toBe(1);
    expect(play(2)).toBe(0);
  });

  it('Archivist of Oghma sees Delivery Moogle search a library, but not a graveyard alone', () => {
    let g = emptyGame((d) => {
      put(d, 0, 'Archivist of Oghma');
      put(d, 1, 'Delivery Moogle', 'hand');
      put(d, 1, 'Plains', 'battlefield', 4);
      put(d, 1, 'Sol Ring', 'graveyard');
      top(d, 0, plenty);
      top(d, 1, ['Springleaf Drum', 'Plains']);
      d.active = 1;
      d.priority = 1;
    });
    g = settle(run(g, cast(g, 'Delivery Moogle', {}, 'hand', 1)));
    // The bot searches both and takes one artifact with mana value 2 or less.
    expect(g.players[1].hand.map((c) => c.name).some((n) => n === 'Sol Ring' || n === 'Springleaf Drum')).toBe(true);
    expect(g.players[0].hand).toHaveLength(1);
    expect(g.players[0].life).toBe(41);
  });

  it('Aven Interrupter exiles a spell, which becomes plotted and costs its owner {2} more to cast from exile', () => {
    let g = emptyGame((d) => {
      put(d, 0, 'Lightning Bolt', 'hand');
      put(d, 0, 'Mountain', 'battlefield', 3);
      put(d, 1, 'Aven Interrupter', 'hand');
      put(d, 1, 'Plains', 'battlefield', 3);
    });
    g = run(g, cast(g, 'Lightning Bolt', { targets: [player(1)], hold: true }), pass);
    g = settle(run(g, cast(g, 'Aven Interrupter', {}, 'hand', 1)));
    const bolt = byName(g, 0, 'Lightning Bolt', 'exile')!;
    expect(bolt.plotted).toBeTruthy();
    expect(g.players[1].life).toBe(40);
    // A plotted card is cast without paying its mana cost (702.170d), so only the {2} is left.
    expect(costText(castCost(g, bolt, {}))).toBe('{2}');
  });
});

describe('Trouble in Pairs and The Eternal Wanderer', () => {
  it("Trouble in Pairs draws when an opponent draws their second card each turn", () => {
    let g = emptyGame((d) => {
      put(d, 0, 'Trouble in Pairs');
      put(d, 1, 'Insatiable Avarice', 'hand');
      put(d, 1, 'Swamp', 'battlefield', 3);
      top(d, 0, plenty);
      top(d, 1, plenty);
      d.active = 1;
      d.priority = 1;
    });
    g = settle(run(g, cast(g, 'Insatiable Avarice', { modes: [1], targets: [player(1)] }, 'hand', 1)));
    expect(g.players[1].hand).toHaveLength(3);
    expect(g.players[0].hand).toHaveLength(1);
  });

  it('The Eternal Wanderer −4: each player keeps one creature their controller chose, the rest are sacrificed together', () => {
    let g = emptyGame((d) => {
      const w = put(d, 0, 'The Eternal Wanderer');
      w.counters.loyalty = 5;
      put(d, 0, 'Serra Angel');
      put(d, 0, 'Walking Corpse');
      put(d, 1, 'Serra Angel');
      put(d, 1, 'Walking Corpse');
      put(d, 2, 'Walking Corpse');
    });
    g = settle(run(g, { type: 'activate', card: byName(g, 0, 'The Eternal Wanderer')!.id, ability: 2 }));
    expect(names(g.players[0].battlefield.filter((c) => c.name !== 'The Eternal Wanderer'))).toEqual(['Serra Angel']);
    // The bot keeps an opponent's weakest creature.
    expect(names(g.players[1].battlefield)).toEqual(['Walking Corpse']);
    expect(names(g.players[2].battlefield)).toEqual(['Walking Corpse']);
  });
});

describe('artifacts', () => {
  it("Agatha's Soul Cauldron: a creature card exiled puts a +1/+1 counter on your creature, which gains the card's activated abilities", () => {
    let g = emptyGame((d) => {
      put(d, 0, "Agatha's Soul Cauldron");
      put(d, 0, 'Walking Corpse');
      put(d, 1, 'Mother of Runes', 'graveyard');
    });
    const corpse = byName(g, 0, 'Walking Corpse')!;
    expect(applyAction(g, { type: 'activate', card: corpse.id, targets: [card(corpse)] })).toBe(g);
    g = settle(run(g, { type: 'activate', card: byName(g, 0, "Agatha's Soul Cauldron")!.id, targets: [card(g.players[1].graveyard[0])] }));
    expect(byName(g, 0, 'Walking Corpse')!.counters['+1/+1']).toBe(1);
    // Mother of Runes's "{T}: Target creature you control gains protection from the color of your choice".
    g = run(g, { type: 'activate', card: corpse.id, targets: [card(corpse)] });
  });

  it("Urza's Saga III finds an artifact with mana cost {0} or {1}", () => {
    let g = emptyGame((d) => {
      put(d, 0, "Urza's Saga").counters.lore = 2;
      top(d, 0, ['Serra Angel', 'Sol Ring', 'Plains', 'Plains']);
      d.active = 3;
      d.step = 'end';
      d.priority = 3;
    });
    g = until(g, (x) => x.active === 0 && x.step === 'main1' && !x.stack.length && !x.triggers.length && !x.decision);
    expect(byName(g, 0, 'Sol Ring')).toBeTruthy();
    // After its last chapter, the Saga is sacrificed (714.4).
    expect(byName(g, 0, "Urza's Saga", 'graveyard')).toBeTruthy();
  });
});

describe('more triggers', () => {
  it('Phelia: the card returns at the next end step, and a +1/+1 counter if it came back under your control', () => {
    let g = emptyGame((d) => {
      attacking(d);
      put(d, 0, 'Phelia, Exuberant Shepherd');
      put(d, 0, 'Walking Corpse');
      top(d, 0, plenty);
    });
    const phelia = byName(g, 0, 'Phelia, Exuberant Shepherd')!;
    g = untilAsked(run(g, { type: 'declareAttack', card: phelia.id, defender: 1 }, pass));
    expect(g.decision?.type).toBe('targets');
    g = run(g, { type: 'chooseTargets', targets: [card(byName(g, 0, 'Walking Corpse')!)] });
    g = settle(g);
    expect(byName(g, 0, 'Walking Corpse', 'exile')).toBeTruthy();
    g = until(g, (x) => x.active === 1 || (x.step === 'end' && !x.stack.length && !x.triggers.length && !x.decision));
    g = settle(g, () => null);
    expect(byName(g, 0, 'Walking Corpse')).toBeTruthy();
    expect(byName(g, 0, 'Phelia, Exuberant Shepherd')!.counters['+1/+1']).toBe(1);
  });

  it('Isilu gives your other nontoken creatures persist', () => {
    let g = emptyGame((d) => {
      put(d, 0, 'Eirdu, Carrier of Dawn // Isilu, Carrier of Twilight').face = 1;
      put(d, 0, 'Walking Corpse');
      put(d, 1, 'Lightning Bolt', 'hand');
      put(d, 1, 'Mountain');
      d.priority = 1;
    });
    g = settle(run(g, cast(g, 'Lightning Bolt', { targets: [card(byName(g, 0, 'Walking Corpse')!)] }, 'hand', 1)));
    expect(byName(g, 0, 'Walking Corpse')!.counters['-1/-1']).toBe(1);
  });

  it('The Legend of Yangchen I: each player in turn chooses up to one of your opponents’ permanents with mana value 3 or more, all exiled together', () => {
    let g = emptyGame((d) => {
      put(d, 0, 'The Legend of Yangchen', 'hand');
      put(d, 0, 'Plains', 'battlefield', 5);
      put(d, 0, 'Serra Angel');
      put(d, 1, 'Serra Angel');
      put(d, 2, 'Delivery Moogle');
      put(d, 3, 'Walking Corpse');
    });
    g = settle(run(g, cast(g, 'The Legend of Yangchen')));
    expect(byName(g, 0, 'Serra Angel')).toBeTruthy();
    expect(byName(g, 1, 'Serra Angel', 'exile')).toBeTruthy();
    expect(byName(g, 2, 'Delivery Moogle', 'exile')).toBeTruthy();
    expect(byName(g, 3, 'Walking Corpse')).toBeTruthy();
  });

  it('Ketramose triggers once for the Relic exiled as a cost, and once for all the graveyards exiled together', () => {
    let g = emptyGame((d) => {
      put(d, 0, 'Ketramose, the New Dawn');
      put(d, 0, 'Relic of Progenitus');
      put(d, 0, 'Mountain');
      for (const pid of [0, 1, 2, 3] as PlayerId[]) put(d, pid, 'Plains', 'graveyard', 2);
      top(d, 0, plenty);
    });
    g = settle(run(g, { type: 'activate', card: byName(g, 0, 'Relic of Progenitus')!.id, activated: 1 }));
    expect(g.players.every((p) => p.graveyard.length === 0)).toBe(true);
    expect(g.players[0].hand).toHaveLength(3);
    expect(g.players[0].life).toBe(38);
  });
});

describe('entering together (603.6a, 614.12a)', () => {
  it('Ghost Vacuum: a card whose replacement effect asks a choice holds the others back until it is made; all enter as 1/1 Spirits with flying counters', () => {
    let g = emptyGame((d) => {
      d.players[0].isBot = false;
      d.players[0].you = true;
      put(d, 0, 'Ghost Vacuum');
      put(d, 0, 'Plains', 'battlefield', 6);
      put(d, 0, 'Haliya, Guided by Light');
    });
    const vacuum = byName(g, 0, 'Ghost Vacuum')!;
    g = produce(g, (d) => {
      // As if the Vacuum had exiled them: linked to it (607.2a).
      for (const name of ['Roaming Throne', 'Walking Corpse']) {
        const c = put(d, 1, name, 'exile');
        d.players[0].battlefield.find((x) => x.id === vacuum.id)!.linked.push({ id: c.id, moves: c.moves });
      }
    });
    g = untilAsked(run(g, { type: 'activate', card: vacuum.id, activated: 1 }));
    expect(g.decision?.type).toBe('name');
    // Nothing has entered yet: the Corpse waits for the Throne's choice.
    expect(byName(g, 1, 'Walking Corpse', 'exile')).toBeTruthy();
    g = settle(run(g, { type: 'name', name: 'Zombie' }));
    const throne = byName(g, 0, 'Roaming Throne')!;
    const corpse = byName(g, 0, 'Walking Corpse')!;
    expect(throne.chosen).toBe('Zombie');
    for (const c of [throne, corpse]) {
      expect(stats(g, c)).toMatchObject({ power: 1, toughness: 1 });
      expect(c.counters.flying).toBe(1);
    }
    // Haliya saw both enter.
    expect(g.players[0].life).toBe(42);
  });
});

describe('Trouble in Pairs: extra turns', () => {
  const fortune = (trouble: boolean) => {
    let g = emptyGame((d) => {
      if (trouble) put(d, 0, 'Trouble in Pairs');
      put(d, 1, 'Final Fortune', 'hand');
      put(d, 1, 'Mountain', 'battlefield', 2);
      for (const p of d.players) top(d, p.id, plenty);
      d.active = 1;
      d.priority = 1;
    });
    g = settle(run(g, cast(g, 'Final Fortune', {}, 'hand', 1)));
    return until(g, (x) => x.turn > 1);
  };

  it('an opponent who would begin an extra turn skips it instead (614.10)', () => {
    expect(fortune(false).active).toBe(1);
    const g = fortune(true);
    expect(g.active).toBe(2);
    // The skipped turn's "you lose the game" never comes.
    expect(g.players[1].lost).toBeFalsy();
  });
});
