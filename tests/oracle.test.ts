// The Oracle text parser (src/cards/oracle.ts): what it reads, what it refuses, and that
// its scripts play the same as the hand scripts of the pool cards it can read.
import { describe, expect, it } from 'vitest';
import { cardData, registerCards } from '../src/cards/db';
import { needsScript, parseCard, scriptCards } from '../src/cards/oracle';
import { parseResults } from '../src/cards/oracle-report';
import { activatedAt, applyAction, applyBotAction, botAction, castCost, hasScript, isCreature, isLand, legalTargets, makeCard, manaAbilities, permanent, scriptOf, spellTargets, stats } from '../src/engine';
import type { Action, ActivatedAbility, Card, CardData, CardScript, Game, TargetRef, TargetSpec } from '../src/engine';
import { registerScripts } from '../src/engine/registry';
import fixtureData from './fixtures.generated.json';
import { byName, emptyGame, put, run } from './helpers';

/** A made-up card with this text, for trying the parser on wording the pool doesn't have. */
function fake(name: string, typeLine: string, oracleText: string, extra: Partial<CardData> = {}): CardData {
  return { name, manaCost: '{1}', cmc: 1, colors: [], colorIdentity: [], typeLine, oracleText, power: '1', toughness: '1', keywords: [], image: '', art: '', ...extra };
}
const parse = (typeLine: string, text: string) => parseCard(fake('Test Card', typeLine, text));
const refusal = (typeLine: string, text: string) => {
  const p = parse(typeLine, text);
  return p.ok ? null : { clause: p.clause, reason: p.reason };
};

describe('reading Oracle text', () => {
  it('needs no script for keyword-only and vanilla cards', () => {
    expect(needsScript(cardData('Serra Angel'))).toBe(false);
    expect(needsScript(cardData('Elite Vanguard'))).toBe(false);
    expect(parseCard(cardData('Serra Angel'))).toEqual({ ok: true, script: {} });
  });

  it('reads triggers, activated abilities, mana abilities and lords', () => {
    const s = (text: string, type = 'Creature — Elf') => {
      const p = parse(type, text);
      if (!p.ok) throw new Error(`${p.clause}: ${p.reason}`);
      return p.script;
    };
    expect(s('When this creature enters, draw a card.').onEnter).toBeTypeOf('function');
    expect(s('When Test Card dies, you gain 2 life.').onDies).toMatchObject({ text: 'When Test Card dies, you gain 2 life.' });
    expect(s('Whenever this creature attacks, it gets +2/+0 until end of turn.').onAttack).toBeDefined();
    expect(s('{T}: Add {G}.').mana).toEqual({ amount: 1, colors: ['G'] });
    expect(s('{T}: Add {C}{C}.').mana).toEqual({ amount: 2, colors: ['C'] });
    expect(s('{T}: Add {W} or {B}.').mana).toEqual({ amount: 1, colors: ['W', 'B'] });
    expect(s('{2}{R}, {T}: This creature deals 1 damage to any target. Activate only as a sorcery.').activated).toMatchObject({
      cost: { mana: '{2}{R}', tap: true },
      sorcery: true,
      targets: [{ type: 'any' }],
    });
    expect(s('Sacrifice another creature: Draw a card.').activated).toMatchObject({ cost: { sacrificeOne: { type: 'creature', who: 'you', label: 'another creature' } } });
    expect(s('Other Elf creatures you control get +1/+1 and have trample.').static).toBeTypeOf('function');
  });

  it('reads target words: non-, colours and who controls it (115)', () => {
    const p = parse('Instant', 'Destroy target nonartifact, nonblack creature an opponent controls.');
    expect(p.ok && p.script.targets).toMatchObject([{ type: 'creature', who: 'opponent', label: 'target nonartifact, nonblack creature an opponent controls' }]);
    const q = parse('Sorcery', 'Exile target nontoken permanent you control.');
    expect(q.ok && q.script.targets).toMatchObject([{ type: 'permanent', who: 'you' }]);
  });

  it('finds listed tokens by their words (111)', () => {
    expect(parse('Sorcery', 'Create two 1/1 white Spirit creature tokens with flying.').ok).toBe(true);
    expect(parse('Sorcery', 'Create a Treasure token.').ok).toBe(true);
    expect(refusal('Sorcery', 'Create a 7/7 blue Kraken creature token.')).toEqual({ clause: 'create a 7/7 blue kraken creature token', reason: 'no listed token is "7/7 blue kraken creature"' });
  });

  it('refuses the whole card at the first clause it can\'t read, naming it', () => {
    expect(refusal('Creature — Elf', 'Flying\nWhen this creature enters, draw a card.\nWhenever you gain life, put a +1/+1 counter on Test Card.')).toEqual({
      clause: 'Whenever you gain life, put a +1/+1 counter on Test Card.',
      reason: 'no template matches',
    });
    // "Instead", "for each", conditions and modal text are never approximated.
    expect(refusal('Instant', 'Draw a card for each creature you control.')).not.toBeNull();
    expect(refusal('Instant', 'Choose one —\n• Draw a card.\n• You gain 3 life.')).not.toBeNull();
    expect(refusal('Instant', 'If you control a creature, draw two cards.')).not.toBeNull();
    expect(refusal('Instant', 'Target player draws X cards.')).toMatchObject({ reason: 'X outside a cost' });
    expect(refusal('Instant', 'Destroy target creature. Its controller gains 3 life.')).toMatchObject({ clause: 'its controller gains 3 life' });
  });

  it('refuses cards with faces, and costs it can\'t pay', () => {
    expect(parseCard(cardData('Birgi, God of Storytelling // Harnfel, Horn of Bounty'))).toMatchObject({ ok: false, reason: 'a card with more than one face' });
    expect(refusal('Creature — Elf', 'Exile a card from your graveyard: Draw a card.')).toMatchObject({ reason: 'the cost "exile a card from your graveyard"' });
  });

  it('uses X only from an ability\'s own cost (107.3a, 107.3k)', () => {
    registerCards({ 'X Rod': fake('X Rod', 'Artifact', '{X}, {T}: X Rod deals X damage to any target.') });
    expect(scriptCards(['X Rod'])).toEqual([]);
    let g = emptyGame((d) => {
      put(d, 0, 'X Rod');
      put(d, 0, 'Mountain', 'battlefield', 3);
    });
    const p1 = { kind: 'player', id: 1 } as const;
    g = run(g, { type: 'activate', card: byName(g, 0, 'X Rod')!.id, x: 3, targets: [p1] });
    expect(g.players[1].life).toBe(37);
  });
});

