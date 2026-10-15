// The Oracle text parser (src/cards/oracle.ts): what it reads, what it refuses, and that
// its scripts play the same as the hand scripts of the pool cards it can read.
import { describe, expect, it } from 'vitest';
import { cardData, registerCards } from '../src/cards/db';
import { needsScript, parseCard, scriptCards } from '../src/cards/oracle';
import { parseResults } from '../src/cards/oracle-report';
import { activatedAt, applyAction, applyBotAction, botAction, hasScript, isCreature, legalTargets, permanent, scriptOf, spellTargets, stats } from '../src/engine';
import type { Action, Card, CardData, CardScript, Game, TargetRef, TargetSpec } from '../src/engine';
import { registerScripts } from '../src/engine/registry';
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
    expect(refusal('Creature — Elf', 'Pay 1 life: Draw a card.')).toMatchObject({ reason: 'the cost "pay 1 life"' });
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

describe('the parse report', () => {
  it('lists every pool card with rules text as scripted or refused with its clause', () => {
    const { scripted, refused } = parseResults();
    expect(scripted).toEqual(expect.arrayContaining(SAMPLE));
    expect(refused.every((r) => r.clause && r.reason)).toBe(true);
    expect(refused.find((r) => r.name === 'Swords to Plowshares')).toMatchObject({ clause: 'its controller gains life equal to its power' });
  });
});
