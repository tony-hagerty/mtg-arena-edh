// The mechanics group of EDHREC's most-played commanders (src/cards/edhrec/mechanics.ts) and
// the rules they needed: the monarch (725), goad (701.15), dice (706), earthbend (701.66),
// firebending (702.189), station (702.184, 721), extra lands (305.2b), coloured cost
// reductions (118.7) and copying abilities (707.10). Each clause that could go wrong.
import { produce } from 'immer';
import { describe, expect, it } from 'vitest';
import { canBeCommander, cardData, deckProblems, registerCards } from '../src/cards/db';
import { problemsOf } from '../src/cards/support';
import { applyAction, applyBotAction, botAction, bounce, canPlayLand, castCost, counterCount, crewPower, dealDamage, earthbend, exile, has, hasType, isCreature, isLand, makeCard, rollDice, stats, subtypesOf } from '../src/engine';
import type { Action, CardData, Game, PlayerId, TargetRef } from '../src/engine';
import { registerScripts } from '../src/engine/registry';
import { MANA_ROCKS, byName, emptyGame, put, runWith, twoCommanderDeck } from './helpers';
import './fixtures';

const pass = { type: 'pass' } as const;
// Every pass is explicit here, so a test can act in any step (the attackers step, an upkeep).
const OPTS = { autoPass: false } as const;
const run = (g: Game, ...actions: Action[]) => runWith(OPTS, g, ...actions);
const player = (id: PlayerId): TargetRef => ({ kind: 'player', id });
const card = (c: { id: string }): TargetRef => ({ kind: 'card', id: c.id });

// A plain Eldrazi creature and an Eldrazi instant, for Ulalek: the pool has no cheap Eldrazi spell.
const fake = (name: string, typeLine: string, manaCost: string, cmc: number, oracleText = '', pt: Partial<CardData> = {}): CardData => ({
  name,
  manaCost,
  cmc,
  colors: [],
  colorIdentity: [],
  typeLine,
  oracleText,
  keywords: [],
  image: '',
  art: '',
  ...pt,
});
registerCards({
  'Test Eldrazi': fake('Test Eldrazi', 'Creature — Eldrazi', '{2}', 2, '', { power: '2', toughness: '2' }),
  'Test Eldrazi Bolt': fake('Test Eldrazi Bolt', 'Kindred Instant — Eldrazi', '{1}', 1, 'Test Eldrazi Bolt deals 2 damage to any target.'),
});
registerScripts({
  'Test Eldrazi Bolt': { targets: [{ type: 'any', label: 'any target' }], onResolve: (g, { self, targets }) => void dealDamage(g, self, targets[0], 2) },
});

/** Passes priority (bots answering anything asked) until the stack is empty and nothing is being decided, or player 0 (a person) must decide. */
function settle(g: Game): Game {
  for (let i = 0; i < 120 && (g.decision || g.stack.length || g.triggers.length); i++) {
    if (g.decision && g.priority === 0 && !g.players[0].isBot) return g;
    g = g.decision ? applyBotAction(g, botAction(g, g.priority), OPTS) : applyAction(g, pass, OPTS);
  }
  return g;
}
/**
 * Passes, bots acting as they like, until `stop` holds. Player 0, when a person, answers with
 * `answer`; left to itself it declares no attackers or blockers and answers anything else as a bot would.
 */
function until(g: Game, stop: (g: Game) => boolean, answer: (g: Game) => Action | null = () => null): Game {
  for (let i = 0; i < 900 && !stop(g); i++) {
    const human = g.decision && g.priority === 0 && !g.players[0].isBot;
    const mine = human ? (answer(g) ?? (g.decision!.type === 'attackers' || g.decision!.type === 'blockers' ? pass : null)) : null;
    g = mine ? run(g, mine) : g.decision ? applyBotAction(g, botAction(g, g.priority), OPTS) : applyAction(g, pass, OPTS);
  }
  return g;
}
/** A game where player 0 is a person. */
const humanGame = (setup: (g: Game) => void) =>
  emptyGame((d) => {
    d.players[0].isBot = false;
    setup(d);
  });
/** Replaces a player's library with these cards, the first on top. */
function top(g: Game, pid: PlayerId, names: string[]) {
  g.players[pid].library = names.map((n) => makeCard(g, n, pid, 'library'));
}
const plenty = Array.from({ length: 12 }, () => 'Mountain');
const tokens = (g: Game, pid: PlayerId, name: string) => g.players[pid].battlefield.filter((c) => c.isToken && cardData(c.name).name === name);
/** The decision waiting on player 0 now, by kind. */
const asked = (g: Game) => (g.decision && 'choice' in g.decision ? (g.decision.choice as { kind: string; text?: string; cards?: string[] }) : null);