describe('parsed scripts in a game', () => {
  it('scripts a card that has no hand script, and leaves hand scripts alone', () => {
    registerCards({ 'Parsed Courier': fake('Parsed Courier', 'Creature — Human', 'When this creature enters, target player draws two cards and loses 2 life.') });
    const bolt = scriptOf('Lightning Bolt');
    expect(scriptCards(['Parsed Courier', 'Lightning Bolt'])).toEqual([]);
    expect(hasScript('Parsed Courier')).toBe(true);
    // The subject carried to "loses 2 life" is the same target player, not a second target.
    expect(scriptOf('Parsed Courier').targets).toHaveLength(1);
    expect(scriptOf('Lightning Bolt')).toBe(bolt);
  });

  it('chooses a "dies" trigger\'s target as it goes on the stack, and the source deals the damage (603.3d)', () => {
    registerCards({ 'Parting Spark': fake('Parting Spark', 'Creature — Elemental', 'When this creature dies, it deals 2 damage to any target.') });
    expect(scriptCards(['Parting Spark'])).toEqual([]);
    let g = emptyGame((d) => {
      put(d, 0, 'Parting Spark');
      put(d, 0, 'Murder', 'hand');
      put(d, 0, 'Swamp', 'battlefield', 3);
    });
    g = run(g, { type: 'cast', card: byName(g, 0, 'Murder', 'hand')!.id, targets: [{ kind: 'card', id: byName(g, 0, 'Parting Spark')!.id }] });
    for (let i = 0; i < 20 && (g.decision || g.stack.length); i++) {
      g = g.decision ? applyBotAction(g, botAction(g, g.priority)) : applyAction(g, { type: 'pass' });
    }
    // Only opponents can be hit to the bot's liking: one of them took the 2.
    expect(g.players.slice(1).reduce((n, p) => n + p.life, 0)).toBe(3 * 40 - 2);
  });

  it('asks before a "you may" effect each time, and does nothing on no (608.2d)', () => {
    registerCards({ 'Maybe Sage': fake('Maybe Sage', 'Creature — Human', 'When this creature enters, you may draw a card. You gain 1 life.') });
    scriptCards(['Maybe Sage']);
    const enter = (yes: boolean) => {
      let g = emptyGame((d) => {
        d.players[0].isBot = false;
        d.players[0].you = true;
        put(d, 0, 'Maybe Sage', 'hand');
        put(d, 0, 'Plains');
      });
      const hand = g.players[0].hand.length;
      g = run(g, { type: 'cast', card: byName(g, 0, 'Maybe Sage', 'hand')!.id });
      expect(g.decision).toMatchObject({ type: 'ask', choice: { text: 'Draw a card?' } });
      // The rest of the ability waits for the answer.
      expect(g.players[0].life).toBe(40);
      g = run(g, { type: 'answer', yes });
      return { drew: g.players[0].hand.length - (hand - 1), life: g.players[0].life };
    };
    expect(enter(true)).toEqual({ drew: 1, life: 41 });
    expect(enter(false)).toEqual({ drew: 0, life: 41 });
  });
});

