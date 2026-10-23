// The Oracle text parser (src/cards/oracle.ts): what it reads, what it refuses, and that
// its scripts play the same as the hand scripts of the pool cards it can read.
import { produce } from 'immer';
import { describe, expect, it } from 'vitest';
import { cardData, registerCards } from '../src/cards/db';
import { needsScript, parseCard, scriptCards } from '../src/cards/oracle';
import { parseResults } from '../src/cards/oracle-report';
import { activatedAt, applyAction, applyBotAction, botAction, castCost, createToken, enterBattlefield, gainLife, hasScript, isCreature, isLand, legalTargets, makeCard, manaAbilities, permanent, scriptOf, spellTargets, stats, tap } from '../src/engine';
import type { Action, ActivatedAbility, Card, CardData, CardScript, Ctx, Game, TargetRef, TargetSpec } from '../src/engine';
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
    expect(s('When this creature enters, draw a card.').onEnter).toMatchObject({ text: 'When Test Card enters, draw a card.' });
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
    // A token the list doesn't have is made from its words (111.4), under a key like the listed ones.
    const kraken = parse('Sorcery', 'Create a 7/7 blue Kraken creature token.');
    expect(kraken.ok).toBe(true);
    expect(cardData('Kraken 7/7 U')).toMatchObject({ name: 'Kraken', power: '7', toughness: '7', colors: ['U'], typeLine: 'Token Creature — Kraken' });
    expect(refusal('Sorcery', 'Create a 7/7 blue Krakenling creature token.')).toEqual({ clause: 'create a 7/7 blue krakenling creature token', reason: '"krakenling" isn\'t a creature type' });
  });

  it('refuses the whole card at the first clause it can\'t read, naming it', () => {
    expect(refusal('Creature — Elf', 'Flying\nWhen this creature enters, draw a card.\nWhenever a player casts their second spell each turn, put a +1/+1 counter on Test Card.')).toEqual({
      clause: 'Whenever a player casts their second spell each turn, put a +1/+1 counter on Test Card.',
      reason: 'no template matches',
    });
    // "Instead", conditions and counts it can't read are never approximated.
    expect(refusal('Instant', 'Draw a card for each creature that died this turn.')).not.toBeNull();
    expect(refusal('Instant', 'If you attacked with three creatures this turn, draw two cards.')).not.toBeNull();
    expect(refusal('Instant', 'Target player draws X cards.')).toMatchObject({ reason: 'X outside a cost' });
    expect(refusal('Instant', 'Destroy target creature. Its controller scries 2.')).toMatchObject({ clause: 'its controller scries 2' });
  });

  it('refuses cards with faces, and costs it can\'t pay', () => {
    // Each face is read on its own; one it can't read refuses the card.
    expect(parseCard(cardData('Birgi, God of Storytelling // Harnfel, Horn of Bounty'))).toMatchObject({ ok: false, clause: 'Creatures you control can boast twice during each of your turns rather than once.' });
    expect(refusal('Creature — Elf', 'Exile a creature card from your graveyard: Draw a card.')).toMatchObject({ reason: 'the cost "exile a creature card from your graveyard"' });
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
    teach('Test Lair', 'Land', 'This land enters tapped unless you control three or more other Islands.\n{T}: Add {U}.');
    expect(playTapped('Test Lair', (d) => put(d, 0, 'Island', 'battlefield', 2))).toBe(true);
    expect(playTapped('Test Lair', (d) => put(d, 0, 'Island', 'battlefield', 3))).toBe(false);
    expect(refusal('Land', 'This land enters tapped unless you control three or more other creatures.')).toMatchObject({ reason: 'no template for "unless you control three or more other creatures"' });
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
    const found = g.players[0].battlefield.find((c) => isLand(g, c) && c.name !== 'Plains');
    expect(found?.tapped).toBe(true);
  });

  describe('mana abilities with a mana cost (Signets, filter lands, 605.1a)', () => {
    teach('Test Signet', 'Artifact', '{1}, {T}: Add {W}{U}.', { manaCost: '{2}', cmc: 2 });
    teach('Test Filter', 'Land', '{T}: Add {C}.\n{W/B}, {T}: Add {W}{W}, {W}{B}, or {B}{B}.', { manaCost: '' });
    teach('Test Wastes', 'Land', '{T}: Add {C}.', { manaCost: '' });
    teach('Two Drop', 'Creature — Bird', 'Flying', { manaCost: '{W}{U}', cmc: 2 });
    teach('Black Drop', 'Creature — Rat', 'Menace', { manaCost: '{1}{B}{B}', cmc: 3 });

    it('reads the cost and the exact mana', () => {
      expect(scriptOf('Test Signet').mana).toEqual({ amount: 2, colors: ['W', 'U'], produces: [['W', 'U']], cost: '{1}' });
      expect(scriptOf('Test Filter').mana).toEqual([
        { amount: 1, colors: ['C'] },
        { amount: 2, colors: ['W', 'B'], produces: [['W', 'W'], ['W', 'B'], ['B', 'B']], cost: '{W/B}' },
      ]);
      // A sacrifice instead of {T} (Ashnod's Altar); a cost it can't pay is refused.
      expect(parse('Artifact', 'Sacrifice a creature: Add {C}{C}.')).toMatchObject({ ok: true, script: { mana: { amount: 2, colors: ['C'], noTap: true, sacrificeCreature: true } } });
      expect(refusal('Artifact', 'Sacrifice two creatures: Add {B}.')).toMatchObject({ reason: "a mana ability with a cost the parser can't pay" });
    });

    it('auto-pay uses a Signet only when it must, paying its {1} from another source', () => {
      let g = emptyGame((d) => {
        put(d, 0, 'Test Signet');
        put(d, 0, 'Test Wastes');
        put(d, 0, 'Two Drop', 'hand');
      });
      // {W}{U} from a Signet, its {1} from Wastes: Wastes alone couldn't pay.
      g = run(g, { type: 'cast', card: byName(g, 0, 'Two Drop', 'hand')!.id });
      expect(byName(g, 0, 'Two Drop')).toBeDefined();
      expect(byName(g, 0, 'Test Signet')!.tapped).toBe(true);
      expect(byName(g, 0, 'Test Wastes')!.tapped).toBe(true);
      expect(g.players[0].pool).toEqual([]);
    });

    it('by hand, a filter land makes the mana chosen, and taking it back returns the mana its cost spent', () => {
      let g = emptyGame((d) => {
        put(d, 0, 'Test Filter');
        put(d, 0, 'Swamp');
      });
      const filter = byName(g, 0, 'Test Filter')!.id;
      const swamp = byName(g, 0, 'Swamp')!.id;
      g = run(g, { type: 'tapMana', card: swamp });
      // Only one of the choices it lists: {W}{B}, not {W}{U}.
      expect(applyAction(g, { type: 'tapMana', card: filter, ability: 1, mana: ['W', 'U'] })).toBe(g);
      g = run(g, { type: 'tapMana', card: filter, ability: 1, mana: ['B', 'W'] });
      expect(g.players[0].pool.map((m) => m.sym).sort()).toEqual(['B', 'W']);
      g = run(g, { type: 'untapMana', card: filter });
      // The Swamp's {B} is back, and the Swamp can be taken back in turn.
      expect(g.players[0].pool.map((m) => m.sym)).toEqual(['B']);
      g = run(g, { type: 'untapMana', card: swamp });
      expect(g.players[0].pool).toEqual([]);
      expect(g.players[0].battlefield.filter((c) => c.tapped)).toEqual([]);
    });

    it('takes back a Signet paid for by Sol Ring only while the {C} left over is unspent', () => {
      let g = emptyGame((d) => {
        put(d, 0, 'Test Signet');
        put(d, 0, 'Sol Ring');
      });
      const signet = byName(g, 0, 'Test Signet')!.id;
      g = run(g, { type: 'tapMana', card: signet });
      expect(g.players[0].pool.map((m) => m.sym).sort()).toEqual(['C', 'U', 'W']);
      const back = run(g, { type: 'untapMana', card: signet });
      expect(back.players[0].pool).toEqual([]);
      expect(back.players[0].battlefield.filter((c) => c.tapped)).toEqual([]);
      // Once the {C} is spent, Sol Ring's tap can't be taken back, so neither can the Signet's.
      // (Spending it is something else done, which forgets the games to go back to.)
      const spent = produce(g, (d) => {
        d.players[0].pool = d.players[0].pool.filter((m) => m.sym !== 'C');
        delete d.manaRewind;
      });
      expect(applyAction(spent, { type: 'untapMana', card: signet })).toBe(spent);
    });

    it("takes back a Talisman's coloured mana, and the damage it dealt", () => {
      let g = emptyGame((d) => put(d, 0, 'Talisman of Dominance'));
      const talisman = byName(g, 0, 'Talisman of Dominance')!.id;
      const colourless = run(g, { type: 'tapMana', card: talisman, ability: 0 });
      expect(run(colourless, { type: 'untapMana', card: talisman }).players[0].pool).toEqual([]);
      g = run(g, { type: 'tapMana', card: talisman, ability: 1, mana: ['B'] });
      expect(g.players[0].life).toBe(39);
      g = run(g, { type: 'untapMana', card: talisman });
      expect([g.players[0].life, g.players[0].pool, byName(g, 0, 'Talisman of Dominance')!.tapped]).toEqual([40, [], false]);
    });

    it('takes back a Lotus Petal: it comes back from the graveyard', () => {
      let g = emptyGame((d) => put(d, 0, 'Lotus Petal'));
      const petal = byName(g, 0, 'Lotus Petal')!.id;
      g = run(g, { type: 'tapMana', card: petal, color: 'G' });
      expect([g.players[0].pool.map((m) => m.sym), g.players[0].graveyard.map((c) => c.id)]).toEqual([['G'], [petal]]);
      // Gone from the battlefield, it is named by id, as Ctrl+Z does.
      g = run(g, { type: 'untapMana', card: petal });
      expect([g.players[0].pool, g.players[0].graveyard, byName(g, 0, 'Lotus Petal')?.zone]).toEqual([[], [], 'battlefield']);
    });

    it('goes back only while the player has done nothing but use mana abilities', () => {
      let g = emptyGame((d) => {
        put(d, 0, 'Talisman of Dominance');
        put(d, 0, 'Sol Ring', 'hand'); // {1}
      });
      const talisman = byName(g, 0, 'Talisman of Dominance')!.id;
      g = run(g, { type: 'tapMana', card: talisman, ability: 1, mana: ['B'] });
      expect(g.manaRewind?.length).toBe(1);
      g = run(g, { type: 'cast', card: byName(g, 0, 'Sol Ring', 'hand')!.id });
      expect(g.manaRewind).toBeUndefined();
      expect(applyAction(g, { type: 'untapMana', card: talisman })).toBe(g);
    });

    it("a Signet can't pay its own {1}", () => {
      const g = emptyGame((d) => {
        put(d, 0, 'Test Signet');
        put(d, 0, 'Two Drop', 'hand');
      });
      expect(applyAction(g, { type: 'cast', card: byName(g, 0, 'Two Drop', 'hand')!.id })).toBe(g);
    });

    it('a filter land turns one coloured mana into two', () => {
      let g = emptyGame((d) => {
        put(d, 0, 'Test Filter');
        put(d, 0, 'Swamp');
        put(d, 0, 'Test Wastes');
        put(d, 0, 'Black Drop', 'hand');
      });
      // Swamp pays {W/B}, the filter land adds {B}{B}, Wastes pays the {1}.
      g = run(g, { type: 'cast', card: byName(g, 0, 'Black Drop', 'hand')!.id });
      expect(byName(g, 0, 'Black Drop')).toBeDefined();
      expect(g.players[0].battlefield.filter((c) => c.tapped)).toHaveLength(3);
    });

    it('by hand, a Signet takes its {1} from the pool or a land first', () => {
      let g = emptyGame((d) => {
        put(d, 0, 'Test Signet');
        put(d, 0, 'Test Wastes');
      });
      g = run(g, { type: 'tapMana', card: byName(g, 0, 'Test Signet')!.id });
      expect(g.players[0].pool.map((m) => m.sym).sort()).toEqual(['U', 'W']);
      expect(byName(g, 0, 'Test Wastes')!.tapped).toBe(true);
      // Taking it back untaps the land that paid its {1} as well.
      g = run(g, { type: 'untapMana', card: byName(g, 0, 'Test Signet')!.id });
      expect(g.players[0].pool).toEqual([]);
      expect(g.players[0].battlefield.filter((c) => c.tapped)).toEqual([]);
    });
  });
});