describe('the mechanics group is playable', () => {
  it('every card has a script and only supported keywords', () => {
    for (const name of ['Toph, the First Metalbender', 'Avatar Aang // Aang, Master of Elements', 'Fire Lord Azula', 'Shorikai, Genesis Engine', 'Hearthhull, the Worldseed', 'Bello, Bard of the Brambles', 'Alela, Cunning Conqueror', 'Queen Marchesa', 'Mr. House, President and CEO', 'Ulalek, Fused Atrocity']) {
      expect(problemsOf(name), name).toEqual([]);
    }
  });

  it('a legendary Vehicle or Spacecraft can be a commander (903.3)', () => {
    expect(canBeCommander(cardData('Shorikai, Genesis Engine'))).toBe(true);
    expect(canBeCommander(cardData('Hearthhull, the Worldseed'))).toBe(true);
    expect(canBeCommander(cardData('Untethered Express'))).toBe(false); // not legendary
    expect(canBeCommander(cardData('Sol Ring'))).toBe(false);
    const deck = { ...twoCommanderDeck(), commanders: ['Shorikai, Genesis Engine'], basics: { Plains: 18, Island: 18 }, cards: [...MANA_ROCKS] };
    const problems = deckProblems({ ...deck, cards: deck.cards.slice(0, 63) }).filter((p) => p.includes("isn't a legendary creature"));
    expect(problems).toEqual([]);
  });
});

describe('Toph, the First Metalbender', () => {
  it('makes nontoken artifacts you control lands, in addition (layer 4), and not tokens or opponents\' artifacts', () => {
    const g = emptyGame((d) => {
      put(d, 0, 'Toph, the First Metalbender');
      put(d, 0, 'Sol Ring');
      put(d, 0, 'Treasure').isToken = true;
      put(d, 1, 'Sol Ring');
    });
    const ring = byName(g, 0, 'Sol Ring')!;
    expect(isLand(g, ring)).toBe(true);
    expect(hasType(g, ring, 'Artifact')).toBe(true);
    expect(isLand(g, byName(g, 0, 'Treasure')!)).toBe(false);
    expect(isLand(g, byName(g, 1, 'Sol Ring')!)).toBe(false);
  });

  it('earthbends 2 at your end step: the land is a 0/0 land creature with haste and two +1/+1 counters, and comes back tapped when it dies (701.66a)', () => {
    let g = humanGame((d) => {
      put(d, 0, 'Toph, the First Metalbender');
      put(d, 0, 'Forest');
      put(d, 1, 'Shock', 'hand');
      put(d, 1, 'Mountain');
      top(d, 0, plenty);
      top(d, 1, plenty);
    });
    const forest = byName(g, 0, 'Forest')!;
    g = until(g, (x) => x.step === 'end' && x.decision?.type === 'targets');
    // Only the land can be the target: Toph isn't one.
    g = run(g, { type: 'chooseTargets', targets: [card(forest)] });
    g = until(g, (x) => !x.stack.length && !x.triggers.length);
    let land = byName(g, 0, 'Forest')!;
    expect(isCreature(g, land)).toBe(true);
    expect(isLand(g, land)).toBe(true);
    expect(stats(g, land)).toMatchObject({ power: 2, toughness: 2 });
    expect(has(g, land, 'haste')).toBe(true);
    expect(counterCount(land)).toBe(2);
    expect(g.players[0].bent).toContain('earthbend');
    // It still taps for mana: its land types stay (the card's rulings).
    // The opponent Shocks it on their turn: it dies and returns tapped under Toph's controller's control.
    g = until(g, (x) => x.active === 1 && x.step === 'main1' && x.priority === 1 && !x.stack.length);
    g = run(g, { type: 'cast', card: byName(g, 1, 'Shock', 'hand')!.id, targets: [card(land)] });
    g = until(g, (x) => !x.stack.length && !x.triggers.length);
    land = byName(g, 0, 'Forest')!;
    expect(land).toBeDefined();
    expect(land.tapped).toBe(true);
    expect(isCreature(g, land)).toBe(false); // a new object (400.7): the earthbend effect is gone
    expect(g.players[0].graveyard.some((c) => c.name === 'Forest')).toBe(false);
  });

  it('returns an earthbent land that is exiled, but not one returned to a hand', () => {
    let g = emptyGame((d) => {
      put(d, 0, 'Toph, the First Metalbender');
      put(d, 0, 'Forest');
      put(d, 0, 'Mountain');
    });
    // Earthbend by hand, as Toph's trigger would (bots would pick a land anyway).
    g = produce(g, (d) => earthbend(d, byName(d, 0, 'Forest')!, 2, 0));
    let forest = byName(g, 0, 'Forest')!;
    expect(forest.earthbent).toEqual([0]);
    g = produce(g, (d) => exile(d, byName(d, 0, 'Forest')!));
    expect(g.triggers.some((t) => t.hook === 'onEarthbent')).toBe(true);
    g = settle(g);
    forest = byName(g, 0, 'Forest')!;
    expect(forest).toBeDefined();
    expect(forest.tapped).toBe(true);
    // A land bounced to a hand isn't returned (it neither died nor was exiled).
    g = produce(g, (d) => {
      earthbend(d, byName(d, 0, 'Mountain')!, 1, 0);
      bounce(d, byName(d, 0, 'Mountain')!);
    });
    expect(g.triggers.some((t) => t.hook === 'onEarthbent')).toBe(false);
    expect(g.players[0].hand.some((c) => c.name === 'Mountain')).toBe(true);
  });
});