/** Registers a made-up card with this (real) Oracle text and scripts it with the parser, failing on a refusal. */
function teach(name: string, typeLine: string, oracleText: string, extra: Partial<CardData> = {}) {
  registerCards({ [name]: fake(name, typeLine, oracleText, extra) });
  expect(scriptCards([name])).toEqual([]);
}

describe('lands and mana from Oracle text', () => {
  /** Plays land `name` from player 0's hand into a game set up by `setup`, and says whether it entered tapped. */
  const playTapped = (name: string, setup: (g: Game) => void = () => {}, players = 4) => {
    let g = emptyGame((d) => {
      d.players.slice(players).forEach((p) => (p.lost = true));
      put(d, 0, name, 'hand');
      setup(d);
    });
    g = run(g, { type: 'playLand', card: byName(g, 0, name, 'hand')!.id });
    return byName(g, 0, name)!.tapped;
  };

  it('enters tapped, or tapped unless a condition holds as it enters (614.1c)', () => {
    teach('Test Gate', 'Land — Plains Swamp', '({T}: Add {W} or {B}.)\nThis land enters tapped.\nWhen this land enters, surveil 1.');
    expect(playTapped('Test Gate')).toBe(true);
    // Slow lands count the player's other lands, not this one.
    teach('Test Slowland', 'Land', 'This land enters tapped unless you control two or more other lands.\n{T}: Add {W} or {B}.');
    expect(playTapped('Test Slowland', (d) => put(d, 0, 'Plains'))).toBe(true);
    expect(playTapped('Test Slowland', (d) => put(d, 0, 'Plains', 'battlefield', 2))).toBe(false);
    teach('Test Basics Land', 'Land — Plains Swamp', 'This land enters tapped unless you control two or more basic lands.');
    expect(playTapped('Test Basics Land', (d) => put(d, 0, 'Test Gate', 'battlefield', 2))).toBe(true);
    expect(playTapped('Test Basics Land', (d) => put(d, 0, 'Swamp', 'battlefield', 2))).toBe(false);
    teach('Test Basic Land', 'Land', 'This land enters tapped unless you control a basic land.\n{T}: Add {W}.');
    expect(playTapped('Test Basic Land')).toBe(true);
    expect(playTapped('Test Basic Land', (d) => put(d, 0, 'Swamp'))).toBe(false);
    // "Two or more opponents": players who have left the game don't count (800.4a).
    teach('Test Suite', 'Land', 'This land enters tapped unless you have two or more opponents.\n{T}: Add {B} or {R}.');
    expect(playTapped('Test Suite')).toBe(false);
    expect(playTapped('Test Suite', () => {}, 2)).toBe(true);
    teach('Test Moor', 'Land — Plains Swamp', 'This land enters tapped unless your opponents control eight or more lands.');
    expect(playTapped('Test Moor', (d) => put(d, 1, 'Forest', 'battlefield', 7))).toBe(true);
    expect(playTapped('Test Moor', (d) => [1, 2].forEach((p) => put(d, p, 'Forest', 'battlefield', 4)))).toBe(false);
    teach('Test Checkland', 'Land', 'This land enters tapped unless you control an Island or a Swamp.\n{T}: Add {U} or {B}.');
    expect(playTapped('Test Checkland', (d) => put(d, 0, 'Plains'))).toBe(true);
    expect(playTapped('Test Checkland', (d) => put(d, 0, 'Swamp'))).toBe(false);
    // A condition it has no template for refuses the card.
    expect(refusal('Land', 'This land enters tapped unless you control three or more other lands.')).toMatchObject({ reason: 'no template for "unless you control three or more other lands"' });
  });

  it('asks to pay 2 life as a shock land enters, or it enters tapped (614.12a)', () => {
    teach('Test Shock', 'Land — Island Swamp', "({T}: Add {U} or {B}.)\nAs this land enters, you may pay 2 life. If you don't, it enters tapped.");
    const play = (yes: boolean) => {
      let g = emptyGame((d) => {
        d.players[0].isBot = false;
        d.players[0].you = true;
        put(d, 0, 'Test Shock', 'hand');
      });
      g = run(g, { type: 'playLand', card: byName(g, 0, 'Test Shock', 'hand')!.id });
      expect(g.decision).toMatchObject({ type: 'ask', choice: { life: 2 } });
      g = run(g, { type: 'answer', yes });
      return { tapped: byName(g, 0, 'Test Shock')!.tapped, life: g.players[0].life };
    };
    expect(play(true)).toEqual({ tapped: false, life: 38 });
    expect(play(false)).toEqual({ tapped: true, life: 40 });
  });

  it('reads Talismans, tri-lands, verges and "any one color" (106, 605)', () => {
    teach('Test Talisman', 'Artifact', '{T}: Add {C}.\n{T}: Add {W} or {B}. This artifact deals 1 damage to you.');
    expect(scriptOf('Test Talisman').mana).toEqual([
      { amount: 1, colors: ['C'] },
      { amount: 1, colors: ['W', 'B'], damage: 1 },
    ]);
    teach('Test Triland', 'Land', 'This land enters tapped.\n{T}: Add {W}, {U}, or {B}.');
    expect(scriptOf('Test Triland').mana).toEqual({ amount: 1, colors: ['W', 'U', 'B'] });
    teach('Test Lotus', 'Artifact', '{T}: Add three mana of any one color.');
    let g = emptyGame((d) => put(d, 0, 'Test Lotus'));
    g = run(g, { type: 'tapMana', card: byName(g, 0, 'Test Lotus')!.id, color: 'U' });
    expect(g.players[0].pool.map((m) => m.sym)).toEqual(['U', 'U', 'U']);
    // A verge's second ability works only with a Plains or a Swamp (602.5b).
    teach('Test Verge', 'Land', '{T}: Add {B}.\n{T}: Add {W}. Activate only if you control a Plains or a Swamp.');
    const colors = (setup: (d: Game) => void) => {
      const h = emptyGame((d) => {
        put(d, 0, 'Test Verge');
        setup(d);
      });
      return manaAbilities(h, byName(h, 0, 'Test Verge')!).flatMap((m) => m.colors);
    };
    expect(colors(() => {})).toEqual(['B']);
    expect(colors((d) => put(d, 0, 'Swamp'))).toEqual(['B', 'W']);
    // The Talisman's damage is dealt as its ability resolves (605.3b: at once).
    g = emptyGame((d) => put(d, 0, 'Test Talisman'));
    g = run(g, { type: 'tapMana', card: byName(g, 0, 'Test Talisman')!.id, ability: 1, color: 'W' });
    expect(g.players[0].life).toBe(39);
  });

  it('reads cycling as an ability activated from the hand (702.29a)', () => {
    teach('Test Tower', 'Land — Plains Island Swamp', '({T}: Add {W}, {U}, or {B}.)\nThis land enters tapped.\nCycling {3} ({3}, Discard this card: Draw a card.)', { keywords: ['Cycling'] });
    let g = emptyGame((d) => {
      put(d, 0, 'Test Tower', 'hand');
      put(d, 0, 'Plains', 'battlefield', 3);
    });
    const hand = g.players[0].hand.length;
    g = run(g, { type: 'activate', card: byName(g, 0, 'Test Tower', 'hand')!.id });
    for (let i = 0; i < 10 && g.stack.length; i++) g = applyAction(g, { type: 'pass' });
    expect(byName(g, 0, 'Test Tower', 'graveyard')).toBeDefined();
    expect(g.players[0].hand.length).toBe(hand);
  });

  it('reads fetch lands and "pay N life" costs (119.4)', () => {
    teach('Test Fetch', 'Land', '{T}, Pay 1 life, Sacrifice this land: Search your library for a Mountain or Forest card, put it onto the battlefield, then shuffle.');
    expect((scriptOf('Test Fetch').activated as ActivatedAbility).cost).toEqual({ tap: true, life: 1, sacrifice: true });
    teach('Test Cave', 'Land', '{T}: Add {C}.\n{3}, {T}, Sacrifice this land: Search your library for a land card, put it onto the battlefield tapped, then shuffle.');
    let g = emptyGame((d) => {
      put(d, 0, 'Test Cave');
      put(d, 0, 'Plains', 'battlefield', 3);
      d.players[0].library.unshift(makeCard(d, 'Test Gate', 0, 'library'));
    });
    g = run(g, { type: 'activate', card: byName(g, 0, 'Test Cave')!.id });
    for (let i = 0; i < 10 && (g.decision || g.stack.length); i++) g = g.decision ? applyBotAction(g, botAction(g, g.priority)) : applyAction(g, { type: 'pass' });
    const found = g.players[0].battlefield.find((c) => isLand(c) && c.name !== 'Plains');
    expect(found?.tapped).toBe(true);
  });
});