describe('more effects and static lines from Oracle text', () => {
  it('reads "draw, then discard", and an effect after it waits for the discard (608.2c)', () => {
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
    teach('Test Loot', 'Sorcery', 'Draw a card, then discard a card. You gain 1 life.');
    g = emptyGame((d) => {
      d.players[0].isBot = false;
      d.players[0].you = true;
      put(d, 0, 'Test Loot', 'hand');
      put(d, 0, 'Plains', 'battlefield');
      put(d, 0, 'Plains', 'hand');
    });
    g = run(g, { type: 'cast', card: byName(g, 0, 'Test Loot', 'hand')!.id });
    for (let i = 0; i < 6 && g.stack.length && !g.decision; i++) g = applyAction(g, { type: 'pass' });
    // The life is gained only after the discard is chosen, in printed order.
    expect(g.decision).toMatchObject({ type: 'chooseCards' });
    expect(g.players[0].life).toBe(40);
    g = run(g, { type: 'chooseCards', cards: [byName(g, 0, 'Plains', 'hand')!.id] });
    expect(g.players[0].life).toBe(41);
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

  it('reads additional costs: discard a card or pay N life (118.8), and a discard cost on an ability', () => {
    const read = (text: string, typeLine = 'Sorcery') => parseCard(fake('Test Cost', typeLine, text));
    expect(read('As an additional cost to cast this spell, discard a card.\nDraw two cards.')).toMatchObject({ ok: true, script: { additionalCost: { discard: 1 } } });
    expect(read('As an additional cost to cast this spell, pay 3 life.\nDraw two cards.')).toMatchObject({ ok: true, script: { additionalCost: { life: 3 } } });
    // X outside a cost the parser reads is refused.
    expect(read('As an additional cost to cast this spell, pay X life.\nDraw a card.')).toMatchObject({ ok: false });
    const ab = read('{T}, Discard a card: Draw a card.', 'Artifact');
    expect(ab.ok && (ab.script.activated as ActivatedAbility).cost).toEqual({ tap: true, discard: 1 });
  });

  it('reads Prowess, alone or with other keywords (702.108a)', () => {
    teach('Test Monk', 'Creature — Human Monk', 'Flying, prowess', { keywords: ['Flying', 'Prowess'], power: '1', toughness: '1' });
    let g = emptyGame((d) => {
      put(d, 0, 'Test Monk');
      put(d, 0, 'Shock', 'hand');
      put(d, 0, 'Mountain');
    });
    g = run(g, { type: 'cast', card: byName(g, 0, 'Shock', 'hand')!.id, targets: [{ kind: 'player', id: 1 }] });
    for (let i = 0; i < 20 && (g.decision || g.stack.length); i++) g = g.decision ? applyBotAction(g, botAction(g, g.priority)) : applyAction(g, { type: 'pass' });
    expect(stats(g, byName(g, 0, 'Test Monk')!)).toMatchObject({ power: 2, toughness: 2 });
    // Two abilities on one event are a list, each triggering on its own (603.2).
    const two = parseCard(fake('Test Monk 2', 'Creature', 'Prowess\nWhenever you cast a noncreature spell, draw a card.'));
    expect(two.ok && two.script.onCast).toHaveLength(2);
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
    const spec = activatedAt(g, byName(g, 0, 'Test Bowl')!)!.targets![0];
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
    expect(refusal('Artifact', 'White spells you cast cost {1} less to cast for each artifact you control.')).not.toBeNull();
    const rollick = parse('Instant', 'If you control a commander, you may cast this spell without paying its mana cost.\nExile target creature.');
    expect(rollick.ok && rollick.script.alternativeCosts).toMatchObject([{ label: 'free: you control a commander', mana: '' }]);
    const maneuver = parse('Instant', 'Creatures you control gain indestructible until end of turn.');
    expect(maneuver.ok).toBe(true);
    expect(refusal('Instant', 'Creatures you control gain banding until end of turn.')).toMatchObject({ reason: 'can\'t grant "banding"' });
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
  // read since the corpus templates (session 2 of the speed-parser-polish plan)
  'Abandoned Air Temple', 'Academy Ruins', 'Acidic Slime', 'Angel of the Dawn', 'Angel of the Ruins', 'Arcane Sanctum', 'Arcane Signet',
  'Ashen Rider', 'Avacyn, Angel of Hope', 'Avenger of Zendikar', 'Azorius Signet', 'Baleful Strix', 'Beast Within', 'Bedevil', "Bender's Waterskin",
  'Blasphemous Act', 'Blazemire Verge', 'Bleachbone Verge', 'Bloodstained Mire', 'Borne Upon a Wind', 'Brain Freeze', 'Brute Strength',
  'Caves of Koilos', 'Cephalid Coliseum', 'Circle of Power', 'City of Brass', 'Dark Ritual', 'Deadly Rollick', 'Decanter of Endless Water',
  'Decorum Dissertation', 'Deserted Beach', 'Dig Through Time', 'Dimir Signet', 'Dismember', "Domri's Ambush", 'Dragonskull Summit', 'Dreadbore',
  'Drowned Catacomb', 'Dusk Legion Zealot', 'Dust Bowl', 'Elvish Mystic', 'Emergence Zone', 'Farhaven Elf', 'Fetid Heath', 'Flame Rift',
  'Flawless Maneuver', 'Flooded Strand', 'Floodfarm Verge', 'Furnace Whelp', 'Gilded Lotus', 'Glacial Fortress', 'Gloomlake Verge',
  'Go for the Throat', 'Grave Titan', 'Graven Cairns', 'Gray Merchant of Asphodel', "Hall of Heliod's Generosity", 'Haunted Ridge',
  'Inspired Charge', 'Isolated Chapel', 'Judith, the Scourge Diva', 'Lightning Greaves', 'Lightning Strike', 'Lingering Souls', 'Lotus Petal',
  'Luxury Suite', 'Mana Confluence', 'Manalith', 'Marsh Flats', 'Massacre Wurm', 'Merfolk Looter', 'Morphic Pool', 'Mystic Gate', 'Nekrataal',
  'Nightmare', 'Orzhov Signet', 'Otawara, Soaring City', 'Overrun', 'Path to Exile', 'Phyrexian Tower', 'Polluted Delta', 'Pyroclasm',
  'Raging Swordtooth', 'Rampant Growth', 'Reclamation Sage', 'Relic of Legends', 'Rootborn Defenses', 'Rootbound Crag', 'Scalding Tarn',
  'Scion of Vitu-Ghazi', 'Sea of Clouds', 'Shamanic Revelation', 'Shattered Sanctum', 'Shipwreck Marsh', 'Snapback', 'Snuff Out',
  'Solemn Simulacrum', 'Spire of Industry', 'Stock Up', 'Sulfurous Springs', 'Sundering Growth', 'Sunken Ruins', 'Sunpetal Grove',
  'Swords to Plowshares', 'Syphon Soul', 'Takenuma, Abandoned Mire', 'Talisman of Dominance', 'Talisman of Hierarchy', 'Talisman of Indulgence',
  'Talisman of Progress', 'Terminate', 'The Battle of Bywater', 'Thermo-Alchemist', 'Thought Courier', 'Thought Vessel', 'Thundermaw Hellkite',
  "Trostani's Summoner", "Trostani, Selesnya's Voice", "Urza's Cave", 'Utter End', 'Vault of Champions', 'Verdant Catacombs',
  'Vito, Thorn of the Dusk Rose', 'Void Rend', "Wayfarer's Bauble", 'Wheel of Fortune', 'Windswept Heath', 'Withering Torment', 'Wooded Foothills',
  'Zealous Persecution',
];

/** Plays a card with whatever script it has now, and sums up the table afterwards. */
export function scenarioFor(name: string, parsed: CardScript): unknown {
  return scenario(name, parsed);
}
function scenario(name: string, parsed: CardScript): unknown {
  const permanentCard = !cardData(name).typeLine.match(/Instant|Sorcery/);
  const onTable = permanentCard && !parsed.onEnter && !parsed.onDies;
  let g = emptyGame((d) => {
    for (const land of ['Plains', 'Swamp', 'Mountain', 'Forest', 'Island']) put(d, 0, land, 'battlefield', 4);
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
    const ab = activatedAt(g, me)!;
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
        return `${c.name}${c.tapped ? ' tapped' : ''}${isCreature(g, c) ? ` ${s.power}/${s.toughness} ${[...s.keywords].sort().join(',')}` : ''} ${JSON.stringify(c.counters)}`;
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
  'Abandoned Air Temple', 'Arcane Sanctum', 'Big Score', 'Unexpected Windfall', 'Black Waltz No. 3', 'Blazemire Verge', 'Bleachbone Verge', 'Bojuka Bog', 'Deadly Rollick',
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
    expect(refused.find((r) => r.name === 'Ad Nauseam')).toMatchObject({ clause: 'reveal the top card of your library' });
  });
});

// ---------- the general gaps: lists of triggers, ability words, faces, tokens, targets, groups ----------

/** Passes priority, bots answering anything asked, until the stack is empty and nothing is being decided. */
function settle(g: Game): Game {
  for (let i = 0; i < 60 && (g.decision || g.stack.length); i++) g = g.decision ? applyBotAction(g, botAction(g, g.priority)) : applyAction(g, { type: 'pass' });
  return g;
}
const p = (id: number): TargetRef => ({ kind: 'player', id });
const cardRef = (id: string): TargetRef => ({ kind: 'card', id });

describe('several abilities on one event, ability words (207.2c)', () => {
  it('two "enters" abilities each trigger (603.2), with their own targets', () => {
    teach('Twin Herald', 'Creature — Human', 'When this creature enters, you gain 2 life.\nWhen this creature enters, it deals 1 damage to any target.');
    expect(scriptOf('Twin Herald').onEnter).toHaveLength(2);
    let g = emptyGame((d) => {
      put(d, 0, 'Twin Herald', 'hand');
      put(d, 0, 'Plains');
    });
    g = settle(run(g, { type: 'cast', card: byName(g, 0, 'Twin Herald', 'hand')!.id }));
    expect(g.players[0].life).toBe(42);
    expect(g.players.slice(1).reduce((n, x) => n + x.life, 0)).toBe(3 * 40 - 1);
    expect(refusal('Creature — Human', 'When this creature enters or becomes tapped, draw a card.')).toMatchObject({ reason: 'no template matches' });
  });

  it('reads past an ability word, and refuses a label that isn\'t one', () => {
    teach('Test Baloth', 'Creature — Beast', 'Landfall — Whenever a land you control enters, you gain 1 life.');
    let g = emptyGame((d) => {
      put(d, 0, 'Test Baloth');
      put(d, 0, 'Forest', 'hand');
      put(d, 1, 'Test Baloth');
    });
    g = settle(run(g, { type: 'playLand', card: byName(g, 0, 'Forest', 'hand')!.id }));
    // Only its controller's land counts.
    expect(g.players.map((x) => x.life)).toEqual([41, 40, 40, 40]);
    expect(refusal('Creature — Beast', 'Seafaring — Whenever a land you control enters, you gain 1 life.')).toMatchObject({ reason: 'no template matches' });
  });
});

describe('cards with faces (712, 715)', () => {
  const mdfc = (name: string, front: string, back: string): CardData => {
    const a = fake(`${name} Spell`, 'Instant', front, { manaCost: '{1}{B}', cmc: 2, colors: ['B'] });
    const b = fake(`${name} Mire`, 'Land', back, { manaCost: '', cmc: 0, power: undefined, toughness: undefined });
    return { ...a, name: `${a.name} // ${b.name}`, layout: 'modal_dfc', faces: [a, b] };
  };

  it('reads each face on its own and registers a script for each face name', () => {
    registerCards({ 'Test Rebirth Spell // Test Rebirth Mire': mdfc('Test Rebirth', 'Destroy target creature.', "As this land enters, you may pay 3 life. If you don't, it enters tapped.\n{T}: Add {B}.") });
    expect(scriptCards(['Test Rebirth Spell // Test Rebirth Mire'])).toEqual([]);
    expect(scriptOf('Test Rebirth Spell').targets).toMatchObject([{ type: 'creature' }]);
    expect(scriptOf('Test Rebirth Mire').mana).toEqual({ amount: 1, colors: ['B'] });
    // Played as its land face, it asks for the 3 life (614.12a).
    let g = emptyGame((d) => {
      d.players[0].isBot = false;
      d.players[0].you = true;
      put(d, 0, 'Test Rebirth Spell // Test Rebirth Mire', 'hand');
    });
    g = run(g, { type: 'playLand', card: g.players[0].hand[0].id, face: 1 });
    expect(g.decision).toMatchObject({ type: 'ask', choice: { life: 3 } });
    g = run(g, { type: 'answer', yes: true });
    expect(g.players[0].life).toBe(37);
    expect(g.players[0].battlefield.find((c) => c.face === 1)?.tapped).toBe(false);
  });

  it('refuses the card when one face has a clause it can\'t read', () => {
    const d = mdfc('Test Broken', 'Destroy target creature. Its controller scries 2.', 'This land enters tapped.\n{T}: Add {B}.');
    expect(parseCard(d)).toMatchObject({ ok: false, clause: 'its controller scries 2' });
  });
});

describe('tokens the text describes (111.4)', () => {
  it('makes a token from its words, with keywords the engine knows', () => {
    teach('Test Muster', 'Sorcery', 'Create two 2/2 black Zombie Knight creature tokens with menace.');
    let g = emptyGame((d) => {
      put(d, 0, 'Test Muster', 'hand');
      put(d, 0, 'Swamp');
    });
    g = settle(run(g, { type: 'cast', card: byName(g, 0, 'Test Muster', 'hand')!.id }));
    const made = g.players[0].battlefield.filter((c) => c.isToken);
    expect(made).toHaveLength(2);
    expect(stats(g, made[0])).toMatchObject({ power: 2, toughness: 2 });
    expect(stats(g, made[0]).keywords.has('menace')).toBe(true);
    expect(cardData(made[0].name).typeLine).toBe('Token Creature — Zombie Knight');
  });

  it('uses the listed token when the words match one, so its art shows', () => {
    const q = parse('Sorcery', 'Create a 3/3 green Beast creature token.');
    expect(q.ok).toBe(true);
    let g = emptyGame((d) => put(d, 0, 'Forest'));
    registerCards({ 'Test Beast Call': fake('Test Beast Call', 'Sorcery', 'Create a 3/3 green Beast creature token.') });
    scriptCards(['Test Beast Call']);
    g = produce(g, (d) => void put(d, 0, 'Test Beast Call', 'hand'));
    g = settle(run(g, { type: 'cast', card: byName(g, 0, 'Test Beast Call', 'hand')!.id }));
    expect(g.players[0].battlefield.find((c) => c.isToken)?.name).toBe('Beast 3/3');
  });

  it('reads a token\'s quoted ability with the parser, and refuses one it can\'t read', () => {
    teach('Test Spawner', 'Sorcery', 'Create a 0/1 colorless Eldrazi Spawn creature token with "Sacrifice this token: Add {C}."');
    let g = emptyGame((d) => {
      put(d, 0, 'Test Spawner', 'hand');
      put(d, 0, 'Plains');
    });
    g = settle(run(g, { type: 'cast', card: byName(g, 0, 'Test Spawner', 'hand')!.id }));
    const spawn = g.players[0].battlefield.find((c) => c.isToken)!;
    g = run(g, { type: 'tapMana', card: spawn.id });
    expect(g.players[0].pool.map((m) => m.sym)).toEqual(['C']);
    expect(byName(g, 0, spawn.name)).toBeUndefined();
    expect(refusal('Sorcery', 'Create a 1/1 red Goblin creature token with "This token gets +1/+1 for each opponent who blocked this turn."')).not.toBeNull();
    expect(refusal('Sorcery', 'Create an X/X green Ooze creature token.')).toMatchObject({ reason: 'no token the parser can make is "x/x green ooze creature"' });
  });
});

describe('targets and groups (115, 609)', () => {
  it('"up to two target", lists of types, and qualities like power and attacking (115.1)', () => {
    teach('Test Shatter Pair', 'Sorcery', 'Destroy up to two target artifacts.');
    expect(scriptOf('Test Shatter Pair').targets).toMatchObject([{ optional: true }, { optional: true, distinctFrom: 0 }]);
    let g = emptyGame((d) => {
      put(d, 0, 'Test Shatter Pair', 'hand');
      put(d, 0, 'Mountain', 'battlefield', 2);
      put(d, 1, 'Sol Ring', 'battlefield', 2);
    });
    const rings = g.players[1].battlefield.filter((c) => c.name === 'Sol Ring').map((c) => cardRef(c.id));
    g = settle(run(g, { type: 'cast', card: byName(g, 0, 'Test Shatter Pair', 'hand')!.id, targets: rings }));
    expect(g.players[1].battlefield.filter((c) => c.name === 'Sol Ring')).toHaveLength(0);

    teach('Test Bedevil', 'Instant', 'Destroy target artifact, creature, or planeswalker with mana value 3 or less.');
    const h = emptyGame((d) => {
      put(d, 0, 'Test Bedevil', 'hand');
      put(d, 1, 'Sol Ring');
      put(d, 1, 'Elite Vanguard');
      put(d, 1, 'Serra Angel');
      put(d, 1, 'Plains');
    });
    const spec = scriptOf('Test Bedevil').targets![0];
    const names = legalTargets(h, 0, spec, byName(h, 0, 'Test Bedevil', 'hand')!).map((r) => (r.kind === 'card' ? permanent(h, r.id)!.name : r.id));
    expect(names.sort()).toEqual(['Elite Vanguard', 'Sol Ring']);
    expect(refusal('Sorcery', 'Destroy up to three target artifacts.')).toMatchObject({ reason: 'three or more targets that must all be different' });
    expect(refusal('Sorcery', 'Destroy target artifact that was dealt damage this turn.')).not.toBeNull();
  });

  it('counters a spell, and "unless its controller pays" asks that player (701.6, 118.12a)', () => {
    teach('Test Negate', 'Instant', 'Counter target noncreature spell unless its controller pays {2}.');
    const cast = (lands: number) => {
      let g = emptyGame((d) => {
        put(d, 0, 'Shock', 'hand');
        put(d, 0, 'Mountain', 'battlefield', lands);
        put(d, 1, 'Test Negate', 'hand');
        put(d, 1, 'Island', 'battlefield', 2);
      });
      g = run(g, { type: 'cast', card: byName(g, 0, 'Shock', 'hand')!.id, targets: [p(1)], hold: true }, { type: 'pass' });
      g = run(g, { type: 'cast', card: byName(g, 1, 'Test Negate', 'hand')!.id, targets: [{ kind: 'stack', id: g.stack[0].id }] });
      return settle(g).players[1].life;
    };
    // With mana to spare the bot pays and Shock resolves; without, it is countered.
    expect(cast(6)).toBe(38);
    expect(cast(1)).toBe(40);
    expect(refusal('Instant', 'Counter target spell unless its controller sacrifices a creature.')).not.toBeNull();
  });

  it('acts on every object a group names, as one event (609, 603.2c)', () => {
    teach('Test Sweep', 'Sorcery', 'Destroy all creatures with power 2 or less.');
    let g = emptyGame((d) => {
      put(d, 0, 'Test Sweep', 'hand');
      put(d, 0, 'Plains');
      put(d, 0, 'Elite Vanguard');
      put(d, 1, 'Typhoid Rats');
      put(d, 1, 'Serra Angel');
    });
    g = settle(run(g, { type: 'cast', card: byName(g, 0, 'Test Sweep', 'hand')!.id }));
    expect(battlefieldNames(g)).toEqual(['Plains', 'Serra Angel']);
    teach('Test Quake', 'Sorcery', 'Test Quake deals 2 damage to each creature and each player.');
    g = emptyGame((d) => {
      put(d, 0, 'Test Quake', 'hand');
      put(d, 0, 'Mountain');
      put(d, 0, 'Elite Vanguard');
      put(d, 1, 'Serra Angel');
    });
    g = settle(run(g, { type: 'cast', card: byName(g, 0, 'Test Quake', 'hand')!.id }));
    expect(g.players.map((x) => x.life)).toEqual([38, 38, 38, 38]);
    expect(battlefieldNames(g)).toEqual(['Mountain', 'Serra Angel']);
    expect(refusal('Sorcery', 'Destroy all creatures that attacked this turn.')).not.toBeNull();
  });

  it('"each opponent sacrifices a creature of their choice", each choosing in turn (701.21a, 101.4)', () => {
    teach('Test Edict', 'Sorcery', 'Each opponent sacrifices a creature of their choice.');
    let g = emptyGame((d) => {
      put(d, 0, 'Test Edict', 'hand');
      put(d, 0, 'Swamp');
      put(d, 1, 'Elite Vanguard');
      put(d, 1, 'Serra Angel');
      put(d, 2, 'Typhoid Rats');
    });
    g = settle(run(g, { type: 'cast', card: byName(g, 0, 'Test Edict', 'hand')!.id }));
    expect(battlefieldNames(g)).toEqual(['Serra Angel', 'Swamp']);
    expect(refusal('Sorcery', 'Each opponent sacrifices a creature with the greatest power among creatures they control.')).not.toBeNull();
  });

  it('remembers the object acted on: "its controller gains life equal to its power" (608.2h)', () => {
    teach('Test Plow', 'Instant', 'Exile target creature. Its controller gains life equal to its power.');
    let g = emptyGame((d) => {
      put(d, 0, 'Test Plow', 'hand');
      put(d, 0, 'Plains');
      put(d, 1, 'Serra Angel');
    });
    g = settle(run(g, { type: 'cast', card: byName(g, 0, 'Test Plow', 'hand')!.id, targets: [cardRef(byName(g, 1, 'Serra Angel')!.id)] }));
    expect(g.players[1].life).toBe(44);
    expect(refusal('Instant', 'Its controller gains 3 life.')).toMatchObject({ reason: '"its controller" without an object before it' });
  });
});

const battlefieldNames = (g: Game) => g.players.flatMap((x) => x.battlefield.map((c) => c.name)).sort();

// ---------- the corpus templates: searches, choices, payments, costs, statics, triggers, modes ----------

/** A game where player 0 is a person, so their choices wait for an answer. */
const humanGame = (setup: (g: Game) => void) =>
  emptyGame((d) => {
    d.players[0].isBot = false;
    d.players[0].you = true;
    setup(d);
  });

describe('searches and choices made as an effect resolves (701.23, 608.2c)', () => {
  it('searches into the graveyard, for several cards, and with X (701.23)', () => {
    teach('Test Entomb', 'Instant', 'Search your library for a card, put that card into your graveyard, then shuffle.');
    let g = emptyGame((d) => {
      put(d, 0, 'Test Entomb', 'hand');
      put(d, 0, 'Swamp');
      d.players[0].library.unshift(makeCard(d, 'Serra Angel', 0, 'library'));
    });
    const library = g.players[0].library.length;
    g = settle(run(g, { type: 'cast', card: byName(g, 0, 'Test Entomb', 'hand')!.id }));
    expect(g.players[0].graveyard.map((c) => c.name).sort()).toEqual([expect.any(String), 'Test Entomb'].sort((a, b) => (a === 'Test Entomb' ? 1 : -1) - (b === 'Test Entomb' ? 1 : -1)));
    expect(g.players[0].library).toHaveLength(library - 1);
    teach('Test Chord', 'Instant', 'Search your library for a creature card with mana value X or less, put it onto the battlefield, then shuffle.', { manaCost: '{X}{G}{G}{G}' });
    expect(refusal('Sorcery', 'Search your library for a creature card with mana value X or less, put it onto the battlefield, then shuffle.')).toMatchObject({ reason: 'X outside a cost' });
    expect(refusal('Sorcery', 'Search your library for two creature cards, put them into your hand, then shuffle.')).not.toBeNull();
  });

  it('Cultivate: one search, one land onto the battlefield tapped and the other into the hand', () => {
    teach('Test Cultivate', 'Sorcery', 'Search your library for up to two basic land cards, reveal those cards, put one onto the battlefield tapped and the other into your hand, then shuffle.');
    let g = humanGame((d) => {
      put(d, 0, 'Test Cultivate', 'hand');
      put(d, 0, 'Forest', 'battlefield');
      put(d, 0, 'Swamp', 'library', 2);
    });
    g = run(g, { type: 'cast', card: byName(g, 0, 'Test Cultivate', 'hand')!.id });
    for (let i = 0; i < 6 && g.stack.length && !g.decision; i++) g = applyAction(g, { type: 'pass' });
    const swamps = g.players[0].library.filter((c) => c.name === 'Swamp').map((c) => c.id);
    g = run(g, { type: 'chooseCards', cards: swamps.slice(0, 2) });
    expect(g.decision).toMatchObject({ type: 'chooseCards', choice: { text: 'put one onto the battlefield tapped (the other goes into your hand)' } });
    g = run(g, { type: 'chooseCards', cards: [swamps[0]] });
    expect(byName(g, 0, 'Swamp')?.tapped).toBe(true);
    expect(byName(g, 0, 'Swamp', 'hand')).toBeDefined();
  });

  it('"return a land you control to its owner\'s hand" is chosen, not targeted (bounce lands)', () => {
    teach('Test Karoo', 'Land', 'This land enters tapped.\nWhen this land enters, return a land you control to its owner\'s hand.\n{T}: Add {G}{U}.');
    let g = emptyGame((d) => {
      put(d, 0, 'Test Karoo', 'hand');
      put(d, 0, 'Forest');
    });
    g = settle(run(g, { type: 'playLand', card: byName(g, 0, 'Test Karoo', 'hand')!.id }));
    expect(g.players[0].battlefield.filter((c) => isLand(g, c))).toHaveLength(1);
    expect(g.players[0].hand.filter((c) => isLand(g, c))).toHaveLength(1);
    expect(refusal('Land', 'When this land enters, return a land an opponent controls to its owner\'s hand.')).not.toBeNull();
  });

  it('scry puts cards on the bottom, then the next effect happens (701.22a)', () => {
    teach('Test Opt', 'Instant', 'Scry 2, then draw a card.');
    let g = humanGame((d) => {
      put(d, 0, 'Test Opt', 'hand');
      put(d, 0, 'Island');
    });
    const [a, b] = g.players[0].library;
    g = run(g, { type: 'cast', card: byName(g, 0, 'Test Opt', 'hand')!.id });
    for (let i = 0; i < 6 && g.stack.length && !g.decision; i++) g = applyAction(g, { type: 'pass' });
    expect(g.decision).toMatchObject({ type: 'chooseCards', choice: { text: 'scry 2: put any on the bottom of your library' } });
    g = run(g, { type: 'chooseCards', cards: [a.id] });
    // The other card stays on top and is the one drawn.
    expect(g.players[0].hand.map((c) => c.id)).toEqual([b.id]);
    expect(g.players[0].library[g.players[0].library.length - 1].id).toBe(a.id);
    expect(refusal('Instant', 'Scry X.')).toMatchObject({ reason: 'X outside a cost' });
  });

  it('"look at the top N, put K into your hand and the rest on the bottom" (401.4)', () => {
    teach('Test Stock', 'Sorcery', 'Look at the top five cards of your library. Put two of them into your hand and the rest on the bottom of your library in a random order.');
    let g = emptyGame((d) => {
      put(d, 0, 'Test Stock', 'hand');
      put(d, 0, 'Island');
    });
    const top = g.players[0].library.slice(0, 5).map((c) => c.id);
    g = settle(run(g, { type: 'cast', card: byName(g, 0, 'Test Stock', 'hand')!.id }));
    expect(g.players[0].hand).toHaveLength(2);
    expect(g.players[0].hand.every((c) => top.includes(c.id))).toBe(true);
    expect(g.players[0].library.slice(-3).every((c) => top.includes(c.id))).toBe(true);
    expect(refusal('Sorcery', 'Look at the top five cards of your library. Put two of them into your hand and the rest into your graveyard.')).not.toBeNull();
  });
});

describe('payments: "unless that player pays", "you may pay ... if you do" (118.12)', () => {
  it('asks the player who would pay first, then the "you may" (118.12a)', () => {
    teach('Test Study', 'Enchantment', 'Whenever an opponent casts a spell, you may draw a card unless that player pays {1}.');
    const cast = (mountains: number) => {
      let g = humanGame((d) => {
        put(d, 0, 'Test Study');
        d.active = 1;
        d.priority = 1;
        put(d, 1, 'Shock', 'hand');
        put(d, 1, 'Mountain', 'battlefield', mountains);
      });
      g = run(g, { type: 'cast', card: byName(g, 1, 'Shock', 'hand')!.id, targets: [p(2)] });
      // Bots answer their own questions; it stops at one for player 0.
      for (let i = 0; i < 20 && (g.decision || g.stack.length) && !(g.decision && g.priority === 0); i++) g = g.decision ? applyBotAction(g, botAction(g, g.priority)) : applyAction(g, { type: 'pass' });
      return g;
    };
    // With mana to spare the bot pays, and player 0 is never asked.
    let g = cast(5);
    expect(g.decision).toBeNull();
    // Without, player 0 is asked whether to draw.
    g = cast(1);
    expect(g.decision).toMatchObject({ type: 'ask', choice: { player: 0, text: 'Draw a card?' } });
    expect(refusal('Enchantment', 'Whenever an opponent casts a spell, you may draw a card unless that player sacrifices a creature.')).not.toBeNull();
  });

  it('"you may pay {4}. If you do, untap this artifact" asks with the cost (Mana Vault)', () => {
    teach('Test Vault', 'Artifact', "This artifact doesn't untap during your untap step.\nAt the beginning of your upkeep, you may pay {4}. If you do, untap this artifact.\n{T}: Add {C}{C}{C}.");
    let g = humanGame((d) => {
      put(d, 0, 'Test Vault');
      put(d, 0, 'Plains', 'battlefield', 4);
      d.step = 'untap';
      d.turn = 1;
    });
    g = produce(g, (d) => {
      d.players[0].battlefield.find((c) => c.name === 'Test Vault')!.tapped = true;
    });
    expect(scriptOf('Test Vault').noUntap).toBe(true);
    const ab = (scriptOf('Test Vault').onUpkeep as { resolve: (g: Game, c: Ctx) => void }).resolve;
    g = produce(g, (d) => ab(d, { self: d.players[0].battlefield.find((c) => c.name === 'Test Vault')!, you: 0, targets: [] }));
    expect(g.choices[0] ?? g.decision).toMatchObject({ kind: 'ask', cost: '{4}', text: 'Pay {4} to untap Test Vault?' });
    expect(refusal('Artifact', 'At the beginning of your upkeep, you may pay {X}. If you do, untap this artifact.')).not.toBeNull();
  });
});

describe('costs: alternative, overload, reductions, keyword costs (118.9, 702.96, 601.2f)', () => {
  it('an alternative cost of life and a card from the hand (Force of Will)', () => {
    teach('Test Force', 'Instant', 'You may pay 1 life and exile a blue card from your hand rather than pay this spell\'s mana cost.\nCounter target spell.', { manaCost: '{3}{U}{U}' });
    expect(scriptOf('Test Force').alternativeCosts).toMatchObject([{ mana: '', life: 1, exile: { label: 'a blue card' } }]);
    teach('Test Snuff', 'Instant', 'If you control a Swamp, you may pay 4 life rather than pay this spell\'s mana cost.\nDestroy target nonblack creature.');
    const alt = scriptOf('Test Snuff').alternativeCosts![0];
    const g = emptyGame((d) => put(d, 0, 'Test Snuff', 'hand'));
    expect(alt.when!(g, byName(g, 0, 'Test Snuff', 'hand')!)).toBe(false);
    const h = produce(g, (d) => void put(d, 0, 'Swamp'));
    expect(alt.when!(h, byName(h, 0, 'Test Snuff', 'hand')!)).toBe(true);
    expect(refusal('Instant', 'You may discard two cards rather than pay this spell\'s mana cost.\nDraw a card.')).toMatchObject({ reason: 'the alternative cost "discard two cards"' });
  });

  it('overload reads "target" as "each": no targets (702.96b)', () => {
    teach('Test Blast', 'Sorcery', 'Destroy target artifact you don\'t control.\nOverload {4}{R}');
    let g = emptyGame((d) => {
      put(d, 0, 'Test Blast', 'hand');
      put(d, 0, 'Mountain', 'battlefield', 5);
      put(d, 0, 'Sol Ring');
      put(d, 1, 'Sol Ring', 'battlefield', 2);
      put(d, 2, 'Sol Ring');
    });
    g = settle(run(g, { type: 'cast', card: byName(g, 0, 'Test Blast', 'hand')!.id, alt: 0, targets: [] }));
    expect(battlefieldNames(g).filter((n) => n === 'Sol Ring')).toHaveLength(1);
    expect(byName(g, 0, 'Sol Ring')).toBeDefined();
    expect(refusal('Creature — Elf', 'Overload {2}')).not.toBeNull();
  });

  it('cost reductions: "for each" and "where X is" (601.2f)', () => {
    teach('Test Act', 'Sorcery', 'This spell costs {1} less to cast for each creature on the battlefield.\nTest Act deals 13 damage to each creature.', { manaCost: '{8}{R}', cmc: 9 });
    const g = emptyGame((d) => {
      put(d, 0, 'Test Act', 'hand');
      put(d, 0, 'Elite Vanguard', 'battlefield', 2);
      put(d, 1, 'Serra Angel', 'battlefield', 3);
    });
    expect(castCost(g, byName(g, 0, 'Test Act', 'hand')!)).toMatchObject({ generic: 3 });
    teach('Test Ghalta', 'Creature — Dinosaur', 'This spell costs {X} less to cast, where X is the total power of creatures you control.', { manaCost: '{10}{G}{G}', cmc: 12 });
    const h = emptyGame((d) => {
      put(d, 0, 'Test Ghalta', 'hand');
      put(d, 0, 'Serra Angel', 'battlefield', 2);
    });
    expect(castCost(h, byName(h, 0, 'Test Ghalta', 'hand')!)).toMatchObject({ generic: 2 });
    expect(refusal('Sorcery', 'This spell costs {1} less to cast for each creature that died this turn.')).not.toBeNull();
  });

  it('keyword costs: kicker, flashback, escape, ward, offspring, dash, evoke, plot', () => {
    const k = parse('Creature — Elf', 'Kicker {2}{G}\nWhen this creature enters, if it was kicked, draw a card.');
    expect(k.ok && k.script.kicker).toEqual({ mana: '{2}{G}' });
    expect(parse('Sorcery', 'Draw two cards.\nFlashback {3}{U}')).toMatchObject({ ok: true, script: { flashback: '{3}{U}' } });
    expect(parse('Creature — Horror', 'Escape—{2}{B}, Exile three other cards from your graveyard.')).toMatchObject({ ok: true, script: { escape: { mana: '{2}{B}', exile: 3 } } });
    expect(parse('Creature — Horror', 'Ward {2}')).toMatchObject({ ok: true, script: { ward: { mana: '{2}' } } });
    expect(parse('Creature — Horror', 'Ward—Pay 3 life.')).toMatchObject({ ok: true, script: { ward: { life: 3 } } });
    expect(parse('Creature — Mouse', 'Offspring {2}')).toMatchObject({ ok: true, script: { offspring: '{2}' } });
    expect(parse('Creature — Goblin', 'Dash {1}{R}')).toMatchObject({ ok: true, script: { alternativeCosts: [{ mana: '{1}{R}', dash: true }] } });
    expect(parse('Creature — Elemental', 'When this creature enters, draw two cards.\nEvoke {2}{U}')).toMatchObject({ ok: true, script: { alternativeCosts: [{ mana: '{2}{U}', evoke: true }] } });
    expect(parse('Creature — Human', 'Plot {2}{R}')).toMatchObject({ ok: true, script: { plot: '{2}{R}' } });
    expect(refusal('Sorcery', 'Draw two cards.\nFlashback—{1}{U}, Pay 3 life.')).not.toBeNull();
    // A kicked part only when kicked (702.33d).
    teach('Test Kicker Bolt', 'Instant', 'Kicker {R}\nTest Kicker Bolt deals 2 damage to each opponent.\nIf this spell was kicked, you gain 3 life.');
    const cast = (kicked: number) => {
      let g = emptyGame((d) => {
        put(d, 0, 'Test Kicker Bolt', 'hand');
        put(d, 0, 'Mountain', 'battlefield', 3);
      });
      g = settle(run(g, { type: 'cast', card: byName(g, 0, 'Test Kicker Bolt', 'hand')!.id, kicked }));
      return g.players.map((x) => x.life);
    };
    expect(cast(0)).toEqual([40, 38, 38, 38]);
    expect(cast(1)).toEqual([43, 38, 38, 38]);
  });

  it('a mana ability that also does something else is refused (605.1a)', () => {
    expect(refusal('Artifact', '{T}: Add {G}{G}. You gain 2 life.')).toMatchObject({ reason: 'a mana ability that does more than add mana' });
  });
});

describe('static abilities from the corpus (604.3, 613, 614)', () => {
  it('base power and toughness from a count (604.3)', () => {
    teach('Test Nightmare', 'Creature — Nightmare Horse', 'Test Nightmare\'s power and toughness are each equal to the number of Swamps you control.', { power: '*', toughness: '*' });
    const g = emptyGame((d) => {
      put(d, 0, 'Test Nightmare');
      put(d, 0, 'Swamp', 'battlefield', 3);
      put(d, 1, 'Swamp', 'battlefield', 2);
    });
    expect(stats(g, byName(g, 0, 'Test Nightmare')!)).toMatchObject({ power: 3, toughness: 3 });
    expect(refusal('Creature — Horror', "Test Card's power is equal to the number of cards in your library plus two.")).not.toBeNull();
  });

  it('Auras and Equipment: enchant, "enchanted creature gets", "equipped creature has", equip (702.5, 702.6)', () => {
    teach('Test Courage', 'Enchantment — Aura', 'Enchant creature\nEnchanted creature gets +2/+2 and has trample and lifelink.');
    let g = emptyGame((d) => {
      put(d, 0, 'Test Courage', 'hand');
      put(d, 0, 'Plains');
      put(d, 0, 'Elite Vanguard');
    });
    const vanguard = byName(g, 0, 'Elite Vanguard')!;
    g = settle(run(g, { type: 'cast', card: byName(g, 0, 'Test Courage', 'hand')!.id, targets: [cardRef(vanguard.id)] }));
    expect(stats(g, byName(g, 0, 'Elite Vanguard')!)).toMatchObject({ power: 4, toughness: 3 });
    expect([...stats(g, byName(g, 0, 'Elite Vanguard')!).keywords].sort()).toEqual(['lifelink', 'trample']);
    teach('Test Boots', 'Artifact — Equipment', 'Equipped creature has hexproof and haste.\nEquip {1}');
    g = emptyGame((d) => {
      put(d, 0, 'Test Boots');
      put(d, 0, 'Plains');
      put(d, 0, 'Elite Vanguard');
    });
    g = settle(run(g, { type: 'activate', card: byName(g, 0, 'Test Boots')!.id, targets: [cardRef(byName(g, 0, 'Elite Vanguard')!.id)] }));
    expect(stats(g, byName(g, 0, 'Elite Vanguard')!).keywords.has('hexproof')).toBe(true);
    expect(refusal('Enchantment — Aura', 'Enchanted creature gets +2/+2.')).toMatchObject({ reason: 'an Aura without an enchant line' });
    expect(refusal('Enchantment — Aura', 'Enchant creature or player\nEnchanted creature gets +1/+1.')).not.toBeNull();
  });

  it('attack taxes and "during your turn, your opponents can\'t" (508.1g, 101.2)', () => {
    teach('Test Prison', 'Enchantment', "Creatures can't attack you unless their controller pays {2} for each creature they control that's attacking you.");
    const tax = scriptOf('Test Prison').attackTax!;
    const g = emptyGame((d) => put(d, 0, 'Test Prison'));
    const prison = byName(g, 0, 'Test Prison')!;
    expect(tax(g, prison, prison, 0, null)).toBe('{2}');
    expect(tax(g, prison, prison, 1, null)).toBeNull();
    expect(refusal('Enchantment', "Creatures can't attack you unless their controller sacrifices a land.")).not.toBeNull();
  });

  it('counters and tokens doubled, or one more (614.1a)', () => {
    teach('Test Scales', 'Enchantment', 'If one or more +1/+1 counters would be put on a creature you control, that many plus one +1/+1 counters are put on it instead.');
    teach('Test Season', 'Enchantment', 'If an effect would create one or more tokens under your control, it creates twice that many of those tokens instead.\nIf an effect would put one or more counters on a permanent you control, it puts twice that many of those counters on that permanent instead.');
    teach('Test Growth', 'Instant', 'Put a +1/+1 counter on target creature.');
    const grow = (setup: (d: Game) => void) => {
      let g = emptyGame((d) => {
        put(d, 0, 'Test Growth', 'hand');
        put(d, 0, 'Forest');
        put(d, 0, 'Elite Vanguard');
        setup(d);
      });
      g = settle(run(g, { type: 'cast', card: byName(g, 0, 'Test Growth', 'hand')!.id, targets: [cardRef(byName(g, 0, 'Elite Vanguard')!.id)] }));
      return byName(g, 0, 'Elite Vanguard')!.counters['+1/+1'];
    };
    expect(grow(() => {})).toBe(1);
    expect(grow((d) => put(d, 0, 'Test Scales'))).toBe(2);
    expect(grow((d) => put(d, 0, 'Test Season'))).toBe(2);
    expect(grow((d) => put(d, 1, 'Test Season'))).toBe(1);
    expect(refusal('Enchantment', 'If one or more +1/+1 counters would be put on a creature you control, three times that many are put on it instead.')).not.toBeNull();
  });
});

describe('triggers from the corpus (603)', () => {
  it('"whenever equipped creature dies" and "whenever a Dragon you control attacks"', () => {
    teach('Test Clamp', 'Artifact — Equipment', 'Equipped creature gets +1/-1.\nWhenever equipped creature dies, draw two cards.\nEquip {1}');
    let g = emptyGame((d) => {
      put(d, 0, 'Test Clamp');
      put(d, 0, 'Plains');
      put(d, 0, 'Elite Vanguard');
    });
    const hand = g.players[0].hand.length;
    // Elite Vanguard is 2/1: with +1/-1 it dies, and the Clamp draws two.
    g = settle(run(g, { type: 'activate', card: byName(g, 0, 'Test Clamp')!.id, targets: [cardRef(byName(g, 0, 'Elite Vanguard')!.id)] }));
    expect(byName(g, 0, 'Elite Vanguard', 'graveyard')).toBeDefined();
    expect(g.players[0].hand.length).toBe(hand + 2);
    const atarka = parse('Legendary Creature — Dragon', 'Whenever a Dragon you control attacks, it gains double strike until end of turn.');
    expect(atarka.ok && atarka.script.onCreatureAttacks).toMatchObject({ text: 'Whenever a Dragon you control attacks, it gains double strike until end of turn.' });
    expect(refusal('Creature — Dragon', 'Whenever a Dragon you control attacks alone, it gains double strike until end of turn.')).not.toBeNull();
  });

  it('magecraft triggers on a copy too (207.2c), and "whenever an opponent searches"', () => {
    const p2 = parse('Creature — Wizard', 'Magecraft — Whenever you cast or copy an instant or sorcery spell, draw a card.');
    expect(p2.ok && p2.script.onCast && p2.script.onCopy).toBeTruthy();
    const a = parse('Creature — Cleric', 'Whenever an opponent searches their library, you gain 1 life and draw a card.');
    expect(a.ok && a.script.onSearch).toBeTruthy();
    expect(refusal('Creature — Cleric', 'Whenever an opponent searches their library for a land, you gain 1 life.')).not.toBeNull();
  });

  it('"protection from the color of your choice" asks the colour as it resolves (702.16)', () => {
    teach('Test Mother', 'Creature — Human Cleric', '{T}: Target creature you control gains protection from the color of your choice until end of turn.');
    let g = humanGame((d) => {
      put(d, 0, 'Test Mother');
      put(d, 0, 'Elite Vanguard');
    });
    g = run(g, { type: 'activate', card: byName(g, 0, 'Test Mother')!.id, targets: [cardRef(byName(g, 0, 'Elite Vanguard')!.id)] });
    for (let i = 0; i < 6 && g.stack.length && !g.decision; i++) g = applyAction(g, { type: 'pass' });
    expect(g.decision).toMatchObject({ type: 'name', choice: { of: 'color' } });
    g = run(g, { type: 'name', name: 'B' });
    expect(stats(g, byName(g, 0, 'Elite Vanguard')!).keywords.has('protection from black')).toBe(true);
    expect(refusal('Creature — Human Cleric', '{T}: Target creature you control gains protection from the color of its choice until end of turn.')).not.toBeNull();
  });
});

describe('modes with their own targets and choices (700.2)', () => {
  it('each chosen mode gets its own share of the targets, a choice in one included', () => {
    teach('Test Command', 'Instant', 'Choose two —\n• Destroy target artifact.\n• Target player discards a card.\n• Test Command deals 2 damage to any target.');
    let g = humanGame((d) => {
      put(d, 0, 'Test Command', 'hand');
      put(d, 0, 'Mountain', 'battlefield', 2);
      put(d, 1, 'Sol Ring');
      put(d, 0, 'Plains', 'hand');
    });
    const ring = byName(g, 1, 'Sol Ring')!.id;
    // Modes 0 and 1: the artifact, then the player who discards (player 0 here, so the choice waits).
    g = run(g, { type: 'cast', card: byName(g, 0, 'Test Command', 'hand')!.id, modes: [0, 1], targets: [cardRef(ring), p(0)] });
    for (let i = 0; i < 6 && g.stack.length && !g.decision; i++) g = applyAction(g, { type: 'pass' });
    expect(byName(g, 1, 'Sol Ring')).toBeUndefined();
    expect(g.decision).toMatchObject({ type: 'chooseCards' });
    g = run(g, { type: 'chooseCards', cards: [byName(g, 0, 'Plains', 'hand')!.id] });
    expect(byName(g, 0, 'Plains', 'graveyard')).toBeDefined();
    expect(refusal('Instant', 'Choose four —\n• Draw a card.\n• Draw a card.')).toMatchObject({ reason: 'no template matches' });
    expect(refusal('Creature — Elf', 'Choose one —\n• Draw a card.\n• You gain 2 life.')).toMatchObject({ reason: 'a modal ability of a permanent' });
  });
});

describe('mana that may be spent only on some spells (106.6)', () => {
  it('reads "spend this mana only to cast a legendary spell, and that spell can\'t be countered"', () => {
    expect(parse('Creature — Halfling', "{T}: Add one mana of any color. Spend this mana only to cast a legendary spell, and that spell can't be countered.")).toMatchObject({
      ok: true,
      script: { mana: { amount: 1, colors: 'any', legendary: true, uncounterable: true } },
    });
    expect(parse('Artifact', '{T}: Add {C}{C}. Spend this mana only to cast instant and sorcery spells.')).toMatchObject({ ok: true, script: { mana: { types: ['Instant', 'Sorcery'] } } });
    teach('Test Plaza', 'Land', '{T}: Add {C}.\n{T}: Add one mana of any color. Spend this mana only to cast a legendary spell.');
    teach('Test Prism', 'Land', '{T}: Add one mana of any color.');
    // Its coloured mana can't pay for a spell that isn't legendary; unrestricted mana can.
    const cast = (land: string) => {
      const g = emptyGame((d) => {
        put(d, 0, land);
        put(d, 0, 'Plains');
        put(d, 0, 'Two Drop', 'hand');
      });
      return applyAction(g, { type: 'cast', card: byName(g, 0, 'Two Drop', 'hand')!.id }) !== g;
    };
    expect(cast('Test Prism')).toBe(true);
    expect(cast('Test Plaza')).toBe(false);
    expect(refusal('Land', '{T}: Add one mana of any color. Spend this mana only to cast a spell with flying.')).not.toBeNull();
  });
});

describe('conditions as it resolves, "that land", "that player", granted mana (608.2c, 613.1f)', () => {
  it('"Then if you control four or more lands, untap that land" checks as it resolves', () => {
    teach('Test Passage', 'Land', '{T}, Sacrifice this land: Search your library for a basic land card, put it onto the battlefield tapped, then shuffle. Then if you control four or more lands, untap that land.');
    const crack = (lands: number) => {
      let g = emptyGame((d) => {
        put(d, 0, 'Test Passage');
        put(d, 0, 'Plains', 'battlefield', lands);
        d.players[0].library.unshift(makeCard(d, 'Forest', 0, 'library'));
      });
      g = settle(run(g, { type: 'activate', card: byName(g, 0, 'Test Passage')!.id }));
      return byName(g, 0, 'Forest')?.tapped;
    };
    expect(crack(2)).toBe(true);
    expect(crack(3)).toBe(false);
    teach('Test If', 'Sorcery', 'Draw a card. If you control an artifact, draw a card.');
    expect(refusal('Sorcery', 'Draw a card. If you control an artifact, draw two cards instead.')).not.toBeNull();
  });

  it('"That player may search" after destroying an opponent\'s permanent asks its controller (Boseiju)', () => {
    teach('Test Boseiju', 'Instant', 'Destroy target nonbasic land an opponent controls. That player may search their library for a land card with a basic land type, put it onto the battlefield, then shuffle.');
    let g = emptyGame((d) => {
      d.players[1].isBot = false;
      put(d, 0, 'Test Boseiju', 'hand');
      put(d, 0, 'Forest');
      put(d, 1, 'Test Gate');
    });
    g = run(g, { type: 'cast', card: byName(g, 0, 'Test Boseiju', 'hand')!.id, targets: [cardRef(byName(g, 1, 'Test Gate')!.id)] });
    for (let i = 0; i < 10 && g.stack.length && !g.decision; i++) g = applyAction(g, { type: 'pass' });
    expect(byName(g, 1, 'Test Gate')).toBeUndefined();
    expect(g.decision).toMatchObject({ type: 'ask', choice: { player: 1 } });
    expect(refusal('Instant', 'Draw a card. That player may draw a card.')).toMatchObject({ reason: '"that player" without a player to refer to' });
  });

  it('"Lands you control have \'{T}: Add one mana of any color.\'" (Chromatic Lantern)', () => {
    teach('Test Lantern', 'Artifact', 'Lands you control have "{T}: Add one mana of any color."\n{T}: Add one mana of any color.');
    const g = emptyGame((d) => {
      put(d, 0, 'Test Lantern');
      put(d, 0, 'Plains');
      put(d, 1, 'Plains');
    });
    // Its own {W}, and any colour from the Lantern.
    expect(manaAbilities(g, byName(g, 0, 'Plains')!).map((m) => m.colors.length)).toEqual([1, 5]);
    expect(manaAbilities(g, byName(g, 1, 'Plains')!).flatMap((m) => m.colors)).toEqual(['W']);
    expect(refusal('Artifact', 'Lands you control have "{T}: Add one mana of any color. Activate only as a sorcery."')).not.toBeNull();
  });
});

/** `settle`, and triggered abilities waiting to go on the stack too (603.3). */
function settleAll(g: Game): Game {
  for (let i = 0; i < 60 && (g.decision || g.stack.length || g.triggers.length); i++) g = g.decision ? applyBotAction(g, botAction(g, g.priority)) : applyAction(g, { type: 'pass' });
  return g;
}

describe("the tokens group's wordings (EDHREC)", () => {
  it('"if this is the first time this ability has resolved this turn", then "if it\'s the second time" (Omnath): as it resolves (608.2)', () => {
    teach('Test Tally', 'Creature — Human', "Whenever you gain life, draw a card if this is the first time this ability has resolved this turn. If it's the second time, you lose 3 life.");
    let g = emptyGame((d) => void put(d, 0, 'Test Tally'));
    const hand = g.players[0].hand.length;
    g = settleAll(produce(g, (d) => void gainLife(d, 0, 1)));
    expect([g.players[0].hand.length, g.players[0].life]).toEqual([hand + 1, 41]);
    g = settleAll(produce(g, (d) => void gainLife(d, 0, 1)));
    expect([g.players[0].hand.length, g.players[0].life]).toEqual([hand + 1, 39]);
    g = settleAll(produce(g, (d) => void gainLife(d, 0, 1)));
    expect([g.players[0].hand.length, g.players[0].life]).toEqual([hand + 1, 40]);
    // A spell has no "this ability"; "if it's the second time" needs the first.
    expect(refusal('Instant', 'Draw a card if this is the first time this ability has resolved this turn.')).toMatchObject({ reason: 'a spell counting how many times "this ability" has resolved' });
    expect(refusal('Creature — Human', "Whenever you gain life, if it's the second time, draw a card.")).not.toBeNull();
    expect(parse('Creature — Human', 'Whenever you gain life, you gain 1 life. If this is the second time this ability has resolved this turn, draw a card.').ok).toBe(true);
  });

  it('"[This] deals damage to any target equal to the number of Elves you control" (Rin and Seri)', () => {
    teach('Test Pack Leader', 'Creature — Elf', '{T}: This creature deals damage to any target equal to the number of Elves you control.');
    let g = emptyGame((d) => {
      put(d, 0, 'Test Pack Leader');
      put(d, 0, 'Llanowar Elves');
      put(d, 1, 'Llanowar Elves');
    });
    g = settleAll(run(g, { type: 'activate', card: byName(g, 0, 'Test Pack Leader')!.id, targets: [p(1)] }));
    expect(g.players[1].life).toBe(38);
    expect(refusal('Creature — Elf', '{T}: This creature deals damage to any target equal to twice the number of Elves you control.')).not.toBeNull();
  });

  it('"Put target creature card from a graveyard onto the battlefield under its owner\'s control" (Kenrith, 110.2a)', () => {
    teach('Test Recall', 'Sorcery', "Put target creature card from a graveyard onto the battlefield under its owner's control.");
    let g = emptyGame((d) => {
      put(d, 0, 'Test Recall', 'hand');
      put(d, 0, 'Plains');
      put(d, 1, 'Serra Angel', 'graveyard');
    });
    g = settleAll(run(g, { type: 'cast', card: byName(g, 0, 'Test Recall', 'hand')!.id, targets: [cardRef(byName(g, 1, 'Serra Angel', 'graveyard')!.id)] }));
    expect(byName(g, 1, 'Serra Angel')).toBeDefined();
    expect(refusal('Sorcery', "Put target creature card from a graveyard onto the battlefield under target player's control.")).not.toBeNull();
  });

  it('"Whenever this or another nontoken Shrine you control enters" (Go-Shintai): itself, and others', () => {
    teach('Test Shrine Keeper', 'Enchantment Creature — Shrine', 'Whenever this creature or another nontoken Shrine you control enters, you gain 1 life.');
    const enterOne = (g: Game, pid: number) =>
      settleAll(
        produce(g, (d) => {
          d.players[pid].hand.push(makeCard(d, 'Test Shrine Keeper', pid, 'hand'));
          enterBattlefield(d, d.players[pid].hand[d.players[pid].hand.length - 1]);
        }),
      );
    let g = enterOne(emptyGame(), 0);
    expect(g.players[0].life).toBe(41);
    // The second sees itself enter, the first sees another: two triggers.
    g = enterOne(g, 0);
    expect(g.players[0].life).toBe(43);
    // Not another player's.
    g = enterOne(g, 1);
    expect(g.players[0].life).toBe(43);
    expect(refusal('Enchantment Creature — Shrine', 'Whenever this creature or a Shrine you control enters, you gain 1 life.')).not.toBeNull();
  });

  it('"Whenever one or more tokens you control enter" (Marneus Calgar): once for each event (603.2c)', () => {
    teach('Test Tactician Muster', 'Creature — Human', 'Whenever one or more tokens you control enter, you gain 1 life.');
    expect(parse('Creature — Human', 'Whenever one or more other creatures you control enter, you gain 1 life.').ok).toBe(true);
    let g = emptyGame((d) => void put(d, 0, 'Test Tactician Muster'));
    g = settleAll(produce(g, (d) => void createToken(d, 0, 'Soldier', 3)));
    expect(g.players[0].life).toBe(41);
    g = settleAll(produce(g, (d) => void createToken(d, 1, 'Soldier', 3)));
    expect(g.players[0].life).toBe(41);
    expect(refusal('Creature — Human', 'Whenever one or more tokens you control leave the battlefield, you gain 1 life.')).not.toBeNull();
  });

  it('"Whenever a Dwarf you control becomes tapped" (Magda)', () => {
    teach('Test Forge Hand', 'Creature — Dwarf', 'Whenever a Dwarf you control becomes tapped, you gain 1 life.');
    let g = emptyGame((d) => {
      put(d, 0, 'Test Forge Hand');
      put(d, 0, 'Llanowar Elves');
    });
    g = settleAll(produce(g, (d) => void tap(d, byName(d, 0, 'Test Forge Hand')!)));
    g = settleAll(produce(g, (d) => void tap(d, byName(d, 0, 'Llanowar Elves')!)));
    expect(g.players[0].life).toBe(41);
    expect(refusal('Creature — Dwarf', 'Whenever a Dwarf you control becomes untapped, you gain 1 life.')).not.toBeNull();
  });

  it('"Sacrifice five Treasures:", and a search for "an artifact or Dragon card" (Magda, 701.23)', () => {
    teach('Test Hoard', 'Artifact', 'Sacrifice five Treasures: Search your library for an artifact or Dragon card, put that card onto the battlefield, then shuffle.');
    const ab = scriptOf('Test Hoard').activated as ActivatedAbility;
    expect(ab.cost).toMatchObject({ sacrificeCount: 5, sacrificeOne: { label: 'five treasures' } });
    expect(refusal('Artifact', 'Sacrifice five Treasures: Search your library for an artifact or Dragonling card, put that card onto the battlefield, then shuffle.')).not.toBeNull();
  });

  it('a token with an enchantment type: "a 1/1 colorless Shrine enchantment creature token" (205.3d)', () => {
    expect(parse('Sorcery', 'Create a 1/1 colorless Shrine enchantment creature token.').ok).toBe(true);
    expect(cardData('Shrine 1/1 C enchantment')).toMatchObject({ typeLine: 'Token Enchantment Creature — Shrine' });
    // Shrine is an enchantment type: a token that isn't an enchantment can't be one.
    expect(refusal('Sorcery', 'Create a 1/1 colorless Shrine creature token.')).toMatchObject({ reason: '"shrine" isn\'t a creature type' });
  });

  it('a flavor word (207.2d) is a label when the card lists it; a keyword written the same way (boast) isn\'t', () => {
    const tactician = (keywords: string[], text = 'Master Tactician — Whenever you gain life, draw a card.') => parseCard(fake('Test Tactician', 'Creature — Human', text, { keywords }));
    expect(tactician(['Master Tactician']).ok).toBe(true);
    expect(tactician([]).ok).toBe(false);
    expect(tactician(['Boast'], 'Boast — {1}: Draw a card.').ok).toBe(false);
  });
});