describe('firebending and Fire Lord Azula', () => {
  it('adds {R}{R} when Azula attacks, kept until end of combat and gone in the second main phase (702.189a, 500.5a)', () => {
    let g = humanGame((d) => {
      put(d, 0, 'Fire Lord Azula');
      top(d, 0, plenty);
      top(d, 1, plenty);
    });
    g = until(g, (x) => x.decision?.type === 'attackers' && x.priority === 0);
    g = run(g, { type: 'declareAttack', card: byName(g, 0, 'Fire Lord Azula')!.id, defender: 1 }, pass);
    // The firebending trigger resolves: mana in the pool that stays through combat.
    g = until(g, (x) => x.step === 'attackers' && !x.stack.length && !x.triggers.length && x.priority === 0 && !x.decision);
    expect(g.players[0].pool.map((m) => m.sym)).toEqual(['R', 'R']);
    expect(g.players[0].bent).toEqual(['firebend']);
    g = until(g, (x) => x.step === 'damage' || x.step === 'endCombat');
    expect(g.players[0].pool).toHaveLength(2);
    g = until(g, (x) => x.step === 'main2');
    expect(g.players[0].pool).toHaveLength(0);
  });

  it('copies a spell cast while Azula is attacking, with new targets, and not one cast while she isn\'t', () => {
    let g = humanGame((d) => {
      put(d, 0, 'Fire Lord Azula');
      put(d, 0, 'Shock', 'hand', 2);
      put(d, 0, 'Mountain');
      top(d, 0, plenty);
      top(d, 1, plenty);
    });
    // In the first main phase she isn't attacking: no copy.
    g = run(g, { type: 'cast', card: byName(g, 0, 'Shock', 'hand')!.id, targets: [player(1)] });
    g = settle(g);
    expect(g.players[1].life).toBe(38);
    g = until(g, (x) => x.decision?.type === 'attackers' && x.priority === 0);
    g = run(g, { type: 'declareAttack', card: byName(g, 0, 'Fire Lord Azula')!.id, defender: 1 }, pass);
    g = until(g, (x) => x.step === 'attackers' && !x.stack.length && !x.triggers.length && x.priority === 0 && !x.decision);
    // Shock, paid with the firebending mana. Azula's trigger copies it; the copy may take a new target.
    g = run(g, { type: 'cast', card: byName(g, 0, 'Shock', 'hand')!.id, targets: [player(1)] });
    g = until(g, (x) => x.decision?.type === 'targets' && x.priority === 0);
    expect(g.decision?.type === 'targets' && g.decision.item.copy).toBe(true);
    g = run(g, { type: 'chooseTargets', targets: [player(2)] });
    expect(g.stack.filter((x) => x.card.name === 'Shock')).toHaveLength(2);
    g = until(g, (x) => !x.stack.length && !x.triggers.length);
    expect(g.players[1].life).toBe(36);
    expect(g.players[2].life).toBe(38);
    expect(g.players[0].pool).toHaveLength(1); // the other {R} stays until end of combat
    g = until(g, (x) => x.step === 'main2');
    expect(g.players[0].pool).toHaveLength(0);
  });
});