describe('more effects and static lines from Oracle text', () => {
  it('reads "draw, then discard" and refuses an effect that would happen before the discard', () => {
    teach('Test Researcher', 'Creature — Human Wizard', 'Sacrifice this creature: Draw a card, then discard a card.');
    let g = emptyGame((d) => {
      d.players[0].isBot = false;
      d.players[0].you = true;
      put(d, 0, 'Test Researcher');
      put(d, 0, 'Plains', 'hand');
    });
    g = run(g, { type: 'activate', card: byName(g, 0, 'Test Researcher')!.id });
    g = applyAction(g, { type: 'pass' }, { autoPass: true });
    for (let i = 0; i < 6 && g.stack.length && !g.decision; i++) g = applyAction(g, { type: 'pass' });
    expect(g.decision).toMatchObject({ type: 'chooseCards', choice: { kind: 'pick', min: 1, max: 1 } });
    g = run(g, { type: 'chooseCards', cards: [byName(g, 0, 'Plains', 'hand')!.id] });
    expect(byName(g, 0, 'Plains', 'graveyard')).toBeDefined();
    expect(refusal('Sorcery', 'Draw a card, then discard a card. You gain 1 life.')).toMatchObject({ clause: 'you gain 1 life', reason: 'an effect after a choice' });
  });

  it('triggers on your noncreature spells only (603.2)', () => {
    teach('Test Waltz', 'Creature — Wizard', 'Flying, deathtouch\nWhenever you cast a noncreature spell, Test Waltz deals 2 damage to each opponent.', { keywords: ['Flying', 'Deathtouch'] });
    const cast = (name: string) => {
      let g = emptyGame((d) => {
        put(d, 0, 'Test Waltz');
        put(d, 0, name, 'hand');
        put(d, 0, 'Mountain', 'battlefield', 4);
        put(d, 0, 'Forest', 'battlefield', 4);
      });
      g = run(g, { type: 'cast', card: byName(g, 0, name, 'hand')!.id, targets: name === 'Shock' ? [{ kind: 'player', id: 1 }] : [] });
      for (let i = 0; i < 20 && (g.decision || g.stack.length); i++) g = g.decision ? applyBotAction(g, botAction(g, g.priority)) : applyAction(g, { type: 'pass' });
      return g.players.map((p) => p.life);
    };
    expect(cast('Shock')).toEqual([40, 36, 38, 38]);
    expect(cast('Llanowar Elves')).toEqual([40, 40, 40, 40]);
  });

  it("exiles a target player's graveyard and puts a counter on each of your creatures", () => {
    teach('Test Bog', 'Land', 'This land enters tapped.\nWhen this land enters, exile target player\'s graveyard.\n{T}: Add {B}.');
    let g = emptyGame((d) => {
      put(d, 0, 'Test Bog', 'hand');
      put(d, 1, 'Murder', 'graveyard', 3);
    });
    g = run(g, { type: 'playLand', card: byName(g, 0, 'Test Bog', 'hand')!.id });
    if (g.decision?.type === 'targets') g = run(g, { type: 'chooseTargets', targets: [{ kind: 'player', id: 1 }] });
    for (let i = 0; i < 10 && g.stack.length; i++) g = applyAction(g, { type: 'pass' });
    expect(g.players[1].graveyard).toHaveLength(0);
    expect(g.players[1].exile.filter((c) => c.name === 'Murder')).toHaveLength(3);

    teach('Test Temple', 'Land', '{T}: Add {W}.\n{3}{W}, {T}: Put a +1/+1 counter on each creature you control.');
    g = emptyGame((d) => {
      put(d, 0, 'Test Temple');
      put(d, 0, 'Plains', 'battlefield', 4);
      put(d, 0, 'Elite Vanguard', 'battlefield', 2);
      put(d, 1, 'Serra Angel');
    });
    g = run(g, { type: 'activate', card: byName(g, 0, 'Test Temple')!.id });
    for (let i = 0; i < 10 && g.stack.length; i++) g = applyAction(g, { type: 'pass' });
    expect(g.players[0].battlefield.filter((c) => c.name === 'Elite Vanguard').map((c) => c.counters['+1/+1'])).toEqual([1, 1]);
    expect(byName(g, 1, 'Serra Angel')!.counters['+1/+1']).toBeUndefined();
  });

  it('reads "nonbasic" and "creature or enchantment" targets (205.4a)', () => {
    teach('Test Bowl', 'Land', '{T}: Add {C}.\n{3}, {T}, Sacrifice a land: Destroy target nonbasic land.');
    const g = emptyGame((d) => {
      put(d, 0, 'Test Bowl');
      put(d, 1, 'Plains');
      put(d, 1, 'Test Gate');
    });
    const spec = activatedAt(byName(g, 0, 'Test Bowl')!)!.targets![0];
    expect(legalTargets(g, 0, spec, byName(g, 0, 'Test Bowl')!).map((r) => (r.kind === 'card' ? permanent(g, r.id)!.name : r.id))).toEqual(['Test Bowl', 'Test Gate']);
    const p = parse('Instant', 'Destroy target creature or enchantment. You lose 2 life.');
    expect(p.ok && p.script.targets).toMatchObject([{ type: 'permanent', label: 'target creature or enchantment' }]);
  });

  it('reads hand size, "can\'t be countered", medallions and a free cast with a commander', () => {
    expect(parse('Artifact', 'You have no maximum hand size.\n{T}: Add {C}.').ok && parse('Artifact', 'You have no maximum hand size.').ok).toBe(true);
    const rend = parse('Sorcery', "This spell can't be countered.\nDestroy target nonland permanent.");
    expect(rend.ok && rend.script.uncounterable).toBe(true);
    teach('Test Medallion', 'Artifact', 'White spells you cast cost {1} less to cast.');
    const g = emptyGame((d) => {
      put(d, 0, 'Test Medallion');
      put(d, 1, 'Test Medallion');
      put(d, 0, 'Angel of Mercy', 'hand');
      put(d, 1, 'Angel of Mercy', 'hand');
    });
    // Player 0's Angel ({4}{W}) costs {1} less for its own Medallion, not for the opponent's.
    expect(castCost(g, byName(g, 0, 'Angel of Mercy', 'hand')!)).toMatchObject({ generic: 3, pips: ['W'] });
    expect(refusal('Artifact', 'White spells you cast cost {1} more to cast.')).not.toBeNull();
    const rollick = parse('Instant', 'If you control a commander, you may cast this spell without paying its mana cost.\nExile target creature.');
    expect(rollick.ok && rollick.script.alternativeCosts).toMatchObject([{ label: 'free: you control a commander', mana: '' }]);
    const maneuver = parse('Instant', 'Creatures you control gain indestructible until end of turn.');
    expect(maneuver.ok).toBe(true);
    expect(refusal('Instant', 'Creatures you control gain shroud until end of turn.')).toMatchObject({ reason: 'can\'t grant "shroud"' });
  });

  it('reads a tutor with a life cost (701.23d)', () => {
    const p = parse('Legendary Creature — Demon', 'Flying, trample\nPay 2 life, Sacrifice another creature: Search your library for a card, put that card into your hand, then shuffle.');
    expect(p.ok && p.script.activated).toMatchObject({ cost: { life: 2, sacrificeOne: { label: 'another creature' } } });
  });
});

// ---------- parsed scripts against hand scripts ----------

/** Pool cards whose hand scripts follow the same wording, to check the parser plays them the same. */
const SAMPLE = [
  // spells
  'Raise the Alarm', 'Revitalize', 'Disenchant', 'Doom Blade', "Night's Whisper", 'Anguished Unmaking', 'Vindicate', 'Murder', 'Sign in Blood',
  "Hero's Downfall", 'Lightning Bolt', 'Shock', 'Lava Axe', 'Shatter', 'Giant Growth', 'Harmonize',
  // "enters" and "dies" triggers
  'Angel of Mercy', 'Inspiring Overseer', 'Attended Knight', 'Vampire Sovereign', 'Ravenous Chupacabra', 'Phyrexian Rager', 'Beetleback Chief',
  'Flametongue Kavu', 'Viashino Pyromancer', 'Meteor Golem', 'Elvish Visionary', 'Pelakka Wurm', 'Captain of the Watch',
  // activated, mana and static abilities
  'Nantuko Shade', 'Shivan Dragon', 'Mogg Fanatic', 'Bloodthrone Vampire', 'Goblin Bombardment', 'Thrashing Brontodon',
  'Sol Ring', 'Thran Dynamo', 'Llanowar Elves', 'Command Tower', 'Glorious Anthem', 'Benalish Marshal', 'Fervor',
  // pain lands, fetch lands, a tutor and more, read since the requested-cards templates
  'Worn Powerstone', 'Ancient Tomb', 'Tarnished Citadel', 'Karplusan Forest', 'Brushland', 'Arid Mesa', 'Misty Rainforest', 'Demonic Tutor',
  'Mortify', 'Collective Blessing', 'Armada Wurm', 'Advent of the Wurm', 'Call of the Conclave',
];