describe('Avatar Aang // Aang, Master of Elements', () => {
  it('draws on each bend and transforms once all four have been done this turn', () => {
    let g = humanGame((d) => {
      put(d, 0, 'Avatar Aang');
      d.players[0].bent = ['waterbend', 'earthbend', 'airbend']; // done earlier this turn
      top(d, 0, plenty);
      top(d, 1, plenty);
    });
    g = until(g, (x) => x.decision?.type === 'attackers' && x.priority === 0);
    g = run(g, { type: 'declareAttack', card: byName(g, 0, 'Avatar Aang')!.id, defender: 1 }, pass);
    g = until(g, (x) => x.step === 'attackers' && !x.stack.length && !x.triggers.length && !x.decision);
    const aang = g.players[0].battlefield.find((c) => c.name.startsWith('Avatar Aang'))!;
    expect(aang.face).toBe(1);
    expect(cardData(aang.name).faces![aang.face].name).toBe('Aang, Master of Elements');
    expect(g.players[0].hand).toHaveLength(1); // the card drawn by the bend trigger
    expect(stats(g, aang)).toMatchObject({ power: 6, toughness: 6 });
  });

  it("doesn't transform with only three bends this turn", () => {
    let g = humanGame((d) => {
      put(d, 0, 'Avatar Aang');
      d.players[0].bent = ['waterbend', 'airbend'];
      top(d, 0, plenty);
      top(d, 1, plenty);
    });
    g = until(g, (x) => x.decision?.type === 'attackers' && x.priority === 0);
    g = run(g, { type: 'declareAttack', card: byName(g, 0, 'Avatar Aang')!.id, defender: 1 }, pass);
    g = until(g, (x) => x.step === 'attackers' && !x.stack.length && !x.triggers.length && !x.decision);
    expect(byName(g, 0, 'Avatar Aang')!.face).toBe(0);
    expect(g.players[0].hand).toHaveLength(1);
  });

  it('the back face reduces spells by {W}{U}{B}{R}{G}: matching pips first, the rest off generic (118.7b-c)', () => {
    const g = emptyGame((d) => {
      const aang = put(d, 0, 'Avatar Aang');
      aang.face = 1;
      put(d, 0, 'Serra Angel', 'hand'); // {3}{W}{W}
      put(d, 0, 'Shock', 'hand'); // {R}
      put(d, 1, 'Serra Angel', 'hand');
    });
    const angel = castCost(g, byName(g, 0, 'Serra Angel', 'hand')!, {}, 0);
    expect(angel.pips).toEqual(['W']); // one {W} taken off; {U}{B}{R}{G} take 4 generic, of which there are 3
    expect(angel.generic).toBe(0);
    const shock = castCost(g, byName(g, 0, 'Shock', 'hand')!, {}, 0);
    expect(shock.pips).toEqual([]);
    expect(shock.generic).toBe(0);
    // Only spells its controller casts.
    expect(castCost(g, byName(g, 1, 'Serra Angel', 'hand')!, {}, 1)).toMatchObject({ generic: 3, pips: ['W', 'W'] });
  });

  it('at each upkeep the back face may transform; if it does: 4 life, four cards, four counters and 4 damage to each opponent', () => {
    let g = humanGame((d) => {
      const aang = put(d, 0, 'Avatar Aang');
      aang.face = 1;
      top(d, 0, plenty);
      top(d, 1, plenty);
    });
    // An opponent's upkeep asks too ("each upkeep").
    g = until(g, (x) => x.active === 1 && x.decision?.type === 'ask' && x.priority === 0);
    expect(asked(g)?.text).toContain('Transform');
    g = run(g, { type: 'answer', yes: false });
    expect(byName(g, 0, 'Avatar Aang')!.face).toBe(1);
    g = until(g, (x) => x.active === 2 && x.decision?.type === 'ask' && x.priority === 0);
    const life = g.players[0].life;
    const hand = g.players[0].hand.length;
    g = run(g, { type: 'answer', yes: true });
    g = until(g, (x) => !x.stack.length && !x.triggers.length && !x.decision);
    const aang = byName(g, 0, 'Avatar Aang')!;
    expect(aang.face).toBe(0);
    expect(g.players[0].life).toBe(life + 4);
    expect(g.players[0].hand).toHaveLength(hand + 4);
    expect(counterCount(aang)).toBe(4);
    expect(stats(g, aang)).toMatchObject({ power: 8, toughness: 8 });
    for (const o of [1, 2, 3]) expect(g.players[o].life).toBe(36);
  });
});

describe('Shorikai, Genesis Engine and Pilot tokens', () => {
  it('draws two, then discards a card, then makes a Pilot, which crews as though its power were 2 greater', () => {
    let g = humanGame((d) => {
      put(d, 0, 'Shorikai, Genesis Engine');
      put(d, 0, 'Plains');
      put(d, 0, 'Untethered Express');
      top(d, 0, plenty);
    });
    g = run(g, { type: 'activate', card: byName(g, 0, 'Shorikai, Genesis Engine')!.id, activated: 0 });
    g = until(g, (x) => x.decision?.type === 'chooseCards' && x.priority === 0);
    expect(g.players[0].hand).toHaveLength(2);
    expect(tokens(g, 0, 'Pilot')).toHaveLength(0); // the token comes after the discard (608.2c)
    g = run(g, { type: 'chooseCards', cards: [g.players[0].hand[0].id] });
    g = settle(g);
    expect(g.players[0].hand).toHaveLength(1);
    const [pilot] = tokens(g, 0, 'Pilot');
    expect(pilot).toBeDefined();
    expect(stats(g, pilot)).toMatchObject({ power: 1, toughness: 1 });
    expect(crewPower(g, 0, byName(g, 0, 'Untethered Express')!, [pilot])).toBe(3);
    // Three Pilots crew Shorikai's crew 8 (3 + 3 + 3).
    g = produce(g, (d) => {
      put(d, 0, 'Pilot', 'battlefield', 2).isToken = true;
      d.players[0].battlefield.filter((c) => c.name === 'Pilot').forEach((c) => (c.isToken = true));
    });
    const pilots = tokens(g, 0, 'Pilot');
    expect(pilots).toHaveLength(3);
    expect(crewPower(g, 0, byName(g, 0, 'Shorikai, Genesis Engine')!, pilots)).toBe(9);
    g = run(g, { type: 'activate', card: byName(g, 0, 'Shorikai, Genesis Engine')!.id, activated: 1, crew: pilots.map((c) => c.id) });
    g = settle(g);
    expect(isCreature(g, byName(g, 0, 'Shorikai, Genesis Engine')!)).toBe(true);
  });
});