/** Plays a card with whatever script it has now, and sums up the table afterwards. */
function scenario(name: string, parsed: CardScript): unknown {
  const permanentCard = !cardData(name).typeLine.match(/Instant|Sorcery/);
  const onTable = permanentCard && !parsed.onEnter && !parsed.onDies;
  let g = emptyGame((d) => {
    for (const land of ['Plains', 'Swamp', 'Mountain', 'Forest']) put(d, 0, land, 'battlefield', 4);
    put(d, 0, 'Elite Vanguard');
    put(d, 1, 'Serra Angel');
    put(d, 1, 'Sol Ring');
    put(d, 2, 'Typhoid Rats');
    put(d, 0, name, onTable ? 'battlefield' : 'hand');
  });
  const me = byName(g, 0, name, onTable ? 'battlefield' : 'hand')!;
  // A target not on player 0's side if there is one: the first legal one otherwise.
  const pick = (specs: TargetSpec[], source: Card): TargetRef[] =>
    specs.map((spec) => {
      const refs = legalTargets(g, 0, spec, source);
      return refs.find((r) => (r.kind === 'player' ? r.id !== 0 : permanent(g, r.id)?.controller !== 0)) ?? refs[0];
    });
  let action: Action | null;
  if (parsed.mana) action = { type: 'tapMana', card: me.id };
  else if (parsed.activated) {
    const ab = activatedAt(me)!;
    action = { type: 'activate', card: me.id, targets: pick(ab.targets ?? [], me), ...(ab.cost.sacrificeOne ? { sacrifice: [byName(g, 0, 'Elite Vanguard')!.id] } : {}) };
  } else if (onTable) action = null;
  else action = { type: 'cast', card: me.id, targets: pick(spellTargets(me), me) };
  if (action) g = run(g, action);
  // Bots answer anything the card asks, and everyone passes until the stack is empty.
  for (let i = 0; i < 50 && (g.decision || g.stack.length); i++) {
    g = g.decision ? applyBotAction(g, botAction(g, g.priority)) : applyAction(g, { type: 'pass' });
  }
  return summary(g);
}