describe('Hearthhull, the Worldseed: station and its thresholds', () => {
  it('stations by tapping another creature, for charge counters equal to its power, only as a sorcery (702.184a)', () => {
    let g = humanGame((d) => {
      put(d, 0, 'Hearthhull, the Worldseed');
      put(d, 0, 'Serra Angel'); // power 4
      put(d, 0, 'Elite Vanguard'); // power 2
      put(d, 1, 'Serra Angel');
    });
    const hull = byName(g, 0, 'Hearthhull, the Worldseed')!;
    const angel = byName(g, 0, 'Serra Angel')!;
    // Not with an opponent's creature, nor without naming one.
    expect(applyAction(g, { type: 'activate', card: hull.id, activated: 0, station: byName(g, 1, 'Serra Angel')!.id }, OPTS)).toBe(g);
    expect(applyAction(g, { type: 'activate', card: hull.id, activated: 0 }, OPTS)).toBe(g);
    g = run(g, { type: 'activate', card: hull.id, activated: 0, station: angel.id });
    expect(byName(g, 0, 'Serra Angel')!.tapped).toBe(true);
    g = settle(g);
    expect(counterCount(byName(g, 0, 'Hearthhull, the Worldseed')!, 'charge')).toBe(4);
    expect(isCreature(g, byName(g, 0, 'Hearthhull, the Worldseed')!)).toBe(false);
    // Station is sorcery-speed: not in combat.
    g = until(g, (x) => x.step === 'beginCombat' && x.priority === 0 && !x.decision);
    expect(applyAction(g, { type: 'activate', card: hull.id, activated: 0, station: byName(g, 0, 'Elite Vanguard')!.id }, OPTS)).toBe(g);
  });

  it('has the 2+ ability only with two or more charge counters: sacrifice a land to draw two and play an extra land, and opponents lose 2 life', () => {
    let g = humanGame((d) => {
      put(d, 0, 'Hearthhull, the Worldseed');
      put(d, 0, 'Mountain', 'battlefield', 2);
      put(d, 0, 'Forest', 'hand', 2);
      top(d, 0, plenty);
    });
    const hull = byName(g, 0, 'Hearthhull, the Worldseed')!;
    const mountain = byName(g, 0, 'Mountain')!;
    expect(applyAction(g, { type: 'activate', card: hull.id, activated: 1, sacrifice: [mountain.id] }, OPTS)).toBe(g);
    g = produce(g, (d) => void (byName(d, 0, 'Hearthhull, the Worldseed')!.counters.charge = 2));
    // One land this turn already.
    g = run(g, { type: 'playLand', card: byName(g, 0, 'Forest', 'hand')!.id });
    expect(canPlayLand(g, 0, byName(g, 0, 'Forest', 'hand')!)).toBe(false);
    g = run(g, { type: 'activate', card: hull.id, activated: 1, sacrifice: [mountain.id] });
    g = settle(g);
    expect(g.players[0].hand.filter((c) => c.name === 'Mountain')).toHaveLength(2);
    expect(canPlayLand(g, 0, byName(g, 0, 'Forest', 'hand')!)).toBe(true);
    g = run(g, { type: 'playLand', card: byName(g, 0, 'Forest', 'hand')!.id });
    expect(g.players[0].battlefield.filter((c) => c.name === 'Forest')).toHaveLength(2);
    // "Whenever you sacrifice a land, each opponent loses 2 life."
    for (const o of [1, 2, 3]) expect(g.players[o].life).toBe(38);
    expect(g.players[0].life).toBe(40);
  });

  it('is a 6/7 artifact creature with flying, vigilance and haste at 8+ (721.2b)', () => {
    const g = emptyGame((d) => {
      put(d, 0, 'Hearthhull, the Worldseed').counters.charge = 8;
    });
    const hull = byName(g, 0, 'Hearthhull, the Worldseed')!;
    expect(isCreature(g, hull)).toBe(true);
    expect(hasType(g, hull, 'Artifact')).toBe(true);
    expect(stats(g, hull)).toMatchObject({ power: 6, toughness: 7 });
    for (const k of ['flying', 'vigilance', 'haste']) expect(has(g, hull, k)).toBe(true);
  });
});

describe('Bello, Bard of the Brambles', () => {
  it('during your turn, non-Equipment artifacts and non-Aura enchantments with mana value 4+ are 4/4 Elemental creatures with indestructible and haste', () => {
    let g = emptyGame((d) => {
      put(d, 0, 'Bello, Bard of the Brambles');
      put(d, 0, 'Thran Dynamo'); // artifact, mana value 4
      put(d, 0, 'Sol Ring'); // mana value 1
      put(d, 0, 'Doubling Season'); // enchantment, mana value 5
      put(d, 0, 'Helm of the Ghastlord'); // an Aura, mana value 4
      put(d, 1, 'Thran Dynamo');
    });
    const dynamo = byName(g, 0, 'Thran Dynamo')!;
    expect(isCreature(g, dynamo)).toBe(true);
    expect(hasType(g, dynamo, 'Artifact')).toBe(true);
    expect(subtypesOf(g, dynamo)).toContain('Elemental');
    expect(stats(g, dynamo)).toMatchObject({ power: 4, toughness: 4 });
    expect(has(g, dynamo, 'indestructible')).toBe(true);
    expect(has(g, dynamo, 'haste')).toBe(true);
    expect(isCreature(g, byName(g, 0, 'Doubling Season')!)).toBe(true);
    expect(isCreature(g, byName(g, 0, 'Sol Ring')!)).toBe(false);
    expect(isCreature(g, byName(g, 0, 'Helm of the Ghastlord')!)).toBe(false);
    expect(isCreature(g, byName(g, 1, 'Thran Dynamo')!)).toBe(false);
    // Not during another player's turn.
    g = produce(g, (d) => void (d.active = 1));
    expect(isCreature(g, byName(g, 0, 'Thran Dynamo')!)).toBe(false);
  });

  it('the Dynamo attacks and draws a card on combat damage to a player', () => {
    let g = humanGame((d) => {
      put(d, 0, 'Bello, Bard of the Brambles');
      put(d, 0, 'Thran Dynamo');
      top(d, 0, plenty);
      top(d, 1, plenty);
    });
    g = until(g, (x) => x.decision?.type === 'attackers' && x.priority === 0);
    g = run(g, { type: 'declareAttack', card: byName(g, 0, 'Thran Dynamo')!.id, defender: 1 }, pass);
    g = until(g, (x) => x.step === 'main2');
    expect(g.players[1].life).toBe(36);
    expect(g.players[0].hand).toHaveLength(1);
  });
});

describe('Alela, Cunning Conqueror and goad', () => {
  it("makes a Faerie Rogue for your first spell on each opponent's turn, and not the second or on your own turn", () => {
    let g = humanGame((d) => {
      put(d, 0, 'Alela, Cunning Conqueror');
      put(d, 0, 'Shock', 'hand', 3);
      put(d, 0, 'Mountain', 'battlefield', 3);
      top(d, 0, plenty);
      top(d, 1, plenty);
    });
    g = run(g, { type: 'cast', card: byName(g, 0, 'Shock', 'hand')!.id, targets: [player(1)] });
    g = settle(g);
    expect(tokens(g, 0, 'Faerie Rogue')).toHaveLength(0);
    g = until(g, (x) => x.active === 1 && x.step === 'upkeep' && x.priority === 0 && !x.decision && !x.stack.length);
    g = run(g, { type: 'cast', card: byName(g, 0, 'Shock', 'hand')!.id, targets: [player(1)] });
    g = settle(g);
    expect(tokens(g, 0, 'Faerie Rogue')).toHaveLength(1);
    expect(has(g, tokens(g, 0, 'Faerie Rogue')[0], 'flying')).toBe(true);
    g = until(g, (x) => x.active === 1 && x.priority === 0 && !x.decision && !x.stack.length && x.step !== 'upkeep');
    g = run(g, { type: 'cast', card: byName(g, 0, 'Shock', 'hand')!.id, targets: [player(1)] });
    g = settle(g);
    expect(tokens(g, 0, 'Faerie Rogue')).toHaveLength(1);
  });

  it('goads a creature of a player Faeries dealt combat damage to: it must attack, and not its goader (701.15b)', () => {
    let g = humanGame((d) => {
      put(d, 0, 'Alela, Cunning Conqueror');
      put(d, 1, 'Elite Vanguard'); // no flier to block Alela
      put(d, 1, 'Raging Goblin');
      top(d, 0, plenty);
      top(d, 1, plenty);
      top(d, 2, plenty);
    });
    g = until(g, (x) => x.decision?.type === 'attackers' && x.priority === 0);
    g = run(g, { type: 'declareAttack', card: byName(g, 0, 'Alela, Cunning Conqueror')!.id, defender: 1 }, pass);
    g = until(g, (x) => x.decision?.type === 'targets' && x.priority === 0);
    // "Target creature that player controls": only player 1's creatures.
    expect(applyAction(g, { type: 'chooseTargets', targets: [card(byName(g, 0, 'Alela, Cunning Conqueror')!)] }, OPTS)).toBe(g);
    g = run(g, { type: 'chooseTargets', targets: [card(byName(g, 1, 'Elite Vanguard')!)] });
    g = until(g, (x) => x.step === 'main2');
    const vanguard = byName(g, 1, 'Elite Vanguard')!;
    expect(vanguard.goaded).toEqual([{ by: 0 }]);
    // On player 1's turn the Vanguard can't attack its goader while another player is there...
    g = until(g, (x) => x.active === 1 && x.decision?.type === 'attackers');
    expect(applyAction(g, { type: 'declareAttack', card: vanguard.id, defender: 0 }, OPTS)).toBe(g);
    // ... and attacks even if its controller leaves it home: the bot's plan, or the engine on pass.
    g = until(g, (x) => x.active === 1 && x.step === 'blockers');
    const attack = g.combat!.attacks.find((a) => a.id === vanguard.id)!;
    expect(attack).toBeDefined();
    expect(attack.defender).not.toBe(0);
    // The goad ends as the goader's next turn begins (701.15a).
    g = until(g, (x) => x.active === 0 && x.turn > 1);
    expect(byName(g, 1, 'Elite Vanguard')?.goaded).toBeUndefined();
  });
});