const summary = (g: Game) =>
  g.players.map((p) => ({
    life: p.life,
    hand: p.hand.length,
    library: p.library.length,
    pool: JSON.stringify(p.pool),
    battlefield: p.battlefield
      .map((c) => {
        const s = stats(g, c);
        return `${c.name}${c.tapped ? ' tapped' : ''}${isCreature(c) ? ` ${s.power}/${s.toughness} ${[...s.keywords].sort().join(',')}` : ''} ${JSON.stringify(c.counters)}`;
      })
      .sort(),
    graveyard: p.graveyard.map((c) => c.name).sort(),
    exile: p.exile.map((c) => c.name).sort(),
  }));

describe('parsed scripts play like the hand scripts', () => {
  it.each(SAMPLE)('%s', (name) => {
    const p = parseCard(cardData(name));
    if (!p.ok) throw new Error(`${name} refused: ${p.clause} (${p.reason})`);
    const hand = scriptOf(name);
    const before = scenario(name, p.script);
    try {
      registerScripts({ [name]: p.script });
      expect(scenario(name, p.script)).toEqual(before);
      // A control: with no script the card does nothing (or can't be used), so the scenario really tests it.
      registerScripts({ [name]: {} });
      let blank: unknown = 'refused';
      try {
        blank = scenario(name, p.script);
      } catch {
        // an ability the card no longer has can't be activated
      }
      expect(blank).not.toEqual(before);
    } finally {
      registerScripts({ [name]: hand });
    }
  });
});