describe('Queen Marchesa and the monarch (725)', () => {
  it('you become the monarch as she enters, draw at your end step, and lose the crown to combat damage', () => {
    let g = humanGame((d) => {
      put(d, 0, 'Queen Marchesa', 'hand');
      for (const land of ['Plains', 'Mountain', 'Swamp', 'Plains']) put(d, 0, land);
      put(d, 1, 'Raging Goblin');
      // Two players: the bot's Goblin has nobody to attack but the monarch.
      d.players[2].lost = true;
      d.players[3].lost = true;
      top(d, 0, plenty);
      top(d, 1, plenty);
    });
    expect(g.monarch).toBeUndefined();
    g = run(g, { type: 'cast', card: byName(g, 0, 'Queen Marchesa', 'hand')!.id });
    g = settle(g);
    expect(g.monarch).toBe(0);
    g = until(g, (x) => x.step === 'end' && x.active === 0 && x.stack.length > 0);
    expect(g.stack[0].hook).toBe('onMonarch');
    expect(g.stack[0].controller).toBe(0);
    const hand = g.players[0].hand.length;
    g = until(g, (x) => x.step === 'cleanup' || x.active !== 0);
    expect(g.players[0].hand.length).toBeGreaterThanOrEqual(hand + 1);
    // Player 1's Goblin hits the monarch: its controller becomes the monarch.
    g = until(g, (x) => x.active === 1 && x.decision?.type === 'attackers');
    g = run(g, { type: 'declareAttack', card: byName(g, 1, 'Raging Goblin')!.id, defender: 0 }, pass);
    g = until(g, (x) => x.active === 1 && x.step === 'main2');
    expect(g.monarch).toBe(1);
    // Now an opponent is the monarch: at player 0's upkeep an Assassin token with deathtouch and haste.
    g = until(g, (x) => x.active === 0 && x.step === 'draw');
    const [assassin] = tokens(g, 0, 'Assassin');
    expect(assassin).toBeDefined();
    expect(has(g, assassin, 'deathtouch')).toBe(true);
    expect(has(g, assassin, 'haste')).toBe(true);
  });

  it("no Assassin while you are the monarch yourself, and the crown passes to the active player when the monarch leaves the game (725.4)", () => {
    let g = emptyGame((d) => {
      put(d, 0, 'Queen Marchesa');
      d.monarch = 0;
      top(d, 0, plenty);
      top(d, 1, plenty);
    });
    g = until(g, (x) => x.active === 1 && x.step === 'main1');
    expect(tokens(g, 0, 'Assassin')).toHaveLength(0);
    g = produce(g, (d) => {
      d.players[0].life = 0;
    });
    g = applyAction(g, pass, OPTS);
    expect(g.players[0].lost).toBe(true);
    expect(g.monarch).toBe(1);
  });
});

describe('Mr. House, President and CEO and dice (706)', () => {
  it('rolls one die plus one for each mana from Treasures, and makes a Robot for each 4+ and a Treasure too for each 6+', () => {
    let g = humanGame((d) => {
      put(d, 0, 'Mr. House, President and CEO');
      put(d, 0, 'Treasure', 'battlefield', 2).isToken = true;
      d.players[0].battlefield.filter((c) => c.name === 'Treasure').forEach((c) => (c.isToken = true));
      put(d, 0, 'Plains', 'battlefield', 2);
    });
    const house = byName(g, 0, 'Mr. House, President and CEO')!;
    // One Treasure floated by hand first, the other left to auto-pay: both count.
    g = run(g, { type: 'tapMana', card: byName(g, 0, 'Treasure')!.id, color: 'W' });
    g = run(g, { type: 'activate', card: house.id });
    expect(g.stack[0].spentFrom?.filter((m) => m.name === 'Treasure')).toHaveLength(2);
    g = until(g, (x) => !x.stack.length && !x.triggers.length && !x.decision); // two triggers may ask for their order
    const roll = g.log.find((l) => / rolls? 3 d6s: /.test(l.text))!;
    expect(roll).toBeDefined();
    const results = roll.text.split(': ')[1].replace('.', '').split(', ').map(Number);
    expect(results).toHaveLength(3);
    expect(tokens(g, 0, 'Robot')).toHaveLength(results.filter((r) => r >= 4).length);
    expect(tokens(g, 0, 'Treasure')).toHaveLength(results.filter((r) => r >= 6).length);
    expect(g.players[0].bent ?? []).toEqual([]);
  });

  it('a roll of 4 or more makes a Robot; 6 or more a Robot and a Treasure together, in one event', () => {
    let g = emptyGame((d) => {
      put(d, 0, 'Mr. House, President and CEO');
    });
    // The roll results in a seeded game are fixed: try seeds until one gives each case.
    const outcomes = new Map<number, Game>();
    for (let seed = 1; seed < 40 && outcomes.size < 3; seed++) {
      const rolled = produce(g, (d) => {
        d.rng = seed;
        const [r] = rollDice(d, 0, 6);
        d.log.push({ turn: d.turn, text: `rolled ${r}` });
      });
      const r = Number(rolled.log[rolled.log.length - 1].text.split(' ')[1]);
      const kind = r >= 6 ? 6 : r >= 4 ? 4 : 1;
      if (!outcomes.has(kind)) outcomes.set(kind, settle(rolled));
    }
    expect(tokens(outcomes.get(1)!, 0, 'Robot')).toHaveLength(0);
    expect(tokens(outcomes.get(4)!, 0, 'Robot')).toHaveLength(1);
    expect(tokens(outcomes.get(4)!, 0, 'Treasure')).toHaveLength(0);
    expect(tokens(outcomes.get(6)!, 0, 'Robot')).toHaveLength(1);
    expect(tokens(outcomes.get(6)!, 0, 'Treasure')).toHaveLength(1);
    // The two entered together (603.6a): the same timestamp order, one creation.
    const six = outcomes.get(6)!;
    expect(six.log.filter((l) => /creates/.test(l.text)).length).toBeLessThanOrEqual(1);
  });
});