/** Cards players asked for (docs/card-requests.json) that the parser reads, with their real Oracle text from tests/fixtures.generated.json. */
const REQUESTED = [
  'Abandoned Air Temple', 'Arcane Sanctum', 'Black Waltz No. 3', 'Blazemire Verge', 'Bleachbone Verge', 'Bojuka Bog', 'Deadly Rollick',
  'Decanter of Endless Water', 'Drowned Catacomb', 'Dust Bowl', 'Eclipsed Steppe', 'Flawless Maneuver', 'Gilded Lotus', 'Glacial Fortress',
  'Hallowed Fountain', 'Hapless Researcher', 'Haunted Ridge', 'Luxury Suite', 'Meticulous Archive', 'Morphic Pool', 'Pearl Medallion',
  "Raffine's Tower", 'Raucous Theater', 'Razaketh, the Foulblooded', 'Ruby Medallion', 'Sea of Clouds', 'Shadowy Backstreet', 'Shattered Sanctum',
  'Shipwreck Marsh', 'Smoldering Marsh', 'Talisman of Dominance', 'Talisman of Hierarchy', 'Talisman of Indulgence', 'Talisman of Progress',
  'Thought Vessel', 'Turbulent Moor', 'Undercity Sewers', 'Underground River', "Urza's Cave", 'Vault of Champions', 'Void Rend', 'Watery Grave',
  'Withering Torment', 'Wooded Foothills',
];

describe('requested cards', () => {
  it.each(REQUESTED)('reads %s', (name) => {
    const d = (fixtureData as { cards: Record<string, CardData> }).cards[name];
    const p = parseCard(d);
    expect(p.ok ? 'ok' : `${p.clause} (${p.reason})`).toBe('ok');
  });
});

describe('the parse report', () => {
  it('lists every pool card with rules text as scripted or refused with its clause', () => {
    const { scripted, refused } = parseResults();
    expect(scripted).toEqual(expect.arrayContaining(SAMPLE));
    expect(refused.every((r) => r.clause && r.reason)).toBe(true);
    expect(refused.find((r) => r.name === 'Swords to Plowshares')).toMatchObject({ clause: 'its controller gains life equal to its power' });
  });
});