describe('Ulalek, Fused Atrocity: copying spells and abilities (707.10)', () => {
  it('may pay {C}{C} when you cast an Eldrazi spell to copy your spells, then your other abilities, with new targets', () => {
    let g = humanGame((d) => {
      put(d, 0, 'Ulalek, Fused Atrocity');
      put(d, 0, 'Shorikai, Genesis Engine');
      put(d, 0, 'Sol Ring');
      put(d, 0, 'Plains', 'battlefield', 3);
      put(d, 0, 'Test Eldrazi Bolt', 'hand');
      top(d, 0, plenty);
      top(d, 1, plenty);
    });
    // Shorikai's ability first (held), then the Eldrazi instant: both are on the stack under Ulalek's trigger.
    g = run(g, { type: 'activate', card: byName(g, 0, 'Shorikai, Genesis Engine')!.id, activated: 0, hold: true });
    g = run(g, { type: 'cast', card: byName(g, 0, 'Test Eldrazi Bolt', 'hand')!.id, targets: [player(1)], hold: true });
    g = until(g, (x) => x.decision?.type === 'ask' && x.priority === 0);
    expect(asked(g)?.text).toContain('{C}{C}');
    g = run(g, { type: 'answer', yes: true });
    // The copy of the Bolt may take a new target; the ability's copy has none.
    g = until(g, (x) => x.decision?.type === 'targets' && x.priority === 0);
    g = run(g, { type: 'chooseTargets', targets: [player(2)] });
    g = until(g, (x) => x.decision?.type === 'chooseCards' && x.priority === 0);
    // Shorikai's loot resolved twice: the copy first. Discard for each.
    g = run(g, { type: 'chooseCards', cards: [g.players[0].hand[0].id] });
    g = until(g, (x) => x.decision?.type === 'chooseCards' && x.priority === 0);
    g = run(g, { type: 'chooseCards', cards: [g.players[0].hand[0].id] });
    g = settle(g);
    expect(g.players[1].life).toBe(38);
    expect(g.players[2].life).toBe(38);
    expect(tokens(g, 0, 'Pilot')).toHaveLength(2);
    expect(g.players[0].pool).toHaveLength(0);
  });

  it('a copied permanent spell becomes a token, and nothing is copied without paying', () => {
    let g = humanGame((d) => {
      put(d, 0, 'Ulalek, Fused Atrocity');
      put(d, 0, 'Sol Ring');
      put(d, 0, 'Plains', 'battlefield', 2);
      put(d, 0, 'Test Eldrazi', 'hand', 2);
    });
    // The Plains pay for the Eldrazi, so Sol Ring is left for {C}{C}.
    for (const plains of g.players[0].battlefield.filter((c) => c.name === 'Plains')) g = run(g, { type: 'tapMana', card: plains.id });
    g = run(g, { type: 'cast', card: byName(g, 0, 'Test Eldrazi', 'hand')!.id });
    g = until(g, (x) => x.decision?.type === 'ask' && x.priority === 0);
    g = run(g, { type: 'answer', yes: true });
    g = settle(g);
    const eldrazi = g.players[0].battlefield.filter((c) => c.name === 'Test Eldrazi');
    expect(eldrazi).toHaveLength(2);
    expect(eldrazi.filter((c) => c.isToken)).toHaveLength(1);
    // Declining: one Eldrazi, no copy.
    g = until(g, (x) => x.active === 0 && x.turn > 1 && x.step === 'main1' && !x.decision && !x.stack.length && x.priority === 0);
    for (const plains of g.players[0].battlefield.filter((c) => c.name === 'Plains')) g = run(g, { type: 'tapMana', card: plains.id });
    g = run(g, { type: 'cast', card: byName(g, 0, 'Test Eldrazi', 'hand')!.id });
    g = until(g, (x) => x.decision?.type === 'ask' && x.priority === 0);
    g = run(g, { type: 'answer', yes: false });
    g = settle(g);
    expect(g.players[0].battlefield.filter((c) => c.name === 'Test Eldrazi')).toHaveLength(3);
  });

  it("doesn't trigger for a non-Eldrazi spell", () => {
    let g = humanGame((d) => {
      put(d, 0, 'Ulalek, Fused Atrocity');
      put(d, 0, 'Sol Ring');
      put(d, 0, 'Shock', 'hand');
      put(d, 0, 'Mountain');
    });
    g = run(g, { type: 'cast', card: byName(g, 0, 'Shock', 'hand')!.id, targets: [player(1)] });
    expect(g.triggers).toHaveLength(0);
    g = settle(g);
    expect(g.players[1].life).toBe(38);
  });
});
